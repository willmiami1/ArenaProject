import { describe, expect, it } from "vitest";
import {
  futureEventFlyers,
  pastEventWinnerFlyers,
} from "./publicFlyers";

describe("public flyer categories", () => {
  it("lists the upcoming event flyers soonest first", () => {
    expect(futureEventFlyers).toEqual([
      {
        src: "./september-25-round-robin-9-slide-flyer.jpg",
        alt: "Destiny Ranch Arena Friday September 25 Team Roping flyer — Round Robin #9 Slide, 3 sec up/down, 15x15, 2 heads, 20 to short round, capped at #6, $300, gate 6 PM, books 7 PM, rope 8 PM, payouts based on 30 riders, buckles to first place, Tomahawk ropes and $100 Home Depot gift cards to all winners",
      },
      {
        src: "./january-9-10-arena-farewell-flyer.png",
        alt: "Destiny Ranch Arena Farewell flyer — Saturday and Sunday January 9th and 10th, 5.5 drawpot both days, draw 5 for $300, LED screen for best ranked roper under #4.5, saddle for highest money earner, buckles 1st to 3rd both days",
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
