import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PUBLIC_SIGNUP_CARD_METHOD,
  PUBLIC_SIGNUP_CASH_METHOD,
  PUBLIC_SIGNUP_PRICE_USD,
  assertCashSubmissionHasNoActiveCardPayment,
  assertPublicSignupIntentPaymentMethod,
  assertPublicSignupSessionActive,
  assertPublicSignupTokenFormat,
  buildPublicSignupRecords,
  normalizePublicSignupSelections,
  publicSignupCashConfirmation,
  publicSignupFingerprintPayload,
  storedPublicSignupSelectionsForRetry,
} from "../wix/backend/public-signup-contract.js";
import {
  effectivePublicPredictionState,
  publicRegisteredRiders,
  spectatorPicksAreOpen,
} from "../wix/backend/public-prediction-projection.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const publicSite = source("./PublicSite.tsx");
const styles = source("./public.css");
const bridge = source("./wixBridge.ts");
const pageRelay = source("../wix/page-code.js");
const backend = source("../wix/backend/public-signup-payments.js");
const webModule = source("../wix/backend/arena-data.web.js");
const signupPage = publicSite.slice(
  publicSite.indexOf("function SignupPage("),
  publicSite.indexOf("function NotFound("),
);
const cashBackend = backend.slice(
  backend.indexOf("async function submitPublicSignupCashLocked"),
  backend.indexOf("export async function getPublicSignupPaymentStatus"),
);
const cashRelay = pageRelay.slice(
  pageRelay.indexOf('message.action === "submitPublicSignupCash"'),
  pageRelay.indexOf('message.action === "getPublicSignupPaymentStatus"'),
);

const contestant = {
  id: "contestant-1",
  name: "RIDER ONE",
  role: "Both",
  headerHandicap: 3,
  heelerHandicap: 3,
};
const partner = {
  id: "contestant-2",
  name: "RIDER TWO",
  role: "Both",
  headerHandicap: 3,
  heelerHandicap: 3,
};
const event = (id, competitionType = "slide", overrides = {}) => ({
  id,
  name: id.toUpperCase(),
  competitionType,
  date: "2099-08-13",
  startTime: "18:00",
  registrationOpen: true,
  status: "Upcoming",
  drawLocked: false,
  entriesAllowed: 5,
  allowRepeatPartners: false,
  handicapTotal: 10,
  maxContestantHandicap: 8,
  pickDrawRole: "both",
  ...overrides,
});
const workspace = (events, overrides = {}) => ({
  events,
  contestants: [contestant, partner],
  teams: [],
  registrations: [],
  ...overrides,
});
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

describe("public cash signup frontend", () => {
  it("uses a typed cash bridge payload without a client amount", () => {
    const cashBridge = bridge.slice(
      bridge.indexOf("export function submitPublicSignupCash("),
      bridge.indexOf("export function getPublicSignupPaymentStatus("),
    );
    expect(bridge).toContain('"submitPublicSignupCash"');
    expect(bridge).toContain("export interface PublicSignupCashConfirmation");
    expect(cashBridge).toContain(
      'requestWix<PublicSignupCashConfirmation>("submitPublicSignupCash"',
    );
    expect(cashBridge).toContain("signupToken");
    expect(cashBridge).toContain("submissionId");
    expect(cashBridge).toContain("selections");
    expect(cashBridge).not.toMatch(/\bamount\b/);
  });

  it("reserves spots from the signup page without any payment UI or money amounts", () => {
    expect(signupPage).toContain("submitReservedSpot(");
    expect(signupPage).toContain("Send reservation");
    expect(signupPage).not.toContain("startPublicSignupPayment(");
    expect(signupPage).not.toContain("submitPublicSignupCash(");
    expect(signupPage).not.toContain("getPublicSignupPaymentStatus(");
    expect(signupPage).not.toContain("formatMoney");
    expect(signupPage).not.toContain("Payment method");
    expect(signupPage).not.toContain("Pay by credit card");
    expect(signupPage).not.toContain("options.price");
    expect(signupPage).toContain("reservationInFlight.current");
    expect(signupPage).toContain("reservationInFlight.current = true");
    expect(signupPage).toContain("reservationInFlight.current = false");
  });

  it("does not persist payment choice or cash confirmation locally", () => {
    expect(signupPage).not.toMatch(/localStorage|sessionStorage|ArenaData/);
    expect(signupPage).not.toMatch(
      /setItem\([^)]*(?:paymentMethod|cashConfirmation)/,
    );
  });

  it("uses responsive payment method styling without horizontal overflow", () => {
    expect(styles).toContain(
      ".public-signup .public-payment-method { display: grid; grid-template-columns: repeat(2,minmax(0,1fr));",
    );
    expect(styles).toContain(
      ".public-signup .public-payment-method { grid-template-columns: 1fr; }",
    );
    expect(styles).toContain(
      ".public-signup .public-payment-method-option { min-width: 0;",
    );
    expect(styles).toContain("overflow-wrap: anywhere");
  });
});

