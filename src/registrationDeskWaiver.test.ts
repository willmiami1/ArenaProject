import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import {
  normalizeRegistrationDeskData,
  registrationDeskProjection,
  registrationDeskWaiverDocumentFixture,
  unavailableRegistrationDeskWaiverDocument,
  type RegistrationDeskData,
} from "./registrationDeskData";
import {
  registrationDeskOutstandingWaiverParticipants,
  registrationDeskWaiverParticipants,
  registrationDeskWaiverStatus,
  submitLocalRegistrationDeskWaiver,
} from "./registrationDeskWaiver";
import type { RegistrationDeskRosterEntry } from "./registrationDeskRoster";
import {
  paddedSignatureBounds,
  signatureAlphaBounds,
  signatureCanvasBitmapSize,
  signatureMarkIsValid,
} from "./signatureCanvas";
import { projectPublicArenaData } from "./publicData";
import type { ArenaData, ArenaEvent, Contestant } from "./types";

const event = (id: string): ArenaEvent => ({
  ...defaultCompetitionSettings,
  id,
  parentEventId: "meet",
  name: id.toUpperCase(),
  date: "2026-08-12",
  startTime: "18:00",
  location: "Arena",
  status: "Live",
  registrationOpen: true,
  entryFee: 50,
});

const contestant = (id: string): Contestant => ({
  id,
  name: id.toUpperCase(),
  role: "Both",
  headerHandicap: 4,
  heelerHandicap: 4,
  photo: "",
  phone: "",
  email: `${id}@example.com`,
  hometown: "Arena",
});

const workspace = (): ArenaData => ({
  participantDatabaseVersion: 2,
  meets: [],
  events: [event("event-one"), event("event-two")],
  contestants: [contestant("rider-one"), contestant("rider-two")],
  teams: [],
  registrations: [],
  spectators: [],
  spectatorPredictions: [],
  activeEventId: "event-one",
});

const availableDeskData = (): RegistrationDeskData => ({
  ...registrationDeskProjection(workspace()),
});

const authoritativeWaiverText = `In consideration of being allowed to participate in team roping or any horse back riding at Destiny Ranch Arena located at Destiny Ranch LLC. 2549 E C 476 Bushnell FL 33513 also known as Destiny Ranch Events.
 I, for myself hereby acknowledge the risks of injury or damage (to property, personal injury and/or death) involved in participating in the above mentioned activity. I understand that there is a risk in riding live animals and acknowledge that my participation in this activity is purely voluntary. I assume full responsibility for myself, for any bodily injury, accident, illness, paralysis, death, loss of personal property and expenses thereof as a result of any accident which may occur while I participate in this activity at Destiny Ranch Arena.. I further agree to abide by all safety instructions, and to wear any safety equipment provided on the horseback ride while participating in the activity. I, for myself and hereby release, acquit and forgive Destiny Ranch LLC, family, heirs, employees, visitors and volunteers for any and all liability of any nature for any and all injury or damage (including property damage, personal injury, illness, paralysis, and/or death) as the result of my participation in the horseback activities. I, for myself also hereby expressly waive any claim, lawsuit, complaint, charge, or cause of action against Destiny Ranch LLC, family, heirs, employees, visitors, and volunteers and for any and all injury or damage including property damage, personal injury, illness, paralysis, and/or death, This waiver is made voluntarily. I have read this Release and Waiver Agreement and understand that by signing this document, I am waiving valuable legal rights including any and all rights that I may have against the Releases named above.`;

const signatureRequest = {
  eventId: "event-one",
  contestantId: "rider-one",
  signerName: "  Rider One  ",
  signatureDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
  accepted: true as const,
};

const rosterEntry = (
  key: string,
  contestantId: string,
  name: string,
): RegistrationDeskRosterEntry => ({
  key,
  eventId: "event-one",
  recordType: "team",
  recordId: key,
  contestantId,
  name,
  role: "Header",
  handicap: 4,
  generated: false,
});

