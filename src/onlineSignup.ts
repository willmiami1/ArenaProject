import {
  contestantEligibleForRole,
  registrationsForPickedTeam,
  teamHandicapTotal,
} from "./competition";
import type {
  ArenaData,
  ArenaEvent,
  EventRegistration,
  Team,
} from "./types";
import { assertOnlineRegistrationOpen } from "./registrationWindow";

export interface SignupRequest {
  submissionId: string;
  contestantId: string;
  eventId: string;
  role?: "Header" | "Heeler";
  entries?: number;
  partnerId?: string;
}

const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export const deterministicSignupId = (
  kind: "team" | "registration",
  submissionId: string,
  suffix = "",
) => `online-${kind}-${submissionId}${suffix ? `-${suffix}` : ""}`;

export function createOnlineSignup(
  data: ArenaData,
  request: SignupRequest,
  now = new Date(),
): { teams: Team[]; registrations: EventRegistration[]; existing: boolean } {
  if (
    !safeId(request.submissionId) ||
    !safeId(request.contestantId) ||
    !safeId(request.eventId)
  ) {
    throw new Error("Invalid signup request.");
  }
  const event = data.events.find((item) => item.id === request.eventId);
  const contestant = data.contestants.find((item) => item.id === request.contestantId);
  if (!event || !contestant) throw new Error("Competition or contestant not found.");
  assertOnlineRegistrationOpen(event, now);
  const existingTeams = data.teams.filter(
    (team) => team.submissionId === request.submissionId,
  );
  const existingRegistrations = data.registrations.filter(
    (registration) => registration.submissionId === request.submissionId,
  );
  if (existingTeams.length || existingRegistrations.length) {
    return {
      teams: existingTeams,
      registrations: existingRegistrations,
      existing: true,
    };
  }

  const metadata = {
    paid: false as const,
    source: "online" as const,
    submissionId: request.submissionId,
    submittedAt: now.toISOString(),
  };
  if (event.competitionType === "draw-pot" || event.competitionType === "round-robin") {
    const entries = Number(request.entries);
    if (
      !request.role ||
      !Number.isInteger(entries) ||
      entries < 1 ||
      entries > event.entriesAllowed
    ) {
      throw new Error("Choose a valid role and entry count.");
    }
    if (
      (request.role === "Header" && contestant.role === "Heeler") ||
      (request.role === "Heeler" && contestant.role === "Header")
    ) {
      throw new Error("The selected role is not eligible.");
    }
    if (!contestantEligibleForRole(event, contestant, request.role)) {
      throw new Error("Contestant handicap exceeds the competition limit.");
    }
    const currentEntries = data.registrations
      .filter(
        (registration) =>
          registration.eventId === event.id &&
          registration.contestantId === contestant.id &&
          registration.status !== "scratched",
      )
      .reduce((sum, registration) => sum + registration.entries, 0);
    if (currentEntries + entries > event.entriesAllowed) {
      throw new Error("Entry limit exceeded.");
    }
    return {
      teams: [],
      registrations: [{
        id: deterministicSignupId("registration", request.submissionId),
        eventId: event.id,
        contestantId: contestant.id,
        role: request.role,
        entries,
        checkedIn: false,
        status: "entered",
        notes: "",
        ...metadata,
      }],
      existing: false,
    };
  }

  const partner = data.contestants.find((item) => item.id === request.partnerId);
  if (!partner || partner.id === contestant.id) throw new Error("Choose an eligible partner.");
  if (!request.role) throw new Error("Choose your team position.");
  const headerId = request.role === "Header" ? contestant.id : partner.id;
  const heelerId = request.role === "Heeler" ? contestant.id : partner.id;
  const header = data.contestants.find((item) => item.id === headerId);
  const heeler = data.contestants.find((item) => item.id === heelerId);
  if (
    !contestantEligibleForRole(event, header, "Header") ||
    !contestantEligibleForRole(event, heeler, "Heeler")
  ) {
    throw new Error("A contestant handicap exceeds the competition limit.");
  }
  if (teamHandicapTotal(headerId, heelerId, data.contestants) > event.handicapTotal) {
    throw new Error("Team handicap exceeds the competition limit.");
  }
  const duplicate = data.teams.some(
    (team) =>
      team.eventId === event.id &&
      team.round === 1 &&
      !team.scratched &&
      team.headerId === headerId &&
      team.heelerId === heelerId,
  );
  if (duplicate && !event.allowRepeatPartners) {
    throw new Error("That partnership is already entered.");
  }
  const entryCount = (contestantId: string) =>
    data.teams.filter(
      (team) =>
        team.eventId === event.id &&
        team.round === 1 &&
        !team.scratched &&
        (team.headerId === contestantId || team.heelerId === contestantId),
    ).length;
  if (
    entryCount(headerId) >= event.entriesAllowed ||
    entryCount(heelerId) >= event.entriesAllowed
  ) {
    throw new Error("Entry limit exceeded.");
  }
  const team: Team = {
    id: deterministicSignupId("team", request.submissionId),
    eventId: event.id,
    headerId,
    heelerId,
    drawPosition: 0,
    status: "ready",
    rawTime: null,
    penalties: 0,
    notes: "",
    round: 1,
    checkedIn: false,
    scratched: false,
    generated: false,
    points: 0,
    ...metadata,
  };
  const registrations =
    event.competitionType === "pick-and-draw"
      ? registrationsForPickedTeam(event, team).map((registration, index) => ({
          ...registration,
          id: deterministicSignupId("registration", request.submissionId, String(index + 1)),
          ...metadata,
          notes: "",
        }))
      : [];
  return { teams: [team], registrations, existing: false };
}

export function mergeStaleOnlineEntries(
  incoming: ArenaData,
  latest: ArenaData,
): ArenaData {
  if ((incoming.revision ?? 0) === (latest.revision ?? 0)) return incoming;
  const merge = <T extends { id: string; source?: string }>(
    staffRecords: T[],
    currentRecords: T[],
  ) => {
    const ids = new Set(staffRecords.map((record) => record.id));
    return [
      ...staffRecords,
      ...currentRecords.filter(
        (record) => record.source === "online" && !ids.has(record.id),
      ),
    ];
  };
  return {
    ...incoming,
    teams: merge(incoming.teams, latest.teams),
    registrations: merge(incoming.registrations, latest.registrations),
  };
}

export function eligibleSignupPartners(
  data: ArenaData,
  event: ArenaEvent,
  contestantId: string,
  role: "Header" | "Heeler",
) {
  return data.contestants.filter((partner) => {
    if (partner.id === contestantId) return false;
    const headerId = role === "Header" ? contestantId : partner.id;
    const heelerId = role === "Heeler" ? contestantId : partner.id;
    return (
      partner.role !== (role === "Header" ? "Header" : "Heeler") &&
      contestantEligibleForRole(
        event,
        data.contestants.find((contestant) => contestant.id === headerId),
        "Header",
      ) &&
      contestantEligibleForRole(
        event,
        data.contestants.find((contestant) => contestant.id === heelerId),
        "Heeler",
      ) &&
      teamHandicapTotal(headerId, heelerId, data.contestants) <= event.handicapTotal
    );
  });
}
