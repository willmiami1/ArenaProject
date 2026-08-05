import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Facebook,
  Instagram,
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
  competitionGroup,
  parsePublicRoute,
  projectPublicArenaData,
  type PublicArenaData,
  type PublicCompetition,
  type PublicMeet,
  type PublicRoute,
} from "./publicData";
import {
  createContestantAccount,
  isWixEmbed,
  loadPublicArenaData,
  loadSignupOptions,
  submitOnlineSignup,
  submitSpectatorPrediction,
  type SignupOptions,
} from "./wixBridge";
import {
  createSpectatorPrediction,
  type SpectatorChoice,
} from "./spectatorPredictions";
import {
  createLocalContestantAccount,
  type ContestantAccountRequest,
} from "./contestantAccount";
import type { ArenaData } from "./types";

const localWorkspaceKey = "arena-command-data-v1";

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

const href = (page: string, id?: string) =>
  `?page=${encodeURIComponent(page)}${id ? `&id=${encodeURIComponent(id)}` : ""}`;
const eventsHref = `${href("home")}#events`;

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

const initials = (name: string) =>
  name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

function Status({ value }: { value: string }) {
  const label =
    value === "Upcoming" ? "Future" : value === "Complete" ? "Past" : value;
  return <span className={`public-status ${value.toLowerCase()}`}>{label}</span>;
}

const socialLinks = [
  { label: "Facebook", url: "https://www.facebook.com/", Icon: Facebook },
  { label: "Instagram", url: "https://www.instagram.com/", Icon: Instagram },
  { label: "YouTube", url: "https://www.youtube.com/", Icon: Youtube },
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

function PublicHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="public-header">
      <a className="public-brand" href={href("home")} aria-label="Destiny Ranch Arena home">
        <img src="./destiny-ranch-arena-logo.png" alt="" />
        <strong>Destiny Ranch Arena</strong>
      </a>
      <button
        className="public-menu"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X /> : <Menu />}
      </button>
      <nav className={open ? "open" : ""} aria-label="Public navigation">
        <a href={href("home")}>Home</a>
        <a href={eventsHref}>Events</a>
        <a href="?app=command"><ShieldCheck size={16} /> Admin login</a>
        <SocialLinks />
      </nav>
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
        <a href="?app=command">Admin login</a>
      </nav>
      <div className="public-footer-connect">
        <SocialLinks />
        <small>Official schedules and results are published by arena staff.</small>
      </div>
    </footer>
  );
}

function RopingCard({
  competition,
}: {
  competition: PublicCompetition;
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
        <h3><a href={href("competition", competition.id)}>{competition.name}</a></h3>
        <p><MapPin size={15} /> {competition.location}</p>
        <p><Clock3 size={15} /> {formatTime(competition.startTime)}</p>
        <div className="public-card-badges">
          {competition.registrationOpen && <span>Accepting entries</span>}
          <span>{competition.entryCount} entr{competition.entryCount === 1 ? "y" : "ies"}</span>
        </div>
        <a className="public-text-link" href={href("competition", competition.id)}>Roping details <ArrowRight size={16} /></a>
        {competition.registrationOpen && (
          <a className="public-button compact" href={href("signup", competition.id)}>
            Enter online
          </a>
        )}
      </div>
      {competition.status === "Live" && (
        <aside className="public-live-actions">
          <a className="public-live-results" href={`${href("competition", competition.id)}#results`}>
            <Trophy size={22} />
            <strong>Results</strong>
            <span>{competition.resultsPublished ? "View live standings" : "Standings pending"}</span>
          </a>
          <a className="public-button compact" href={href("spectator", competition.id)}>
            Spectator picks
          </a>
        </aside>
      )}
    </article>
  );
}

