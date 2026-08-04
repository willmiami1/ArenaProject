import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LogIn,
  MapPin,
  Menu,
  ShieldCheck,
  Trophy,
  UsersRound,
  X,
} from "lucide-react";
import { seedData } from "./data";
import {
  parsePublicRoute,
  projectPublicArenaData,
  type PublicArenaData,
  type PublicCompetition,
  type PublicMeet,
  type PublicRoute,
} from "./publicData";
import {
  isWixEmbed,
  loadPublicArenaData,
  loadSignupOptions,
  submitOnlineSignup,
  type SignupOptions,
} from "./wixBridge";

const href = (page: string, id?: string) =>
  `?page=${encodeURIComponent(page)}${id ? `&id=${encodeURIComponent(id)}` : ""}`;

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

function Status({ value }: { value: string }) {
  return <span className={`public-status ${value.toLowerCase()}`}>{value}</span>;
}

function PublicHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="public-header">
      <a className="public-brand" href={href("home")} aria-label="Destiny Ranch Arena home">
        <img src="./destiny-ranch-arena-logo.png" alt="" />
        <span><strong>Destiny Ranch</strong><small>Arena</small></span>
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
        <a href={href("events")}>Events</a>
        <a href="?portal=contestant"><LogIn size={16} /> Contestant login</a>
        <a href="?app=command"><ShieldCheck size={16} /> Admin login</a>
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
        <a href={href("events")}>Event calendar</a>
        <a href="?portal=contestant">Contestant portal</a>
        <a href="?app=command">Admin login</a>
      </nav>
      <small>Official schedules and results are published by arena staff.</small>
    </footer>
  );
}

