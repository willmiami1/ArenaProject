import { describe, expect, it } from "vitest";
import {
  futureEventFlyers,
  pastEventWinnerFlyers,
} from "./publicFlyers";

describe("public flyer categories", () => {
  it("shows no future event flyers", () => {
    expect(futureEventFlyers).toEqual([]);
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
