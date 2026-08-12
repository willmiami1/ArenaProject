import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  ClipboardPen,
  CreditCard,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRoundPlus,
} from "lucide-react";
import {
  competitionName,
  contestantEligibleForRole,
  minimumDrawEntries,
} from "./competition";
import {
  loadLocalRegistrationWorkspace,
  normalizeRegistrationDeskData,
  registrationDeskProjection,
  saveLocalRegistrationWorkspace,
  submitLocalRegistrationDeskSignup,
  upsertRegistrationDeskContestant,
  type RegistrationDeskContestantInput,
  type RegistrationDeskData,
  type RegistrationDeskWaiverSignature,
} from "./registrationDeskData";
import {
  buildRegistrationDeskDrawRequest,
  buildRegistrationDeskPickedTeamsRequest,
  createRegistrationDeskTeamRow,
  defaultRegistrationDeskMode,
  pickedTeamRowsError,
  registrationDeskPayerCandidates,
  registrationDeskReviewComplete,
  registrationDeskRoleCandidates,
  registrationDeskTotals,
  supportedRegistrationDeskModes,
  type RegistrationDeskEntryMode,
  type RegistrationDeskPaymentMethod,
  type RegistrationDeskSignupRequest,
  type RegistrationDeskTeamRow,
} from "./registrationDeskSignup";
import type { ArenaData, Contestant } from "./types";
import { roundRobinRoleCapacity } from "./roundRobinCapacity";
import { registrationDeskWorkspaceHref } from "./registrationDeskNavigation";
import {
  registrationDeskEntryPatch,
  registrationDeskEntryPermissions,
  registrationDeskScratchRequest,
  type RegistrationDeskEntryDraft,
} from "./registrationDeskEntryActions";
import { showStandaloneRegistrationProfile } from "./registrationDeskProfile";
import {
  registrationDeskEventRoster,
  type RegistrationDeskRosterEntry,
} from "./registrationDeskRoster";
import {
  registrationDeskWaiverParticipants,
  registrationDeskWaiverSignature,
  submitLocalRegistrationDeskWaiver,
} from "./registrationDeskWaiver";
import { RegistrationDeskWaiverDialog } from "./RegistrationDeskWaiverDialog";
import {
  isWixEmbed,
  loadRegistrationDeskData,
  saveRegistrationDeskContestant,
  scratchRegistrationDeskEntry,
  setRegistrationDeskContestantPin,
  submitRegistrationDeskSignup,
  submitRegistrationDeskWaiver,
  updateRegistrationDeskEntry,
} from "./wixBridge";

const emptyContestant = (): RegistrationDeskContestantInput => ({
  name: "",
  role: "Both",
  headerHandicap: 3,
  heelerHandicap: 3,
  phone: "",
  email: "",
  hometown: "",
  horses: [],
});

const formatMoney = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

const formatWaiverSignedAt = (value: string) => {
  const signedAt = new Date(value);
  return Number.isNaN(signedAt.getTime())
    ? value
    : signedAt.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      });
};

function WaiverStatusControl({
  contestantName,
  signature,
  available,
  disabled,
  onSign,
}: {
  contestantName: string;
  signature?: RegistrationDeskWaiverSignature;
  available: boolean;
  disabled: boolean;
  onSign: () => void;
}) {
  return (
    <div className="registration-waiver-status-control">
      <span
        className={`registration-waiver-badge ${
          signature ? "signed" : "needed"
        }`}
        role="status"
      >
        {signature
          ? `Signed ${formatWaiverSignedAt(signature.signedAt)}`
          : "Waiver needed"}
      </span>
      {!signature && (
        <button
          type="button"
          disabled={disabled || !available}
          title={
            available
              ? `Open the waiver for ${contestantName}`
              : "Staff must configure the authoritative waiver before signing."
          }
          onClick={onSign}
        >
          {available ? "Sign waiver" : "Signing unavailable"}
        </button>
      )}
    </div>
  );
}

function asWorkspace(data: RegistrationDeskData): ArenaData {
  return {
    participantDatabaseVersion: 2,
    meets: [],
    events: data.events.map((event) => ({
      ...event,
      resultsPublished: false,
      timeLimit: 0,
      rounds: 1,
      shortGoTeams: 0,
      progressiveAfterRound: 0,
      addedMoney: 0,
      incentivePayouts: false,
      incentiveHandicapTotal: 7,
      incentiveTeams: 1,
      incentiveAmountPerTeam: 0,
      officeCharge: 0,
      stockCharge: 0,
      producerFeePercent: 0,
      payoutPercentages: [],
      drawHistory: [],
    })),
    contestants: data.contestants,
    teams: data.teams,
    registrations: data.registrations,
    spectators: [],
    spectatorPredictions: [],
    activeEventId: data.events[0]?.id ?? "",
  };
}

