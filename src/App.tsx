import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Camera,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Cloud,
  CloudOff,
  Copy,
  Dices,
  Download,
  FileBarChart,
  Gauge,
  GitFork,
  Handshake,
  LayoutDashboard,
  LogIn,
  LogOut,
  ListOrdered,
  Lock,
  MapPin,
  Maximize2,
  Menu,
  MonitorUp,
  Plus,
  Pencil,
  Printer,
  RefreshCw,
  Repeat2,
  Search,
  Trophy,
  Trash2,
  Unlock,
  Upload,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { normalizeData, useArenaData } from "./useArenaData";
import { ReportsModule } from "./ReportsModule";
import {
  authenticateContestant,
  isWixEmbed,
  setContestantPin,
  type ContestantPortalData,
} from "./wixBridge";
import {
  calculatePayouts,
  calculatePurse,
  applyRunResult,
  competitionName,
  competitionTypes,
  defaultCompetitionSettings,
  generateCompetitionDraw,
  registrationsForPickedTeam,
  teamHandicapTotal,
} from "./competition";
import type {
  ArenaData,
  ArenaEvent,
  ArenaMeet,
  CompetitionType,
  Contestant,
  EventRegistration,
  EventStatus,
  PickDrawRole,
  Team,
  View,
} from "./types";

const navItems: { id: View; label: string; icon: typeof Gauge }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "events", label: "Events", icon: CalendarDays },
  { id: "contestants", label: "Contestants", icon: UserRound },
  { id: "teams", label: "Teams & Draw", icon: UsersRound },
  { id: "run-desk", label: "Run Desk", icon: Gauge },
  { id: "reports", label: "Reports", icon: FileBarChart },
];

const uid = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const sameTeamEntry = (left: Team, right: Team) =>
  left.eventId === right.eventId &&
  left.headerId === right.headerId &&
  left.heelerId === right.heelerId &&
  (left.headerEntryNumber ?? 1) === (right.headerEntryNumber ?? 1) &&
  (left.heelerEntryNumber ?? 1) === (right.heelerEntryNumber ?? 1);

const teamQualifiedTotal = (
  team: Team,
  teams: Team[],
  beforeRound = team.round + 1,
) =>
  teams
    .filter(
      (run) =>
        sameTeamEntry(run, team) &&
        run.round < beforeRound &&
        run.status === "complete" &&
        run.rawTime !== null &&
        !run.scratched,
    )
    .reduce((total, run) => total + run.rawTime! + run.penalties, 0);