function EventCard({ meet }: { meet: PublicMeet }) {
  const open = meet.competitions.filter((event) => event.registrationOpen).length;
  const published = meet.competitions.filter((event) => event.resultsPublished).length;
  return (
    <article className="public-event-card">
      <div className="public-date-block">
        <span>{new Date(`${meet.date}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</span>
        <strong>{meet.date.slice(-2)}</strong>
      </div>
      <div className="public-event-copy">
        <div className="public-card-topline">
          <Status value={meet.group === "live" ? "Live" : meet.group === "future" ? "Upcoming" : "Complete"} />
          <span>{meet.competitions.length} competition{meet.competitions.length === 1 ? "" : "s"}</span>
        </div>
        <h3><a href={href("event", meet.id)}>{meet.name}</a></h3>
        <p><MapPin size={15} /> {meet.location}</p>
        <p><Clock3 size={15} /> {formatTime(meet.startTime)}</p>
        <div className="public-card-badges">
          {open > 0 && <span>{open} accepting entries</span>}
          {published > 0 && <span>{published} result{published === 1 ? "" : "s"} posted</span>}
        </div>
        <a className="public-text-link" href={href("event", meet.id)}>Event details <ArrowRight size={16} /></a>
      </div>
    </article>
  );
}

function EventGroups({ data, limit }: { data: PublicArenaData; limit?: number }) {
  const groups = [
    { key: "live", title: "Happening now", empty: "No competitions are live right now." },
    { key: "future", title: "Coming to the arena", empty: "The next event will be posted soon." },
    { key: "past", title: "From the results book", empty: "Completed events will appear here." },
  ] as const;
  return (
    <div className="public-event-groups">
      {groups.map((group) => {
        const meets = data.meets.filter((meet) => meet.group === group.key).slice(0, limit);
        return (
          <section className="public-event-section" key={group.key}>
            <div className="public-section-heading">
              <h2>{group.title}</h2>
              {limit && <a href={href("events")}>See all events</a>}
            </div>
            {meets.length ? (
              <div className="public-event-grid">{meets.map((meet) => <EventCard meet={meet} key={meet.id} />)}</div>
            ) : (
              <p className="public-empty">{group.empty}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function HomePage({ data }: { data: PublicArenaData }) {
  const featured = data.meets.find((meet) => meet.group === "live") ??
    data.meets.find((meet) => meet.group === "future");
  return (
    <>
      <section className="public-hero">
        <div className="public-hero-copy">
          <h1>The gate opens.<br />The clock starts.<br /><em>Ride your run.</em></h1>
          <p>Team roping events, online entries, and official results from Destiny Ranch Arena.</p>
          <div className="public-actions">
            <a className="public-button primary" href={href("events")}>View the event calendar <ArrowRight size={18} /></a>
            <a className="public-button quiet" href="?portal=contestant">Contestant login</a>
            <a className="public-button quiet" href="?app=command"><ShieldCheck size={18} /> Admin login</a>
          </div>
        </div>
        <div className="public-hero-mark" aria-hidden="true">
          <span>DR</span><small>Destiny Ranch Arena</small>
        </div>
      </section>
      {featured && (
        <section className="public-featured">
          <div className="public-featured-date">
            <CalendarDays />
            <span>{formatDate(featured.date)} · {formatTime(featured.startTime)}</span>
          </div>
          <div><Status value={featured.group === "live" ? "Live" : "Next event"} /><h2>{featured.name}</h2><p>{featured.location}</p></div>
          <a href={href("event", featured.id)}>Open event <ArrowRight size={18} /></a>
        </section>
      )}
      <EventGroups data={data} limit={2} />
      <section className="public-trust-strip">
        <div><ShieldCheck /><strong>Official arena data</strong><span>Schedules and results published by event staff.</span></div>
        <div><UsersRound /><strong>Built for contestants</strong><span>Use your existing account to enter eligible competitions.</span></div>
        <div><Trophy /><strong>Results worth keeping</strong><span>Published averages show every qualified round.</span></div>
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
        <Status value={meet.group === "live" ? "Live" : meet.group === "future" ? "Upcoming" : "Complete"} />
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
        <div className="public-page-meta">
          <span><CalendarDays /> {formatDate(competition.date)}</span>
          <span><Clock3 /> {formatTime(competition.startTime)}</span>
          <span><UsersRound /> {competition.entryCount} entries</span>
        </div>
        {competition.registrationOpen && competition.status !== "Complete" && !competition.drawLocked && (
          <a className="public-button primary" href={href("signup", competition.id)}>Enter this competition <ArrowRight size={18} /></a>
        )}
      </section>
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
      <section className="public-detail-section">
        <div className="public-section-heading"><h2>{competition.status === "Live" ? "Live standings" : "Official results"}</h2>{competition.resultsPublished && <span>Published by arena staff</span>}</div>
        <ResultsTable competition={competition} />
      </section>
    </>
  );
}

function SignupPage({ competition }: { competition?: PublicCompetition }) {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
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
    return <section className="public-signup"><h1>Online entry is closed</h1><p>This competition is not accepting online entries.</p><a href={href("competition", competition.id)}>Return to competition</a></section>;
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
      <p>Sign in with the email and four-digit PIN already connected to your contestant account.</p>
      {!options ? (
        <form onSubmit={authenticate}>
          <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Four-digit PIN<input type="password" inputMode="numeric" autoComplete="current-password" pattern="\d{4}" maxLength={4} required value={pin} onChange={(event) => setPin(event.target.value)} /></label>
          <button className="public-button primary" disabled={busy}>{busy ? "Checking account…" : "Continue securely"}</button>
        </form>
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
    isWixEmbed() ? null : projectPublicArenaData(seedData),
  );
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isWixEmbed()) return;
    let cancelled = false;
    loadPublicArenaData()
      .then((result) => { if (!cancelled) setData(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Events could not be loaded."); });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => {
    const competition = data?.meets.flatMap((meet) => meet.competitions).find((item) => "id" in route && item.id === route.id);
    return {
      meet: data?.meets.find((meet) => ("id" in route && meet.id === route.id) || meet.id === competition?.parentEventId),
      competition,
    };
  }, [data, route]);

  useEffect(() => {
    const title = route.kind === "events" ? "Events" : route.kind === "event" ? selected.meet?.name : route.kind === "competition" || route.kind === "signup" ? selected.competition?.name : "Home";
    document.title = `${title ?? "Event"} | Destiny Ranch Arena`;
  }, [route.kind, selected.competition?.name, selected.meet?.name]);

  return (
    <div className="public-site">
      {/* THESIS: Arena day begins at the gate, not in a generic card grid. OWN-WORLD: ink-black ranch marks, bone paper, arena-gold signals, and squared field forms. STORY: find the next roping, understand the card, enter, and return for official results. FIRST VIEWPORT: oversized ride-your-run statement beside a stamped DR mark with the next event directly below. FORM: established ranch identity extended into a public event ledger. */}
      <PublicHeader />
      <main className="public-main">
        {error ? <section className="public-not-found"><h1>We couldn’t open the event book.</h1><p>{error}</p></section> : !data ? <div className="public-loading" role="status">Loading the event book…</div> :
          route.kind === "home" ? <HomePage data={data} /> :
          route.kind === "events" ? <><section className="public-index-head"><h1>Every run starts here.</h1><p>Upcoming entries, live ropings, and the official results book.</p></section><EventGroups data={data} /></> :
          route.kind === "event" ? <EventPage meet={selected.meet} /> :
          route.kind === "competition" ? <CompetitionPage competition={selected.competition} meet={selected.meet} /> :
          route.kind === "signup" ? <SignupPage competition={selected.competition} /> : null}
      </main>
      <PublicFooter />
    </div>
  );
}
