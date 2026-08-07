import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import { eligibleSignupPartners, type SignupRequest } from "./onlineSignup";
import {
  loadLocalRegistrationWorkspace,
  registrationDeskProjection,
  saveLocalRegistrationWorkspace,
  submitLocalRegistrationDeskSignup,
  upsertRegistrationDeskContestant,
  type RegistrationDeskContestantInput,
  type RegistrationDeskData,
} from "./registrationDeskData";
import type { ArenaData, Contestant } from "./types";
import {
  isWixEmbed,
  loadRegistrationDeskData,
  saveRegistrationDeskContestant,
  setRegistrationDeskContestantPin,
  submitRegistrationDeskSignup,
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
  const [addPick, setAddPick] = useState(false);
  const [partnerId, setPartnerId] = useState("");
  const [partnerIds, setPartnerIds] = useState<string[]>([]);
  const [pickStage, setPickStage] = useState<"draws" | "picks">("draws");
  const [slideEntryType, setSlideEntryType] = useState<"draw" | "pick">("draw");
  const [paymentMethod, setPaymentMethod] = useState<
    "" | "cash" | "card" | "tab"
  >("");
  const [search, setSearch] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinConfirmation, setPinConfirmation] = useState("");
  const [profile, setProfile] =
    useState<RegistrationDeskContestantInput>(emptyContestant);
  const [horseName, setHorseName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!embedded) return;
    loadRegistrationDeskData()
      .then((result) => setData(result))
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
  const contestant = data?.contestants.find((item) => item.id === contestantId);
  const slide = event?.competitionType === "slide";
  const individual =
    event?.competitionType === "draw-pot" ||
    event?.competitionType === "round-robin" ||
    (slide && slideEntryType === "draw");
  const pickAndDraw = event?.competitionType === "pick-and-draw";
  const minimumDraws = event ? minimumDrawEntries(event) : 1;
  const drawRole = role;
  const workspace = data ? asWorkspace(data) : null;
  const workspaceEvent = workspace?.events.find((item) => item.id === eventId);
  const partners = useMemo(
    () =>
      workspace && workspaceEvent && contestant
        ? eligibleSignupPartners(workspace, workspaceEvent, contestant.id, role)
        : [],
    [workspace, workspaceEvent, contestant, role],
  );
  const selectedPartners = partners.filter((partner) =>
    partnerIds.includes(partner.id),
  );
  const totalRuns = entries + partnerIds.length;
  const totalDue = totalRuns * Number(event?.entryFee ?? 0);
  const drawEligible =
    Boolean(workspaceEvent && contestant) &&
    contestantEligibleForRole(workspaceEvent!, contestant, drawRole);

  useEffect(() => {
    setEntries(minimumDraws);
  }, [eventId, minimumDraws]);

  useEffect(() => {
    setPaymentMethod("");
  }, [contestantId, entries, entryHorseName, eventId, partnerId, partnerIds, role]);
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
        contestantEligibleForRole(workspaceEvent, contestant, value),
      )
    : [];

  useEffect(() => {
    if (eligibleRoles.length && !eligibleRoles.includes(role)) {
      setRole(eligibleRoles[0]);
      setPartnerId("");
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
        setData(result.data);
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
        <label>Full name<input required maxLength={100} autoCapitalize="characters" value={profile.name} onChange={(change) => setProfile({ ...profile, name: change.target.value.toUpperCase() })} /></label>
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

  const buildSignupRequest = (
    submissionId: string,
    method: "cash" | "card" | "tab",
    signupEvent: { id: string },
    signupContestant: Contestant,
  ): SignupRequest => ({
      submissionId,
      eventId: signupEvent.id,
      contestantId: signupContestant.id,
      horseName: entryHorseName || undefined,
      role,
      drawRole: pickAndDraw ? drawRole : undefined,
      entries: individual || pickAndDraw ? entries : undefined,
      partnerId:
        individual || pickAndDraw ? undefined : partnerId,
      partnerIds: pickAndDraw && addPick ? partnerIds : undefined,
      paymentConfirmed: method !== "tab",
      paymentMethod: method,
    });

  const finishSignup = async (request: SignupRequest) => {
    if (!event) return;
    try {
      if (embedded) {
        const result = await submitRegistrationDeskSignup(request);
        if (!result) throw new Error("The entry was not saved.");
        setData(result.data);
        setMessage(result.summary);
      } else {
        const workspaceData = loadLocalRegistrationWorkspace();
        const result = submitLocalRegistrationDeskSignup(workspaceData, request);
        saveLocalRegistrationWorkspace(result.data);
        setData(registrationDeskProjection(result.data));
        setMessage(`Entry saved for ${event.name}.`);
      }
      setPartnerId("");
      setPartnerIds([]);
      setEntries(minimumDraws);
      setEntryHorseName("");
      setAddPick(false);
      setPickStage("draws");
      setPaymentMethod("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The entry could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitEntry = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!event || !contestant || !paymentMethod) return;
    setBusy(true);
    setMessage("");
    const submissionId =
      window.crypto.randomUUID?.() ??
      `desk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    void finishSignup(
      buildSignupRequest(submissionId, paymentMethod, event, contestant),
    );
  };

  return (
    <div className="registration-desk">
      <header className="registration-desk-header">
        <div>
          <span className="eyebrow">Restricted workspace</span>
          <h1><ClipboardPen /> Registration Desk</h1>
          <p>Contestant profiles and event entries only.</p>
        </div>
        <a href="?page=home"><ArrowLeft size={17} /> Public website</a>
      </header>
      <main className="registration-desk-main">
        <section className="registration-desk-events">
          <label>
            Live competition
            <select value={eventId} onChange={(change) => {
              setEventId(change.target.value);
              setPartnerId("");
              setPartnerIds([]);
              setAddPick(false);
              setPickStage("draws");
              setPinOpen(false);
              setPin("");
              setPinConfirmation("");
              setMessage("");
            }}>
              {(data?.events ?? []).map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {item.date} · {competitionName(item.competitionType)}
                </option>
              ))}
            </select>
          </label>
          {!data && <p>Loading registration desk…</p>}
          {data && !data.events.length && (
            <p>No live competitions are currently accepting registration.</p>
          )}
        </section>

        {event && data && (
          <div className="registration-desk-columns">
            <section className="registration-desk-panel">
              <div className="registration-desk-panel-heading">
                <div><span>Step 1</span><h2>Choose contestant</h2></div>
                <button type="button" onClick={() => editProfile()}>
                  <Plus size={16} /> Add contestant
                </button>
              </div>
              <label className="registration-search">
                <Search size={17} />
                <input value={search} onChange={(change) => setSearch(change.target.value)} placeholder="Search name, email, or phone" />
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
                      setPartnerId("");
                      setPartnerIds([]);
                      setAddPick(false);
                      setPickStage("draws");
                      setPinOpen(false);
                      setPin("");
                      setPinConfirmation("");
                      setMessage("");
                    }}
                    key={item.id}
                  >
                    <span><strong>{item.name}</strong><small>{item.email || item.phone || "No contact information"}</small></span>
                  </button>
                ))}
                {normalizedSearch.length < 2 && (
                  <p className="registration-search-hint">
                    Enter at least two letters, an email, or a phone number.
                  </p>
                )}
                {normalizedSearch.length >= 2 && !filteredContestants.length && (
                  <p className="registration-search-hint">
                    No contestants match that search.
                  </p>
                )}
              </div>
            </section>

            <section className="registration-desk-panel">
              <div className="registration-desk-panel-heading">
                <div><span>Step 2</span><h2>Enter competition</h2></div>
              </div>
              {!contestant ? (
                <div className="registration-desk-empty">
                  <UserRoundPlus />
                  <p>Choose a contestant to prepare an entry.</p>
                </div>
              ) : (
                <div className="registration-entry-form">
                  <div className="registration-selected-contestant">
                    <CheckCircle2 />
                    <span>Registering <strong>{contestant.name}</strong></span>
                  </div>
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
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void savePin()}
                      >
                        {busy ? "Saving…" : "Save PIN"}
                      </button>
                    </fieldset>
                  )}
                  {profileOpen && profile.id === contestant.id && (
                    <section className="registration-inline-profile">
                      {profileEditor}
                    </section>
                  )}
                  <div className="registration-entry-divider">
                    <span>Entries this competition</span>
                  </div>
                  <form className="registration-competition-form" onSubmit={submitEntry}>
                  <label>
                    Horse
                    <select disabled={!contestant.horses?.length} value={entryHorseName} onChange={(change) => setEntryHorseName(change.target.value)}>
                      <option value="">{contestant.horses?.length ? "No horse selected" : "No saved horses"}</option>
                      {contestant.horses?.map((horse) => (
                        <option value={horse} key={horse}>{horse}</option>
                      ))}
                    </select>
                    {!contestant.horses?.length && <small>Add a horse in Edit contestant, then select it here.</small>}
                  </label>
                  {slide && (
                   <fieldset>
                     <legend>Entry type</legend>
                     <label><input type="radio" name="slide-entry-type" checked={slideEntryType === "draw"} onChange={() => { setSlideEntryType("draw"); setPartnerId(""); }} /> Draw entry</label>
                     <label><input type="radio" name="slide-entry-type" checked={slideEntryType === "pick"} onChange={() => setSlideEntryType("pick")} /> Picked team</label>
                   </fieldset>
                  )}
                  <label>Position<select value={role} onChange={(change) => {
                    setRole(change.target.value as "Header" | "Heeler");
                    setPartnerId("");
                    setPartnerIds([]);
                  }}>
                    {eligibleRoles.map((value) => <option key={value}>{value}</option>)}
                  </select></label>
                  {individual ? (
                    <label>Number of entries<input type="number" min={minimumDraws} max={event.entriesAllowed} value={entries} onChange={(change) => setEntries(Number(change.target.value))} /><small>Competition minimum: {minimumDraws}</small></label>
                  ) : pickAndDraw && pickStage === "draws" ? (
                    <>
                      <label>
                        Number of {drawRole.toLowerCase()} draw entries
                        <input type="number" min={minimumDraws} max={event.entriesAllowed} value={entries} onChange={(change) => setEntries(Number(change.target.value))} />
                      </label>
                      <p className="registration-entry-hint">
                        Minimum {minimumDraws} draw{minimumDraws === 1 ? "" : "s"}; maximum {event.entriesAllowed} total runs. Handicap limits are checked before confirmation.
                      </p>
                      {!drawEligible && (
                        <p className="registration-entry-hint">
                          This contestant is not eligible for {drawRole.toLowerCase()} draws and cannot enter a picked team.
                        </p>
                      )}
                      <button
                        type="button"
                        className="primary"
                        disabled={
                          entries < minimumDraws ||
                          entries > event.entriesAllowed ||
                          (entries > 0 && !drawEligible)
                        }
                        onClick={() => setPickStage("picks")}
                      >
                        Continue to picked teams
                      </button>
                    </>
                  ) : pickAndDraw ? (
                    <>
                      <div className="registration-step-summary">
                        <strong>{entries} draw entr{entries === 1 ? "y" : "ies"}</strong>
                        <button type="button" onClick={() => setPickStage("draws")}>Change draws</button>
                      </div>
                      <label className="registration-pick-toggle">
                        <input
                          type="checkbox"
                          checked={addPick}
                          onChange={(change) => {
                            setAddPick(change.target.checked);
                            if (!change.target.checked) setPartnerIds([]);
                          }}
                        />
                        <span>Enter picked teams</span>
                      </label>
                      {addPick && (
                        <fieldset className="registration-partner-picks">
                          <legend>Choose picked partners already entered in the draw</legend>
                          {partners.map((partner) => (
                            <label key={partner.id}>
                              <input
                                type="checkbox"
                                checked={partnerIds.includes(partner.id)}
                                disabled={
                                  !partnerIds.includes(partner.id) &&
                                  totalRuns >= event.entriesAllowed
                                }
                                onChange={(change) =>
                                  setPartnerIds((current) =>
                                    change.target.checked
                                      ? [...current, partner.id]
                                      : current.filter((id) => id !== partner.id),
                                  )
                                }
                              />
                              <span>{partner.name}</span>
                            </label>
                          ))}
                          {!partners.length && (
                            <p>No eligible partners are currently entered in the draw.</p>
                          )}
                        </fieldset>
                      )}
                      <section
                        className="registration-entry-receipt"
                        aria-label="Entry receipt"
                      >
                        <div className="registration-receipt-heading">
                          <span>Entry receipt</span>
                          <strong>{contestant.name}</strong>
                        </div>
                        <dl>
                          <div>
                            <dt>Draws</dt>
                            <dd>{entries}</dd>
                          </div>
                          <div>
                            <dt>Picked teams</dt>
                            <dd>{partnerIds.length}</dd>
                          </div>
                          <div className="registration-receipt-total-runs">
                            <dt>Total runs</dt>
                            <dd>{totalRuns}</dd>
                          </div>
                          <div>
                            <dt>Amount per run</dt>
                            <dd>{formatMoney(event.entryFee)}</dd>
                          </div>
                          <div className="registration-receipt-total-due">
                            <dt>Total due</dt>
                            <dd>{formatMoney(totalDue)}</dd>
                          </div>
                        </dl>
                        {selectedPartners.length ? (
                          <div className="registration-receipt-teams">
                            <span>Picked teams</span>
                          <ul>
                            {selectedPartners.map((partner) => (
                              <li key={partner.id}>
                                {role === "Header"
                                  ? `${contestant.name} / ${partner.name}`
                                  : `${partner.name} / ${contestant.name}`}
                              </li>
                            ))}
                          </ul>
                          </div>
                        ) : (
                          <p>No picked teams selected.</p>
                        )}
                      </section>
                    </>
                  ) : (
                    <label>Partner<select required value={partnerId} onChange={(change) => setPartnerId(change.target.value)}>
                      <option value="">Choose eligible partner</option>
                      {partners.map((partner) => <option value={partner.id} key={partner.id}>{partner.name}</option>)}
                    </select></label>
                  )}
                  {(!pickAndDraw || pickStage === "picks") && (
                    <fieldset className="registration-payment-method">
                      <legend>Cashier payment selection</legend>
                      <label className={paymentMethod === "cash" ? "selected" : ""}>
                        <input
                          type="radio"
                          name="paymentMethod"
                          checked={paymentMethod === "cash"}
                          onChange={() => setPaymentMethod("cash")}
                        />
                        <Banknote />
                        <span>
                          <strong>Paid in cash</strong>
                          <small>{formatMoney(totalDue)} received by cashier</small>
                        </span>
                      </label>
                      <label className={paymentMethod === "card" ? "selected" : ""}>
                        <input
                          type="radio"
                          name="paymentMethod"
                          checked={paymentMethod === "card"}
                          onChange={() => setPaymentMethod("card")}
                        />
                        <CreditCard />
                        <span>
                          <strong>Paid with credit card</strong>
                          <small>Charge {formatMoney(totalDue)} on the portable Square Terminal first</small>
                        </span>
                      </label>
                      <label className={paymentMethod === "tab" ? "selected" : ""}>
                        <input
                          type="radio"
                          name="paymentMethod"
                          checked={paymentMethod === "tab"}
                          onChange={() => setPaymentMethod("tab")}
                        />
                        <ClipboardPen />
                        <span>
                          <strong>Open a tab</strong>
                          <small>Add {formatMoney(totalDue)} to this contestant's balance</small>
                        </span>
                      </label>
                    </fieldset>
                  )}
                  {(!pickAndDraw || pickStage === "picks") && paymentMethod && (
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        !eligibleRoles.length ||
                        (!individual &&
                          !pickAndDraw &&
                          !partnerId) ||
                        (pickAndDraw &&
                          ((entries < 1 && !addPick) ||
                            (addPick && !partnerIds.length) ||
                            totalRuns > event.entriesAllowed))
                      }
                    >
                      {busy
                        ? "Saving…"
                        : paymentMethod === "tab"
                          ? "Open tab and send entries to draw"
                          : "Record payment and send entries to draw"}
                    </button>
                  )}
                  </form>
                </div>
              )}
            </section>
          </div>
        )}

        {profileOpen && profile.id !== contestant?.id && (
          <section className="registration-desk-panel registration-profile-panel">
            {profileEditor}
          </section>
        )}
        {message && <p className="registration-desk-message" role="status">{message}</p>}
      </main>
    </div>
  );
}
