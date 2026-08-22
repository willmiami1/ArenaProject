import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock3,
  Facebook,
  Instagram,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Phone,
  ShieldCheck,
  Smile,
  Trophy,
  UsersRound,
  X,
  Youtube,
} from "lucide-react";
import { seedData } from "./data";
import {
  aggregatePublicSpectatorLeaderboard,
  competitionGroup,
  parsePublicRoute,
  publicHorseNamesLabel,
  projectPublicArenaData,
  type PublicArenaData,
  type PublicCompetition,
  type PublicMeet,
  type PublicRegisteredRider,
  type PublicRoute,
  type PublicSpectatorLeaderboardRow,
} from "./publicData";
import {
  authenticateContestant,
  createContestantAccount,
  createRiderAccount,
  isWixEmbed,
  loadPublicArenaData,
  loadSignupOptions,
  publicEventSectionTargetId,
  subscribeToWixSectionNavigation,
  submitReservedSpot,
  submitSpectatorPrediction,
  updateContestantProfile,
  type ContestantPortalData,
  type ContestantProfileUpdate,
  type PublicSignupOptions,
  type PublicSignupCompetition,
  type PublicSignupSelection,
} from "./wixBridge";
import {
  createSpectatorPrediction,
  type SpectatorChoice,
} from "./spectatorPredictions";
import {
  spectatorAvatarInitials,
  spectatorIdentityInput,
  spectatorIdentityLabel,
} from "./spectatorIdentity";
import {
  effectiveActivePredictionRun,
  PublicPollGuard,
  publicRefreshInterval,
  submissionMatchesCurrentRun,
} from "./publicSpectatorSync";
import {
  publicRoleCapacityLabel,
  type PublicRopingRole,
} from "./publicRoleCapacity";
import {
  futureEventFlyers,
  pastEventWinnerFlyers,
  type PublicFlyer,
} from "./publicFlyers";
import type { ContestantAccountRequest } from "./contestantAccount";
import { resizeProfilePhoto } from "./profilePhoto";
import type { ArenaData } from "./types";
import { isBrowserStoragePreview } from "./adminAccess";

const localWorkspaceKey = "arena-command-data-v1";
const registrationLinkLabel = "Reserve your spot here or call/text Will 954-520-2631";

function loadLocalPublicData() {
  const saved = window.localStorage.getItem(localWorkspaceKey);
  if (!saved) return projectPublicArenaData(seedData);
  try {
    return projectPublicArenaData(JSON.parse(saved) as ArenaData);
  } catch (error) {
    console.error("Arena Command local workspace could not be loaded.", error);
    return projectPublicArenaData(seedData);
  }
}

const relayParameter = () => {
  const origin = new URL(window.location.href).searchParams.get("wixHostOrigin");
  return origin ? `&wixHostOrigin=${encodeURIComponent(origin)}` : "";
};
const href = (page: string, id?: string) =>
  `?page=${encodeURIComponent(page)}${id ? `&id=${encodeURIComponent(id)}` : ""}${relayParameter()}`;
const eventsHref = `${href("home")}#events`;
const liveEventsHref = `${href("home")}#events-live`;
const operationalHref = (app: "command" | "registration") => {
  if (isWixEmbed() || import.meta.env.DEV || isBrowserStoragePreview()) {
    return `?app=${app}${relayParameter()}`;
  }
  const wixOrigin = import.meta.env.VITE_WIX_HOST_ORIGIN?.trim();
  return wixOrigin
    ? `${wixOrigin.replace(/\/$/, "")}/?app=${app}`
    : `?app=${app}`;
};

// Rider sign-in shared across the portal and reservation pages for this tab.
const riderSessionKey = "arena-rider-session";
type StoredRiderSession = { email: string; pin: string };
const loadStoredRiderSession = (): StoredRiderSession | null => {
  try {
    const raw = window.sessionStorage.getItem(riderSessionKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredRiderSession>;
    return typeof parsed.email === "string" && typeof parsed.pin === "string"
      ? { email: parsed.email, pin: parsed.pin }
      : null;
  } catch {
    return null;
  }
};
const storeRiderSession = (email: string, pin: string) => {
  try {
    window.sessionStorage.setItem(riderSessionKey, JSON.stringify({ email, pin }));
  } catch {
    /* storage unavailable */
  }
};
const clearRiderSession = () => {
  try {
    window.sessionStorage.removeItem(riderSessionKey);
  } catch {
    /* storage unavailable */
  }
};

const formatDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

const formatTime = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
};

const ordinalDay = (day: number) => {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
};

const formatSignupRopingLabel = (name: string, date: string, time: string) => {
  const scheduledDate = new Date(`${date}T12:00:00`);
  const month = scheduledDate.toLocaleDateString("en-US", { month: "long" });
  return `${name} on ${month} ${ordinalDay(scheduledDate.getDate())} at ${formatTime(time)}`;
};

const initials = spectatorAvatarInitials;

function Status({ value }: { value: string }) {
  const label =
    value === "Upcoming" ? "Future" : value === "Complete" ? "Past" : value;
  return <span className={`public-status ${value.toLowerCase()}`}>{label}</span>;
}

const socialLinks = [
  {
    label: "Facebook",
    url: "https://www.facebook.com/profile.php?id=61590614630641",
    Icon: Facebook,
  },
  {
    label: "Instagram",
    url: "https://www.instagram.com/destinyrancharena?igsh=bHZvd3oxa3ZzaW5m",
    Icon: Instagram,
  },
  {
    label: "YouTube",
    url: "https://www.youtube.com/@destinyranchvideos-hp9im",
    Icon: Youtube,
  },
];

