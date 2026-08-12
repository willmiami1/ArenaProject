import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import {
  registrationDeskProjection,
  unavailableRegistrationDeskWaiverDocument,
  type RegistrationDeskData,
} from "./registrationDeskData";
import {
  registrationDeskWaiverParticipants,
  registrationDeskWaiverSignature,
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
  waiverDocument: {
    title: "Configured document",
    version: "2026-08",
    text: "Authoritative text supplied by the arena.",
    available: true,
  },
});

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
  it("keeps signing unavailable without authoritative legal text", () => {
    const data = registrationDeskProjection(workspace());
    expect(data.waiverDocument).toEqual(
      unavailableRegistrationDeskWaiverDocument,
    );
    expect(() =>
      submitLocalRegistrationDeskWaiver(data, signatureRequest),
    ).toThrow(/authoritative legal document is configured/);
    expect(JSON.stringify(data.waiverDocument)).not.toContain(
      "Authoritative text supplied",
    );
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
      waiverVersion: "2026-08",
    });
    expect(
      registrationDeskWaiverSignature(
        result.data,
        "event-one",
        "rider-one",
      ),
    ).toEqual(result.signature);
    expect(JSON.stringify(result)).not.toContain("signatureDataUrl");
    expect(JSON.stringify(result)).not.toContain("iVBORw0KGgo");
  });

  it("keeps waiver status event-specific", () => {
    const result = submitLocalRegistrationDeskWaiver(
      availableDeskData(),
      signatureRequest,
    );
    expect(
      registrationDeskWaiverSignature(
        result.data,
        "event-one",
        "rider-one",
      ),
    ).toBeDefined();
    expect(
      registrationDeskWaiverSignature(
        result.data,
        "event-two",
        "rider-one",
      ),
    ).toBeUndefined();
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
