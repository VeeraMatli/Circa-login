import { Hono } from "hono";
import { z } from "zod";
import { APIError, compatibility, hash, id, now, sparks } from "./domain";
import { auth, active, body, page } from "./http";
import { canSee, premium, publicProfile } from "./profiles";
import { D1Matches, D1Profiles } from "./repositories";
import type { AppEnv, ProfileRow } from "./types";
export const discovery = new Hono<AppEnv>();
discovery.use("/discover", auth);
discovery.use("/explore", auth);
discovery.use("/swipes", auth);
discovery.use("/swipes/*", auth);
discovery.use("/likes/*", auth);
discovery.get("/discover", async (c) => {
  await active(c);
  const { limit, cursor } = page(c),
    me = c.get("userId");
  const mode = z
    .enum(["nearby", "serious", "interests", "new", "recent", "compatibility"])
    .parse(c.req.query("mode") ?? "nearby");
  const own = await new D1Profiles(c.env.DB).find(me);
  if (!own)
    throw new APIError(409, "PROFILE_REQUIRED", "Create a profile first.");
  const candidates = await c.env.DB.prepare(
    `SELECT p.* FROM profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id>? AND p.user_id<>? AND u.status='active' AND NOT EXISTS(SELECT 1 FROM swipes WHERE actor_id=? AND target_id=p.user_id) AND NOT EXISTS(SELECT 1 FROM matches WHERE (user_a=? AND user_b=p.user_id) OR (user_b=? AND user_a=p.user_id)) ORDER BY p.user_id LIMIT 100`,
  )
    .bind(cursor, me, me, me, me)
    .all<ProfileRow>();
  const eligible = [];
  let scanned = cursor;
  for (const p of candidates.results) {
    scanned = p.user_id;
    if (
      mode === "serious" &&
      !["serious", "long_term"].includes(p.relationship_intent)
    )
      continue;
    if (
      mode === "interests" &&
      !(JSON.parse(p.interests) as string[]).some((x) =>
        (JSON.parse(own.interests) as string[]).includes(x),
      )
    )
      continue;
    if (
      mode === "new" &&
      !(await c.env.DB.prepare(
        "SELECT id FROM users WHERE id=? AND created_at>?",
      )
        .bind(p.user_id, now() - 604800)
        .first())
    )
      continue;
    if (
      mode === "recent" &&
      !(await c.env.DB.prepare(
        "SELECT u.id FROM users u JOIN privacy_preferences v ON v.user_id=u.id WHERE u.id=? AND v.show_activity=1 AND u.updated_at>?",
      )
        .bind(p.user_id, now() - 86400)
        .first())
    )
      continue;
    if (await canSee(c, p.user_id, false)) {
      eligible.push({
        ...(await publicProfile(c, p)),
        compatibility: compatibility(own, p),
      });
    }
    if (eligible.length === limit) break;
  }
  eligible.sort((a, b) => b.compatibility.score - a.compatibility.score);
  return c.json({
    data: eligible,
    next_cursor:
      scanned !== cursor && candidates.results.length ? scanned : null,
  });
});
discovery.get("/explore", async (c) => {
  await active(c);
  return c.json({
    data: [
      {
        id: "nearby",
        title: "Close to home",
        description: "Mutually eligible people within your radius",
      },
      {
        id: "serious",
        title: "Something lasting",
        description: "Shared long-term intentions",
      },
      {
        id: "interests",
        title: "A little in common",
        description: "Start with the things you love",
      },
      {
        id: "compatibility",
        title: "Connection Compass",
        description: "Understand what brings you together",
      },
      {
        id: "new",
        title: "A new beginning",
        description: "Recently joined, approved adult members",
      },
      {
        id: "recent",
        title: "Here for a connection",
        description: "Recently active people who permit activity visibility",
      },
    ],
    sparks,
  });
});
discovery.post("/swipes", async (c) => {
  await active(c);
  const d = await body(
      c,
      z
        .object({
          target_id: z.uuid(),
          action: z.enum(["like", "pass", "super_like"]),
        })
        .strict(),
    ),
    me = c.get("userId");
  const key = c.req.header("idempotency-key");
  if (!key || key.length > 128)
    throw new APIError(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Provide an Idempotency-Key.",
    );
  const requestHash = await hash(JSON.stringify(d));
  const saved = await c.env.DB.prepare(
    "SELECT request_hash,response FROM idempotency_keys WHERE user_id=? AND key=? AND route='swipe'",
  )
    .bind(me, key)
    .first<{ request_hash: string; response: string }>();
  if (saved) {
    if (saved.request_hash !== requestHash)
      throw new APIError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Key already used for a different action.",
      );
    if (saved.response === "pending")
      throw new APIError(
        409,
        "REQUEST_IN_PROGRESS",
        "This action is being reconciled. Refresh your matches before retrying.",
      );
    return c.json(JSON.parse(saved.response) as object);
  }
  if (!(await canSee(c, d.target_id)))
    throw new APIError(404, "PROFILE_NOT_FOUND", "Profile unavailable.");
  const existing = await c.env.DB.prepare(
    "SELECT action FROM swipes WHERE actor_id=? AND target_id=?",
  )
    .bind(me, d.target_id)
    .first<{ action: string }>();
  if (existing && existing.action !== d.action)
    throw new APIError(
      409,
      "ALREADY_SWIPED",
      "You already acted on this profile.",
    );
  const reservation = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO idempotency_keys VALUES(?,?,'swipe',?,'pending',?)",
  )
    .bind(me, key, requestHash, now() + 86400)
    .run();
  if (!reservation.meta.changes)
    throw new APIError(
      409,
      "REQUEST_IN_PROGRESS",
      "This idempotency key is already in use.",
    );
  const paid = await premium(c);
  if (d.action === "super_like" && !existing) {
    const ref = `super:${me}:${d.target_id}`,
      ledgerId = id();
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO consumable_ledger(id,user_id,kind,amount,reference,created_at) SELECT ?,?,'super_like',-1,?,? WHERE EXISTS(SELECT 1 FROM consumable_balances WHERE user_id=? AND kind='super_like' AND balance>0) AND NOT EXISTS(SELECT 1 FROM swipes WHERE actor_id=? AND target_id=?) ON CONFLICT(reference) DO NOTHING`,
      ).bind(ledgerId, me, ref, now(), me, me, d.target_id),
      c.env.DB.prepare(
        `UPDATE consumable_balances SET balance=balance-1 WHERE user_id=? AND kind='super_like' AND balance>0 AND EXISTS(SELECT 1 FROM consumable_ledger WHERE id=?)`,
      ).bind(me, ledgerId),
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO swipes SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM consumable_ledger WHERE id=?)`,
      ).bind(id(), me, d.target_id, d.action, now(), ledgerId),
    ]);
    if (!result[0]?.meta.changes)
      throw new APIError(
        403,
        "SUPER_LIKE_BALANCE_REQUIRED",
        "No verified Super Likes are available.",
      );
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO swipes(id,actor_id,target_id,action,created_at) SELECT ?,?,?,?,? WHERE (?=1 OR ?='pass' OR (SELECT COUNT(*) FROM swipes WHERE actor_id=? AND action IN ('like','super_like') AND created_at>=?)<25) ON CONFLICT(actor_id,target_id) DO NOTHING`,
  )
    .bind(
      id(),
      me,
      d.target_id,
      d.action,
      now(),
      paid ? 1 : 0,
      d.action,
      me,
      now() - 86400,
    )
    .run();
  if (d.action !== "super_like" && !existing && !result.meta.changes)
    throw new APIError(
      429,
      "LIKE_QUOTA_EXHAUSTED",
      "Your daily free Like allowance is used.",
    );
  const match =
    d.action === "pass"
      ? null
      : await new D1Matches(c.env.DB).reconcile(me, d.target_id);
  const response = { data: { recorded: true, match } };
  await c.env.DB.prepare(
    "UPDATE idempotency_keys SET response=? WHERE user_id=? AND key=? AND route='swipe' AND request_hash=?",
  )
    .bind(JSON.stringify(response), me, key, requestHash)
    .run();
  return c.json(response);
});
discovery.post("/swipes/rewind", async (c) => {
  await active(c);
  if (!(await premium(c)))
    throw new APIError(403, "PREMIUM_REQUIRED", "Rewind requires Plus.");
  const latest = await c.env.DB.prepare(
    "SELECT * FROM swipes WHERE actor_id=? ORDER BY created_at DESC,id DESC LIMIT 1",
  )
    .bind(c.get("userId"))
    .first<{ id: string; target_id: string }>();
  if (!latest)
    throw new APIError(404, "NOTHING_TO_REWIND", "There is no previous swipe.");
  if (
    await c.env.DB.prepare(
      "SELECT id FROM matches WHERE (user_a=? AND user_b=?) OR (user_a=? AND user_b=?)",
    )
      .bind(
        c.get("userId"),
        latest.target_id,
        latest.target_id,
        c.get("userId"),
      )
      .first()
  )
    throw new APIError(
      409,
      "MATCH_EXISTS",
      "A match cannot be undone with rewind.",
    );
  await c.env.DB.prepare("DELETE FROM swipes WHERE id=?").bind(latest.id).run();
  return c.json({ data: { rewound: true } });
});
discovery.get("/likes/received", async (c) => {
  await active(c);
  const { limit, cursor } = page(c);
  const likes = await c.env.DB.prepare(
    "SELECT p.* FROM swipes s JOIN profiles p ON p.user_id=s.actor_id WHERE s.target_id=? AND s.action IN ('like','super_like') AND p.user_id>? AND NOT EXISTS(SELECT 1 FROM swipes WHERE actor_id=? AND target_id=p.user_id) ORDER BY p.user_id LIMIT 100",
  )
    .bind(c.get("userId"), cursor, c.get("userId"))
    .all<ProfileRow>();
  const eligible = [];
  for (const p of likes.results)
    if (await canSee(c, p.user_id)) eligible.push(p);
  const paid = await premium(c, "gold");
  return c.json({
    data: paid
      ? await Promise.all(
          eligible.slice(0, limit).map((p) => publicProfile(c, p)),
        )
      : [],
    count: eligible.length,
    requires_upgrade: !paid,
    next_cursor:
      likes.results.length === 100 ? likes.results.at(-1)?.user_id : null,
  });
});
