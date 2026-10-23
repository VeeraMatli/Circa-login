import { Hono } from "hono";
import { z } from "zod";
import { APIError, id, now } from "./domain";
import { auth, body } from "./http";
import type { AppEnv } from "./types";
export const safety = new Hono<AppEnv>();
safety.use("/me/data-export", auth);
safety.use("/users/*", auth);
safety.use("/reports", auth);
safety.use("/appeals", auth);
safety.use("/notifications", auth);
safety.use("/devices", auth);
safety.post("/users/:userId/block", async (c) => {
  const target = z.uuid().parse(c.req.param("userId")),
    me = c.get("userId");
  if (me === target)
    throw new APIError(400, "INVALID_TARGET", "Choose another account.");
  if (
    !(await c.env.DB.prepare("SELECT id FROM users WHERE id=?")
      .bind(target)
      .first())
  )
    throw new APIError(404, "USER_NOT_FOUND", "Account unavailable.");
  const matches = await c.env.DB.prepare(
    "SELECT id FROM matches WHERE (user_a=? AND user_b=?) OR (user_a=? AND user_b=?)",
  )
    .bind(me, target, target, me)
    .all<{ id: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO blocks VALUES(?,?,?)").bind(
      me,
      target,
      now(),
    ),
    c.env.DB.prepare(
      "UPDATE matches SET status='blocked' WHERE (user_a=? AND user_b=?) OR (user_a=? AND user_b=?)",
    ).bind(me, target, target, me),
  ]);
  for (const m of matches.results)
    await c.env.CHAT.get(c.env.CHAT.idFromName(m.id)).fetch(
      new Request("https://internal/disconnect", { method: "POST" }),
    );
  return c.json({ data: { blocked: true } });
});
const categories = [
  "fake_profile",
  "spam",
  "scam",
  "harassment",
  "threats",
  "underage",
  "nonconsensual_imagery",
  "impersonation",
  "other",
] as const;
safety.post("/reports", async (c) => {
  const d = await body(
    c,
    z
      .object({
        target_id: z.uuid(),
        category: z.enum(categories),
        details: z.string().trim().min(1).max(3000),
        conversation_id: z.uuid().optional(),
      })
      .strict(),
  );
  if (d.target_id === c.get("userId"))
    throw new APIError(400, "INVALID_TARGET", "Choose another account.");
  if (
    !(await c.env.DB.prepare("SELECT id FROM users WHERE id=?")
      .bind(d.target_id)
      .first())
  )
    throw new APIError(404, "USER_NOT_FOUND", "Account unavailable.");
  if (
    d.conversation_id &&
    !(await c.env.DB.prepare(
      "SELECT c.id FROM conversations c JOIN matches m ON m.id=c.match_id WHERE c.id=? AND ((m.user_a=? AND m.user_b=?) OR (m.user_b=? AND m.user_a=?))",
    )
      .bind(
        d.conversation_id,
        c.get("userId"),
        d.target_id,
        c.get("userId"),
        d.target_id,
      )
      .first())
  )
    throw new APIError(
      404,
      "CONVERSATION_NOT_FOUND",
      "Conversation unavailable.",
    );
  const report = id(),
    caseId = id();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO reports VALUES(?,?,?,?,?,?,?)").bind(
      report,
      c.get("userId"),
      d.target_id,
      d.category,
      d.details,
      d.conversation_id ?? null,
      now(),
    ),
    c.env.DB.prepare(
      "INSERT INTO moderation_cases(id,report_id,priority,created_at,updated_at) VALUES(?,?,?,?,?)",
    ).bind(
      caseId,
      report,
      ["threats", "underage", "nonconsensual_imagery"].includes(d.category)
        ? "urgent"
        : "normal",
      now(),
      now(),
    ),
  ]);
  return c.json(
    { data: { report_id: report, case_id: caseId, status: "open" } },
    201,
  );
});
safety.post("/appeals", async (c) => {
  const d = await body(
    c,
    z.object({ details: z.string().trim().min(1).max(3000) }).strict(),
  );
  const appeal = id();
  await c.env.DB.prepare(
    "INSERT INTO appeals(id,user_id,details,created_at) VALUES(?,?,?,?)",
  )
    .bind(appeal, c.get("userId"), d.details, now())
    .run();
  return c.json({ data: { id: appeal, status: "open" } }, 201);
});
safety.post("/me/data-export", async (c) => {
  const me = c.get("userId"),
    exportId = id();
  await c.env.DB.prepare(
    "INSERT INTO data_export_requests VALUES(?,?,'completed',?)",
  )
    .bind(exportId, me, now())
    .run();
  const profile = await c.env.DB.prepare(
    "SELECT * FROM profiles WHERE user_id=?",
  )
    .bind(me)
    .first();
  const messages = (
    await c.env.DB.prepare(
      "SELECT id,conversation_id,body,created_at FROM messages WHERE sender_id=? ORDER BY created_at",
    )
      .bind(me)
      .all()
  ).results;
  const photos = (
    await c.env.DB.prepare(
      "SELECT id,status,position FROM profile_photos WHERE user_id=?",
    )
      .bind(me)
      .all()
  ).results;
  const preferences = await c.env.DB.prepare(
    "SELECT * FROM dating_preferences WHERE user_id=?",
  )
    .bind(me)
    .first();
  return c.json(
    { data: { export_id: exportId, profile, messages, photos, preferences } },
    200,
    { "Content-Disposition": 'attachment; filename="zyra-export.json"' },
  );
});
safety.delete("/me", async (c) => {
  const me = c.get("userId");
  const photos = await c.env.DB.prepare(
    "SELECT object_key FROM profile_photos WHERE user_id=?",
  )
    .bind(me)
    .all<{ object_key: string }>();
  for (const p of photos.results) await c.env.MEDIA.delete(p.object_key);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO data_deletion_requests VALUES(?,?,'processing',?,NULL)",
    ).bind(id(), me, now()),
    c.env.DB.prepare(
      "UPDATE users SET status='deleted',deleted_at=?,updated_at=? WHERE id=?",
    ).bind(now(), now(), me),
    c.env.DB.prepare(
      "UPDATE profiles SET display_name='Deleted member',date_of_birth=NULL,bio='',gender='',interests='[]',languages='[]',lifestyle='{}',visibility_status='hidden' WHERE user_id=?",
    ).bind(me),
    c.env.DB.prepare("DELETE FROM user_locations WHERE user_id=?").bind(me),
    c.env.DB.prepare("DELETE FROM profile_photos WHERE user_id=?").bind(me),
    c.env.DB.prepare(
      "UPDATE refresh_sessions SET revoked_at=? WHERE user_id=?",
    ).bind(now(), me),
    c.env.DB.prepare(
      "UPDATE matches SET status='unmatched' WHERE user_a=? OR user_b=?",
    ).bind(me, me),
    c.env.DB.prepare("DELETE FROM device_registrations WHERE user_id=?").bind(
      me,
    ),
    c.env.DB.prepare(
      "UPDATE messages SET body='[Deleted by author]' WHERE sender_id=? AND NOT EXISTS(SELECT 1 FROM reports WHERE conversation_id=messages.conversation_id)",
    ).bind(me),
    c.env.DB.prepare(
      "DELETE FROM email_verifications WHERE subject IN (SELECT provider_subject FROM auth_identities WHERE user_id=? AND provider='email')",
    ).bind(me),
    c.env.DB.prepare(
      "DELETE FROM phone_verifications WHERE subject IN (SELECT provider_subject FROM auth_identities WHERE user_id=? AND provider='phone')",
    ).bind(me),
    c.env.DB.prepare("DELETE FROM auth_identities WHERE user_id=?").bind(me),
    c.env.DB.prepare(
      "UPDATE data_deletion_requests SET status='retention_pending' WHERE user_id=?",
    ).bind(me),
  ]);
  return c.json({
    data: {
      deleted: true,
      retention:
        "Reported evidence and financial records may be retained under the documented legal policy.",
    },
  });
});
safety.patch("/notifications", async (c) => {
  const d = await body(
    c,
    z
      .object({
        matches: z.boolean(),
        messages: z.boolean(),
        safety: z.boolean(),
        previews: z.boolean(),
      })
      .strict(),
  );
  await c.env.DB.prepare(
    "UPDATE notification_preferences SET matches=?,messages=?,safety=?,previews=? WHERE user_id=?",
  )
    .bind(+d.matches, +d.messages, +d.safety, +d.previews, c.get("userId"))
    .run();
  return c.json({ data: { saved: true } });
});
safety.post("/devices", async (c) => {
  const d = await body(
    c,
    z
      .object({
        token: z.string().regex(/^[a-f0-9]{64,200}$/),
        environment: z.enum(["sandbox", "production"]),
      })
      .strict(),
  );
  await c.env.DB.prepare(
    "INSERT INTO device_registrations VALUES(?,?,?,?,?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,environment=excluded.environment",
  )
    .bind(id(), c.get("userId"), d.token, d.environment, now())
    .run();
  return c.json({ data: { registered: true } });
});