export function RegistrationDesk() {
  const embedded = isWixEmbed();
  const [data, setData] = useState<RegistrationDeskData | null>(() =>
    embedded
      ? null
      : registrationDeskProjection(loadLocalRegistrationWorkspace()),
  );
  const [eventId, setEventId] = useState("");
  const [contestantId, setContestantId] = useState("");
  const [role, setRole] = useState<"Header" | "Heeler">("Header");
  const [entries, setEntries] = useState(1);
  const [entryHorseName, setEntryHorseName] = useState("");
  const [entryMode, setEntryMode] = useState<RegistrationDeskEntryMode | "">("");
  const [teamRows, setTeamRows] = useState<RegistrationDeskTeamRow[]>(() => [
    createRegistrationDeskTeamRow(),
  ]);
  const [payerContestantId, setPayerContestantId] = useState("");
  const [paymentMethod, setPaymentMethod] =
    useState<RegistrationDeskPaymentMethod | "">("");
  const [review, setReview] = useState(false);
  const [submissionId, setSubmissionId] = useState("");
  const [search, setSearch] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinConfirmation, setPinConfirmation] = useState("");
  const [profile, setProfile] =
    useState<RegistrationDeskContestantInput>(emptyContestant);
  const addContestantNameRef = useRef<HTMLInputElement>(null);
  const [horseName, setHorseName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [rosterEntryEdit, setRosterEntryEdit] =
    useState<RegistrationDeskEntryDraft | null>(null);
  const [waiverContestantId, setWaiverContestantId] = useState("");
  const [waiverBusy, setWaiverBusy] = useState(false);
  const [waiverError, setWaiverError] = useState("");

  useEffect(() => {
    if (!embedded) return;
    loadRegistrationDeskData()
      .then((result) =>
        setData(result ? normalizeRegistrationDeskData(result) : null),
      )
      .catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "Registration data could not be loaded.",
        ),
      );
  }, [embedded]);

  useEffect(() => {
    if (!data?.events.length) return;
    if (!data.events.some((event) => event.id === eventId)) {
      setEventId(data.events[0].id);
    }
  }, [data, eventId]);

  const event = data?.events.find((item) => item.id === eventId);
  const eventRoster = useMemo(
    () => registrationDeskEventRoster(data, eventId),
    [data, eventId],
  );
  const waiverParticipants = useMemo(
    () => registrationDeskWaiverParticipants(eventRoster),
    [eventRoster],
  );
  const rosterSections = [
    {
      id: "header",
      title: "Headers",
      entries: eventRoster.filter(
        (rosterEntry) => rosterEntry.role === "Header" && rosterEntry.recordType === "registration",
      ),
    },
    {
      id: "heeler",
      title: "Heelers",
      entries: eventRoster.filter(
        (rosterEntry) => rosterEntry.role === "Heeler" && rosterEntry.recordType === "registration",
      ),
    },
    {
      id: "team",
      title: "Picked Teams",
      entries: eventRoster.filter(
        (rosterEntry) => rosterEntry.recordType === "team",
      ),
    },
  ];
  const entryUnavailableMessage = !event
    ? ""
    : !event.registrationOpen
      ? "This live competition is visible, but registration is closed."
      : event.drawLocked
        ? "This live competition is visible, but entries are blocked while the draw is locked."
        : "";
  const contestant = data?.contestants.find((item) => item.id === contestantId);
  const waiverContestant = data?.contestants.find(
    (item) => item.id === waiverContestantId,
  );
  const supportedModes = supportedRegistrationDeskModes(event);
  const minimumDraws = event ? minimumDrawEntries(event) : 1;
  const workspace = data ? asWorkspace(data) : null;
  const workspaceEvent = workspace?.events.find((item) => item.id === eventId);
  const roleCapacities = workspaceEvent
    ? {
        Header: roundRobinRoleCapacity(workspaceEvent, data?.registrations ?? [], "Header"),
        Heeler: roundRobinRoleCapacity(workspaceEvent, data?.registrations ?? [], "Heeler"),
      }
    : null;
  const headerCandidates = useMemo(
    () =>
      event && data
        ? registrationDeskRoleCandidates(
            data.contestants,
            event,
            data.registrations,
            "Header",
          )
        : [],
    [data, event],
  );
  const heelerCandidates = useMemo(
    () =>
      event && data
        ? registrationDeskRoleCandidates(
            data.contestants,
            event,
            data.registrations,
            "Heeler",
          )
        : [],
    [data, event],
  );
  const payerCandidates = useMemo(
    () => registrationDeskPayerCandidates(teamRows, data?.contestants ?? []),
    [data?.contestants, teamRows],
  );
  const totals = registrationDeskTotals(
    entryMode || "draws",
    entries,
    teamRows,
    Number(event?.entryFee ?? 0),
  );
  const pickedPairError = useMemo(() => {
    if (!event || event.allowRepeatPartners) return "";
    const pairs = new Set<string>();
    for (const row of teamRows) {
      if (!row.headerId || !row.heelerId) continue;
      const pair = `${row.headerId}\0${row.heelerId}`;
      if (
        pairs.has(pair) ||
        data?.teams.some(
          (team) =>
            team.eventId === event.id &&
            Number(team.round) === 1 &&
            !team.generated &&
            !team.scratched &&
            team.headerId === row.headerId &&
            team.heelerId === row.heelerId,
        )
      ) {
        return "That partnership is already entered.";
      }
      pairs.add(pair);
    }
    return "";
  }, [data?.teams, event, teamRows]);
  const drawEligible =
    Boolean(workspaceEvent && contestant) &&
    contestantEligibleForRole(workspaceEvent!, contestant, role);

  useEffect(() => {
    setEntries(minimumDraws);
  }, [eventId, minimumDraws]);

  useEffect(() => {
    if (!event) return;
    setEntryMode(defaultRegistrationDeskMode(event));
    setTeamRows([createRegistrationDeskTeamRow()]);
    setPayerContestantId("");
    setPaymentMethod("");
    setReview(false);
    setSubmissionId("");
    setWaiverContestantId("");
    setWaiverError("");
  }, [event?.id]);

  useEffect(() => {
    if (
      payerContestantId &&
      !payerCandidates.some(({ id }) => id === payerContestantId)
    ) {
      setPayerContestantId("");
      setReview(false);
      setSubmissionId("");
    }
  }, [payerCandidates, payerContestantId]);

  useEffect(() => {
    setPaymentMethod("");
    setReview(false);
    setSubmissionId("");
  }, [contestantId, entries, entryHorseName, role]);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredContestants =
    normalizedSearch.length < 2
      ? []
      : (data?.contestants ?? []).filter((item) =>
          `${item.name} ${item.email ?? ""} ${item.phone}`
            .toLowerCase()
            .includes(normalizedSearch),
        );
  const eligibleRoles = workspaceEvent
    ? (["Header", "Heeler"] as const).filter((value) =>
        contestantEligibleForRole(workspaceEvent, contestant, value) &&
        !roleCapacities?.[value].full,
      )
    : [];

  useEffect(() => {
    if (eligibleRoles.length && !eligibleRoles.includes(role)) {
      setRole(eligibleRoles[0]);
    }
  }, [eligibleRoles, role]);

  const editProfile = (item?: Contestant) => {
    setHorseName("");
    setProfile(
      item
        ? {
            id: item.id,
            name: item.name,
            role: item.role,
            headerHandicap: item.headerHandicap,
            heelerHandicap: item.heelerHandicap,
            phone: item.phone,
            email: item.email ?? "",
            hometown: item.hometown,
            horses: item.horses ?? [],
          }
        : emptyContestant(),
    );
    setProfileOpen(true);
    setMessage("");
  };

  useEffect(() => {
    if (profileOpen && !profile.id) {
      addContestantNameRef.current?.focus();
    }
  }, [profile.id, profileOpen]);

  const saveProfile = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const normalizedProfile = {
        ...profile,
        name: profile.name.trim().replace(/\s+/g, " ").toUpperCase(),
        email: profile.email.trim().toLowerCase(),
        hometown: profile.hometown.trim().replace(/\s+/g, " ").toUpperCase(),
        horses: (profile.horses ?? []).map((horse) =>
          horse.trim().replace(/\s+/g, " ").toUpperCase(),
        ),
      };
      if (embedded) {
        const result = await saveRegistrationDeskContestant(normalizedProfile);
        if (!result) throw new Error("The contestant profile was not saved.");
        setData(normalizeRegistrationDeskData(result.data));
        setContestantId(result.contestant.id);
      } else {
        const workspaceData = loadLocalRegistrationWorkspace();
        const result = upsertRegistrationDeskContestant(workspaceData, normalizedProfile);
        saveLocalRegistrationWorkspace(result.data);
        setData(registrationDeskProjection(result.data));
        setContestantId(result.contestant.id);
      }
      setPinOpen(false);
      setPin("");
      setPinConfirmation("");
      setProfileOpen(false);
      setMessage("Contestant profile saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The profile could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const profileEditor = (
    <>
      <div className="registration-desk-panel-heading">
        <div>
          <span>Contestant database</span>
          <h2>{profile.id ? "Edit contestant" : "Add contestant"}</h2>
        </div>
        <button type="button" onClick={() => setProfileOpen(false)}>
          Cancel
        </button>
      </div>
      <form className="registration-profile-form" onSubmit={saveProfile}>
        <label>Full name<input ref={addContestantNameRef} required maxLength={100} autoCapitalize="characters" value={profile.name} onChange={(change) => setProfile({ ...profile, name: change.target.value.toUpperCase() })} /></label>
        <label>Roping position<select value={profile.role} onChange={(change) => setProfile({ ...profile, role: change.target.value as Contestant["role"] })}><option>Both</option><option>Header</option><option>Heeler</option></select></label>
        <label>Header handicap<input required type="number" min={0} max={20} step={0.5} value={profile.headerHandicap} onChange={(change) => setProfile({ ...profile, headerHandicap: Number(change.target.value) })} /></label>
        <label>Heeler handicap<input required type="number" min={0} max={20} step={0.5} value={profile.heelerHandicap} onChange={(change) => setProfile({ ...profile, heelerHandicap: Number(change.target.value) })} /></label>
        <label>Email<input type="email" value={profile.email} onChange={(change) => setProfile({ ...profile, email: change.target.value.toLowerCase() })} /></label>
        <label>Phone<input type="tel" value={profile.phone} onChange={(change) => setProfile({ ...profile, phone: change.target.value })} /></label>
        <label>Hometown<input autoCapitalize="characters" value={profile.hometown} onChange={(change) => setProfile({ ...profile, hometown: change.target.value.toUpperCase() })} /></label>
        <div className="registration-horse-editor">
          <span>Horses</span>
          <div className="horse-entry">
            <input
              maxLength={100}
              value={horseName}
              autoCapitalize="characters"
              onChange={(change) => setHorseName(change.target.value.toUpperCase())}
              placeholder="Horse name"
            />
            <button
              type="button"
              onClick={() => {
                const name = horseName.trim().replace(/\s+/g, " ").toUpperCase();
                if (
                  !name ||
                  (profile.horses ?? []).length >= 20 ||
                  (profile.horses ?? []).some((horse) => horse.toLowerCase() === name.toLowerCase())
                ) return;
                setProfile({ ...profile, horses: [...(profile.horses ?? []), name] });
                setHorseName("");
              }}
            >
              <Plus size={15} /> Add horse
            </button>
          </div>
          <div className="horse-list">
            {(profile.horses ?? []).map((horse) => (
              <span key={horse}>
                <strong>{horse}</strong>
                <button
                  type="button"
                  title={`Delete ${horse}`}
                  onClick={() =>
                    setProfile({
                      ...profile,
                      horses: (profile.horses ?? []).filter((name) => name !== horse),
                    })
                  }
                >
                  <Trash2 size={14} />
                </button>
              </span>
            ))}
            {!(profile.horses ?? []).length && <small>No horses added.</small>}
          </div>
        </div>
        <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save contestant"}</button>
      </form>
    </>
  );

  const savePin = async () => {
    if (!contestant) return;
    if (!/^\d{4}$/.test(pin) || pin !== pinConfirmation) {
      setMessage("Enter the same four-digit PIN twice.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (!embedded) {
        throw new Error(
          "PIN setup is available when the Registration Desk is connected to Wix.",
        );
      }
      const result = await setRegistrationDeskContestantPin(contestant.id, pin);
      if (!result?.configured) throw new Error("The contestant PIN was not saved.");
      setPin("");
      setPinConfirmation("");
      setPinOpen(false);
      setMessage(`Four-digit PIN set for ${contestant.name}.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The PIN could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const invalidateReview = () => {
    setReview(false);
    setSubmissionId("");
  };

  const updateTeamRow = (
    rowId: string,
    patch: Partial<RegistrationDeskTeamRow>,
  ) => {
    setTeamRows((current) =>
      current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)),
    );
    invalidateReview();
  };

  const finishSignup = async (request: RegistrationDeskSignupRequest) => {
    if (!event) return;
    try {
      if (embedded) {
        const result = await submitRegistrationDeskSignup(request);
        if (!result) throw new Error("The entry was not saved.");
        setData(normalizeRegistrationDeskData(result.data));
        setMessage(result.summary);
      } else {
        const workspaceData = loadLocalRegistrationWorkspace();
        const result = submitLocalRegistrationDeskSignup(workspaceData, request);
        saveLocalRegistrationWorkspace(result.data);
        setData(registrationDeskProjection(result.data));
        setMessage(result.result.summary);
      }
      setEntries(minimumDraws);
      setEntryHorseName("");
      setTeamRows([createRegistrationDeskTeamRow()]);
      setPayerContestantId("");
      setPaymentMethod("");
      setReview(false);
      setSubmissionId("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The entry could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const beginReview = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (entryUnavailableMessage) {
      setMessage(entryUnavailableMessage);
      return;
    }
    if (!event || !paymentMethod || !entryMode) return;
    const complete = registrationDeskReviewComplete(entryMode, {
      contestantId: contestant?.id,
      role,
      entries,
      minimumEntries: minimumDraws,
      maximumEntries: event.entriesAllowed,
      rows: teamRows,
      payerContestantId:
        entryMode === "draws" ? contestant?.id ?? "" : payerContestantId,
      paymentMethod,
    });
    if (!complete || pickedPairError) {
      setMessage(
        entryMode === "picked-teams"
          ? pickedPairError ||
              pickedTeamRowsError(teamRows, payerContestantId) ||
              "Complete every team and choose its payer and payment method."
          : "Complete the draw entry before review.",
      );
      return;
    }
    setSubmissionId(
      window.crypto.randomUUID?.() ??
        `desk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    setReview(true);
    setMessage("");
  };

  const submitEntry = () => {
    if (
      !event ||
      !paymentMethod ||
      !entryMode ||
      !submissionId ||
      (entryMode === "draws" && !contestant)
    ) {
      return;
    }
    const request =
      entryMode === "draws"
        ? buildRegistrationDeskDrawRequest({
            submissionId,
            eventId: event.id,
            contestantId: contestant!.id,
            horseName: entryHorseName,
            role,
            entries,
            paymentMethod,
          })
        : buildRegistrationDeskPickedTeamsRequest({
            submissionId,
            eventId: event.id,
            rows: teamRows,
            payerContestantId,
            paymentMethod,
          });
    setBusy(true);
    setMessage("");
    void finishSignup(request);
  };

  const beginRosterEntryEdit = (entry: RegistrationDeskRosterEntry) => {
    setRosterEntryEdit({
      key: entry.key,
      eventId: entry.eventId,
      recordType: entry.recordType,
      recordId: entry.recordId,
      role: entry.role,
      entries: entry.entries ?? 1,
      horseName: entry.horseName ?? "",
      paid: entry.paid === true,
      paymentMethod: entry.paymentMethod ?? "",
    });
    setMessage("");
  };

  const saveRosterEntry = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!rosterEntryEdit || !event || rosterEntryEdit.eventId !== event.id) {
      setMessage("Choose the competition that owns this entry before editing it.");
      return;
    }
    if (!embedded) {
      setMessage("Entry editing requires the secured Wix Registration Desk.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await updateRegistrationDeskEntry({
        eventId: event.id,
        recordType: rosterEntryEdit.recordType,
        recordId: rosterEntryEdit.recordId,
        patch: registrationDeskEntryPatch(rosterEntryEdit),
      });
      if (!result) throw new Error("The competition entry was not updated.");
      setData(normalizeRegistrationDeskData(result.data));
      setRosterEntryEdit(null);
      setMessage(result.summary);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The entry could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  };

  const scratchRosterEntry = async (entry: RegistrationDeskRosterEntry) => {
    if (!event || entry.eventId !== event.id) {
      setMessage("Choose the competition that owns this entry before deleting it.");
      return;
    }
    const target =
      entry.recordType === "team"
        ? `${entry.name}'s whole team entry`
        : `${entry.name}'s ${entry.role.toLowerCase()} registration`;
    if (
      !window.confirm(
        `Delete ${target} from this competition? It will be scratched and retained in the audit history.`,
      )
    ) {
      return;
    }
    if (!embedded) {
      setMessage("Entry deletion requires the secured Wix Registration Desk.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await scratchRegistrationDeskEntry({
        ...registrationDeskScratchRequest(entry, event.id),
      });
      if (!result) throw new Error("The competition entry was not scratched.");
      setData(normalizeRegistrationDeskData(result.data));
      setRosterEntryEdit((current) =>
        current?.recordId === entry.recordId &&
        current.recordType === entry.recordType
          ? null
          : current,
      );
      setMessage(result.summary);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The entry could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  };

  const launchWaiver = (targetContestantId: string) => {
    if (!event || !data) {
      setMessage("Choose a live competition before opening a waiver.");
      return;
    }
    if (!data.contestants.some(({ id }) => id === targetContestantId)) {
      setMessage("Choose a valid contestant before opening a waiver.");
      return;
    }
    setWaiverContestantId(targetContestantId);
    setWaiverError("");
    setMessage("");
  };

  const signWaiver = async ({
    signerName,
    signatureDataUrl,
  }: {
    signerName: string;
    signatureDataUrl: string;
  }) => {
    if (!event || !data || !waiverContestant) {
      throw new Error("Choose a contestant and live competition.");
    }
    setWaiverBusy(true);
    setWaiverError("");
    try {
      const request = {
        eventId: event.id,
        contestantId: waiverContestant.id,
        signerName,
        signatureDataUrl,
        accepted: true as const,
      };
      const result = embedded
        ? await submitRegistrationDeskWaiver(request)
        : submitLocalRegistrationDeskWaiver(data, request);
      if (!result) throw new Error("The waiver signature was not saved.");
      setData(normalizeRegistrationDeskData(result.data));
      setWaiverContestantId("");
      setMessage(
        `Waiver signed for ${result.signature.contestantName} at ${formatWaiverSignedAt(
          result.signature.signedAt,
        )}.`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "The waiver signature could not be saved.";
      setWaiverError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setWaiverBusy(false);
    }
  };

  return (
    <div className="registration-desk">
      <header className="registration-desk-header">
        <div>
          <span className="eyebrow">Restricted workspace</span>
          <h1><ClipboardPen /> Registration Desk</h1>
          <p>Contestant profiles and event entries only.</p>
        </div>
        <a href={registrationDeskWorkspaceHref(window.location.href)}>
          <ArrowLeft size={17} /> Return to Workspace
        </a>
      </header>
      <main className="registration-desk-main">
        <section className="registration-desk-events">
          <label>
            Live competition
            <select value={eventId} onChange={(change) => {
              setEventId(change.target.value);
              setPinOpen(false);
              setPin("");
              setPinConfirmation("");
              setRosterEntryEdit(null);
              setWaiverContestantId("");
              setWaiverError("");
              setMessage("");
            }}>
              {(data?.events ?? []).map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {item.date} · {competitionName(item.competitionType)}
                </option>
              ))}
            </select>
          </label>
          {event && supportedModes.length > 0 && (
            <fieldset className="registration-entry-modes">
              <legend>Entry choice</legend>
              {supportedModes.map((mode) => (
                <label className={entryMode === mode ? "selected" : ""} key={mode}>
                  <input
                    type="radio"
                    name="registration-entry-mode"
                    checked={entryMode === mode}
                    onChange={() => {
                      setEntryMode(mode);
                      setTeamRows([createRegistrationDeskTeamRow()]);
                      setEntries(minimumDraws);
                      setEntryHorseName("");
                      setPayerContestantId("");
                      setPaymentMethod("");
                      setReview(false);
                      setSubmissionId("");
                      setMessage("");
                    }}
                  />
                  <strong>{mode === "draws" ? "Enter Draws" : "Pick Teams"}</strong>
                  <small>
                    {mode === "draws"
                      ? "Add standalone draw entries."
                      : "Build one or more complete Header / Heeler teams."}
                  </small>
                </label>
              ))}
            </fieldset>
          )}
          {!data && <p>Loading registration desk…</p>}
          {data && !data.events.length && (
            <p>No live competitions are currently available.</p>
          )}
          {entryUnavailableMessage && <p>{entryUnavailableMessage}</p>}
          {data && !data.waiverDocument.available && (
            <p className="registration-waiver-setup-message" role="status">
              <strong>Waiver signing setup required.</strong>{" "}
              Configure the authoritative waiver title, version, and legal text
              in the Registration Desk backend. Signing remains disabled until
              that document is available.
            </p>
          )}
        </section>

        {data && (
          <section
            className="registration-desk-roster"
            aria-labelledby="registration-desk-roster-heading"
          >
            <div className="registration-desk-roster-heading">
              <div>
                <span>Current signups</span>
                <h2 id="registration-desk-roster-heading">
                  Competition roster
                </h2>
              </div>
            </div>
            {event && waiverParticipants.length > 0 && (
              <section
                className="registration-waiver-roster"
                aria-labelledby="registration-waiver-roster-heading"
              >
                <div>
                  <h3 id="registration-waiver-roster-heading">
                    Participant waivers
                  </h3>
                  <p>
                    Each contestant is listed once for this competition,
                    including riders entered on multiple picked teams.
                  </p>
                </div>
                <ul>
                  {waiverParticipants.map((participant) => (
                    <li key={participant.contestantId}>
                      <strong>{participant.name}</strong>
                      <WaiverStatusControl
                        contestantName={participant.name}
                        signature={registrationDeskWaiverSignature(
                          data,
                          event.id,
                          participant.contestantId,
                        )}
                        available={data.waiverDocument.available}
                        disabled={busy || waiverBusy}
                        onSign={() => launchWaiver(participant.contestantId)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {!event ? (
              <p className="registration-desk-roster-empty">
                Choose a live competition to view its roster.
              </p>
            ) : (
              <div className="registration-desk-roster-groups">
                {rosterSections.map((section) => {
                  const headingId = `registration-roster-${section.id}`;
                  return (
                    <section
                      className="registration-desk-roster-group"
                      aria-labelledby={headingId}
                      key={section.id}
                    >
                      <div className="registration-desk-roster-role-heading">
                        <h3 id={headingId}>{section.title}</h3>
                        <strong>{section.entries.length}</strong>
                      </div>
                      {!section.entries.length ? (
                        <p>No {section.title.toLowerCase()} are signed up.</p>
                      ) : (
                        <ul>
                          {section.entries.map((rosterEntry) => {
                            const editing = rosterEntryEdit?.key === rosterEntry.key;
                            const permissions = registrationDeskEntryPermissions(
                              event,
                              embedded,
                              rosterEntry.generated,
                            );
                            const editDisabled = busy || !permissions.canEdit;
                            const scratchDisabled = busy || !permissions.canScratch;
                            return (
                              <li key={rosterEntry.key}>
                                <div className="registration-roster-entry-summary">
                                  <div>
                                    <strong>{rosterEntry.name}</strong>
                                    <span>
                                      {rosterEntry.recordType === "registration"
                                        ? `${rosterEntry.entries ?? 1} ${
                                            (rosterEntry.entries ?? 1) === 1
                                              ? "entry"
                                              : "entries"
                                          }`
                                        : `Team${
                                            rosterEntry.partnerName
                                              ? ` with ${rosterEntry.partnerName}`
                                              : ""
                                          }`}
                                      {" · "}Handicap {rosterEntry.handicap}
                                      {rosterEntry.horseName
                                        ? ` · ${rosterEntry.horseName}`
                                        : ""}
                                      {rosterEntry.payerName
                                        ? ` · Payer: ${rosterEntry.payerName}${
                                            rosterEntry.paymentMethod === "tab"
                                              ? " (tab)"
                                              : ""
                                          }`
                                        : ""}
                                    </span>
                                  </div>
                                  <div className="registration-roster-entry-actions">
                                    <button
                                      type="button"
                                      disabled={editDisabled}
                                      title={
                                        rosterEntry.generated
                                          ? "Generated draw teams must be scratched as a whole team."
                                          : editDisabled
                                            ? "Editing requires an open, unlocked live competition in Wix."
                                            : `Edit ${rosterEntry.name}'s ${rosterEntry.role.toLowerCase()} entry`
                                      }
                                      onClick={() => beginRosterEntryEdit(rosterEntry)}
                                    >
                                      <Pencil size={13} /> Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="danger"
                                      disabled={scratchDisabled}
                                      title={
                                        scratchDisabled
                                          ? "Deleting requires a live competition in Wix."
                                          : `Scratch ${rosterEntry.name}'s ${
                                              rosterEntry.recordType === "team"
                                                ? "whole team"
                                                : rosterEntry.role.toLowerCase()
                                            } entry`
                                      }
                                      onClick={() => void scratchRosterEntry(rosterEntry)}
                                    >
                                      <Trash2 size={13} /> Delete
                                    </button>
                                  </div>
                                </div>
                                {editing && rosterEntryEdit && (
                                  <form
                                    className="registration-roster-entry-editor"
                                    onSubmit={saveRosterEntry}
                                  >
                                    {rosterEntry.recordType === "registration" && (
                                      <>
                                        <label>
                                          Position
                                          <select
                                            value={rosterEntryEdit.role}
                                            onChange={(change) =>
                                              setRosterEntryEdit({
                                                ...rosterEntryEdit,
                                                role: change.target.value as
                                                  | "Header"
                                                  | "Heeler",
                                              })
                                            }
                                          >
                                            <option>Header</option>
                                            <option>Heeler</option>
                                          </select>
                                        </label>
                                        <label>
                                          Entries
                                          <input
                                            required
                                            type="number"
                                            min={1}
                                            max={event.entriesAllowed}
                                            value={rosterEntryEdit.entries}
                                            onChange={(change) =>
                                              setRosterEntryEdit({
                                                ...rosterEntryEdit,
                                                entries: Number(change.target.value),
                                              })
                                            }
                                          />
                                        </label>
                                      </>
                                    )}
                                    <label>
                                      Horse
                                      <input
                                        maxLength={100}
                                        value={rosterEntryEdit.horseName}
                                        onChange={(change) =>
                                          setRosterEntryEdit({
                                            ...rosterEntryEdit,
                                            horseName: change.target.value.toUpperCase(),
                                          })
                                        }
                                      />
                                    </label>
                                    <label>
                                      Payment method
                                      <select
                                        value={rosterEntryEdit.paymentMethod}
                                        onChange={(change) =>
                                          setRosterEntryEdit({
                                            ...rosterEntryEdit,
                                            paymentMethod: change.target.value as
                                              | ""
                                              | "cash"
                                              | "card"
                                              | "tab",
                                          })
                                        }
                                      >
                                        <option value="">Not recorded</option>
                                        <option value="cash">Cash</option>
                                        <option value="card">Credit card</option>
                                        <option value="tab">Open tab</option>
                                      </select>
                                    </label>
                                    <label className="registration-roster-paid">
                                      <input
                                        type="checkbox"
                                        checked={rosterEntryEdit.paid}
                                        onChange={(change) =>
                                          setRosterEntryEdit({
                                            ...rosterEntryEdit,
                                            paid: change.target.checked,
                                          })
                                        }
                                      />
                                      Payment received
                                    </label>
                                    <div className="registration-roster-editor-actions">
                                      <button
                                        type="button"
                                        onClick={() => setRosterEntryEdit(null)}
                                      >
                                        Cancel
                                      </button>
                                      <button className="primary" disabled={busy}>
                                        {busy ? "Saving…" : "Save entry"}
                                      </button>
                                    </div>
                                  </form>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {event && data && entryMode && (
          <div className="registration-desk-columns">
            <section className="registration-desk-panel">
              <div className="registration-desk-panel-heading">
                <div>
                  <span>Step 1</span>
                  <h2>{entryMode === "draws" ? "Choose contestant" : "Build teams"}</h2>
                </div>
                <button type="button" onClick={() => editProfile()}>
                  <Plus size={16} /> Add contestant
                </button>
              </div>
              {showStandaloneRegistrationProfile(
                profileOpen,
                profile.id,
                entryMode === "draws" ? contestant?.id : undefined,
              ) && (
                <section
                  id="registration-add-contestant"
                  className="registration-add-profile"
                  aria-label="Add contestant"
                >
                  {profileEditor}
                </section>
              )}
              {entryMode === "draws" ? (
                <>
                  <label className="registration-search">
                    <Search size={17} />
                    <input
                      value={search}
                      onChange={(change) => setSearch(change.target.value)}
                      placeholder="Search name, email, or phone"
                    />
                  </label>
                  <div className="registration-contestant-list">
                    {filteredContestants.slice(0, 80).map((item) => (
                      <button
                        type="button"
                        className={contestantId === item.id ? "selected" : ""}
                        onClick={() => {
                          setContestantId(item.id);
                          setEntryHorseName("");
                          setSearch("");
                          setPinOpen(false);
                          setPin("");
                          setPinConfirmation("");
                          setMessage("");
                        }}
                        key={item.id}
                      >
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.email || item.phone || "No contact information"}</small>
                        </span>
                      </button>
                    ))}
                    {normalizedSearch.length < 2 && (
                      <p className="registration-search-hint">
                        Enter at least two letters, an email, or a phone number.
                      </p>
                    )}
                    {normalizedSearch.length >= 2 && !filteredContestants.length && (
                      <p className="registration-search-hint">No contestants match that search.</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="registration-team-builder">
                  <div className="registration-team-rows">
                    {teamRows.map((row, index) => {
                      const header = data.contestants.find(({ id }) => id === row.headerId);
                      const heeler = data.contestants.find(({ id }) => id === row.heelerId);
                      return (
                        <fieldset className="registration-team-row" key={row.rowId}>
                          <legend>Team {index + 1}</legend>
                          <label>
                            Header
                            <select
                              value={row.headerId}
                              onChange={(change) =>
                                updateTeamRow(row.rowId, {
                                  headerId: change.target.value,
                                  headerHorseName: "",
                                })
                              }
                            >
                              <option value="">Choose Header</option>
                              {headerCandidates
                                .filter(
                                  (candidate) =>
                                    candidate.id !== row.heelerId &&
                                    (!heeler ||
                                      Number(candidate.headerHandicap) +
                                        Number(heeler.heelerHandicap) <=
                                        Number(event.handicapTotal)),
                                )
                                .map((candidate) => (
                                  <option value={candidate.id} key={candidate.id}>
                                    {candidate.name} · #{candidate.headerHandicap}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            Header horse
                            <select
                              disabled={!header?.horses?.length}
                              value={row.headerHorseName}
                              onChange={(change) =>
                                updateTeamRow(row.rowId, {
                                  headerHorseName: change.target.value,
                                })
                              }
                            >
                              <option value="">No horse selected</option>
                              {header?.horses?.map((horse) => (
                                <option value={horse} key={horse}>{horse}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Heeler
                            <select
                              value={row.heelerId}
                              onChange={(change) =>
                                updateTeamRow(row.rowId, {
                                  heelerId: change.target.value,
                                  heelerHorseName: "",
                                })
                              }
                            >
                              <option value="">Choose Heeler</option>
                              {heelerCandidates
                                .filter(
                                  (candidate) =>
                                    candidate.id !== row.headerId &&
                                    (!header ||
                                      Number(header.headerHandicap) +
                                        Number(candidate.heelerHandicap) <=
                                        Number(event.handicapTotal)),
                                )
                                .map((candidate) => (
                                  <option value={candidate.id} key={candidate.id}>
                                    {candidate.name} · #{candidate.heelerHandicap}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            Heeler horse
                            <select
                              disabled={!heeler?.horses?.length}
                              value={row.heelerHorseName}
                              onChange={(change) =>
                                updateTeamRow(row.rowId, {
                                  heelerHorseName: change.target.value,
                                })
                              }
                            >
                              <option value="">No horse selected</option>
                              {heeler?.horses?.map((horse) => (
                                <option value={horse} key={horse}>{horse}</option>
                              ))}
                            </select>
                          </label>
                          {teamRows.length > 1 && (
                            <button
                              type="button"
                              className="registration-remove-team"
                              onClick={() => {
                                setTeamRows((current) =>
                                  current.filter(({ rowId }) => rowId !== row.rowId),
                                );
                                invalidateReview();
                              }}
                            >
                              <Trash2 size={15} /> Remove team
                            </button>
                          )}
                        </fieldset>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="registration-add-team"
                    disabled={teamRows.length >= 100}
                    onClick={() => {
                      setTeamRows((current) => [
                        ...current,
                        createRegistrationDeskTeamRow(),
                      ]);
                      invalidateReview();
                    }}
                  >
                    <Plus size={16} /> Add another team
                  </button>
                </div>
              )}
            </section>

            <section className="registration-desk-panel">
              <div className="registration-desk-panel-heading">
                <div><span>Step 2</span><h2>Payment and review</h2></div>
              </div>
              {entryMode === "draws" && !contestant ? (
                <div className="registration-desk-empty">
                  <UserRoundPlus />
                  <p>Choose a contestant to prepare an entry.</p>
                </div>
              ) : (
                <div className="registration-entry-form">
                  {entryMode === "draws" && contestant && (
                    <>
                      <div className="registration-selected-contestant">
                        <CheckCircle2 />
                        <span>Registering <strong>{contestant.name}</strong></span>
                      </div>
                      <WaiverStatusControl
                        contestantName={contestant.name}
                        signature={registrationDeskWaiverSignature(
                          data,
                          event.id,
                          contestant.id,
                        )}
                        available={data.waiverDocument.available}
                        disabled={busy || waiverBusy}
                        onSign={() => launchWaiver(contestant.id)}
                      />
                      <div className="registration-contestant-actions">
                        <button type="button" onClick={() => editProfile(contestant)}>
                          <Pencil size={15} /> Edit contestant
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPinOpen((open) => !open);
                            setMessage("");
                          }}
                        >
                          <KeyRound size={15} /> Set 4-digit PIN
                        </button>
                      </div>
                      {pinOpen && (
                        <fieldset className="registration-pin-panel">
                          <legend>Contestant login PIN</legend>
                          <label>
                            New 4-digit PIN
                            <input
                              required
                              type="password"
                              inputMode="numeric"
                              pattern="\d{4}"
                              maxLength={4}
                              value={pin}
                              onChange={(change) =>
                                setPin(change.target.value.replace(/\D/g, "").slice(0, 4))
                              }
                            />
                          </label>
                          <label>
                            Confirm PIN
                            <input
                              required
                              type="password"
                              inputMode="numeric"
                              pattern="\d{4}"
                              maxLength={4}
                              value={pinConfirmation}
                              onChange={(change) =>
                                setPinConfirmation(
                                  change.target.value.replace(/\D/g, "").slice(0, 4),
                                )
                              }
                            />
                          </label>
                          <button type="button" disabled={busy} onClick={() => void savePin()}>
                            {busy ? "Saving…" : "Save PIN"}
                          </button>
                        </fieldset>
                      )}
                      {profileOpen && profile.id === contestant.id && (
                        <section className="registration-inline-profile">{profileEditor}</section>
                      )}
                    </>
                  )}
                  <form className="registration-competition-form" onSubmit={beginReview}>
                    {!review ? (
                      <>
                        {entryMode === "draws" && contestant ? (
                          <>
                            <label>
                              Horse
                              <select
                                disabled={!contestant.horses?.length}
                                value={entryHorseName}
                                onChange={(change) => setEntryHorseName(change.target.value)}
                              >
                                <option value="">No horse selected</option>
                                {contestant.horses?.map((horse) => (
                                  <option value={horse} key={horse}>{horse}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Position
                              <select
                                value={role}
                                onChange={(change) =>
                                  setRole(change.target.value as "Header" | "Heeler")
                                }
                              >
                                {eligibleRoles.map((value) => (
                                  <option key={value}>{value}</option>
                                ))}
                              </select>
                            </label>
                            {workspaceEvent?.competitionType === "round-robin" && roleCapacities && (
                              <p className="registration-entry-hint">
                                {(["Header", "Heeler"] as const).map((value) => {
                                  const capacity = roleCapacities[value];
                                  return `${value}: ${capacity.registered}${
                                    capacity.maximum === null
                                      ? " registered"
                                      : ` of ${capacity.maximum}${capacity.full ? " - FULL" : ""}`
                                  }`;
                                }).join(" · ")}
                              </p>
                            )}
                            <label>
                              Number of entries
                              <input
                                type="number"
                                min={minimumDraws}
                                max={event.entriesAllowed}
                                value={entries}
                                onChange={(change) => setEntries(Number(change.target.value))}
                              />
                              <small>Competition minimum: {minimumDraws}</small>
                            </label>
                            {!drawEligible && (
                              <p className="registration-entry-hint">
                                This contestant is not eligible for this position.
                              </p>
                            )}
                            <label>
                              Payer
                              <input value={contestant.name} readOnly />
                            </label>
                          </>
                        ) : (
                          <label>
                            Batch payer
                            <select
                              required
                              value={payerContestantId}
                              onChange={(change) => {
                                setPayerContestantId(change.target.value);
                                invalidateReview();
                              }}
                            >
                              <option value="">Choose a rider in these teams</option>
                              {payerCandidates.map((candidate) => (
                                <option value={candidate.id} key={candidate.id}>
                                  {candidate.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {pickedPairError && (
                          <p className="registration-entry-hint">{pickedPairError}</p>
                        )}
                        <fieldset className="registration-payment-method">
                          <legend>Cashier payment selection</legend>
                          {([
                            ["cash", Banknote, "Paid in cash", `${formatMoney(totals.amount)} received by cashier`],
                            ["card", CreditCard, "Paid with credit card", `Charge ${formatMoney(totals.amount)} on the Square Terminal first`],
                            ["tab", ClipboardPen, "Open a tab", `Add ${formatMoney(totals.amount)} to the selected payer's balance`],
                          ] as const).map(([method, Icon, title, detail]) => (
                            <label className={paymentMethod === method ? "selected" : ""} key={method}>
                              <input
                                type="radio"
                                name="paymentMethod"
                                checked={paymentMethod === method}
                                onChange={() => {
                                  setPaymentMethod(method);
                                  invalidateReview();
                                }}
                              />
                              <Icon />
                              <span><strong>{title}</strong><small>{detail}</small></span>
                            </label>
                          ))}
                        </fieldset>
                        {paymentMethod && (
                          <button
                            className="primary"
                            disabled={
                              busy ||
                              Boolean(entryUnavailableMessage) ||
                              (entryMode === "draws" &&
                                (!drawEligible || !eligibleRoles.length)) ||
                              Boolean(pickedPairError) ||
                              !registrationDeskReviewComplete(entryMode, {
                                contestantId: contestant?.id,
                                role,
                                entries,
                                minimumEntries: minimumDraws,
                                maximumEntries: event.entriesAllowed,
                                rows: teamRows,
                                payerContestantId:
                                  entryMode === "draws"
                                    ? contestant?.id ?? ""
                                    : payerContestantId,
                                paymentMethod,
                              })
                            }
                          >
                            Review entry
                          </button>
                        )}
                      </>
                    ) : (
                      <section className="registration-entry-receipt" aria-label="Final entry review">
                        <div className="registration-receipt-heading">
                          <span>Final review</span>
                          <strong>{event.name}</strong>
                        </div>
                        {entryMode === "picked-teams" ? (
                          <div className="registration-review-teams">
                            {teamRows.map((row, index) => {
                              const header = data.contestants.find(({ id }) => id === row.headerId);
                              const heeler = data.contestants.find(({ id }) => id === row.heelerId);
                              return (
                                <div key={row.rowId}>
                                  <strong>Team {index + 1}</strong>
                                  <span>
                                    {header?.name}{row.headerHorseName ? ` (${row.headerHorseName})` : ""}
                                    {" / "}
                                    {heeler?.name}{row.heelerHorseName ? ` (${row.heelerHorseName})` : ""}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p>
                            {contestant?.name} · {role} · {entries} entr{entries === 1 ? "y" : "ies"}
                            {entryHorseName ? ` · ${entryHorseName}` : ""}
                          </p>
                        )}
                        <dl>
                          <div>
                            <dt>Payer</dt>
                            <dd>
                              {entryMode === "draws"
                                ? contestant?.name
                                : payerCandidates.find(({ id }) => id === payerContestantId)?.name}
                            </dd>
                          </div>
                          <div><dt>Payment</dt><dd>{paymentMethod}</dd></div>
                          <div><dt>Run count</dt><dd>{totals.runCount}</dd></div>
                          <div><dt>Entry fee</dt><dd>{formatMoney(event.entryFee)}</dd></div>
                          <div className="registration-receipt-total-due">
                            <dt>Amount</dt><dd>{formatMoney(totals.amount)}</dd>
                          </div>
                        </dl>
                        <div className="registration-review-actions">
                          <button
                            type="button"
                            onClick={() => {
                              setReview(false);
                              setSubmissionId("");
                            }}
                          >
                            Back / Edit
                          </button>
                          <button
                            type="button"
                            className="primary"
                            disabled={busy}
                            onClick={submitEntry}
                          >
                            {busy ? "Sending…" : "Send to Draw Desk"}
                          </button>
                        </div>
                      </section>
                    )}
                  </form>
                </div>
              )}
            </section>
          </div>
        )}

        {message && <p className="registration-desk-message" role="status">{message}</p>}
      </main>
      {data && event && waiverContestant && (
        <RegistrationDeskWaiverDialog
          key={`${event.id}:${waiverContestant.id}`}
          contestantName={waiverContestant.name}
          eventName={event.name}
          waiverDocument={data.waiverDocument}
          busy={waiverBusy}
          error={waiverError}
          onCancel={() => {
            if (waiverBusy) return;
            setWaiverContestantId("");
            setWaiverError("");
          }}
          onSubmit={signWaiver}
        />
      )}
    </div>
  );
}
