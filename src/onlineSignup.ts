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
import {
  assertOnlineRegistrationOpen,
  assertRegistrationDeskOpen,
} from "./registrationWindow";

export interface SignupRequest {
  submissionId: string;
  contestantId: string;
  eventId: string;
  role?: "Header" | "Heeler";
  drawRole?: "Header" | "Heeler";
  entries?: number;
  partnerId?: string;
  partnerIds?: string[];
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
  registrationMode: "online" | "staff" = "online",
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
  if (registrationMode === "staff") assertRegistrationDeskOpen(event);
  else assertOnlineRegistrationOpen(event, now);
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

  const requestedPartnerIds =
    event.competitionType === "pick-and-draw" &&
    Array.isArray(request.partnerIds)
      ? [...new Set(request.partnerIds)]
      : request.partnerId
        ? [request.partnerId]
        : [];
  if (requestedPartnerIds.some((partnerId) => !safeId(partnerId))) {
    throw new Error("Choose an eligible partner.");
  }
  const drawRegistrations: EventRegistration[] = [];
  if (event.competitionType === "pick-and-draw") {
    const entries = Number(request.entries ?? 0);
    const minimumDraws = Number(event.minDrawsAllowed ?? 0);
    const drawRole = request.drawRole ?? request.role;
    const allowedRoles =
      event.pickDrawRole === "both"
        ? ["Header", "Heeler"]
        : [event.pickDrawRole === "header" ? "Header" : "Heeler"];
    if (
      !Number.isInteger(entries) ||
      entries < minimumDraws ||
      entries > event.entriesAllowed ||
      (entries > 0 &&
        (!drawRole ||
          !allowedRoles.includes(drawRole) ||
          !contestantEligibleForRole(event, contestant, drawRole)))
    ) {
      throw new Error(
        `This competition requires at least ${minimumDraws} draw entr${minimumDraws === 1 ? "y" : "ies"}.`,
      );
    }
    if (!requestedPartnerIds.length && entries === 0) {
      throw new Error("Enter at least one draw or choose a picked partner.");
    }
    const standaloneEntries = data.registrations
      .filter(
        (registration) =>
          registration.eventId === event.id &&
          registration.contestantId === contestant.id &&
          !registration.sourceTeamId &&
          registration.status !== "scratched",
      )
      .reduce((sum, registration) => sum + registration.entries, 0);
    const existingPickedTeams = data.teams.filter(
      (team) =>
        team.eventId === event.id &&
        team.round === 1 &&
        !team.scratched &&
        !team.generated &&
        (team.headerId === contestant.id || team.heelerId === contestant.id),
    ).length;
    if (
      standaloneEntries +
        existingPickedTeams +
        entries +
        requestedPartnerIds.length >
      event.entriesAllowed
    ) {
      throw new Error("Draw entry limit exceeded.");
    }
    if (entries > 0) {
      drawRegistrations.push({
        id: deterministicSignupId("registration", request.submissionId, "draw"),
        eventId: event.id,
        contestantId: contestant.id,
        role: drawRole!,
        entries,
        checkedIn: false,
        status: "entered",
        notes: "",
        ...metadata,
      });
    }
    if (!requestedPartnerIds.length) {
      return { teams: [], registrations: drawRegistrations, existing: false };
    }
  }

  if (!request.role) throw new Error("Choose your team position.");
  const activeTeams = data.teams.filter(
    (team) =>
      team.eventId === event.id &&
      team.round === 1 &&
      !team.scratched,
  );
  const entryCount = (contestantId: string) =>
    activeTeams.filter(
      (team) =>
        (team.headerId === contestantId || team.heelerId === contestantId),
    ).length;
  if (entryCount(contestant.id) + requestedPartnerIds.length > event.entriesAllowed) {
    throw new Error("Entry limit exceeded.");
  }
  const partners = requestedPartnerIds.map((partnerId) => {
    const partner = data.contestants.find((item) => item.id === partnerId);
    if (!partner || partner.id === contestant.id) {
      throw new Error("Choose an eligible partner.");
    }
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
    if (
      teamHandicapTotal(headerId, heelerId, data.contestants) >
      event.handicapTotal
    ) {
      throw new Error("Team handicap exceeds the competition limit.");
    }
    if (
      !event.allowRepeatPartners &&
      activeTeams.some(
        (team) =>
          team.headerId === headerId && team.heelerId === heelerId,
      )
    ) {
      throw new Error("That partnership is already entered.");
    }
    const partnerStandaloneEntries = data.registrations
      .filter(
        (registration) =>
          registration.eventId === event.id &&
          registration.contestantId === partner.id &&
          !registration.sourceTeamId &&
          registration.status !== "scratched",
      )
      .reduce((sum, registration) => sum + registration.entries, 0);
    if (
      partnerStandaloneEntries + entryCount(partner.id) + 1 >
      event.entriesAllowed
    ) {
      throw new Error(`Entry limit exceeded for ${partner.name}.`);
    }
    return { partner, headerId, heelerId };
  });
  const teams: Team[] = partners.map(({ headerId, heelerId }, index) => ({
    id:
      requestedPartnerIds.length === 1 && !request.partnerIds?.length
        ? deterministicSignupId("team", request.submissionId)
        : deterministicSignupId(
            "team",
            request.submissionId,
            `pick-${index + 1}`,
          ),
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
  }));
  const registrations =
    event.competitionType === "pick-and-draw"
      ? teams.flatMap((team, teamIndex) =>
          registrationsForPickedTeam(event, team).map(
            (registration, roleIndex) => ({
              ...registration,
              id: deterministicSignupId(
                "registration",
                request.submissionId,
                `pick-${teamIndex + 1}-${roleIndex + 1}`,
              ),
              ...metadata,
              notes: "",
            }),
          ),
        )
      : [];
  return {
    teams,
    registrations: [...drawRegistrations, ...registrations],
    existing: false,
  };
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
