import type { ArenaData, Contestant } from "./types";

export interface ContestantAccountRequest {
  name: string;
  email: string;
  phone: string;
  hometown: string;
  role: Contestant["role"];
  headerHandicap: number;
  heelerHandicap: number;
  pin: string;
}

export const normalizedContestantEmail = (value: string) =>
  value.trim().toLowerCase();
export const normalizedContestantPhone = (value: string) =>
  value.replace(/\D/g, "");

export function validateContestantAccount(
  request: ContestantAccountRequest,
) {
  const name = request.name.trim().replace(/\s+/g, " ");
  const email = normalizedContestantEmail(request.email);
  const phone = normalizedContestantPhone(request.phone);
  const hometown = request.hometown.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 100) {
    throw new Error("Enter your full name.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Enter a valid email address.");
  }
  if (phone.length < 10 || phone.length > 15) {
    throw new Error("Enter a valid phone number.");
  }
  if (!["Header", "Heeler", "Both"].includes(request.role)) {
    throw new Error("Choose your roping position.");
  }
  if (!/^\d{4}$/.test(request.pin)) {
    throw new Error("Choose a four-digit PIN.");
  }
  const headerHandicap =
    request.role === "Heeler" ? 0 : Number(request.headerHandicap);
  const heelerHandicap =
    request.role === "Header" ? 0 : Number(request.heelerHandicap);
  if (
    !Number.isFinite(headerHandicap) ||
    !Number.isFinite(heelerHandicap) ||
    headerHandicap < 0 ||
    heelerHandicap < 0 ||
    headerHandicap > 20 ||
    heelerHandicap > 20
  ) {
    throw new Error("Enter valid handicaps between 0 and 20.");
  }
  return {
    ...request,
    name,
    email,
    phone,
    hometown,
    headerHandicap,
    heelerHandicap,
  };
}

export function createLocalContestantAccount(
  data: ArenaData,
  request: ContestantAccountRequest,
  id: string,
) {
  const validated = validateContestantAccount(request);
  if (
    data.contestants.some(
      (contestant) =>
        normalizedContestantEmail(contestant.email ?? "") === validated.email,
    )
  ) {
    throw new Error("A contestant account already uses that email.");
  }
  if (
    data.contestants.some(
      (contestant) =>
        normalizedContestantPhone(contestant.phone) === validated.phone,
    )
  ) {
    throw new Error("A contestant account already uses that phone number.");
  }
  const contestant: Contestant = {
    id,
    name: validated.name,
    email: validated.email,
    phone: validated.phone,
    hometown: validated.hometown,
    role: validated.role,
    headerHandicap: validated.headerHandicap,
    heelerHandicap: validated.heelerHandicap,
    photo: "",
  };
  return { contestant, contestants: [...data.contestants, contestant] };
}
