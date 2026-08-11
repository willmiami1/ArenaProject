export const PUBLIC_SIGNUP_PRICE_USD = 200;
export const PUBLIC_SIGNUP_SESSION_MINUTES = 30;
export const PUBLIC_SIGNUP_ENTRY_RESERVATION_MINUTES = 45;

const PUBLIC_COMPETITION_TYPES = new Set([
  "slide",
  "round-robin",
  "pick-and-draw",
]);

export class PublicSignupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublicSignupError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new PublicSignupError(code, message);
};

const registrationClosesAt = (event) =>
  new Date(`${event.date}T${event.startTime}:00`).getTime() - 60 * 60 * 1000;

export const publicSignupEventIsOpen = (event, now = Date.now()) =>
  PUBLIC_COMPETITION_TYPES.has(event?.competitionType) &&
  event.registrationOpen === true &&
  event.status !== "Complete" &&
  event.drawLocked !== true &&
  now < registrationClosesAt(event);

const contestantCanRole = (contestant, role) =>
  contestant?.role === "Both" || contestant?.role === role;

const contestantWithinHandicap = (event, contestant, role) =>
  Number(
    role === "Header"
      ? contestant?.headerHandicap || 0
      : contestant?.heelerHandicap || 0,
  ) <= Number(event.maxContestantHandicap ?? 99);

const handicapTotal = (header, heeler) =>
  Number(header?.headerHandicap || 0) + Number(heeler?.heelerHandicap || 0);

const eligibleRoles = (event, contestant) =>
  ["Header", "Heeler"].filter(
    (role) =>
      contestantCanRole(contestant, role) &&
      contestantWithinHandicap(event, contestant, role),
  );

const partnerIsEligible = (event, contestant, partner, role) => {
  if (!partner || partner.id === contestant.id) return false;
  const header = role === "Header" ? contestant : partner;
  const heeler = role === "Heeler" ? contestant : partner;
  return (
    contestantCanRole(header, "Header") &&
    contestantCanRole(heeler, "Heeler") &&
    contestantWithinHandicap(event, header, "Header") &&
    contestantWithinHandicap(event, heeler, "Heeler") &&
    handicapTotal(header, heeler) <= Number(event.handicapTotal)
  );
};

const publicContestant = ({
  id,
  name,
  role,
  headerHandicap,
  heelerHandicap,
}) => ({ id, name, role, headerHandicap, heelerHandicap });

const partnersForEvent = (workspace, event, contestant) =>
  workspace.contestants
    .map((partner) => ({
      ...publicContestant(partner),
      eligibleRoles: eligibleRoles(event, contestant).filter((role) =>
        partnerIsEligible(event, contestant, partner, role),
      ),
    }))
    .filter((partner) => partner.eligibleRoles.length > 0);

export function buildPublicSignupOptions(
  workspace,
  contestant,
  signupToken,
  expiresAt,
  now = Date.now(),
) {
  const competitions = workspace.events
    .filter((event) => publicSignupEventIsOpen(event, now))
    .map((event) => {
      const roles = eligibleRoles(event, contestant);
      const partners =
        event.competitionType === "pick-and-draw"
          ? partnersForEvent(workspace, event, contestant)
          : [];
      return {
        id: event.id,
        name: event.name,
        date: event.date,
        startTime: event.startTime,
        competitionType: event.competitionType,
        registrationClosesAt: new Date(
          registrationClosesAt(event),
        ).toISOString(),
        roles,
        requiresPartner: event.competitionType === "pick-and-draw",
        partners,
      };
    })
    .filter(
      (event) =>
        event.roles.length > 0 &&
        (!event.requiresPartner || event.partners.length > 0),
    )
    .sort((left, right) =>
      `${left.date}T${left.startTime}:${left.id}`.localeCompare(
        `${right.date}T${right.startTime}:${right.id}`,
      ),
    );

  return {
    contestant: publicContestant(contestant),
    signupToken,
    expiresAt,
    price: { amount: PUBLIC_SIGNUP_PRICE_USD, currency: "USD" },
    competitions,
  };
}

const activeTeamIncludes = (team, contestantId) =>
  team.round === 1 &&
  !team.generated &&
  !team.scratched &&
  (team.headerId === contestantId || team.heelerId === contestantId);

