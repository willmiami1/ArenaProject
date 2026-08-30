import { describe, expect, it } from "vitest";
import {
  futureEventFlyers,
  pastEventWinnerFlyers,
} from "./publicFlyers";

describe("public flyer categories", () => {
  it("lists the upcoming event flyers soonest first", () => {
    expect(futureEventFlyers).toEqual([
      {
        src: "./september-11-round-robin-2026-flyer.png",
        alt: "Destiny Ranch Arena September 11 Round Robin event flyer",
      },
    ]);
  });

  it("keeps the winners flyers in the past winners category, newest first", () => {
    expect(pastEventWinnerFlyers).toEqual([
      {
        src: "./august-21-winners-flyer.jpg",
        alt: "Destiny Ranch Arena August 21 Round Robin winners",
      },
      {
        src: "./august-7-flyer.jpg",
        alt: "Destiny Ranch Arena August 7 #10 Slide winners",
      },
    ]);
  });
});
