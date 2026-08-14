import { createHash } from "crypto";

export const PUBLIC_SIGNUP_PRICE_USD = 200;
export const PUBLIC_SIGNUP_SESSION_MINUTES = 30;
export const PUBLIC_SIGNUP_ENTRY_RESERVATION_MINUTES = 45;
export const PUBLIC_SIGNUP_CARD_METHOD = "wix-payments";
export const PUBLIC_SIGNUP_CASH_METHOD = "cash";

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

export function assertPublicSignupTokenFormat(signupToken) {
  if (!/^[a-f0-9]{64}$/.test(String(signupToken || ""))) {
    fail("SESSION_EXPIRED", "Sign in again to continue registration.");
  }
}

export function assertPublicSignupSessionActive(session, now = Date.now()) {
  if (!session || new Date(session.expiresAt).getTime() <= now) {
    fail("SESSION_EXPIRED", "Sign in again to continue registration.");
  }
}

export const roundRobinRoleLimit = (event, role) => {
  if (event?.competitionType !== "round-robin") return 0;
  const limit = Number(role === "Header" ? event.maxHeaders : event.maxHeelers);
  return Number.isInteger(limit) && limit > 0 ? limit : 0;
};

export const roundRobinReservationOccupiesRole = (reservation, role) =>
  !["Header", "Heeler"].includes(reservation?.role) ||
  reservation.role === role;

export const roundRobinReservationEntries = (reservation) => {
  const entries = Number(reservation?.entries);
  return Number.isInteger(entries) && entries > 0 ? entries : 1;
};

export const activeRoundRobinRoleRegistrationCount = (
  registrations,
  eventId,
  role,
  excludeSubmissionId = "",
  excludeContestantId = "",
) =>
  registrations
    .filter(
      (registration) =>
        registration.eventId === eventId &&
        registration.role === role &&
        registration.status === "entered" &&
        !(
          excludeSubmissionId &&
          excludeContestantId &&
          registration.submissionId === excludeSubmissionId &&
          registration.contestantId === excludeContestantId
        ) &&
        Number.isInteger(Number(registration.entries)) &&
        Number(registration.entries) > 0,
    )
    .reduce(
      (total, registration) => total + Number(registration.entries),
      0,
    );

export function assertRoundRobinRoleCapacity(
  event,
  registrations,
  role,
  pendingCount = 1,
  excludeSubmissionId = "",
  excludeContestantId = "",
) {
  const limit = roundRobinRoleLimit(event, role);
  if (
    limit > 0 &&
    activeRoundRobinRoleRegistrationCount(
      registrations,
      event.id,
      role,
      excludeSubmissionId,
      excludeContestantId,
    ) +
      pendingCount >
      limit
  ) {
    fail(
      "ROLE_CAPACITY_REACHED",
      `${role} registration is full.`,
    );
  }
}

export const roundRobinRoleCapacities = (event, registrations) => {
  if (event?.competitionType !== "round-robin") return undefined;
  const capacities = ["Header", "Heeler"].flatMap((role) => {
    const maximum = roundRobinRoleLimit(event, role);
    if (!maximum) return [];
    const registered = activeRoundRobinRoleRegistrationCount(
      registrations,
      event.id,
      role,
    );
    return [{ role, registered, maximum, full: registered >= maximum }];
  });
  return capacities.length ? capacities : undefined;
};

