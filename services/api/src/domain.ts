export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const now = () => Math.floor(Date.now() / 1000);
export const id = () => crypto.randomUUID();
export async function hash(value: string | ArrayBuffer): Promise<string> {
  const data =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function secret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function age(dob: string, date = new Date()): number {
  const birth = new Date(dob + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dob) ||
    Number.isNaN(birth.getTime()) ||
    birth.toISOString().slice(0, 10) !== dob
  )
    throw new APIError(400, "INVALID_DOB", "Enter a valid birth date.");
  let result = date.getUTCFullYear() - birth.getUTCFullYear();
  if (
    date.getUTCMonth() < birth.getUTCMonth() ||
    (date.getUTCMonth() === birth.getUTCMonth() &&
      date.getUTCDate() < birth.getUTCDate())
  )
    result--;
  return result;
}
export function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}
export const scoreVersion = "compass-1";
export interface Candidate {
  user_id: string;
  date_of_birth: string;
  gender: string;
  relationship_intent: string;
  interests: string;
  languages: string;
  lifestyle: string;
}
export interface Preferences {
  min_age: number;
  max_age: number;
  genders: string;
  radius_km: number;
  intentions: string;
}
export function reciprocal(
  a: Candidate,
  ap: Preferences,
  b: Candidate,
  bp: Preferences,
): boolean {
  const eligible = (x: Candidate, p: Preferences) => {
    const years = age(x.date_of_birth);
    const genders = JSON.parse(p.genders) as string[];
    const intents = JSON.parse(p.intentions) as string[];
    return (
      years >= 18 &&
      years >= p.min_age &&
      years <= p.max_age &&
      (!genders.length || genders.includes(x.gender)) &&
      (!intents.length || intents.includes(x.relationship_intent))
    );
  };
  return eligible(a, bp) && eligible(b, ap);
}
export function compatibility(
  a: Candidate,
  b: Candidate,
): { score: number; highlights: string[]; version: string } {
  const ai = JSON.parse(a.interests) as string[],
    bi = JSON.parse(b.interests) as string[];
  const shared = ai.filter((x) => bi.includes(x));
  const language = (JSON.parse(a.languages) as string[]).some((x) =>
    (JSON.parse(b.languages) as string[]).includes(x),
  );
  const al = JSON.parse(a.lifestyle) as Record<string, string>,
    bl = JSON.parse(b.lifestyle) as Record<string, string>;
  const keys = Object.keys(al).filter((k) => bl[k] !== undefined);
  const lifestyle = keys.length
    ? keys.filter((k) => al[k] === bl[k]).length / keys.length
    : 0;
  return {
    score: Math.round(
      (a.relationship_intent === b.relationship_intent ? 30 : 0) +
        (25 * shared.length) / Math.max(ai.length, bi.length, 1) +
        20 +
        15 * lifestyle +
        (language ? 10 : 0),
    ),
    highlights: [
      ...(a.relationship_intent === b.relationship_intent
        ? ["Shared relationship intentions"]
        : []),
      ...shared.map((x) => `Both enjoy ${x}`),
      ...(language ? ["A shared language"] : []),
    ],
    version: scoreVersion,
  };
}
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const r = Math.PI / 180,
    dlat = (b.latitude - a.latitude) * r,
    dlon = (b.longitude - a.longitude) * r;
  return (
    6371 *
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin(dlat / 2) ** 2 +
          Math.cos(a.latitude * r) *
            Math.cos(b.latitude * r) *
            Math.sin(dlon / 2) ** 2,
      ),
    )
  );
}
export const sparks = [
  "What would your ideal weekend look like?",
  "Which hobby would you love to try?",
  "Coffee date or outdoor adventure?",
  "What is a place you would love to visit again?",
];