describe("public cash signup Wix mirror", () => {
  it("creates unpaid online entries with authoritative cash metadata", () => {
    const events = [event("slide-1"), event("pick-1", "pick-and-draw")];
    const selections = normalizePublicSignupSelections(
      workspace(events),
      contestant,
      [
        { competitionId: "slide-1", role: "Header" },
        {
          competitionId: "pick-1",
          role: "Header",
          partnerId: partner.id,
        },
      ],
      "cash-submission",
      Date.now(),
      // Online signup no longer offers a partner, so a picked team can only
      // come from an intent created before the picker was removed.
      // Re-normalizing with requireOpenRegistration false is exactly how those
      // drain, and it is the only path that still produces a team record to
      // assert cash metadata on.
      false,
    );
    const fingerprint = sha256(
      publicSignupFingerprintPayload(
        contestant.id,
        "cash-submission",
        selections,
        PUBLIC_SIGNUP_CASH_METHOD,
      ),
    );
    const intent = {
      submissionId: "cash-submission",
      fingerprint,
      amount: selections.length * PUBLIC_SIGNUP_PRICE_USD,
      competitionIds: JSON.stringify(
        selections.map(({ competitionId }) => competitionId),
      ),
    };
    const records = buildPublicSignupRecords(
      workspace(events),
      contestant,
      intent,
      selections,
      {
        paid: false,
        paymentMethod: PUBLIC_SIGNUP_CASH_METHOD,
        paymentReference: intent.submissionId,
        submittedAt: "2026-08-13T20:00:00.000Z",
      },
    );

    expect(records.teams).toHaveLength(1);
    expect(records.registrations).toHaveLength(3);
    for (const record of [...records.teams, ...records.registrations]) {
      expect(record).toMatchObject({
        paid: false,
        paymentMethod: "cash",
        paymentReference: "cash-submission",
        paymentAmount: 200,
        paymentCurrency: "USD",
        payerContestantId: contestant.id,
        source: "online",
        submissionFingerprint: fingerprint,
      });
    }
    expect(publicSignupCashConfirmation(intent)).toEqual({
      submissionId: "cash-submission",
      status: "cash-due",
      paymentMethod: "cash",
      amount: 400,
      currency: "USD",
      competitionIds: ["pick-1", "slide-1"],
      message: "Registration submitted. Pay $400 in cash at the event.",
    });
  });

  it("retains paid Wix metadata for the existing card path", () => {
    const selectedEvent = event("slide-1");
    const { registrations } = buildPublicSignupRecords(
      workspace([selectedEvent]),
      contestant,
      {
        submissionId: "card-submission",
        fingerprint: "card-fingerprint",
        paymentId: "wix-payment-1",
      },
      [{ competitionId: selectedEvent.id, role: "Header" }],
      {
        paid: true,
        paymentMethod: PUBLIC_SIGNUP_CARD_METHOD,
        paymentReference: "wix-payment-1",
      },
    );
    expect(registrations[0]).toMatchObject({
      paid: true,
      paymentMethod: "wix-payments",
      paymentReference: "wix-payment-1",
      paymentAmount: 200,
    });
  });

  it("enforces token security, idempotency, cross-mode conflicts, and active card blocking", () => {
    expect(() => assertPublicSignupTokenFormat("guessable-token")).toThrow(
      "Sign in again to continue registration.",
    );
    expect(() =>
      assertPublicSignupSessionActive(
        { expiresAt: "2026-08-13T20:00:00.000Z" },
        Date.parse("2026-08-13T20:01:00.000Z"),
      ),
    ).toThrow("Sign in again to continue registration.");

    const stored = [
      { competitionId: "a", role: "Header" },
      { competitionId: "b", role: "Heeler" },
    ];
    expect(
      storedPublicSignupSelectionsForRetry(
        [
          { competitionId: "b", role: "Heeler" },
          { competitionId: "a", role: "Header" },
        ],
        stored,
      ),
    ).toBe(stored);
    expect(() =>
      storedPublicSignupSelectionsForRetry(
        [{ competitionId: "a", role: "Heeler" }],
        stored,
      ),
    ).toThrow("That submission ID is already bound to a different checkout.");
    expect(() =>
      assertPublicSignupIntentPaymentMethod(
        { paymentMethod: "cash" },
        "wix-payments",
      ),
    ).toThrow("That submission ID is already bound to a different checkout.");
    expect(
      JSON.parse(
        publicSignupFingerprintPayload(
          contestant.id,
          "submission",
          stored,
          "cash",
        ),
      ).paymentMethod,
    ).toBe("cash");
    expect(() =>
      assertCashSubmissionHasNoActiveCardPayment([
        { status: "pending", paymentMethod: "wix-payments" },
      ]),
    ).toThrow(
      "A card payment is already in progress. Finish or cancel it before choosing cash at the event.",
    );
  });

  it("enforces and projects Round Robin role capacity", () => {
    const roundRobin = event("round-robin-1", "round-robin", {
      maxHeaders: 1,
      maxHeelers: 2,
    });
    const fullWorkspace = workspace([roundRobin], {
      registrations: [
        {
          eventId: roundRobin.id,
          contestantId: partner.id,
          role: "Header",
          entries: 1,
          status: "entered",
        },
      ],
    });
    expect(() =>
      normalizePublicSignupSelections(
        fullWorkspace,
        contestant,
        [{ competitionId: roundRobin.id, role: "Header" }],
        "cash-capacity-submission",
      ),
    ).toThrow("Header registration is full.");
    expect(backend).toContain("assertRoundRobinRoleCapacity(");
    expect(backend).toContain("roundRobinReservationOccupiesRole(");
    expect(backend).toContain("roundRobinReservationEntries(");
  });

  it("excludes unpaid cash records from public riders and predictions", () => {
    const unpaid = {
      id: "cash-team",
      eventId: "event-1",
      headerId: contestant.id,
      heelerId: partner.id,
      round: 1,
      status: "ready",
      paid: false,
    };
    const paid = { ...unpaid, id: "paid-team", paid: true };
    expect(
      publicRegisteredRiders(
        "event-1",
        [],
        [unpaid],
        new Map([contestant, partner].map((rider) => [rider.id, rider])),
      ),
    ).toEqual({ headers: [], heelers: [] });
    expect(spectatorPicksAreOpen(unpaid)).toBe(false);
    expect(
      effectivePublicPredictionState(
        { id: "event-1", activeRound: 1 },
        [unpaid, paid],
      ).runs.map(({ id }) => id),
    ).toEqual(["paid-team"]);
  });

  it("relays the envelope without creating or launching a Wix payment", () => {
    expect(backend).toContain("wixPayBackend.createPayment");
    expect(pageRelay).toContain("wixPayFrontend.startPayment");
    expect(cashBackend).not.toContain("createPayment");
    expect(cashRelay).not.toContain("startPayment");
    expect(cashBackend).toContain(
      "contestant:${session.contestantId}",
    );
    expect(backend).toMatch(
      /reservation\.intentId !== intent\._id &&\s+JSON\.parse\(reservation\.participantIds\)/,
    );
    expect(webModule).toContain(
      'publicSignupEnvelope("submitPublicSignupCash"',
    );
    expect(cashRelay).toContain(
      "await submitPublicSignupCash(message.data)",
    );
    expect(pageRelay).toMatch(
      /PUBLIC_SIGNUP_ACTIONS[\s\S]*"submitPublicSignupCash"/,
    );
  });
});