function SpectatorPage({
  competition,
  onLocalUpdate,
}: {
  competition?: PublicCompetition;
  onLocalUpdate: (data: PublicArenaData) => void;
}) {
  const [name, setName] = useState(
    () => window.sessionStorage.getItem("arena-spectator-name") ?? "",
  );
  const [choice, setChoice] = useState<SpectatorChoice>("cowboys");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    window.sessionStorage.removeItem("arena-spectator-phone");
  }, []);
  if (!competition || competition.status !== "Live") {
    return <NotFound />;
  }
  const selectedRun =
    competition.predictionRuns.find((run) => run.open) ??
    competition.predictionRuns[0];
  const teamId = selectedRun?.id ?? "";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const submittedValue = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
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
        onLocalUpdate(result.publicData);
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
      setMessage(error instanceof Error ? error.message : "Prediction could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const rounds = Array.from(
    new Set(competition.spectatorLeaderboards.map((row) => row.round)),
  );
  return (
    <section className="public-spectator">
      <a href={eventsHref}>← Back to current events</a>
      <div className="public-page-head">
        <Status value="Live" />
        <h1>Pick the run.</h1>
        <p>Free spectator predictions for {competition.name}. One point is awarded when your Steer or Cowboys pick matches the official run result.</p>
      </div>
      <div className="public-spectator-grid">
        <form onSubmit={submit}>
          <h2>Play Cowboys X Steer</h2>
          <label>Name<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
          {selectedRun?.open && selectedRun.closesAt && (
            <p className="public-pick-cutoff">Picks close {new Date(selectedRun.closesAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
          )}
          {selectedRun && !selectedRun.open && (
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
                      <span aria-hidden="true">{initials(selectedRun.headerName)}</span>
                    </span>
                    <strong>{selectedRun.headerName}</strong>
                  </span>
                  <span className="public-cowboy-rider">
                    <small>Heeler</small>
                    <span className="public-cowboy-avatar">
                      <span aria-hidden="true">{initials(selectedRun.heelerName)}</span>
                    </span>
                    <strong>{selectedRun.heelerName}</strong>
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
            <button className="public-button" type="submit" value="cowboys" disabled={busy || !teamId || !selectedRun?.open}>
              {busy ? "Saving…" : "Choose Cowboys"}
            </button>
            <button className="public-button" type="submit" value="steer" disabled={busy || !teamId || !selectedRun?.open}>
              {busy ? "Saving…" : "Choose Steer"}
            </button>
          </div>
          {message && <p className="public-form-message" role="status">{message}</p>}
        </form>
        <div className="public-spectator-leaders">
          <h2>Round leaderboards</h2>
          {(rounds.length ? rounds : [1]).map((round) => {
            const rows = competition.spectatorLeaderboards.filter((row) => row.round === round);
            return <section key={round}><h3>Round {round}</h3>{rows.length ? rows.map((row, index) => <div className="public-spectator-row" key={`${round}-${index}-${row.name}`}><strong>{index + 1}</strong><span>{row.name}</span><b>{row.correct} pts</b></div>) : <p>No scored picks yet.</p>}</section>;
          })}
        </div>
      </div>
    </section>
  );
}

function EventExplorer({ data }: { data: PublicArenaData }) {
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
        <div><span>Destiny Ranch Arena</span><h2>Events</h2></div>
        <span>Choose an event book</span>
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
                <div className="public-event-grid">{competitions.map((competition) => <RopingCard competition={competition} key={competition.id} />)}</div>
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

function HomePage({ data }: { data: PublicArenaData }) {
  const flyers = [
    { src: "./future-event-flyer-1.png", alt: "Destiny Ranch Arena future event flyer" },
    { src: "./future-event-flyer-2.png", alt: "Destiny Ranch Arena upcoming roping flyer" },
    { src: "./future-event-flyer-3.png", alt: "Destiny Ranch Arena August 7 event flyer" },
  ];
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
      <EventExplorer data={data} />
      <section className="public-flyers" aria-labelledby="future-flyers-title">
        <div className="public-flyers-heading">
          <span>Save the date</span>
          <h2 id="future-flyers-title">Upcoming event flyers</h2>
          <p>Open a flyer to view the full event details.</p>
        </div>
        <div className="public-flyer-grid">
          {flyers.map((flyer) => (
            <a href={flyer.src} target="_blank" rel="noreferrer" key={flyer.src}>
              <img src={flyer.src} alt={flyer.alt} loading="lazy" />
            </a>
          ))}
        </div>
      </section>
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
          <a className="public-button compact" href={href("signup", competition.id)}>Enter online</a>
        )}
        {competition.resultsPublished && <a href={href("competition", competition.id)}>View results</a>}
        {!competition.resultsPublished && competition.status === "Complete" && <span>Results pending</span>}
      </div>
    </article>
  );
}

function EventPage({ meet }: { meet?: PublicMeet }) {
  if (!meet) return <NotFound />;
  return (
    <>
      <section className="public-page-head">
        <a href={href("events")}>← All events</a>
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

function CompetitionPage({ competition, meet }: { competition?: PublicCompetition; meet?: PublicMeet }) {
  if (!competition) return <NotFound />;
  return (
    <>
      <section className="public-page-head">
        <a href={meet ? href("event", meet.id) : href("events")}>← {meet?.name ?? "All events"}</a>
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
          <a className="public-button primary" href={href("signup", competition.id)}>Enter this competition <ArrowRight size={18} /></a>
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
            <div><dt>Handicap cap</dt><dd>#{competition.handicapTotal}</dd></div>
            <div><dt>Highest contestant handicap</dt><dd>#{competition.maxContestantHandicap}</dd></div>
            <div><dt>Entry limit</dt><dd>{competition.entriesAllowed} per contestant</dd></div>
          </dl>
          <p>{competition.allowRepeatPartners ? "Repeat partnerships are allowed." : "Each partnership may enter once."}</p>
        </section>
      )}
      <section className="public-detail-section" id="results">
        <div className="public-section-heading"><h2>{competition.status === "Live" ? "Live standings" : "Official results"}</h2>{competition.resultsPublished && <span>Published by arena staff</span>}</div>
        <ResultsTable competition={competition} />
      </section>
    </>
  );
}

function SignupPage({ competition }: { competition?: PublicCompetition }) {
  const [authMode, setAuthMode] = useState<"login" | "create">("login");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [account, setAccount] = useState<
    ContestantAccountRequest & { confirmPin: string }
  >({
    name: "",
    email: "",
    phone: "",
    hometown: "",
    role: "Both",
    headerHandicap: 0,
    heelerHandicap: 0,
    pin: "",
    confirmPin: "",
  });
  const [options, setOptions] = useState<SignupOptions | null>(null);
  const [role, setRole] = useState<"Header" | "Heeler">("Header");
  const [entries, setEntries] = useState(1);
  const [partnerId, setPartnerId] = useState("");
  const [submissionId, setSubmissionId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const individual = competition?.competitionType === "draw-pot" || competition?.competitionType === "round-robin";
  const contestantCanEnter = (
    contestant: SignupOptions["contestant"],
    position: "Header" | "Heeler",
  ) =>
    (contestant.role === "Both" || contestant.role === position) &&
    (position === "Header"
      ? contestant.headerHandicap
      : contestant.heelerHandicap) <= (competition?.maxContestantHandicap ?? 99);
  const eligiblePartners = options && competition
    ? options.partners.filter((partner) => {
        const partnerPosition = role === "Header" ? "Heeler" : "Header";
        const contestantHandicap =
          role === "Header"
            ? options.contestant.headerHandicap
            : options.contestant.heelerHandicap;
        const partnerHandicap =
          partnerPosition === "Header"
            ? partner.headerHandicap
            : partner.heelerHandicap;
        return (
          contestantCanEnter(options.contestant, role) &&
          (partner.role === "Both" || partner.role === partnerPosition) &&
          partnerHandicap <= competition.maxContestantHandicap &&
          contestantHandicap + partnerHandicap <= competition.handicapTotal
        );
      })
    : [];
  const hasEligibleRole =
    Boolean(options) &&
    (contestantCanEnter(options!.contestant, "Header") ||
      contestantCanEnter(options!.contestant, "Heeler"));

  if (!competition) return <NotFound />;
  if (!competition.registrationOpen || competition.status === "Complete" || competition.drawLocked) {
    return <section className="public-signup"><h1>Online entry is closed</h1><p>Online registration closes one hour before the competition starts.</p><a href={href("competition", competition.id)}>Return to competition</a></section>;
  }

  const authenticate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (!isWixEmbed()) throw new Error("Online signup is available on the Destiny Ranch Arena Wix site.");
      const result = await loadSignupOptions(competition.id, email, pin);
      if (!result) throw new Error("Signup options are unavailable.");
      setOptions(result);
      setSubmissionId(
        window.crypto.randomUUID?.() ??
          `${Date.now()}-${result.contestant.id}-${competition.id}`,
      );
      const possibleRole = contestantCanEnter(result.contestant, "Header")
        ? "Header"
        : "Heeler";
      setRole(possibleRole);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (account.pin !== account.confirmPin) {
        throw new Error("PIN confirmation does not match.");
      }
      let result: SignupOptions | null;
      if (isWixEmbed()) {
        result = await createContestantAccount(competition.id, account);
      } else {
        const saved = window.localStorage.getItem(localWorkspaceKey);
        const workspace = saved
          ? (JSON.parse(saved) as ArenaData)
          : structuredClone(seedData);
        workspace.spectators ??= [];
        workspace.spectatorPredictions ??= [];
        const created = createLocalContestantAccount(
          workspace,
          account,
          `contestant-${window.crypto.randomUUID?.() ?? Date.now()}`,
        );
        workspace.contestants = created.contestants;
        window.localStorage.setItem(
          localWorkspaceKey,
          JSON.stringify(workspace),
        );
        result = {
          contestant: {
            id: created.contestant.id,
            name: created.contestant.name,
            role: created.contestant.role,
            headerHandicap: created.contestant.headerHandicap,
            heelerHandicap: created.contestant.heelerHandicap,
          },
          partners: workspace.contestants
            .filter((contestant) => contestant.id !== created.contestant.id)
            .map(({ id, name, role, headerHandicap, heelerHandicap }) => ({
              id,
              name,
              role,
              headerHandicap,
              heelerHandicap,
            })),
        };
      }
      if (!result) throw new Error("Contestant account could not be created.");
      setEmail(account.email);
      setPin(account.pin);
      setOptions(result);
      setSubmissionId(
        window.crypto.randomUUID?.() ??
          `${Date.now()}-${result.contestant.id}-${competition.id}`,
      );
      setRole(
        contestantCanEnter(result.contestant, "Header") ? "Header" : "Heeler",
      );
      setMessage(
        `Account created for ${result.contestant.name}. Complete your entry below.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Account could not be created.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await submitOnlineSignup(
        { email, pin },
        {
          submissionId,
          contestantId: options!.contestant.id,
          eventId: competition.id,
          role,
          entries: individual ? entries : undefined,
          partnerId: individual ? undefined : partnerId,
        },
      );
      if (!result) throw new Error("The signup could not be confirmed.");
      setMessage(result.summary);
      setOptions(null);
      setPin("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The entry could not be submitted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="public-signup">
      <a href={href("competition", competition.id)}>← {competition.name}</a>
      <h1>Enter the arena</h1>
      <p>Online registration closes {new Date(competition.registrationClosesAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.</p>
      <p>{authMode === "login" ? "Sign in with the email and four-digit PIN already connected to your contestant account." : "Create your contestant account, then continue directly to this competition’s entry form."}</p>
      {!options ? (
        <>
          {competition.status === "Upcoming" && (
            <div className="public-account-choice" role="tablist" aria-label="Contestant account access">
              <button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>I have an account</button>
              <button className={authMode === "create" ? "active" : ""} onClick={() => setAuthMode("create")}>Create account</button>
            </div>
          )}
          {authMode === "login" ? (
            <form onSubmit={authenticate}>
              <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>Four-digit PIN<input type="password" inputMode="numeric" autoComplete="current-password" pattern="\d{4}" maxLength={4} required value={pin} onChange={(event) => setPin(event.target.value)} /></label>
              <button className="public-button primary" disabled={busy}>{busy ? "Checking account…" : "Continue securely"}</button>
            </form>
          ) : (
            <form className="public-account-form" onSubmit={createAccount}>
              <label>Full name<input required maxLength={100} autoComplete="name" value={account.name} onChange={(event) => setAccount({ ...account, name: event.target.value })} /></label>
              <label>Email address<input required type="email" autoComplete="email" value={account.email} onChange={(event) => setAccount({ ...account, email: event.target.value })} /></label>
              <label>Phone number<input required type="tel" autoComplete="tel" value={account.phone} onChange={(event) => setAccount({ ...account, phone: event.target.value })} /></label>
              <label>Hometown<input autoComplete="address-level2" value={account.hometown} onChange={(event) => setAccount({ ...account, hometown: event.target.value })} /></label>
              <label>Roping position<select value={account.role} onChange={(event) => setAccount({ ...account, role: event.target.value as ContestantAccountRequest["role"] })}><option>Both</option><option>Header</option><option>Heeler</option></select></label>
              {account.role !== "Heeler" && <label>Header handicap<input required type="number" min="0" max="20" step="0.5" value={account.headerHandicap} onChange={(event) => setAccount({ ...account, headerHandicap: Number(event.target.value) })} /></label>}
              {account.role !== "Header" && <label>Heeler handicap<input required type="number" min="0" max="20" step="0.5" value={account.heelerHandicap} onChange={(event) => setAccount({ ...account, heelerHandicap: Number(event.target.value) })} /></label>}
              <label>Choose four-digit PIN<input required type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4}" maxLength={4} value={account.pin} onChange={(event) => setAccount({ ...account, pin: event.target.value })} /></label>
              <label>Confirm PIN<input required type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4}" maxLength={4} value={account.confirmPin} onChange={(event) => setAccount({ ...account, confirmPin: event.target.value })} /></label>
              <button className="public-button primary" disabled={busy}>{busy ? "Creating account…" : "Create account and continue"}</button>
            </form>
          )}
        </>
      ) : (
        <form onSubmit={submit}>
          <div className="public-authenticated"><CheckCircle2 /><span>Entering as <strong>{options.contestant.name}</strong></span></div>
          <fieldset>
            <legend>Your position</legend>
            {(["Header", "Heeler"] as const).map((value) => {
              const disabled = !contestantCanEnter(options.contestant, value);
              return <label className="public-radio" key={value}><input type="radio" name="role" value={value} disabled={disabled} checked={role === value} onChange={() => { setRole(value); setPartnerId(""); }} />{value}</label>;
            })}
          </fieldset>
          {!hasEligibleRole && <p className="public-form-message" role="status">Your handicap is above the #{competition.maxContestantHandicap} limit for this roping.</p>}
          {individual ? (
            <label>Number of entries<input type="number" min={1} max={competition.entriesAllowed} value={entries} onChange={(event) => setEntries(Number(event.target.value))} /></label>
          ) : (
            <label>Partner<select required value={partnerId} onChange={(event) => setPartnerId(event.target.value)}><option value="">Choose an eligible partner</option>{eligiblePartners.map((partner) => <option value={partner.id} key={partner.id}>{partner.name}</option>)}</select></label>
          )}
          <p className="public-payment-note">Your entry will be pending until arena staff confirms payment.</p>
          <button className="public-button primary" disabled={busy || !hasEligibleRole || (!individual && !partnerId)}>{busy ? "Submitting entry…" : "Submit entry"}</button>
        </form>
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
  useEffect(() => {
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
    loadPublicArenaData()
      .then((result) => { if (!cancelled) setData(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Events could not be loaded."); });
    return () => { cancelled = true; };
  }, []);

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
    const title = route.kind === "events" ? "Events" : route.kind === "event" ? selected.meet?.name : route.kind === "competition" || route.kind === "signup" || route.kind === "spectator" ? selected.competition?.name : "Home";
    document.title = `${title ?? "Event"} | Destiny Ranch Arena`;
  }, [route.kind, selected.competition?.name, selected.meet?.name]);

  return (
    <div className="public-site">
      {/* THESIS: Arena day begins at the gate, not in a generic card grid. OWN-WORLD: ink-black ranch marks, bone paper, arena-gold signals, and squared field forms. STORY: find the next roping, understand the card, enter, and return for official results. FIRST VIEWPORT: oversized ride-your-run statement beside a stamped DR mark with the next event directly below. FORM: established ranch identity extended into a public event ledger. */}
      <PublicHeader />
      <main className="public-main">
        {error ? <section className="public-not-found"><h1>We couldn’t open the event book.</h1><p>{error}</p></section> : !data ? <div className="public-loading" role="status">Loading the event book…</div> :
          route.kind === "home" ? <HomePage data={data} /> :
          route.kind === "events" ? <><section className="public-index-head"><h1>Every run starts here.</h1><p>Upcoming entries, live ropings, and the official results book.</p></section><EventExplorer data={data} /></> :
          route.kind === "event" ? <EventPage meet={selected.meet} /> :
          route.kind === "competition" ? <CompetitionPage competition={selected.competition} meet={selected.meet} /> :
          route.kind === "signup" ? <SignupPage competition={selected.competition} /> :
          route.kind === "spectator" ? <SpectatorPage competition={selected.competition} onLocalUpdate={setData} /> : null}
      </main>
      <PublicFooter />
    </div>
  );
}
