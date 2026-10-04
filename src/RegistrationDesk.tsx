import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Banknote,
  Camera,
  CheckCircle2,
  ClipboardPen,
  CreditCard,
  ImagePlus,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRoundPlus,
  Users,
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
  type RegistrationDeskWaiverStatus,
} from "./registrationDeskData";
import {
  buildRegistrationDeskDrawRequest,
  buildRegistrationDeskPickedTeamsRequest,
  createRegistrationDeskTeamRow,
  registrationDeskReviewComplete,
  registrationDeskTotals,
  supportedRegistrationDeskModes,
  type RegistrationDeskPaymentMethod,
  type RegistrationDeskSignupRequest,
  type RegistrationDeskTeamRow,
} from "./registrationDeskSignup";
import type { ArenaData, Contestant } from "./types";
import { roundRobinRoleCapacity } from "./roundRobinCapacity";
import { registrationDeskWorkspaceHref } from "./registrationDeskNavigation";
import { registrationDeskRideInAllowed } from "./registrationWindow";
import {
  registrationDeskEntryPatch,
  registrationDeskEntryPermissions,
  registrationDeskScratchRequest,
  type RegistrationDeskEntryDraft,
} from "./registrationDeskEntryActions";
import { resizeProfilePhoto } from "./profilePhoto";
import {
  registrationDeskEventRoster,
  type RegistrationDeskRosterEntry,
} from "./registrationDeskRoster";
import {
  registrationDeskWaiverStatus,
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
  status,
  available,
  disabled,
  onSign,
}: {
  contestantName: string;
  status?: RegistrationDeskWaiverStatus;
  available: boolean;
  disabled: boolean;
  onSign: () => void;
}) {
  return (
    <div className="registration-waiver-status-control">
      <span
        className={`registration-waiver-badge ${
          status ? "signed" : "needed"
        }`}
        role="status"
      >
        {status
          ? `Signed ${formatWaiverSignedAt(status.signedAt)}`
          : "Waiver needed"}
      </span>
      {!status && (
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

const retainLocalWaiverStatus = (
  next: RegistrationDeskData,
  current: RegistrationDeskData | null,
): RegistrationDeskData =>
  current
    ? {
        ...next,
        waiverStatus: current.waiverStatus,
        waiverSignatures: current.waiverSignatures,
      }
    : next;

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
  // Draw entries carry no picked-team rows; the signup helpers still expect the field.
  const teamRows = useMemo(() => [createRegistrationDeskTeamRow()], []);
  const [paymentMethod, setPaymentMethod] =
    useState<RegistrationDeskPaymentMethod | "">("");
  const [review, setReview] = useState(false);
  const [submissionId, setSubmissionId] = useState("");
  const [search, setSearch] = useState("");
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const signWaiverAfterSave = useRef(false);
  const [photoBusy, setPhotoBusy] = useState(false);
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
  // Team picked straight from the roster lists (one header + one heeler).
  const [pickedHeaderId, setPickedHeaderId] = useState("");
  const [pickedHeelerId, setPickedHeelerId] = useState("");
  const [teamPaymentMethod, setTeamPaymentMethod] =
    useState<RegistrationDeskPaymentMethod | "">("");
  const [teamReview, setTeamReview] = useState(false);
  const [teamSubmissionId, setTeamSubmissionId] = useState("");

  useEffect(() => {
    // Inside the Wix embed the page has its own scrollbar; hide the app's window
    // scrollbar so only one shows. Wheel/touch scrolling still works.
    if (!isWixEmbed()) return;
    document.documentElement.classList.add("hide-window-scrollbar");
    return () => document.documentElement.classList.remove("hide-window-scrollbar");
  }, []);

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
  const rosterSections = [
    {
      id: "header",
      title: "Headers",
      teams: false,
      entries: eventRoster.filter(
        (rosterEntry) => rosterEntry.role === "Header" && rosterEntry.recordType === "registration",
      ),
    },
    {
      id: "heeler",
      title: "Heelers",
      teams: false,
      entries: eventRoster.filter(
        (rosterEntry) => rosterEntry.role === "Heeler" && rosterEntry.recordType === "registration",
      ),
    },
    {
      id: "teams",
      title: "Picked teams",
      teams: true,
      // One row per team, keyed off the header side; generated draw teams
      // are not desk picks.
      entries: eventRoster.filter(
        (rosterEntry) =>
          rosterEntry.recordType === "team" &&
          rosterEntry.role === "Header" &&
          !rosterEntry.generated,
      ),
    },
  ];
  const teamHandicapFor = (rosterEntry: RegistrationDeskRosterEntry) =>
    rosterEntry.handicap +
    (eventRoster.find(
      (other) =>
        other.recordType === "team" &&
        other.recordId === rosterEntry.recordId &&
        other.role === "Heeler",
    )?.handicap ?? 0);
  const drawsSupported = supportedRegistrationDeskModes(event).includes("draws");
  const entryUnavailableMessage = !event
    ? ""
    : !event.registrationOpen
      ? "This competition is visible, but registration is closed."
      : event.drawLocked
        ? "This competition is visible, but entries are blocked while the draw is locked."
        : "";
  // Picked teams can still ride in once the competition has started.
  const teamRideIn = Boolean(event && registrationDeskRideInAllowed(event));
  const teamUnavailableMessage = teamRideIn ? "" : entryUnavailableMessage;
  const contestant = data?.contestants.find((item) => item.id === contestantId);
  const waiverContestant = data?.contestants.find(
    (item) => item.id === waiverContestantId,
  );
  const minimumDraws = event ? minimumDrawEntries(event) : 1;
  const workspace = data ? asWorkspace(data) : null;
  const workspaceEvent = workspace?.events.find((item) => item.id === eventId);
  const roleCapacities = workspaceEvent
    ? {
        Header: roundRobinRoleCapacity(workspaceEvent, data?.registrations ?? [], "Header"),
        Heeler: roundRobinRoleCapacity(workspaceEvent, data?.registrations ?? [], "Heeler"),
      }
    : null;
  const totals = registrationDeskTotals(
    "draws",
    entries,
    teamRows,
    Number(event?.entryFee ?? 0),
  );
  const drawEligible =
    Boolean(workspaceEvent && contestant) &&
    contestantEligibleForRole(workspaceEvent!, contestant, role);

  const pickedHeader = data?.contestants.find(({ id }) => id === pickedHeaderId);
  const pickedHeeler = data?.contestants.find(({ id }) => id === pickedHeelerId);
  const pickedTeamRows = useMemo<RegistrationDeskTeamRow[]>(
    () =>
      pickedHeaderId && pickedHeelerId
        ? [{ ...createRegistrationDeskTeamRow(), headerId: pickedHeaderId, heelerId: pickedHeelerId }]
        : [],
    [pickedHeaderId, pickedHeelerId],
  );
  const pickedTeamTotals = registrationDeskTotals(
    "picked-teams",
    0,
    pickedTeamRows,
    Number(event?.entryFee ?? 0),
  );
  const pickedTeamHandicap =
    pickedHeader && pickedHeeler
      ? Number(pickedHeader.headerHandicap) + Number(pickedHeeler.heelerHandicap)
      : 0;
  const pickedTeamError = (() => {
    if (!event || !pickedHeader || !pickedHeeler) return "";
    if (pickedTeamHandicap > Number(event.handicapTotal)) {
      return `Team handicap ${pickedTeamHandicap} is over the #${event.handicapTotal} cap.`;
    }
    if (
      !event.allowRepeatPartners &&
      data?.teams.some(
        (team) =>
          team.eventId === event.id &&
          Number(team.round) === 1 &&
          !team.generated &&
          !team.scratched &&
          team.headerId === pickedHeader.id &&
          team.heelerId === pickedHeeler.id,
      )
    ) {
      return "That partnership is already entered.";
    }
    return "";
  })();

  const clearPickedTeam = () => {
    setPickedHeaderId("");
    setPickedHeelerId("");
    setTeamPaymentMethod("");
    setTeamReview(false);
    setTeamSubmissionId("");
  };

  const togglePickedRider = (role: "Header" | "Heeler", id: string) => {
    if (role === "Header") setPickedHeaderId((current) => (current === id ? "" : id));
    else setPickedHeelerId((current) => (current === id ? "" : id));
    setTeamReview(false);
    setTeamSubmissionId("");
    setMessage("");
  };

  useEffect(() => {
    setEntries(minimumDraws);
  }, [eventId, minimumDraws]);

  useEffect(() => {
    if (!event) return;
    setPaymentMethod("");
    setReview(false);
    setSubmissionId("");
    setWaiverContestantId("");
    setWaiverError("");
    setPickedHeaderId("");
    setPickedHeelerId("");
    setTeamPaymentMethod("");
    setTeamReview(false);
    setTeamSubmissionId("");
  }, [event?.id]);

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

  const profileFromContestant = (item: Contestant): RegistrationDeskContestantInput => ({
    id: item.id,
    name: item.name,
    role: item.role,
    headerHandicap: item.headerHandicap,
    heelerHandicap: item.heelerHandicap,
    phone: item.phone,
    email: item.email ?? "",
    hometown: item.hometown,
    horses: item.horses ?? [],
  });

  const resetEntryDraft = () => {
    setEntryHorseName("");
    setPaymentMethod("");
    setReview(false);
    setSubmissionId("");
  };

  // Step 1: pick an existing contestant. The profile form loads with their
  // current details so the attendant can correct anything before entering.
  const selectContestant = (item: Contestant) => {
    setContestantId(item.id);
    setProfile(profileFromContestant(item));
    setHorseName("");
    setCreatingProfile(false);
    setEditingProfile(true);
    signWaiverAfterSave.current = false;
    setSearch("");
    setPinOpen(false);
    setPin("");
    setPinConfirmation("");
    resetEntryDraft();
    setMessage("");
  };

  // Reopen the profile form for the selected rider (edits start from saved data).
  const editContestant = () => {
    if (!contestant) return;
    setProfile(profileFromContestant(contestant));
    setHorseName("");
    setEditingProfile(true);
    setPinOpen(false);
    setPin("");
    setPinConfirmation("");
    setMessage("");
  };

  // Discard unsaved edits, close the form, and keep the rider selected.
  const cancelProfileEdit = () => {
    if (contestant) setProfile(profileFromContestant(contestant));
    setHorseName("");
    setEditingProfile(false);
    setPinOpen(false);
    setPin("");
    setPinConfirmation("");
    setMessage("");
  };

  const startNewProfile = () => {
    setContestantId("");
    setProfile(emptyContestant());
    setHorseName("");
    setCreatingProfile(true);
    setEditingProfile(true);
    signWaiverAfterSave.current = false;
    setSearch("");
    setPinOpen(false);
    resetEntryDraft();
    setMessage("");
  };

  const clearContestant = () => {
    setContestantId("");
    setProfile(emptyContestant());
    setCreatingProfile(false);
    setEditingProfile(false);
    signWaiverAfterSave.current = false;
    setPinOpen(false);
    resetEntryDraft();
    setMessage("");
  };

  useEffect(() => {
    if (creatingProfile) {
      addContestantNameRef.current?.focus();
    }
  }, [creatingProfile]);

  const profilePhotoSrc = profile.clearPhoto
    ? ""
    : profile.photo ?? contestant?.photo ?? "";

  const handleProfilePhoto = async (file?: File) => {
    if (!file) return;
    setPhotoBusy(true);
    setMessage("");
    try {
      const photo = await resizeProfilePhoto(file);
      setProfile((current) => ({ ...current, photo, clearPhoto: false }));
    } catch {
      setMessage("That photo could not be read. Try taking it again.");
    } finally {
      setPhotoBusy(false);
    }
  };

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
      let savedContestant: Contestant;
      if (embedded) {
        const result = await saveRegistrationDeskContestant(normalizedProfile);
        if (!result) throw new Error("The contestant profile was not saved.");
        setData(normalizeRegistrationDeskData(result.data));
        savedContestant = result.contestant;
      } else {
        const workspaceData = loadLocalRegistrationWorkspace();
        const result = upsertRegistrationDeskContestant(workspaceData, normalizedProfile);
        saveLocalRegistrationWorkspace(result.data);
        setData((current) =>
          retainLocalWaiverStatus(
            registrationDeskProjection(result.data),
            current,
          ),
        );
        savedContestant = result.contestant;
      }
      setContestantId(savedContestant.id);
      setProfile(profileFromContestant(savedContestant));
      setCreatingProfile(false);
      setEditingProfile(false);
      setPinOpen(false);
      setPin("");
      setPinConfirmation("");
      setMessage("Contestant profile saved.");
      if (signWaiverAfterSave.current) {
        signWaiverAfterSave.current = false;
        if (event && data?.waiverDocument.available) {
          setWaiverContestantId(savedContestant.id);
          setWaiverError("");
        }
      }
    } catch (error) {
      signWaiverAfterSave.current = false;
      setMessage(
        error instanceof Error ? error.message : "The profile could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const contestantWaiverStatus =
    data && event && contestant
      ? registrationDeskWaiverStatus(data, event.id, contestant.id)
      : undefined;

  const profileEditor = (
    <form className="registration-profile-form" onSubmit={saveProfile}>
      <div className="registration-profile-photo">
        {profilePhotoSrc ? (
          <img src={profilePhotoSrc} alt={profile.name ? `${profile.name} profile photo` : "Profile photo"} />
        ) : (
          <div className="registration-profile-photo-empty" aria-hidden="true"><Camera /></div>
        )}
        <div className="registration-profile-photo-actions">
          <label className={`registration-photo-button${photoBusy ? " disabled" : ""}`}>
            <Camera size={16} /> {profilePhotoSrc ? "Retake photo" : "Take photo"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={photoBusy || busy}
              onChange={(change) => {
                void handleProfilePhoto(change.target.files?.[0]);
                change.target.value = "";
              }}
            />
          </label>
          <label className={`registration-photo-button${photoBusy ? " disabled" : ""}`}>
            <ImagePlus size={16} /> Choose photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={photoBusy || busy}
              onChange={(change) => {
                void handleProfilePhoto(change.target.files?.[0]);
                change.target.value = "";
              }}
            />
          </label>
          {profilePhotoSrc && (
            <button
              type="button"
              disabled={photoBusy || busy}
              onClick={() => setProfile({ ...profile, photo: undefined, clearPhoto: true })}
            >
              <Trash2 size={15} /> Remove photo
            </button>
          )}
          {photoBusy && <small>Preparing photo…</small>}
        </div>
      </div>
      <div className="registration-profile-fields">
        <label>Full name<input ref={addContestantNameRef} required maxLength={100} autoCapitalize="characters" value={profile.name} onChange={(change) => setProfile({ ...profile, name: change.target.value.toUpperCase() })} /></label>
        <label>Roping position<select value={profile.role} onChange={(change) => setProfile({ ...profile, role: change.target.value as Contestant["role"] })}><option>Both</option><option>Header</option><option>Heeler</option></select></label>
        <label>Header handicap<input required type="number" min={0} max={20} step={0.5} value={profile.headerHandicap} onChange={(change) => setProfile({ ...profile, headerHandicap: Number(change.target.value) })} /></label>
        <label>Heeler handicap<input required type="number" min={0} max={20} step={0.5} value={profile.heelerHandicap} onChange={(change) => setProfile({ ...profile, heelerHandicap: Number(change.target.value) })} /></label>
        <label>Email<input type="email" value={profile.email} onChange={(change) => setProfile({ ...profile, email: change.target.value.toLowerCase() })} /></label>
        <label>Phone<input type="tel" value={profile.phone} onChange={(change) => setProfile({ ...profile, phone: change.target.value })} /></label>
        <label>Hometown<input autoCapitalize="characters" value={profile.hometown} onChange={(change) => setProfile({ ...profile, hometown: change.target.value.toUpperCase() })} /></label>
      </div>
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
        {data && event && (
          <div className="registration-profile-waiver">
            <span>Waiver for {event.name}</span>
            {contestant ? (
              <WaiverStatusControl
                contestantName={contestant.name}
                status={contestantWaiverStatus}
                available={data.waiverDocument.available}
                disabled={busy || waiverBusy}
                onSign={() => launchWaiver(contestant.id)}
              />
            ) : (
              <small>
                {data.waiverDocument.available
                  ? "The waiver opens for signing as soon as the profile is saved."
                  : "Waiver signing is unavailable until staff configure the waiver document."}
              </small>
            )}
          </div>
        )}
        <div className="registration-profile-actions">
          <button
            type="button"
            disabled={busy}
            onClick={creatingProfile ? clearContestant : cancelProfileEdit}
          >
            Cancel
          </button>
          {contestant && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPinOpen((open) => !open);
                setMessage("");
              }}
            >
              <KeyRound size={15} /> {pinOpen ? "Hide PIN" : "Set 4-digit PIN"}
            </button>
          )}
          {!contestantWaiverStatus && data?.waiverDocument.available && event && (
            <button
              className="primary"
              disabled={busy || photoBusy}
              onClick={() => { signWaiverAfterSave.current = true; }}
            >
              {busy ? "Saving…" : creatingProfile ? "Save & sign waiver" : "Save changes & sign waiver"}
            </button>
          )}
          <button
            className={contestantWaiverStatus || !data?.waiverDocument.available || !event ? "primary" : "secondary"}
            disabled={busy || photoBusy}
            onClick={() => { signWaiverAfterSave.current = false; }}
          >
            {busy ? "Saving…" : creatingProfile ? "Save contestant" : "Save changes"}
          </button>
        </div>
        {contestant && pinOpen && (
          <fieldset className="registration-pin-panel">
            <legend>Contestant login PIN</legend>
            <label>
              New 4-digit PIN
              <input
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
      </form>
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
        setData((current) =>
          retainLocalWaiverStatus(
            registrationDeskProjection(result.data),
            current,
          ),
        );
        setMessage(result.result.summary);
      }
      setEntries(minimumDraws);
      setEntryHorseName("");
      setPaymentMethod("");
      setReview(false);
      setSubmissionId("");
      setPickedHeaderId("");
      setPickedHeelerId("");
      setTeamPaymentMethod("");
      setTeamReview(false);
      setTeamSubmissionId("");
      // Leave Step 1 empty for the next contestant, keeping the summary visible.
      setContestantId("");
      setProfile(emptyContestant());
      setCreatingProfile(false);
      setEditingProfile(false);
      signWaiverAfterSave.current = false;
      setPinOpen(false);
      setSearch("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The entry could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const beginTeamReview = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (teamUnavailableMessage) {
      setMessage(teamUnavailableMessage);
      return;
    }
    if (!event || !teamPaymentMethod || !pickedHeader || !pickedHeeler) return;
    if (pickedTeamError) {
      setMessage(pickedTeamError);
      return;
    }
    setTeamSubmissionId(
      window.crypto.randomUUID?.() ??
        `desk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    setTeamReview(true);
    setMessage("");
  };

  // The header is recorded as payer so the ledger stays complete; the
  // attendant is not asked to choose one.
  const submitPickedTeam = () => {
    if (!event || !teamPaymentMethod || !teamSubmissionId || !pickedHeader || !pickedHeeler) {
      return;
    }
    const request = buildRegistrationDeskPickedTeamsRequest({
      submissionId: teamSubmissionId,
      eventId: event.id,
      rows: pickedTeamRows,
      payerContestantId: pickedHeader.id,
      paymentMethod: teamPaymentMethod,
    });
    setBusy(true);
    setMessage("");
    void finishSignup(request);
  };

  const beginReview = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (entryUnavailableMessage) {
      setMessage(entryUnavailableMessage);
      return;
    }
    if (!event || !paymentMethod || !contestant) return;
    const complete = registrationDeskReviewComplete("draws", {
      contestantId: contestant.id,
      role,
      entries,
      minimumEntries: minimumDraws,
      maximumEntries: event.entriesAllowed,
      rows: teamRows,
      payerContestantId: contestant.id,
      paymentMethod,
    });
    if (!complete) {
      setMessage("Complete the draw entry before review.");
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
    if (!event || !paymentMethod || !submissionId || !contestant) {
      return;
    }
    const request = buildRegistrationDeskDrawRequest({
      submissionId,
      eventId: event.id,
      contestantId: contestant.id,
      horseName: entryHorseName,
      role,
      entries,
      paymentMethod,
    });
    setBusy(true);
    setMessage("");
    void finishSignup(request);
  };

  const beginRosterEntryEdit = (entry: RegistrationDeskRosterEntry) => {
    const partner =
      entry.recordType === "team"
        ? eventRoster.find(
            (other) =>
              other.recordType === "team" &&
              other.recordId === entry.recordId &&
              other.role !== entry.role,
          )
        : undefined;
    setRosterEntryEdit({
      key: entry.key,
      eventId: entry.eventId,
      recordType: entry.recordType,
      recordId: entry.recordId,
      role: entry.role,
      entries: entry.entries ?? 1,
      horseName: entry.horseName ?? "",
      ...(partner ? { partnerHorseName: partner.horseName ?? "" } : {}),
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

  const rosterPanel = data ? (
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
        {event && (pickedHeader || pickedHeeler) && (
          <form
            className="registration-roster-pick-team"
            aria-label="Pick a team from the roster"
            onSubmit={beginTeamReview}
          >
            <div className="registration-roster-pick-team-heading">
              <div>
                <span>{teamRideIn ? "Ride-in team" : "Pick a team"}</span>
                <strong>
                  {pickedHeader?.name ?? "Pick a header"}
                  {" & "}
                  {pickedHeeler?.name ?? "Pick a heeler"}
                </strong>
                {pickedHeader && pickedHeeler && (
                  <small>
                    Handicap #{pickedTeamHandicap}
                    {" · "}
                    {pickedTeamTotals.runCount} runs ·{" "}
                    {formatMoney(pickedTeamTotals.amount)}
                    {teamRideIn ? " · added to the end of Round 1" : ""}
                  </small>
                )}
              </div>
              <button type="button" onClick={clearPickedTeam} disabled={busy}>
                Clear
              </button>
            </div>
            {pickedTeamError && (
              <p className="registration-roster-pick-team-error" role="alert">
                {pickedTeamError}
              </p>
            )}
            {pickedHeader && pickedHeeler && !pickedTeamError && !teamReview && (
              <>
                <fieldset className="registration-payment-method">
                  <legend>Cashier payment selection</legend>
                  {([
                    ["cash", Banknote, "Paid in cash", `${formatMoney(pickedTeamTotals.amount)} received by cashier`],
                    ["card", CreditCard, "Paid with credit card", `Charge ${formatMoney(pickedTeamTotals.amount)} on the Square Terminal first`],
                    ["tab", ClipboardPen, "Open a tab", `Add ${formatMoney(pickedTeamTotals.amount)} to ${pickedHeader.name}'s balance`],
                  ] as const).map(([method, Icon, title, detail]) => (
                    <label className={teamPaymentMethod === method ? "selected" : ""} key={method}>
                      <input
                        type="radio"
                        name="teamPaymentMethod"
                        checked={teamPaymentMethod === method}
                        onChange={() => {
                          setTeamPaymentMethod(method);
                          setTeamReview(false);
                          setTeamSubmissionId("");
                        }}
                      />
                      <Icon />
                      <span><strong>{title}</strong><small>{detail}</small></span>
                    </label>
                  ))}
                </fieldset>
                {teamPaymentMethod && (
                  <button
                    className="primary"
                    disabled={busy || Boolean(teamUnavailableMessage)}
                  >
                    Review team
                  </button>
                )}
              </>
            )}
            {pickedHeader && pickedHeeler && teamReview && (
              <section className="registration-entry-receipt" aria-label="Final team review">
                <div className="registration-receipt-heading">
                  <span>Final review</span>
                  <strong>{event.name}</strong>
                </div>
                <p>
                  {pickedHeader.name} (header) & {pickedHeeler.name} (heeler)
                  {" · "}Handicap #{pickedTeamHandicap}
                </p>
                <dl>
                  <div><dt>Payment</dt><dd>{teamPaymentMethod}</dd></div>
                  <div><dt>Run count</dt><dd>{pickedTeamTotals.runCount}</dd></div>
                  <div><dt>Entry fee</dt><dd>{formatMoney(event.entryFee)}</dd></div>
                  <div className="registration-receipt-total-due">
                    <dt>Amount</dt><dd>{formatMoney(pickedTeamTotals.amount)}</dd>
                  </div>
                </dl>
                <div className="registration-review-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setTeamReview(false);
                      setTeamSubmissionId("");
                    }}
                  >
                    Back / Edit
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={submitPickedTeam}
                  >
                    {busy
                      ? "Sending…"
                      : teamRideIn
                        ? "Send to Run Desk"
                        : "Send to Draw Desk"}
                  </button>
                </div>
              </section>
            )}
          </form>
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
                    <p>
                      {section.teams
                        ? "No teams have been picked."
                        : `No ${section.title.toLowerCase()} are signed up.`}
                    </p>
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
                        const picked =
                          !section.teams &&
                          (rosterEntry.role === "Header"
                            ? pickedHeaderId === rosterEntry.contestantId
                            : pickedHeelerId === rosterEntry.contestantId);
                        return (
                          <li key={rosterEntry.key} className={picked ? "picked" : undefined}>
                            <div className="registration-roster-entry-summary">
                              <div>
                                <strong>
                                  {section.teams
                                    ? `${rosterEntry.name} & ${rosterEntry.partnerName ?? "—"}`
                                    : rosterEntry.name}
                                </strong>
                                <span>
                                  {section.teams
                                    ? `Team · Handicap #${teamHandicapFor(rosterEntry)}`
                                    : `${rosterEntry.entries ?? 1} ${
                                        (rosterEntry.entries ?? 1) === 1
                                          ? "entry"
                                          : "entries"
                                      } · Handicap ${rosterEntry.handicap}`}
                                  {rosterEntry.horseName
                                    ? ` · ${rosterEntry.horseName}`
                                    : ""}
                                  {rosterEntry.paymentMethod
                                    ? ` · ${
                                        rosterEntry.paymentMethod === "tab"
                                          ? "Tab"
                                          : rosterEntry.paymentMethod === "card"
                                            ? "Card"
                                            : "Cash"
                                      }${rosterEntry.paid ? " paid" : ""}`
                                    : ""}
                                  {rosterEntry.payerName && !section.teams
                                    ? ` · Payer: ${rosterEntry.payerName}`
                                    : ""}
                                </span>
                              </div>
                              <div className="registration-roster-entry-actions">
                                {!section.teams && (
                                <button
                                  type="button"
                                  className={picked ? "pick active" : "pick"}
                                  aria-pressed={picked}
                                  disabled={busy || Boolean(teamUnavailableMessage)}
                                  title={
                                    teamUnavailableMessage ||
                                    (picked
                                      ? `Remove ${rosterEntry.name} from the team`
                                      : `Pick ${rosterEntry.name} as the team ${rosterEntry.role.toLowerCase()}`)
                                  }
                                  onClick={() =>
                                    togglePickedRider(rosterEntry.role, rosterEntry.contestantId)
                                  }
                                >
                                  <Users size={13} /> {picked ? "Picked" : "Pick"}
                                </button>
                                )}
                                <button
                                  type="button"
                                  disabled={editDisabled}
                                  title={
                                    rosterEntry.generated
                                      ? "Generated draw teams must be scratched as a whole team."
                                      : editDisabled
                                        ? "Editing requires an open, unlocked live competition in Wix."
                                        : section.teams
                                          ? "Edit this team's horses and payment"
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
                                  {section.teams ? `${rosterEntry.name}'s horse` : "Horse"}
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
                                {rosterEntryEdit.partnerHorseName !== undefined && (
                                  <label>
                                    {rosterEntry.partnerName ?? "Partner"}'s horse
                                    <input
                                      maxLength={100}
                                      value={rosterEntryEdit.partnerHorseName}
                                      onChange={(change) =>
                                        setRosterEntryEdit({
                                          ...rosterEntryEdit,
                                          partnerHorseName: change.target.value.toUpperCase(),
                                        })
                                      }
                                    />
                                  </label>
                                )}
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
  ) : null;

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
            Live or upcoming competition
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
                  {item.name} · {item.date} · {competitionName(item.competitionType)} · {item.status}
                </option>
              ))}
            </select>
          </label>
          {!data && <p>Loading registration desk…</p>}
          {data && !data.events.length && (
            <p>No live or upcoming competitions are currently available.</p>
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

        {event && data && (
          <section className="registration-desk-panel registration-desk-step">
            <div className="registration-desk-panel-heading">
              <div>
                <span>Step 1</span>
                <h2>Contestant profile</h2>
              </div>
              {(contestant || creatingProfile) ? (
                <button type="button" disabled={busy} onClick={clearContestant}>
                  <Search size={16} /> Look up another contestant
                </button>
              ) : (
                <button type="button" onClick={startNewProfile}>
                  <Plus size={16} /> New contestant
                </button>
              )}
            </div>
            {!contestant && !creatingProfile && (
              <>
                <label className="registration-search">
                  <Search size={17} />
                  <input
                    value={search}
                    onChange={(change) => setSearch(change.target.value)}
                    placeholder="Search name, email, or phone"
                    autoFocus
                  />
                </label>
                <div className="registration-contestant-list">
                  {filteredContestants.slice(0, 80).map((item) => (
                    <button
                      type="button"
                      onClick={() => selectContestant(item)}
                      key={item.id}
                    >
                      {item.photo ? (
                        <img src={item.photo} alt="" />
                      ) : (
                        <i aria-hidden="true">{item.name.slice(0, 1)}</i>
                      )}
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.email || item.phone || "No contact information"}</small>
                      </span>
                    </button>
                  ))}
                  {normalizedSearch.length < 2 && (
                    <p className="registration-search-hint">
                      Enter at least two letters, an email, or a phone number.
                      Can't find the contestant? Use <strong>New contestant</strong> to
                      create the profile and collect the waiver in one step.
                    </p>
                  )}
                  {normalizedSearch.length >= 2 && !filteredContestants.length && (
                    <p className="registration-search-hint">
                      No contestants match that search.{" "}
                      <button type="button" className="registration-inline-link" onClick={startNewProfile}>
                        Create a new profile
                      </button>
                    </p>
                  )}
                </div>
              </>
            )}
            {(contestant || creatingProfile) && (
              <>
                <div className="registration-selected-contestant">
                  {contestant ? <CheckCircle2 /> : <UserRoundPlus />}
                  <span>
                    {contestant ? (
                      editingProfile ? (
                        <>Profile found: <strong>{contestant.name}</strong>. Review and correct the details, then save or cancel.</>
                      ) : (
                        <>Contestant: <strong>{contestant.name}</strong>. Enter the draws below.</>
                      )
                    ) : (
                      <>New contestant. Fill in the profile, take a photo, and save to collect the waiver.</>
                    )}
                  </span>
                  {contestant && !editingProfile && (
                    <button type="button" disabled={busy} onClick={editContestant}>
                      <Pencil size={15} /> Edit profile
                    </button>
                  )}
                </div>
                {contestant && !editingProfile && data && (
                  <div className="registration-selected-summary">
                    {contestant.photo ? (
                      <img src={contestant.photo} alt="" />
                    ) : (
                      <i aria-hidden="true">{contestant.name.slice(0, 1)}</i>
                    )}
                    <div>
                      <strong>{contestant.name}</strong>
                      <small>
                        {contestant.role} · Head #{contestant.headerHandicap} · Heel #{contestant.heelerHandicap}
                        {contestant.hometown ? ` · ${contestant.hometown}` : ""}
                      </small>
                      <small>{contestant.email || contestant.phone || "No contact information"}</small>
                    </div>
                    <div className="registration-profile-waiver">
                      <span>Waiver for {event.name}</span>
                      <WaiverStatusControl
                        contestantName={contestant.name}
                        status={contestantWaiverStatus}
                        available={data.waiverDocument.available}
                        disabled={busy || waiverBusy}
                        onSign={() => launchWaiver(contestant.id)}
                      />
                    </div>
                  </div>
                )}
                {editingProfile && profileEditor}
              </>
            )}
          </section>
        )}

        {event && data && contestant && !drawsSupported && (
          <section className="registration-desk-panel registration-desk-step">
            <div className="registration-desk-panel-heading">
              <div>
                <span>Step 2</span>
                <h2>Enter draws</h2>
              </div>
            </div>
            <p className="registration-search-hint">
              This competition does not accept draw entries at the Registration Desk.
            </p>
          </section>
        )}

        {event && data && contestant && drawsSupported && (
          <div className="registration-desk-columns">
            <div className="registration-desk-column">
              <section className="registration-desk-panel">
                <div className="registration-desk-panel-heading">
                  <div>
                    <span>Step 2</span>
                    <h2>Enter draws</h2>
                  </div>
                </div>
                <div className="registration-entry-form registration-draw-details">
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
                    Number of draws
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
                </div>
              </section>

            <section className="registration-desk-panel">
              <div className="registration-desk-panel-heading">
                <div><span>Step 3</span><h2>Payment and review</h2></div>
              </div>
              <div className="registration-entry-form">
                  <form className="registration-competition-form" onSubmit={beginReview}>
                    {!review ? (
                      <>
                        <label>
                          Payer
                          <input value={contestant.name} readOnly />
                        </label>
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
                              !drawEligible ||
                              !eligibleRoles.length ||
                              !registrationDeskReviewComplete("draws", {
                                contestantId: contestant?.id,
                                role,
                                entries,
                                minimumEntries: minimumDraws,
                                maximumEntries: event.entriesAllowed,
                                rows: teamRows,
                                payerContestantId: contestant?.id ?? "",
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
                        <p>
                          {contestant?.name} · {role} · {entries} draw{entries === 1 ? "" : "s"}
                          {entryHorseName ? ` · ${entryHorseName}` : ""}
                        </p>
                        <dl>
                          <div><dt>Payer</dt><dd>{contestant?.name}</dd></div>
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
            </section>
              {rosterPanel}
            </div>
          </div>
        )}

        {(!event || !data || !contestant || !drawsSupported) && rosterPanel}

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
