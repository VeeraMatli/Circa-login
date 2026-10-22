import { describe, it, expect } from "vitest";
import {
  age,
  compatibility,
  distanceKm,
  pair,
  reciprocal,
  type Candidate,
} from "../src/domain";
import { sanitizeImage } from "../src/media";
const a: Candidate = {
  user_id: "a",
  date_of_birth: "1994-01-01",
  gender: "woman",
  relationship_intent: "serious",
  interests: '["Hiking","Music"]',
  languages: '["English"]',
  lifestyle: '{"smoking":"no"}',
};
const b: Candidate = { ...a, user_id: "b", gender: "man" };
const p = {
  min_age: 18,
  max_age: 60,
  genders: "[]",
  radius_km: 50,
  intentions: "[]",
};
describe("adult eligibility", () => {
  it("rejects an impossible date", () =>
    expect(() => age("2000-02-31")).toThrow());
  it("observes the eighteenth birthday in UTC", () => {
    expect(age("2008-10-22", new Date("2026-10-21T23:59:59Z"))).toBe(17);
    expect(age("2008-10-22", new Date("2026-10-22T00:00:00Z"))).toBe(18);
  });
  it("handles leap-day birthdays conservatively", () =>
    expect(age("2008-02-29", new Date("2026-02-28T00:00:00Z"))).toBe(17));
});
describe("Connection Compass", () => {
  it("requires reciprocal gender preferences", () =>
    expect(
      reciprocal(a, { ...p, genders: '["man"]' }, b, {
        ...p,
        genders: '["man"]',
      }),
    ).toBe(false));
  it("excludes minors", () =>
    expect(reciprocal(a, p, { ...b, date_of_birth: "2014-01-01" }, p)).toBe(
      false,
    ));
  it("requires age preference fit in both directions", () =>
    expect(reciprocal(a, p, b, { ...p, min_age: 60, max_age: 80 })).toBe(
      false,
    ));
  it("explains shared factors without inferred attributes", () => {
    const r = compatibility(a, b);
    expect(r.score).toBe(100);
    expect(r.highlights).toContain("Both enjoy Hiking");
    expect(r.version).toBe("compass-1");
  });
  it("does not invent shared interests", () =>
    expect(
      compatibility(a, { ...b, interests: "[]" }).highlights.some((x) =>
        x.startsWith("Both enjoy"),
      ),
    ).toBe(false));
  it("canonicalizes unordered match pairs", () =>
    expect(pair("b", "a")).toEqual(pair("a", "b")));
  it("computes approximate geographic separation", () => {
    expect(
      distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }),
    ).toBeCloseTo(111.2, 0);
  });
});
describe("media safety", () => {
  it("rejects executable content", () =>
    expect(() =>
      sanitizeImage(
        new TextEncoder().encode('<script>alert("invalid-image")</script>'),
      ),
    ).toThrow());
  it("rejects oversized media before scanning", () =>
    expect(() => sanitizeImage(new Uint8Array(10485761))).toThrow());
  it("rejects a truncated JPEG", () =>
    expect(() =>
      sanitizeImage(
        new Uint8Array([255, 216, ...new Array<number>(40).fill(0)]),
      ),
    ).toThrow());
  it("strips PNG text and EXIF metadata", () => {
    const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const chunk = (type: string, data: Uint8Array) => {
      const b = new Uint8Array(12 + data.length);
      new DataView(b.buffer).setUint32(0, data.length);
      b.set(new TextEncoder().encode(type), 4);
      b.set(data, 8);
      return b;
    };
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, 1);
    new DataView(ihdr.buffer).setUint32(4, 1);
    const chunks = [
      signature,
      chunk("IHDR", ihdr),
      chunk("eXIf", new TextEncoder().encode("GPS secret")),
      chunk("IEND", new Uint8Array()),
    ];
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    expect(new TextDecoder().decode(sanitizeImage(bytes).bytes)).not.toContain(
      "GPS secret",
    );
  });
});
