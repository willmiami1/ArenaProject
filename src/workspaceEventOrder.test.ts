import { describe, expect, it } from "vitest";
import type { ArenaMeet } from "./types";
import { sortWorkspaceMeets } from "./workspaceEventOrder";

const meet = (
  id: string,
  date: string,
  startTime = "19:00",
): ArenaMeet => ({
  id,
  name: id,
  date,
  startTime,
  location: "Destiny Ranch Arena",
  producer: "Destiny Ranch",
});

describe("workspace event ordering", () => {
  it("puts the closest upcoming events first without mutating storage order", () => {
    const meets = [
      meet("furthest", "2026-09-18"),
      meet("later-same-day", "2026-08-21", "20:00"),
      meet("past", "2026-08-07"),
      meet("closest", "2026-08-21", "19:00"),
    ];

    expect(sortWorkspaceMeets(meets, "2026-08-10").map(({ id }) => id)).toEqual([
      "closest",
      "later-same-day",
      "furthest",
      "past",
    ]);
    expect(meets.map(({ id }) => id)).toEqual([
      "furthest",
      "later-same-day",
      "past",
      "closest",
    ]);
  });

  it("keeps equal schedules stable and places invalid schedules last", () => {
    const meets = [
      meet("invalid-date", "2026-02-30"),
      meet("first", "2026-08-21"),
      meet("invalid-time", "2026-08-21", "25:00"),
      meet("second", "2026-08-21"),
      meet("missing-date", ""),
    ];

    expect(sortWorkspaceMeets(meets, "2026-08-10").map(({ id }) => id)).toEqual([
      "first",
      "second",
      "invalid-time",
      "invalid-date",
      "missing-date",
    ]);
  });

  it("places past events after upcoming events with the most recent past date first", () => {
    const meets = [
      meet("oldest", "2026-07-01"),
      meet("future", "2026-08-21"),
      meet("recent", "2026-08-09"),
    ];

    expect(sortWorkspaceMeets(meets, "2026-08-10").map(({ id }) => id)).toEqual([
      "future",
      "recent",
      "oldest",
    ]);
  });
});
