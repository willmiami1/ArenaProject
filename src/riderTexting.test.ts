import { describe, expect, it } from "vitest";
import {
  buildSmsHref,
  isAppleMessagesPlatform,
  normalizeSmsPhone,
  ridersForTextAudience,
} from "./riderTexting";
import type { Contestant, EventRegistration, Team } from "./types";

const rider = (id: string, name: string, phone: string): Contestant => ({
  id,
  name,
  role: "Both",
  headerHandicap: 5,
  heelerHandicap: 5,
  photo: "",
  phone,
  hometown: "",
});

const contestants = [
  rider("c1", "ZED ROPER", "(305) 555-0100"),
  rider("c2", "ANN ROPER", "305-555-0101"),
  rider("c3", "BOB ROPER", ""),
  rider("c4", "DUP ROPER", "+1 305 555 0100"),
];

const registrations: EventRegistration[] = [
  { id: "r1", eventId: "e1", contestantId: "c1", role: "Header", entries: 1, checkedIn: false, status: "entered", notes: "" },
  { id: "r2", eventId: "e1", contestantId: "c3", role: "Heeler", entries: 1, checkedIn: false, status: "entered", notes: "" },
  { id: "r3", eventId: "e1", contestantId: "c2", role: "Heeler", entries: 1, checkedIn: false, status: "scratched", notes: "" },
];

const teams: Team[] = [
  { id: "t1", eventId: "e2", headerId: "c2", heelerId: "c4", drawPosition: 1, status: "pending", rawTime: null, penalties: 0, notes: "", round: 1, checkedIn: false, scratched: false, generated: false, points: 0 } as unknown as Team,
];

describe("normalizeSmsPhone", () => {
  it("adds +1 to ten-digit US numbers and keeps explicit country codes", () => {
    expect(normalizeSmsPhone("(305) 555-0100")).toBe("+13055550100");
    expect(normalizeSmsPhone("1 305 555 0100")).toBe("+13055550100");
    expect(normalizeSmsPhone("+55 11 91234 5678")).toBe("+5511912345678");
  });
  it("rejects blanks and too-short values", () => {
    expect(normalizeSmsPhone("")).toBe("");
    expect(normalizeSmsPhone("12345")).toBe("");
  });
});

describe("ridersForTextAudience", () => {
  it("lists the whole roster sorted, dedupes phones, and reports missing numbers", () => {
    const result = ridersForTextAudience("roster", contestants, registrations, teams);
    expect(result.recipients.map((r) => r.contestant.id)).toEqual(["c2", "c4"]);
    expect(result.recipients.map((r) => r.phone)).toEqual(["+13055550101", "+13055550100"]);
    expect(result.missingPhone.map((c) => c.id)).toEqual(["c3"]);
  });
  it("includes entered registrations and skips scratched ones", () => {
    const result = ridersForTextAudience({ eventId: "e1" }, contestants, registrations, teams);
    expect(result.recipients.map((r) => r.contestant.id)).toEqual(["c1"]);
    expect(result.missingPhone.map((c) => c.id)).toEqual(["c3"]);
  });
  it("includes both riders on event teams", () => {
    const result = ridersForTextAudience({ eventId: "e2" }, contestants, registrations, teams);
    expect(result.recipients.map((r) => r.contestant.id)).toEqual(["c2", "c4"]);
  });
});

describe("buildSmsHref", () => {
  it("uses the comma form with ?body for Android", () => {
    expect(buildSmsHref(["+13055550100", "+13055550101"], "Gates open 5pm", false)).toBe(
      "sms:+13055550100,+13055550101?body=Gates%20open%205pm",
    );
  });
  it("uses the /open?addresses form for Apple", () => {
    expect(buildSmsHref(["+13055550100", "+13055550101"], "Gates open 5pm", true)).toBe(
      "sms:/open?addresses=+13055550100,+13055550101&body=Gates%20open%205pm",
    );
  });
  it("omits an empty body", () => {
    expect(buildSmsHref(["+13055550100"], "", false)).toBe("sms:+13055550100");
  });
});

describe("isAppleMessagesPlatform", () => {
  it("detects iPhone, iPad, and Mac", () => {
    expect(isAppleMessagesPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe(true);
    expect(isAppleMessagesPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe(true);
    expect(isAppleMessagesPlatform("Mozilla/5.0 (Linux; Android 14)")).toBe(false);
  });
});