export function normalizePublicSignupSelections(
  workspace,
  contestant,
  selections,
  submissionId,
  now = Date.now(),
  requireOpenRegistration = true,
) {
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 50) {
    fail("INVALID_SELECTIONS", "Choose at least one open roping.");
  }

  const eventById = new Map(workspace.events.map((event) => [event.id, event]));
  const seen = new Set();
  const normalized = selections.map((selection) => {
    const competitionId = String(selection?.competitionId || "");
    if (!competitionId || seen.has(competitionId)) {
      fail(
        "DUPLICATE_COMPETITION",
        "Each roping can be selected only once per payment.",
      );
    }
    seen.add(competitionId);
    const event = eventById.get(competitionId);
    if (
      !event ||
      !PUBLIC_COMPETITION_TYPES.has(event.competitionType) ||
      (requireOpenRegistration && !publicSignupEventIsOpen(event, now))
    ) {
      fail(
        "COMPETITION_UNAVAILABLE",
        "A selected roping is no longer open for online registration.",
      );
    }

    const role = selection?.role;
    if (!eligibleRoles(event, contestant).includes(role)) {
      fail("INVALID_ROLE", `Choose an eligible position for ${event.name}.`);
    }

    const hasExistingRegistration = workspace.registrations.some(
      (registration) =>
        registration.eventId === event.id &&
        registration.contestantId === contestant.id &&
        registration.submissionId !== submissionId &&
        registration.status !== "scratched",
    );
    const hasExistingTeam = workspace.teams.some(
      (team) =>
        team.eventId === event.id &&
        team.submissionId !== submissionId &&
        activeTeamIncludes(team, contestant.id),
    );
    if (hasExistingRegistration || hasExistingTeam) {
      fail(
        "ALREADY_ENTERED",
        `${contestant.name} already has an active entry in ${event.name}.`,
      );
    }

    if (event.competitionType !== "pick-and-draw") {
      return { competitionId, role };
    }

    const partnerId = String(selection?.partnerId || "");
    const partner = workspace.contestants.find((item) => item.id === partnerId);
    if (!partnerIsEligible(event, contestant, partner, role)) {
      fail("INVALID_PARTNER", `Choose an eligible partner for ${event.name}.`);
    }
    const header = role === "Header" ? contestant : partner;
    const heeler = role === "Heeler" ? contestant : partner;
    const activeTeams = workspace.teams.filter(
      (team) =>
        team.eventId === event.id &&
        team.submissionId !== submissionId &&
        team.round === 1 &&
        !team.generated &&
        !team.scratched,
    );
    if (
      !event.allowRepeatPartners &&
      activeTeams.some(
        (team) => team.headerId === header.id && team.heelerId === heeler.id,
      )
    ) {
      fail(
        "DUPLICATE_PARTNERSHIP",
        `That partnership is already entered in ${event.name}.`,
      );
    }
    if (
      activeTeams.filter((team) => activeTeamIncludes(team, header.id)).length >=
        Number(event.entriesAllowed || 1) ||
      activeTeams.filter((team) => activeTeamIncludes(team, heeler.id)).length >=
        Number(event.entriesAllowed || 1)
    ) {
      fail("ENTRY_LIMIT", `Entry limit exceeded for ${event.name}.`);
    }
    return { competitionId, role, partnerId };
  });

  return normalized.sort((left, right) =>
    left.competitionId.localeCompare(right.competitionId),
  );
}

export const publicSignupFingerprintPayload = (
  contestantId,
  submissionId,
  selections,
) =>
  JSON.stringify({
    contestantId,
    submissionId,
    competitionIds: selections.map(({ competitionId }) => competitionId),
    selections,
    amount: selections.length * PUBLIC_SIGNUP_PRICE_USD,
    currency: "USD",
  });

export function storedPublicSignupSelectionsForRetry(
  selections,
  storedSelections,
) {
  if (!Array.isArray(selections) || !Array.isArray(storedSelections)) {
    fail(
      "SUBMISSION_CONFLICT",
      "That submission ID is already bound to a different checkout.",
    );
  }
  const storedByCompetitionId = new Map(
    storedSelections.map((selection) => [
      selection.competitionId,
      selection,
    ]),
  );
  const retrySelections = selections
    .map((selection) => {
      const competitionId = String(selection?.competitionId || "");
      const stored = storedByCompetitionId.get(competitionId);
      return {
        competitionId,
        role: selection?.role,
        ...(stored && Object.prototype.hasOwnProperty.call(stored, "partnerId")
          ? { partnerId: String(selection?.partnerId || "") }
          : {}),
      };
    })
    .sort((left, right) =>
      left.competitionId.localeCompare(right.competitionId),
    );
  if (JSON.stringify(retrySelections) !== JSON.stringify(storedSelections)) {
    fail(
      "SUBMISSION_CONFLICT",
      "That submission ID is already bound to a different checkout.",
    );
  }
  return storedSelections;
}

export const publicSignupPaymentCreatedIntentIsStale = (
  intent,
  reservations,
  now = Date.now(),
) =>
  intent?.status === "payment-created" &&
  Array.isArray(reservations) &&
  (reservations.length === 0 ||
    reservations.every(
      (reservation) => new Date(reservation.expiresAt).getTime() <= now,
    ));

export function successfulCredentialMetadata(credential, updatedAt = new Date()) {
  const next = { ...credential, failedAttempts: 0, updatedAt };
  delete next.lockedUntil;
  return next;
}

export function failedCredentialMetadata(
  credential,
  now = Date.now(),
  maximumAttempts = 5,
  lockMinutes = 15,
) {
  const lockExpiresAt = credential.lockedUntil
    ? new Date(credential.lockedUntil).getTime()
    : 0;
  const failedAttempts =
    (lockExpiresAt && lockExpiresAt <= now
      ? 0
      : Number(credential.failedAttempts || 0)) + 1;
  const next = {
    ...credential,
    failedAttempts,
    updatedAt: new Date(now),
  };
  if (failedAttempts >= maximumAttempts) {
    next.lockedUntil = new Date(now + lockMinutes * 60 * 1000);
  } else {
    delete next.lockedUntil;
  }
  return next;
}
