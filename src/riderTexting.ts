import type { ArenaEvent, Contestant, EventRegistration, Team } from "./types";

export type TextAudience = "roster" | { eventId: string };

export interface TextRecipient {
  contestant: Contestant;
  phone: string;
}

export interface TextAudienceResult {
  recipients: TextRecipient[];
  missingPhone: Contestant[];
}

// Keeps digits only; US numbers get a +1 so every carrier app accepts them.
export function normalizeSmsPhone(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return "";
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

export function ridersForTextAudience(
  audience: TextAudience,
  contestants: Contestant[],
  registrations: EventRegistration[],
  teams: Team[],
): TextAudienceResult {
  let pool: Contestant[];
  if (audience === "roster") {
    pool = contestants;
  } else {
    const ids = new Set<string>();
    registrations.forEach((registration) => {
      if (
        registration.eventId === audience.eventId &&
        registration.status !== "scratched"
      ) {
        ids.add(registration.contestantId);
      }
    });
    teams.forEach((team) => {
      if (team.eventId === audience.eventId) {
        ids.add(team.headerId);
        ids.add(team.heelerId);
      }
    });
    pool = contestants.filter((contestant) => ids.has(contestant.id));
  }
  const sorted = [...pool].sort((a, b) => a.name.localeCompare(b.name));
  const recipients: TextRecipient[] = [];
  const missingPhone: Contestant[] = [];
  const seenPhones = new Set<string>();
  sorted.forEach((contestant) => {
    const phone = normalizeSmsPhone(contestant.phone);
    if (!phone) {
      missingPhone.push(contestant);
      return;
    }
    if (seenPhones.has(phone)) return;
    seenPhones.add(phone);
    recipients.push({ contestant, phone });
  });
  return { recipients, missingPhone };
}

export function isAppleMessagesPlatform(userAgent: string): boolean {
  return /iPhone|iPad|iPod|Macintosh/i.test(userAgent);
}

// Apple's Messages app only reads multiple recipients from the
// `sms:/open?addresses=` form; Android and most desktop handlers take the
// comma-separated `sms:a,b?body=` form.
export function buildSmsHref(
  phones: string[],
  body: string,
  apple: boolean,
): string {
  const recipients = phones.filter(Boolean);
  const encodedBody = encodeURIComponent(body);
  if (apple) {
    const params = [
      recipients.length ? `addresses=${recipients.join(",")}` : "",
      body ? `body=${encodedBody}` : "",
    ].filter(Boolean);
    return `sms:/open${params.length ? `?${params.join("&")}` : ""}`;
  }
  return `sms:${recipients.join(",")}${body ? `?body=${encodedBody}` : ""}`;
}

export function textableEvents(events: ArenaEvent[]): ArenaEvent[] {
  return [...events].sort((a, b) => b.date.localeCompare(a.date));
}
