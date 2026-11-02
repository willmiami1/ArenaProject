export interface PublicEventVideo {
  /** Event month-day (MM-DD) values whose public cards should show this video. */
  monthDays: string[];
  src: string;
  poster: string;
  title: string;
  width: number;
  height: number;
}

export const publicEventVideos: PublicEventVideo[] = [
  {
    monthDays: ["01-09", "01-10"],
    src: "./january-weekend-100k-payout.mp4",
    poster: "./january-weekend-100k-payout-poster.jpg",
    title: "Team Roping Weekend — up to $100,000 payout, January 9th and 10th",
    width: 720,
    height: 900,
  },
];

export function videoForEventDate(date: string): PublicEventVideo | undefined {
  const monthDay = date.slice(-5);
  return publicEventVideos.find((video) => video.monthDays.includes(monthDay));
}