function SocialLinks() {
  return (
    <span className="public-social-links">
      {socialLinks.map(({ label, url, Icon }) => (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Destiny Ranch Arena on ${label}`}
          title={label}
          key={label}
        >
          <Icon size={18} />
        </a>
      ))}
    </span>
  );
}

function PublicHeader({ liveCompetitionId }: { liveCompetitionId?: string }) {
  const [open, setOpen] = useState(false);
  const spectatorGameHref = liveCompetitionId
    ? href("spectator", liveCompetitionId)
    : liveEventsHref;
  return (
    <header className="public-header public-main-header">
      <div className="public-header-row">
        <a className="public-brand" href={href("home")} aria-label="Destiny Ranch Arena home">
          <img src="./destiny-ranch-arena-logo.png" alt="" />
          <strong>Destiny Ranch Arena</strong>
        </a>
        <button
          className="public-menu"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="public-navigation"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X /> : <Menu />}
        </button>
        <nav id="public-navigation" className={open ? "open" : ""} aria-label="Public navigation">
          <a href={href("home")} onClick={() => setOpen(false)}>Home</a>
          <a href={eventsHref} onClick={() => setOpen(false)}>Events</a>
          <a href={href("rider")} onClick={() => setOpen(false)}><LogIn size={16} /> Rider login</a>
          <a href={operationalHref("command")} onClick={() => setOpen(false)}><ShieldCheck size={16} /> Admin login</a>
          <SocialLinks />
        </nav>
      </div>
      <div className="public-header-actions" aria-label="Rider and spectator actions">
        <a className="public-header-cta" href={href("rider")}>
          <LogIn size={16} /> RIDER LOG IN
        </a>
        <a className="public-header-cta" href={href("rider-account")}>
          <UsersRound size={16} /> CREATE A RIDER ACCOUNT
        </a>
        <a className="public-header-game" href={spectatorGameHref} aria-label="Play Cowboy x Steers during live competitions">
          <img src="./play-cowboy-x-steers-banner.png" alt="During live competitions — play Cowboy x Steers" />
        </a>
      </div>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="public-footer">
      <div>
        <img src="./destiny-ranch-arena-logo.png" alt="" />
        <p><strong>Destiny Ranch Arena</strong><br />Where partners, horses, and competition meet.</p>
      </div>
      <nav aria-label="Footer navigation">
        <a href={href("home")}>Home</a>
        <a href={eventsHref}>Events</a>
        <a href={href("rider")}>Rider login</a>
        <a href={operationalHref("command")}>Admin login</a>
      </nav>
      <div className="public-footer-connect">
        <SocialLinks />
        <small>Official schedules and results are published by arena staff.</small>
      </div>
    </footer>
  );
}

function ReturnToEventsLink() {
  return <a href={eventsHref}>← Return to Events on Main Page</a>;
}

function RopingCard({
  competition,
  scheduleOnly = false,
}: {
  competition: PublicCompetition;
  scheduleOnly?: boolean;
}) {
  return (
    <article className={`public-event-card${competition.status === "Live" ? " live" : ""}`}>
      <div className="public-date-block">
        <span>{new Date(`${competition.date}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</span>
        <strong>{competition.date.slice(-2)}</strong>
      </div>
      <div className="public-event-copy">
        <div className="public-card-topline">
          <Status value={competition.status} />
          <span>{competition.competitionLabel}</span>
        </div>
        <h3>
          {scheduleOnly && !competition.resultsPublished
            ? competition.name
            : <a href={href("competition", competition.id)}>{competition.name}</a>}
        </h3>
        <p><MapPin size={15} /> {competition.location}</p>
        <p><Clock3 size={15} /> {formatTime(competition.startTime)}</p>
        {scheduleOnly &&
          competition.status === "Upcoming" &&
          competition.description.trim() && (
            <p className="public-event-description">{competition.description}</p>
          )}
        <div className="public-card-badges">
          {competition.registrationOpen && (
            <a href={href("signup", competition.id)}>
              {registrationLinkLabel}
            </a>
          )}
          {!scheduleOnly && (
            <span>{competition.entryCount} entr{competition.entryCount === 1 ? "y" : "ies"}</span>
          )}
        </div>
        {!scheduleOnly && (
          <a className="public-text-link" href={href("competition", competition.id)}>Roping details <ArrowRight size={16} /></a>
        )}
        {scheduleOnly && competition.resultsPublished && (
          <a className="public-text-link" href={`${href("competition", competition.id)}#results`}>
            View published results <Trophy size={16} />
          </a>
        )}
        {!scheduleOnly && competition.registrationOpen && (
          <a className="public-button compact" href={href("signup", competition.id)}>
            {registrationLinkLabel}
          </a>
        )}
        <div className="public-registered-roster homepage">
          <h4 className="public-registered-title">Registered Riders</h4>
          <RiderRoleRoster
            label="Headers"
            riders={competition.registeredRiders?.headers ?? []}
            capacity={competition.roleCapacities?.find(
              ({ role }) => role === "Header",
            )}
          />
          <RiderRoleRoster
            label="Heelers"
            riders={competition.registeredRiders?.heelers ?? []}
            capacity={competition.roleCapacities?.find(
              ({ role }) => role === "Heeler",
            )}
          />
        </div>
      </div>
      {competition.status === "Live" && (
        <aside className="public-live-actions">
          <a className="public-live-results" href={`${href("competition", competition.id)}#results`}>
            <Trophy size={22} />
            <strong>Results</strong>
            <span>{competition.resultsPublished ? "View live standings" : "Standings pending"}</span>
          </a>
          <a className="public-button compact" href={href("spectator", competition.id)}>
            Play Cowboys x Steers
          </a>
        </aside>
      )}
    </article>
  );
}

function SpectatorPage({
  competition,
  onLocalUpdate,
  refreshWarning,
}: {
  competition?: PublicCompetition;
  onLocalUpdate: (data: PublicArenaData) => void;
  refreshWarning?: string;
}) {
  const [name, setName] = useState(
    () =>
      spectatorIdentityInput(
        window.sessionStorage.getItem("arena-spectator-name") ?? "",
      ),
  );
  const [choice, setChoice] = useState<SpectatorChoice>("cowboys");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [roundAnnouncement, setRoundAnnouncement] = useState("");
  const selectedRun = effectiveActivePredictionRun(competition);
  const activeRound =
    selectedRun?.round ??
    Math.max(
      1,
      ...(competition?.spectatorLeaderboards.map((row) => row.round) ?? []),
    );
  useEffect(() => {
    window.sessionStorage.removeItem("arena-spectator-phone");
  }, []);
  useEffect(() => {
    const spectatorName = name.trim();
    if (spectatorName) {
      window.sessionStorage.setItem("arena-spectator-name", name);
    } else {
      window.sessionStorage.removeItem("arena-spectator-name");
    }
  }, [name]);
  const activeRunKey = `${competition?.id ?? ""}:${selectedRun?.id ?? ""}:${selectedRun?.round ?? ""}`;
  useEffect(() => {
    setChoice("cowboys");
    setMessage("");
    setRoundAnnouncement(
      selectedRun && selectedRun.round > 1
        ? `A new run is active — Round ${selectedRun.round}`
        : "",
    );
  }, [activeRunKey, selectedRun?.round]);
  const teamId = selectedRun?.id ?? "";
  const currentRunIdRef = useRef(teamId);
  currentRunIdRef.current = teamId;
  if (!competition || competition.status !== "Live") {
    return <NotFound />;
  }
  const selectedRunOpen = Boolean(selectedRun?.open);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const submittedValue = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    const submittedRunId = teamId;
    const submittedChoice: SpectatorChoice = submittedValue === "steer" ? "steer" : "cowboys";
    setChoice(submittedChoice);
    setBusy(true);
    setMessage("");
    try {
      let result;
      if (isWixEmbed()) {
        result = await submitSpectatorPrediction({
          name,
          eventId: competition.id,
          teamId,
          choice: submittedChoice,
        });
        if (!result) throw new Error("Prediction could not be saved.");
        const responseRunId = effectiveActivePredictionRun(
          result.publicData.competitions.find((item) => item.id === competition.id),
        )?.id;
        if (
          !submissionMatchesCurrentRun(
            submittedRunId,
            currentRunIdRef.current,
            responseRunId,
          )
        ) return;
      } else {
        const saved = window.localStorage.getItem(localWorkspaceKey);
        const workspace = saved
          ? (JSON.parse(saved) as ArenaData)
          : structuredClone(seedData);
        workspace.spectators ??= [];
        workspace.spectatorPredictions ??= [];
        const created = createSpectatorPrediction(workspace, {
          name,
          eventId: competition.id,
          teamId,
          choice: submittedChoice,
        });
        workspace.spectators = created.spectators;
        workspace.spectatorPredictions = created.spectatorPredictions;
        window.localStorage.setItem(
          localWorkspaceKey,
          JSON.stringify(workspace),
        );
        onLocalUpdate(projectPublicArenaData(workspace));
        result = {
          spectatorName: created.spectator.name,
          existing: created.existing,
        };
      }
      window.sessionStorage.setItem("arena-spectator-name", name.trim());
      setMessage(
        result.existing
          ? "Your pick for this run was already recorded."
          : `Pick saved for ${result.spectatorName}.`,
      );
    } catch (error) {
      if (submittedRunId !== currentRunIdRef.current) return;
      setMessage(error instanceof Error ? error.message : "Prediction could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="public-spectator">
      <ReturnToEventsLink />
      <div className="public-page-head">
        <Status value="Live" />
        <h1>Pick the run.</h1>
        <p>Free spectator predictions for {competition.name}. One point is awarded when your Steer or Cowboys pick matches the official run result.</p>
      </div>
      {refreshWarning && (
        <p className="public-form-message" role="status">
          {refreshWarning}
        </p>
      )}
      <div className="public-spectator-grid">
        <form onSubmit={submit}>
          {roundAnnouncement && (
            <div className="public-round-announcement" role="status">
              {roundAnnouncement}
            </div>
          )}
          <h2 className="public-play-title">
            <span>Play</span>
            <strong>Cowboys × Steer</strong>
          </h2>
          <label>
            Enter name or avatar to play
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) =>
                setName(spectatorIdentityInput(event.target.value))
              }
              autoCapitalize="characters"
              className="public-spectator-name"
              placeholder="Name or avatar"
            />
          </label>
          {selectedRunOpen && selectedRun?.closesAt && (
            <p className="public-pick-cutoff">Picks close {new Date(selectedRun.closesAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
          )}
          {selectedRun && !selectedRunOpen && (
            <p className="public-pick-cutoff">Spectator picks are closed for this team.</p>
          )}
          {selectedRun && (
            <fieldset className="public-pick-choices">
              <legend>Choose who wins this run</legend>
              <label className={`public-pick-card${choice === "cowboys" ? " selected" : ""}`}>
                <input
                  type="radio"
                  name="spectator-pick"
                  checked={choice === "cowboys"}
                  onChange={() => setChoice("cowboys")}
                />
                <span className="public-cowboy-roster">
                  <span className="public-cowboy-rider">
                    <small>Header</small>
                    <span className="public-cowboy-avatar">
                      {selectedRun.headerPhoto
                        ? <img src={selectedRun.headerPhoto} alt={`${selectedRun.headerName} profile`} />
                        : <span aria-hidden="true">{initials(selectedRun.headerName)}</span>}
                    </span>
                    <strong>{spectatorIdentityLabel(selectedRun.headerName)}</strong>
                  </span>
                  <span className="public-cowboy-rider">
                    <small>Heeler</small>
                    <span className="public-cowboy-avatar">
                      {selectedRun.heelerPhoto
                        ? <img src={selectedRun.heelerPhoto} alt={`${selectedRun.heelerName} profile`} />
                        : <span aria-hidden="true">{initials(selectedRun.heelerName)}</span>}
                    </span>
                    <strong>{spectatorIdentityLabel(selectedRun.heelerName)}</strong>
                  </span>
                </span>
                <span className="public-cowboy-team-label">Cowboy Team</span>
              </label>
              <label className={`public-pick-card steer${choice === "steer" ? " selected" : ""}`}>
                <input
                  type="radio"
                  name="spectator-pick"
                  checked={choice === "steer"}
                  onChange={() => setChoice("steer")}
                />
                <span className="public-steer-picture">
                  <img src="./spectator-steer.png" alt="Steer running in the arena" />
                </span>
                <span className="public-steer-label">Steer</span>
              </label>
            </fieldset>
          )}
          {!selectedRun && <p className="public-empty">Waiting for the next cowboy team.</p>}
          <div className="public-pick-buttons">
            <button className="public-button" type="submit" value="cowboys" disabled={busy || !teamId || !selectedRunOpen}>
              {busy ? "Saving…" : "Choose Cowboys"}
            </button>
            <button className="public-button" type="submit" value="steer" disabled={busy || !teamId || !selectedRunOpen}>
              {busy ? "Saving…" : "Choose Steer"}
            </button>
          </div>
          {message && <p className="public-form-message" role="status">{message}</p>}
        </form>
        <div className="public-spectator-leaders">
          <h2>Round {activeRound} leaderboard</h2>
          <section>
            {competition.spectatorLeaderboards
              .filter((row) => row.round === activeRound)
              .map((row, index) => (
                <div
                  className="public-spectator-row"
                  key={`${activeRound}-${index}-${row.name}`}
                >
                  <strong>{index + 1}</strong>
                  <span>{row.name}</span>
                  <b>{row.correct} pts</b>
                </div>
              ))}
            {!competition.spectatorLeaderboards.some(
              (row) => row.round === activeRound,
            ) && <p>No scored picks yet.</p>}
          </section>
        </div>
      </div>
    </section>
  );
}

type PublicAccountDraft = Omit<ContestantAccountRequest, "name"> & {
  firstName: string;
  lastName: string;
  confirmPin: string;
};

const contestantAccountRequest = ({
  firstName,
  lastName,
  confirmPin: _confirmPin,
  ...account
}: PublicAccountDraft): ContestantAccountRequest => ({
  ...account,
  name: `${firstName.trim()} ${lastName.trim()}`,
});

function RiderAccountPage() {
  const [account, setAccount] = useState<PublicAccountDraft>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    hometown: "",
    horseName: "",
    role: "Both",
    headerHandicap: 3,
    heelerHandicap: 3,
    pin: "",
    confirmPin: "",
  });
  const [busy, setBusy] = useState(false);
  const accountSubmissionInFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (accountSubmissionInFlight.current) return;
    accountSubmissionInFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (account.pin !== account.confirmPin) {
        throw new Error("PIN confirmation does not match.");
      }
      const result = await createRiderAccount(contestantAccountRequest(account));
      if (!result) throw new Error("Rider account could not be created.");
      setCreated(true);
      setMessage(`Welcome, ${result.name}. Your rider account is ready.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Rider account could not be created.",
      );
    } finally {
      accountSubmissionInFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="public-signup">
      <a href={href("home")}>← Return home</a>
      <h1>Create Rider Account</h1>
      <p>Create your secure rider profile now, then use the same email and four-digit PIN for eligible online entries.</p>
      {created ? (
        <div className="public-confirmation" role="status">
          <CheckCircle2 size={28} />
          <h2>Account created</h2>
          <p>{message}</p>
          <a className="public-button" href={eventsHref}>View event schedule</a>
        </div>
      ) : (
        <form className="public-account-form" onSubmit={submit}>
          <label>First name<input required maxLength={50} autoComplete="given-name" autoCapitalize="characters" value={account.firstName} onChange={(event) => setAccount({ ...account, firstName: event.target.value.toUpperCase() })} /></label>
          <label>Last name<input required maxLength={50} autoComplete="family-name" autoCapitalize="characters" value={account.lastName} onChange={(event) => setAccount({ ...account, lastName: event.target.value.toUpperCase() })} /></label>
          <label>Email address<input required type="email" autoComplete="email" value={account.email} onChange={(event) => setAccount({ ...account, email: event.target.value.toLowerCase() })} /></label>
          <label>Phone number<input required type="tel" autoComplete="tel" value={account.phone} onChange={(event) => setAccount({ ...account, phone: event.target.value })} /></label>
          <label>Hometown<input maxLength={100} autoComplete="address-level2" autoCapitalize="characters" value={account.hometown} onChange={(event) => setAccount({ ...account, hometown: event.target.value.toUpperCase() })} /></label>
          <label>Horse name (optional)<input maxLength={100} autoCapitalize="characters" value={account.horseName ?? ""} onChange={(event) => setAccount({ ...account, horseName: event.target.value.toUpperCase() })} /></label>
          <label>Roping position<select value={account.role} onChange={(event) => setAccount({ ...account, role: event.target.value as ContestantAccountRequest["role"] })}><option>Both</option><option>Header</option><option>Heeler</option></select></label>
          <label>Header handicap<input required type="number" min={0} max={20} step={0.5} value={account.headerHandicap} onChange={(event) => setAccount({ ...account, headerHandicap: Number(event.target.value) })} /></label>
          <label>Heeler handicap<input required type="number" min={0} max={20} step={0.5} value={account.heelerHandicap} onChange={(event) => setAccount({ ...account, heelerHandicap: Number(event.target.value) })} /></label>
          <label>Four-digit PIN<input required type="password" inputMode="numeric" autoComplete="one-time-code" pattern="\d{4}" maxLength={4} value={account.pin} onChange={(event) => setAccount({ ...account, pin: event.target.value.replace(/\D/g, "").slice(0, 4) })} /></label>
          <label>Confirm PIN<input required type="password" inputMode="numeric" autoComplete="one-time-code" pattern="\d{4}" maxLength={4} value={account.confirmPin} onChange={(event) => setAccount({ ...account, confirmPin: event.target.value.replace(/\D/g, "").slice(0, 4) })} /></label>
          {message && <p className="public-form-message" role="alert">{message}</p>}
          <button className="public-button" disabled={busy}>{busy ? "Creating account…" : "Create Rider Account"}</button>
        </form>
      )}
    </section>
  );
}

type RiderProfileDraft = {
  name: string;
  email: string;
  phone: string;
  hometown: string;
  role: ContestantProfileUpdate["role"];
  photo: string;
  clearPhoto: boolean;
  horses: string[];
  newPin: string;
  confirmNewPin: string;
};

const riderProfileDraft = (
  contestant: ContestantPortalData["contestant"],
): RiderProfileDraft => ({
  name: contestant.name,
  email: contestant.email ?? "",
  phone: contestant.phone ?? "",
  hometown: contestant.hometown ?? "",
  role: contestant.role,
  photo: contestant.photo ?? "",
  clearPhoto: false,
  horses: contestant.horses ?? [],
  newPin: "",
  confirmNewPin: "",
});

function RiderPage({ data }: { data: PublicArenaData | null }) {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [session, setSession] =
    useState<{ email: string; pin: string } | null>(null);
  const [portal, setPortal] = useState<ContestantPortalData | null>(null);
  const [draft, setDraft] = useState<RiderProfileDraft | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [horseName, setHorseName] = useState("");

  useEffect(() => {
    const stored = loadStoredRiderSession();
    if (!stored || !isWixEmbed()) return;
    let cancelled = false;
    setBusy(true);
    authenticateContestant(stored.email, stored.pin)
      .then((result) => {
        if (cancelled || !result) return;
        setEmail(stored.email);
        setSession(stored);
        setPortal(result);
        setDraft(riderProfileDraft(result.contestant));
      })
      .catch(() => {
        if (!cancelled) clearRiderSession();
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addHorse = () => {
    if (!draft) return;
    const name = horseName.trim().replace(/\s+/g, " ").toUpperCase();
    if (
      !name ||
      draft.horses.length >= 20 ||
      draft.horses.some((horse) => horse.toLowerCase() === name.toLowerCase())
    ) return;
    setDraft({ ...draft, horses: [...draft.horses, name] });
    setHorseName("");
  };

  const handlePhoto = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Choose an image file.");
      return;
    }
    try {
      const photo = await resizeProfilePhoto(file);
      setDraft((current) =>
        current ? { ...current, photo, clearPhoto: false } : current,
      );
      setPhotoError("");
    } catch {
      setPhotoError("The photo could not be loaded.");
    }
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (!isWixEmbed()) {
        throw new Error("Rider login is available on the Destiny Ranch Arena Wix site.");
      }
      const result = await authenticateContestant(email, pin);
      if (!result) throw new Error("Rider login did not return a profile.");
      setSession({ email, pin });
      setPortal(result);
      setDraft(riderProfileDraft(result.contestant));
      storeRiderSession(email, pin);
      setPin("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    clearRiderSession();
    setSession(null);
    setPortal(null);
    setDraft(null);
    setProfileMessage("");
    setMessage("");
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || !draft || profileBusy) return;
    setProfileBusy(true);
    setProfileMessage("");
    setProfileError(false);
    try {
      if (draft.newPin && draft.newPin !== draft.confirmNewPin) {
        throw new Error("PIN confirmation does not match.");
      }
      const result = await updateContestantProfile(session.email, session.pin, {
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        hometown: draft.hometown,
        role: draft.role,
        photo: draft.photo,
        clearPhoto: draft.clearPhoto,
        horses: draft.horses,
        ...(draft.newPin ? { newPin: draft.newPin } : {}),
      });
      if (!result) throw new Error("Profile update did not return a result.");
      setPortal(result);
      setSession({
        email: result.contestant.email ?? draft.email,
        pin: draft.newPin || session.pin,
      });
      storeRiderSession(
        result.contestant.email ?? draft.email,
        draft.newPin || session.pin,
      );
      setDraft(riderProfileDraft(result.contestant));
      setProfileMessage("Profile saved. Use your updated email and PIN next time you sign in.");
    } catch (error) {
      setProfileError(true);
      setProfileMessage(
        error instanceof Error ? error.message : "Profile could not be saved.",
      );
    } finally {
      setProfileBusy(false);
    }
  };

  if (!portal || !session || !draft) {
    return (
      <section className="public-signup">
        <a href={href("home")}>← Return home</a>
        <h1>Rider Log In</h1>
        <p>Sign in with the email and four-digit PIN from your rider account to enter ropings, review your results, and update your profile.</p>
        <form className="public-account-form public-rider-login" onSubmit={login}>
          <label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value.toLowerCase())} /></label>
          <label>Four-digit PIN<input required type="password" inputMode="numeric" autoComplete="current-password" pattern="\d{4}" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
          {message && <p className="public-form-message" role="alert">{message}</p>}
          <button className="public-button" disabled={busy}>{busy ? "Signing in…" : <><LogIn size={16} /> Sign in</>}</button>
        </form>
        <p className="public-rider-create">No account yet? <a href={href("rider-account")}>Create a rider account</a>.</p>
      </section>
    );
  }

  const eventName = (eventId: string) =>
    portal.events.find((event) => event.id === eventId)?.name ?? "Competition";
  const riderName = (id: string) =>
    (portal.contestant.id === id
      ? portal.contestant.name
      : portal.contestants.find((contestant) => contestant.id === id)?.name) ??
    "Unknown";
  const sortedTeams = [...portal.teams].sort(
    (a, b) =>
      eventName(a.eventId).localeCompare(eventName(b.eventId)) ||
      a.round - b.round ||
      a.drawPosition - b.drawPosition,
  );
  const allCompetitions =
    data?.competitions ?? data?.meets.flatMap((meet) => meet.competitions) ?? [];
  const openRopings = allCompetitions.filter(
    (competition) => competition.registrationOpen,
  );
  const finalPlacements = allCompetitions.flatMap((competition) =>
    competition.resultsPublished
      ? competition.results
          .filter(
            (row) =>
              row.headerName === portal.contestant.name ||
              row.heelerName === portal.contestant.name,
          )
          .map((row) => ({ competition, row }))
      : [],
  );

  return (
    <section className="public-rider">
      <header className="public-rider-header">
        <div>
          <span className="public-rider-eyebrow">Rider account</span>
          <h1>{portal.contestant.name}</h1>
          <p>{portal.contestant.email}</p>
        </div>
        <button className="public-button compact" onClick={signOut}><LogOut size={16} /> Sign out</button>
      </header>

      <div className="public-rider-panel">
        <h2>Reserve your spot</h2>
        {openRopings.length ? (
          <div className="public-rider-list">
            {openRopings.map((competition) => (
              <div className="public-rider-row" key={competition.id}>
                <div><strong>{competition.name}</strong><small>{competition.date} · {competition.location}</small></div>
                <a className="public-button compact" href={href("signup", competition.id)}>Reserve <ArrowRight size={15} /></a>
              </div>
            ))}
          </div>
        ) : (
          <p className="public-rider-empty">No ropings are accepting online entries right now. Check the <a href={eventsHref}>event schedule</a>.</p>
        )}
      </div>

      <div className="public-rider-panel">
        <h2>My results and participations</h2>
        {finalPlacements.length > 0 && (
          <div className="public-rider-list public-rider-placements">
            {finalPlacements.map(({ competition, row }) => (
              <div className="public-rider-row" key={`${competition.id}-${row.place}`}>
                <div><strong>{competition.name}</strong><small>Final classification · {row.rounds} round{row.rounds === 1 ? "" : "s"}</small></div>
                <div className="public-rider-partners"><small>Header</small><span>{row.headerName}</span><small>Heeler</small><span>{row.heelerName}</span></div>
                <strong className="public-rider-result">{ordinalDay(row.place)} place · {row.officialTotal === null ? "No time" : `${row.officialTotal.toFixed(2)}s`}</strong>
              </div>
            ))}
          </div>
        )}
        <div className="public-rider-list">
          {sortedTeams.map((team) => (
            <div className="public-rider-row" key={team.id}>
              <div><strong>{eventName(team.eventId)}</strong><small>Round {team.round} · Draw #{team.drawPosition}</small></div>
              <div className="public-rider-partners"><small>Header</small><span>{riderName(team.headerId)}</span><small>Heeler</small><span>{riderName(team.heelerId)}</span></div>
              <strong className="public-rider-result">{team.status === "complete" && team.rawTime !== null ? `${(team.rawTime + team.penalties).toFixed(2)}s` : team.status === "no-time" ? "No time" : team.rolled ? "Rolled" : "Ready"}</strong>
            </div>
          ))}
          {!sortedTeams.length && <p className="public-rider-empty">No team runs are on record yet.</p>}
        </div>
        {portal.registrations.length > 0 && (
          <div className="public-rider-list public-rider-registrations">
            {portal.registrations.map((registration) => (
              <div className="public-rider-row" key={registration.id}>
                <div><strong>{eventName(registration.eventId)}</strong><small>Draw-pot entry</small></div>
                <span>{registration.role} · {registration.entries} entr{registration.entries === 1 ? "y" : "ies"}</span>
                <span className="public-rider-status">{registration.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="public-rider-panel">
        <h2>My profile</h2>
        <form className="public-account-form" onSubmit={saveProfile}>
          <div className="public-rider-photo">
            <div className="public-rider-photo-preview">
              {draft.photo ? <img src={draft.photo} alt="Profile preview" /> : <Camera size={22} />}
            </div>
            <div>
              <strong>Profile picture</strong>
              <p>Shown on the arena screens with your runs.</p>
              <label className="public-rider-photo-button">
                {draft.photo ? "Change picture" : "Choose picture"}
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void handlePhoto(event.target.files?.[0])} />
              </label>
              {draft.photo && <button type="button" className="public-rider-photo-remove" onClick={() => { setDraft({ ...draft, photo: "", clearPhoto: true }); setPhotoError(""); }}>Remove</button>}
              {photoError && <span className="public-rider-photo-error" role="alert">{photoError}</span>}
            </div>
          </div>
          <label>Full name<input required maxLength={100} autoCapitalize="characters" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value.toUpperCase() })} /></label>
          <label>Email address<input required type="email" autoComplete="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value.toLowerCase() })} /></label>
          <label>Phone number<input required type="tel" autoComplete="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
          <label>Hometown<input maxLength={100} autoCapitalize="characters" value={draft.hometown} onChange={(event) => setDraft({ ...draft, hometown: event.target.value.toUpperCase() })} /></label>
          <label>Roping position<select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as ContestantProfileUpdate["role"] })}><option>Both</option><option>Header</option><option>Heeler</option></select></label>
          <div className="public-rider-horses">
            <strong>My horses</strong>
            <p>Add every horse you ride so they can be listed with your entries.</p>
            <div className="public-rider-horse-entry">
              <input
                maxLength={100}
                value={horseName}
                autoCapitalize="characters"
                placeholder="Horse name"
                onChange={(event) => setHorseName(event.target.value.toUpperCase())}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addHorse(); } }}
              />
              <button type="button" className="public-rider-horse-add" onClick={addHorse}>Add horse</button>
            </div>
            <div className="public-rider-horse-list">
              {draft.horses.map((horse) => (
                <span key={horse}>
                  {horse}
                  <button type="button" title={`Remove ${horse}`} onClick={() => setDraft({ ...draft, horses: draft.horses.filter((name) => name !== horse) })}><X size={13} /></button>
                </span>
              ))}
              {!draft.horses.length && <small>No horses added.</small>}
            </div>
          </div>
          <label>New PIN (optional)<input type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4}" maxLength={4} value={draft.newPin} onChange={(event) => setDraft({ ...draft, newPin: event.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="Keep current PIN" /></label>
          {draft.newPin && (
            <label>Confirm new PIN<input required type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4}" maxLength={4} value={draft.confirmNewPin} onChange={(event) => setDraft({ ...draft, confirmNewPin: event.target.value.replace(/\D/g, "").slice(0, 4) })} /></label>
          )}
          {profileMessage && <p className={`public-form-message${profileError ? "" : " success"}`} role={profileError ? "alert" : "status"}>{profileMessage}</p>}
          <button className="public-button" disabled={profileBusy}>{profileBusy ? "Saving…" : "Save profile"}</button>
        </form>
        <p className="public-rider-note">Handicaps are managed by the event producer.</p>
      </div>
    </section>
  );
}

function EventExplorer({
  data,
  scheduleOnly = false,
}: {
  data: PublicArenaData;
  scheduleOnly?: boolean;
}) {
  const groups = [
    { key: "live", title: "Current Events", empty: "No competitions are live right now." },
    { key: "future", title: "Future Events", empty: "The next event will be posted soon." },
    { key: "past", title: "Past Events", empty: "Completed events will appear here." },
  ] as const;
  const ropings =
    data.competitions ?? data.meets.flatMap((meet) => meet.competitions);
  return (
    <section className="public-event-explorer" id="events">
      <div className="public-section-heading">
        <div><span>Destiny Ranch Arena</span><h2>{scheduleOnly ? "Event schedule" : "Events"}</h2></div>
        <span>{scheduleOnly ? "Published by arena staff" : "Choose an event book"}</span>
      </div>
      <nav className="public-event-tabs" aria-label="Event date groups">
        {groups.map((group) => {
          const count = ropings.filter(
            (competition) => competitionGroup(competition.status) === group.key,
          ).length;
          return (
            <a href={`#events-${group.key}`} key={group.key}>
              <span>{group.title}</span><small>{count}</small>
            </a>
          );
        })}
      </nav>
      <div className="public-event-groups">
        {groups.map((group) => {
          const competitions = ropings
            .filter(
              (competition) =>
                competitionGroup(competition.status) === group.key,
            )
            .sort((left, right) => {
              const comparison = `${left.date}T${left.startTime}`.localeCompare(
                `${right.date}T${right.startTime}`,
              );
              return group.key === "past" ? -comparison : comparison;
            });
          return (
            <section className="public-event-tab-panel" id={`events-${group.key}`} key={group.key}>
              <h3>{group.title}</h3>
              {competitions.length ? (
                <div className="public-event-grid">{competitions.map((competition) => <RopingCard competition={competition} scheduleOnly={scheduleOnly} key={competition.id} />)}</div>
              ) : (
                <p className="public-empty">{group.empty}</p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function FlyerGallery({
  headingId,
  eyebrow,
  title,
  description,
  flyers,
}: {
  headingId: string;
  eyebrow: string;
  title: string;
  description: string;
  flyers: PublicFlyer[];
}) {
  return (
    <section className="public-flyers" aria-labelledby={headingId}>
      <div className="public-flyers-heading">
        <span>{eyebrow}</span>
        <h2 id={headingId}>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="public-flyer-grid">
        {flyers.map((flyer) => (
          <a href={flyer.src} target="_blank" rel="noreferrer" key={flyer.src}>
            <img src={flyer.src} alt={flyer.alt} loading="lazy" />
          </a>
        ))}
      </div>
    </section>
  );
}

function HomePage({
  data,
  scheduleError,
}: {
  data: PublicArenaData | null;
  scheduleError: string;
}) {
  return (
    <>
      <section className="public-hero">
        <div className="public-hero-copy">
          <h1>The gate opens.<br />The clock starts.<br /><em>Ride your run.</em></h1>
          <p>Team roping events, online entries, and official results from Destiny Ranch Arena.</p>
        </div>
        <figure className="public-hero-media">
          <img
            src="./team-roping-hero.png"
            alt="Header and heeler chasing a steer under the arena lights"
          />
        </figure>
        <section className="public-trust-strip">
          <div><ShieldCheck /><strong>Official arena data</strong><span>Schedules and results published by event staff.</span></div>
          <div><UsersRound /><strong>Built for contestants</strong><span>Use your existing account to enter eligible competitions.</span></div>
          <div><Smile /><strong>Built for spectators</strong><span>Come and be part of the event with family and friends.</span></div>
          <div><Trophy /><strong>Results worth keeping</strong><span>Published averages show every qualified round.</span></div>
        </section>
      </section>
      {data ? (
        <EventExplorer data={data} scheduleOnly />
      ) : (
        <section className="public-event-explorer" id="events">
          <div className="public-section-heading">
            <div><span>Destiny Ranch Arena</span><h2>Event schedule</h2></div>
          </div>
          <p className="public-empty" role="status">
            {scheduleError || "Loading the event schedule…"}
          </p>
        </section>
      )}
      <FlyerGallery
        headingId="future-events-title"
        eyebrow="Save the date"
        title="Future events"
        description="Open a flyer to view it full size."
        flyers={futureEventFlyers}
      />
      <FlyerGallery
        headingId="past-event-winners-title"
        eyebrow="Winners circle"
        title="Past event winners"
        description="Open the winners flyer to view it full size."
        flyers={pastEventWinnerFlyers}
      />
      <section className="public-contact" aria-labelledby="arena-contact-title">
        <div className="public-contact-heading">
          <span>Visit the ranch</span>
          <h2 id="arena-contact-title">Destiny Ranch Arena</h2>
          <p>Questions about an event or online entry? Contact our arena team.</p>
        </div>
        <address className="public-contact-details">
          <a
            href="https://www.google.com/maps/search/?api=1&query=2549+E+C+476+Bushnell+FL+33513"
            target="_blank"
            rel="noreferrer"
          >
            <MapPin />
            <span><strong>Address</strong>2549 E C 476<br />Bushnell, FL 33513</span>
          </a>
          <a href="tel:+19545202631">
            <Phone />
            <span><strong>Phone</strong>954-520-2631</span>
          </a>
          <a href="mailto:admin@destinyranchevents.com">
            <Mail />
            <span><strong>Email</strong>admin@destinyranchevents.com</span>
          </a>
        </address>
        <div className="public-contact-map">
          <iframe
            title="Destiny Ranch Arena location on Google Maps"
            src="https://www.google.com/maps?q=2549+E+C+476,+Bushnell,+FL+33513&output=embed"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <a
            className="public-button"
            href="https://www.google.com/maps/dir/?api=1&destination=2549+E+C+476+Bushnell+FL+33513"
            target="_blank"
            rel="noreferrer"
          >
            <MapPin size={18} /> Open Directions in Google Maps
          </a>
        </div>
      </section>
    </>
  );
}

function CompetitionRow({ competition }: { competition: PublicCompetition }) {
  return (
    <article className="public-competition-row">
      <div>
        <Status value={competition.status} />
        <h3><a href={href("competition", competition.id)}>{competition.name}</a></h3>
        <p>{competition.competitionLabel} · {competition.rounds} round{competition.rounds === 1 ? "" : "s"} · ${competition.entryFee}</p>
      </div>
      <div className="public-competition-actions">
        {competition.registrationOpen && competition.status !== "Complete" && !competition.drawLocked && (
          <a className="public-button compact" href={href("signup", competition.id)}>{registrationLinkLabel}</a>
        )}
        {competition.resultsPublished && <a href={href("competition", competition.id)}>View results</a>}
        {!competition.resultsPublished && competition.status === "Complete" && <span>Results pending</span>}
      </div>
      <div className="public-registered-roster">
        <RiderRoleRoster
          label="Headers"
          riders={competition.registeredRiders?.headers ?? []}
          capacity={competition.roleCapacities?.find(
            ({ role }) => role === "Header",
          )}
        />
        <RiderRoleRoster
          label="Heelers"
          riders={competition.registeredRiders?.heelers ?? []}
          capacity={competition.roleCapacities?.find(
            ({ role }) => role === "Heeler",
          )}
        />
      </div>
    </article>
  );
}

function RiderRoleRoster({
  label,
  riders,
  capacity,
}: {
  label: "Headers" | "Heelers";
  riders: PublicRegisteredRider[];
  capacity?: {
    role: PublicRopingRole;
    registered: number;
    maximum: number;
    full: boolean;
  };
}) {
  const capacityLabel = publicRoleCapacityLabel(capacity);
  return (
    <section
      className="public-rider-role"
      aria-label={`${label} registered riders`}
    >
      <h4>
        {label}
        {capacity && <span> · {capacity.registered} registered</span>}
        {capacityLabel && <span> · {capacityLabel}</span>}
      </h4>
      {riders.length ? (
        <ul aria-label={`Registered ${label.toLowerCase()}`}>
          {riders.map((rider) => (
            <li key={rider.id}>
              {rider.photo ? (
                <img src={rider.photo} alt="" />
              ) : (
                <span className="public-rider-initials" aria-hidden="true">
                  {initials(rider.name)}
                </span>
              )}
              <span className="public-rider-copy">
                <strong>{rider.name}</strong>
                {publicHorseNamesLabel(rider.horseNames ?? []) && (
                  <small>{publicHorseNamesLabel(rider.horseNames ?? [])}</small>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No {label.toLowerCase()} registered yet.</p>
      )}
    </section>
  );
}

function EventPage({ meet }: { meet?: PublicMeet }) {
  if (!meet) return <NotFound />;
  return (
    <>
      <section className="public-page-head">
        <ReturnToEventsLink />
        <h1>{meet.name}</h1>
        <div className="public-page-meta">
          <span><CalendarDays /> {formatDate(meet.date)}</span>
          <span><Clock3 /> {formatTime(meet.startTime)}</span>
          <span><MapPin /> {meet.location}</span>
        </div>
        {meet.producer && <p>Produced by {meet.producer}</p>}
      </section>
      <section className="public-detail-section">
        <div className="public-section-heading"><h2>Competition schedule</h2><span>{meet.competitions.length} on the card</span></div>
        <div className="public-competition-list">
          {meet.competitions.map((competition) => <CompetitionRow competition={competition} key={competition.id} />)}
          {!meet.competitions.length && <p className="public-empty">Competition details are coming soon.</p>}
        </div>
      </section>
    </>
  );
}

function ResultsTable({ competition }: { competition: PublicCompetition }) {
  if (!competition.resultsPublished) {
    return <p className="public-empty">{competition.status === "Complete" ? "Results pending. Official standings have not been published." : "Results will appear when arena staff publishes standings."}</p>;
  }
  if (!competition.results.length) return <p className="public-empty">Published standings are waiting on qualified runs.</p>;
  return (
    <div className="public-results" role="table" aria-label={`${competition.name} results`}>
      <div className="public-result-row header" role="row">
        <span>Place</span><span>Team</span><span>Rounds</span><span>Total</span>
      </div>
      {competition.results.map((row) => (
        <div className="public-result-row" role="row" key={`${row.place}-${row.headerName}-${row.heelerName}`}>
          <strong>{row.place}</strong>
          <span><b>{row.headerName}</b><small>{row.heelerName}</small></span>
          <span>{row.rounds}</span>
          <span>{row.officialTotal === null ? "No time" : `${row.officialTotal.toFixed(2)}s`}</span>
        </div>
      ))}
    </div>
  );
}

function SpectatorWinnerTable({
  title,
  rows,
}: {
  title: string;
  rows: PublicSpectatorLeaderboardRow[];
}) {
  return (
    <article className="public-published-picks-card">
      <h3>{title}</h3>
      {rows.length ? (
        <div>
          {rows.map((row, index) => (
            <div
              className={`public-spectator-row${index === 0 ? " winner" : ""}`}
              key={`${title}-${row.name}`}
            >
              <strong>{index + 1}</strong>
              <span>
                {row.name}
                {index === 0 && <small>Winner</small>}
              </span>
              <b>{row.correct} / {row.picks} correct</b>
            </div>
          ))}
        </div>
      ) : (
        <p>No scored picks.</p>
      )}
    </article>
  );
}

function PublishedSpectatorWinners({
  competition,
}: {
  competition: PublicCompetition;
}) {
  const rounds = Array.from(
    { length: Math.max(competition.rounds, 1) },
    (_, index) => index + 1,
  );
  const overall = aggregatePublicSpectatorLeaderboard(
    competition.spectatorLeaderboards,
  );
  return (
    <section className="public-detail-section public-published-picks">
      <div className="public-section-heading">
        <div>
          <span>Cowboys × Steer</span>
          <h2>Spectator winners</h2>
        </div>
        <span>Published by arena staff</span>
      </div>
      <div className="public-published-picks-grid">
        {rounds.map((round) => (
          <SpectatorWinnerTable
            key={round}
            title={`Round ${round}`}
            rows={competition.spectatorLeaderboards.filter(
              (row) => row.round === round,
            )}
          />
        ))}
        <SpectatorWinnerTable title="All rounds overall" rows={overall} />
      </div>
    </section>
  );
}

function CompetitionPage({ competition, meet }: { competition?: PublicCompetition; meet?: PublicMeet }) {
  if (!competition) return <NotFound />;
  return (
    <>
      <section className="public-page-head">
        <ReturnToEventsLink />
        <Status value={competition.status} />
        <h1>{competition.name}</h1>
        <p>{competition.competitionLabel} at {competition.location}</p>
        {competition.description && <p className="public-competition-description">{competition.description}</p>}
        <div className="public-page-meta">
          <span><CalendarDays /> {formatDate(competition.date)}</span>
          <span><Clock3 /> {formatTime(competition.startTime)}</span>
          <span><UsersRound /> {competition.entryCount} entries</span>
        </div>
        {competition.registrationOpen && competition.status !== "Complete" && !competition.drawLocked && (
          <a className="public-button primary" href={href("signup", competition.id)}>{registrationLinkLabel} <ArrowRight size={18} /></a>
        )}
        {!competition.registrationOpen && competition.status !== "Complete" && (
          <p className="public-registration-closed">Online registration closes one hour before the competition starts.</p>
        )}
      </section>
      {competition.status !== "Complete" && (
        <section className="public-rules">
          <h2>Competition details</h2>
          <dl>
            <div><dt>Format</dt><dd>{competition.competitionLabel}</dd></div>
            <div><dt>Entry fee</dt><dd>${competition.entryFee}</dd></div>
            <div><dt>Rounds</dt><dd>{competition.rounds}</dd></div>
            <div><dt>Time limit</dt><dd>{competition.timeLimit} seconds</dd></div>
            {competition.competitionType === "slide" && (
              <div><dt>Slide rule</dt><dd>#{competition.slideNumber} · Round 2 adjusts 0.5 seconds per 0.5 handicap, up to ±4 seconds</dd></div>
            )}
            {competition.incentivePayouts && (
              <div><dt>Incentive</dt><dd>Fastest {competition.incentiveTeams} Round 1 team{competition.incentiveTeams === 1 ? "" : "s"} with combined HC {competition.incentiveHandicapTotal} or lower · ${competition.incentiveAmountPerTeam.toLocaleString()} each</dd></div>
            )}
            <div><dt>Handicap cap</dt><dd>#{competition.handicapTotal}</dd></div>
            <div><dt>Highest contestant handicap</dt><dd>#{competition.maxContestantHandicap}</dd></div>
            <div><dt>Entry limit</dt><dd>{competition.entriesAllowed} per contestant</dd></div>
            {competition.competitionType === "pick-and-draw" && (
              <div><dt>Minimum draws</dt><dd>{competition.minDrawsAllowed}</dd></div>
            )}
          </dl>
          <p>{competition.allowRepeatPartners ? "Repeat partnerships are allowed." : "Each partnership may enter once."}</p>
        </section>
      )}
      <section className="public-detail-section" id="results">
        <div className="public-section-heading"><h2>{competition.status === "Live" ? "Live standings" : "Official results"}</h2>{competition.resultsPublished && <span>Published by arena staff</span>}</div>
        <ResultsTable competition={competition} />
      </section>
      {competition.resultsPublished && (
        <PublishedSpectatorWinners competition={competition} />
      )}
    </>
  );
}

function SignupPage({ competition }: { competition?: PublicCompetition }) {
  const [authMode, setAuthMode] = useState<"login" | "create">("login");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [account, setAccount] = useState<PublicAccountDraft>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    hometown: "",
    role: "Both",
    headerHandicap: 3,
    heelerHandicap: 3,
    pin: "",
    confirmPin: "",
  });
  const [options, setOptions] = useState<PublicSignupOptions | null>(null);
  const [selections, setSelections] = useState<Record<string, PublicSignupSelection>>({});
  const [reserved, setReserved] = useState<
    { label: string; existing: boolean }[] | null
  >(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const accountSubmissionInFlight = useRef(false);
  const reservationInFlight = useRef(false);

  useEffect(() => {
    if (!competition || !isWixEmbed()) return;
    const stored = loadStoredRiderSession();
    if (!stored) return;
    let cancelled = false;
    setBusy(true);
    loadSignupOptions(competition.id, stored.email, stored.pin)
      .then((result) => {
        if (cancelled || !result) return;
        setEmail(stored.email);
        setPin(stored.pin);
        applySignupOptions(result);
      })
      .catch(() => {
        if (!cancelled) clearRiderSession();
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedEntries = Object.values(selections);

  if (!competition) return <NotFound />;

  const applySignupOptions = (result: PublicSignupOptions) => {
    const initial = result.competitions.find((item) => item.id === competition.id);
    const initialRole = initial?.roles.find(
      (role) => !initial.roleCapacities?.find((capacity) => capacity.role === role)?.full,
    );
    setOptions(result);
    setReserved(null);
    setSelections(
      initial && initialRole
        ? {
            [initial.id]: {
              competitionId: initial.id,
              role: initialRole,
            },
          }
        : {},
    );
  };

  const authenticate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (!isWixEmbed()) {
        throw new Error("Online reservations are available on the Destiny Ranch Arena Wix site.");
      }
      const result = await loadSignupOptions(competition.id, email, pin);
      if (!result) throw new Error("Signup options are unavailable.");
      storeRiderSession(email, pin);
      applySignupOptions(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (accountSubmissionInFlight.current) return;
    accountSubmissionInFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (account.pin !== account.confirmPin) {
        throw new Error("PIN confirmation does not match.");
      }
      if (!isWixEmbed()) {
        throw new Error("Account creation is available on the Destiny Ranch Arena Wix site.");
      }
      await createContestantAccount(
        competition.id,
        contestantAccountRequest(account),
      );
      const result = await loadSignupOptions(
        competition.id,
        account.email,
        account.pin,
      );
      if (!result) throw new Error("Contestant account could not be opened.");
      setEmail(account.email);
      setPin(account.pin);
      storeRiderSession(account.email, account.pin);
      applySignupOptions(result);
      setMessage(`Account created for ${result.contestant.name}. Choose your ropings below.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Account could not be created.",
      );
    } finally {
      accountSubmissionInFlight.current = false;
      setBusy(false);
    }
  };

  // Online signup never offers a partner. A pick-and-draw rider is entered in
  // the draw, so the only positions on offer are the ones the draw fills.
  const selectableRoles = (roping: PublicSignupCompetition) =>
    roping.competitionType === "pick-and-draw" ? roping.drawRoles : roping.roles;

  const toggleCompetition = (competitionId: string) => {
    const roping = options?.competitions.find((item) => item.id === competitionId);
    if (!roping) return;
    const openRoles = selectableRoles(roping).filter(
      (role) => !roping.roleCapacities?.find((capacity) => capacity.role === role)?.full,
    );
    const availableRole = openRoles[0];
    if (!availableRole) {
      setMessage("This Round Robin is full.");
      return;
    }
    setSelections((current) => {
      if (current[competitionId]) {
        const next = { ...current };
        delete next[competitionId];
        return next;
      }
      return {
        ...current,
        [competitionId]: {
          competitionId,
          role: availableRole,
        },
      };
    });
  };

  const updateSelection = (
    competitionId: string,
    change: Partial<PublicSignupSelection>,
  ) => {
    setSelections((current) => ({
      ...current,
      [competitionId]: {
        ...current[competitionId],
        ...change,
        competitionId,
      },
    }));
  };

  const reserveSpots = async (event: FormEvent) => {
    event.preventDefault();
    if (
      reservationInFlight.current ||
      !options ||
      !selectedEntries.length
    ) {
      return;
    }
    // Defensive only: the radios never offer a position outside selectableRoles,
    // and the backend hides a pick-and-draw the rider cannot draw a position in.
    const unavailablePosition = options.competitions.find((item) => {
      const selection = selections[item.id];
      return selection && !selectableRoles(item).includes(selection.role);
    });
    if (unavailablePosition) {
      setMessage(
        `Choose a position ${unavailablePosition.name} draws for.`,
      );
      return;
    }
    reservationInFlight.current = true;
    setBusy(true);
    setMessage("");
    const results: { label: string; existing: boolean }[] = [];
    try {
      for (const selection of selectedEntries) {
        const roping = options.competitions.find(
          (item) => item.id === selection.competitionId,
        );
        const label = roping
          ? formatSignupRopingLabel(roping.name, roping.date, roping.startTime)
          : selection.competitionId;
        const result = await submitReservedSpot({
          competitionId: selection.competitionId,
          email,
          pin,
          position: selection.role,
        });
        if (!result) throw new Error("Reservations are unavailable right now.");
        results.push({ label, existing: result.existing });
      }
      setReserved(results);
      setSelections({});
    } catch (error) {
      if (results.length) setReserved(results);
      setMessage(
        error instanceof Error
          ? error.message
          : "Your reservation could not be sent. Call/text Will 954-520-2631.",
      );
    } finally {
      reservationInFlight.current = false;
      setBusy(false);
    }
  };

  const startNewReservation = () => {
    setReserved(null);
    setMessage("");
  };

  return (
    <section className="public-signup public-signup-cart">
      <ReturnToEventsLink />
      <h1>Reserve your spot</h1>
      <p>Sign in once, check every roping you plan to enter, then send your reservation. The arena office will hold your place on the will-call list — no payment is needed now.</p>
      {!options ? (
        <>
          <div className="public-account-choice" role="tablist" aria-label="Contestant account access">
            <button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>I have an account</button>
            <button className={authMode === "create" ? "active" : ""} onClick={() => setAuthMode("create")}>Create account</button>
          </div>
          {authMode === "login" ? (
            <form onSubmit={authenticate}>
              <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>Four-digit PIN<input type="password" inputMode="numeric" autoComplete="one-time-code" pattern="\d{4}" maxLength={4} required value={pin} onChange={(event) => setPin(event.target.value)} /></label>
              <button className="public-button primary" disabled={busy}>{busy ? "Checking account…" : "View available ropings"}</button>
            </form>
          ) : (
            <form className="public-account-form" onSubmit={createAccount}>
              <label>First name<input required maxLength={50} autoComplete="given-name" autoCapitalize="characters" value={account.firstName} onChange={(event) => setAccount({ ...account, firstName: event.target.value.toUpperCase() })} /></label>
              <label>Last name<input required maxLength={50} autoComplete="family-name" autoCapitalize="characters" value={account.lastName} onChange={(event) => setAccount({ ...account, lastName: event.target.value.toUpperCase() })} /></label>
              <label>Email address<input required type="email" autoComplete="email" value={account.email} onChange={(event) => setAccount({ ...account, email: event.target.value.toLowerCase() })} /></label>
              <label>Phone number<input required type="tel" autoComplete="tel" value={account.phone} onChange={(event) => setAccount({ ...account, phone: event.target.value })} /></label>
              <label>Hometown<input autoComplete="address-level2" autoCapitalize="characters" value={account.hometown} onChange={(event) => setAccount({ ...account, hometown: event.target.value.toUpperCase() })} /></label>
              <label>Roping position<select value={account.role} onChange={(event) => setAccount({ ...account, role: event.target.value as ContestantAccountRequest["role"] })}><option>Both</option><option>Header</option><option>Heeler</option></select></label>
              {account.role !== "Heeler" && <label>Header handicap<input required type="number" min="0" max="20" step="0.5" value={account.headerHandicap} onChange={(event) => setAccount({ ...account, headerHandicap: Number(event.target.value) })} /></label>}
              {account.role !== "Header" && <label>Heeler handicap<input required type="number" min="0" max="20" step="0.5" value={account.heelerHandicap} onChange={(event) => setAccount({ ...account, heelerHandicap: Number(event.target.value) })} /></label>}
              <label>Choose four-digit PIN<input required type="password" inputMode="numeric" autoComplete="one-time-code" pattern="\d{4}" maxLength={4} value={account.pin} onChange={(event) => setAccount({ ...account, pin: event.target.value })} /></label>
              <label>Confirm PIN<input required type="password" inputMode="numeric" autoComplete="one-time-code" pattern="\d{4}" maxLength={4} value={account.confirmPin} onChange={(event) => setAccount({ ...account, confirmPin: event.target.value })} /></label>
              <button className="public-button primary" disabled={busy}>{busy ? "Creating account…" : "Create account and view ropings"}</button>
            </form>
          )}
        </>
      ) : (
        <>
          <div className="public-authenticated"><CheckCircle2 /><span>Reserving as <strong>{options.contestant.name}</strong></span></div>
          {reserved ? (
            <div className="public-payment-status successful">
              <strong>Reservation sent</strong>
              <ul className="public-reservation-summary">
                {reserved.map((item) => (
                  <li key={item.label}>{item.label} — {item.existing ? "already on the reserved list" : "spot reserved"}</li>
                ))}
              </ul>
              <p>The arena office has you on the will-call list. See you at the arena!</p>
              <button className="public-button" type="button" onClick={startNewReservation}>Reserve more ropings</button>
            </div>
          ) : (
            <form onSubmit={reserveSpots}>
              <div className="public-roping-list">
                {options.competitions.length ? options.competitions.map((roping) => {
                  const selection = selections[roping.id];
                  const availableRoles = roping.roles.filter(
                    (role) => !roping.roleCapacities?.find((capacity) => capacity.role === role)?.full,
                  );
                  const full = availableRoles.length === 0;
                  return (
                    <article className={`public-roping-choice ${selection ? "selected" : ""}${full ? " full" : ""}`} key={roping.id}>
                      <label className="public-roping-toggle">
                        <input type="checkbox" checked={Boolean(selection)} disabled={full} onChange={() => toggleCompetition(roping.id)} />
                        <span><strong>{formatSignupRopingLabel(roping.name, roping.date, roping.startTime)}</strong>{full && <small>Registration full</small>}</span>
                      </label>
                      {roping.roleCapacities?.length ? (
                        <p className="public-payment-note">
                          {roping.roleCapacities.map((capacity) =>
                            `${capacity.role}: ${capacity.registered} of ${capacity.maximum}${capacity.full ? " - FULL" : ""}`,
                          ).join(" · ")}
                        </p>
                      ) : null}
                      {selection && (
                        <div className="public-roping-options">
                          <fieldset>
                            <legend>Your position</legend>
                            {selectableRoles(roping).map((role) => {
                              const roleFull = roping.roleCapacities?.find((capacity) => capacity.role === role)?.full;
                              return (
                              <label className="public-radio" key={role}>
                                <input type="radio" name={`role-${roping.id}`} disabled={roleFull} checked={selection.role === role} onChange={() => updateSelection(roping.id, { role })} />
                                {role}{roleFull ? " - FULL" : ""}
                              </label>
                              );
                            })}
                          </fieldset>
                          {roping.competitionType === "pick-and-draw" && (
                            <p className="public-payment-note">You are entered in the draw. Partners are picked at the event.</p>
                          )}
                        </div>
                      )}
                    </article>
                  );
                }) : <p className="public-form-message">There are no open ropings available for this contestant right now.</p>}
              </div>
              <div className="public-cart-total">
                <span>{selectedEntries.length} {selectedEntries.length === 1 ? "roping" : "ropings"} selected</span>
              </div>
              <p className="public-payment-note">
                No payment now — your reservation goes straight to the arena office's will-call list. Entry fees are settled at the event.
              </p>
              <button className="public-button primary" disabled={busy || !selectedEntries.length}>
                {busy ? "Sending reservation…" : "Send reservation"}
              </button>
            </form>
          )}
        </>
      )}
      {message && <p className="public-form-message" role="status">{message}</p>}
    </section>
  );
}

function NotFound() {
  return <section className="public-not-found"><h1>That arena page isn’t available.</h1><p>The event may have moved or is no longer public.</p><a className="public-button primary" href={href("events")}>View all events</a></section>;
}

export function PublicSite({ route = parsePublicRoute(window.location.search) }: { route?: PublicRoute }) {
  const [data, setData] = useState<PublicArenaData | null>(() =>
    isWixEmbed() ? null : loadLocalPublicData(),
  );
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const [requestedEventSection, setRequestedEventSection] = useState<string | null>(
    () => publicEventSectionTargetId(window.location.hash.slice(1).replace(/^events-/, "")),
  );
  useEffect(
    () => subscribeToWixSectionNavigation(setRequestedEventSection),
    [],
  );
  useEffect(() => {
    // Inside the Wix embed the page has its own scrollbar; hide the app's window
    // scrollbar so only one shows. Wheel/touch scrolling still works.
    if (!isWixEmbed()) return;
    document.documentElement.classList.add("hide-window-scrollbar");
    return () => document.documentElement.classList.remove("hide-window-scrollbar");
  }, []);
  useEffect(() => {
    if (route.kind === "rider-account") return;
    if (!isWixEmbed()) {
      const refresh = () => setData(loadLocalPublicData());
      window.addEventListener("focus", refresh);
      window.addEventListener("storage", refresh);
      return () => {
        window.removeEventListener("focus", refresh);
        window.removeEventListener("storage", refresh);
      };
    }
    let cancelled = false;
    const pollGuard = new PublicPollGuard();
    let hasUsableData = data !== null;
    const refresh = async () => {
      const request = pollGuard.begin();
      if (request === null) return;
      try {
        const result = await loadPublicArenaData();
        if (!cancelled && pollGuard.complete(request)) {
          hasUsableData = true;
          setData(result);
          setError("");
          setRefreshWarning("");
        }
      } catch (reason) {
        const current = pollGuard.complete(request);
        if (!cancelled && current) {
          const message =
            reason instanceof Error
              ? reason.message
              : "Events could not be loaded.";
          if (hasUsableData) {
            setRefreshWarning(
              `Live run refresh failed. Retrying automatically. ${message}`,
            );
          } else {
            setError(message);
          }
        }
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const refreshInterval = publicRefreshInterval(route.kind);
    const interval =
      refreshInterval === undefined
        ? undefined
        : window.setInterval(refresh, refreshInterval);
    return () => {
      cancelled = true;
      pollGuard.cancel();
      if (interval !== undefined) window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [route.kind]);

  const selected = useMemo(() => {
    const competition = (
      data?.competitions ?? data?.meets.flatMap((meet) => meet.competitions)
    )?.find((item) => "id" in route && item.id === route.id);
    return {
      meet: data?.meets.find((meet) => ("id" in route && meet.id === route.id) || meet.id === competition?.parentEventId),
      competition,
    };
  }, [data, route]);

  useEffect(() => {
    const title = route.kind === "events" ? "Events" : route.kind === "rider-account" ? "Create Rider Account" : route.kind === "rider" ? "Rider Log In" : route.kind === "event" ? selected.meet?.name : route.kind === "competition" || route.kind === "signup" || route.kind === "spectator" ? selected.competition?.name : "Home";
    document.title = `${title ?? "Event"} | Destiny Ranch Arena`;
  }, [route.kind, selected.competition?.name, selected.meet?.name]);

  useEffect(() => {
    if (!data || (route.kind !== "home" && route.kind !== "events")) return;
    const targetId = requestedEventSection;
    if (!targetId) return;
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView();
    });
  }, [data, requestedEventSection, route.kind]);

  return (
    <div className="public-site">
      {/* THESIS: Arena day begins at the gate, not in a generic card grid. OWN-WORLD: ink-black ranch marks, bone paper, arena-gold signals, and squared field forms. STORY: find the next roping, understand the card, enter, and return for official results. FIRST VIEWPORT: oversized ride-your-run statement beside a stamped DR mark with the next event directly below. FORM: established ranch identity extended into a public event ledger. */}
      <PublicHeader
        liveCompetitionId={(data?.competitions ?? data?.meets.flatMap((meet) => meet.competitions) ?? []).find(
          (competition) => competition.status === "Live",
        )?.id}
      />
      <main className="public-main">
        {route.kind === "home" ? <HomePage data={data} scheduleError={error} /> :
          route.kind === "rider-account" ? <RiderAccountPage /> :
          route.kind === "rider" ? <RiderPage data={data} /> :
          error ? <section className="public-not-found"><h1>We couldn’t open the event book.</h1><p>{error}</p></section> : !data ? <div className="public-loading" role="status">Loading the event book…</div> :
          route.kind === "events" ? <><section className="public-index-head"><h1>Every run starts here.</h1><p>Upcoming entries, live ropings, and the official results book.</p></section><EventExplorer data={data} /></> :
          route.kind === "event" ? <EventPage meet={selected.meet} /> :
          route.kind === "competition" ? <CompetitionPage competition={selected.competition} meet={selected.meet} /> :
          route.kind === "signup" ? <SignupPage competition={selected.competition} /> :
          route.kind === "spectator" ? <SpectatorPage competition={selected.competition} onLocalUpdate={setData} refreshWarning={refreshWarning} /> : null}
      </main>
      <PublicFooter />
    </div>
  );
}
