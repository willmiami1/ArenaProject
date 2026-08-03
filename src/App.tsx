import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Flag,
  Gauge,
  LayoutDashboard,
  ListOrdered,
  MapPin,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Trophy,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useArenaData } from "./useArenaData";
import type { ArenaEvent, Contestant, EventStatus, Team, View } from "./types";

const navItems: { id: View; label: string; icon: typeof Gauge }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "events", label: "Events", icon: CalendarDays },
  { id: "contestants", label: "Contestants", icon: UserRound },
  { id: "teams", label: "Teams & Draw", icon: UsersRound },
  { id: "run-desk", label: "Run Desk", icon: Gauge },
];

const uid = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function App() {
  const [data, setData] = useArenaData();
  const [view, setView] = useState<View>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeEvent =
    data.events.find((event) => event.id === data.activeEventId) ?? data.events[0];

  const changeView = (next: View) => {
    setView(next);
    setMobileOpen(false);
  };

  const setActiveEvent = (eventId: string) => {
    setData((current) => ({ ...current, activeEventId: eventId }));
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Flag size={22} /></div>
          <div>
            <strong>Arena Command</strong>
            <span>Team roping operations</span>
          </div>
          <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>

        <nav>
          <p className="nav-label">Workspace</p>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              className={view === id ? "active" : ""}
              key={id}
              onClick={() => changeView(id)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-event">
          <span className="live-dot" />
          <div>
            <small>Current event</small>
            <strong>{activeEvent?.name ?? "No event selected"}</strong>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
          <div>
            <span className="eyebrow">Arena workspace</span>
            <h1>{navItems.find((item) => item.id === view)?.label}</h1>
          </div>
          <label className="event-switcher">
            <CalendarDays size={18} />
            <select
              value={activeEvent?.id ?? ""}
              onChange={(event) => setActiveEvent(event.target.value)}
              disabled={!data.events.length}
            >
              {data.events.map((event) => (
                <option value={event.id} key={event.id}>{event.name}</option>
              ))}
            </select>
            <ChevronDown size={16} />
          </label>
        </header>

        <div className="content">
          {view === "overview" && (
            <Overview
              event={activeEvent}
              teams={data.teams}
              contestants={data.contestants}
              onNavigate={changeView}
            />
          )}
          {view === "events" && (
            <Events
              events={data.events}
              activeEventId={data.activeEventId}
              onAdd={(event) =>
                setData((current) => ({
                  ...current,
                  events: [...current.events, event],
                  activeEventId: event.id,
                }))
              }
              onSelect={setActiveEvent}
            />
          )}
          {view === "contestants" && (
            <Contestants
              contestants={data.contestants}
              onAdd={(contestant) =>
                setData((current) => ({
                  ...current,
                  contestants: [...current.contestants, contestant],
                }))
              }
            />
          )}
          {view === "teams" && (
            <Teams
              event={activeEvent}
              teams={data.teams}
              contestants={data.contestants}
              onAdd={(team) =>
                setData((current) => ({ ...current, teams: [...current.teams, team] }))
              }
              onShuffle={(eventId) =>
                setData((current) => {
                  const eventTeams = current.teams
                    .filter((team) => team.eventId === eventId)
                    .map((team) => ({ team, order: Math.random() }))
                    .sort((a, b) => a.order - b.order)
                    .map(({ team }, index) => ({ ...team, drawPosition: index + 1 }));
                  const positions = new Map(eventTeams.map((team) => [team.id, team.drawPosition]));
                  return {
                    ...current,
                    teams: current.teams.map((team) =>
                      positions.has(team.id)
                        ? { ...team, drawPosition: positions.get(team.id)! }
                        : team,
                    ),
                  };
                })
              }
            />
          )}
          {view === "run-desk" && (
            <RunDesk
              event={activeEvent}
              teams={data.teams}
              contestants={data.contestants}
              onSave={(teamId, update) =>
                setData((current) => ({
                  ...current,
                  teams: current.teams.map((team) =>
                    team.id === teamId ? { ...team, ...update } : team,
                  ),
                }))
              }
            />
          )}
        </div>
      </main>
      {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}
    </div>
  );
}

function Overview({
  event,
  teams,
  contestants,
  onNavigate,
}: {
  event?: ArenaEvent;
  teams: Team[];
  contestants: Contestant[];
  onNavigate: (view: View) => void;
}) {
  const eventTeams = teams
    .filter((team) => team.eventId === event?.id)
    .sort((a, b) => a.drawPosition - b.drawPosition);
  const completed = eventTeams.filter((team) => team.status !== "ready");
  const upcoming = eventTeams.filter((team) => team.status === "ready").slice(0, 4);
  const standings = eventTeams
    .filter((team) => team.status === "complete" && team.rawTime !== null)
    .sort((a, b) => (a.rawTime! + a.penalties) - (b.rawTime! + b.penalties))
    .slice(0, 3);
  const rider = (id: string) => contestants.find((item) => item.id === id)?.name ?? "Unknown";

  return (
    <>
      <section className="hero">
        <div>
          <span className="status-pill"><span /> {event?.status ?? "No event"}</span>
          <h2>{event?.name ?? "Create your first roping event"}</h2>
          {event && (
            <p><CalendarDays size={16} /> {formatDate(event.date)} at {formatTime(event.startTime)} <i /> <MapPin size={16} /> {event.location}</p>
          )}
        </div>
        <button className="primary" onClick={() => onNavigate(event ? "run-desk" : "events")}>
          {event ? "Open run desk" : "Create event"} <ArrowRight size={18} />
        </button>
      </section>

      <section className="stat-grid">
        <Stat icon={UsersRound} label="Teams entered" value={eventTeams.length} detail={`${contestants.length} riders on file`} />
        <Stat icon={Check} label="Runs completed" value={completed.length} detail={`${Math.max(eventTeams.length - completed.length, 0)} still to rope`} />
        <Stat icon={Clock3} label="Fast time" value={standings[0] ? `${(standings[0].rawTime! + standings[0].penalties).toFixed(2)}s` : "--"} detail={standings[0] ? `${rider(standings[0].headerId)} / ${rider(standings[0].heelerId)}` : "Waiting on results"} />
        <Stat icon={CircleDollarSign} label="Entry pot" value={`$${(eventTeams.length * (event?.entryFee ?? 0)).toLocaleString()}`} detail={`$${event?.entryFee ?? 0} per team`} />
      </section>

      <section className="two-column">
        <div className="panel">
          <PanelHeading title="On deck" subtitle="Next teams in the draw" action="View draw" onAction={() => onNavigate("teams")} />
          <div className="run-list compact">
            {upcoming.map((team, index) => (
              <div className={index === 0 ? "run-row on-deck" : "run-row"} key={team.id}>
                <span className="draw-number">{team.drawPosition}</span>
                <div className="team-names">
                  <strong>{rider(team.headerId)}</strong>
                  <span>Header</span>
                </div>
                <div className="team-names">
                  <strong>{rider(team.heelerId)}</strong>
                  <span>Heeler</span>
                </div>
                {index === 0 && <span className="tag amber">On deck</span>}
              </div>
            ))}
            {!upcoming.length && <EmptyState text="No teams waiting in the draw." />}
          </div>
        </div>

        <div className="panel">
          <PanelHeading title="Leaderboard" subtitle="Current event standings" action="Run desk" onAction={() => onNavigate("run-desk")} />
          <div className="leaderboard">
            {standings.map((team, index) => (
              <div className="leader-row" key={team.id}>
                <span className={`place place-${index + 1}`}>{index + 1}</span>
                <div>
                  <strong>{rider(team.headerId)} <em>&</em> {rider(team.heelerId)}</strong>
                  <small>Draw #{team.drawPosition}{team.penalties ? ` · +${team.penalties}s penalty` : " · Clean run"}</small>
                </div>
                <b>{(team.rawTime! + team.penalties).toFixed(2)}</b>
              </div>
            ))}
            {!standings.length && <EmptyState text="Completed runs will appear here." />}
          </div>
        </div>
      </section>
    </>
  );
}

function Stat({ icon: Icon, label, value, detail }: { icon: typeof Gauge; label: string; value: string | number; detail: string }) {
  return (
    <div className="stat-card">
      <span className="stat-icon"><Icon size={20} /></span>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function Events({
  events,
  activeEventId,
  onAdd,
  onSelect,
}: {
  events: ArenaEvent[];
  activeEventId: string;
  onAdd: (event: ArenaEvent) => void;
  onSelect: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      <PageIntro
        title="Events"
        text="Create jackpots and series stops, then select the active event for arena operations."
        button="New event"
        onClick={() => setShowForm((open) => !open)}
      />
      {showForm && <EventForm onSubmit={(event) => { onAdd(event); setShowForm(false); }} onCancel={() => setShowForm(false)} />}
      <div className="event-grid">
        {events.map((event) => (
          <article className={`event-card ${event.id === activeEventId ? "selected" : ""}`} key={event.id}>
            <div className="event-date">
              <strong>{new Date(`${event.date}T12:00:00`).getDate()}</strong>
              <span>{new Date(`${event.date}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</span>
            </div>
            <div className="event-card-body">
              <span className={`tag ${event.status.toLowerCase()}`}>{event.status}</span>
              <h3>{event.name}</h3>
              <p><MapPin size={15} /> {event.location}</p>
              <p><Clock3 size={15} /> {formatTime(event.startTime)} · ${event.entryFee} entry</p>
              <button className={event.id === activeEventId ? "selected-button" : "secondary"} onClick={() => onSelect(event.id)}>
                {event.id === activeEventId ? <><Check size={16} /> Active event</> : "Set as active"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function EventForm({ onSubmit, onCancel }: { onSubmit: (event: ArenaEvent) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    name: "", date: "", startTime: "18:00", location: "", status: "Upcoming" as EventStatus, entryFee: "60",
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ ...form, id: uid("event"), entryFee: Number(form.entryFee) || 0 });
  };

  return (
    <form className="form-panel" onSubmit={submit}>
      <div className="form-heading"><div><h3>Create event</h3><p>Add the details used across the draw and run desk.</p></div><button type="button" className="icon-button" onClick={onCancel}><X size={20} /></button></div>
      <div className="form-grid">
        <Field label="Event name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Saturday Night Jackpot" /></Field>
        <Field label="Location"><input required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Arena name" /></Field>
        <Field label="Date"><input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="Start time"><input required type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></Field>
        <Field label="Entry fee"><input required min="0" type="number" value={form.entryFee} onChange={(e) => setForm({ ...form, entryFee: e.target.value })} /></Field>
        <Field label="Status"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EventStatus })}><option>Upcoming</option><option>Live</option><option>Complete</option></select></Field>
      </div>
      <FormActions onCancel={onCancel} submitLabel="Create event" />
    </form>
  );
}

function Contestants({ contestants, onAdd }: { contestants: Contestant[]; onAdd: (contestant: Contestant) => void }) {
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = contestants.filter((contestant) =>
    `${contestant.name} ${contestant.hometown} ${contestant.role}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <PageIntro title="Contestants" text="Maintain the rider roster used to build teams for every event." button="Add contestant" onClick={() => setShowForm((open) => !open)} />
      {showForm && <ContestantForm onSubmit={(rider) => { onAdd(rider); setShowForm(false); }} onCancel={() => setShowForm(false)} />}
      <div className="panel table-panel">
        <div className="table-toolbar">
          <div><h3>Rider roster</h3><p>{contestants.length} contestants on file</p></div>
          <label className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search riders" /></label>
        </div>
        <div className="data-table">
          <div className="table-row table-header"><span>Contestant</span><span>Position</span><span>Hometown</span><span>Phone</span></div>
          {filtered.map((contestant) => (
            <div className="table-row" key={contestant.id}>
              <span className="person"><i>{initials(contestant.name)}</i><strong>{contestant.name}</strong></span>
              <span><b className="tag neutral">{contestant.role}</b></span>
              <span>{contestant.hometown || "—"}</span>
              <span>{contestant.phone || "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function ContestantForm({ onSubmit, onCancel }: { onSubmit: (contestant: Contestant) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: "", role: "Either" as Contestant["role"], phone: "", hometown: "" });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ ...form, id: uid("rider") });
  };
  return (
    <form className="form-panel" onSubmit={submit}>
      <div className="form-heading"><div><h3>Add contestant</h3><p>Create a rider profile for team entries.</p></div><button type="button" className="icon-button" onClick={onCancel}><X size={20} /></button></div>
      <div className="form-grid">
        <Field label="Full name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Rider name" /></Field>
        <Field label="Position"><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Contestant["role"] })}><option>Header</option><option>Heeler</option><option>Either</option></select></Field>
        <Field label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="555-0123" /></Field>
        <Field label="Hometown"><input value={form.hometown} onChange={(e) => setForm({ ...form, hometown: e.target.value })} placeholder="City, State" /></Field>
      </div>
      <FormActions onCancel={onCancel} submitLabel="Add contestant" />
    </form>
  );
}

function Teams({
  event,
  teams,
  contestants,
  onAdd,
  onShuffle,
}: {
  event?: ArenaEvent;
  teams: Team[];
  contestants: Contestant[];
  onAdd: (team: Team) => void;
  onShuffle: (eventId: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const eventTeams = teams.filter((team) => team.eventId === event?.id).sort((a, b) => a.drawPosition - b.drawPosition);
  const rider = (id: string) => contestants.find((item) => item.id === id);

  return (
    <>
      <PageIntro title="Teams & draw" text={event ? `Build and order teams for ${event.name}.` : "Create an event before adding teams."} button="Add team" onClick={() => setShowForm((open) => !open)} disabled={!event} />
      {showForm && event && <TeamForm event={event} contestants={contestants} drawPosition={eventTeams.length + 1} onSubmit={(team) => { onAdd(team); setShowForm(false); }} onCancel={() => setShowForm(false)} />}
      <div className="panel">
        <div className="table-toolbar">
          <div><h3>Draw order</h3><p>{eventTeams.length} teams entered</p></div>
          <button className="secondary" disabled={!eventTeams.length} onClick={() => event && onShuffle(event.id)}><RefreshCw size={16} /> Randomize draw</button>
        </div>
        <div className="draw-list">
          {eventTeams.map((team) => (
            <div className="draw-row" key={team.id}>
              <span className="draw-number large">{team.drawPosition}</span>
              <div className="person"><i>{initials(rider(team.headerId)?.name ?? "")}</i><span><strong>{rider(team.headerId)?.name}</strong><small>Header</small></span></div>
              <span className="pair-mark">&</span>
              <div className="person"><i>{initials(rider(team.heelerId)?.name ?? "")}</i><span><strong>{rider(team.heelerId)?.name}</strong><small>Heeler</small></span></div>
              <span className={`tag ${team.status === "ready" ? "neutral" : team.status}`}>{team.status === "no-time" ? "No time" : team.status}</span>
            </div>
          ))}
          {!eventTeams.length && <EmptyState text="No teams entered for this event yet." />}
        </div>
      </div>
    </>
  );
}

function TeamForm({ event, contestants, drawPosition, onSubmit, onCancel }: { event: ArenaEvent; contestants: Contestant[]; drawPosition: number; onSubmit: (team: Team) => void; onCancel: () => void }) {
  const headers = contestants.filter((rider) => rider.role !== "Heeler");
  const heelers = contestants.filter((rider) => rider.role !== "Header");
  const [headerId, setHeaderId] = useState(headers[0]?.id ?? "");
  const [heelerId, setHeelerId] = useState(heelers.find((rider) => rider.id !== headerId)?.id ?? "");
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    onSubmit({ id: uid("team"), eventId: event.id, headerId, heelerId, drawPosition, status: "ready", rawTime: null, penalties: 0, notes: "" });
  };
  return (
    <form className="form-panel" onSubmit={submit}>
      <div className="form-heading"><div><h3>Add team</h3><p>Entry #{drawPosition} for {event.name}</p></div><button type="button" className="icon-button" onClick={onCancel}><X size={20} /></button></div>
      <div className="form-grid two">
        <Field label="Header"><select value={headerId} required onChange={(e) => setHeaderId(e.target.value)}>{headers.map((rider) => <option value={rider.id} key={rider.id}>{rider.name}</option>)}</select></Field>
        <Field label="Heeler"><select value={heelerId} required onChange={(e) => setHeelerId(e.target.value)}>{heelers.filter((rider) => rider.id !== headerId).map((rider) => <option value={rider.id} key={rider.id}>{rider.name}</option>)}</select></Field>
      </div>
      <FormActions onCancel={onCancel} submitLabel="Add to draw" />
    </form>
  );
}

function RunDesk({
  event,
  teams,
  contestants,
  onSave,
}: {
  event?: ArenaEvent;
  teams: Team[];
  contestants: Contestant[];
  onSave: (teamId: string, update: Partial<Team>) => void;
}) {
  const eventTeams = teams.filter((team) => team.eventId === event?.id).sort((a, b) => a.drawPosition - b.drawPosition);
  const nextTeam = eventTeams.find((team) => team.status === "ready");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = eventTeams.find((team) => team.id === selectedId) ?? nextTeam;
  const [rawTime, setRawTime] = useState("");
  const [penalties, setPenalties] = useState("0");
  const [notes, setNotes] = useState("");
  const rider = (id: string) => contestants.find((item) => item.id === id)?.name ?? "Unknown";
  const standings = eventTeams
    .filter((team) => team.status === "complete" && team.rawTime !== null)
    .sort((a, b) => (a.rawTime! + a.penalties) - (b.rawTime! + b.penalties));

  const chooseTeam = (team: Team) => {
    setSelectedId(team.id);
    setRawTime(team.rawTime?.toString() ?? "");
    setPenalties(team.penalties.toString());
    setNotes(team.notes);
  };
  const saveRun = (status: Team["status"]) => {
    if (!selected) return;
    onSave(selected.id, {
      status,
      rawTime: status === "complete" ? Number(rawTime) : null,
      penalties: status === "complete" ? Number(penalties) : 0,
      notes,
    });
    setSelectedId(null);
    setRawTime("");
    setPenalties("0");
    setNotes("");
  };

  return (
    <>
      <PageIntro title="Run desk" text={event ? `Record times and publish standings for ${event.name}.` : "Select an event to open the run desk."} />
      <div className="run-desk-grid">
        <section className="panel desk-entry">
          <div className="desk-title"><span className="stat-icon"><Gauge size={21} /></span><div><span>Now roping</span><h3>{selected ? `Draw #${selected.drawPosition}` : "Draw complete"}</h3></div></div>
          {selected ? (
            <>
              <div className="active-team">
                <div><span>Header</span><strong>{rider(selected.headerId)}</strong></div>
                <i>&</i>
                <div><span>Heeler</span><strong>{rider(selected.heelerId)}</strong></div>
              </div>
              <div className="time-entry">
                <label>Raw time <span>seconds</span></label>
                <input type="number" min="0" step="0.01" value={rawTime} onChange={(e) => setRawTime(e.target.value)} placeholder="0.00" />
              </div>
              <div className="penalty-buttons">
                <span>Penalty</span>
                {["0", "5", "10", "15"].map((value) => <button className={penalties === value ? "active" : ""} key={value} onClick={() => setPenalties(value)}>{value === "0" ? "Clean" : `+${value}s`}</button>)}
              </div>
              <Field label="Run notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note" /></Field>
              <div className="result-preview"><span>Official time</span><strong>{rawTime ? (Number(rawTime) + Number(penalties)).toFixed(2) : "—"}</strong></div>
              <div className="desk-actions"><button className="no-time-button" onClick={() => saveRun("no-time")}>Mark no time</button><button className="primary" disabled={!rawTime || Number(rawTime) <= 0} onClick={() => saveRun("complete")}><Check size={18} /> Save result</button></div>
            </>
          ) : <EmptyState text="Every team in this draw has a result." />}
        </section>

        <section className="panel run-queue">
          <PanelHeading title="Run order" subtitle={`${eventTeams.filter((team) => team.status === "ready").length} teams remaining`} />
          <div className="queue-scroll">
            {eventTeams.map((team) => (
              <button className={`queue-row ${selected?.id === team.id ? "active" : ""}`} key={team.id} onClick={() => chooseTeam(team)}>
                <span className="draw-number">{team.drawPosition}</span>
                <div><strong>{rider(team.headerId)} & {rider(team.heelerId)}</strong><small>{team.status === "complete" ? `${(team.rawTime! + team.penalties).toFixed(2)} seconds` : team.status === "no-time" ? "No time" : "Ready"}</small></div>
                <span className={`status-dot ${team.status}`} />
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="panel standings-panel">
        <PanelHeading title="Official standings" subtitle={`${standings.length} qualified runs`} />
        <div className="data-table standings-table">
          <div className="table-row table-header"><span>Place</span><span>Team</span><span>Raw time</span><span>Penalty</span><span>Total</span></div>
          {standings.map((team, index) => (
            <div className="table-row" key={team.id}>
              <span><b className={`place place-${index + 1}`}>{index + 1}</b></span>
              <span><strong>{rider(team.headerId)} & {rider(team.heelerId)}</strong><small>Draw #{team.drawPosition}</small></span>
              <span>{team.rawTime?.toFixed(2)}</span>
              <span>{team.penalties ? `+${team.penalties}` : "—"}</span>
              <span><b className="total-time">{(team.rawTime! + team.penalties).toFixed(2)}</b></span>
            </div>
          ))}
          {!standings.length && <EmptyState text="Qualified runs will appear here." />}
        </div>
      </section>
    </>
  );
}

function PageIntro({ title, text, button, onClick, disabled }: { title: string; text: string; button?: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <div className="page-intro">
      <div><h2>{title}</h2><p>{text}</p></div>
      {button && <button className="primary" onClick={onClick} disabled={disabled}><Plus size={18} /> {button}</button>}
    </div>
  );
}

function PanelHeading({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return (
    <div className="panel-heading">
      <div><h3>{title}</h3><p>{subtitle}</p></div>
      {action && <button onClick={onAction}>{action} <ArrowRight size={15} /></button>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function FormActions({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return <div className="form-actions"><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button className="primary" type="submit">{submitLabel}</button></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><ListOrdered size={24} /><p>{text}</p></div>;
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export default App;
