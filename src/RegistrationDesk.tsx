import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardPen,
  Pencil,
  Plus,
  Search,
  UserRoundPlus,
} from "lucide-react";
import {
  competitionName,
  contestantEligibleForRole,
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
  submitRegistrationDeskSignup,
} from "./wixBridge";

const emptyContestant = (): RegistrationDeskContestantInput => ({
  name: "",
  role: "Both",
  headerHandicap: 0,
  heelerHandicap: 0,
  phone: "",
  email: "",
  hometown: "",
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
  const [partnerId, setPartnerId] = useState("");
  const [search, setSearch] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] =
    useState<RegistrationDeskContestantInput>(emptyContestant);
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
  const individual =
    event?.competitionType === "draw-pot" ||
    event?.competitionType === "round-robin";
  const workspace = data ? asWorkspace(data) : null;
  const workspaceEvent = workspace?.events.find((item) => item.id === eventId);
  const partners = useMemo(
    () =>
      workspace && workspaceEvent && contestant
        ? eligibleSignupPartners(workspace, workspaceEvent, contestant.id, role)
        : [],
    [workspace, workspaceEvent, contestant, role],
  );
  const filteredContestants = (data?.contestants ?? []).filter((item) =>
    `${item.name} ${item.email ?? ""} ${item.phone}`
      .toLowerCase()
      .includes(search.toLowerCase()),
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
      if (embedded) {
        const result = await saveRegistrationDeskContestant(profile);
        if (!result) throw new Error("The contestant profile was not saved.");
        setData(result.data);
        setContestantId(result.contestant.id);
      } else {
        const workspaceData = loadLocalRegistrationWorkspace();
        const result = upsertRegistrationDeskContestant(workspaceData, profile);
        saveLocalRegistrationWorkspace(result.data);
        setData(registrationDeskProjection(result.data));
        setContestantId(result.contestant.id);
      }
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

  const submitEntry = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!event || !contestant) return;
    setBusy(true);
    setMessage("");
    const request: SignupRequest = {
      submissionId:
        window.crypto.randomUUID?.() ??
        `desk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      eventId: event.id,
      contestantId: contestant.id,
      role,
      entries: individual ? entries : undefined,
      partnerId: individual ? undefined : partnerId,
    };
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
      setEntries(1);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The entry could not be saved.",
      );
    } finally {
      setBusy(false);
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
        <a href="?page=home"><ArrowLeft size={17} /> Public website</a>
      </header>
      <main className="registration-desk-main">
        <section className="registration-desk-events">
          <label>
            Live competition
            <select value={eventId} onChange={(change) => {
              setEventId(change.target.value);
              setPartnerId("");
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
                      setPartnerId("");
                      setMessage("");
                    }}
                    key={item.id}
                  >
                    <span><strong>{item.name}</strong><small>{item.email || item.phone || "No contact information"}</small></span>
                    <i
                      title="Edit contestant"
                      onClick={(click) => {
                        click.stopPropagation();
                        editProfile(item);
                      }}
                    ><Pencil size={15} /></i>
                  </button>
                ))}
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
                <form className="registration-entry-form" onSubmit={submitEntry}>
                  <div className="registration-selected-contestant">
                    <CheckCircle2 />
                    <span>Registering <strong>{contestant.name}</strong></span>
                  </div>
                  <label>Position<select value={role} onChange={(change) => {
                    setRole(change.target.value as "Header" | "Heeler");
                    setPartnerId("");
                  }}>
                    {eligibleRoles.map((value) => <option key={value}>{value}</option>)}
                  </select></label>
                  {individual ? (
                    <label>Number of entries<input type="number" min={1} max={event.entriesAllowed} value={entries} onChange={(change) => setEntries(Number(change.target.value))} /></label>
                  ) : (
                    <label>Partner<select required value={partnerId} onChange={(change) => setPartnerId(change.target.value)}>
                      <option value="">Choose eligible partner</option>
                      {partners.map((partner) => <option value={partner.id} key={partner.id}>{partner.name}</option>)}
                    </select></label>
                  )}
                  <button className="primary" disabled={busy || !eligibleRoles.length || (!individual && !partnerId)}>
                    {busy ? "Saving…" : "Register contestant"}
                  </button>
                </form>
              )}
            </section>
          </div>
        )}

        {profileOpen && (
          <section className="registration-desk-panel registration-profile-panel">
            <div className="registration-desk-panel-heading">
              <div><span>Contestant database</span><h2>{profile.id ? "Edit contestant" : "Add contestant"}</h2></div>
              <button type="button" onClick={() => setProfileOpen(false)}>Cancel</button>
            </div>
            <form className="registration-profile-form" onSubmit={saveProfile}>
              <label>Full name<input required maxLength={100} value={profile.name} onChange={(change) => setProfile({ ...profile, name: change.target.value })} /></label>
              <label>Roping position<select value={profile.role} onChange={(change) => setProfile({ ...profile, role: change.target.value as Contestant["role"] })}><option>Both</option><option>Header</option><option>Heeler</option></select></label>
              <label>Header handicap<input required type="number" min={0} max={20} step={0.5} value={profile.headerHandicap} onChange={(change) => setProfile({ ...profile, headerHandicap: Number(change.target.value) })} /></label>
              <label>Heeler handicap<input required type="number" min={0} max={20} step={0.5} value={profile.heelerHandicap} onChange={(change) => setProfile({ ...profile, heelerHandicap: Number(change.target.value) })} /></label>
              <label>Email<input type="email" value={profile.email} onChange={(change) => setProfile({ ...profile, email: change.target.value })} /></label>
              <label>Phone<input type="tel" value={profile.phone} onChange={(change) => setProfile({ ...profile, phone: change.target.value })} /></label>
              <label>Hometown<input value={profile.hometown} onChange={(change) => setProfile({ ...profile, hometown: change.target.value })} /></label>
              <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save contestant"}</button>
            </form>
          </section>
        )}
        {message && <p className="registration-desk-message" role="status">{message}</p>}
      </main>
    </div>
  );
}