describe("Registration Desk tablet waiver", () => {
  it("projects the exact authoritative document in the local mirror", () => {
    const data = registrationDeskProjection(workspace());
    expect(data.waiverDocument).toEqual({
      title: "ACTIVITY WAIVER AGREEMENT",
      version: "2026-08-12-v1",
      text: authoritativeWaiverText,
      available: true,
    });
    expect(data.waiverDocument).toEqual(
      registrationDeskWaiverDocumentFixture,
    );
    expect(data.waiverDocument.text.split("\n")).toHaveLength(2);
    expect(data.waiverDocument.text.split("\n")[1].startsWith(" I,")).toBe(
      true,
    );
  });

  it("keeps signing unavailable when an embedded backend has no legal text", () => {
    const data = normalizeRegistrationDeskData({
      ...registrationDeskProjection(workspace()),
      waiverDocument: unavailableRegistrationDeskWaiverDocument,
    });
    expect(() =>
      submitLocalRegistrationDeskWaiver(data, signatureRequest),
    ).toThrow(/authoritative legal document is configured/);
  });

  it("rejects blank and genuinely minimal signature marks", () => {
    expect(signatureMarkIsValid([])).toBe(false);
    expect(signatureMarkIsValid([[{ x: 0.5, y: 0.5 }]])).toBe(false);
    expect(
      signatureMarkIsValid([
        [
          { x: 0.5, y: 0.5 },
          { x: 0.505, y: 0.5 },
          { x: 0.51, y: 0.5 },
          { x: 0.515, y: 0.5 },
          { x: 0.52, y: 0.5 },
          { x: 0.525, y: 0.5 },
        ],
      ]),
    ).toBe(false);
    expect(
      signatureMarkIsValid([
        [
          { x: 0.1, y: 0.5 },
          { x: 0.2, y: 0.35 },
          { x: 0.3, y: 0.6 },
          { x: 0.4, y: 0.4 },
          { x: 0.55, y: 0.58 },
          { x: 0.7, y: 0.42 },
        ],
      ]),
    ).toBe(true);
  });

  it("uses high-DPI dimensions and conservative ink bounds", () => {
    expect(signatureCanvasBitmapSize(320, 180, 2)).toEqual({
      width: 640,
      height: 360,
      pixelRatio: 2,
    });
    const pixels = new Uint8ClampedArray(5 * 4 * 4);
    pixels[(1 * 5 + 2) * 4 + 3] = 255;
    pixels[(2 * 5 + 3) * 4 + 3] = 255;
    const bounds = signatureAlphaBounds(pixels, 5, 4);
    expect(bounds).toEqual({ x: 2, y: 1, width: 2, height: 2 });
    expect(paddedSignatureBounds(bounds!, 5, 4, 2)).toEqual({
      x: 0,
      y: 0,
      width: 5,
      height: 4,
    });
  });

  it("records successful signing as metadata without retaining the PNG", () => {
    const result = submitLocalRegistrationDeskWaiver(
      availableDeskData(),
      signatureRequest,
      new Date("2026-08-12T13:45:00.000Z"),
    );
    expect(result.signature).toMatchObject({
      eventId: "event-one",
      contestantId: "rider-one",
      contestantName: "RIDER-ONE",
      signerName: "Rider One",
      signedAt: "2026-08-12T13:45:00.000Z",
      waiverVersion: "2026-08-12-v1",
    });

    expect(
      registrationDeskWaiverStatus(
        result.data,
        "event-one",
        "rider-one",
      ),
    ).toMatchObject({
      eventId: result.signature.eventId,
      contestantId: result.signature.contestantId,
      signedAt: result.signature.signedAt,
    });
    expect(JSON.stringify(result)).not.toContain("signatureDataUrl");
    expect(JSON.stringify(result)).not.toContain("iVBORw0KGgo");
  });

  it("allows upcoming-event waivers and rejects completed events", () => {
    const upcoming = availableDeskData();
    upcoming.events[0].status = "Upcoming";
    expect(
      submitLocalRegistrationDeskWaiver(upcoming, signatureRequest).signature
        .eventId,
    ).toBe("event-one");

    const completed = availableDeskData();
    completed.events[0].status = "Complete";
    expect(() =>
      submitLocalRegistrationDeskWaiver(completed, signatureRequest),
    ).toThrow("live or upcoming");
  });

  it("recognizes the current waiver globally across live events", () => {
    const result = submitLocalRegistrationDeskWaiver(
      availableDeskData(),
      signatureRequest,
    );
    expect(
      registrationDeskWaiverStatus(
        result.data,
        "event-one",
        "rider-one",
      ),
    ).toBeDefined();
    expect(
      registrationDeskWaiverStatus(
        result.data,
        "event-two",
        "rider-one",
      ),
    ).toMatchObject({
      contestantId: "rider-one",
      eventId: "event-one",
    });
  });

  it("normalizes global status to minimal fields only", () => {
    const statusWithPrivateFields = {
      contestantId: "rider-one",
      eventId: "event-one",
      signedAt: "2026-08-12T13:45:00.000Z",
      signerName: "Must not reach the UI",
      signatureDataUrl: signatureRequest.signatureDataUrl,
    };
    const normalized = normalizeRegistrationDeskData({
      ...availableDeskData(),
      waiverStatus: {
        waiverVersion: registrationDeskWaiverDocumentFixture.version,
        statuses: [statusWithPrivateFields],
      },
    });
    expect(normalized.waiverStatus.statuses).toEqual([
      {
        contestantId: "rider-one",
        eventId: "event-one",
        signedAt: "2026-08-12T13:45:00.000Z",
      },
    ]);
    expect(JSON.stringify(normalized.waiverStatus)).not.toContain("signerName");
    expect(JSON.stringify(normalized.waiverStatus)).not.toContain(
      "signatureDataUrl",
    );
  });

  it("requires a signature bound to the exact authoritative version", () => {
    const data = availableDeskData();
    data.waiverStatus = {
      waiverVersion: "2026-08-11-v1",
      statuses: [
        {
          contestantId: "rider-one",
          eventId: "event-two",
          signedAt: "2026-08-11T13:45:00.000Z",
        },
      ],
    };
    data.waiverSignatures = [
      {
        id: "old-waiver",
        eventId: "event-one",
        contestantId: "rider-one",
        contestantName: "RIDER-ONE",
        signerName: "Rider One",
        signedAt: "2026-08-11T13:45:00.000Z",
        waiverVersion: "2026-08-11-v1",
      },
    ];
    expect(
      registrationDeskWaiverStatus(data, "event-one", "rider-one"),
    ).toBeUndefined();
  });

  it("drops confirmed contestants from the desk roster waiver list", () => {
    const roster = [
      rosterEntry("team-1-header", "rider-one", "RIDER ONE"),
      rosterEntry("team-1-heeler", "rider-two", "RIDER TWO"),
    ];
    const pending = availableDeskData();
    expect(
      registrationDeskOutstandingWaiverParticipants(
        pending,
        "event-one",
        roster,
      ),
    ).toEqual([
      { contestantId: "rider-one", name: "RIDER ONE" },
      { contestantId: "rider-two", name: "RIDER TWO" },
    ]);

    const signed = submitLocalRegistrationDeskWaiver(
      pending,
      signatureRequest,
    ).data;
    expect(
      registrationDeskOutstandingWaiverParticipants(signed, "event-one", roster),
    ).toEqual([{ contestantId: "rider-two", name: "RIDER TWO" }]);
    expect(
      registrationDeskOutstandingWaiverParticipants(signed, "event-two", roster),
    ).toEqual([{ contestantId: "rider-two", name: "RIDER TWO" }]);
  });

  it("lists no waivers once every roster contestant is confirmed", () => {
    const roster = [rosterEntry("team-1-header", "rider-one", "RIDER ONE")];
    const signed = submitLocalRegistrationDeskWaiver(
      availableDeskData(),
      signatureRequest,
    ).data;
    expect(
      registrationDeskOutstandingWaiverParticipants(signed, "event-one", roster),
    ).toEqual([]);
  });

  it("still lists a contestant whose only waiver is an old version", () => {
    const data = availableDeskData();
    data.waiverStatus = {
      waiverVersion: "2026-08-11-v1",
      statuses: [
        {
          contestantId: "rider-one",
          eventId: "event-one",
          signedAt: "2026-08-11T13:45:00.000Z",
        },
      ],
    };
    expect(
      registrationDeskOutstandingWaiverParticipants(data, "event-one", [
        rosterEntry("team-1-header", "rider-one", "RIDER ONE"),
      ]),
    ).toEqual([{ contestantId: "rider-one", name: "RIDER ONE" }]);
  });

  it("deduplicates repeated roster rows while tracking each picked-team rider", () => {
    const participants = registrationDeskWaiverParticipants([
      rosterEntry("team-1-header", "rider-one", "RIDER ONE"),
      rosterEntry("team-2-header", "rider-one", "RIDER ONE"),
      rosterEntry("team-1-heeler", "rider-two", "RIDER TWO"),
      rosterEntry("team-2-heeler", "rider-two", "RIDER TWO"),
    ]);
    expect(participants).toEqual([
      { contestantId: "rider-one", name: "RIDER ONE" },
      { contestantId: "rider-two", name: "RIDER TWO" },
    ]);
  });

  it("does not expose waiver data through workspace or public projections", () => {
    const arenaWorkspace = workspace();
    const result = submitLocalRegistrationDeskWaiver(
      availableDeskData(),
      signatureRequest,
    );
    expect(arenaWorkspace).not.toHaveProperty("waiverDocument");
    expect(arenaWorkspace).not.toHaveProperty("waiverSignatures");
    const publicData = projectPublicArenaData(
      {
        ...arenaWorkspace,
        waiverDocument: result.data.waiverDocument,
        waiverSignatures: result.data.waiverSignatures,
        signatureDataUrl: signatureRequest.signatureDataUrl,
      } as ArenaData,
      new Date("2026-08-12T12:00:00.000Z"),
    );
    expect(JSON.stringify(publicData)).not.toContain("waiver");
    expect(JSON.stringify(publicData)).not.toContain("iVBORw0KGgo");
  });
});