function App() {
  const [data, setData, persistenceStatus] = useArenaData();
  const [view, setView] = useState<View>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const activeEvent =
    data.events.find((event) => event.id === data.activeEventId) ?? data.events[0];
  const displayParams = new URLSearchParams(window.location.search);
  if (displayParams.get("portal") === "contestant") {
    return <ContestantPortal />;
  }
  if (displayParams.get("display") === "leaderboard") {
    return (
      <LedLeaderboard
        data={data}
        eventId={displayParams.get("event") ?? activeEvent?.id}
        requestedRound={Number(displayParams.get("round")) || undefined}
        requestedTeamId={displayParams.get("team") ?? undefined}
      />
    );
  }

  const changeView = (next: View) => {
    setView(next);
    setMobileOpen(false);
  };

  const setActiveEvent = (eventId: string) => {
    setData((current) => ({ ...current, activeEventId: eventId }));
  };
  const openActiveLedScreen = () => {
    if (!activeEvent) return;
    const eventTeams = data.teams.filter(
      (team) => team.eventId === activeEvent.id && !team.scratched,
    );
    const latestRound = Math.max(
      1,
      ...eventTeams.map((team) => team.round),
    );
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("display", "leaderboard");
    url.searchParams.set("event", activeEvent.id);
    url.searchParams.set("round", String(latestRound));
    window.location.assign(url.toString());
  };
  const openContestantPortal = () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("portal", "contestant");
    window.location.assign(url.toString());
  };
  const downloadWorkspace = () => {
    const backup = {
      format: "arena-command-workspace",
      version: 1,
      exportedAt: new Date().toISOString(),
      data,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `arena-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setWorkspaceMessage("Workspace backup downloaded.");
  };
  const restoreWorkspace = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as {
        format?: unknown;
        data?: unknown;
      };
      const candidate =
        parsed.format === "arena-command-workspace" ? parsed.data : parsed;
      if (
        !candidate ||
        typeof candidate !== "object" ||
        !Array.isArray((candidate as ArenaData).events) ||
        !Array.isArray((candidate as ArenaData).contestants) ||
        !Array.isArray((candidate as ArenaData).teams) ||
        !Array.isArray((candidate as ArenaData).registrations)
      ) {
        throw new Error("Choose a valid Arena Command workspace backup.");
      }
      const restored = normalizeData(candidate as ArenaData);
      setData(restored);
      setWorkspaceMessage(
        `Workspace restored: ${restored.events.length} ropings and ${restored.contestants.length} contestants.`,
      );
    } catch (error) {
      setWorkspaceMessage(
        error instanceof Error
          ? error.message
          : "The workspace backup could not be restored.",
      );
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <img src="./destiny-ranch-arena-logo.png" alt="Destiny Ranch Arena" />
          </div>
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
          <button disabled={!activeEvent} onClick={openActiveLedScreen}>
            <MonitorUp size={19} />
            LED Screen
          </button>
          <button onClick={openContestantPortal}>
            <LogIn size={19} />
            Contestant Login
          </button>
        </nav>

        <div className="sidebar-backup">
          <p className="nav-label">Data safety</p>
          <button onClick={downloadWorkspace}><Download size={15} /> Backup workspace</button>
          <label><Upload size={15} /> Restore workspace<input type="file" accept="application/json,.json" onChange={(event) => { void restoreWorkspace(event.target.files?.[0]); event.target.value = ""; }} /></label>
          {workspaceMessage && <small>{workspaceMessage}</small>}
        </div>
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
          <div className={`persistence-status ${persistenceStatus}`}>
            {persistenceStatus === "error" ? <CloudOff size={15} /> : <Cloud size={15} />}
            <span>
              {persistenceStatus === "loading"
                ? "Connecting to Wix"
                : persistenceStatus === "saving"
                  ? "Saving"
                  : persistenceStatus === "saved"
                    ? "Saved to Wix"
                    : persistenceStatus === "error"
                      ? "Wix save failed"
                      : "Local preview"}
            </span>
          </div>
          <label className="event-switcher">
            <CalendarDays size={18} />
            <select
              value={activeEvent?.id ?? ""}
              onChange={(event) => setActiveEvent(event.target.value)}
              disabled={!data.events.length}
            >
              {data.events.map((event) => (
                <option value={event.id} key={event.id}>
                  {data.meets.find((meet) => meet.id === event.parentEventId)?.name} — {event.name}
                </option>
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
              registrations={data.registrations}
              contestants={data.contestants}
              onNavigate={changeView}
            />
          )}
          {view === "events" && (
            <Events
              events={data.events}
              meets={data.meets}
              teams={data.teams}
              activeEventId={data.activeEventId}
              onAdd={(event) =>
                setData((current) => ({
                  ...current,
                  events: [...current.events, event],
                  activeEventId: event.id,
                }))
              }
              onAddMeet={(meet) =>
                setData((current) => ({
                  ...current,
                  meets: [...current.meets, meet],
                }))
              }
              onUpdateMeet={(meet) =>
                setData((current) => ({
                  ...current,
                  meets: current.meets.map((item) => item.id === meet.id ? meet : item),
                  events: current.events.map((event) =>
                    event.parentEventId === meet.id
                      ? {
                          ...event,
                          date: meet.date,
                          startTime: meet.startTime,
                          location: meet.location,
                        }
                      : event,
                  ),
                }))
              }
              onDeleteMeet={(meetId) =>
                setData((current) => {
                  const competitionIds = new Set(
                    current.events
                      .filter((event) => event.parentEventId === meetId)
                      .map((event) => event.id),
                  );
                  const events = current.events.filter(
                    (event) => event.parentEventId !== meetId,
                  );
                  return {
                    ...current,
                    meets: current.meets.filter((meet) => meet.id !== meetId),
                    events,
                    teams: current.teams.filter(
                      (team) => !competitionIds.has(team.eventId),
                    ),
                    registrations: current.registrations.filter(
                      (registration) => !competitionIds.has(registration.eventId),
                    ),
                    activeEventId: competitionIds.has(current.activeEventId)
                      ? events[0]?.id ?? ""
                      : current.activeEventId,
                  };
                })
              }
              onSelect={setActiveEvent}
              onUpdate={(event) =>
                setData((current) => ({
                  ...current,
                  events: current.events.map((item) => item.id === event.id ? event : item),
                }))
              }
              onDelete={(eventId) =>
                setData((current) => {
                  const events = current.events.filter((event) => event.id !== eventId);
                  return {
                    ...current,
                    events,
                    teams: current.teams.filter((team) => team.eventId !== eventId),
                    registrations: current.registrations.filter(
                      (registration) => registration.eventId !== eventId,
                    ),
                    activeEventId:
                      current.activeEventId === eventId
                        ? events[0]?.id ?? ""
                        : current.activeEventId,
                  };
                })
              }
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
              onUpdate={(contestant) =>
                setData((current) => ({
                  ...current,
                  contestants: current.contestants.map((item) =>
                    item.id === contestant.id ? contestant : item,
                  ),
                }))
              }
              onDelete={(contestantId) =>
                setData((current) => ({
                  ...current,
                  contestants: current.contestants.filter((item) => item.id !== contestantId),
                  registrations: current.registrations.filter(
                    (registration) => registration.contestantId !== contestantId,
                  ),
                  teams: current.teams.filter(
                    (team) => team.headerId !== contestantId && team.heelerId !== contestantId,
                  ),
                }))
              }
              onImport={(contestants) =>
                setData((current) => {
                  const importedById = new Map(
                    contestants.map((contestant) => [contestant.id, contestant]),
                  );
                  return {
                    ...current,
                    contestants: [
                      ...current.contestants.map(
                        (contestant) =>
                          importedById.get(contestant.id) ?? contestant,
                      ),
                      ...contestants.filter(
                        (contestant) =>
                          !current.contestants.some(
                            (currentContestant) =>
                              currentContestant.id === contestant.id,
                          ),
                      ),
                    ],
                  };
                })
              }
            />
          )}
          {view === "teams" && (
            <Teams
              event={activeEvent}
              teams={data.teams}
              registrations={data.registrations}
              contestants={data.contestants}
              onAdd={(team) =>
                setData((current) => ({
                  ...current,
                  teams: [...current.teams, team],
                  registrations: activeEvent
                    ? [
                        ...current.registrations,
                        ...registrationsForPickedTeam(activeEvent, team),
                      ]
                    : current.registrations,
                }))
              }
              onUpdateTeam={(updatedTeam) =>
                setData((current) => ({
                  ...current,
                  teams: current.teams.map((team) =>
                    team.id === updatedTeam.id ? updatedTeam : team,
                  ),
                  registrations:
                    activeEvent && !updatedTeam.generated
                      ? [
                          ...current.registrations.filter(
                            (registration) =>
                              registration.sourceTeamId !== updatedTeam.id,
                          ),
                          ...registrationsForPickedTeam(
                            activeEvent,
                            updatedTeam,
                          ),
                        ]
                      : current.registrations,
                }))
              }
              onDeleteTeam={(teamId) =>
                setData((current) => ({
                  ...current,
                  teams: current.teams.filter((team) => team.id !== teamId),
                  registrations: current.registrations.filter(
                    (registration) => registration.sourceTeamId !== teamId,
                  ),
                }))
              }
              onAddRegistration={(registration) =>
                setData((current) => ({
                  ...current,
                  registrations: [...current.registrations, registration],
                }))
              }
              onUpdateRegistration={(registration) =>
                setData((current) => ({
                  ...current,
                  registrations: current.registrations.map((item) =>
                    item.id === registration.id ? registration : item,
                  ),
                }))
              }
              onDeleteRegistration={(registrationId) =>
                setData((current) => ({
                  ...current,
                  registrations: current.registrations.filter(
                    (registration) => registration.id !== registrationId,
                  ),
                }))
              }
              onCommitDraw={(eventId, eventTeams) =>
                setData((current) => ({
                  ...current,
                  teams: [
                    ...current.teams.filter((team) => team.eventId !== eventId),
                    ...eventTeams,
                  ],
                  events: current.events.map((event) =>
                    event.id === eventId
                      ? {
                          ...event,
                          drawHistory: [
                            ...event.drawHistory,
                            {
                              id: uid("draw"),
                              createdAt: new Date().toISOString(),
                              teams: eventTeams,
                            },
                          ],
                        }
                      : event,
                  ),
                }))
              }
              onUpdateEvent={(updatedEvent) =>
                setData((current) => ({
                  ...current,
                  events: current.events.map((event) =>
                    event.id === updatedEvent.id ? updatedEvent : event,
                  ),
                }))
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
              registrations={data.registrations}
              contestants={data.contestants}
              onUpdateEvent={(updatedEvent) =>
                setData((current) => ({
                  ...current,
                  events: current.events.map((event) =>
                    event.id === updatedEvent.id ? updatedEvent : event,
                  ),
                }))
              }
              onSave={(teamId, update) =>
                setData((current) => {
                  return {
                    ...current,
                    teams: applyRunResult(
                      current.teams,
                      teamId,
                      update,
                      activeEvent?.rounds ?? 1,
                      activeEvent?.shortGoTeams ?? 0,
                    ),
                  };
                })
              }
              onAddRideIn={(team) =>
                setData((current) => ({
                  ...current,
                  teams: [...current.teams, team],
                }))
              }
              onRollTeam={(teamId, rolled) =>
                setData((current) => ({
                  ...current,
                  teams: current.teams.map((team) =>
                    team.id === teamId ? { ...team, rolled } : team,
                  ),
                }))
              }
            />
          )}
          {view === "reports" && <ReportsModule data={data} />}
        </div>
      </main>
      {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}
    </div>
  );
}

function ContestantPortal() {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [portalData, setPortalData] = useState<ContestantPortalData | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const rider = (id: string) =>
    (portalData?.contestant.id === id
      ? portalData.contestant.name
      : portalData?.contestants.find((contestant) => contestant.id === id)
          ?.name) ??
    "Unknown";
  const exitPortal = () => {
    const url = new URL(window.location.href);
    url.search = "";
    window.location.assign(url.toString());
  };
  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (!isWixEmbed()) {
      setMessage("Contestant login is available on the published Wix site.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const result = await authenticateContestant(email, pin);
      if (!result) throw new Error("Contestant login did not return a profile.");
      setPortalData(result);
      setPin("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Contestant login failed.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (!portalData) {
    return (
      <div className="contestant-portal login-page">
        <div className="portal-login-card">
          <img src="./destiny-ranch-arena-logo.png" alt="Destiny Ranch Arena" />
          <span className="eyebrow">Contestant portal</span>
          <h1>Roper login</h1>
          <p>Use the email and four-digit PIN configured by the event producer.</p>
          <form onSubmit={login}>
            <Field label="Email"><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="rider@example.com" /></Field>
            <Field label="4-digit PIN"><input required type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" /></Field>
            {message && <div className="portal-error">{message}</div>}
            <button className="primary portal-login-button" disabled={loading}>{loading ? "Signing in..." : <><LogIn size={18} /> Sign in</>}</button>
          </form>
          <button className="portal-back" onClick={exitPortal}>Back to Arena Command</button>
        </div>
      </div>
    );
  }

  const eventName = (eventId: string) =>
    portalData.events.find((event) => event.id === eventId)?.name ??
    "Competition";
  const sortedTeams = [...portalData.teams].sort(
    (a, b) =>
      eventName(a.eventId).localeCompare(eventName(b.eventId)) ||
      a.round - b.round ||
      a.drawPosition - b.drawPosition,
  );
  return (
    <div className="contestant-portal">
      <header className="portal-header">
        <div><span className="eyebrow">Contestant portal</span><h1>{portalData.contestant.name}</h1><p>{portalData.contestant.email}</p></div>
        <button className="secondary" onClick={() => setPortalData(null)}><LogOut size={17} /> Sign out</button>
      </header>
      <main className="portal-content">
        <section className="portal-summary">
          <div><span>Competitions</span><strong>{portalData.events.length}</strong></div>
          <div><span>Entries</span><strong>{portalData.registrations.reduce((total, entry) => total + entry.entries, 0) + portalData.teams.filter((team) => team.round === 1 && !team.generated).length}</strong></div>
          <div><span>Team runs</span><strong>{portalData.teams.length}</strong></div>
          <div><span>Qualified results</span><strong>{portalData.teams.filter((team) => team.status === "complete").length}</strong></div>
        </section>
        <section className="panel portal-panel">
          <PanelHeading title="My draw and results" subtitle="Read-only competition details" />
          <div className="portal-team-list">
            {sortedTeams.map((team) => (
              <div className="portal-team-row" key={team.id}>
                <div><strong>{eventName(team.eventId)}</strong><small>Round {team.round} · Draw #{team.drawPosition}</small></div>
                <div><span>Header</span><strong>{rider(team.headerId)}</strong></div>
                <div><span>Heeler</span><strong>{rider(team.heelerId)}</strong></div>
                <div className="portal-result"><span>Result</span><strong>{team.status === "complete" && team.rawTime !== null ? `${(team.rawTime + team.penalties).toFixed(2)}s` : team.status === "no-time" ? "No time" : team.rolled ? "Rolled" : "Ready"}</strong></div>
              </div>
            ))}
            {!sortedTeams.length && <EmptyState text="No team entries are available yet." />}
          </div>
        </section>
        <section className="panel portal-panel">
          <PanelHeading title="My draw-pot entries" subtitle="Registration status by competition" />
          <div className="portal-registration-list">
            {portalData.registrations.map((registration) => (
              <div className="portal-registration-row" key={registration.id}>
                <strong>{eventName(registration.eventId)}</strong>
                <span>{registration.role}</span>
                <span>{registration.entries} entr{registration.entries === 1 ? "y" : "ies"}</span>
                <span className={`tag ${registration.status === "entered" ? "complete" : "neutral"}`}>{registration.status}</span>
              </div>
            ))}
            {!portalData.registrations.length && <EmptyState text="No draw-pot registrations are available." />}
          </div>
        </section>
      </main>
    </div>
  );
}

function LedLeaderboard({
  data,
  eventId,
  requestedRound,
  requestedTeamId,
}: {
  data: ArenaData;
  eventId?: string;
  requestedRound?: number;
  requestedTeamId?: string;
}) {
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const event =
    data.events.find((item) => item.id === eventId) ??
    data.events.find((item) => item.id === data.activeEventId) ??
    data.events[0];
  if (!event) {
    return <div className="led-leaderboard led-empty">No competition selected</div>;
  }
  const round = Math.min(
    Math.max(requestedRound ?? event.rounds, 1),
    Math.max(event.rounds, 1),
  );
  const eventTeams = data.teams.filter(
    (team) => team.eventId === event.id && !team.scratched,
  );
  const roundTeams = eventTeams
    .filter((team) => team.round === round)
    .sort(
      (a, b) =>
        Number(Boolean(a.rolled)) - Number(Boolean(b.rolled)) ||
        a.drawPosition - b.drawPosition,
    );
  const standings = roundTeams
    .filter((team) => team.status === "complete" && team.rawTime !== null)
    .sort(
      (a, b) =>
        teamQualifiedTotal(a, eventTeams) -
          teamQualifiedTotal(b, eventTeams) ||
        a.drawPosition - b.drawPosition,
    )
    .slice(0, 10);
  const defaultCurrentTeam = roundTeams.find(
    (team) => team.status === "ready" && !team.rolled,
  ) ?? roundTeams.find((team) => team.status === "ready");
  const currentTeam =
    roundTeams.find(
      (team) => team.id === requestedTeamId && team.status === "ready",
    ) ?? defaultCurrentTeam;
  const nextTeam =
    roundTeams.find(
      (team) =>
        team.status === "ready" &&
        !team.rolled &&
        team.id !== currentTeam?.id,
    ) ??
    roundTeams.find(
      (team) => team.status === "ready" && team.id !== currentTeam?.id,
    );
  const isFinalRound = event.rounds > 1 && round === event.rounds;
  const finalRoundLeaderTotal = isFinalRound
    ? roundTeams
        .filter((team) => team.status === "complete" && team.rawTime !== null)
        .map((team) => teamQualifiedTotal(team, eventTeams))
        .sort((a, b) => a - b)[0]
    : undefined;
  const currentTeamPriorTotal = currentTeam
    ? teamQualifiedTotal(currentTeam, eventTeams, round)
    : 0;
  const currentTeamTimeToFirst =
    finalRoundLeaderTotal === undefined
      ? undefined
      : finalRoundLeaderTotal - currentTeamPriorTotal - 0.01;
  const rider = (id: string) =>
    data.contestants.find((contestant) => contestant.id === id);
  const ledRider = (id: string) => {
    const contestant = rider(id);
    const name = contestant?.name ?? "Unknown";
    return (
      <span className="led-rider">
        <span className="led-avatar">
          {contestant?.photo
            ? <img src={contestant.photo} alt={`${name} profile`} />
            : <span aria-hidden="true">{initials(name)}</span>}
        </span>
        <strong>{name}</strong>
      </span>
    );
  };
  const meet = data.meets.find((item) => item.id === event.parentEventId);
  const enterFullscreen = () => {
    if (document.fullscreenElement) return;
    void document.documentElement.requestFullscreen().catch((error) => {
      console.error("Could not enter LED display fullscreen mode.", error);
    });
  };
  const leaveDisplay = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.search = "";
    window.location.assign(url.toString());
  };

  return (
    <div className="led-leaderboard">
      <header className="led-header">
        <div className="led-brand">
          <img src="./destiny-ranch-arena-logo.png" alt="Destiny Ranch Arena" />
          <div><span>{meet?.name ?? "Destiny Ranch Arena"}</span><h1>{event.name}</h1></div>
        </div>
        <div className="led-round"><span>Live leaderboard</span><strong>Round {round}</strong></div>
        <div className="led-clock"><strong>{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong><span>{clock.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span></div>
        <div className="led-header-actions">
          <button className="led-fullscreen" onClick={enterFullscreen}><Maximize2 size={24} /> Full screen</button>
          <button className="led-fullscreen" onClick={leaveDisplay}><X size={24} /> Back to Run Desk</button>
        </div>
      </header>

      <section className="led-current-team">
        <div className="led-current-label">
          <span className="live-dot" />
          <span>Now roping</span>
          <strong>{currentTeam ? `Draw #${currentTeam.drawPosition}` : "Round complete"}</strong>
        </div>
        {currentTeam && (
          <>
            <div className="led-current-riders">
              {ledRider(currentTeam.headerId)}
              <i>&</i>
              {ledRider(currentTeam.heelerId)}
            </div>
            {isFinalRound && (
              <div className="led-current-targets">
                <span><small>Stay in average</small><strong>{event.timeLimit.toFixed(2)}s</strong></span>
                <span><small>Take 1st</small><strong>{currentTeamTimeToFirst === undefined ? "Set pace" : currentTeamTimeToFirst <= 0 ? "Out of reach" : `${currentTeamTimeToFirst.toFixed(2)}s`}</strong></span>
              </div>
            )}
          </>
        )}
      </section>

      <main className="led-board">
        <div className="led-table-header"><span>Place</span><span>Team</span><span>Rounds</span><span>Total time</span></div>
        <div className="led-rows">
          {standings.map((team, index) => {
            const completedRounds = eventTeams.filter(
              (run) =>
                sameTeamEntry(run, team) &&
                run.round <= round &&
                run.status === "complete" &&
                run.rawTime !== null,
            ).length;
            return (
              <div className={`led-row led-place-${index + 1}`} key={team.id}>
                <span className="led-place">{index + 1}</span>
                <span className="led-team">{ledRider(team.headerId)}<i>&</i>{ledRider(team.heelerId)}</span>
                <span className="led-rounds">{completedRounds} / {event.rounds}</span>
                <span className="led-total">{teamQualifiedTotal(team, eventTeams).toFixed(2)}</span>
              </div>
            );
          })}
          {!standings.length && <div className="led-waiting"><Trophy size={54} /><strong>Waiting for qualified results</strong></div>}
        </div>
      </main>

      <footer className="led-footer">
        <div className="led-next-label"><span className="live-dot" /><strong>Next team</strong></div>
        {nextTeam ? (
          <>
            <span className="led-next-draw">Draw #{nextTeam.drawPosition}</span>
            <span className="led-next-team">{ledRider(nextTeam.headerId)}<i>&</i>{ledRider(nextTeam.heelerId)}</span>
            {nextTeam.rolled && <span className="led-rolled">Rolled</span>}
          </>
        ) : <span className="led-next-team">Round complete</span>}
        <span className="led-location">{event.location}</span>
      </footer>
    </div>
  );
}

