import type { ArenaMeet } from "./types";

function validScheduleDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : null;
}

function validScheduleTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, hours, minutes] = match.map(Number);
  return hours < 24 && minutes < 60 ? value : null;
}

function localScheduleDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function sortWorkspaceMeets(
  meets: ArenaMeet[],
  today = localScheduleDate(),
) {
  return meets
    .map((meet, index) => ({ meet, index }))
    .sort((left, right) => {
      const leftDate = validScheduleDate(left.meet.date);
      const rightDate = validScheduleDate(right.meet.date);
      if (!leftDate || !rightDate) {
        if (leftDate) return -1;
        if (rightDate) return 1;
        return left.index - right.index;
      }
      const leftPast = leftDate < today;
      const rightPast = rightDate < today;
      if (leftPast !== rightPast) return leftPast ? 1 : -1;
      const dateComparison = leftDate.localeCompare(rightDate);
      if (leftPast && dateComparison) return -dateComparison;
      if (dateComparison) return dateComparison;
      const leftTime = validScheduleTime(left.meet.startTime);
      const rightTime = validScheduleTime(right.meet.startTime);
      if (!leftTime || !rightTime) {
        if (leftTime) return -1;
        if (rightTime) return 1;
        return left.index - right.index;
      }
      return leftTime.localeCompare(rightTime) || left.index - right.index;
    })
    .map(({ meet }) => meet);
}
