import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildPublicSignupOptions,
  buildPublicSignupRecords,
  normalizePublicSignupSelections,
} from "../wix/backend/public-signup-contract.js";

// Online signup does not offer a partner picker at all. A rider registering
// for a pick-and-draw enters the draw as a solo entry, exactly like the
// Registration Desk's "draws" entry type. Partners are picked at the event.

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const publicSite = source("./PublicSite.tsx");
const bridge = source("./wixBridge.ts");
const signupPage = publicSite.slice(
  publicSite.indexOf("function SignupPage("),
  publicSite.indexOf("function NotFound("),
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
const headerOnlyRider = {
  id: "contestant-3",
  name: "RIDER THREE",
  role: "Header",
  headerHandicap: 3,
  heelerHandicap: 0,
};

const event = (id, competitionType = "pick-and-draw", overrides = {}) => ({
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
  maxHeaders: 10,
  maxHeelers: 10,
  pickDrawRole: "both",
  ...overrides,
});

const workspace = (events, overrides = {}) => ({
  events,
  contestants: [contestant, partner, headerOnlyRider],
  teams: [],
  registrations: [],
  ...overrides,
});

const intent = {
  submissionId: "submission-1",
  fingerprint: "fingerprint-1",
};

const payment = {
  paid: true,
  paymentMethod: "wix-payments",
  paymentReference: "reference-1",
  submittedAt: "2099-08-01T00:00:00.000Z",
};

const now = Date.parse("2099-08-01T00:00:00.000Z");
const normalize = (space, rider, selections) =>
  normalizePublicSignupSelections(
    space,
    rider,
    selections,
    intent.submissionId,
    now,
  );
const errorCode = (run) => {
  try {
    run();
  } catch (error) {
    return error.code;
  }
  return undefined;
};
const options = (space, rider) =>
  buildPublicSignupOptions(space, rider, "token", "2099-08-01T00:00:00.000Z", now);
// requireOpenRegistration false: re-normalizing an intent already paid for.
const drain = (space, rider, selections) =>
  normalizePublicSignupSelections(
    space,
    rider,
    selections,
    intent.submissionId,
    now,
    false,
  );

describe("pick-and-draw partners are not offered by the shared backend contract", () => {
  it("enters the draw as a solo entry", () => {
    const events = [event("pick-1")];
    const selections = normalize(workspace(events), contestant, [
      { competitionId: "pick-1", role: "Header" },
    ]);
    expect(selections).toEqual([{ competitionId: "pick-1", role: "Header" }]);
    expect("partnerId" in selections[0]).toBe(false);

    const { teams, registrations } = buildPublicSignupRecords(
      workspace(events),
      contestant,
      intent,
      selections,
      payment,
    );

    // No team: a solo draw entry is a standalone registration, which is what
    // the desk's "draws" entry type produces, so draw generation treats them
    // alike.
    expect(teams).toEqual([]);
    expect(registrations).toHaveLength(1);
    expect(registrations[0].eventId).toBe("pick-1");
    expect(registrations[0].contestantId).toBe(contestant.id);
    expect(registrations[0].role).toBe("Header");
    expect(registrations[0].entries).toBe(1);
    expect(registrations[0].status).toBe("entered");
    expect(registrations[0].checkedIn).toBe(false);
    expect(registrations[0].source).toBe("online");
    // The standalone discriminator: entry accounting counts rows without a
    // sourceTeamId as solo entries.
    expect("sourceTeamId" in registrations[0]).toBe(false);
  });

  it("reuses the proven standalone registration shape for solo draw entries", () => {
    const soloDraw = buildPublicSignupRecords(
      workspace([event("pick-1")]),
      contestant,
      intent,
      [{ competitionId: "pick-1", role: "Header" }],
      payment,
    ).registrations[0];
    const slideEntry = buildPublicSignupRecords(
      workspace([event("slide-1", "slide")]),
      contestant,
      intent,
      [{ competitionId: "slide-1", role: "Header" }],
      payment,
    ).registrations[0];

    expect(Object.keys(soloDraw).sort()).toEqual(Object.keys(slideEntry).sort());
  });

  it("rejects a submitted partner outright", () => {
    expect(
      errorCode(() =>
        normalize(workspace([event("pick-1")]), contestant, [
          { competitionId: "pick-1", role: "Header", partnerId: partner.id },
        ]),
      ),
    ).toBe("PARTNER_NOT_OFFERED");
  });

  it("still fulfills an already-paid partnered intent as its picked team", () => {
    // Rejecting these would take the money and strand the entry, so they drain
    // as the team that was actually bought.
    const events = [event("pick-1")];
    const selections = drain(workspace(events), contestant, [
      { competitionId: "pick-1", role: "Header", partnerId: partner.id },
    ]);
    expect(selections[0].partnerId).toBe(partner.id);

    const { teams, registrations } = buildPublicSignupRecords(
      workspace(events),
      contestant,
      intent,
      selections,
      payment,
    );
    expect(teams).toHaveLength(1);
    expect(teams[0].headerId).toBe(contestant.id);
    expect(teams[0].heelerId).toBe(partner.id);
    expect(registrations).toHaveLength(2);
    expect(
      registrations.every(
        (registration) => registration.sourceTeamId === teams[0].id,
      ),
    ).toBe(true);
  });

  it("offers no partners even when eligible partners exist", () => {
    // contestant and partner are a valid pairing for this event, so the old
    // payload listed each as a pick for the other.
    const offered = options(workspace([event("pick-1")]), contestant)
      .competitions[0];
    expect(offered.partners).toEqual([]);
    expect(offered.requiresPartner).toBe(false);
    expect(offered.drawRoles).toEqual(["Header", "Heeler"]);
  });

  it("rejects an entry in a position the competition does not draw for", () => {
    const events = [event("pick-1", "pick-and-draw", { pickDrawRole: "header" })];
    expect(
      errorCode(() =>
        normalize(workspace(events), contestant, [
          { competitionId: "pick-1", role: "Heeler" },
        ]),
      ),
    ).toBe("INVALID_ROLE");
  });

  it("never marks a competition as requiring a partner", () => {
    const offered = options(
      workspace([event("pick-1"), event("slide-1", "slide")]),
      contestant,
    ).competitions;
    expect(offered).toHaveLength(2);
    expect(
      offered.every(
        (competition) =>
          competition.requiresPartner === false &&
          competition.partners.length === 0,
      ),
    ).toBe(true);
  });

  it("still offers a pick-and-draw event that has no other riders", () => {
    // Before solo entry existed this event was filtered out entirely, because a
    // partner was mandatory and none was available. Now it is the only way in.
    const lonely = {
      events: [event("pick-1")],
      contestants: [contestant],
      teams: [],
      registrations: [],
    };
    const offered = options(lonely, contestant).competitions;
    expect(offered).toHaveLength(1);
    expect(offered[0].partners).toEqual([]);
    expect(offered[0].requiresPartner).toBe(false);
  });

  it("does not offer the event to a rider who cannot fill a drawn position", () => {
    const lonely = {
      events: [event("pick-1", "pick-and-draw", { pickDrawRole: "heeler" })],
      contestants: [headerOnlyRider],
      teams: [],
      registrations: [],
    };
    expect(options(lonely, headerOnlyRider).competitions).toEqual([]);
  });

  it("shares one entry limit between solo and picked entries", () => {
    const full = workspace(
      [event("pick-1", "pick-and-draw", { entriesAllowed: 2 })],
      {
        registrations: [
          {
            id: "desk-1",
            eventId: "pick-1",
            contestantId: contestant.id,
            role: "Header",
            entries: 2,
            status: "entered",
            submissionId: "desk-submission",
          },
        ],
      },
    );
    expect(
      ["ENTRY_LIMIT", "ALREADY_ENTERED"].includes(
        errorCode(() =>
          normalize(full, contestant, [
            { competitionId: "pick-1", role: "Header" },
          ]),
        ),
      ),
    ).toBe(true);
  });

  it("counts a partner's existing solo draw entries against a draining team", () => {
    const withSolo = workspace(
      [event("pick-1", "pick-and-draw", { entriesAllowed: 1 })],
      {
        registrations: [
          {
            id: "desk-1",
            eventId: "pick-1",
            contestantId: partner.id,
            role: "Heeler",
            entries: 1,
            status: "entered",
            submissionId: "desk-submission",
          },
        ],
      },
    );
    expect(
      errorCode(() =>
        drain(withSolo, contestant, [
          { competitionId: "pick-1", role: "Header", partnerId: partner.id },
        ]),
      ),
    ).toBe("ENTRY_LIMIT");
  });

  it("does not let a scratched solo entry consume the limit", () => {
    const scratched = workspace(
      [event("pick-1", "pick-and-draw", { entriesAllowed: 1 })],
      {
        registrations: [
          {
            id: "desk-1",
            eventId: "pick-1",
            contestantId: contestant.id,
            role: "Header",
            entries: 1,
            status: "scratched",
            submissionId: "desk-submission",
          },
        ],
      },
    );
    expect(
      normalize(scratched, contestant, [
        { competitionId: "pick-1", role: "Header" },
      ]),
    ).toHaveLength(1);
  });
});

describe("the public signup page has no partner picker at all", () => {
  it("carries drawRoles through the bridge contract", () => {
    expect(bridge).toContain('drawRoles: Array<"Header" | "Heeler">;');
  });

  it("renders no partner picker, no matter what the payload carries", () => {
    expect(signupPage).not.toContain("Picked partner");
    expect(signupPage).not.toContain("Choose an eligible partner");
    expect(signupPage).not.toContain("No partner - enter the draw");
    expect(signupPage).not.toContain("public-partner-note");
    // Nothing reads the partners list or the requirement flag any more.
    expect(signupPage).not.toContain("roping.partners");
    expect(signupPage).not.toContain("roping.requiresPartner");
    expect(signupPage).not.toContain("item.requiresPartner");
  });

  it("never sets a partnerId on a selection", () => {
    expect(signupPage).not.toContain("partnerId:");
    expect(signupPage).not.toContain("selection.partnerId");
  });

  it("offers only positions the draw fills for a pick-and-draw", () => {
    expect(signupPage).toContain(
      'roping.competitionType === "pick-and-draw" ? roping.drawRoles : roping.roles',
    );
    expect(signupPage).toContain("{selectableRoles(roping).map((role) => {");
    expect(signupPage).toContain(
      "selectableRoles(roping).filter(",
    );
  });

  it("tells the rider partners are picked at the event", () => {
    expect(signupPage).toContain(
      "You are entered in the draw. Partners are picked at the event.",
    );
  });

  it("submits a selection carrying only the competition and position", () => {
    const selections = normalize(workspace([event("pick-1")]), contestant, [
      { competitionId: "pick-1", role: "Header" },
    ]);
    expect(Object.keys(selections[0]).sort()).toEqual([
      "competitionId",
      "role",
    ]);
  });
});
