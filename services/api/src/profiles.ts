import { Hono } from "hono";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { APIError, age, now, id, reciprocal, distanceKm } from "./domain";
import { auth, active, body, required, type C } from "./http";
import { D1Profiles } from "./repositories";
import type { AppEnv, ProfileRow } from "./types";
import type { Preferences } from "./domain";
export const profiles = new Hono<AppEnv>();
profiles.use("/me", auth);
profiles.use("/me/age-assurance", auth);
profiles.use("/preferences", auth);
profiles.use("/passport", auth);
profiles.use("/profiles/*", auth);
profiles.use("/privacy", auth);
export async function canSee(c: C, target: string, includeSeen = true) {
  const me = c.get("userId");
  if (target === me) return false;
  const rows = await c.env.DB.prepare(
    `SELECT p.* FROM profiles p JOIN users u ON p.user_id=u.id JOIN privacy_preferences v ON v.user_id=u.id WHERE u.id IN (?,?) AND u.status='active' AND u.age_assured_at IS NOT NULL AND p.visibility_status='visible' AND (v.incognito=0 OR u.id=? OR EXISTS(SELECT 1 FROM swipes WHERE actor_id=u.id AND target_id=? AND action IN ('like','super_like'))) AND NOT EXISTS(SELECT 1 FROM blocks WHERE (actor_id=? AND target_id=?) OR (actor_id=? AND target_id=?))`,
  )
    .bind(me, target, me, me, me, target, target, me)
    .all<ProfileRow>();
  const a = rows.results.find((x) => x.user_id === me),
    b = rows.results.find((x) => x.user_id === target);
  if (!a || !b) return false;
  if (
    !includeSeen &&
    (await c.env.DB.prepare(
      "SELECT id FROM swipes WHERE actor_id=? AND target_id=?",
    )
      .bind(me, target)
      .first())
  )
    return false;
  const ps = await c.env.DB.prepare(
    "SELECT * FROM dating_preferences WHERE user_id IN (?,?)",
  )
    .bind(me, target)
    .all<
      Preferences & {
        user_id: string;
        passport_city: string | null;
        passport_latitude: number | null;
        passport_longitude: number | null;
      }
    >();
  const ap = ps.results.find((x) => x.user_id === me),
    bp = ps.results.find((x) => x.user_id === target);
  if (!ap || !bp || !reciprocal(a, ap, b, bp)) return false;
  const ls = await c.env.DB.prepare(
    "SELECT * FROM user_locations WHERE user_id IN (?,?)",
  )
    .bind(me, target)
    .all<{ user_id: string; latitude: number; longitude: number }>();
  const al = ls.results.find((x) => x.user_id === me),
    bl = ls.results.find((x) => x.user_id === target);
  if (!al || !bl) return false;
  const locationA =
    (await premium(c)) &&
    ap.passport_city &&
    ap.passport_latitude != null &&
    ap.passport_longitude != null
      ? { latitude: ap.passport_latitude, longitude: ap.passport_longitude }
      : al;
  const targetPremium = !!(await c.env.DB.prepare(
    "SELECT user_id FROM subscription_entitlements WHERE user_id=? AND tier<>'free' AND expires_at>?",
  )
    .bind(target, now())
    .first());
  const locationB =
    targetPremium &&
    bp.passport_city &&
    bp.passport_latitude != null &&
    bp.passport_longitude != null
      ? { latitude: bp.passport_latitude, longitude: bp.passport_longitude }
      : bl;
  return (
    distanceKm(locationA, locationB) <= Math.min(ap.radius_km, bp.radius_km)
  );
}
export async function publicProfile(c: C, p: ProfileRow) {
  const photos = await c.env.DB.prepare(
    "SELECT id,position FROM profile_photos WHERE user_id=? AND status='approved' ORDER BY position,id",
  )
    .bind(p.user_id)
    .all();
  const virtual = await c.env.DB.prepare(
    "SELECT passport_city FROM dating_preferences WHERE user_id=?",
  )
    .bind(p.user_id)
    .first<{ passport_city: string | null }>();
  return {
    location_label: virtual?.passport_city
      ? `Visiting ${virtual.passport_city} virtually`
      : null,
    id: p.user_id,
    display_name: p.display_name,
    age: age(p.date_of_birth),
    bio: p.bio,
    gender: p.gender,
    relationship_intent: p.relationship_intent,
    interests: JSON.parse(p.interests) as string[],
    languages: JSON.parse(p.languages) as string[],
    date_readiness: p.date_readiness,
    photos: photos.results,
    adult_eligibility_verified: true,
  };
}
profiles.get("/me", async (c) => {
  const profile = await new D1Profiles(c.env.DB).find(c.get("userId"));
  const preferences = await c.env.DB.prepare(
    "SELECT * FROM dating_preferences WHERE user_id=?",
  )
    .bind(c.get("userId"))
    .first();
  const identities = await c.env.DB.prepare(
    "SELECT provider,verified_at FROM auth_identities WHERE user_id=?",
  )
    .bind(c.get("userId"))
    .all();
  const user = await c.env.DB.prepare(
    "SELECT status,age_assured_at FROM users WHERE id=?",
  )
    .bind(c.get("userId"))
    .first();
  return c.json({
    data: {
      profile,
      preferences,
      identities: identities.results,
      user,
      local_mock: c.env.LOCAL_MODE === "true",
    },
  });
});
const profileSchema = z
  .object({
    display_name: z.string().trim().min(1).max(50),
    date_of_birth: z.string(),
    bio: z.string().trim().max(500),
    gender: z.string().min(1).max(40),
    relationship_intent: z.enum([
      "serious",
      "long_term",
      "exploring",
      "casual",
      "shared_interests",
    ]),
    interests: z.array(z.string().max(40)).max(20),
    languages: z.array(z.string().max(40)).min(1).max(10),
    lifestyle: z
      .partialRecord(
        z.enum(["drinking", "smoking", "exercise", "pets", "family"]),
        z.string().max(40),
      )
      .default({}),
    date_readiness: z
      .enum(["chat_first", "video_call", "meet_after_chat"])
      .default("chat_first"),
    location: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      city: z.string().trim().min(1).max(80),
    }),
    complete: z.boolean().default(false),
  })
  .strict();
