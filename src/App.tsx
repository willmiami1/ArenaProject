import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Camera,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleDollarSign,
  ClipboardPen,
  Clock3,
  Cloud,
  CloudOff,
  Dices,
  Download,
  Eye,
  FileBarChart,
  Gauge,
  GitFork,
  GripVertical,
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
  WifiOff,
  X,
} from "lucide-react";
import { normalizeData, useArenaData } from "./useArenaData";
import { resizeProfilePhoto } from "./profilePhoto";
import { PublicSite } from "./PublicSite";
import { AdminAccessGate } from "./AdminAccessGate";
import { RegistrationDeskAccessGate } from "./RegistrationDeskAccessGate";
import { RegistrationDesk } from "./RegistrationDesk";
import {
  aggregatePublicSpectatorLeaderboard,
  parsePublicRoute,
  refreshedSpectatorLeaderboardState,
  type PublicArenaData,
  type PublicSpectatorLeaderboardRow,
} from "./publicData";
import { ReportsModule } from "./ReportsModule";
import {
  roundTimeSheetFileName,
  roundTimeSheetHtml,
} from "./runDeskPrint";
import {
  payoffReportFileName,
  payoffReportHtml,
} from "./payoffReport";
import {
  normalizedRunDeskRound,
  runDeskSelectionToPersist,
} from "./runDeskActiveSelection";
import {
  ActiveRunSaveError,
  type ActiveRunSelection,
} from "./activeRunSaveQueue";
import {
  authenticateContestant,
  isWixEmbed,
  loadContestantSignedWaiver,
  loadContestantWaiverStatuses,
  loadPublicArenaData,
  logoutAdmin,
  resetSpectatorScoreboard,
  setContestantPin,
  type ContestantSignedWaiverEvidence,
  type ContestantPortalData,
} from "./wixBridge";
import { registrationDeskHref } from "./registrationDeskNavigation";
import {
  ledQualifiedRunsThroughRound,
  ledShowsFinalResults,
  resolveLedRunDeskState,
  sortLedStandings,
} from "./ledDisplay";
import {
  calculatePayouts,
  calculatePurse,
  applyRunResult,
  competitionName,
  competitionTypes,
  contestantEligibleForRole,
  defaultCompetitionSettings,
  entryClearedForDraw,
  generateCompetitionDraw,
  minimumDrawEntries,
  officialRunTime,
  pickedTeamRidersMissingFromDraw,
  repeatedTeamPairKeys,
  reorderDraftDrawTeams,
  reorderRunOrderTeams,
  slideTimeAdjustment,
  teamEligibleForCompetition,
  teamHandicapTotal,
} from "./competition";
import { clearSpectatorScoreboard, spectatorLeaderboard } from "./spectatorPredictions";
import { normalizeHorseNames } from "./contestantHorses";
import { contestantRopingHistory } from "./contestantHistory";
import {
  contestantWaiverStatusPresentation,
  readyContestantWaiverStatuses,
  type ContestantWaiverStatusesResponse,
  type ContestantWaiverStatusesState,
} from "./contestantWaiverStatus";
import { sortWorkspaceMeets } from "./workspaceEventOrder";
import {
  assertRoundRobinRoleCapacity,
  roundRobinRoleCapacity,
} from "./roundRobinCapacity";
import type {
  ArenaData,
  ArenaEvent,
  ArenaMeet,
  CompetitionType,
  Contestant,
  EventRegistration,
  EventStatus,
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
const LED_PUBLIC_DATA_REQUEST = "arena-led-public-data-request";
const LED_PUBLIC_DATA_RESPONSE = "arena-led-public-data-response";
const LED_WORKSPACE_DATA_REQUEST = "arena-led-workspace-data-request";
const LED_WORKSPACE_DATA_RESPONSE = "arena-led-workspace-data-response";

function requestPublicArenaDataFromOpener() {
  const opener = window.opener;
  if (!opener) return Promise.resolve<PublicArenaData | null>(null);
  return new Promise<PublicArenaData | null>((resolve, reject) => {
    const requestId =
      window.crypto.randomUUID?.() ??
      `led-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleResponse);
      reject(new Error("The Run Desk did not respond."));
    }, 8000);
    function handleResponse(event: MessageEvent) {
      if (
        event.source !== opener ||
        event.origin !== window.location.origin ||
        event.data?.source !== LED_PUBLIC_DATA_RESPONSE ||
        event.data?.requestId !== requestId
      ) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleResponse);
      resolve(event.data.publicData ?? null);
    }
    window.addEventListener("message", handleResponse);
    opener.postMessage(
      { source: LED_PUBLIC_DATA_REQUEST, requestId },
      window.location.origin,
    );
  });
}

function requestWorkspaceDataFromOpener() {
  const opener = window.opener;
  if (!opener) return Promise.resolve<ArenaData | null>(null);
  return new Promise<ArenaData | null>((resolve, reject) => {
    const requestId =
      window.crypto.randomUUID?.() ??
      `led-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleResponse);
      reject(new Error("The Run Desk did not respond."));
    }, 8000);
    function handleResponse(event: MessageEvent) {
      if (
        event.source !== opener ||
        event.origin !== window.location.origin ||
        event.data?.source !== LED_WORKSPACE_DATA_RESPONSE ||
        event.data?.requestId !== requestId
      ) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleResponse);
      resolve(event.data.workspaceData ?? null);
    }
    window.addEventListener("message", handleResponse);
    opener.postMessage(
      { source: LED_WORKSPACE_DATA_REQUEST, requestId },
      window.location.origin,
    );
  });
}

function openLedWindow(url: string) {
  const popup = window.open(url, "_blank");
  if (popup && !isWixEmbed()) popup.opener = null;
  return popup;
}

const uid = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const eventStatusLabel = (status: EventStatus) =>
  status === "Upcoming" ? "Future" : status === "Complete" ? "Past" : "Live";

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
  event?: ArenaEvent,
  contestants: Contestant[] = [],
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
    .reduce(
      (total, run) =>
        total +
        (event
          ? (officialRunTime(event, run, contestants) ?? 0)
          : run.rawTime! + run.penalties),
      0,
    );

