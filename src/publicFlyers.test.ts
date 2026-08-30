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
        alt: "Destiny Ranch Arena September 11 Friday Night Round Robin flyer — gates 6 PM, rope 8 PM, 20 best teams to short round",
      },
      {
        src: "./september-25-friday-night-roping-flyer.png",
        alt: "Destiny Ranch Arena September 25 Friday Night Roping flyer — Drawpot capped at 5.5, gates 6 PM, rope 8 PM",
      },
      {
        src: "./october-3-round-robin-9-slide-flyer.png",
        alt: "Destiny Ranch Arena Saturday, October 3 Team Roping flyer — Round Robin #9 Slide, 15x15, roping at 8:00 PM",
      },
    ]);
  });

  it("keeps the winners flyers in the past winners category, newest first", () => {
    expect(pastEventWinnerFlyers).toEqual([
      {
        src: "./august-30-winners-flyer.png",
        alt: "Destiny Ranch Arena Sunday August 30 Team Roping winners flyer — 1st Harrison Teixeira x Kadu Amaral, 2nd Harrison Teixeira x Marcos Machado, 3rd Harrison Teixeira x Tony Lazo, next roping Sept 11",
      },
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
