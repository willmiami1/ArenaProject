import { describe, expect, it } from "vitest";
import {
  futureEventFlyers,
  pastEventWinnerFlyers,
} from "./publicFlyers";

describe("public flyer categories", () => {
  it("lists the upcoming event flyers soonest first", () => {
    expect(futureEventFlyers).toEqual([
      {
        src: "./november-20-friday-nights-roping-flyer.png",
        alt: "Destiny Ranch Arena Friday Nights Roping flyer — Friday November 20th, Fall Roping 8.5 drawpot capped at 5, draw 5 for $300, add pick or draw $60, 3 heads, incentive on #6, progressive payback starting at 60%, buckles to 3 best headers and heelers, gates 6 PM, books 7 PM, rope 8 PM, Brazilian food trucks, family fun",
      },
      {
        src: "./december-19-christmas-roping-flyer.png",
        alt: "Destiny Ranch Arena Christmas Roping flyer — Saturday December 19th, 9.5 drawpot capped at 5.5, draw 6 for $300, add pick or draw $50, 3 heads, incentive on #6, 50% payback plus $1,200 gift card for the 12 best ranked ropers, buckles to top 3 teams and 3 best headers and heelers, gates 7 AM, books 8 AM, rope 9 AM, Brazilian food trucks, family fun",
      },
      {
        src: "./january-9-10-arena-farewell-flyer.png",
        alt: "Destiny Ranch Arena Farewell flyer — Saturday January 9th #10.5 and Sunday January 10th #8.5, draw 2 for $200, add pick or draw $100, 4 heads Saturday and 3 heads Sunday, 60% payback, capped at 300 teams, two $15,000 12 x 6 ft Vertex LED screens for the high point roper of each day with 200 paying teams, buckles to 1st, 2nd, 3rd both days, gates 7:30 AM, books 8:30 AM, rope 9:30 AM, food truck, family fun",
      },
    ]);
  });

  it("keeps the winners flyers in the past winners category, newest first", () => {
    expect(pastEventWinnerFlyers).toEqual([
      {
        src: "./september-25-winners-flyer.jpg",
        alt: "Destiny Ranch Arena Friday September 25 Team Roping winners flyer — 9 Slide Round Robin, 1st Jerry Vandermaas & John Hudson, 2nd Tyle Upshaw & Michael Dudash, 3rd Doug Pence x Kadu Amaral, Incentive #7 Tyler Upshaw & Jason Bell, next roping Oct 17th",
      },
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
