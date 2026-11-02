import { describe, expect, it } from "vitest";
import { videoForEventDate } from "./publicEventVideos";

describe("public event videos", () => {
  it("shows the $100k weekend video on both January roping days", () => {
    expect(videoForEventDate("2027-01-09")?.src).toBe("./january-weekend-100k-payout.mp4");
    expect(videoForEventDate("2027-01-10")?.src).toBe("./january-weekend-100k-payout.mp4");
  });

  it("does not attach a video to other events", () => {
    expect(videoForEventDate("2026-11-20")).toBeUndefined();
    expect(videoForEventDate("2026-12-19")).toBeUndefined();
  });
});
