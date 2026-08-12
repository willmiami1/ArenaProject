import { describe, expect, it } from "vitest";
import {
  contestantWaiverStatusPresentation,
  normalizeContestantWaiverStatusesResponse,
  readyContestantWaiverStatuses,
  type ContestantWaiverStatusesState,
} from "./contestantWaiverStatus";

const response = normalizeContestantWaiverStatusesResponse({
  waiverVersion: "2026-08-12-v1",
  statuses: [
    {
      contestantId: "signed-rider",
      signedAt: "2026-08-12T15:00:00.000Z",
      eventId: "event-1",
      signerName: "Private Signer",
      signatureDataUrl: "data:image/png;base64,private",
    },
    {
      contestantId: "retired-rider",
      signedAt: "2026-08-12T14:00:00.000Z",
      eventId: "old-event",
    },
  ],
});

describe("contestant waiver status UI state", () => {
  it("retains only the minimal bridge contract", () => {
    expect(Object.keys(response.statuses[0])).toEqual([
      "contestantId",
      "signedAt",
      "eventId",
    ]);
  });

  it("keeps loading and failures distinct from not signed", () => {
    expect(
      contestantWaiverStatusPresentation(
        { phase: "loading" },
        "unsigned-rider",
      ),
    ).toEqual({ kind: "loading", label: "Loading…" });
    expect(
      contestantWaiverStatusPresentation(
        { phase: "error", message: "Network unavailable" },
        "unsigned-rider",
      ),
    ).toEqual({
      kind: "unavailable",
      label: "Unavailable",
      message: "Network unavailable",
    });
  });

  it("shows signed metadata and not signed only after a successful load", () => {
    const state = readyContestantWaiverStatuses(response, [
      "signed-rider",
      "unsigned-rider",
    ]);
    const signed = contestantWaiverStatusPresentation(
      state,
      "signed-rider",
      "en-US",
    );
    expect(signed).toMatchObject({
      kind: "signed",
      label: "Signed",
      signedAt: "2026-08-12T15:00:00.000Z",
    });
    expect(signed.kind === "signed" && signed.dateLabel).toBe(
      new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date("2026-08-12T15:00:00.000Z")),
    );
    expect(signed.kind === "signed" && signed.fullDateLabel).toContain("2026");
    expect(
      contestantWaiverStatusPresentation(state, "unsigned-rider"),
    ).toEqual({ kind: "not-signed", label: "Not signed" });
  });

  it("ignores old contestant IDs and keeps the latest row per stable ID", () => {
    const state = readyContestantWaiverStatuses(
      {
        waiverVersion: response.waiverVersion,
        statuses: [
          ...response.statuses,
          {
            contestantId: "signed-rider",
            signedAt: "2026-08-12T16:00:00.000Z",
            eventId: "event-2",
          },
        ],
      },
      ["signed-rider", "unsigned-rider"],
    );
    expect(state.phase).toBe("ready");
    if (state.phase !== "ready") return;
    expect([...state.byContestantId.keys()]).toEqual(["signed-rider"]);
    expect(state.byContestantId.get("signed-rider")).toMatchObject({
      eventId: "event-2",
      signedAt: "2026-08-12T16:00:00.000Z",
    });
    const refreshedContestants = readyContestantWaiverStatuses(response, [
      "signed-rider",
      "retired-rider",
    ]);
    expect(
      contestantWaiverStatusPresentation(
        refreshedContestants,
        "retired-rider",
      ).kind,
    ).toBe("signed");
  });

  it("rejects malformed responses instead of treating them as unsigned", () => {
    expect(() =>
      normalizeContestantWaiverStatusesResponse({
        waiverVersion: "",
        statuses: [],
      }),
    ).toThrow(/invalid waiver version/);
    expect(() =>
      normalizeContestantWaiverStatusesResponse({
        waiverVersion: "current",
        statuses: [
          {
            contestantId: "rider",
            signedAt: "not-a-date",
            eventId: "event",
          },
        ],
      }),
    ).toThrow(/invalid waiver status/);
  });

  it("maps an edited contestant by its unchanged stable ID", () => {
    const state: ContestantWaiverStatusesState =
      readyContestantWaiverStatuses(response, ["signed-rider"]);
    expect(
      contestantWaiverStatusPresentation(state, "signed-rider").kind,
    ).toBe("signed");
  });
});