function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function StaffApp() {
  const [
    data,
    setData,
    persistenceStatus,
    refreshFromWix,
    saveImmediately,
    saveContestantImmediately,
    saveEventImmediately,
    saveRegistrationImmediately,
    saveActiveRunImmediately,
    lastSaveError,
    retryWorkspaceSave,
  ] = useArenaData();
  const [view, setView] = useState<View>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const online = useOnlineStatus();
  const restoreFileInput = useRef<HTMLInputElement>(null);
  const downloadWorkspaceBackup = () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `arena-command-backup-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setWorkspaceMessage("Backup file saved to this computer.");
  };
  const restoreWorkspaceBackup = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as ArenaData;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !Array.isArray(parsed.events) ||
        !Array.isArray(parsed.teams) ||
        !Array.isArray(parsed.contestants)
      ) {
        throw new Error("Not an Arena Command backup file.");
      }
      if (
        !window.confirm(
          `Replace the current workspace with the backup "${file.name}"? The restored data will save to Wix automatically.`,
        )
      ) {
        return;
      }
      // Keep the live revision so the restore saves as a normal update and
      // is not discarded as older than the workspace already on Wix.
      setData(normalizeData({ ...parsed, revision: data.revision }));
      setWorkspaceMessage(`Workspace restored from ${file.name}.`);
    } catch {
      window.alert(
        "That file could not be read as an Arena Command backup. The workspace was not changed.",
      );
    }
  };
  const activeEvent =
    data.events.find((event) => event.id === data.activeEventId) ?? data.events[0];
  useEffect(() => {
    // Inside the Wix embed the page has its own scrollbar; hide the app's window
    // scrollbar so only one shows. Wheel/touch scrolling still works.
    if (!isWixEmbed()) return;
    document.documentElement.classList.add("hide-window-scrollbar");
    return () => document.documentElement.classList.remove("hide-window-scrollbar");
  }, []);
  useEffect(() => {
    if (!isWixEmbed()) return;
    const relayPublicResults = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.data?.source !== LED_PUBLIC_DATA_REQUEST ||
        typeof event.data?.requestId !== "string" ||
        !event.source
      ) {
        return;
      }
      const target = event.source as Window;
      void loadPublicArenaData()
        .then((publicData) => {
          target.postMessage(
            {
              source: LED_PUBLIC_DATA_RESPONSE,
              requestId: event.data.requestId,
              publicData,
            },
            event.origin,
          );
        })
        .catch((error) => {
          console.error("Could not send spectator results to the LED display.", error);
        });
    };
    window.addEventListener("message", relayPublicResults);
    return () => window.removeEventListener("message", relayPublicResults);
  }, []);
  useEffect(() => {
    if (!isWixEmbed()) return;
    const relayWorkspaceData = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.data?.source !== LED_WORKSPACE_DATA_REQUEST ||
        typeof event.data?.requestId !== "string" ||
        !event.source
      ) {
        return;
      }
      (event.source as Window).postMessage(
        {
          source: LED_WORKSPACE_DATA_RESPONSE,
          requestId: event.data.requestId,
          workspaceData: data,
        },
        event.origin,
      );
    };
    window.addEventListener("message", relayWorkspaceData);
    return () => window.removeEventListener("message", relayWorkspaceData);
  }, [data]);
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
        usePublicRelay={displayParams.get("relay") === "wix"}
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
    if (isWixEmbed()) url.searchParams.set("relay", "wix");
    const popup = openLedWindow(url.toString());
    if (!popup) {
      window.alert("Allow pop-ups to open the LED screen in a new tab.");
    }
  };
  const openContestantPortal = () => {
    const url = new URL(window.location.href);
    const wixHostOrigin = url.searchParams.get("wixHostOrigin");
    url.search = "";
    url.searchParams.set("portal", "contestant");
    if (wixHostOrigin) url.searchParams.set("wixHostOrigin", wixHostOrigin);
    window.location.assign(url.toString());
  };
  const openRegistrationDesk = () => {
    window.location.assign(registrationDeskHref(window.location.href));
  };
  const logOutAdmin = async () => {
    try {
      await logoutAdmin();
      window.localStorage.removeItem("arena-command-data-v1");
      const url = new URL(window.location.href);
      const wixHostOrigin = url.searchParams.get("wixHostOrigin");
      url.search = "";
      url.searchParams.set("page", "home");
      if (wixHostOrigin) url.searchParams.set("wixHostOrigin", wixHostOrigin);
      window.location.assign(url.toString());
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Wix could not log out the administrator.",
      );
    }
  };
  const openPublicWebsite = () => {
    if (!isWixEmbed()) {
      window.localStorage.setItem("arena-command-data-v1", JSON.stringify(data));
    }
    const url = new URL(window.location.href);
    const wixHostOrigin = url.searchParams.get("wixHostOrigin");
    url.search = "";
    url.searchParams.set("page", "home");
    if (wixHostOrigin) url.searchParams.set("wixHostOrigin", wixHostOrigin);
    url.hash = "events";
    window.location.assign(url.toString());
  };
  const refreshWorkspace = async () => {
    setWorkspaceMessage("Refreshing the live Wix workspace...");
    try {
      const refreshed = await refreshFromWix();
      setWorkspaceMessage(
        `Loaded ${refreshed.contestants.length} contestant${refreshed.contestants.length === 1 ? "" : "s"} from Wix.`,
      );
    } catch (error) {
      setWorkspaceMessage(
        error instanceof Error ? error.message : "The Wix workspace could not be refreshed.",
      );
    }
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
          <button onClick={openRegistrationDesk}>
            <ClipboardPen size={19} />
            Registration Desk
          </button>
          <button onClick={openPublicWebsite}>
            <Eye size={19} />
            View Public Website
          </button>
          <button onClick={() => { void logOutAdmin(); }}>
            <LogOut size={19} />
            Log out
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
          <div
            className={`persistence-status ${persistenceStatus}${
              persistenceStatus === "error" && !online ? " offline" : ""
            }`}
          >
            {persistenceStatus === "error" ? (
              online ? (
                <CloudOff size={15} />
              ) : (
                <WifiOff size={15} />
              )
            ) : (
              <Cloud size={15} />
            )}
            <span>
              {persistenceStatus === "loading"
                ? "Connecting to Wix"
                : persistenceStatus === "saving"
                  ? "Saving"
                  : persistenceStatus === "saved"
                    ? "Saved to Wix"
                    : persistenceStatus === "error"
                      ? online
                        ? "Wix save failed"
                        : "Offline — saved on this computer"
                      : "Local preview"}
            </span>
          </div>
          <button
            className="topbar-front-screen"
            disabled={persistenceStatus === "loading"}
            onClick={() => { void refreshWorkspace(); }}
            title="Reload contestants and events from Wix"
          >
            <RefreshCw size={17} />
            <span>Refresh from Wix</span>
          </button>
          <button
            className="topbar-front-screen registration-desk-shortcut"
            onClick={openRegistrationDesk}
            title="Open Registration Desk"
          >
            <ClipboardPen size={17} />
            <span>Registration Desk</span>
          </button>
          <button
            className="topbar-front-screen"
            onClick={openPublicWebsite}
          >
            <Eye size={17} />
            <span>Front Screen</span>
          </button>
          <button
            className="topbar-front-screen"
            onClick={downloadWorkspaceBackup}
            title="Save a backup file of the whole workspace on this computer"
          >
            <Download size={17} />
            <span>Backup</span>
          </button>
          <button
            className="topbar-front-screen"
            onClick={() => restoreFileInput.current?.click()}
            title="Restore the workspace from a backup file"
          >
            <Upload size={17} />
            <span>Restore</span>
          </button>
          <input
            ref={restoreFileInput}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void restoreWorkspaceBackup(file);
            }}
          />
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

        {persistenceStatus === "error" && !online && (
          <div className="workspace-save-error offline" role="alert">
            <div>
              <strong>Working offline</strong>
              <span>
                No internet connection. Every change keeps saving on this
                computer, and the workspace will sync to Wix automatically when
                the connection returns.
              </span>
              <small>You can keep running the event with the Run Desk and LED screen.</small>
            </div>
          </div>
        )}

        {persistenceStatus === "error" && online && lastSaveError && (
          <div className="workspace-save-error" role="alert">
            <div>
              <strong>Wix save failed</strong>
              <span>{lastSaveError}</span>
              <small>Your unsaved workspace remains on this device.</small>
            </div>
            <button onClick={retryWorkspaceSave}>
              <RefreshCw size={15} />
              Retry save
            </button>
          </div>
        )}

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
              onAdd={saveEventImmediately}
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
              onUpdate={saveEventImmediately}
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
              meets={data.meets}
              events={data.events}
              teams={data.teams}
              registrations={data.registrations}
              onOpenRegistrationDesk={openRegistrationDesk}
              onAdd={saveContestantImmediately}
              onUpdate={saveContestantImmediately}
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
                      ? current.registrations.filter(
                          (registration) =>
                            registration.sourceTeamId !== updatedTeam.id,
                        )
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
              onAddRegistration={saveRegistrationImmediately}
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
                setData((current) => {
                  const drawnIds = new Set(eventTeams.map((team) => team.id));
                  const pendingOnlineTeams = current.teams.filter(
                    (team) =>
                      team.eventId === eventId &&
                      team.source === "online" &&
                      team.paid === false &&
                      !drawnIds.has(team.id),
                  );
                  return {
                    ...current,
                    teams: [
                      ...current.teams.filter((team) => team.eventId !== eventId),
                      ...pendingOnlineTeams,
                      ...eventTeams,
                    ],
                  events: current.events.map((event) =>
                    event.id === eventId
                      ? (() => {
                          const activeSelection =
                            runDeskSelectionToPersist(
                              {
                                activeRunId: undefined,
                                activeRound: undefined,
                              },
                              eventTeams.filter((team) => team.round === 1),
                              1,
                            );
                          return {
                            ...event,
                            drawApproved: true,
                            drawLocked: true,
                            ...activeSelection,
                            drawHistory: [
                              ...event.drawHistory,
                              {
                                id: uid("draw"),
                                createdAt: new Date().toISOString(),
                                teams: eventTeams,
                              },
                            ],
                          };
                        })()
                      : event,
                    ),
                  };
                })
              }
              onUpdateEvent={(updatedEvent) =>
                setData((current) => ({
                  ...current,
                  events: current.events.map((event) =>
                    event.id === updatedEvent.id ? updatedEvent : event,
                  ),
                }))
              }
            />
          )}
          {view === "run-desk" && (
            <RunDesk
              event={activeEvent}
              teams={data.teams}
              registrations={data.registrations}
              contestants={data.contestants}
              onSelectActiveRun={saveActiveRunImmediately}
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
                      activeEvent,
                      current.contestants,
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
              onReorderTeams={(movingTeamId, targetTeamId) =>
                setData((current) => ({
                  ...current,
                  teams: reorderRunOrderTeams(
                    current.teams,
                    movingTeamId,
                    targetTeamId,
                  ),
                }))
              }
              onSetPredictionCutoff={(teamId, predictionClosesAt) =>
                setData((current) => ({
                  ...current,
                  teams: current.teams.map((team) =>
                    team.id === teamId ? { ...team, predictionClosesAt } : team,
                  ),
                }))
              }
              onResetScoreboard={async () => {
                if (!activeEvent) {
                  throw new Error("Select a competition first.");
                }
                const confirmation = isWixEmbed()
                  ? await resetSpectatorScoreboard(activeEvent.id)
                  : null;
                const cleared = confirmation
                  ? confirmation.cleared
                  : clearSpectatorScoreboard(data, activeEvent.id).cleared;
                setData((current) => ({
                  ...current,
                  spectatorPredictions: clearSpectatorScoreboard(
                    current,
                    activeEvent.id,
                  ).spectatorPredictions,
                }));
                return cleared;
              }}
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

function LedSpectatorTop({
  eventId,
  round,
  fallbackRows,
  picksClosed,
  usePublicRelay,
  teamId,
  finalResults,
  official,
}: {
  eventId: string;
  round: number;
  fallbackRows: PublicSpectatorLeaderboardRow[];
  picksClosed: boolean;
  usePublicRelay: boolean;
  teamId?: string;
  finalResults: boolean;
  official: boolean;
}) {
  const [rows, setRows] = useState(fallbackRows);
  const [relayedPicksClosed, setRelayedPicksClosed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const usePublicData = (
      publicData: Pick<PublicArenaData, "competitions"> | null,
    ) => {
      if (cancelled) return;
      const refreshed = refreshedSpectatorLeaderboardState(
        publicData,
        eventId,
        round,
        fallbackRows,
        teamId,
      );
      setRows(refreshed.rows);
      setRelayedPicksClosed(refreshed.picksClosed);
    };
    let refreshing = false;
    const refresh = () => {
      if (refreshing) return;
      refreshing = true;
      const request = isWixEmbed()
        ? loadPublicArenaData()
        : usePublicRelay
          ? requestPublicArenaDataFromOpener()
          : Promise.resolve(null);
      void request
        .then((publicData) => {
          usePublicData(publicData);
        })
        .catch((error) => {
          console.error("Could not refresh spectator leaderboard.", error);
          if (!cancelled) setRows(fallbackRows);
        })
        .finally(() => {
          refreshing = false;
        });
    };
    if (!isWixEmbed() && !usePublicRelay) {
      setRows(fallbackRows);
      setRelayedPicksClosed(false);
      return;
    }
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    eventId,
    round,
    teamId,
    usePublicRelay,
    fallbackRows
      .map((row) => `${row.name}:${row.correct}:${row.picks}`)
      .join("|"),
  ]);
  const effectivePicksClosed = picksClosed || relayedPicksClosed;
  return (
    <section className={`led-spectator-top${effectivePicksClosed ? " picks-closed" : ""}`}>
      <span>
        {finalResults ? "Final Spectator Results" : "Top 3 Spectator Results"}
        <small>
          {finalResults ? "All rounds" : `Through Round ${round}`} ·{" "}
          {official ? "Official" : "Unofficial"}
        </small>
      </span>
      {effectivePicksClosed && <em className="led-picks-closed">Picks are closed</em>}
      <div>
        {rows.length
          ? rows.slice(0, 3).map((row, index) => (
              <strong key={`${index}-${row.name}`}>
                <b>{index + 1}</b>
                <span>{row.name}<small>{row.correct} correct / {row.picks} picks</small></span>
              </strong>
            ))
          : <strong className="waiting">Waiting for spectator picks</strong>}
      </div>
    </section>
  );
}

function LedScrollingRows({
  children,
  rowCount,
}: {
  children: ReactNode;
  rowCount: number;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [scrollDistance, setScrollDistance] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const rows = rowsRef.current;
    if (!viewport || !rows) return;

    const measureOverflow = () => {
      const nextDistance = Math.max(rows.scrollHeight - viewport.clientHeight, 0);
      setScrollDistance((current) =>
        Math.abs(current - nextDistance) < 1 ? current : nextDistance,
      );
    };

    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(viewport);
    observer.observe(rows);
    return () => observer.disconnect();
  }, [rowCount]);

  const duration = Math.max(26, Math.round((scrollDistance * 2) / 15 + 10));
  const scrollStyle = {
    "--led-scroll-distance": `${scrollDistance}px`,
    "--led-scroll-duration": `${duration}s`,
  } as CSSProperties;

  return (
    <div className="led-rows-viewport" ref={viewportRef}>
      <div
        className={`led-rows${scrollDistance > 0 ? " is-scrolling" : ""}`}
        ref={rowsRef}
        style={scrollStyle}
      >
        {children}
      </div>
    </div>
  );
}

function LedLeaderboard({
  data: fallbackData,
  eventId,
  requestedRound,
  requestedTeamId,
  usePublicRelay,
}: {
  data: ArenaData;
  eventId?: string;
  requestedRound?: number;
  requestedTeamId?: string;
  usePublicRelay: boolean;
}) {
  const [relayedData, setRelayedData] = useState<ArenaData | null>(null);
  const [clock, setClock] = useState(new Date());
  const data = relayedData ?? fallbackData;
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!usePublicRelay) return;
    let cancelled = false;
    let timer = 0;
    const refresh = async () => {
      try {
        const workspaceData = await requestWorkspaceDataFromOpener();
        if (!cancelled && workspaceData) setRelayedData(workspaceData);
      } catch (error) {
        if (!cancelled) {
          console.error("Could not refresh the LED workspace data.", error);
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(refresh, 1500);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [usePublicRelay]);

  const event =
    data.events.find((item) => item.id === eventId) ??
    data.events.find((item) => item.id === data.activeEventId) ??
    data.events[0];
  if (!event) {
    return <div className="led-leaderboard led-empty">No competition selected</div>;
  }
  const eventTeams = data.teams.filter(
    (team) => team.eventId === event.id && !team.scratched,
  );
  const ledRunDeskState = resolveLedRunDeskState(
    event,
    eventTeams,
    requestedRound,
    requestedTeamId,
  );
  const round = ledRunDeskState.round;
  const roundTeams = eventTeams
    .filter((team) => team.round === round)
    .sort((a, b) => a.drawPosition - b.drawPosition);
  const standings = sortLedStandings(
    ledQualifiedRunsThroughRound(event.id, eventTeams, round),
    (team) =>
      teamQualifiedTotal(team, eventTeams, round + 1, event, data.contestants),
  ).slice(0, 20);
  const spectatorTopThree = aggregatePublicSpectatorLeaderboard(
    Array.from({ length: round }, (_, index) =>
      spectatorLeaderboard(data, event.id, index + 1).map(
        ({ name, round: resultRound, picks, correct }) => ({
          name,
          round: resultRound,
          picks,
          correct,
        }),
      ),
    ).flat(),
  ).slice(0, 3);
  const defaultCurrentTeam = roundTeams.find(
    (team) => team.status === "ready" && !team.rolled,
  ) ?? roundTeams.find((team) => team.status === "ready");
  const currentTeam =
    roundTeams.find(
      (team) =>
        team.id === ledRunDeskState.activeTeamId &&
        team.status === "ready",
    ) ?? defaultCurrentTeam;
  const finalResults = ledShowsFinalResults(event, eventTeams, round);
  // The live scoreboard remains provisional even after results are published.
  const officialResults = false;
  const nextTeam =
    roundTeams.find(
      (team) =>
        team.status === "ready" &&
        !team.rolled &&
        team.id !== currentTeam?.id &&
        team.drawPosition > (currentTeam?.drawPosition ?? 0),
    ) ??
    roundTeams.find(
      (team) =>
        team.status === "ready" &&
        !team.rolled &&
        team.id !== currentTeam?.id,
    ) ??
    roundTeams.find(
      (team) =>
        team.status === "ready" &&
        team.id !== currentTeam?.id &&
        team.drawPosition > (currentTeam?.drawPosition ?? 0),
    ) ??
    roundTeams.find(
      (team) => team.status === "ready" && team.id !== currentTeam?.id,
    );
  const isFinalRound = event.rounds > 1 && round === event.rounds;
  const finalRoundTotals = isFinalRound
    ? roundTeams
        .filter((team) => team.status === "complete" && team.rawTime !== null)
        .map((team) =>
          teamQualifiedTotal(team, eventTeams, undefined, event, data.contestants),
        )
        .sort((a, b) => a - b)
    : [];
  const finalRoundLeaderTotal = finalRoundTotals.length
    ? finalRoundTotals[0]
    : undefined;
  const currentTeamPriorTotal = currentTeam
    ? teamQualifiedTotal(currentTeam, eventTeams, round, event, data.contestants)
    : 0;
  const currentTeamTimeToFirst =
    finalRoundLeaderTotal === undefined
      ? undefined
      : finalRoundLeaderTotal - currentTeamPriorTotal - 0.01;
  const ledPayingSpots = Math.max(
    1,
    (event.payoutPercentages ?? [50, 30, 20]).filter(
      (percentage) => percentage > 0,
    ).length,
  );
  const ledMoneyCutoffTotal =
    finalRoundTotals.length >= ledPayingSpots
      ? finalRoundTotals[ledPayingSpots - 1]
      : undefined;
  const currentTeamTimeToMoney =
    ledMoneyCutoffTotal === undefined
      ? undefined
      : ledMoneyCutoffTotal - currentTeamPriorTotal - 0.01;
  const rider = (id: string) =>
    data.contestants.find((contestant) => contestant.id === id);
  const ledRider = (id: string, horseName?: string) => {
    const contestant = rider(id);
    const name = contestant?.name ?? "Unknown";
    return (
      <span className="led-rider">
        <span className="led-avatar">
          {contestant?.photo
            ? <img src={contestant.photo} alt={`${name} profile`} />
            : <span aria-hidden="true">{initials(name)}</span>}
        </span>
        <span className="led-rider-name">
          <strong>{name}</strong>
          {horseName && <small>riding {horseName}</small>}
        </span>
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
        <div className={`led-round${finalResults ? " final-results" : ""}`}>
          <span>{finalResults ? "Final results" : "Live leaderboard"}</span>
          <strong>Round {round}</strong>
          <em className={officialResults ? "official" : "unofficial"}>
            {officialResults ? "Official results" : "Unofficial results"}
          </em>
        </div>
        <div className="led-clock"><strong>{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong><span>{clock.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span></div>
        <div className="led-header-actions">
          <button className="led-fullscreen" onClick={enterFullscreen}><Maximize2 size={24} /> Full screen</button>
          <button className="led-fullscreen" onClick={leaveDisplay}><X size={24} /> Back to Run Desk</button>
        </div>
      </header>

      <section className="led-current-team">
        <div className="led-current-label">
          <span className="live-dot" />
          <span>{finalResults ? "Competition complete" : "Now roping"}</span>
          <strong>
            {finalResults
              ? officialResults
                ? "Official final results"
                : "Unofficial final results"
              : currentTeam
                ? `Team #${currentTeam.originalTeamNumber ?? currentTeam.drawPosition}`
                : "Round complete"}
          </strong>
        </div>
        {currentTeam && (
          <>
            <div className="led-current-riders">
              {ledRider(currentTeam.headerId, currentTeam.headerHorseName)}
              <i>&</i>
              {ledRider(currentTeam.heelerId, currentTeam.heelerHorseName)}
            </div>
            {isFinalRound && (
              <div className="led-current-targets">
                <span><small>Be in the money pot</small><strong>{currentTeamTimeToMoney === undefined ? "Just catch" : currentTeamTimeToMoney <= 0 ? "Out of reach" : `${currentTeamTimeToMoney.toFixed(2)}s`}</strong></span>
                <span><small>Take 1st</small><strong>{currentTeamTimeToFirst === undefined ? "Set pace" : currentTeamTimeToFirst <= 0 ? "Out of reach" : `${currentTeamTimeToFirst.toFixed(2)}s`}</strong></span>
              </div>
            )}
          </>
        )}
      </section>
      <LedSpectatorTop
        eventId={event.id}
        round={round}
        fallbackRows={spectatorTopThree.map(
          ({ name, round: resultRound, picks, correct }) => ({
            name,
            round: resultRound,
            picks,
            correct,
          }),
        )}
        picksClosed={Boolean(
          currentTeam?.predictionClosesAt &&
            Date.parse(currentTeam.predictionClosesAt) <= clock.getTime(),
        )}
        usePublicRelay={usePublicRelay}
        teamId={currentTeam?.id}
        finalResults={finalResults}
        official={officialResults}
      />

      <main className="led-board">
        <div className="led-table-header">
          <span>{finalResults ? "Final place" : "Place"}</span>
          <span>
            {officialResults
              ? "Contestant results · Official"
              : "Contestant results · Unofficial"}
          </span>
          <span>Rounds</span>
          <span>Total time</span>
        </div>
        <LedScrollingRows rowCount={standings.length}>
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
                <span className="led-team">{ledRider(team.headerId, team.headerHorseName)}<i>&</i>{ledRider(team.heelerId, team.heelerHorseName)}</span>
                <span className="led-rounds">{completedRounds} / {event.rounds}</span>
                <span className="led-total">{teamQualifiedTotal(team, eventTeams, round + 1, event, data.contestants).toFixed(2)}</span>
              </div>
            );
          })}
          {!standings.length && <div className="led-waiting"><Trophy size={54} /><strong>Waiting for qualified results</strong></div>}
        </LedScrollingRows>
      </main>

      <footer className="led-footer">
        <div className="led-next-label">
          <span className="live-dot" />
          <strong>{finalResults ? "Final results" : "Next team"}</strong>
        </div>
        {nextTeam ? (
          <>
            <span className="led-next-draw">Team #{nextTeam.originalTeamNumber ?? nextTeam.drawPosition}</span>
            <span className="led-next-team">{ledRider(nextTeam.headerId, nextTeam.headerHorseName)}<i>&</i>{ledRider(nextTeam.heelerId, nextTeam.heelerHorseName)}</span>
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
    .sort((a, b) =>
      event
        ? (officialRunTime(event, a, contestants) ?? 0) -
          (officialRunTime(event, b, contestants) ?? 0)
        : 0,
    )
    .slice(0, 3);
  const rider = (id: string) =>
    contestants.find((item) => item.id === id)?.name ?? "Unknown";

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
        <Stat icon={Clock3} label="Fast time" value={standings[0] && event ? `${(officialRunTime(event, standings[0], contestants) ?? 0).toFixed(2)}s` : "--"} detail={standings[0] ? `${rider(standings[0].headerId)} / ${rider(standings[0].heelerId)}` : "Waiting on results"} />
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
                <b>{event ? (officialRunTime(event, team, contestants) ?? 0).toFixed(2) : "—"}</b>
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
  onAdd: (event: ArenaEvent) => void | Promise<ArenaEvent>;
  onSelect: (id: string) => void;
  onUpdate: (event: ArenaEvent) => void | Promise<ArenaEvent>;
  onDelete: (id: string) => void;
}) {
  const [showMeetForm, setShowMeetForm] = useState(false);
  const [editingMeet, setEditingMeet] = useState<ArenaMeet | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ArenaEvent | null>(null);
  const [selectedType, setSelectedType] = useState<CompetitionType | null>(null);
  return (
    <>
      <PageIntro
        title="Events"
        text="Create an arena event, then add independent roping competitions beneath it."
        button="New event"
        onClick={() => {
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
      <div className="meet-list">
        {sortWorkspaceMeets(meets).map((meet) => {
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
                  <button className="primary" onClick={() => { setSelectedParentId(meet.id); setSelectedType(null); setEditing(null); setShowMeetForm(false); }}><Plus size={16} /> Add roping</button>
                  <button className="icon-action" title="Edit event" onClick={() => { setEditingMeet(meet); setShowMeetForm(false); setSelectedParentId(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Pencil size={16} /></button>
                  <button className="icon-action delete-action" title="Delete event" onClick={() => {
                    if (window.confirm(`Delete ${meet.name} and all of its roping competitions, draws, and results?`)) {
                      onDeleteMeet(meet.id);
                    }
                  }}><Trash2 size={16} /></button>
                </div>
              </div>
              {selectedParentId === meet.id && !selectedType && !editing && (
                <CompetitionTypeSelector
                  events={competitions}
                  teams={teams}
                  onSelect={setSelectedType}
                  onCancel={() => setSelectedParentId(null)}
                />
              )}
              {((selectedParentId === meet.id && selectedType) ||
                editing?.parentEventId === meet.id) && (
                <EventForm
                  event={editing ?? undefined}
                  parent={meet}
                  competitionType={selectedType ?? editing?.competitionType}
                  onSubmit={async (event) => {
                    try {
                      if (editing) await onUpdate(event);
                      else await onAdd(event);
                      setEditing(null);
                      setSelectedType(null);
                      setSelectedParentId(null);
                    } catch {
                      // The workspace error banner reports the relay failure.
                    }
                  }}
                  onCancel={() => {
                    setEditing(null);
                    setSelectedType(null);
                    setSelectedParentId(null);
                  }}
                />
              )}
              <div className="competition-list">
                {competitions.map((event) => (
                  <article className={`competition-row ${event.id === activeEventId ? "selected" : ""}`} key={event.id}>
                    <span className="competition-icon">{event.competitionType === "draw-pot" ? <Dices size={20} /> : event.competitionType === "pick-only" ? <Handshake size={20} /> : event.competitionType === "pick-and-draw" ? <GitFork size={20} /> : event.competitionType === "slide" ? <Gauge size={20} /> : <Repeat2 size={20} />}</span>
                    <div className="competition-row-main">
                      <div className="event-card-tags"><span className={`tag ${event.status.toLowerCase()}`}>{eventStatusLabel(event.status)}</span><span className="tag neutral">{competitionName(event.competitionType)}</span></div>
                      <div className="competition-name-actions">
                        <h3>{event.name}</h3>
                        <button
                          className={event.resultsPublished ? "selected-button publish-results-button" : "secondary publish-results-button"}
                          onClick={() =>
                            onUpdate({
                              ...event,
                              resultsPublished: !event.resultsPublished,
                            })
                          }
                          title={
                            event.resultsPublished
                              ? "Remove this roping's results from the public website"
                              : "Publish this individual roping's results on the public website"
                          }
                        >
                          <Trophy size={14} />
                          {event.resultsPublished
                            ? "Unpublish Results"
                            : "Publish Event Results"}
                        </button>
                      </div>
                      <p>${event.entryFee} entry · HC {event.handicapTotal} · {event.rounds} round{event.rounds === 1 ? "" : "s"}{event.rounds > 1 && event.shortGoTeams > 0 ? ` · Top ${event.shortGoTeams} Short Go` : ""} · {teams.filter((team) => team.eventId === event.id).length} teams</p>
                    </div>
                    <div className="event-actions">
                      <button className={event.id === activeEventId ? "selected-button" : "secondary"} onClick={() => onSelect(event.id)}>
                        {event.id === activeEventId ? <><Check size={16} /> Active roping</> : "Open roping"}
                      </button>
                      <button className="icon-action" title="Edit roping" onClick={() => { setEditing(event); setSelectedParentId(meet.id); setSelectedType(null); setShowMeetForm(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Pencil size={16} /></button>
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
        <Field label="Event name"><input required autoCapitalize="characters" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })} placeholder="Saturday Night Jackpot" /></Field>
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
    slide: Gauge,
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
  onSubmit: (event: ArenaEvent) => void | Promise<void>;
  onCancel: () => void;
}) {
  const initialCompetitionType =
    competitionType ?? event?.competitionType ?? defaultCompetitionSettings.competitionType;
  const isNewPickAndDraw =
    !event && initialCompetitionType === "pick-and-draw";
  const [form, setForm] = useState({
    name: event?.name ?? "",
    description: event?.description ?? "",
    status: event?.status ?? "Upcoming" as EventStatus,
    entryFee: event?.entryFee.toString() ?? "50",
    competitionType: initialCompetitionType,
    registrationOpen: event?.registrationOpen ?? true,
    entriesAllowed: (event?.entriesAllowed ?? 10).toString(),
    maxHeaders: event?.maxHeaders?.toString() ?? "",
    maxHeelers: event?.maxHeelers?.toString() ?? "",
    minDrawsAllowed: (event?.minDrawsAllowed ?? (isNewPickAndDraw ? 4 : 0)).toString(),
    allowRepeatPartners: event?.allowRepeatPartners ?? false,
    handicapTotal: (event?.handicapTotal ?? 20).toString(),
    slideNumber: (event?.slideNumber ?? 10).toString(),
    maxContestantHandicap: (event?.maxContestantHandicap ?? 10).toString(),
    timeLimit: (event?.timeLimit ?? 30).toString(),
    rounds: (event?.rounds ?? 1).toString(),
    shortGoTeams: (event?.shortGoTeams ?? 0).toString(),
    progressiveAfterRound: (event?.progressiveAfterRound ?? 0).toString(),
    addedMoney: (event?.addedMoney ?? 0).toString(),
    incentivePayouts: event?.incentivePayouts ?? false,
    incentiveHandicapTotal: (event?.incentiveHandicapTotal ?? 7).toString(),
    incentiveTeams: (event?.incentiveTeams ?? 1).toString(),
    incentiveAmountPerTeam: (event?.incentiveAmountPerTeam ?? 0).toString(),
    officeCharge: (event?.officeCharge ?? 0).toString(),
    stockCharge: (event?.stockCharge ?? 0).toString(),
    producerFeePercent: (event?.producerFeePercent ?? 50).toString(),
    payoutPercentages: (event?.payoutPercentages ?? [50, 30, 20]).join(", "),
  });
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    onSubmit({
      ...event,
      ...form,
      pickDrawRole: "both",
      id: event?.id ?? uid("event"),
      parentEventId: parent.id,
      date: parent.date,
      startTime: parent.startTime,
      location: parent.location,
      entryFee: Number(form.entryFee) || 0,
      entriesAllowed: Number(form.entriesAllowed) || 1,
      maxHeaders:
        form.competitionType === "round-robin" && Number(form.maxHeaders) > 0
          ? Math.floor(Number(form.maxHeaders))
          : undefined,
      maxHeelers:
        form.competitionType === "round-robin" && Number(form.maxHeelers) > 0
          ? Math.floor(Number(form.maxHeelers))
          : undefined,
      minDrawsAllowed: Math.max(
        0,
        Math.min(
          Math.floor(Number(form.minDrawsAllowed) || 0),
          Number(form.entriesAllowed) || 1,
        ),
      ),
      allowRepeatPartners: form.allowRepeatPartners,
      handicapTotal: Number(form.handicapTotal) || 0,
      slideNumber: Number(form.slideNumber) || 10,
      maxContestantHandicap: Number(form.maxContestantHandicap) || 0,
      timeLimit: Number(form.timeLimit) || 0,
      rounds: Number(form.rounds) || 1,
      shortGoTeams: Math.max(0, Math.floor(Number(form.shortGoTeams) || 0)),
      progressiveAfterRound: Number(form.progressiveAfterRound) || 0,
      addedMoney: Number(form.addedMoney) || 0,
      incentiveHandicapTotal:
        Number(form.incentiveHandicapTotal) || 7,
      incentiveTeams: Math.max(
        1,
        Math.floor(Number(form.incentiveTeams) || 1),
      ),
      incentiveAmountPerTeam: Number(form.incentiveAmountPerTeam) || 0,
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
        <Field label="Roping name"><input required autoCapitalize="characters" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })} placeholder="#10.5 Draw Pot" /></Field>
        <Field label="Front page status"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EventStatus })}><option value="Upcoming">Future</option><option value="Live">Live</option><option value="Complete">Past</option></select></Field>
        <label className="field roping-description"><span>Roping information</span><textarea maxLength={2000} rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Add public details, schedule notes, eligibility information, or anything contestants and spectators should know." /></label>
      </div>
      <h4 className="form-section-title">Competition rules</h4>
      <div className="form-grid">
        <Field label="Entry fee"><input required min="0" type="number" value={form.entryFee} onChange={(e) => setForm({ ...form, entryFee: e.target.value })} /></Field>
        <Field label="Competition type"><select value={form.competitionType} onChange={(e) => setForm({ ...form, competitionType: e.target.value as CompetitionType })}>{competitionTypes.map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}</select></Field>
        <Field label="Maximum runs allowed"><input required type="number" min="1" value={form.entriesAllowed} onChange={(e) => setForm({ ...form, entriesAllowed: e.target.value })} /><small>Total draw and picked runs allowed per contestant.</small></Field>
        {form.competitionType === "round-robin" && (
          <>
            <Field label="Maximum registered Headers"><input type="number" min="1" step="1" value={form.maxHeaders} onChange={(e) => setForm({ ...form, maxHeaders: e.target.value })} placeholder="Unlimited" /><small>Leave blank for no Header capacity limit.</small></Field>
            <Field label="Maximum registered Heelers"><input type="number" min="1" step="1" value={form.maxHeelers} onChange={(e) => setForm({ ...form, maxHeelers: e.target.value })} placeholder="Unlimited" /><small>Leave blank for no Heeler capacity limit.</small></Field>
          </>
        )}
        {form.competitionType === "pick-and-draw" && (
          <Field label="Minimum draws required"><input required type="number" min="0" max={form.entriesAllowed} value={form.minDrawsAllowed} onChange={(e) => setForm({ ...form, minDrawsAllowed: e.target.value })} /><small>Minimum draw entries required before picked teams may be added.</small></Field>
        )}
        <Field label="Max Team Handicap"><input required type="number" min="0" step="0.5" value={form.handicapTotal} onChange={(e) => setForm({ ...form, handicapTotal: e.target.value })} placeholder="10.5" /></Field>
        {form.competitionType === "slide" && (
          <Field label="Slide number"><input required type="number" min="0" max="40" step="0.5" value={form.slideNumber} onChange={(e) => setForm({ ...form, slideNumber: e.target.value })} /><small>In Round 2, each 0.5 handicap above or below this number adds or subtracts 0.5 seconds, capped at 4 seconds.</small></Field>
        )}
        <Field label="Highest contestant handicap"><input required type="number" min="0" step="0.5" value={form.maxContestantHandicap} onChange={(e) => setForm({ ...form, maxContestantHandicap: e.target.value })} /><small>Contestants above this handicap in their entered position cannot participate.</small></Field>
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
        <label className="toggle-row"><input type="checkbox" checked={form.incentivePayouts} onChange={(e) => setForm({ ...form, incentivePayouts: e.target.checked })} /><span><strong>Incentive payout</strong><small>Award the fastest qualifying team or teams from Round 1.</small></span></label>
        {form.incentivePayouts && (
          <>
            <Field label="Incentive team handicap limit"><input required type="number" min="0" max={form.handicapTotal} step="0.5" value={form.incentiveHandicapTotal} onChange={(e) => setForm({ ...form, incentiveHandicapTotal: e.target.value })} /><small>Teams at or below this combined handicap qualify.</small></Field>
            <Field label="Number of incentive teams"><input required type="number" min="1" step="1" value={form.incentiveTeams} onChange={(e) => setForm({ ...form, incentiveTeams: e.target.value })} /><small>The fastest qualifying Round 1 teams receive the award.</small></Field>
            <Field label="Amount per incentive team"><input required type="number" min="0" step="0.01" value={form.incentiveAmountPerTeam} onChange={(e) => setForm({ ...form, incentiveAmountPerTeam: e.target.value })} /></Field>
          </>
        )}
      </div>
      <div className="toggle-grid">
        <label className="toggle-row"><input type="checkbox" checked={form.registrationOpen} onChange={(e) => setForm({ ...form, registrationOpen: e.target.checked })} /><span><strong>Registration open</strong><small>Allow new contestants and teams to enter.</small></span></label>
        <label className="toggle-row"><input type="checkbox" checked={form.allowRepeatPartners} onChange={(e) => setForm({ ...form, allowRepeatPartners: e.target.checked })} /><span><strong>Allow repeat partner runs</strong><small>Permit the same header and heeler pairing to run more than once in Round 1.</small></span></label>
      </div>
      <FormActions onCancel={onCancel} submitLabel={event ? "Save roping" : "Add roping"} />
    </form>
  );
}

function ContestantWaiverStatus({
  contestantId,
  state,
  viewing,
  onViewSignedWaiver,
}: {
  contestantId: string;
  state: ContestantWaiverStatusesState;
  viewing?: boolean;
  onViewSignedWaiver?: (contestantId: string) => void;
}) {
  const status = contestantWaiverStatusPresentation(state, contestantId);
  if (status.kind === "signed") {
    return (
      <span className="contestant-waiver-state signed">
        <span className="contestant-waiver-badge signed">
          <Check size={12} aria-hidden="true" /> Signed
        </span>
        <time
          dateTime={status.signedAt}
          title={status.fullDateLabel}
          aria-label={`Waiver signed ${status.fullDateLabel}`}
        >
          {status.dateLabel}
        </time>
        {onViewSignedWaiver && (
          <button
            type="button"
            className="contestant-waiver-view"
            disabled={viewing}
            onClick={() => onViewSignedWaiver(contestantId)}
          >
            <Eye size={12} aria-hidden="true" />
            {viewing ? "Loading…" : "View waiver"}
          </button>
        )}
      </span>
    );
  }
  if (status.kind === "unavailable") {
    return (
      <span
        className="contestant-waiver-badge unavailable"
        title={status.message}
      >
        {status.label}
      </span>
    );
  }
  return (
    <span className={`contestant-waiver-badge ${status.kind}`}>
      {status.label}
    </span>
  );
}

function Contestants({
  contestants,
  meets,
  events,
  teams,
  registrations,
  onOpenRegistrationDesk,
  onAdd,
  onUpdate,
  onDelete,
  onImport,
}: {
  contestants: Contestant[];
  meets: ArenaMeet[];
  events: ArenaEvent[];
  teams: Team[];
  registrations: EventRegistration[];
  onOpenRegistrationDesk: () => void;
  onAdd: (contestant: Contestant) => void | Promise<unknown>;
  onUpdate: (contestant: Contestant) => void | Promise<unknown>;
  onDelete: (contestantId: string) => void;
  onImport: (contestants: Contestant[]) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Contestant | null>(null);
  const [profile, setProfile] = useState<Contestant | null>(null);
  const [search, setSearch] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const embedded = isWixEmbed();
  const contestantIdsRef = useRef<string[]>([]);
  contestantIdsRef.current = contestants.map(({ id }) => id);
  const contestantIdKey = JSON.stringify(contestantIdsRef.current);
  const waiverRequestRef = useRef(0);
  const waiverResponseRef =
    useRef<ContestantWaiverStatusesResponse | null>(null);
  const [waiverStatuses, setWaiverStatuses] =
    useState<ContestantWaiverStatusesState>({ phase: "loading" });
  const [waiverEvidence, setWaiverEvidence] =
    useState<ContestantSignedWaiverEvidence | null>(null);
  const [waiverEvidenceBusyId, setWaiverEvidenceBusyId] = useState("");
  const [waiverEvidenceError, setWaiverEvidenceError] = useState("");
  const refreshWaiverStatuses = useCallback(async () => {
    const request = waiverRequestRef.current + 1;
    waiverRequestRef.current = request;
    setWaiverStatuses({ phase: "loading" });
    if (!embedded) {
      setWaiverStatuses({
        phase: "error",
        message:
          "Waiver status is available only in the authenticated Wix workspace.",
      });
      return;
    }
    try {
      const response = await loadContestantWaiverStatuses();
      if (waiverRequestRef.current !== request) return;
      waiverResponseRef.current = response;
      setWaiverStatuses(
        readyContestantWaiverStatuses(response, contestantIdsRef.current),
      );
    } catch (error) {
      if (waiverRequestRef.current !== request) return;
      setWaiverStatuses({
        phase: "error",
        message:
          error instanceof Error && error.message
            ? error.message
            : "Waiver status could not be loaded.",
      });
    }
  }, [embedded]);
  useEffect(() => {
    void refreshWaiverStatuses();
    return () => {
      waiverRequestRef.current += 1;
    };
  }, [refreshWaiverStatuses]);
  useEffect(() => {
    const response = waiverResponseRef.current;
    if (!response) return;
    setWaiverStatuses((current) =>
      current.phase === "ready"
        ? readyContestantWaiverStatuses(response, contestantIdsRef.current)
        : current,
    );
  }, [contestantIdKey]);
  const filtered = contestants.filter((contestant) =>
    `${contestant.name} ${contestant.hometown} ${(contestant.horses ?? []).join(" ")} ${contestant.headerHandicap} ${contestant.heelerHandicap}`.toLowerCase().includes(search.toLowerCase()),
  );
  const profileHistory = profile
    ? contestantRopingHistory(
        profile.id,
        events,
        teams,
        registrations,
        contestants,
      )
    : [];
  const profileWins = profileHistory.filter((history) => history.won);
  const profileParticipations = profileHistory.filter(
    (history) => history.participated,
  );
  const contestantName = (id: string) =>
    contestants.find((contestant) => contestant.id === id)?.name ??
    "Unknown contestant";
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
  const editContestant = (contestant: Contestant) => {
    setEditing(contestant);
    setShowForm(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const viewSignedWaiver = async (contestantId: string) => {
    setWaiverEvidenceBusyId(contestantId);
    setWaiverEvidenceError("");
    try {
      if (!embedded) {
        throw new Error(
          "Signed waiver evidence is available only in the authenticated Wix workspace.",
        );
      }
      const evidence = await loadContestantSignedWaiver(contestantId);
      if (!evidence) {
        throw new Error("No current signed waiver was found for this contestant.");
      }
      setWaiverEvidence(evidence);
    } catch (error) {
      setWaiverEvidenceError(
        error instanceof Error
          ? error.message
          : "Signed waiver evidence could not be loaded.",
      );
    } finally {
      setWaiverEvidenceBusyId("");
    }
  };
  const closeSignedWaiver = () => {
    setWaiverEvidence(null);
    setWaiverEvidenceError("");
  };
  const deleteContestant = (contestant: Contestant) => {
    if (
      !window.confirm(
        `Delete ${contestant.name}? This will also delete all of their team entries.`,
      )
    ) {
      return;
    }
    onDelete(contestant.id);
    if (editing?.id === contestant.id) setEditing(null);
  };
  const contestantActions = (contestant: Contestant) => (
    <span className="row-actions">
      <button
        title="Edit contestant"
        aria-label={`Edit ${contestant.name}`}
        onClick={() => editContestant(contestant)}
      >
        <Pencil size={15} />
      </button>
      <button
        className="delete-action"
        title="Delete contestant"
        aria-label={`Delete ${contestant.name}`}
        onClick={() => deleteContestant(contestant)}
      >
        <Trash2 size={15} />
      </button>
    </span>
  );

  return (
    <>
      <PageIntro title="Contestants" text="Maintain the rider roster used to build teams for every event." button="Add contestant" onClick={() => { setEditing(null); setShowForm((open) => !open); }} />
      {profile && (
        <div
          className="contestant-profile-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setProfile(null);
          }}
        >
          <section
            className="contestant-profile-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contestant-profile-name"
          >
            <div className="contestant-profile-header">
              <div className="contestant-profile-identity">
                {profile.photo
                  ? <img src={profile.photo} alt="" />
                  : <i>{initials(profile.name)}</i>}
                <div>
                  <span>Contestant profile</span>
                  <h2 id="contestant-profile-name">{profile.name}</h2>
                  <p>{profile.role} · Header #{profile.headerHandicap} · Heeler #{profile.heelerHandicap}</p>
                </div>
              </div>
              <button className="icon-action" title="Close profile" onClick={() => setProfile(null)}><X size={18} /></button>
            </div>
            <div className="contestant-profile-content">
              <div className="contestant-profile-stats">
                <span><strong>{profileHistory.length}</strong> Ropings registered</span>
                <span><strong>{profileParticipations.length}</strong> Ropings participated</span>
                <span className="winner"><strong>{profileWins.length}</strong> Competition wins</span>
              </div>
              <div className="contestant-profile-details">
                <span><small>Email</small><strong>{profile.email || "Not provided"}</strong></span>
                <span><small>Phone</small><strong>{profile.phone || "Not provided"}</strong></span>
                <span><small>Hometown</small><strong>{profile.hometown || "Not provided"}</strong></span>
                <span><small>Horses</small><strong>{profile.horses?.join(", ") || "None listed"}</strong></span>
              </div>
              <div className="contestant-history-heading">
                <div><h3>Roping history</h3><p>Registrations, participation, and published official results.</p></div>
              </div>
              <div className="contestant-history-list">
                {profileHistory.map((history) => {
                  const meet = meets.find(
                    (item) => item.id === history.event.parentEventId,
                  );
                  const uniquePartners = [
                    ...new Set(
                      history.teams.map((team) =>
                        contestantName(
                          team.headerId === profile.id
                            ? team.heelerId
                            : team.headerId,
                        ),
                      ),
                    ),
                  ];
                  const roles = [
                    ...new Set([
                      ...history.registrations.map((entry) => entry.role),
                      ...history.teams.map((team) =>
                        team.headerId === profile.id ? "Header" : "Heeler",
                      ),
                    ]),
                  ];
                  return (
                    <article className="contestant-history-row" key={history.event.id}>
                      <div className="contestant-history-date">
                        <strong>{new Date(`${history.event.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong>
                        <small>{new Date(`2000-01-01T${history.event.startTime}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</small>
                      </div>
                      <div>
                        <h4>{history.event.name}</h4>
                        <p>{meet?.name ? `${meet.name} · ` : ""}{roles.join(" / ") || "Team entry"}{uniquePartners.length ? ` · Partner: ${uniquePartners.join(", ")}` : ""}</p>
                      </div>
                      <div className="contestant-history-statuses">
                        {history.won && <span className="tag winner"><Trophy size={12} /> Winner</span>}
                        {!history.won && history.bestPlace && <span className="tag complete">Place #{history.bestPlace}</span>}
                        <span className={`tag ${history.participated ? "complete" : "neutral"}`}>{history.participated ? "Participated" : "Registered"}</span>
                      </div>
                    </article>
                  );
                })}
                {!profileHistory.length && <EmptyState text="This contestant has no roping registrations yet." />}
              </div>
            </div>
          </section>
        </div>
      )}
      {(showForm || editing) && (
        <ContestantForm
          contestant={editing ?? undefined}
          onOpenRegistrationDesk={onOpenRegistrationDesk}
          onSubmit={async (rider) => {
            if (editing) await onUpdate(rider);
            else await onAdd(rider);
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
      <div className="panel table-panel contestant-roster-panel">
        <div className="table-toolbar">
          <div>
            <h3>Rider roster</h3>
            <p>{contestants.length} contestants on file</p>
            {waiverStatuses.phase === "error" && (
              <p className="waiver-load-message" role="status">
                {embedded
                  ? "Waiver status unavailable. Use Retry waivers to try again."
                  : "Waiver status is available only in the authenticated Wix workspace."}
              </p>
            )}
            {waiverEvidenceError && (
              <p className="waiver-load-message" role="status">
                {waiverEvidenceError}
              </p>
            )}
          </div>
          <div className="roster-actions">
            <label className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search riders" /></label>
            <button
              className="secondary waiver-refresh-button"
              disabled={!embedded || waiverStatuses.phase === "loading"}
              onClick={() => { void refreshWaiverStatuses(); }}
              title={
                embedded
                  ? "Reload current waiver status from Wix"
                  : "Waiver status is available only in Wix"
              }
            >
              <RefreshCw size={16} />
              {waiverStatuses.phase === "error" ? "Retry waivers" : "Refresh waivers"}
            </button>
            <button className="secondary" disabled={!contestants.length} onClick={downloadBackup}><Download size={16} /> Download database</button>
            <label className="secondary import-database-button"><Upload size={16} /> Import database<input type="file" accept="application/json,text/plain,.json,.txt" onChange={(event) => { void restoreBackup(event.target.files?.[0]); event.target.value = ""; }} /></label>
          </div>
        </div>
        <div className="data-table contestant-table">
          <div className="table-row table-header"><span>Contestant</span><span>Header handicap</span><span>Heeler handicap</span><span>Hometown</span><span>Phone</span><span>Waiver</span><span>Actions</span></div>
          {filtered.map((contestant) => (
            <div className="table-row" key={contestant.id}>
              <span className="person">
                {contestant.photo
                  ? <img className="profile-photo" src={contestant.photo} alt="" />
                  : <i>{initials(contestant.name)}</i>}
                <button className="contestant-name-button" onClick={() => setProfile(contestant)}>{contestant.name}</button>
              </span>
              <span>{contestant.headerHandicap}</span>
              <span>{contestant.heelerHandicap}</span>
              <span>{contestant.hometown || "—"}</span>
              <span>{contestant.phone || "—"}</span>
              <ContestantWaiverStatus
                contestantId={contestant.id}
                state={waiverStatuses}
                viewing={waiverEvidenceBusyId === contestant.id}
                onViewSignedWaiver={viewSignedWaiver}
              />
              {contestantActions(contestant)}
            </div>
          ))}
        </div>
        <div className="contestant-roster-cards" aria-label="Rider roster">
          {filtered.map((contestant) => (
            <article className="contestant-roster-card" key={contestant.id}>
              <header>
                <span className="person">
                  {contestant.photo
                    ? <img className="profile-photo" src={contestant.photo} alt="" />
                    : <i>{initials(contestant.name)}</i>}
                  <button className="contestant-name-button" onClick={() => setProfile(contestant)}>{contestant.name}</button>
                </span>
                {contestantActions(contestant)}
              </header>
              <dl>
                <div><dt>Header handicap</dt><dd>{contestant.headerHandicap}</dd></div>
                <div><dt>Heeler handicap</dt><dd>{contestant.heelerHandicap}</dd></div>
                <div><dt>Hometown</dt><dd>{contestant.hometown || "—"}</dd></div>
                <div><dt>Phone</dt><dd>{contestant.phone || "—"}</dd></div>
                <div className="contestant-card-waiver">
                  <dt>Waiver</dt>
                  <dd>
                    <ContestantWaiverStatus
                      contestantId={contestant.id}
                      state={waiverStatuses}
                      viewing={waiverEvidenceBusyId === contestant.id}
                      onViewSignedWaiver={viewSignedWaiver}
                    />
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </div>
      {waiverEvidence && (
        <SignedWaiverEvidenceDialog
          evidence={waiverEvidence}
          onClose={closeSignedWaiver}
        />
      )}
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
    const horses = normalizeHorseNames(contestant.horses);
    if (
      typeof contestant.id !== "string" ||
      !contestant.id ||
      typeof contestant.name !== "string" ||
      !contestant.name.trim() ||
      !["Header", "Heeler", "Both"].includes(contestant.role ?? "") ||
      (contestant.headerHandicap !== undefined &&
        (typeof contestant.headerHandicap !== "number" ||
          !Number.isFinite(contestant.headerHandicap))) ||
      (contestant.heelerHandicap !== undefined &&
        (typeof contestant.heelerHandicap !== "number" ||
          !Number.isFinite(contestant.heelerHandicap)))
    ) {
      throw new Error(`Contestant ${index + 1} is not valid.`);
    }
    if (horses.length > 20 || horses.some((horse) => horse.length > 100)) {
      throw new Error(`Contestant ${index + 1} has invalid horse names.`);
    }
    return {
      id: contestant.id,
      name: contestant.name.trim(),
      role: contestant.role as Contestant["role"],
      headerHandicap:
        contestant.headerHandicap && contestant.headerHandicap > 0
          ? contestant.headerHandicap
          : 3,
      heelerHandicap:
        contestant.heelerHandicap && contestant.heelerHandicap > 0
          ? contestant.heelerHandicap
          : 3,
      photo: typeof contestant.photo === "string" ? contestant.photo : "",
      phone: typeof contestant.phone === "string" ? contestant.phone : "",
      hometown:
        typeof contestant.hometown === "string" ? contestant.hometown : "",
      horses,
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
    : 3;
  const heelerHandicap = record.heelerHandicap?.trim()
    ? Number(record.heelerHandicap)
    : 3;
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
  onOpenRegistrationDesk,
  onSubmit,
  onCancel,
}: {
  contestant?: Contestant;
  onOpenRegistrationDesk: () => void;
  onSubmit: (contestant: Contestant) => void | Promise<unknown>;
  onCancel: () => void;
}) {
  const nameParts = contestant?.name.trim().split(/\s+/) ?? [];
  const [form, setForm] = useState({
    firstName: nameParts.slice(0, -1).join(" ") || nameParts[0] || "",
    lastName: nameParts.length > 1 ? nameParts[nameParts.length - 1] : "",
    headerHandicap: contestant?.headerHandicap.toString() ?? "3",
    heelerHandicap: contestant?.heelerHandicap.toString() ?? "3",
    photo: contestant?.photo ?? "",
    phone: contestant?.phone ?? "",
    hometown: contestant?.hometown ?? "",
    email: contestant?.email ?? "",
    horses: contestant?.horses ?? [],
  });
  const [horseName, setHorseName] = useState("");
  const [clearPhoto, setClearPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [confirmLoginPin, setConfirmLoginPin] = useState("");
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
      setClearPhoto(false);
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
      name: `${form.firstName.trim()} ${form.lastName.trim()}`.trim().toUpperCase(),
      role: contestant?.role ?? "Both",
      headerHandicap: Number(form.headerHandicap),
      heelerHandicap: Number(form.heelerHandicap),
      phone: form.phone,
      hometown: form.hometown.trim().replace(/\s+/g, " ").toUpperCase(),
      email: form.email.trim().toLowerCase(),
      membershipNumber: contestant?.membershipNumber ?? "",
      categoryNumber: contestant?.categoryNumber ?? "",
      photo: form.photo,
      clearPhoto,
      horses: normalizeHorseNames(form.horses),
    };
    if (loginPin || confirmLoginPin) {
      if (!form.email.trim()) {
        setLoginError("Enter an email before configuring a contestant PIN.");
        return;
      }
      if (!/^\d{4}$/.test(loginPin)) {
        setLoginError("The contestant PIN must contain exactly four digits.");
        return;
      }
      if (loginPin !== confirmLoginPin) {
        setLoginError("The contestant PIN confirmation does not match.");
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
    try {
      await onSubmit(updatedContestant);
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : "The contestant profile could not be saved.",
      );
    }
  };
  return (
    <form className="form-panel" onSubmit={submit}>
      <div className="form-heading"><div><h3>{contestant ? "Edit contestant and account" : "Add contestant and account"}</h3><p>{contestant ? "Update this rider's profile, handicaps, and login access." : "Create a rider profile and optional contestant login."}</p></div><button type="button" className="icon-button" onClick={onCancel}><X size={20} /></button></div>
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
          {form.photo && <button type="button" className="remove-photo" onClick={() => { setForm({ ...form, photo: "" }); setClearPhoto(true); }}>Remove</button>}
          {photoError && <span className="field-error">{photoError}</span>}
        </div>
      </div>
      <div className="form-grid">
        <Field label="First Name"><input required autoCapitalize="characters" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value.toUpperCase() })} placeholder="First name" /></Field>
        <Field label="Last Name"><input required autoCapitalize="characters" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value.toUpperCase() })} placeholder="Last name" /></Field>
        <Field label="Header Handicap"><input required type="number" min="0" step="0.5" value={form.headerHandicap} onChange={(e) => setForm({ ...form, headerHandicap: e.target.value })} placeholder="3" /></Field>
        <Field label="Heeler Handicap"><input required type="number" min="0" step="0.5" value={form.heelerHandicap} onChange={(e) => setForm({ ...form, heelerHandicap: e.target.value })} placeholder="3" /></Field>
        <Field label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="555-0123" /></Field>
        <Field label="Hometown"><input autoCapitalize="characters" value={form.hometown} onChange={(e) => setForm({ ...form, hometown: e.target.value.toUpperCase() })} placeholder="City, State" /></Field>
      </div>
      <div className="horse-editor">
        <h4>Horses</h4>
        <p>Add every horse associated with this contestant.</p>
        <div className="horse-entry">
          <input
            maxLength={100}
            value={horseName}
            autoCapitalize="characters"
            onChange={(event) => setHorseName(event.target.value.toUpperCase())}
            placeholder="Horse name"
          />
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const name = horseName.trim().replace(/\s+/g, " ").toUpperCase();
              if (
                !name ||
                form.horses.length >= 20 ||
                form.horses.some((horse) => horse.toLowerCase() === name.toLowerCase())
              ) return;
              setForm({ ...form, horses: [...form.horses, name] });
              setHorseName("");
            }}
          >
            <Plus size={16} /> Add horse
          </button>
        </div>
        <div className="horse-list">
          {form.horses.map((horse) => (
            <span key={horse}>
              <strong>{horse}</strong>
              <button
                type="button"
                title={`Delete ${horse}`}
                onClick={() =>
                  setForm({
                    ...form,
                    horses: form.horses.filter((name) => name !== horse),
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </span>
          ))}
          {!form.horses.length && <small>No horses added.</small>}
        </div>
      </div>
      <h4 className="form-section-title">Contestant account</h4>
      <p className="contestant-account-help">
        Set the email and four-digit PIN the contestant will use for online entry and the contestant portal. Leave both PIN fields blank to keep the current login unchanged.
      </p>
      <div className="contestant-waiver-shortcut">
        <p>
          Waiver signing is handled in Registration Desk only. Signed waiver
          evidence is available to admins in Wix Data collection{" "}
          <strong>ArenaWaiverSignatures</strong>.
        </p>
        <button
          type="button"
          className="secondary"
          onClick={onOpenRegistrationDesk}
        >
          <ClipboardPen size={16} /> Open Registration Desk to sign waiver
        </button>
      </div>
      <div className="form-grid contestant-account-grid">
        <Field label="Login Email"><input type="email" autoComplete="off" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value.toLowerCase() }); setLoginError(""); }} placeholder="rider@example.com" /></Field>
        <Field label={contestant ? "Set or Reset 4-digit PIN" : "Set 4-digit PIN"}><input type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="new-password" value={loginPin} onChange={(e) => { setLoginPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setLoginError(""); }} placeholder="••••" /></Field>
        <Field label="Confirm 4-digit PIN"><input type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="new-password" value={confirmLoginPin} onChange={(e) => { setConfirmLoginPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setLoginError(""); }} placeholder="••••" /></Field>
      </div>
      {loginError && <div className="form-error">{loginError}</div>}
      <FormActions onCancel={onCancel} submitLabel={contestant ? "Save changes" : "Add contestant"} />
    </form>
  );
}

function SignedWaiverEvidenceDialog({
  evidence,
  onClose,
}: {
  evidence: ContestantSignedWaiverEvidence;
  onClose: () => void;
}) {
  const signedAt = new Date(evidence.signedAt);
  const signedLabel = Number.isNaN(signedAt.getTime())
    ? evidence.signedAt
    : signedAt.toLocaleString("en-US", {
        dateStyle: "full",
        timeStyle: "long",
      });
  return (
    <div
      className="contestant-profile-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="contestant-profile-dialog signed-waiver-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signed-waiver-title"
      >
        <div className="contestant-profile-header">
          <div className="contestant-profile-identity">
            <i><ClipboardPen size={22} /></i>
            <div>
              <span>Read-only signed waiver evidence</span>
              <h2 id="signed-waiver-title">{evidence.contestantName}</h2>
              <p>Signer: {evidence.signerName}</p>
            </div>
          </div>
          <button className="icon-action" title="Close waiver" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="signed-waiver-body">
          <div className="signed-waiver-meta">
            <span><small>Signed at</small><strong>{signedLabel}</strong></span>
            <span><small>Event ID</small><strong>{evidence.eventId}</strong></span>
            <span><small>Waiver version</small><strong>{evidence.waiverVersion}</strong></span>
            <span><small>Evidence collection</small><strong>ArenaWaiverSignatures</strong></span>
          </div>
          <div className="signed-waiver-signature">
            <h3>Signature</h3>
            <img
              src={evidence.signatureDataUrl}
              alt={`Signature captured for ${evidence.signerName}`}
            />
          </div>
          <div className="signed-waiver-text">
            <h3>{evidence.waiverTitle}</h3>
            <pre>{evidence.waiverText}</pre>
          </div>
        </div>
      </section>
    </div>
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
}: {
  event?: ArenaEvent;
  teams: Team[];
  registrations: EventRegistration[];
  contestants: Contestant[];
  onAdd: (team: Team) => void;
  onUpdateTeam: (team: Team) => void;
  onDeleteTeam: (teamId: string) => void;
  onAddRegistration: (registration: EventRegistration) => Promise<unknown>;
  onUpdateRegistration: (registration: EventRegistration) => void;
  onDeleteRegistration: (registrationId: string) => void;
  onCommitDraw: (eventId: string, teams: Team[]) => void;
  onUpdateEvent: (event: ArenaEvent) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [entryMode, setEntryMode] = useState<"team" | "registration">("team");
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [message, setMessage] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [draftDraw, setDraftDraw] = useState<Team[] | null>(null);
  const [draggedTeamId, setDraggedTeamId] = useState("");
  const registrationSubmissionInFlight = useRef(false);
  const eventTeams = teams.filter((team) => team.eventId === event?.id).sort((a, b) => a.drawPosition - b.drawPosition);
  const eventRegistrations = registrations.filter(
    (entry) => entry.eventId === event?.id && !entry.sourceTeamId,
  );
  const headerEntryCount = eventRegistrations
    .filter((entry) => entry.role === "Header" && entry.status === "entered" && entryClearedForDraw(entry))
    .reduce((total, entry) => total + entry.entries, 0);
  const heelerEntryCount = eventRegistrations
    .filter((entry) => entry.role === "Heeler" && entry.status === "entered" && entryClearedForDraw(entry))
    .reduce((total, entry) => total + entry.entries, 0);
  const rider = (id: string) => contestants.find((item) => item.id === id);
  const visibleDrawTeams = draftDraw ?? eventTeams;
  const repeatedTeamKeys = repeatedTeamPairKeys(visibleDrawTeams);
  const hasFreeRuns = visibleDrawTeams.some(
    (team) => team.headerFreeRun || team.heelerFreeRun,
  );
  const hasRepeatEntries = repeatedTeamKeys.size > 0;
  const displayedTeams = visibleDrawTeams.filter((team) =>
    `${rider(team.headerId)?.name ?? ""} ${rider(team.heelerId)?.name ?? ""}`
      .toLowerCase()
      .includes(teamSearch.toLowerCase()),
  );
  const individualRegistration =
    event?.competitionType === "draw-pot" || event?.competitionType === "round-robin";
  const usesDrawPool =
    individualRegistration ||
    event?.competitionType === "pick-and-draw" ||
    event?.competitionType === "slide";
  const usesMixedTeams =
    event?.competitionType === "pick-and-draw" ||
    event?.competitionType === "slide";
  const canEdit = Boolean(event?.registrationOpen && !event?.drawLocked);
  const format = competitionTypes.find((type) => type.id === event?.competitionType);

  useEffect(() => {
    setDraftDraw(null);
    setDraggedTeamId("");
    setMessage("");
  }, [event?.id]);

  const dropDraftTeam = (targetTeamId: string) => {
    if (!draftDraw || !draggedTeamId) return;
    const movingTeam = draftDraw.find((team) => team.id === draggedTeamId);
    const targetTeam = draftDraw.find((team) => team.id === targetTeamId);
    if (
      movingTeam &&
      targetTeam &&
      Boolean(movingTeam.generated) !== Boolean(targetTeam.generated)
    ) {
      setMessage(
        "Draw Pot teams must remain before Picked Teams. Reorder teams within their own section.",
      );
      setDraggedTeamId("");
      return;
    }
    setDraftDraw((current) =>
      current
        ? reorderDraftDrawTeams(current, draggedTeamId, targetTeamId)
        : current,
    );
    setDraggedTeamId("");
  };

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
    if (
      event?.competitionType === "pick-and-draw" &&
      pickedTeamRidersMissingFromDraw(
        eventRegistrations,
        event.id,
        team,
      ).length
    ) {
      setMessage(
        "Every rider on a picked team must already be entered in the Draw Pot.",
      );
      return;
    }
    const handicap = teamHandicapTotal(team.headerId, team.heelerId, contestants);
    const header = rider(team.headerId);
    const heeler = rider(team.heelerId);
    const horseBelongsTo = (horseName: string | undefined, contestant?: Contestant) =>
      !horseName ||
      contestant?.horses?.some(
        (horse) => horse.toLocaleLowerCase() === horseName.toLocaleLowerCase(),
      );
    if (!horseBelongsTo(team.headerHorseName, header)) {
      setMessage("Choose a horse saved on the Header contestant profile.");
      return;
    }
    if (!horseBelongsTo(team.heelerHorseName, heeler)) {
      setMessage("Choose a horse saved on the Heeler contestant profile.");
      return;
    }
    if (
      event &&
      (!contestantEligibleForRole(event, header, "Header") ||
        !contestantEligibleForRole(event, heeler, "Heeler"))
    ) {
      setMessage(
        `Each contestant must be a #${event.maxContestantHandicap} or lower in the entered position.`,
      );
      return;
    }
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
        event.competitionType === "draw-pot" ||
        event.competitionType === "slide"
          ? "Register at least one eligible header and heeler before drawing."
          : event.competitionType === "pick-and-draw"
            ? "No eligible draw teams could be made. Confirm paid Header and Heeler entries, check the handicap limit, and enable repeat partner runs when entries must reuse partners."
            : "Add eligible contestants or teams before generating the draw.",
      );
      return;
    }
    if (event.competitionType === "pick-and-draw") {
      const expectedDrawTeams = Math.max(headerEntryCount, heelerEntryCount);
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
    setDraftDraw(generated);
    setMessage(
      `Draft draw created with ${generated.length} teams. Review the order, then approve it before opening Run Desk.`,
    );
  };
  const approveDraw = () => {
    if (!event || !draftDraw?.length) return;
    onCommitDraw(event.id, draftDraw);
    setDraftDraw(null);
    setMessage(
      `Draw approved and locked. ${draftDraw.length} teams were sent to Run Desk.`,
    );
  };
  const restoreDraw = (teams: Team[]) => {
    if (!event) return;
    const eligibleTeams = teams.filter((team) =>
      teamEligibleForCompetition(event, team, contestants),
    );
    const restored: Team[] = eligibleTeams.map((team) => ({
        ...team,
        id: uid("team"),
        status: "ready",
        rawTime: null,
        penalties: 0,
        rolled: false,
      }));
    setDraftDraw(restored);
    const excluded = teams.length - eligibleTeams.length;
    setMessage(
      excluded
        ? `Draft restored without ${excluded} team${excluded === 1 ? "" : "s"} that exceed current handicap limits. Review and approve it.`
        : `Draft restored with ${eligibleTeams.length} teams. Review and approve it.`,
    );
  };

  return (
    <>
      <PageIntro title="Teams & draw" text={event ? `${competitionName(event.competitionType)} workflow for ${event.name}.` : "Create an event before adding teams."} />
      {event && (
        <div className="format-banner">
          <span className="competition-icon">{event.competitionType === "draw-pot" ? <Dices size={21} /> : event.competitionType === "pick-only" ? <Handshake size={21} /> : event.competitionType === "pick-and-draw" ? <GitFork size={21} /> : event.competitionType === "slide" ? <Gauge size={21} /> : <Repeat2 size={21} />}</span>
          <div className="format-copy"><strong>{format?.name}</strong><p>{format?.description}</p></div>
          <div className="format-entry-actions">
            {usesDrawPool && (
              <button className="secondary" disabled={!canEdit} onClick={() => { setEditingTeam(null); setEntryMode("registration"); setShowForm(true); }}>
                <Dices size={15} /> Enter Draw
              </button>
            )}
            {!individualRegistration && (
              <button className="primary" disabled={!canEdit} onClick={() => { setEditingTeam(null); setEntryMode("team"); setShowForm(true); }}>
                <Handshake size={15} /> Enter Picked Team
              </button>
            )}
          </div>
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
          onSubmit={async (registration) => {
            if (registrationSubmissionInFlight.current) return;
            const contestant = rider(registration.contestantId);
            if (!contestantEligibleForRole(event, contestant, registration.role)) {
              setMessage(
                `${contestant?.name ?? "Contestant"} exceeds the #${event.maxContestantHandicap} contestant limit for ${registration.role}.`,
              );
              return;
            }
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
            try {
              assertRoundRobinRoleCapacity(
                event,
                eventRegistrations,
                registration.role,
                registration.entries,
              );
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : "Registration is full.",
              );
              return;
            }
            try {
              registrationSubmissionInFlight.current = true;
              await onAddRegistration(registration);
              setShowForm(false);
              setMessage("");
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "The Draw registration could not be saved.",
              );
            } finally {
              registrationSubmissionInFlight.current = false;
            }
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
              <span><strong>{headerEntryCount}</strong> Draw-cleared header entries</span>
              <span><strong>{heelerEntryCount}</strong> Draw-cleared heeler entries</span>
              {event.competitionType === "pick-and-draw" && (
                <span><strong>{Math.max(headerEntryCount, heelerEntryCount)}</strong> Round 1 draw teams</span>
              )}
              {event.competitionType === "round-robin" && (
                <>
                  {(["Header", "Heeler"] as const).map((role) => {
                    const capacity = roundRobinRoleCapacity(event, eventRegistrations, role);
                    return (
                      <span className={capacity.full ? "free-total" : ""} key={role}>
                        <strong>{capacity.registered}{capacity.maximum === null ? "" : ` / ${capacity.maximum}`}</strong> {role}{capacity.full ? " FULL" : ""}
                      </span>
                    );
                  })}
                  <span><strong>{eventRegistrations.filter((entry) => entry.role === "Header" && entry.status === "entered" && entryClearedForDraw(entry)).length * eventRegistrations.filter((entry) => entry.role === "Heeler" && entry.status === "entered" && entryClearedForDraw(entry)).length}</strong> Round Robin teams</span>
                </>
              )}
              {event.competitionType === "draw-pot" && headerEntryCount !== heelerEntryCount && (
                <span className="free-total"><strong>{Math.abs(headerEntryCount - heelerEntryCount)}</strong> Free {headerEntryCount > heelerEntryCount ? "heeler" : "header"} run{Math.abs(headerEntryCount - heelerEntryCount) === 1 ? "" : "s"}</span>
              )}
            </div>
          </div>
          <div className="registration-list">
            {eventRegistrations.map((registration) => (
              <div className="registration-row" key={registration.id}>
                <span className="person"><i>{initials(rider(registration.contestantId)?.name ?? "")}</i><span><strong>{rider(registration.contestantId)?.name}</strong><small>{registration.role} · {registration.entries} entr{registration.entries === 1 ? "y" : "ies"}{registration.horseName ? ` · Horse: ${registration.horseName}` : ""}{registration.sourceTeamId ? " · Picked team" : ""}{registration.paid === false && registration.paymentMethod === "tab" ? " · Open tab" : ""}</small></span></span>
                <span className={`tag ${registration.status === "entered" ? "complete" : registration.status === "waitlist" ? "amber" : "no-time"}`}>{registration.status}</span>
                <button className={registration.paid === false ? "secondary small-action" : "selected-button small-action"} disabled={event.drawLocked} onClick={() => onUpdateRegistration({ ...registration, paid: registration.paid === false })}>{registration.paid === false ? (registration.paymentMethod === "tab" ? "Open tab · mark paid" : "Mark paid") : "Paid"}</button>
                <button className={registration.checkedIn ? "selected-button small-action" : "secondary small-action"} disabled={event.drawLocked} onClick={() => onUpdateRegistration({ ...registration, checkedIn: !registration.checkedIn })}>{registration.checkedIn ? <><Check size={14} /> Checked in</> : "Check in"}</button>
                <button className="secondary small-action" disabled={event.drawLocked} onClick={() => {
                  if (registration.status === "scratched") {
                    try {
                      assertRoundRobinRoleCapacity(
                        event,
                        eventRegistrations,
                        registration.role,
                        registration.entries,
                      );
                    } catch (error) {
                      setMessage(
                        error instanceof Error ? error.message : "Registration is full.",
                      );
                      return;
                    }
                  }
                  onUpdateRegistration({
                    ...registration,
                    status: registration.status === "scratched" ? "entered" : "scratched",
                  });
                }}>{registration.status === "scratched" ? "Restore" : "Scratch"}</button>
                <button className="icon-action delete-action small-icon" disabled={event.drawLocked} title="Delete registration" onClick={() => onDeleteRegistration(registration.id)}><Trash2 size={14} /></button>
              </div>
            ))}
            {!eventRegistrations.length && <EmptyState text="No individual riders registered yet." />}
          </div>
        </div>
      )}
      <div className="panel draw-sheet">
        <div className="table-toolbar">
          <div>
            <h3>{draftDraw ? "Draft draw — review before approval" : "Approved draw order"}</h3>
            <p>{visibleDrawTeams.length} teams · {event?.drawHistory.length ?? 0} approved version{event?.drawHistory.length === 1 ? "" : "s"}{draftDraw ? " · Drag teams to reorder before approval" : ""}</p>
          </div>
          <div className="toolbar-actions">
            <label className="search draw-search"><Search size={15} /><input value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} placeholder="Search teams" /></label>
            <button className="secondary" disabled={!visibleDrawTeams.length} onClick={() => event && exportDrawCsv(event, visibleDrawTeams, contestants)}><Download size={16} /> CSV</button>
            <button className="secondary" disabled={!visibleDrawTeams.length} onClick={() => window.print()}><Printer size={16} /> Print / PDF</button>
            {event && <button className="secondary" onClick={() => onUpdateEvent({ ...event, drawLocked: !event.drawLocked })}>{event.drawLocked ? <><Unlock size={16} /> Unlock</> : <><Lock size={16} /> Lock draw</>}</button>}
            {draftDraw && (
              <button className="secondary" onClick={() => setDraftDraw(null)}>
                <X size={16} /> Discard draft
              </button>
            )}
            <button
              className={draftDraw ? "secondary" : "primary"}
              disabled={
                !event ||
                event.drawLocked ||
                (event.competitionType === "pick-only" && !eventTeams.length)
              }
              onClick={generateDraw}
            >
              {draftDraw ? <RefreshCw size={16} /> : <Dices size={16} />}
              {draftDraw ? "Regenerate draft" : "Generate draft"}
            </button>
            {draftDraw && (
              <button className="primary" onClick={approveDraw}>
                <Check size={16} /> Approve and send to Run Desk
              </button>
            )}
          </div>
        </div>
        <div className="draw-list">
          {(hasFreeRuns || hasRepeatEntries) && (
            <div className="draw-color-legend no-print">
              {hasFreeRuns && <span className="free-run-key">Free Run</span>}
              {hasRepeatEntries && <span className="repeat-entry-key">Repeated team</span>}
            </div>
          )}
          {usesMixedTeams &&
            displayedTeams.some((team) => team.generated) && (
              <div className="draw-section-label">Draw Pot Teams</div>
            )}
          {displayedTeams.map((team, index) => (
            <Fragment key={team.id}>
              {usesMixedTeams &&
                !team.generated &&
                (index === 0 || displayedTeams[index - 1]?.generated) && (
                  <div className="draw-section-label picked">
                    Picked Teams — run after the final draw team
                  </div>
                )}
            <div
              className={`draw-row ${team.scratched ? "scratched-row" : ""} ${team.headerFreeRun || team.heelerFreeRun ? "free-run-row" : ""} ${repeatedTeamKeys.has(`${team.headerId}|${team.heelerId}`) ? "repeat-team-row" : ""} ${draftDraw ? "draggable-draw-row" : ""} ${draggedTeamId === team.id ? "dragging" : ""}`}
              draggable={Boolean(draftDraw && !teamSearch)}
              onDragStart={(dragEvent: DragEvent<HTMLDivElement>) => {
                if (!draftDraw || teamSearch) return;
                setDraggedTeamId(team.id);
                dragEvent.dataTransfer.effectAllowed = "move";
                dragEvent.dataTransfer.setData("text/plain", team.id);
              }}
              onDragOver={(dragEvent) => {
                if (draftDraw && draggedTeamId && !teamSearch) {
                  dragEvent.preventDefault();
                  dragEvent.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(dragEvent) => {
                dragEvent.preventDefault();
                dropDraftTeam(team.id);
              }}
              onDragEnd={() => setDraggedTeamId("")}
            >
              <span className="draw-number large">
                {draftDraw && !teamSearch && <GripVertical className="draw-drag-handle" size={16} />}
                {team.drawPosition}
              </span>
              <div className="person"><i>{initials(rider(team.headerId)?.name ?? "")}</i><span><strong>{rider(team.headerId)?.name} {team.headerFreeRun && <b className="free-run-symbol" title="Free run — not eligible for jackpot payout">FR</b>}</strong><small>Header · Entry {team.headerEntryNumber ?? 1}{team.headerHorseName ? ` · Horse: ${team.headerHorseName}` : ""}</small></span></div>
              <span className="pair-mark">&</span>
              <div className="person"><i>{initials(rider(team.heelerId)?.name ?? "")}</i><span><strong>{rider(team.heelerId)?.name} {team.heelerFreeRun && <b className="free-run-symbol" title="Free run — not eligible for jackpot payout">FR</b>}</strong><small>Heeler · Entry {team.heelerEntryNumber ?? 1}{team.heelerHorseName ? ` · Horse: ${team.heelerHorseName}` : ""}</small></span></div>
              <span className="draw-status">{(team.headerFreeRun || team.heelerFreeRun) && <span className="tag free-run-tag">Free Run</span>}{repeatedTeamKeys.has(`${team.headerId}|${team.heelerId}`) && <span className="tag repeat-team-tag">Repeat Team</span>}<span className={`tag ${team.scratched ? "no-time" : team.rolled ? "amber" : team.status === "ready" ? "neutral" : team.status}`}>{team.scratched ? "Scratched" : team.rolled ? "Rolled" : team.status === "no-time" ? "No time" : team.status}</span><small>HC {teamHandicapTotal(team.headerId, team.heelerId, contestants)}{event?.rounds && event.rounds > 1 ? ` · Round ${team.round}` : ""}{team.paid === false && team.paymentMethod === "tab" ? " · Open tab" : ""}</small></span>
              <span className="row-actions no-print">
                {!team.generated && team.paid === false && (
                  <button
                    title={team.paymentMethod === "tab" ? "Open tab · mark paid" : "Mark paid"}
                    disabled={event?.drawLocked}
                    onClick={() => onUpdateTeam({ ...team, paid: true })}
                  >
                    <CircleDollarSign size={15} />
                  </button>
                )}
                <button title={team.checkedIn ? "Checked in" : "Check in"} disabled={event?.drawLocked} onClick={() => onUpdateTeam({ ...team, checkedIn: !team.checkedIn })}>{team.checkedIn ? <Check size={15} /> : <UserRound size={15} />}</button>
                {!team.generated && <button title="Edit team" disabled={!canEdit} onClick={() => { setEditingTeam(team); setShowForm(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Pencil size={15} /></button>}
                <button title={team.scratched ? "Restore team" : "Scratch team"} disabled={event?.drawLocked} onClick={() => onUpdateTeam({ ...team, scratched: !team.scratched })}><X size={15} /></button>
                <button className="delete-action" title="Delete team" disabled={!canEdit} onClick={() => onDeleteTeam(team.id)}><Trash2 size={15} /></button>
              </span>
            </div>
            </Fragment>
          ))}
          {!displayedTeams.length && <EmptyState text={visibleDrawTeams.length ? "No teams match this search." : "No teams entered for this event yet."} />}
        </div>
      </div>
      {event && event.drawHistory.length > 0 && (
        <div className="panel draw-history">
          <PanelHeading title="Draw history" subtitle="Restore any previous generated draw" />
          {event.drawHistory.slice().reverse().map((snapshot, index) => (
            <div className="history-row" key={snapshot.id}>
              <div><strong>Version {event.drawHistory.length - index}</strong><small>{new Date(snapshot.createdAt).toLocaleString()} · {snapshot.teams.length} teams</small></div>
              <button className="secondary" disabled={event.drawLocked} onClick={() => restoreDraw(snapshot.teams)}><RefreshCw size={14} /> Restore</button>
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
  const requiredRole = null;
  const eligibleContestants = contestants.filter((contestant) =>
    requiredRole
      ? contestantEligibleForRole(event, contestant, requiredRole)
      : contestantEligibleForRole(event, contestant, "Header") ||
        contestantEligibleForRole(event, contestant, "Heeler"),
  );
  const firstEligibleRole = (contestant?: Contestant) =>
    contestantEligibleForRole(event, contestant, "Header")
      ? "Header"
      : "Heeler";
  const [contestantId, setContestantId] = useState(eligibleContestants[0]?.id ?? "");
  const [role, setRole] = useState<"Header" | "Heeler">(
    requiredRole ??
      firstEligibleRole(eligibleContestants[0]),
  );
  const minimumEntries = minimumDrawEntries(event);
  const [entries, setEntries] = useState(String(minimumEntries));
  const [horseName, setHorseName] = useState("");
  const [status, setStatus] = useState<EventRegistration["status"]>("entered");
  const [paid, setPaid] = useState(true);
  const [notes, setNotes] = useState("");
  useEffect(() => {
    setEntries(String(minimumEntries));
  }, [event.id, minimumEntries]);
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    onSubmit({
      id: uid("registration"),
      eventId: event.id,
      contestantId,
      horseName: horseName || undefined,
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
        <Field label="Contestant"><select required value={contestantId} onChange={(e) => { const id = e.target.value; setContestantId(id); setHorseName(""); const contestant = eligibleContestants.find((item) => item.id === id); if (!requiredRole && !contestantEligibleForRole(event, contestant, role)) setRole(firstEligibleRole(contestant)); }}>{eligibleContestants.map((contestant) => <option value={contestant.id} key={contestant.id}>{contestant.name}</option>)}</select></Field>
        <Field label="Horse"><select value={horseName} disabled={!eligibleContestants.find((contestant) => contestant.id === contestantId)?.horses?.length} onChange={(e) => setHorseName(e.target.value)}><option value="">{eligibleContestants.find((contestant) => contestant.id === contestantId)?.horses?.length ? "No horse selected" : "No saved horses"}</option>{eligibleContestants.find((contestant) => contestant.id === contestantId)?.horses?.map((horse) => <option key={horse} value={horse}>{horse}</option>)}</select>{!eligibleContestants.find((contestant) => contestant.id === contestantId)?.horses?.length && <small>Add a horse under Contestants, then return here.</small>}</Field>
        <Field label="Draw position"><select value={role} disabled={Boolean(requiredRole)} onChange={(e) => setRole(e.target.value as "Header" | "Heeler")}>{contestantEligibleForRole(event, eligibleContestants.find((contestant) => contestant.id === contestantId), "Header") && <option>Header</option>}{contestantEligibleForRole(event, eligibleContestants.find((contestant) => contestant.id === contestantId), "Heeler") && <option>Heeler</option>}</select></Field>
        <Field label="Number of entries"><input required type="number" min={minimumEntries} max={event.entriesAllowed} value={entries} onChange={(e) => setEntries(e.target.value)} /><small>Competition minimum: {minimumEntries}</small></Field>
        <Field label="Entry status"><select value={status} onChange={(e) => setStatus(e.target.value as EventRegistration["status"])}><option value="entered">Entered</option><option value="waitlist">Wait list</option></select></Field>
        <Field label="Payment status"><select value={paid ? "paid" : "unpaid"} onChange={(e) => setPaid(e.target.value === "paid")}><option value="paid">Paid</option><option value="unpaid">Unpaid</option></select></Field>
        <Field label="Contestant notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" /></Field>
      </div>
      <FormActions onCancel={onCancel} submitLabel={event.competitionType === "pick-and-draw" ? "Add to Draw Pot" : "Register rider"} />
    </form>
  );
}

function TeamForm({ event, team, contestants, drawPosition, onSubmit, onCancel, rideIn = false }: { event: ArenaEvent; team?: Team; contestants: Contestant[]; drawPosition: number; onSubmit: (team: Team) => void; onCancel: () => void; rideIn?: boolean }) {
  const headers = contestants.filter((rider) =>
    contestantEligibleForRole(event, rider, "Header"),
  );
  const heelers = contestants.filter((rider) =>
    contestantEligibleForRole(event, rider, "Heeler"),
  );
  const [headerId, setHeaderId] = useState(team?.headerId ?? headers[0]?.id ?? "");
  const [heelerId, setHeelerId] = useState(team?.heelerId ?? heelers.find((rider) => rider.id !== headerId)?.id ?? "");
  const [headerHorseName, setHeaderHorseName] = useState(team?.headerHorseName ?? "");
  const [heelerHorseName, setHeelerHorseName] = useState(team?.heelerHorseName ?? "");
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
      headerHorseName: headerHorseName || undefined,
      heelerHorseName: heelerHorseName || undefined,
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
      <div className="form-grid team-entry-grid">
        <Field label="Header"><select value={headerId} required onChange={(e) => { setHeaderId(e.target.value); setHeaderHorseName(""); }}>{headers.map((rider) => <option value={rider.id} key={rider.id}>{rider.name}</option>)}</select></Field>
        <Field label="Header horse"><select value={headerHorseName} disabled={!(headers.find((rider) => rider.id === headerId)?.horses?.length)} onChange={(e) => setHeaderHorseName(e.target.value)}><option value="">None selected</option>{headers.find((rider) => rider.id === headerId)?.horses?.map((horse) => <option key={horse} value={horse}>{horse}</option>)}</select></Field>
        <Field label="Heeler"><select value={heelerId} required onChange={(e) => { setHeelerId(e.target.value); setHeelerHorseName(""); }}>{heelers.filter((rider) => rider.id !== headerId).map((rider) => <option value={rider.id} key={rider.id}>{rider.name}</option>)}</select></Field>
        <Field label="Heeler horse"><select value={heelerHorseName} disabled={!(heelers.find((rider) => rider.id === heelerId)?.horses?.length)} onChange={(e) => setHeelerHorseName(e.target.value)}><option value="">None selected</option>{heelers.find((rider) => rider.id === heelerId)?.horses?.map((horse) => <option key={horse} value={horse}>{horse}</option>)}</select></Field>
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
  onSelectActiveRun,
  onUpdateEvent,
  onSave,
  onAddRideIn,
  onRollTeam,
  onReorderTeams,
  onSetPredictionCutoff,
  onResetScoreboard,
}: {
  event?: ArenaEvent;
  teams: Team[];
  registrations: EventRegistration[];
  contestants: Contestant[];
  onSelectActiveRun: (selection: ActiveRunSelection) => Promise<unknown>;
  onUpdateEvent: (event: ArenaEvent) => void;
  onSave: (teamId: string, update: Partial<Team>) => void;
  onAddRideIn: (team: Team) => void;
  onRollTeam: (teamId: string, rolled: boolean) => void;
  onReorderTeams: (movingTeamId: string, targetTeamId: string) => void;
  onSetPredictionCutoff: (teamId: string, predictionClosesAt?: string) => void;
  onResetScoreboard: () => Promise<number>;
}) {
  const [selectedRound, setSelectedRound] = useState(
    () =>
      normalizedRunDeskRound(
        event?.activeRound,
        Math.max(event?.rounds ?? 1, 1),
      ),
  );
  const [showRideInForm, setShowRideInForm] = useState(false);
  const [rideInMessage, setRideInMessage] = useState("");
  const [draggedQueueTeamId, setDraggedQueueTeamId] = useState("");
  const [scoreboardResetBusy, setScoreboardResetBusy] = useState(false);
  const [scoreboardResetMessage, setScoreboardResetMessage] = useState("");
  const [scoreboardResetError, setScoreboardResetError] = useState("");
  const [activeRunSaveStatus, setActiveRunSaveStatus] = useState<
    "idle" | "saving" | "saved" | "offline" | "error"
  >("idle");
  const [activeRunSaveError, setActiveRunSaveError] = useState("");
  const [pendingActiveSelection, setPendingActiveSelection] =
    useState<ActiveRunSelection | null>(null);
  const activeRunRequestId = useRef(0);
  const [timeSheetPreview, setTimeSheetPreview] = useState<{
    title: string;
    html: string;
    fileName: string;
  } | null>(null);
  const timeSheetFrame = useRef<HTMLIFrameElement>(null);
  const roundCount = Math.max(event?.rounds ?? 1, 1);
  const activeRound = normalizedRunDeskRound(selectedRound, roundCount);
  const allEventTeams = teams
    .filter(
      (team) =>
        event?.drawApproved === true &&
        team.eventId === event.id &&
        !team.scratched,
    )
    .sort((a, b) => a.drawPosition - b.drawPosition);
  const eventTeams = allEventTeams
    .filter((team) => team.round === activeRound)
    .sort((a, b) => a.drawPosition - b.drawPosition);
  const repeatedRunDeskTeamKeys = repeatedTeamPairKeys(allEventTeams);
  const nextTeam =
    eventTeams.find((team) => team.status === "ready" && !team.rolled) ??
    eventTeams.find((team) => team.status === "ready");
  const [selectedId, setSelectedId] = useState<string | null>(
    () => event?.activeRunId ?? null,
  );
  const selected = eventTeams.find((team) => team.id === selectedId) ?? nextTeam;
  const spectatorPicksClosed = Boolean(
    selected?.predictionClosesAt &&
      Date.parse(selected.predictionClosesAt) <= Date.now(),
  );
  const [rawTime, setRawTime] = useState("");
  const [penalties, setPenalties] = useState("0");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    const nextRound = normalizedRunDeskRound(event?.activeRound, roundCount);
    setSelectedRound(nextRound);
    setSelectedId(event?.activeRunId ?? null);
    const nextRoundTeams = allEventTeams.filter(
      (team) => team.round === nextRound,
    );
    const nextSelected =
      nextRoundTeams.find((team) => team.id === event?.activeRunId) ??
      nextRoundTeams.find((team) => team.status === "ready" && !team.rolled) ??
      nextRoundTeams.find((team) => team.status === "ready");
    setRawTime(nextSelected?.rawTime?.toString() ?? "");
    setPenalties(nextSelected?.penalties.toString() ?? "0");
    setNotes(nextSelected?.notes ?? "");
  }, [event?.activeRound, event?.activeRunId, event?.id, roundCount]);
  const persistedRound = normalizedRunDeskRound(
    event?.activeRound,
    roundCount,
  );
  const persistedRoundTeams = allEventTeams.filter(
    (team) => team.round === persistedRound,
  );
  const runDeskTeamState = persistedRoundTeams
    .map((team) => `${team.id}:${team.status}:${team.rolled}`)
    .join("|");
  useEffect(() => {
    if (!event) return;
    const selection = runDeskSelectionToPersist(
      event,
      persistedRoundTeams,
      persistedRound,
    );
    if (!selection) return;
    onUpdateEvent({ ...event, ...selection });
  }, [
    event?.activeRound,
    event?.activeRunId,
    event?.id,
    persistedRound,
    runDeskTeamState,
  ]);
  const selectActiveRun = async (
    teamId: string | null,
    round = activeRound,
  ) => {
    setSelectedRound(round);
    setSelectedId(teamId);
    if (!event) return;
    const selection = {
      eventId: event.id,
      activeRunId: teamId ?? undefined,
      activeRound: round,
    };
    const requestId = ++activeRunRequestId.current;
    setPendingActiveSelection(selection);
    setActiveRunSaveStatus("saving");
    setActiveRunSaveError("");
    try {
      await onSelectActiveRun(selection);
      if (requestId !== activeRunRequestId.current) return;
      setPendingActiveSelection(null);
      setActiveRunSaveStatus("saved");
    } catch (error) {
      if (requestId !== activeRunRequestId.current) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        // Offline: keep the selection on this computer instead of reverting.
        // The workspace autosave persists it locally and syncs to Wix when
        // the connection returns, matching the deferred selection path.
        setPendingActiveSelection(null);
        if (
          event.activeRunId !== (teamId ?? undefined) ||
          event.activeRound !== round
        ) {
          onUpdateEvent({
            ...event,
            activeRunId: teamId ?? undefined,
            activeRound: round,
          });
        }
        setActiveRunSaveStatus("offline");
        setActiveRunSaveError("");
        return;
      }
      const confirmed =
        error instanceof ActiveRunSaveError
          ? error.confirmedSelection
          : {
              activeRound: event.activeRound,
              activeRunId: event.activeRunId,
            };
      setSelectedRound(
        normalizedRunDeskRound(confirmed.activeRound, roundCount),
      );
      setSelectedId(confirmed.activeRunId ?? null);
      setActiveRunSaveStatus("error");
      setActiveRunSaveError(
        error instanceof Error
          ? error.message
          : "Wix did not confirm the Roping Now selection.",
      );
    }
  };
  const selectActiveRunDeferred = (
    teamId: string | null,
    round = activeRound,
  ) => {
    setSelectedRound(round);
    setSelectedId(teamId);
    if (
      event &&
      (event.activeRunId !== (teamId ?? undefined) ||
        event.activeRound !== round)
    ) {
      onUpdateEvent({
        ...event,
        activeRunId: teamId ?? undefined,
        activeRound: round,
      });
    }
  };
  const isEditingResult = Boolean(selected && selected.status !== "ready");
  const resetScoreboard = async () => {
    if (!event || scoreboardResetBusy) return;
    if (
      !window.confirm(
        `Reset the Cowboys × Steer scoreboard for ${event.name}? Every spectator pick and point for this roping will be permanently cleared.`,
      )
    ) {
      return;
    }
    setScoreboardResetBusy(true);
    setScoreboardResetMessage("");
    setScoreboardResetError("");
    try {
      const cleared = await onResetScoreboard();
      setScoreboardResetMessage(
        cleared === 1
          ? "Scoreboard reset. 1 spectator pick was cleared."
          : `Scoreboard reset. ${cleared} spectator picks were cleared.`,
      );
    } catch (error) {
      setScoreboardResetError(
        error instanceof Error
          ? error.message
          : "The Cowboys × Steer scoreboard could not be reset.",
      );
    } finally {
      setScoreboardResetBusy(false);
    }
  };
  const contestant = (id: string) =>
    contestants.find((item) => item.id === id);
  const rider = (id: string) => contestant(id)?.name ?? "Unknown";
  const headerHandicap = (team: Team) =>
    contestant(team.headerId)?.headerHandicap ?? 0;
  const heelerHandicap = (team: Team) =>
    contestant(team.heelerId)?.heelerHandicap ?? 0;
  const slideAdjustmentLabel = (team: Team) => {
    if (event?.competitionType !== "slide") return "";
    const adjustment = slideTimeAdjustment(
      event,
      { ...team, round: 2 },
      contestants,
    );
    if (adjustment > 0) return `${adjustment.toFixed(1)}s added`;
    if (adjustment < 0) {
      return `${Math.abs(adjustment).toFixed(1)}s subtracted`;
    }
    return "0.0s adjustment";
  };
  const entryRuns = (team: Team) =>
    allEventTeams
      .filter(
        (run) =>
          sameTeamEntry(run, team) &&
          run.round <= team.round,
      )
      .sort((a, b) => a.round - b.round);
  const qualifiedTotal = (team: Team, beforeRound?: number) =>
    teamQualifiedTotal(team, allEventTeams, beforeRound, event, contestants);
  const cumulativeRunLabel = (team: Team) => {
    const runs = entryRuns(team);
    const parts = Array.from({ length: team.round }, (_, index) => {
      const round = index + 1;
      const run = runs.find((item) => item.round === round);
      const time =
        run?.status === "complete" && run.rawTime !== null
          ? (officialRunTime(event!, run, contestants) ?? 0).toFixed(2)
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
  // Same data as the LED scoreboard: each team's latest qualified run
  // through the active round, with cumulative totals.
  const standings = event
    ? sortLedStandings(
        ledQualifiedRunsThroughRound(event.id, allEventTeams, activeRound),
        (team) => qualifiedTotal(team, activeRound + 1),
      )
    : [];
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
        event.competitionType === "pick-and-draw" ||
        event.competitionType === "slide"
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
  const roundOneTeams = allEventTeams.filter((team) => team.round === 1);
  const payoffHeaders = new Set(roundOneTeams.map((team) => team.headerId)).size;
  const payoffHeelers = new Set(roundOneTeams.map((team) => team.heelerId)).size;
  const payoffParticipants = new Set(
    roundOneTeams.flatMap((team) => [team.headerId, team.heelerId]),
  ).size;
  const payoffFreeRuns = roundOneTeams.reduce(
    (count, team) =>
      count +
      Number(Boolean(team.headerFreeRun)) +
      Number(Boolean(team.heelerFreeRun)),
    0,
  );
  const payoffFreeRunDeduction = payoffFreeRuns * (event?.entryFee ?? 0);
  const payoffTotalPot =
    paidEntryCount * (event?.entryFee ?? 0) + (event?.addedMoney ?? 0);
  const payoffWinners = payouts.flatMap((payout) => {
    const team = standings[payout.place - 1];
    if (!team) return [];
    const source =
      roundOneTeams.find((run) => sameTeamEntry(run, team)) ?? team;
    const recipients = source.headerFreeRun
      ? [team.heelerId]
      : source.heelerFreeRun
        ? [team.headerId]
        : [...new Set([team.headerId, team.heelerId])];
    return [
      {
        payout,
        team,
        recipients,
        note: source.headerFreeRun
          ? "Header FR excluded"
          : source.heelerFreeRun
            ? "Heeler FR excluded"
            : "",
        rounds: `${entryRuns(team).filter((run) => run.status === "complete" && run.rawTime !== null).length} / ${roundCount}`,
        totalTime: qualifiedTotal(team, activeRound + 1).toFixed(2),
      },
    ];
  });
  const payoffRiderShares = (() => {
    const shares = new Map<
      string,
      { contestantId: string; amount: number; places: string[] }
    >();
    payoffWinners.forEach((winner) => {
      const share = winner.payout.amount / Math.max(winner.recipients.length, 1);
      winner.recipients.forEach((contestantId) => {
        const current = shares.get(contestantId) ?? {
          contestantId,
          amount: 0,
          places: [],
        };
        current.amount += share;
        current.places.push(ordinal(winner.payout.place));
        shares.set(contestantId, current);
      });
    });
    return [...shares.values()].sort((a, b) => b.amount - a.amount);
  })();
  const payoffMoney = (value: number) =>
    `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const openPayoffReport = () => {
    if (!event) return;
    setTimeSheetPreview({
      title: "Payoff report",
      html: payoffReportHtml({
        eventName: event.name,
        eventDate: event.date,
        eventLocation: event.location ?? "",
        participants: payoffParticipants,
        headers: payoffHeaders,
        heelers: payoffHeelers,
        teams: roundOneTeams.length,
        totalPot: payoffTotalPot,
        freeRuns: payoffFreeRuns,
        freeRunDeduction: payoffFreeRunDeduction,
        jackpot: purse,
        winners: payoffWinners.map((winner) => ({
          place: winner.payout.place,
          percentage: Math.round(winner.payout.percentage * 100),
          header: rider(winner.team.headerId),
          heeler: rider(winner.team.heelerId),
          rounds: winner.rounds,
          totalTime: winner.totalTime,
          amount: winner.payout.amount,
          note: winner.note,
        })),
        riderShares: payoffRiderShares.map((share) => ({
          name: rider(share.contestantId),
          places: share.places.join(", "),
          amount: share.amount,
        })),
      }),
      fileName: payoffReportFileName(event.name),
    });
  };
  const shortGoTotals =
    activeRound === roundCount && roundCount > 1
      ? eventTeams
          .filter((team) => team.status === "complete" && team.rawTime !== null)
          .map((team) => qualifiedTotal(team))
          .sort((a, b) => a - b)
      : [];
  const shortGoLeaderTotal = shortGoTotals.length
    ? shortGoTotals[0]
    : undefined;
  const selectedPriorTotal =
    selected && activeRound === roundCount && roundCount > 1
      ? qualifiedTotal(selected, activeRound)
      : 0;
  const timeToFirst =
    shortGoLeaderTotal === undefined
      ? undefined
      : shortGoLeaderTotal - selectedPriorTotal - 0.01;
  const payingSpots = Math.max(
    1,
    (event?.payoutPercentages ?? [50, 30, 20]).filter(
      (percentage) => percentage > 0,
    ).length,
  );
  const moneyCutoffTotal =
    shortGoTotals.length >= payingSpots
      ? shortGoTotals[payingSpots - 1]
      : undefined;
  const timeToMoney =
    moneyCutoffTotal === undefined
      ? undefined
      : moneyCutoffTotal - selectedPriorTotal - 0.01;
  const openLedLeaderboard = () => {
    if (!event) return;
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("display", "leaderboard");
    url.searchParams.set("event", event.id);
    url.searchParams.set("round", String(activeRound));
    if (selected) url.searchParams.set("team", selected.id);
    if (isWixEmbed()) url.searchParams.set("relay", "wix");
    const popup = openLedWindow(url.toString());
    if (!popup) {
      window.alert("Allow pop-ups to open the LED screen in a new tab.");
    }
  };
  const previewRoundTimeSheet = () => {
    if (!event || !eventTeams.length) return;
    setTimeSheetPreview({
      title: `Round ${activeRound} time sheet`,
      html: roundTimeSheetHtml(event, eventTeams, contestants, activeRound),
      fileName: roundTimeSheetFileName(event.name, activeRound),
    });
  };
  const printRoundTimeSheet = () => {
    timeSheetFrame.current?.contentWindow?.print();
  };
  const downloadRoundTimeSheet = () => {
    if (!timeSheetPreview) return;
    const url = URL.createObjectURL(
      new Blob([timeSheetPreview.html], { type: "text/html;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = timeSheetPreview.fileName;
    link.click();
    URL.revokeObjectURL(url);
  };
  const chooseTeam = (team: Team) => {
    void selectActiveRun(team.id);
    setRawTime(team.rawTime?.toString() ?? "");
    setPenalties(team.penalties.toString());
    setNotes(team.notes);
  };
  const toggleRolled = (team: Team) => {
    if (team.status !== "ready") return;
    const willRoll = !team.rolled;
    onRollTeam(team.id, willRoll);
    if (team.id === selected?.id) {
      const followingTeam = willRoll
        ? eventTeams.find(
            (candidate) =>
              candidate.id !== team.id &&
              candidate.status === "ready" &&
              !candidate.rolled &&
              candidate.drawPosition > team.drawPosition,
          ) ??
          eventTeams.find(
            (candidate) =>
              candidate.id !== team.id &&
              candidate.status === "ready" &&
              !candidate.rolled,
          )
        : team;
      selectActiveRunDeferred(followingTeam?.id ?? null);
      setRawTime("");
      setPenalties("0");
      setNotes("");
    }
  };
  const saveRun = (status: Team["status"]) => {
    if (!selected) return;
    const followingTeam =
      eventTeams.find(
        (team) =>
          team.id !== selected.id &&
          team.status === "ready" &&
          !team.rolled &&
          team.drawPosition > selected.drawPosition,
      ) ??
      eventTeams.find(
        (team) =>
          team.id !== selected.id &&
          team.status === "ready" &&
          !team.rolled,
      ) ??
      eventTeams.find(
        (team) =>
          team.id !== selected.id &&
          team.status === "ready",
      );
    const previewTeam = {
      ...selected,
      rawTime: Number(rawTime),
      penalties: Number(penalties),
    };
    const total = event
      ? (officialRunTime(event, previewTeam, contestants) ?? 0)
      : Number(rawTime) + Number(penalties);
    const exceededLimit = status === "complete" && event && total > event.timeLimit;
    onSave(selected.id, {
      status: exceededLimit ? "no-time" : status,
      rawTime: status === "complete" ? Number(rawTime) : null,
      penalties: status === "complete" ? Number(penalties) : 0,
      notes: exceededLimit ? `${notes}${notes ? " · " : ""}Time limit exceeded` : notes,
      points: status === "complete" && !exceededLimit ? 1 : 0,
      rolled: false,
    });
    selectActiveRunDeferred(followingTeam?.id ?? null);
    setRawTime("");
    setPenalties("0");
    setNotes("");
  };
  const clearRunResult = () => {
    if (!selected || selected.status === "ready") return;
    if (!window.confirm(`Clear the result for Draw #${selected.drawPosition} and mark this team Not run yet?`)) return;
    onSave(selected.id, {
      status: "ready",
      rawTime: null,
      penalties: 0,
      notes: "",
      points: 0,
      rolled: false,
    });
    selectActiveRunDeferred(selected.id);
    setRawTime("");
    setPenalties("0");
    setNotes("");
  };
  const changeRound = (round: number) => {
    const roundTeams = allEventTeams.filter((team) => team.round === round);
    const nextRoundTeam =
      roundTeams.find((team) => team.status === "ready" && !team.rolled) ??
      roundTeams.find((team) => team.status === "ready");
    selectActiveRunDeferred(nextRoundTeam?.id ?? null, round);
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
    const header = contestants.find((contestant) => contestant.id === team.headerId);
    const heeler = contestants.find((contestant) => contestant.id === team.heelerId);
    if (
      !contestantEligibleForRole(event, header, "Header") ||
      !contestantEligibleForRole(event, heeler, "Heeler")
    ) {
      setRideInMessage(
        `Each contestant must be a #${event.maxContestantHandicap} or lower in the entered position.`,
      );
      return;
    }
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
    selectActiveRunDeferred(rideInTeam.id, 1);
    setShowRideInForm(false);
    setRideInMessage(
      `Ride-in team added as Draw #${team.drawPosition} in Round 1.`,
    );
  };

  return (
    <>
      <PageIntro title="Run desk" text={event ? `Record times and publish standings for ${event.name}.` : "Select an event to open the run desk."} />
      {activeRunSaveStatus === "saving" && (
        <div className="notice">
          <span>Saving Roping Now to Wix…</span>
        </div>
      )}
      {activeRunSaveStatus === "saved" && (
        <div className="notice success">
          <span>Roping Now saved.</span>
        </div>
      )}
      {activeRunSaveStatus === "offline" && (
        <div className="notice">
          <span>
            Offline — Roping Now is saved on this computer and will sync to
            Wix when the connection returns.
          </span>
        </div>
      )}
      {activeRunSaveStatus === "error" && (
        <div className="notice error">
          <span>
            Roping Now was not saved. {activeRunSaveError}
          </span>
          {pendingActiveSelection && (
            <button
              onClick={() =>
                void selectActiveRun(
                  pendingActiveSelection.activeRunId ?? null,
                  pendingActiveSelection.activeRound,
                )
              }
            >
              Retry
            </button>
          )}
        </div>
      )}
      {event && event.drawApproved !== true && (
        <div className="notice">
          <span>
            No approved draw has been sent to Run Desk. Generate and approve the
            draw in Teams & Draw first.
          </span>
        </div>
      )}
      {event && event.drawApproved === true && (
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
          <div className="run-desk-round-actions">
            <button
              className="secondary"
              disabled={!eventTeams.length}
              onClick={previewRoundTimeSheet}
            >
              <Eye size={16} /> Preview time sheet
            </button>
            {activeRound > 1 && (
              <button className="secondary" onClick={() => changeRound(activeRound - 1)}>
                <ChevronLeft size={16} /> Previous round
              </button>
            )}
            {activeRound === 1 && (
              <button className="secondary" onClick={() => setShowRideInForm((current) => !current)}><Plus size={16} /> Ride-in team</button>
            )}
            <button
              className="secondary scoreboard-reset-button"
              disabled={scoreboardResetBusy}
              onClick={() => void resetScoreboard()}
            >
              <RefreshCw size={16} />{" "}
              {scoreboardResetBusy ? "Resetting scoreboard…" : "Reset Cowboys × Steer"}
            </button>
          </div>
        </div>
      )}
      {scoreboardResetMessage && (
        <div className="notice success">
          <span>{scoreboardResetMessage}</span>
          <button onClick={() => setScoreboardResetMessage("")}><X size={16} /></button>
        </div>
      )}
      {scoreboardResetError && (
        <div className="notice error">
          <span>Scoreboard was not reset. {scoreboardResetError}</span>
          <button onClick={() => setScoreboardResetError("")}><X size={16} /></button>
        </div>
      )}
      {rideInMessage && <div className="notice"><span>{rideInMessage}</span><button onClick={() => setRideInMessage("")}><X size={16} /></button></div>}
      {event && event.drawApproved === true && activeRound === 1 && showRideInForm && (
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
      {timeSheetPreview && (
        <div className="time-sheet-preview-overlay" role="presentation">
          <section
            className="time-sheet-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="time-sheet-preview-title"
          >
            <div className="time-sheet-preview-toolbar">
              <div>
                <strong id="time-sheet-preview-title">{timeSheetPreview.title}</strong>
                <small>Preview the document before printing or downloading it.</small>
              </div>
              <span />
              <button className="secondary" onClick={downloadRoundTimeSheet}>
                <Download size={16} /> Download
              </button>
              <button className="primary" onClick={printRoundTimeSheet}>
                <Printer size={16} /> Print
              </button>
              <button
                className="icon-button"
                aria-label="Close preview"
                onClick={() => setTimeSheetPreview(null)}
              >
                <X size={18} />
              </button>
            </div>
            <iframe
              ref={timeSheetFrame}
              className="time-sheet-preview-frame"
              srcDoc={timeSheetPreview.html}
              title={`${timeSheetPreview.title} preview`}
            />
          </section>
        </div>
      )}
      <div className="run-desk-grid">
        <section className={`panel desk-entry ${selected?.headerFreeRun || selected?.heelerFreeRun ? "free-run-panel" : ""} ${selected && repeatedRunDeskTeamKeys.has(`${selected.headerId}|${selected.heelerId}`) ? "repeat-team-panel" : ""}`}>
          <div className="desk-title"><span className="stat-icon">{isEditingResult ? <Pencil size={21} /> : <Gauge size={21} />}</span><div><span>Round {activeRound} · {activeRunSaveStatus === "saving" ? "Saving Roping Now…" : activeRunSaveStatus === "error" ? "Roping Now save failed" : activeRunSaveStatus === "offline" ? "Roping Now saved on this computer" : activeRunSaveStatus === "saved" ? "Roping Now saved" : isEditingResult ? "Editing recorded result" : "Now roping"}</span><h3>{selected ? `Team #${selected.originalTeamNumber ?? selected.drawPosition}${activeRound > 1 ? ` · Draw #${selected.drawPosition}` : ""}` : "Round complete"}</h3></div></div>
          {selected ? (
            <>
              <div className="active-team">
                <div><span>Header</span><strong>{rider(selected.headerId)}</strong><small>HC {headerHandicap(selected)}</small></div>
                <i>&</i>
                <div><span>Heeler</span><strong>{rider(selected.heelerId)}</strong><small>HC {heelerHandicap(selected)}</small></div>
              </div>
              <div className="run-entry-markers">
                <span className={`tag team-source-tag ${selected.generated ? "draw" : "pick"}`}>
                  {selected.generated ? "Draw" : "Pick"}
                </span>
                {(selected.headerFreeRun || selected.heelerFreeRun) && <span className="tag free-run-tag">Free Run</span>}
                {repeatedRunDeskTeamKeys.has(`${selected.headerId}|${selected.heelerId}`) && <span className="tag repeat-team-tag">Repeat Team</span>}
              </div>
              <div className="run-handicap"><span>Combined team handicap</span><strong>{teamHandicapTotal(selected.headerId, selected.heelerId, contestants)} / {event?.handicapTotal ?? "—"}</strong></div>
              {event?.competitionType === "slide" && (
               <div className="run-handicap"><span>Round 2 slide adjustment</span><strong>{slideAdjustmentLabel(selected)} · Slide #{event.slideNumber ?? 10}</strong></div>
              )}
              {selected.status === "ready" && (
                <button
                  className={`prediction-close-button${spectatorPicksClosed ? " closed" : ""}`}
                  disabled={spectatorPicksClosed}
                  onClick={() =>
                    onSetPredictionCutoff(selected.id, new Date().toISOString())
                  }
                >
                  {spectatorPicksClosed
                    ? "Spectator Picks Closed"
                    : "Close Spectator Picks Before Gate Opens"}
                </button>
              )}
              {event && activeRound === roundCount && roundCount > 1 && selected.status === "ready" && (
                <div className="announcer-times">
                  <div><span>Prior aggregate</span><strong>{selectedPriorTotal.toFixed(2)}s</strong></div>
                  <div><span>To be in the money pot</span><strong>{timeToMoney === undefined ? "Just catch" : timeToMoney <= 0 ? "Money out of reach" : `${timeToMoney.toFixed(2)}s or faster`}</strong></div>
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
              <div className={`result-preview ${rawTime && event && (officialRunTime(event, { ...selected, rawTime: Number(rawTime), penalties: Number(penalties) }, contestants) ?? 0) > event.timeLimit ? "over-limit" : ""}`}><span>Official time {event ? `· ${event.timeLimit}s limit` : ""}</span><strong>{rawTime && event ? (officialRunTime(event, { ...selected, rawTime: Number(rawTime), penalties: Number(penalties) }, contestants) ?? 0).toFixed(2) : "—"}</strong></div>
              <div className={`desk-actions${isEditingResult ? " editing" : ""}`}>
                {isEditingResult && <button className="clear-result-button" onClick={clearRunResult}>Clear result / Not run yet</button>}
                <button className="no-time-button" onClick={() => saveRun("no-time")}>Mark no time</button>
                <button className="primary" disabled={!rawTime || Number(rawTime) <= 0} onClick={() => saveRun("complete")}><Check size={18} /> {isEditingResult ? "Save corrected time" : "Save result"}</button>
              </div>
            </>
          ) : <EmptyState text="Every team in this draw has a result." />}
        </section>

        <section className="panel run-queue">
          <PanelHeading title={`Round ${activeRound} run order`} subtitle={`${eventTeams.filter((team) => team.status === "ready").length} teams remaining${eventTeams.length > 1 ? " · Drag teams to reorder" : ""}`} />
          <div className="queue-scroll">
            {eventTeams.map((team) => (
              <div
                className={`queue-row ${selected?.id === team.id ? "active" : ""} ${team.rolled ? "rolled" : ""} ${team.headerFreeRun || team.heelerFreeRun ? "free-run-row" : ""} ${repeatedRunDeskTeamKeys.has(`${team.headerId}|${team.heelerId}`) ? "repeat-team-row" : ""} ${eventTeams.length > 1 ? "draggable-queue-row" : ""} ${draggedQueueTeamId === team.id ? "dragging" : ""}`}
                key={team.id}
                draggable={eventTeams.length > 1}
                onDragStart={(dragEvent: DragEvent<HTMLDivElement>) => {
                  if (eventTeams.length < 2) return;
                  setDraggedQueueTeamId(team.id);
                  dragEvent.dataTransfer.effectAllowed = "move";
                  dragEvent.dataTransfer.setData("text/plain", team.id);
                }}
                onDragOver={(dragEvent) => {
                  if (draggedQueueTeamId) {
                    dragEvent.preventDefault();
                    dragEvent.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(dragEvent) => {
                  dragEvent.preventDefault();
                  if (draggedQueueTeamId && draggedQueueTeamId !== team.id) {
                    onReorderTeams(draggedQueueTeamId, team.id);
                  }
                  setDraggedQueueTeamId("");
                }}
                onDragEnd={() => setDraggedQueueTeamId("")}
              >
                <button className="queue-team-select" onClick={() => chooseTeam(team)}>
                  <span className="draw-number">{eventTeams.length > 1 && <GripVertical className="draw-drag-handle" size={14} />}{team.originalTeamNumber ?? team.drawPosition}</span>
                  <span className="queue-team-name"><strong>{rider(team.headerId)} & {rider(team.heelerId)} <b className={`team-source-inline ${team.generated ? "draw" : "pick"}`}>{team.generated ? "DRAW" : "PICK"}</b></strong><small className="queue-handicap-details">Header HC {headerHandicap(team)} · Heeler HC {heelerHandicap(team)} · Total HC {teamHandicapTotal(team.headerId, team.heelerId, contestants)}{event?.competitionType === "slide" ? ` · R2 ${slideAdjustmentLabel(team)}` : ""}</small><small>{team.headerFreeRun || team.heelerFreeRun ? "FREE RUN · " : ""}{repeatedRunDeskTeamKeys.has(`${team.headerId}|${team.heelerId}`) ? "REPEAT TEAM · " : ""}{team.status === "complete" && event ? `${(officialRunTime(event, team, contestants) ?? 0).toFixed(2)} seconds` : team.status === "no-time" ? "No time" : team.rolled ? "ROLLED · Waiting" : "Not run yet"}</small>{activeRound > 1 && <small className="cumulative-times">{cumulativeRunLabel(team)}</small>}</span>
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
          <div><h3>Results</h3><p>{standings.length} qualified average{standings.length === 1 ? "" : "s"} · {event?.resultsPublished ? "Published live" : "Draft results"}</p></div>
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
              <span><strong>{rider(team.headerId)} & {rider(team.heelerId)}</strong>{event?.competitionType === "slide" && <small>Header HC {headerHandicap(team)} · Heeler HC {heelerHandicap(team)} · Total HC {teamHandicapTotal(team.headerId, team.heelerId, contestants)} · R2 {slideAdjustmentLabel(team)}</small>}<small>Team #{team.originalTeamNumber ?? team.drawPosition}{activeRound > 1 ? ` · Draw #${team.drawPosition}` : ""}{team.round === activeRound && activeRound < roundCount ? ` · Advances to Round ${activeRound + 1}` : ""}</small></span>
              <span>{entryRuns(team).filter((run) => run.status === "complete" && run.rawTime !== null).length} / {roundCount}</span>
              <span><b className="total-time">{qualifiedTotal(team, activeRound + 1).toFixed(2)}</b></span>
            </div>
          ))}
          {!standings.length && <EmptyState text="Qualified runs will appear here." />}
        </div>
      </section>
      <section className="panel payoff-panel">
        <div className="table-toolbar">
          <div className="payoff-heading"><span className="stat-icon"><CircleDollarSign size={21} /></span><div><h3>Payoff</h3><p>{event ? `${event.name} · ${event.date}` : "Select an event to build the payoff."}</p></div></div>
          <div className="toolbar-actions">
            <button className="secondary" disabled={!event} onClick={openPayoffReport}><Printer size={16} /> Print payoff report</button>
          </div>
        </div>
        <div className="payoff-stats">
          <div><span>Participants</span><strong>{payoffParticipants}</strong></div>
          <div><span>Headers</span><strong>{payoffHeaders}</strong></div>
          <div><span>Heelers</span><strong>{payoffHeelers}</strong></div>
          <div><span>Teams</span><strong>{roundOneTeams.length}</strong></div>
          <div><span>Total money in the pot</span><strong>{payoffMoney(payoffTotalPot)}</strong></div>
          <div><span>Total free runs</span><strong>{payoffFreeRuns}</strong></div>
          <div><span>Free run deductions</span><strong>{payoffMoney(payoffFreeRunDeduction)}</strong></div>
          <div><span>Total jackpot money</span><strong>{payoffMoney(purse)}</strong></div>
        </div>
        <div className="payoff-columns">
          <div>
            <h4>Winners</h4>
            {payoffWinners.length ? payoffWinners.map((winner) => (
              <div className="payoff-row payoff-winner-row" key={winner.payout.place}>
                <span><b className={`place place-${winner.payout.place}`}>{winner.payout.place}</b></span>
                <span className="payoff-row-main"><strong>{rider(winner.team.headerId)} x {rider(winner.team.heelerId)}</strong><small>{winner.rounds} rounds · {winner.totalTime}s{winner.note ? ` · ${winner.note}` : ""}</small></span>
                <span className="payoff-row-amount"><strong>{payoffMoney(winner.payout.amount)}</strong><small>{Math.round(winner.payout.percentage * 100)}% to split</small></span>
              </div>
            )) : <p className="payoff-empty">Qualified runs will populate the winners.</p>}
          </div>
          <div>
            <h4>Rider shares</h4>
            {payoffRiderShares.length ? payoffRiderShares.map((share) => (
              <div className="payoff-row" key={share.contestantId}>
                <span className="payoff-row-main"><strong>{rider(share.contestantId)}</strong><small>{share.places.join(", ")}</small></span>
                <span className="payoff-row-amount"><strong>{payoffMoney(share.amount)}</strong></span>
              </div>
            )) : <p className="payoff-empty">Rider shares appear once winners are known.</p>}
          </div>
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
    ["Draw", "Round", "Rounds Completed", "Header", "Heeler", "Current Round Raw Time", "Penalty", "Slide Adjustment", "Run Total", "Total Time", "Status", "Notes"],
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
        slideTimeAdjustment(event, team, contestants),
        officialRunTime(event, team, contestants) ?? "",
        completedRuns.reduce(
          (total, run) =>
            total + (officialRunTime(event, run, contestants) ?? 0),
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



function App() {
  const route = parsePublicRoute(window.location.search);
  if (
    route.kind === "home" ||
    route.kind === "events" ||
    route.kind === "event" ||
    route.kind === "competition" ||
    route.kind === "signup" ||
    route.kind === "rider-account" ||
    route.kind === "rider" ||
    route.kind === "spectator"
  ) {
    return <PublicSite route={route} />;
  }
  if (route.kind === "staff") {
    return (
      <AdminAccessGate>
        <StaffApp />
      </AdminAccessGate>
    );
  }
  if (route.kind === "registration-desk") {
    return (
      <RegistrationDeskAccessGate>
        <RegistrationDesk />
      </RegistrationDeskAccessGate>
    );
  }
  return <StaffApp />;
}

export default App;
