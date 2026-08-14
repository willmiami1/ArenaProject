import { describe, expect, it } from "vitest";
import {
  futureEventFlyers,
  pastEventWinnerFlyers,
} from "./publicFlyers";

describe("public flyer categories", () => {
  it("keeps the three current event flyers together", () => {
    expect(futureEventFlyers.map((flyer) => flyer.src)).toEqual([
      "./september-11-round-robin-flyer.png",
      "./august-21-flyer.png",
      "./august-28-flyer.png",
    ]);
  });

  it("places the August 7 winners flyer in the past winners category", () => {
    expect(pastEventWinnerFlyers).toEqual([
      {
        src: "./august-7-flyer.jpg",
        alt: "Destiny Ranch Arena August 7 #10 Slide winners",
      },
    ]);
    expect(futureEventFlyers).not.toContainEqual(pastEventWinnerFlyers[0]);
  });
});