export const roundRobinRoleCapacityProjection = (event, registrations) => {
  const roleCapacities = roundRobinRoleCapacities(event, registrations);
  return roleCapacities ? { roleCapacities } : {};
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
        ...roundRobinRoleCapacityProjection(event, workspace.registrations),
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

const activeReservationConflict = () =>
  fail(
    "ACTIVE_SIGNUP_RESERVATION_CONFLICT",
    "Workspace changes conflict with an active public signup. Wait for it to finish or expire, then retry.",
  );

export function assertWorkspaceSupportsActivePublicSignupReservations(
  workspace,
  reservations,
  intents,
  now = Date.now(),
) {
  const intentsById = new Map(intents.map((intent) => [intent._id, intent]));
  const activeStatuses = new Set([
    "creating",
    "payment-created",
    "pending",
    "settling",
    "cash-finalizing",
    "fulfillment-failed",
  ]);
  const activeReservations = reservations.filter((reservation) => {
    const intent = intentsById.get(reservation.intentId);
    if (!intent) activeReservationConflict();
    return activeStatuses.has(intent.status);
  });
  const activeIntentIds = new Set(
    activeReservations.map((reservation) => reservation.intentId),
  );

  for (const intentId of activeIntentIds) {
    const intent = intentsById.get(intentId);
    const contestant = workspace.contestants.find(
      (item) => item.id === intent.contestantId,
    );
    if (!contestant) activeReservationConflict();
    try {
      normalizePublicSignupSelections(
        workspace,
        contestant,
        JSON.parse(intent.selections),
        intent.submissionId,
        now,
        false,
      );
    } catch (error) {
      if (error instanceof PublicSignupError || error instanceof SyntaxError) {
        activeReservationConflict();
      }
      throw error;
    }
  }

  const pendingReservations = activeReservations.filter((reservation) => {
    const intent = intentsById.get(reservation.intentId);
    return !workspace.registrations.some(
      (registration) =>
        registration.eventId === reservation.competitionId &&
        registration.contestantId === intent.contestantId &&
        registration.submissionId === intent.submissionId &&
        registration.role === reservation.role &&
        registration.status === "entered",
    );
  });
  const reservationsByCompetition = new Map();
  for (const reservation of pendingReservations) {
    const event = workspace.events.find(
      ({ id }) => id === reservation.competitionId,
    );
    if (!event) activeReservationConflict();
    const current =
      reservationsByCompetition.get(reservation.competitionId) || [];
    current.push(reservation);
    reservationsByCompetition.set(reservation.competitionId, current);
  }

  for (const [competitionId, eventReservations] of reservationsByCompetition) {
    const event = workspace.events.find(({ id }) => id === competitionId);
    if (event.competitionType === "round-robin") {
      for (const role of ["Header", "Heeler"]) {
        const reservedCount = eventReservations
          .filter((reservation) =>
            roundRobinReservationOccupiesRole(reservation, role),
          )
          .reduce(
            (total, reservation) =>
              total + roundRobinReservationEntries(reservation),
            0,
          );
        try {
          assertRoundRobinRoleCapacity(
            event,
            workspace.registrations,
            role,
            reservedCount,
          );
        } catch (error) {
          if (error instanceof PublicSignupError) {
            activeReservationConflict();
          }
          throw error;
        }
      }
    }

    if (event.competitionType !== "pick-and-draw") continue;
    const participantReservationCounts = new Map();
    const partnershipReservationCounts = new Map();
    for (const reservation of eventReservations) {
      let participantIds;
      try {
        participantIds = JSON.parse(reservation.participantIds);
      } catch {
        activeReservationConflict();
      }
      if (!Array.isArray(participantIds) || participantIds.length === 0) {
        activeReservationConflict();
      }
      for (const participantId of participantIds) {
        participantReservationCounts.set(
          participantId,
          (participantReservationCounts.get(participantId) || 0) + 1,
        );
      }
      if (reservation.partnershipKey) {
        partnershipReservationCounts.set(
          reservation.partnershipKey,
          (partnershipReservationCounts.get(reservation.partnershipKey) || 0) +
            1,
        );
      }
    }

    const activeTeams = workspace.teams.filter(
      (team) =>
        team.eventId === competitionId && !team.generated && !team.scratched,
    );
    const entryLimit = Number(event.entriesAllowed || 1);
    for (const [participantId, reservedCount] of participantReservationCounts) {
      if (
        activeTeams.filter((team) => activeTeamIncludes(team, participantId))
          .length +
          reservedCount >
        entryLimit
      ) {
        activeReservationConflict();
      }
    }
    if (
      !event.allowRepeatPartners &&
      [...partnershipReservationCounts.values()].some((count) => count > 1)
    ) {
      activeReservationConflict();
    }
  }
}

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
    assertRoundRobinRoleCapacity(
      event,
      workspace.registrations,
      role,
      1,
      submissionId,
      contestant.id,
    );

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
  paymentMethod = PUBLIC_SIGNUP_CARD_METHOD,
) =>
  JSON.stringify({
    contestantId,
    submissionId,
    competitionIds: selections.map(({ competitionId }) => competitionId),
    selections,
    amount: selections.length * PUBLIC_SIGNUP_PRICE_USD,
    currency: "USD",
    ...(paymentMethod === PUBLIC_SIGNUP_CARD_METHOD ? {} : { paymentMethod }),
  });