function Overview({
  event,
  teams,
  registrations,
  contestants,
  onNavigate,
}: {
  event?: ArenaEvent;
  teams: Team[];
  registrations: EventRegistration[];
  contestants: Contestant[];
  onNavigate: (view: View) => void;
}) {
  const eventTeams = teams
    .filter((team) => team.eventId === event?.id)
    .sort((a, b) => a.drawPosition - b.drawPosition);
  const completed = eventTeams.filter((team) => team.status !== "ready");
  const paidEntries =
    event?.competitionType === "draw-pot"
      ? registrations
          .filter((entry) => entry.eventId === event.id && entry.status === "entered")
          .reduce((total, entry) => total + entry.entries, 0)
      : eventTeams.length;
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
        <Stat icon={CircleDollarSign} label="Entry pot" value={`$${(paidEntries * (event?.entryFee ?? 0)).toLocaleString()}`} detail={`$${event?.entryFee ?? 0} per paid entry`} />
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
  meets,
  events,
  teams,
  activeEventId,
  onAddMeet,
  onUpdateMeet,
  onDeleteMeet,
  onAdd,
  onSelect,
  onUpdate,
  onDelete,
}: {
  meets: ArenaMeet[];
  events: ArenaEvent[];
  teams: Team[];
  activeEventId: string;
  onAddMeet: (meet: ArenaMeet) => void;
  onUpdateMeet: (meet: ArenaMeet) => void;
  onDeleteMeet: (id: string) => void;
  onAdd: (event: ArenaEvent) => void;
  onSelect: (id: string) => void;
  onUpdate: (event: ArenaEvent) => void;
  onDelete: (id: string) => void;
}) {
  const [showMeetForm, setShowMeetForm] = useState(false);
  const [editingMeet, setEditingMeet] = useState<ArenaMeet | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ArenaEvent | null>(null);
  const [copying, setCopying] = useState<ArenaEvent | null>(null);
  const [selectedType, setSelectedType] = useState<CompetitionType | null>(null);
  const selectedParent =
    meets.find((meet) => meet.id === selectedParentId) ??
    meets.find((meet) => meet.id === editing?.parentEventId);

  return (
    <>
      <PageIntro
        title="Events"
        text="Create an arena event, then add independent roping competitions beneath it."
        button="New event"
        onClick={() => {
          setCopying(null);
          setEditingMeet(null);
          setShowMeetForm(true);
          setEditing(null);
          setSelectedParentId(null);
          setSelectedType(null);
        }}
      />
      {(showMeetForm || editingMeet) && (
        <MeetForm
          meet={editingMeet ?? undefined}
          onSubmit={(meet) => {
            if (editingMeet) onUpdateMeet(meet);
            else onAddMeet(meet);
            setEditingMeet(null);
            setShowMeetForm(false);
          }}
          onCancel={() => {
            setEditingMeet(null);
            setShowMeetForm(false);
          }}
        />
      )}
      {copying && (
        <CopyCompetitionForm
          competition={copying}
          sourceMeet={meets.find((meet) => meet.id === copying.parentEventId)}
          targetMeets={meets.filter(
            (meet) =>
              meet.id !== copying.parentEventId &&
              meet.date >= new Date().toISOString().slice(0, 10),
          )}
          onSubmit={(targetMeet, name) => {
            onAdd({
              ...copying,
              id: uid("event"),
              parentEventId: targetMeet.id,
              name,
              date: targetMeet.date,
              startTime: targetMeet.startTime,
              location: targetMeet.location,
              status: "Upcoming",
              registrationOpen: true,
              drawLocked: false,
              resultsPublished: false,
              drawHistory: [],
            });
            setCopying(null);
          }}
          onCancel={() => setCopying(null)}
        />
      )}
      {selectedParentId && !selectedType && !editing && (
        <CompetitionTypeSelector
          events={events.filter((event) => event.parentEventId === selectedParentId)}
          teams={teams}
          onSelect={setSelectedType}
          onCancel={() => setSelectedParentId(null)}
        />
      )}
      {((selectedParentId && selectedType) || editing) && selectedParent && (
        <EventForm
          event={editing ?? undefined}
          parent={selectedParent}
          competitionType={selectedType ?? editing?.competitionType}
          onSubmit={(event) => {
            if (editing) onUpdate(event);
            else onAdd(event);
            setEditing(null);
            setSelectedType(null);
            setSelectedParentId(null);
          }}
          onCancel={() => {
            setEditing(null);
            setSelectedType(null);
            setSelectedParentId(null);
          }}
        />
      )}
      <div className="meet-list">
        {meets.map((meet) => {
          const competitions = events.filter((event) => event.parentEventId === meet.id);
          return (
            <section className="meet-card" key={meet.id}>
              <div className="meet-header">
                <div className="event-date">
                  <strong>{new Date(`${meet.date}T12:00:00`).getDate()}</strong>
                  <span>{new Date(`${meet.date}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</span>
                </div>
                <div className="meet-title">
                  <span className="eyebrow">Arena event</span>
                  <h2>{meet.name}</h2>
                  <p><MapPin size={14} /> {meet.location} <i /> <Clock3 size={14} /> {formatTime(meet.startTime)}</p>
                </div>
                <div className="event-actions">
                  <button className="primary" onClick={() => { setCopying(null); setSelectedParentId(meet.id); setSelectedType(null); setEditing(null); setShowMeetForm(false); }}><Plus size={16} /> Add roping</button>
                  <button className="icon-action" title="Edit event" onClick={() => { setCopying(null); setEditingMeet(meet); setShowMeetForm(false); setSelectedParentId(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Pencil size={16} /></button>
                  <button className="icon-action delete-action" title="Delete event" onClick={() => {
                    if (window.confirm(`Delete ${meet.name} and all of its roping competitions, draws, and results?`)) {
                      onDeleteMeet(meet.id);
                    }
                  }}><Trash2 size={16} /></button>
                </div>
              </div>
              <div className="competition-list">
                {competitions.map((event) => (
                  <article className={`competition-row ${event.id === activeEventId ? "selected" : ""}`} key={event.id}>
                    <span className="competition-icon">{event.competitionType === "draw-pot" ? <Dices size={20} /> : event.competitionType === "pick-only" ? <Handshake size={20} /> : event.competitionType === "pick-and-draw" ? <GitFork size={20} /> : <Repeat2 size={20} />}</span>
                    <div className="competition-row-main">
                      <div className="event-card-tags"><span className={`tag ${event.status.toLowerCase()}`}>{event.status}</span><span className="tag neutral">{competitionName(event.competitionType)}</span></div>
                      <h3>{event.name}</h3>
                      <p>${event.entryFee} entry · HC {event.handicapTotal} · {event.rounds} round{event.rounds === 1 ? "" : "s"}{event.rounds > 1 && event.shortGoTeams > 0 ? ` · Top ${event.shortGoTeams} Short Go` : ""} · {teams.filter((team) => team.eventId === event.id).length} teams</p>
                    </div>
                    <div className="event-actions">
                      <button className={event.id === activeEventId ? "selected-button" : "secondary"} onClick={() => onSelect(event.id)}>
                        {event.id === activeEventId ? <><Check size={16} /> Active roping</> : "Open roping"}
                      </button>
                      <button className="icon-action" title="Copy roping to upcoming event" onClick={() => { setCopying(event); setEditing(null); setSelectedParentId(null); setShowMeetForm(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Copy size={16} /></button>
                      <button className="icon-action" title="Edit roping" onClick={() => { setCopying(null); setEditing(event); setSelectedParentId(meet.id); setSelectedType(null); setShowMeetForm(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Pencil size={16} /></button>
                      <button className="icon-action delete-action" title="Delete roping" onClick={() => {
                        if (window.confirm(`Delete ${event.name}? This will also delete its entries, draw, and results.`)) {
                          onDelete(event.id);
                          if (editing?.id === event.id) setEditing(null);
                        }
                      }}><Trash2 size={16} /></button>
                    </div>
                  </article>
                ))}
                {!competitions.length && <EmptyState text="No roping competitions yet. Add Draw Pot, Pick Only, Pick and Draw, or Round Robin." />}
              </div>
            </section>
          );
        })}
        {!meets.length && <div className="panel"><EmptyState text="Create your first arena event to add roping competitions." /></div>}
      </div>
    </>
  );
}

function CopyCompetitionForm({
  competition,
  sourceMeet,
  targetMeets,
  onSubmit,
  onCancel,
}: {
  competition: ArenaEvent;
  sourceMeet?: ArenaMeet;
  targetMeets: ArenaMeet[];
  onSubmit: (targetMeet: ArenaMeet, name: string) => void;
  onCancel: () => void;
}) {
  const [targetId, setTargetId] = useState(targetMeets[0]?.id ?? "");
  const [name, setName] = useState(competition.name);
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    const target = targetMeets.find((meet) => meet.id === targetId);
    if (target) onSubmit(target, name.trim());
  };
  return (
    <form className="form-panel copy-form" onSubmit={submit}>
      <div className="form-heading">
        <div><span className="tag neutral"><Copy size={12} /> Copy roping</span><h3>{competition.name}</h3><p>Copy configuration from {sourceMeet?.name ?? "the current event"} without entries, draw, or results.</p></div>
        <button type="button" className="icon-button" onClick={onCancel}><X size={20} /></button>
      </div>
      {targetMeets.length ? (
        <>
          <div className="form-grid two">
            <Field label="Roping name"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="Upcoming event"><select required value={targetId} onChange={(event) => setTargetId(event.target.value)}>{targetMeets.map((meet) => <option value={meet.id} key={meet.id}>{meet.name} · {formatDate(meet.date)}</option>)}</select></Field>
          </div>
          <div className="copy-summary">
            <span>{competitionName(competition.competitionType)}</span>
            <span>HC {competition.handicapTotal}</span>
            <span>{competition.rounds} round{competition.rounds === 1 ? "" : "s"}</span>
            <span>${competition.entryFee} entry</span>
          </div>
          <FormActions onCancel={onCancel} submitLabel="Copy to event" />
        </>
      ) : (
        <>
          <div className="notice"><span>Create another upcoming event before copying this roping.</span></div>
          <div className="form-actions"><button type="button" className="secondary" onClick={onCancel}>Close</button></div>
        </>
      )}
    </form>
  );
}

function MeetForm({
  meet,
  onSubmit,
  onCancel,
}: {
  meet?: ArenaMeet;
  onSubmit: (meet: ArenaMeet) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: meet?.name ?? "",
    date: meet?.date ?? "",
    startTime: meet?.startTime ?? "18:00",
    location: meet?.location ?? "",
    producer: meet?.producer ?? "",
  });
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    onSubmit({ ...form, id: meet?.id ?? uid("meet") });
  };
  return (
    <form className="form-panel" onSubmit={submit}>
      <div className="form-heading"><div><span className="tag neutral">Arena event</span><h3>{meet ? "Edit event" : "Create event"}</h3><p>Name and schedule the event before adding its roping competitions.</p></div><button type="button" className="icon-button" onClick={onCancel}><X size={20} /></button></div>
      <div className="form-grid">
        <Field label="Event name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Saturday Night Jackpot" /></Field>
        <Field label="Arena"><input required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Arena name" /></Field>
        <Field label="Producer"><input value={form.producer} onChange={(e) => setForm({ ...form, producer: e.target.value })} placeholder="Producer or organization" /></Field>
        <Field label="Event date"><input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="Start time"><input required type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></Field>
      </div>
      <FormActions onCancel={onCancel} submitLabel={meet ? "Save event" : "Create event"} />
    </form>
  );
}

function CompetitionTypeSelector({
  events,
  teams,
  onSelect,
  onCancel,
}: {
  events: ArenaEvent[];
  teams: Team[];
  onSelect: (type: CompetitionType) => void;
  onCancel: () => void;
}) {
  const icons = {
    "draw-pot": Dices,
    "pick-only": Handshake,
    "pick-and-draw": GitFork,
    "round-robin": Repeat2,
  };
  return (
    <section className="competition-chooser">
      <div className="chooser-heading">
        <div><span className="eyebrow">New competition</span><h2>Choose a competition type</h2><p>The format configures registration, partner assignment, draw generation, and standings.</p></div>
        <button className="icon-button" onClick={onCancel}><X size={21} /></button>
      </div>
      <div className="competition-grid">
        {competitionTypes.map((type) => {
          const Icon = icons[type.id];
          const typeEvents = events.filter((event) => event.competitionType === type.id);
          const teamCount = teams.filter((team) => typeEvents.some((event) => event.id === team.eventId)).length;
          return (
            <article className={`competition-card type-${type.id}`} key={type.id}>
              <span className="competition-icon"><Icon size={24} /></span>
              <h3>{type.name}</h3>
              <p>{type.description}</p>
              <ul>{type.features.map((feature) => <li key={feature}><Check size={13} /> {feature}</li>)}</ul>
              <div className="competition-meta"><span><Clock3 size={14} /> {type.setupTime}</span><span><UsersRound size={14} /> {teamCount} registered teams</span></div>
              <button className="primary" onClick={() => onSelect(type.id)}>Create Event <ArrowRight size={16} /></button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EventForm({
  event,
  parent,
  competitionType,
  onSubmit,
  onCancel,
}: {
  event?: ArenaEvent;
  parent: ArenaMeet;
  competitionType?: CompetitionType;
  onSubmit: (event: ArenaEvent) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: event?.name ?? "",
    status: event?.status ?? "Upcoming" as EventStatus,
    entryFee: event?.entryFee.toString() ?? "60",
    competitionType: competitionType ?? event?.competitionType ?? defaultCompetitionSettings.competitionType,
    pickDrawRole: event?.pickDrawRole ?? defaultCompetitionSettings.pickDrawRole,
    registrationOpen: event?.registrationOpen ?? true,
    entriesAllowed: (event?.entriesAllowed ?? 1).toString(),
    allowRepeatPartners: event?.allowRepeatPartners ?? false,
    handicapTotal: (event?.handicapTotal ?? 99).toString(),
    timeLimit: (event?.timeLimit ?? 30).toString(),
    rounds: (event?.rounds ?? 1).toString(),
    shortGoTeams: (event?.shortGoTeams ?? 0).toString(),
    progressiveAfterRound: (event?.progressiveAfterRound ?? 0).toString(),
    addedMoney: (event?.addedMoney ?? 0).toString(),
    incentivePayouts: event?.incentivePayouts ?? false,
    officeCharge: (event?.officeCharge ?? 0).toString(),
    stockCharge: (event?.stockCharge ?? 0).toString(),
    producerFeePercent: (event?.producerFeePercent ?? 0).toString(),
    payoutPercentages: (event?.payoutPercentages ?? [50, 30, 20]).join(", "),
  });
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    onSubmit({
      ...event,
      ...form,
      id: event?.id ?? uid("event"),
      parentEventId: parent.id,
      date: parent.date,
      startTime: parent.startTime,
      location: parent.location,
      entryFee: Number(form.entryFee) || 0,
      entriesAllowed: Number(form.entriesAllowed) || 1,
      allowRepeatPartners: form.allowRepeatPartners,
      handicapTotal: Number(form.handicapTotal) || 0,
      timeLimit: Number(form.timeLimit) || 0,
      rounds: Number(form.rounds) || 1,
      shortGoTeams: Math.max(0, Math.floor(Number(form.shortGoTeams) || 0)),
      progressiveAfterRound: Number(form.progressiveAfterRound) || 0,
      addedMoney: Number(form.addedMoney) || 0,
      officeCharge: Number(form.officeCharge) || 0,
      stockCharge: Number(form.stockCharge) || 0,
      producerFeePercent: Number(form.producerFeePercent) || 0,
      payoutPercentages: form.payoutPercentages
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => value > 0),
      drawLocked: event?.drawLocked ?? false,
      resultsPublished: event?.resultsPublished ?? false,
      drawHistory: event?.drawHistory ?? [],
    });
  };

  return (
    <form className="form-panel" onSubmit={submit}>
      <div className="form-heading"><div><span className="tag neutral">{competitionName(form.competitionType)}</span><h3>{event ? "Edit roping" : `Add roping to ${parent.name}`}</h3><p>Configure this competition's rules, registration, scoring, and payouts.</p></div><button type="button" className="icon-button" onClick={onCancel}><X size={20} /></button></div>
      <h4 className="form-section-title">Roping details</h4>
      <div className="form-grid">
        <Field label="Roping name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="#10.5 Draw Pot" /></Field>
        <Field label="Entry fee"><input required min="0" type="number" value={form.entryFee} onChange={(e) => setForm({ ...form, entryFee: e.target.value })} /></Field>
        <Field label="Status"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EventStatus })}><option>Upcoming</option><option>Live</option><option>Complete</option></select></Field>
      </div>
      <h4 className="form-section-title">Competition rules</h4>
      <div className="form-grid">
        <Field label="Competition type"><select value={form.competitionType} onChange={(e) => setForm({ ...form, competitionType: e.target.value as CompetitionType })}>{competitionTypes.map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}</select></Field>
        {form.competitionType === "pick-and-draw" && (
          <Field label="Draw assignment"><select value={form.pickDrawRole} onChange={(e) => setForm({ ...form, pickDrawRole: e.target.value as PickDrawRole })}><option value="header">Draw Header</option><option value="heeler">Draw Heeler</option><option value="both">Draw Both</option></select></Field>
        )}
        <Field label="Entries allowed"><input required type="number" min="1" value={form.entriesAllowed} onChange={(e) => setForm({ ...form, entriesAllowed: e.target.value })} /></Field>
        <Field label="Handicap Total"><input required type="number" min="0" step="0.5" value={form.handicapTotal} onChange={(e) => setForm({ ...form, handicapTotal: e.target.value })} placeholder="10.5" /></Field>
        <Field label="Time limit (seconds)"><input required type="number" min="1" value={form.timeLimit} onChange={(e) => setForm({ ...form, timeLimit: e.target.value })} /></Field>
        <Field label="Number of rounds"><input required type="number" min="1" value={form.rounds} onChange={(e) => setForm({ ...form, rounds: e.target.value })} /></Field>
        <Field label="Short Go teams (final round)"><input type="number" min="0" step="1" value={form.shortGoTeams} onChange={(e) => setForm({ ...form, shortGoTeams: e.target.value })} disabled={Number(form.rounds) < 2} /><small>Enter the maximum teams advancing to the final round. Use 0 for all qualified teams.</small></Field>
        <Field label="Progressive after round"><select value={form.progressiveAfterRound} onChange={(e) => setForm({ ...form, progressiveAfterRound: e.target.value })}><option value="0">Not progressive</option>{Array.from({ length: Math.max(Number(form.rounds), 1) }, (_, index) => <option value={index + 1} key={index + 1}>Round {index + 1}</option>)}</select></Field>
      </div>
      <h4 className="form-section-title">Fees and payouts</h4>
      <div className="form-grid">
        <Field label="Added money"><input type="number" min="0" value={form.addedMoney} onChange={(e) => setForm({ ...form, addedMoney: e.target.value })} /></Field>
        <Field label="Office charge / entry"><input type="number" min="0" value={form.officeCharge} onChange={(e) => setForm({ ...form, officeCharge: e.target.value })} /></Field>
        <Field label="Stock charge / entry"><input type="number" min="0" value={form.stockCharge} onChange={(e) => setForm({ ...form, stockCharge: e.target.value })} /></Field>
        <Field label="Producer fee (%)"><input type="number" min="0" max="100" step="0.1" value={form.producerFeePercent} onChange={(e) => setForm({ ...form, producerFeePercent: e.target.value })} /></Field>
        <Field label="Payout split (%)"><input required value={form.payoutPercentages} onChange={(e) => setForm({ ...form, payoutPercentages: e.target.value })} placeholder="50, 30, 20" /></Field>
      </div>
      <div className="toggle-grid">
        <label className="toggle-row"><input type="checkbox" checked={form.registrationOpen} onChange={(e) => setForm({ ...form, registrationOpen: e.target.checked })} /><span><strong>Registration open</strong><small>Allow new contestants and teams to enter.</small></span></label>
        <label className="toggle-row"><input type="checkbox" checked={form.allowRepeatPartners} onChange={(e) => setForm({ ...form, allowRepeatPartners: e.target.checked })} /><span><strong>Allow repeat partner runs</strong><small>Permit the same header and heeler pairing to run more than once in Round 1.</small></span></label>
        <label className="toggle-row"><input type="checkbox" checked={form.incentivePayouts} onChange={(e) => setForm({ ...form, incentivePayouts: e.target.checked })} /><span><strong>Incentive payouts</strong><small>Track an additional incentive payout class.</small></span></label>
      </div>
      <FormActions onCancel={onCancel} submitLabel={event ? "Save roping" : "Add roping"} />
    </form>
  );
}

function Contestants({
  contestants,
  onAdd,
  onUpdate,
  onDelete,
  onImport,
}: {
  contestants: Contestant[];
  onAdd: (contestant: Contestant) => void;
  onUpdate: (contestant: Contestant) => void;
  onDelete: (contestantId: string) => void;
  onImport: (contestants: Contestant[]) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Contestant | null>(null);
  const [search, setSearch] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const filtered = contestants.filter((contestant) =>
    `${contestant.name} ${contestant.hometown} ${contestant.headerHandicap} ${contestant.heelerHandicap}`.toLowerCase().includes(search.toLowerCase()),
  );
  const downloadBackup = () => {
    const backup = {
      format: "arena-command-contestants",
      version: 1,
      exportedAt: new Date().toISOString(),
      contestants,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `arena-contestants-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setBackupMessage(
      `${contestants.length} contestant${contestants.length === 1 ? "" : "s"} downloaded.`,
    );
  };
  const restoreBackup = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      const restored =
        file.name.toLowerCase().endsWith(".txt")
          ? parseContestantText(text)
          : validateContestantBackup(JSON.parse(text) as unknown);
      onImport(restored);
      setBackupMessage(
        `${restored.length} contestant${restored.length === 1 ? "" : "s"} imported.`,
      );
    } catch (error) {
      setBackupMessage(
        error instanceof Error
          ? error.message
          : "The contestant backup could not be restored.",
      );
    }
  };

  return (
    <>
      <PageIntro title="Contestants" text="Maintain the rider roster used to build teams for every event." button="Add contestant" onClick={() => { setEditing(null); setShowForm((open) => !open); }} />
      {(showForm || editing) && (
        <ContestantForm
          contestant={editing ?? undefined}
          onSubmit={(rider) => {
            if (editing) onUpdate(rider);
            else onAdd(rider);
            setEditing(null);
            setShowForm(false);
          }}
          onCancel={() => {
            setEditing(null);
            setShowForm(false);
          }}
        />
      )}
      {backupMessage && (
        <div className="notice">
          <span>{backupMessage}</span>
          <button onClick={() => setBackupMessage("")}><X size={16} /></button>
        </div>
      )}
      <div className="panel table-panel">
        <div className="table-toolbar">
          <div><h3>Rider roster</h3><p>{contestants.length} contestants on file</p></div>
          <div className="roster-actions">
            <label className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search riders" /></label>
            <button className="secondary" disabled={!contestants.length} onClick={downloadBackup}><Download size={16} /> Download database</button>
            <label className="secondary import-database-button"><Upload size={16} /> Import database<input type="file" accept="application/json,text/plain,.json,.txt" onChange={(event) => { void restoreBackup(event.target.files?.[0]); event.target.value = ""; }} /></label>
          </div>
        </div>
        <div className="data-table contestant-table">
          <div className="table-row table-header"><span>Contestant</span><span>Header handicap</span><span>Heeler handicap</span><span>Hometown</span><span>Phone</span><span>Actions</span></div>
          {filtered.map((contestant) => (
            <div className="table-row" key={contestant.id}>
              <span className="person">
                {contestant.photo
                  ? <img className="profile-photo" src={contestant.photo} alt="" />
                  : <i>{initials(contestant.name)}</i>}
                <strong>{contestant.name}</strong>
              </span>
              <span>{contestant.headerHandicap}</span>
              <span>{contestant.heelerHandicap}</span>
              <span>{contestant.hometown || "—"}</span>
              <span>{contestant.phone || "—"}</span>
              <span className="row-actions">
                <button
                  title="Edit contestant"
                  onClick={() => {
                    setEditing(contestant);
                    setShowForm(false);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="delete-action"
                  title="Delete contestant"
                  onClick={() => {
                    if (window.confirm(`Delete ${contestant.name}? This will also delete all of their team entries.`)) {
                      onDelete(contestant.id);
                      if (editing?.id === contestant.id) setEditing(null);
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function validateContestantBackup(value: unknown): Contestant[] {
  if (!value || typeof value !== "object") {
    throw new Error("Choose a valid Arena Command contestant backup.");
  }
  const backup = value as {
    format?: unknown;
    contestants?: unknown;
  };
  if (
    backup.format !== "arena-command-contestants" ||
    !Array.isArray(backup.contestants)
  ) {
    throw new Error("Choose a valid Arena Command contestant backup.");
  }
  if (backup.contestants.length > 10000) {
    throw new Error("This backup contains too many contestant records.");
  }

  return backup.contestants.map((record, index) => {
    if (!record || typeof record !== "object") {
      throw new Error(`Contestant ${index + 1} is not valid.`);
    }
    const contestant = record as Partial<Contestant>;
    if (
      typeof contestant.id !== "string" ||
      !contestant.id ||
      typeof contestant.name !== "string" ||
      !contestant.name.trim() ||
      !["Header", "Heeler", "Both"].includes(contestant.role ?? "") ||
      typeof contestant.headerHandicap !== "number" ||
      !Number.isFinite(contestant.headerHandicap) ||
      typeof contestant.heelerHandicap !== "number" ||
      !Number.isFinite(contestant.heelerHandicap)
    ) {
      throw new Error(`Contestant ${index + 1} is not valid.`);
    }
    return {
      id: contestant.id,
      name: contestant.name.trim(),
      role: contestant.role as Contestant["role"],
      headerHandicap: contestant.headerHandicap,
      heelerHandicap: contestant.heelerHandicap,
      photo: typeof contestant.photo === "string" ? contestant.photo : "",
      phone: typeof contestant.phone === "string" ? contestant.phone : "",
      hometown:
        typeof contestant.hometown === "string" ? contestant.hometown : "",
      membershipNumber:
        typeof contestant.membershipNumber === "string"
          ? contestant.membershipNumber
          : "",
      email: typeof contestant.email === "string" ? contestant.email : "",
      categoryNumber:
        typeof contestant.categoryNumber === "string"
          ? contestant.categoryNumber
          : "",
    };
  });
}

function parseContestantText(text: string): Contestant[] {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    throw new Error("The contestant text file is empty.");
  }
  if (trimmed.startsWith("{")) {
    return validateContestantBackup(JSON.parse(trimmed) as unknown);
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 10001) {
    throw new Error("This text file contains too many contestant records.");
  }
  const delimiter = lines[0].includes("\t")
    ? "\t"
    : lines[0].includes("|")
      ? "|"
      : lines[0].includes(",")
        ? ","
        : lines[0].includes(";")
          ? ";"
        : "";
  if (!delimiter) {
    return lines.map((name, index) => textContestant({ name }, index));
  }

  const rows = lines.map((line) => parseTextFields(line, delimiter));
  const normalizedHeaders = rows[0].map(normalizeTextHeader);
  const knownHeaders = new Set([
    "id",
    "name",
    "fullname",
    "contestant",
    "firstname",
    "lastname",
    "role",
    "position",
    "headerhandicap",
    "heelerhandicap",
    "phone",
    "hometown",
    "membershipnumber",
    "email",
    "categorynumber",
  ]);
  const hasHeader = normalizedHeaders.some((header) => knownHeaders.has(header));
  const headers = hasHeader
    ? normalizedHeaders
    : [
        "name",
        "role",
        "headerhandicap",
        "heelerhandicap",
        "phone",
        "hometown",
        "membershipnumber",
        "email",
        "categorynumber",
      ];
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows.map((values, index) => {
    const record = Object.fromEntries(
      headers.map((header, column) => [header, values[column]?.trim() ?? ""]),
    );
    const firstName = record.firstname ?? "";
    const lastName = record.lastname ?? "";
    return textContestant(
      {
        id: record.id,
        name:
          record.name ||
          record.fullname ||
          record.contestant ||
          `${firstName} ${lastName}`.trim(),
        role: record.role || record.position,
        headerHandicap: record.headerhandicap,
        heelerHandicap: record.heelerhandicap,
        phone: record.phone,
        hometown: record.hometown,
        membershipNumber: record.membershipnumber,
        email: record.email,
        categoryNumber: record.categorynumber,
      },
      index,
    );
  });
}

function parseTextFields(line: string, delimiter: string) {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
}

function normalizeTextHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function textContestant(
  record: {
    id?: string;
    name?: string;
    role?: string;
    headerHandicap?: string;
    heelerHandicap?: string;
    phone?: string;
    hometown?: string;
    membershipNumber?: string;
    email?: string;
    categoryNumber?: string;
  },
  index: number,
): Contestant {
  const name = record.name?.trim() ?? "";
  if (!name) {
    throw new Error(`Contestant ${index + 1} is missing a name.`);
  }
  const roleValue = record.role?.trim().toLowerCase() ?? "";
  const role =
    roleValue === "header" || roleValue === "h"
      ? "Header"
      : roleValue === "heeler" || roleValue === "heel" || roleValue === "hl"
        ? "Heeler"
        : roleValue === "both" || !roleValue
          ? "Both"
          : null;
  if (!role) {
    throw new Error(`Contestant ${index + 1} has an invalid position.`);
  }
  const headerHandicap = record.headerHandicap?.trim()
    ? Number(record.headerHandicap)
    : 0;
  const heelerHandicap = record.heelerHandicap?.trim()
    ? Number(record.heelerHandicap)
    : 0;
  if (!Number.isFinite(headerHandicap) || !Number.isFinite(heelerHandicap)) {
    throw new Error(`Contestant ${index + 1} has an invalid handicap.`);
  }
  return {
    id:
      record.id?.trim() ||
      stableTextContestantId(
        record.membershipNumber?.trim() ||
          [
            name,
            record.email?.trim(),
            record.phone?.trim(),
            role,
            headerHandicap,
            heelerHandicap,
          ].join("|"),
      ),
    name,
    role,
    headerHandicap,
    heelerHandicap,
    photo: "",
    phone: record.phone?.trim() ?? "",
    hometown: record.hometown?.trim() ?? "",
    membershipNumber: record.membershipNumber?.trim() ?? "",
    email: record.email?.trim() ?? "",
    categoryNumber: record.categoryNumber?.trim() ?? "",
  };
}

function stableTextContestantId(value: string) {
  let hash = 2166136261;
  for (const character of value.trim().toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `contestant-text-${(hash >>> 0).toString(36)}`;
}

function ContestantForm({
  contestant,
  onSubmit,
  onCancel,
}: {
  contestant?: Contestant;
  onSubmit: (contestant: Contestant) => void;
  onCancel: () => void;
}) {
  const nameParts = contestant?.name.trim().split(/\s+/) ?? [];
  const [form, setForm] = useState({
    firstName: nameParts.slice(0, -1).join(" ") || nameParts[0] || "",
    lastName: nameParts.length > 1 ? nameParts[nameParts.length - 1] : "",
    headerHandicap: contestant?.headerHandicap.toString() ?? "",
    heelerHandicap: contestant?.heelerHandicap.toString() ?? "",
    photo: contestant?.photo ?? "",
    phone: contestant?.phone ?? "",
    hometown: contestant?.hometown ?? "",
    email: contestant?.email ?? "",
  });
  const [photoError, setPhotoError] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [loginError, setLoginError] = useState("");
  const handlePhoto = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Choose an image file.");
      return;
    }
    try {
      const photo = await resizeProfilePhoto(file);
      setForm((current) => ({ ...current, photo }));
      setPhotoError("");
    } catch {
      setPhotoError("The photo could not be loaded.");
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const contestantId = contestant?.id ?? uid("rider");
    const updatedContestant: Contestant = {
      id: contestantId,
      name: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
      role: contestant?.role ?? "Both",
      headerHandicap: Number(form.headerHandicap),
      heelerHandicap: Number(form.heelerHandicap),
      phone: form.phone,
      hometown: form.hometown,
      email: form.email,
      membershipNumber: contestant?.membershipNumber ?? "",
      categoryNumber: contestant?.categoryNumber ?? "",
      photo: form.photo,
    };
    if (loginPin) {
      if (!form.email.trim()) {
        setLoginError("Enter an email before configuring a contestant PIN.");
        return;
      }
      if (!/^\d{4}$/.test(loginPin)) {
        setLoginError("The contestant PIN must contain exactly four digits.");
        return;
      }
      if (!isWixEmbed()) {
        setLoginError("PIN setup is available from the app embedded in Wix.");
        return;
      }
      try {
        await setContestantPin(updatedContestant, loginPin);
      } catch (error) {
        setLoginError(
          error instanceof Error ? error.message : "The PIN could not be saved.",
        );
        return;
      }
    }
    onSubmit(updatedContestant);
  };
  return (
    <form className="form-panel" onSubmit={submit}>
      <div className="form-heading"><div><h3>{contestant ? "Edit contestant" : "Add contestant"}</h3><p>{contestant ? "Update this rider's profile and handicaps." : "Create a rider profile for team entries."}</p></div><button type="button" className="icon-button" onClick={onCancel}><X size={20} /></button></div>
      <div className="photo-field">
        <div className="photo-preview">
          {form.photo ? <img src={form.photo} alt="Contestant preview" /> : <Camera size={24} />}
        </div>
        <div>
          <strong>Profile picture</strong>
          <p>Optional JPG, PNG, or WebP image.</p>
          <label className="secondary photo-button">
            {form.photo ? "Change picture" : "Choose picture"}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void handlePhoto(e.target.files?.[0])} />
          </label>
          {form.photo && <button type="button" className="remove-photo" onClick={() => setForm({ ...form, photo: "" })}>Remove</button>}
          {photoError && <span className="field-error">{photoError}</span>}
        </div>
      </div>
      <div className="form-grid">
        <Field label="First Name"><input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="First name" /></Field>
        <Field label="Last Name"><input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder="Last name" /></Field>
        <Field label="Header Handicap"><input required type="number" min="0" step="0.5" value={form.headerHandicap} onChange={(e) => setForm({ ...form, headerHandicap: e.target.value })} placeholder="0" /></Field>
        <Field label="Heeler Handicap"><input required type="number" min="0" step="0.5" value={form.heelerHandicap} onChange={(e) => setForm({ ...form, heelerHandicap: e.target.value })} placeholder="0" /></Field>
        <Field label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="555-0123" /></Field>
        <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="rider@example.com" /></Field>
        <Field label="Contestant Login PIN"><input type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} value={loginPin} onChange={(e) => { setLoginPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setLoginError(""); }} placeholder={contestant ? "Enter 4 digits to reset" : "Optional 4-digit PIN"} /></Field>
        <Field label="Hometown"><input value={form.hometown} onChange={(e) => setForm({ ...form, hometown: e.target.value })} placeholder="City, State" /></Field>
      </div>
      {loginError && <div className="form-error">{loginError}</div>}
      <FormActions onCancel={onCancel} submitLabel={contestant ? "Save changes" : "Add contestant"} />
    </form>
  );
}

function Teams({
  event,
  teams,
  registrations,
  contestants,
  onAdd,
  onUpdateTeam,
  onDeleteTeam,
  onAddRegistration,
  onUpdateRegistration,
  onDeleteRegistration,
  onCommitDraw,
  onUpdateEvent,
  onShuffle,
}: {
  event?: ArenaEvent;
  teams: Team[];
  registrations: EventRegistration[];
  contestants: Contestant[];
  onAdd: (team: Team) => void;
  onUpdateTeam: (team: Team) => void;
  onDeleteTeam: (teamId: string) => void;
  onAddRegistration: (registration: EventRegistration) => void;
  onUpdateRegistration: (registration: EventRegistration) => void;
  onDeleteRegistration: (registrationId: string) => void;
  onCommitDraw: (eventId: string, teams: Team[]) => void;
  onUpdateEvent: (event: ArenaEvent) => void;
  onShuffle: (eventId: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [entryMode, setEntryMode] = useState<"team" | "registration">("team");
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [message, setMessage] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const eventTeams = teams.filter((team) => team.eventId === event?.id).sort((a, b) => a.drawPosition - b.drawPosition);
  const eventRegistrations = registrations.filter((entry) => entry.eventId === event?.id);
  const headerEntryCount = eventRegistrations
    .filter((entry) => entry.role === "Header" && entry.status === "entered" && entry.paid !== false)
    .reduce((total, entry) => total + entry.entries, 0);
  const heelerEntryCount = eventRegistrations
    .filter((entry) => entry.role === "Heeler" && entry.status === "entered" && entry.paid !== false)
    .reduce((total, entry) => total + entry.entries, 0);
  const rider = (id: string) => contestants.find((item) => item.id === id);
  const displayedTeams = eventTeams.filter((team) =>
    `${rider(team.headerId)?.name ?? ""} ${rider(team.heelerId)?.name ?? ""}`
      .toLowerCase()
      .includes(teamSearch.toLowerCase()),
  );
  const individualRegistration =
    event?.competitionType === "draw-pot" || event?.competitionType === "round-robin";
  const usesDrawPool =
    individualRegistration || event?.competitionType === "pick-and-draw";
  const entryButton = individualRegistration ? "Register rider" : "Add team";
  const canEdit = Boolean(event?.registrationOpen && !event?.drawLocked);
  const format = competitionTypes.find((type) => type.id === event?.competitionType);

  const saveTeam = (team: Team) => {
    const duplicate = eventTeams.some(
      (item) =>
        item.id !== team.id &&
        item.headerId === team.headerId &&
        item.heelerId === team.heelerId,
    );
    if (duplicate && !event?.allowRepeatPartners) {
      setMessage("That header and heeler are already entered as a team.");
      return;
    }
    const handicap = teamHandicapTotal(team.headerId, team.heelerId, contestants);
    if (event && handicap > event.handicapTotal) {
      setMessage(
        `Team handicap ${handicap} exceeds the event maximum of ${event.handicapTotal}.`,
      );
      return;
    }
    if (editingTeam) {
      onUpdateTeam(team);
    } else {
      const pairingRun = eventTeams.filter(
        (item) =>
          item.round === 1 &&
          item.headerId === team.headerId &&
          item.heelerId === team.heelerId,
      ).length + 1;
      onAdd({
        ...team,
        headerEntryNumber: pairingRun,
        heelerEntryNumber: pairingRun,
      });
    }
    setEditingTeam(null);
    setShowForm(false);
    setMessage("");
  };

  const generateDraw = () => {
    if (!event) return;
    const generated = generateCompetitionDraw(event, eventRegistrations, teams, contestants);
    if (!generated.length) {
      setMessage(
        event.competitionType === "draw-pot"
          ? "Register at least one eligible header and heeler before drawing."
          : event.competitionType === "pick-and-draw"
            ? "No eligible draw teams could be made. Confirm paid Header and Heeler entries, check the handicap limit, and enable repeat partner runs when entries must reuse partners."
            : "Add eligible contestants or teams before generating the draw.",
      );
      return;
    }
    if (event.competitionType === "pick-and-draw") {
      const expectedDrawTeams =
        event.pickDrawRole === "header"
          ? headerEntryCount
          : event.pickDrawRole === "heeler"
            ? heelerEntryCount
            : Math.max(headerEntryCount, heelerEntryCount);
      const generatedDrawTeams = generated.filter(
        (team) => team.generated,
      ).length;
      if (generatedDrawTeams < expectedDrawTeams) {
        setMessage(
          `The draw pot has ${expectedDrawTeams} entries but only ${generatedDrawTeams} unique eligible teams can be made. Check handicaps and positions, or enable repeat partner runs.`,
        );
        return;
      }
    }
    onCommitDraw(event.id, generated);
    setMessage(`Draw version ${event.drawHistory.length + 1} generated with ${generated.length} teams.`);
  };

  return (
    <>
      <PageIntro title="Teams & draw" text={event ? `${competitionName(event.competitionType)} workflow for ${event.name}.` : "Create an event before adding teams."} button={entryButton} onClick={() => { setEditingTeam(null); setEntryMode(individualRegistration ? "registration" : "team"); setShowForm((open) => !open); }} disabled={!event || !canEdit} />
      {event && (
        <div className="format-banner">
          <span className="competition-icon">{event.competitionType === "draw-pot" ? <Dices size={21} /> : event.competitionType === "pick-only" ? <Handshake size={21} /> : event.competitionType === "pick-and-draw" ? <GitFork size={21} /> : <Repeat2 size={21} />}</span>
          <div><strong>{format?.name}</strong><p>{format?.description}</p></div>
          {event.competitionType === "pick-and-draw" && (
            <button className="secondary" disabled={!canEdit} onClick={() => { setEditingTeam(null); setEntryMode("registration"); setShowForm(true); }}>
              <Dices size={15} /> Add to Draw Pot
            </button>
          )}
          <span className={`tag ${event.registrationOpen ? "complete" : "no-time"}`}>{event.registrationOpen ? "Registration open" : "Registration closed"}</span>
          <span className={`tag ${event.drawLocked ? "no-time" : "neutral"}`}>{event.drawLocked ? "Draw locked" : "Draw editable"}</span>
        </div>
      )}
      {message && <div className="notice"><span>{message}</span><button onClick={() => setMessage("")}><X size={16} /></button></div>}
      {showForm && event && entryMode === "registration" && (
        <IndividualRegistrationForm
          event={event}
          contestants={contestants}
          registrations={eventRegistrations}
          onSubmit={(registration) => {
            const duplicate = eventRegistrations.some(
              (item) =>
                item.contestantId === registration.contestantId &&
                item.role === registration.role &&
                item.status !== "scratched",
            );
            if (duplicate) {
              setMessage("This contestant is already registered in that position.");
              return;
            }
            onAddRegistration(registration);
            setShowForm(false);
            setMessage("");
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
      {((showForm && entryMode === "team") || editingTeam) && event && !individualRegistration && (
        <TeamForm
          event={event}
          team={editingTeam ?? undefined}
          contestants={contestants}
          drawPosition={editingTeam?.drawPosition ?? eventTeams.length + 1}
          onSubmit={saveTeam}
          onCancel={() => { setShowForm(false); setEditingTeam(null); }}
        />
      )}
      {event && usesDrawPool && (
        <div className="panel registration-panel">
          <div className="table-toolbar">
            <div><h3>{event.competitionType === "pick-and-draw" ? "Draw Pot contestants" : "Rider registration"}</h3><p>{eventRegistrations.length} registered riders</p></div>
            <div className="entry-totals">
              <span><strong>{headerEntryCount}</strong> Paid header entries</span>
              <span><strong>{heelerEntryCount}</strong> Paid heeler entries</span>
              {event.competitionType === "pick-and-draw" && (
                <span><strong>{event.pickDrawRole === "header" ? headerEntryCount : event.pickDrawRole === "heeler" ? heelerEntryCount : Math.max(headerEntryCount, heelerEntryCount)}</strong> Round 1 draw teams</span>
              )}
              {event.competitionType === "round-robin" && (
                <span><strong>{eventRegistrations.filter((entry) => entry.role === "Header" && entry.status === "entered" && entry.paid !== false).length * eventRegistrations.filter((entry) => entry.role === "Heeler" && entry.status === "entered" && entry.paid !== false).length}</strong> Round Robin teams</span>
              )}
              {event.competitionType === "draw-pot" && headerEntryCount !== heelerEntryCount && (
                <span className="free-total"><strong>{Math.abs(headerEntryCount - heelerEntryCount)}</strong> Free {headerEntryCount > heelerEntryCount ? "heeler" : "header"} run{Math.abs(headerEntryCount - heelerEntryCount) === 1 ? "" : "s"}</span>
              )}
            </div>
          </div>
          <div className="registration-list">
            {eventRegistrations.map((registration) => (
              <div className="registration-row" key={registration.id}>
                <span className="person"><i>{initials(rider(registration.contestantId)?.name ?? "")}</i><span><strong>{rider(registration.contestantId)?.name}</strong><small>{registration.role} · {registration.entries} entr{registration.entries === 1 ? "y" : "ies"}{registration.sourceTeamId ? " · Picked team" : ""}</small></span></span>
                <span className={`tag ${registration.status === "entered" ? "complete" : registration.status === "waitlist" ? "amber" : "no-time"}`}>{registration.status}</span>
                <button className={registration.paid === false ? "secondary small-action" : "selected-button small-action"} disabled={event.drawLocked} onClick={() => onUpdateRegistration({ ...registration, paid: registration.paid === false })}>{registration.paid === false ? "Mark paid" : "Paid"}</button>
                <button className={registration.checkedIn ? "selected-button small-action" : "secondary small-action"} disabled={event.drawLocked} onClick={() => onUpdateRegistration({ ...registration, checkedIn: !registration.checkedIn })}>{registration.checkedIn ? <><Check size={14} /> Checked in</> : "Check in"}</button>
                <button className="secondary small-action" disabled={event.drawLocked} onClick={() => onUpdateRegistration({ ...registration, status: registration.status === "scratched" ? "entered" : "scratched" })}>{registration.status === "scratched" ? "Restore" : "Scratch"}</button>
                <button className="icon-action delete-action small-icon" disabled={event.drawLocked} title="Delete registration" onClick={() => onDeleteRegistration(registration.id)}><Trash2 size={14} /></button>
              </div>
            ))}
            {!eventRegistrations.length && <EmptyState text="No individual riders registered yet." />}
          </div>
        </div>
      )}
      <div className="panel draw-sheet">
        <div className="table-toolbar">
          <div><h3>Draw order</h3><p>{eventTeams.length} teams · {event?.drawHistory.length ?? 0} draw version{event?.drawHistory.length === 1 ? "" : "s"}</p></div>
          <div className="toolbar-actions">
            <label className="search draw-search"><Search size={15} /><input value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} placeholder="Search teams" /></label>
            <button className="secondary" disabled={!eventTeams.length} onClick={() => event && exportDrawCsv(event, eventTeams, contestants)}><Download size={16} /> CSV</button>
            <button className="secondary" disabled={!eventTeams.length} onClick={() => window.print()}><Printer size={16} /> Print / PDF</button>
            {event && <button className="secondary" onClick={() => onUpdateEvent({ ...event, drawLocked: !event.drawLocked })}>{event.drawLocked ? <><Unlock size={16} /> Unlock</> : <><Lock size={16} /> Lock draw</>}</button>}
            {event?.competitionType === "pick-only" && event.rounds === 1
              ? <button className="primary" disabled={!eventTeams.length || event.drawLocked} onClick={() => onShuffle(event.id)}><RefreshCw size={16} /> Randomize order</button>
              : <button className="primary" disabled={!event || event.drawLocked} onClick={generateDraw}><Dices size={16} /> {eventTeams.length ? "Redraw" : "Generate draw"}</button>}
          </div>
        </div>
        <div className="draw-list">
          {displayedTeams.map((team) => (
            <div className={`draw-row ${team.scratched ? "scratched-row" : ""}`} key={team.id}>
              <span className="draw-number large">{team.drawPosition}</span>
              <div className="person"><i>{initials(rider(team.headerId)?.name ?? "")}</i><span><strong>{rider(team.headerId)?.name} {team.headerFreeRun && <b className="free-run-symbol" title="Free run — not eligible for jackpot payout">FR</b>}</strong><small>Header · Entry {team.headerEntryNumber ?? 1}</small></span></div>
              <span className="pair-mark">&</span>
              <div className="person"><i>{initials(rider(team.heelerId)?.name ?? "")}</i><span><strong>{rider(team.heelerId)?.name} {team.heelerFreeRun && <b className="free-run-symbol" title="Free run — not eligible for jackpot payout">FR</b>}</strong><small>Heeler · Entry {team.heelerEntryNumber ?? 1}</small></span></div>
              <span className="draw-status"><span className={`tag ${team.scratched ? "no-time" : team.rolled ? "amber" : team.status === "ready" ? "neutral" : team.status}`}>{team.scratched ? "Scratched" : team.rolled ? "Rolled" : team.status === "no-time" ? "No time" : team.status}</span><small>HC {teamHandicapTotal(team.headerId, team.heelerId, contestants)}{event?.rounds && event.rounds > 1 ? ` · Round ${team.round}` : ""}</small></span>
              <span className="row-actions no-print">
                <button title={team.checkedIn ? "Checked in" : "Check in"} disabled={event?.drawLocked} onClick={() => onUpdateTeam({ ...team, checkedIn: !team.checkedIn })}>{team.checkedIn ? <Check size={15} /> : <UserRound size={15} />}</button>
                {!team.generated && <button title="Edit team" disabled={!canEdit} onClick={() => { setEditingTeam(team); setShowForm(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Pencil size={15} /></button>}
                <button title={team.scratched ? "Restore team" : "Scratch team"} disabled={event?.drawLocked} onClick={() => onUpdateTeam({ ...team, scratched: !team.scratched })}><X size={15} /></button>
                <button className="delete-action" title="Delete team" disabled={!canEdit} onClick={() => onDeleteTeam(team.id)}><Trash2 size={15} /></button>
              </span>
            </div>
          ))}
          {!displayedTeams.length && <EmptyState text={eventTeams.length ? "No teams match this search." : "No teams entered for this event yet."} />}
        </div>
      </div>
      {event && event.drawHistory.length > 0 && (
        <div className="panel draw-history">
          <PanelHeading title="Draw history" subtitle="Restore any previous generated draw" />
          {event.drawHistory.slice().reverse().map((snapshot, index) => (
            <div className="history-row" key={snapshot.id}>
              <div><strong>Version {event.drawHistory.length - index}</strong><small>{new Date(snapshot.createdAt).toLocaleString()} · {snapshot.teams.length} teams</small></div>
              <button className="secondary" disabled={event.drawLocked} onClick={() => onCommitDraw(event.id, snapshot.teams.map((team) => ({ ...team, id: uid("team"), status: "ready", rawTime: null, penalties: 0, rolled: false })))}><RefreshCw size={14} /> Restore</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function IndividualRegistrationForm({
  event,
  contestants,
  registrations,
  onSubmit,
  onCancel,
}: {
  event: ArenaEvent;
  contestants: Contestant[];
  registrations: EventRegistration[];
  onSubmit: (registration: EventRegistration) => void;
  onCancel: () => void;
}) {
  const requiredRole =
    event.competitionType === "pick-and-draw" && event.pickDrawRole !== "both"
      ? event.pickDrawRole === "header" ? "Header" : "Heeler"
      : null;
  const eligibleContestants = contestants.filter((contestant) =>
    requiredRole === "Header"
      ? contestant.role !== "Heeler"
      : requiredRole === "Heeler"
        ? contestant.role !== "Header"
        : true,
  );
  const [contestantId, setContestantId] = useState(eligibleContestants[0]?.id ?? "");
  const [role, setRole] = useState<"Header" | "Heeler">(
    requiredRole ??
      (eligibleContestants[0]?.role === "Heeler" ? "Heeler" : "Header"),
  );
  const [entries, setEntries] = useState("1");
  const [status, setStatus] = useState<EventRegistration["status"]>("entered");
  const [paid, setPaid] = useState(true);
  const [notes, setNotes] = useState("");
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    onSubmit({
      id: uid("registration"),
      eventId: event.id,
      contestantId,
      role,
      entries: Number(entries),
      checkedIn: false,
      status,
      notes,
      paid,
    });
  };
  return (
    <form className="form-panel" onSubmit={submit}>
      <div className="form-heading"><div><h3>{event.competitionType === "pick-and-draw" ? "Add contestant to Draw Pot" : "Register rider"}</h3><p>Individual entry #{registrations.length + 1} for {event.name}</p></div><button type="button" className="icon-button" onClick={onCancel}><X size={20} /></button></div>
      <div className="form-grid">
        <Field label="Contestant"><select required value={contestantId} onChange={(e) => { const id = e.target.value; setContestantId(id); const contestant = eligibleContestants.find((item) => item.id === id); if (!requiredRole && (contestant?.role === "Header" || contestant?.role === "Heeler")) setRole(contestant.role); }}>{eligibleContestants.map((contestant) => <option value={contestant.id} key={contestant.id}>{contestant.name}</option>)}</select></Field>
        <Field label="Draw position"><select value={role} disabled={Boolean(requiredRole)} onChange={(e) => setRole(e.target.value as "Header" | "Heeler")}>{(!requiredRole || requiredRole === "Header") && <option>Header</option>}{(!requiredRole || requiredRole === "Heeler") && <option>Heeler</option>}</select></Field>
        <Field label="Number of entries"><input required type="number" min="1" max={event.entriesAllowed} value={entries} onChange={(e) => setEntries(e.target.value)} /></Field>
        <Field label="Entry status"><select value={status} onChange={(e) => setStatus(e.target.value as EventRegistration["status"])}><option value="entered">Entered</option><option value="waitlist">Wait list</option></select></Field>
        <Field label="Payment status"><select value={paid ? "paid" : "unpaid"} onChange={(e) => setPaid(e.target.value === "paid")}><option value="paid">Paid</option><option value="unpaid">Unpaid</option></select></Field>
        <Field label="Contestant notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" /></Field>
      </div>
      <FormActions onCancel={onCancel} submitLabel={event.competitionType === "pick-and-draw" ? "Add to Draw Pot" : "Register rider"} />
    </form>
  );
}

function TeamForm({ event, team, contestants, drawPosition, onSubmit, onCancel, rideIn = false }: { event: ArenaEvent; team?: Team; contestants: Contestant[]; drawPosition: number; onSubmit: (team: Team) => void; onCancel: () => void; rideIn?: boolean }) {
  const headers = contestants.filter((rider) => rider.role !== "Heeler");
  const heelers = contestants.filter((rider) => rider.role !== "Header");
  const [headerId, setHeaderId] = useState(team?.headerId ?? headers[0]?.id ?? "");
  const [heelerId, setHeelerId] = useState(team?.heelerId ?? heelers.find((rider) => rider.id !== headerId)?.id ?? "");
  const [notes, setNotes] = useState(team?.notes ?? "");
  const [paid, setPaid] = useState(team?.paid ?? true);
  const handicap = teamHandicapTotal(headerId, heelerId, contestants);
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    onSubmit({
      id: team?.id ?? uid("team"),
      eventId: event.id,
      headerId,
      heelerId,
      drawPosition,
      status: team?.status ?? "ready",
      rawTime: team?.rawTime ?? null,
      penalties: team?.penalties ?? 0,
      notes,
      round: team?.round ?? 1,
      checkedIn: team?.checkedIn ?? false,
      scratched: team?.scratched ?? false,
      generated: team?.generated ?? false,
      rideIn: team?.rideIn ?? rideIn,
      points: team?.points ?? 0,
      headerEntryNumber: team?.headerEntryNumber ?? 1,
      heelerEntryNumber: team?.heelerEntryNumber ?? 1,
      headerFreeRun: team?.headerFreeRun ?? false,
      heelerFreeRun: team?.heelerFreeRun ?? false,
      paid,
    });
  };
  return (
    <form className="form-panel" onSubmit={submit}>
      <div className="form-heading"><div><h3>{team ? "Edit team" : rideIn ? "Add ride-in team" : "Add team"}</h3><p>{rideIn ? "Append a late team to the end of the Round 1 run order." : `Entry #${drawPosition} for ${event.name}`}</p></div><button type="button" className="icon-button" onClick={onCancel}><X size={20} /></button></div>
      <div className="form-grid">
        <Field label="Header"><select value={headerId} required onChange={(e) => setHeaderId(e.target.value)}>{headers.map((rider) => <option value={rider.id} key={rider.id}>{rider.name}</option>)}</select></Field>
        <Field label="Heeler"><select value={heelerId} required onChange={(e) => setHeelerId(e.target.value)}>{heelers.filter((rider) => rider.id !== headerId).map((rider) => <option value={rider.id} key={rider.id}>{rider.name}</option>)}</select></Field>
        <Field label="Team notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" /></Field>
        <Field label="Payment status"><select value={paid ? "paid" : "unpaid"} onChange={(e) => setPaid(e.target.value === "paid")}><option value="paid">Paid</option><option value="unpaid">Unpaid</option></select></Field>
      </div>
      <div className={`handicap-preview ${handicap > event.handicapTotal ? "over" : ""}`}>
        <span>Team handicap</span>
        <strong>{handicap}</strong>
        <small>Maximum {event.handicapTotal}</small>
      </div>
      <FormActions onCancel={onCancel} submitLabel={team ? "Save team" : rideIn ? "Add ride-in team" : "Add to draw"} />
    </form>
  );
}

function RunDesk({
  event,
  teams,
  registrations,
  contestants,
  onUpdateEvent,
  onSave,
  onAddRideIn,
  onRollTeam,
}: {
  event?: ArenaEvent;
  teams: Team[];
  registrations: EventRegistration[];
  contestants: Contestant[];
  onUpdateEvent: (event: ArenaEvent) => void;
  onSave: (teamId: string, update: Partial<Team>) => void;
  onAddRideIn: (team: Team) => void;
  onRollTeam: (teamId: string, rolled: boolean) => void;
}) {
  const [selectedRound, setSelectedRound] = useState(1);
  const [showRideInForm, setShowRideInForm] = useState(false);
  const [rideInMessage, setRideInMessage] = useState("");
  const roundCount = Math.max(event?.rounds ?? 1, 1);
  const activeRound = Math.min(selectedRound, roundCount);
  const allEventTeams = teams
    .filter((team) => team.eventId === event?.id && !team.scratched)
    .sort((a, b) => a.drawPosition - b.drawPosition);
  const eventTeams = allEventTeams
    .filter((team) => team.round === activeRound)
    .sort(
      (a, b) =>
        Number(Boolean(a.rolled)) - Number(Boolean(b.rolled)) ||
        a.drawPosition - b.drawPosition,
    );
  const nextTeam =
    eventTeams.find((team) => team.status === "ready" && !team.rolled) ??
    eventTeams.find((team) => team.status === "ready");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = eventTeams.find((team) => team.id === selectedId) ?? nextTeam;
  const [rawTime, setRawTime] = useState("");
  const [penalties, setPenalties] = useState("0");
  const [notes, setNotes] = useState("");
  const rider = (id: string) => contestants.find((item) => item.id === id)?.name ?? "Unknown";
  const entryRuns = (team: Team) =>
    allEventTeams
      .filter(
        (run) =>
          sameTeamEntry(run, team) &&
          run.round <= team.round,
      )
      .sort((a, b) => a.round - b.round);
  const qualifiedTotal = (team: Team, beforeRound?: number) =>
    teamQualifiedTotal(team, allEventTeams, beforeRound);
  const cumulativeRunLabel = (team: Team) => {
    const runs = entryRuns(team);
    const parts = Array.from({ length: team.round }, (_, index) => {
      const round = index + 1;
      const run = runs.find((item) => item.round === round);
      const time =
        run?.status === "complete" && run.rawTime !== null
          ? (run.rawTime + run.penalties).toFixed(2)
          : run?.status === "no-time"
            ? "NT"
            : "--";
      return `R${round} ${time}`;
    });
    const hasNoTime = runs.some((run) => run.status === "no-time");
    const total = qualifiedTotal(team);
    const totalLabel = hasNoTime
      ? "No average"
      : team.status === "ready"
        ? `${total.toFixed(2)} prior`
        : total.toFixed(2);
    return `${parts.join(" + ")} = ${totalLabel}`;
  };
  const standings = eventTeams
    .filter((team) => team.status === "complete" && team.rawTime !== null)
    .sort(
      (a, b) =>
        qualifiedTotal(a) - qualifiedTotal(b) ||
        a.drawPosition - b.drawPosition,
    );
  const fixedPaidEntries = allEventTeams.filter(
    (team) =>
      team.round === 1 &&
      !team.generated &&
      !team.scratched &&
      team.paid !== false,
  ).length;
  const paidEntryCount =
    event
      ? fixedPaidEntries +
        (event.competitionType === "draw-pot" ||
        event.competitionType === "round-robin" ||
        event.competitionType === "pick-and-draw"
          ? registrations
              .filter(
                (entry) =>
                  entry.eventId === event.id &&
                  entry.status === "entered" &&
                  entry.paid !== false,
              )
              .reduce((total, entry) => total + entry.entries, 0)
          : 0)
      : 0;
  const purse = event ? calculatePurse(event, paidEntryCount) : 0;
  const payouts = calculatePayouts(purse, standings.length, event?.payoutPercentages);
  const shortGoLeaderTotal =
    activeRound === roundCount && roundCount > 1
      ? eventTeams
          .filter((team) => team.status === "complete" && team.rawTime !== null)
          .map((team) => qualifiedTotal(team))
          .sort((a, b) => a - b)[0]
      : undefined;
  const selectedPriorTotal =
    selected && activeRound === roundCount && roundCount > 1
      ? qualifiedTotal(selected, activeRound)
      : 0;
  const timeToFirst =
    shortGoLeaderTotal === undefined
      ? undefined
      : shortGoLeaderTotal - selectedPriorTotal - 0.01;
  const openLedLeaderboard = () => {
    if (!event) return;
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("display", "leaderboard");
    url.searchParams.set("event", event.id);
    url.searchParams.set("round", String(activeRound));
    if (selected) url.searchParams.set("team", selected.id);
    window.location.assign(url.toString());
  };
  const riderStandings = useMemo(() => {
    const stats = new Map<string, { contestantId: string; runs: number; qualified: number; noTimes: number; totalTime: number; points: number }>();
    eventTeams.filter((team) => team.status !== "ready").forEach((team) => {
      [team.headerId, team.heelerId].forEach((contestantId) => {
        const current = stats.get(contestantId) ?? { contestantId, runs: 0, qualified: 0, noTimes: 0, totalTime: 0, points: 0 };
        current.runs += 1;
        if (team.status === "complete" && team.rawTime !== null) {
          current.qualified += 1;
          current.totalTime += team.rawTime + team.penalties;
          current.points += team.points || 1;
        } else {
          current.noTimes += 1;
        }
        stats.set(contestantId, current);
      });
    });
    return [...stats.values()].sort((a, b) => b.points - a.points || (a.totalTime / Math.max(a.qualified, 1)) - (b.totalTime / Math.max(b.qualified, 1)));
  }, [eventTeams]);

  const chooseTeam = (team: Team) => {
    setSelectedId(team.id);
    setRawTime(team.rawTime?.toString() ?? "");
    setPenalties(team.penalties.toString());
    setNotes(team.notes);
  };
  const toggleRolled = (team: Team) => {
    if (team.status !== "ready") return;
    onRollTeam(team.id, !team.rolled);
    if (team.id === selected?.id) {
      setSelectedId(null);
      setRawTime("");
      setPenalties("0");
      setNotes("");
    }
  };
  const saveRun = (status: Team["status"]) => {
    if (!selected) return;
    const total = Number(rawTime) + Number(penalties);
    const exceededLimit = status === "complete" && event && total > event.timeLimit;
    onSave(selected.id, {
      status: exceededLimit ? "no-time" : status,
      rawTime: status === "complete" ? Number(rawTime) : null,
      penalties: status === "complete" ? Number(penalties) : 0,
      notes: exceededLimit ? `${notes}${notes ? " · " : ""}Time limit exceeded` : notes,
      points: status === "complete" && !exceededLimit ? 1 : 0,
      rolled: false,
    });
    setSelectedId(null);
    setRawTime("");
    setPenalties("0");
    setNotes("");
  };
  const changeRound = (round: number) => {
    setSelectedRound(round);
    setSelectedId(null);
    setRawTime("");
    setPenalties("0");
    setNotes("");
    setShowRideInForm(false);
  };
  const addRideInTeam = (team: Team) => {
    if (!event) return;
    const duplicate = allEventTeams.some(
      (existing) =>
        existing.round === 1 &&
        existing.headerId === team.headerId &&
        existing.heelerId === team.heelerId,
    );
    if (duplicate && !event.allowRepeatPartners) {
      setRideInMessage(
        "That partnership is already in Round 1. Enable repeat partner runs to add it again.",
      );
      return;
    }
    const handicap = teamHandicapTotal(
      team.headerId,
      team.heelerId,
      contestants,
    );
    if (handicap > event.handicapTotal) {
      setRideInMessage(
        `Team handicap ${handicap} exceeds the roping maximum of ${event.handicapTotal}.`,
      );
      return;
    }
    const pairingRun =
      allEventTeams.filter(
        (existing) =>
          existing.round === 1 &&
          existing.headerId === team.headerId &&
          existing.heelerId === team.heelerId,
      ).length + 1;
    const rideInTeam = {
      ...team,
      headerEntryNumber: pairingRun,
      heelerEntryNumber: pairingRun,
    };
    onAddRideIn(rideInTeam);
    setSelectedId(rideInTeam.id);
    setShowRideInForm(false);
    setRideInMessage(
      `Ride-in team added as Draw #${team.drawPosition} in Round 1.`,
    );
  };

  return (
    <>
      <PageIntro title="Run desk" text={event ? `Record times and publish standings for ${event.name}.` : "Select an event to open the run desk."} />
      {event && (
        <div className="run-desk-round-controls">
          <div className="round-tabs" role="tablist" aria-label="Competition rounds">
            {Array.from({ length: roundCount }, (_, index) => {
              const round = index + 1;
              const roundTeams = allEventTeams.filter((team) => team.round === round);
              const completed = roundTeams.filter((team) => team.status !== "ready").length;
              return (
                <button
                  className={activeRound === round ? "active" : ""}
                  key={round}
                  role="tab"
                  aria-selected={activeRound === round}
                  onClick={() => changeRound(round)}
                >
                  <span>Round {round}</span>
                  <small>{completed}/{roundTeams.length} runs</small>
                </button>
              );
            })}
          </div>
          {activeRound === 1 && (
            <button className="secondary ride-in-button" onClick={() => setShowRideInForm((current) => !current)}><Plus size={16} /> Ride-in team</button>
          )}
        </div>
      )}
      {rideInMessage && <div className="notice"><span>{rideInMessage}</span><button onClick={() => setRideInMessage("")}><X size={16} /></button></div>}
      {event && activeRound === 1 && showRideInForm && (
        <TeamForm
          event={event}
          contestants={contestants}
          drawPosition={
            Math.max(
              0,
              ...allEventTeams
                .filter((team) => team.round === 1)
                .map((team) => team.drawPosition),
            ) + 1
          }
          onSubmit={addRideInTeam}
          onCancel={() => setShowRideInForm(false)}
          rideIn
        />
      )}
      <div className="run-desk-grid">
        <section className="panel desk-entry">
          <div className="desk-title"><span className="stat-icon"><Gauge size={21} /></span><div><span>Round {activeRound} · Now roping</span><h3>{selected ? `Draw #${selected.drawPosition}` : "Round complete"}</h3></div></div>
          {selected ? (
            <>
              <div className="active-team">
                <div><span>Header</span><strong>{rider(selected.headerId)}</strong></div>
                <i>&</i>
                <div><span>Heeler</span><strong>{rider(selected.heelerId)}</strong></div>
              </div>
              <div className="run-handicap"><span>Team handicap</span><strong>{teamHandicapTotal(selected.headerId, selected.heelerId, contestants)} / {event?.handicapTotal ?? "—"}</strong></div>
              {event && activeRound === roundCount && roundCount > 1 && selected.status === "ready" && (
                <div className="announcer-times">
                  <div><span>Prior aggregate</span><strong>{selectedPriorTotal.toFixed(2)}s</strong></div>
                  <div><span>To stay in the average</span><strong>{event.timeLimit.toFixed(2)}s or faster</strong></div>
                  <div><span>To move into 1st</span><strong>{timeToFirst === undefined ? "Set the pace" : timeToFirst <= 0 ? "Current lead out of reach" : `${timeToFirst.toFixed(2)}s or faster`}</strong></div>
                </div>
              )}
              <div className="time-entry">
                <label>Raw time <span>seconds</span></label>
                <input type="number" min="0" step="0.01" value={rawTime} onChange={(e) => setRawTime(e.target.value)} placeholder="0.00" />
              </div>
              <div className="penalty-buttons">
                <span>Penalty</span>
                {["0", "5", "10", "15"].map((value) => <button className={penalties === value ? "active" : ""} key={value} onClick={() => setPenalties(value)}>{value === "0" ? "Clean" : `+${value}s`}</button>)}
              </div>
              <Field label="Run notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note" /></Field>
              <div className={`result-preview ${rawTime && event && Number(rawTime) + Number(penalties) > event.timeLimit ? "over-limit" : ""}`}><span>Official time {event ? `· ${event.timeLimit}s limit` : ""}</span><strong>{rawTime ? (Number(rawTime) + Number(penalties)).toFixed(2) : "—"}</strong></div>
              <div className="desk-actions"><button className="no-time-button" onClick={() => saveRun("no-time")}>Mark no time</button><button className="primary" disabled={!rawTime || Number(rawTime) <= 0} onClick={() => saveRun("complete")}><Check size={18} /> Save result</button></div>
            </>
          ) : <EmptyState text="Every team in this draw has a result." />}
        </section>

        <section className="panel run-queue">
          <PanelHeading title={`Round ${activeRound} run order`} subtitle={`${eventTeams.filter((team) => team.status === "ready").length} teams remaining`} />
          <div className="queue-scroll">
            {eventTeams.map((team) => (
              <div className={`queue-row ${selected?.id === team.id ? "active" : ""} ${team.rolled ? "rolled" : ""}`} key={team.id}>
                <button className="queue-team-select" onClick={() => chooseTeam(team)}>
                  <span className="draw-number">{team.drawPosition}</span>
                  <span className="queue-team-name"><strong>{rider(team.headerId)} & {rider(team.heelerId)}</strong><small>{team.status === "complete" ? `${(team.rawTime! + team.penalties).toFixed(2)} seconds` : team.status === "no-time" ? "No time" : team.rolled ? "ROLLED · Waiting" : "Ready"}</small>{activeRound > 1 && <small className="cumulative-times">{cumulativeRunLabel(team)}</small>}</span>
                </button>
                {team.status === "ready" && (
                  <button className={`roll-team-button ${team.rolled ? "active" : ""}`} onClick={() => toggleRolled(team)}>
                    {team.rolled ? "Unroll" : "Roll"}
                  </button>
                )}
                <span className={`status-dot ${team.status}`} />
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel standings-panel">
        <div className="table-toolbar">
          <div><h3>Round {activeRound} standings</h3><p>{standings.length} qualified average{standings.length === 1 ? "" : "s"} · {event?.resultsPublished ? "Published live" : "Draft results"}</p></div>
          <div className="toolbar-actions">
            <button className="secondary" disabled={!eventTeams.length || !event} onClick={openLedLeaderboard}><MonitorUp size={16} /> View LED leaderboard</button>
            <button className="secondary" disabled={!eventTeams.length || !event} onClick={() => event && exportResultsCsv(event, allEventTeams, contestants, activeRound)}><Download size={16} /> CSV / Excel</button>
            <button className="secondary" disabled={!eventTeams.length} onClick={() => window.print()}><Printer size={16} /> Print / PDF</button>
            {event && <button className="primary" onClick={() => onUpdateEvent({ ...event, resultsPublished: !event.resultsPublished })}>{event.resultsPublished ? "Unpublish" : "Publish live results"}</button>}
          </div>
        </div>
        <div className="data-table standings-table">
          <div className="table-row table-header"><span>Place</span><span>Team</span><span>Rounds</span><span>Total time</span></div>
          {standings.map((team, index) => (
            <div className="table-row" key={team.id}>
              <span><b className={`place place-${index + 1}`}>{index + 1}</b></span>
              <span><strong>{rider(team.headerId)} & {rider(team.heelerId)}</strong><small>Draw #{team.drawPosition}{activeRound < roundCount ? ` · Advances to Round ${activeRound + 1}` : ""}</small></span>
              <span>{entryRuns(team).filter((run) => run.status === "complete" && run.rawTime !== null).length} / {roundCount}</span>
              <span><b className="total-time">{qualifiedTotal(team).toFixed(2)}</b></span>
            </div>
          ))}
          {!standings.length && <EmptyState text="Qualified runs will appear here." />}
        </div>
      </section>
      {event?.competitionType === "round-robin" && (
        <section className="panel standings-panel">
          <PanelHeading title={`Round ${activeRound} leaderboard`} subtitle="Contestant points and averages for this round" />
          <div className="data-table round-robin-table">
            <div className="table-row table-header"><span>Place</span><span>Contestant</span><span>Points</span><span>Wins</span><span>Losses</span><span>Average</span></div>
            {riderStandings.map((standing, index) => (
              <div className="table-row" key={standing.contestantId}>
                <span><b className={`place place-${index + 1}`}>{index + 1}</b></span>
                <span><strong>{rider(standing.contestantId)}</strong>{index < 4 && <small className="finalist-label">Finalist</small>}</span>
                <span>{standing.points}</span>
                <span>{standing.qualified}</span>
                <span>{standing.noTimes}</span>
                <span>{standing.qualified ? (standing.totalTime / standing.qualified).toFixed(2) : "—"}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="panel payout-panel">
        <div className="payout-summary">
          <span className="stat-icon"><CircleDollarSign size={21} /></span>
          <div><span>Calculated purse</span><strong>${purse.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><small>{paidEntryCount} paid entries + ${event?.addedMoney ?? 0} added money, after per-entry fees</small></div>
        </div>
        <div className="payout-places">
          {payouts.length ? payouts.map((payout) => {
            const team = standings[payout.place - 1];
            const recipients = team
              ? eligiblePayoutRecipients(team, contestants)
              : "";
            return (
              <div key={payout.place}>
                <span>{ordinal(payout.place)} place · {Math.round(payout.percentage * 100)}%<small>{recipients}</small></span>
                <strong>${payout.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
              </div>
            );
          }) : <p>Qualified runs will populate the payout projection.</p>}
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

function exportDrawCsv(event: ArenaEvent, teams: Team[], contestants: Contestant[]) {
  const name = (id: string) => contestants.find((contestant) => contestant.id === id)?.name ?? "Unknown";
  const rows = [
    ["Draw", "Round", "Header", "Header Entry", "Header Free Run", "Heeler", "Heeler Entry", "Heeler Free Run", "Handicap Total", "Checked In", "Status"],
    ...teams.map((team) => [
      team.drawPosition,
      team.round,
      name(team.headerId),
      team.headerEntryNumber ?? 1,
      team.headerFreeRun ? "FR" : "",
      name(team.heelerId),
      team.heelerEntryNumber ?? 1,
      team.heelerFreeRun ? "FR" : "",
      teamHandicapTotal(team.headerId, team.heelerId, contestants),
      team.checkedIn ? "Yes" : "No",
      team.scratched ? "Scratched" : team.status,
    ]),
  ];
  downloadCsv(`${event.name}-draw.csv`, rows);
}

function exportResultsCsv(
  event: ArenaEvent,
  teams: Team[],
  contestants: Contestant[],
  round?: number,
) {
  const name = (id: string) => contestants.find((contestant) => contestant.id === id)?.name ?? "Unknown";
  const displayedTeams = round
    ? teams.filter((team) => team.round === round)
    : teams;
  const rows = [
    ["Draw", "Round", "Rounds Completed", "Header", "Heeler", "Current Round Raw Time", "Penalty", "Run Total", "Total Time", "Status", "Notes"],
    ...displayedTeams.map((team) => {
      const completedRuns = teams.filter(
        (run) =>
          sameTeamEntry(run, team) &&
          run.round <= team.round &&
          run.status === "complete" &&
          run.rawTime !== null,
      );
      return [
        team.drawPosition,
        team.round,
        completedRuns.length,
        name(team.headerId),
        name(team.heelerId),
        team.rawTime ?? "",
        team.penalties,
        team.rawTime === null ? "" : team.rawTime + team.penalties,
        completedRuns.reduce(
          (total, run) => total + run.rawTime! + run.penalties,
          0,
        ),
        team.status,
        team.notes,
      ];
    }),
  ];
  downloadCsv(`${event.name}${round ? `-round-${round}` : ""}-results.csv`, rows);
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) =>
      row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase();
  link.click();
  URL.revokeObjectURL(url);
}

function ordinal(place: number) {
  if (place === 1) return "1st";
  if (place === 2) return "2nd";
  if (place === 3) return "3rd";
  return `${place}th`;
}

function eligiblePayoutRecipients(team: Team, contestants: Contestant[]) {
  const name = (id: string) =>
    contestants.find((contestant) => contestant.id === id)?.name ?? "Unknown";
  if (team.headerFreeRun) return `${name(team.heelerId)} eligible · Header FR excluded`;
  if (team.heelerFreeRun) return `${name(team.headerId)} eligible · Heeler FR excluded`;
  return `${name(team.headerId)} & ${name(team.heelerId)} eligible`;
}

function resizeProfilePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const maxSize = 512;
        const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Canvas is unavailable."));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default App;