profiles.patch("/me", async (c) => {
  const d = await body(c, profileSchema),
    userId = c.get("userId");
  const years = age(d.date_of_birth);
  if (years < 18 || years > 120)
    throw new APIError(
      403,
      "ADULTS_ONLY",
      "Zyra is only for adults aged 18 and over.",
    );
  const previous = await new D1Profiles(c.env.DB).find(userId);
  if (previous?.date_of_birth && previous.date_of_birth !== d.date_of_birth)
    throw new APIError(
      409,
      "DOB_LOCKED",
      "Contact support to correct your birth date.",
    );
  const assured =
    c.env.LOCAL_MODE === "true" ||
    !!(await c.env.DB.prepare(
      "SELECT id FROM users WHERE id=? AND age_assured_at IS NOT NULL",
    )
      .bind(userId)
      .first());
  if (d.complete && !assured)
    throw new APIError(
      403,
      "AGE_ASSURANCE_REQUIRED",
      "Complete independent adult eligibility verification.",
    );
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE profiles SET display_name=?,date_of_birth=?,bio=?,gender=?,relationship_intent=?,interests=?,languages=?,lifestyle=?,date_readiness=?,onboarding_status=?,updated_at=? WHERE user_id=?`,
    ).bind(
      d.display_name,
      d.date_of_birth,
      d.bio,
      d.gender,
      d.relationship_intent,
      JSON.stringify(d.interests),
      JSON.stringify(d.languages),
      JSON.stringify(d.lifestyle),
      d.date_readiness,
      d.complete ? "complete" : "incomplete",
      now(),
      userId,
    ),
    c.env.DB.prepare(
      `INSERT INTO user_locations VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,city=excluded.city,updated_at=excluded.updated_at`,
    ).bind(
      userId,
      Math.round(d.location.latitude * 100) / 100,
      Math.round(d.location.longitude * 100) / 100,
      d.location.city,
      now(),
    ),
    c.env.DB.prepare(
      "UPDATE users SET status=?,age_assured_at=CASE WHEN ? THEN COALESCE(age_assured_at,?) ELSE age_assured_at END,updated_at=? WHERE id=?",
    ).bind(
      d.complete ? "active" : "onboarding",
      c.env.LOCAL_MODE === "true" ? 1 : 0,
      now(),
      now(),
      userId,
    ),
  ]);
  return c.json({
    data: {
      saved: true,
      status: d.complete ? "active" : "onboarding",
      mock_age_assurance: c.env.LOCAL_MODE === "true",
    },
  });
});
profiles.post("/me/age-assurance", async (c) => {
  const d = await body(
    c,
    z.object({ attestation: z.string().min(20).max(12000) }).strict(),
  );
  const { payload } = await jwtVerify(
    d.attestation,
    createRemoteJWKSet(
      new URL(required(c.env.AGE_JWKS_URL, "Age assurance JWKS")),
    ),
    {
      issuer: required(c.env.AGE_ISSUER, "Age assurance issuer"),
      audience: required(c.env.AGE_AUDIENCE, "Age assurance audience"),
      algorithms: ["ES256", "RS256"],
    },
  ).catch(() => {
    throw new APIError(
      403,
      "INVALID_ASSURANCE",
      "Adult eligibility could not be verified.",
    );
  });
  if (
    payload.sub !== c.get("userId") ||
    payload.over_18 !== true ||
    !payload.jti ||
    !payload.iat ||
    payload.iat < now() - 600
  )
    throw new APIError(
      403,
      "INVALID_ASSURANCE",
      "Adult eligibility could not be verified.",
    );
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO verification_requests VALUES(?,?,?,?,?)",
    ).bind(id(), c.get("userId"), String(payload.jti), "adult_verified", now()),
    c.env.DB.prepare("UPDATE users SET age_assured_at=? WHERE id=?").bind(
      now(),
      c.get("userId"),
    ),
  ]);
  return c.json({ data: { verified: true } });
});
profiles.patch("/preferences", async (c) => {
  const d = await body(
    c,
    z
      .object({
        min_age: z.number().int().min(18).max(99),
        max_age: z.number().int().min(18).max(120),
        genders: z.array(z.string().max(40)).max(10),
        radius_km: z.number().int().min(1).max(500),
        intentions: z.array(z.string().max(40)).max(5),
      })
      .strict()
      .refine((v) => v.max_age >= v.min_age),
  );
  await c.env.DB.prepare(
    "UPDATE dating_preferences SET min_age=?,max_age=?,genders=?,radius_km=?,intentions=? WHERE user_id=?",
  )
    .bind(
      d.min_age,
      d.max_age,
      JSON.stringify(d.genders),
      d.radius_km,
      JSON.stringify(d.intentions),
      c.get("userId"),
    )
    .run();
  return c.json({ data: { saved: true } });
});
profiles.get("/profiles/:profileId", async (c) => {
  await active(c);
  if (!(await canSee(c, c.req.param("profileId"))))
    throw new APIError(404, "PROFILE_NOT_FOUND", "Profile unavailable.");
  const p = await new D1Profiles(c.env.DB).find(c.req.param("profileId"));
  if (!p) throw new APIError(404, "PROFILE_NOT_FOUND", "Profile unavailable.");
  return c.json({ data: await publicProfile(c, p) });
});
profiles.get("/privacy", async (c) =>
  c.json({
    data: await c.env.DB.prepare(
      "SELECT show_distance,show_activity,read_receipts,incognito FROM privacy_preferences WHERE user_id=?",
    )
      .bind(c.get("userId"))
      .first(),
  }),
);
profiles.patch("/privacy", async (c) => {
  const d = await body(
    c,
    z
      .object({
        show_distance: z.boolean(),
        show_activity: z.boolean(),
        read_receipts: z.boolean(),
        incognito: z.boolean(),
        paused: z.boolean(),
      })
      .strict(),
  );
  if (d.incognito && !(await premium(c)))
    throw new APIError(403, "PREMIUM_REQUIRED", "Incognito requires Plus.");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE privacy_preferences SET show_distance=?,show_activity=?,read_receipts=?,incognito=? WHERE user_id=?",
    ).bind(
      +d.show_distance,
      +d.show_activity,
      +d.read_receipts,
      +d.incognito,
      c.get("userId"),
    ),
    c.env.DB.prepare(
      "UPDATE users SET status=CASE WHEN status IN ('active','paused') THEN ? ELSE status END WHERE id=?",
    ).bind(d.paused ? "paused" : "active", c.get("userId")),
  ]);
  return c.json({ data: { saved: true } });
});
export async function premium(c: C, min = "plus") {
  const e = await c.env.DB.prepare(
    "SELECT tier FROM subscription_entitlements WHERE user_id=? AND expires_at>?",
  )
    .bind(c.get("userId"), now())
    .first<{ tier: string }>();
  return (
    ["free", "plus", "gold", "elite"].indexOf(e?.tier ?? "free") >=
    ["free", "plus", "gold", "elite"].indexOf(min)
  );
}

profiles.patch("/passport", async (c) => {
  const d = await body(
    c,
    z
      .object({
        city: z.string().trim().min(1).max(80).nullable(),
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
      })
      .strict(),
  );
  if (
    d.city &&
    (!(await premium(c)) || d.latitude === null || d.longitude === null)
  )
    throw new APIError(
      403,
      "PASSPORT_UNAVAILABLE",
      "Passport requires Plus and a selected city location.",
    );
  await c.env.DB.prepare(
    "UPDATE dating_preferences SET passport_city=?,passport_latitude=?,passport_longitude=? WHERE user_id=?",
  )
    .bind(
      d.city,
      d.city ? d.latitude : null,
      d.city ? d.longitude : null,
      c.get("userId"),
    )
    .run();
  return c.json({ data: { saved: true, virtual_location: d.city } });
});