export const publicSignupIntentPaymentMethod = (intent) =>
  intent?.paymentMethod || PUBLIC_SIGNUP_CARD_METHOD;

export function assertPublicSignupIntentPaymentMethod(intent, paymentMethod) {
  if (publicSignupIntentPaymentMethod(intent) !== paymentMethod) {
    fail(
      "SUBMISSION_CONFLICT",
      "That submission ID is already bound to a different checkout.",
    );
  }
}

export function assertCashSubmissionHasNoActiveCardPayment(intents) {
  const activeStatuses = new Set([
    "creating",
    "payment-created",
    "pending",
    "settling",
  ]);
  if (
    (intents || []).some(
      (intent) =>
        publicSignupIntentPaymentMethod(intent) === PUBLIC_SIGNUP_CARD_METHOD &&
        activeStatuses.has(intent.status),
    )
  ) {
    fail(
      "PAYMENT_IN_PROGRESS",
      "A card payment is already in progress. Finish or cancel it before choosing cash at the event.",
    );
  }
}

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

const publicSignupRecordId = (kind, intent, competitionId, suffix = "") =>
  `${kind}-${createHash("sha256")
    .update(`${intent.fingerprint}:${competitionId}:${suffix}`)
    .digest("hex")
    .slice(0, 32)}`;

export function buildPublicSignupRecords(
  workspace,
  contestant,
  intent,
  selections,
  {
    paid,
    paymentMethod,
    paymentReference,
    submittedAt = new Date().toISOString(),
  },
) {
  const metadata = {
    payerContestantId: contestant.id,
    paid,
    paymentMethod,
    paymentReference,
    paymentAmount: PUBLIC_SIGNUP_PRICE_USD,
    paymentCurrency: "USD",
    source: "online",
    submissionId: intent.submissionId,
    submissionFingerprint: intent.fingerprint,
    submittedAt,
  };
  const teams = [];
  const registrations = [];
  selections.forEach((selection) => {
    const event = workspace.events.find(
      (item) => item.id === selection.competitionId,
    );
    if (event.competitionType !== "pick-and-draw") {
      registrations.push({
        id: publicSignupRecordId("online-registration", intent, event.id),
        eventId: event.id,
        contestantId: contestant.id,
        role: selection.role,
        entries: 1,
        checkedIn: false,
        status: "entered",
        notes: "",
        ...metadata,
      });
      return;
    }

    const partner = workspace.contestants.find(
      (item) => item.id === selection.partnerId,
    );
    const header = selection.role === "Header" ? contestant : partner;
    const heeler = selection.role === "Heeler" ? contestant : partner;
    const teamId = publicSignupRecordId("online-team", intent, event.id);
    teams.push({
      id: teamId,
      eventId: event.id,
      headerId: header.id,
      heelerId: heeler.id,
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
    });
    const roles =
      event.pickDrawRole === "both"
        ? ["Header", "Heeler"]
        : [event.pickDrawRole === "header" ? "Header" : "Heeler"];
    roles.forEach((role, index) => {
      registrations.push({
        id: publicSignupRecordId(
          "online-registration",
          intent,
          event.id,
          `${role}-${index}`,
        ),
        eventId: event.id,
        contestantId: role === "Header" ? header.id : heeler.id,
        sourceTeamId: teamId,
        role,
        entries: 1,
        checkedIn: false,
        status: "entered",
        notes: "",
        ...metadata,
      });
    });
  });
  return { teams, registrations };
}

export const publicSignupCashConfirmation = (intent) => ({
  submissionId: intent.submissionId,
  status: "cash-due",
  paymentMethod: PUBLIC_SIGNUP_CASH_METHOD,
  amount: Number(intent.amount),
  currency: "USD",
  competitionIds: JSON.parse(intent.competitionIds),
  message: `Registration submitted. Pay $${Number(intent.amount)} in cash at the event.`,
});

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
