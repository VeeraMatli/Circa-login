import { Hono } from "hono";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { APIError, id, now } from "./domain";
import { body, page, required } from "./http";
import type { AppEnv } from "./types";
export const administration = new Hono<AppEnv>();
administration.use("*", async (c, next) => {
  let email: string, role: string;
  if (c.env.LOCAL_MODE === "true") {
    if (c.req.header("x-local-admin") !== "development")
      throw new APIError(
        401,
        "ADMIN_LOGIN_REQUIRED",
        "Use the local development admin gateway.",
      );
    email = "local-operator@anvaya.invalid";
    role = c.req.header("x-local-role") ?? "operations";
    if (
      ![
        "support",
        "moderator",
        "operations",
        "finance",
        "super_admin",
      ].includes(role)
    )
      throw new APIError(403, "ROLE_FORBIDDEN", "Role unavailable.");
  } else {
    const team = required(c.env.ACCESS_TEAM, "Cloudflare Access team");
    if (!/^[a-z0-9-]+$/.test(team))
      throw new APIError(503, "ACCESS_CONFIG", "Invalid Access team.");
    const token = c.req.header("cf-access-jwt-assertion");
    if (!token)
      throw new APIError(
        401,
        "ADMIN_LOGIN_REQUIRED",
        "Authenticate through Cloudflare Access with MFA.",
      );
    const { payload } = await jwtVerify(
      token,
      createRemoteJWKSet(
        new URL(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`),
      ),
      {
        issuer: `https://${team}.cloudflareaccess.com`,
        audience: required(c.env.ACCESS_AUDIENCE, "Access audience"),
        algorithms: ["RS256"],
      },
    ).catch(() => {
      throw new APIError(
        401,
        "INVALID_ACCESS",
        "Admin access could not be verified.",
      );
    });
    if (typeof payload.email !== "string")
      throw new APIError(403, "ROLE_FORBIDDEN", "Admin identity required.");
    email = payload.email;
    const roles = JSON.parse(
      required(c.env.ADMIN_ROLES, "Admin roles"),
    ) as Record<string, string>;
    role = roles[email] ?? "";
  }
  const path = c.req.path;
  const roles =
    path.includes("/cases") ||
    path.includes("/photos") ||
    path.includes("/evidence")
      ? ["moderator", "super_admin"]
      : path.includes("/finance")
        ? ["finance", "super_admin"]
        : path.includes("/flags")
          ? ["operations", "super_admin"]
          : path.includes("/audit")
            ? ["super_admin"]
            : ["operations", "support", "moderator", "finance", "super_admin"];
  if (!roles.includes(role))
    throw new APIError(
      403,
      "ROLE_FORBIDDEN",
      "Your role cannot access this operation.",
    );
  c.set("admin", { email, role });
  await c.env.DB.prepare("INSERT INTO admin_audit_logs VALUES(?,?,?,?,?,?)")
    .bind(
      id(),
      email,
      role,
      `${c.req.method} ${path.replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, ":id")}`,
      path
        .split("/")
        .find((part) => /^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(part)) ?? null,
      now(),
    )
    .run();
  await next();
});
administration.get("/overview", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM users WHERE status<>'deleted') registered_users,(SELECT COUNT(*) FROM users WHERE status='active' AND age_assured_at IS NOT NULL) verified_adults,(SELECT COUNT(*) FROM matches WHERE status='active') active_matches,(SELECT COUNT(*) FROM moderation_cases WHERE status<>'resolved') moderation_backlog,(SELECT COUNT(*) FROM moderation_cases WHERE priority='urgent' AND status<>'resolved') urgent_cases,(SELECT COUNT(*) FROM subscription_entitlements WHERE tier<>'free' AND expires_at>?) paying_subscribers,(SELECT COUNT(*) FROM conversations WHERE EXISTS(SELECT 1 FROM messages WHERE conversation_id=conversations.id)) conversations_started`,
  )
    .bind(now())
    .first();
  return c.json({
    data: row,
    role: c.get("admin").role,
    mode: c.env.LOCAL_MODE === "true" ? "local development" : "live",
  });
});
administration.get("/cases", async (c) => {
  const { limit, cursor } = page(c);
  const rows = await c.env.DB.prepare(
    "SELECT m.id,m.status,m.priority,m.created_at,r.category,r.target_id FROM moderation_cases m JOIN reports r ON r.id=m.report_id WHERE m.id>? ORDER BY m.id LIMIT ?",
  )
    .bind(cursor, limit)
    .all();
  return c.json({
    data: rows.results,
    next_cursor: rows.results.length === limit ? rows.results.at(-1)?.id : null,
  });
});
administration.get("/cases/:caseId/evidence", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT r.* FROM reports r JOIN moderation_cases m ON m.report_id=r.id WHERE m.id=?",
  )
    .bind(c.req.param("caseId"))
    .first<{ conversation_id: string | null; details: string }>();
  if (!row) throw new APIError(404, "CASE_NOT_FOUND", "Case unavailable.");
  const evidence = row.conversation_id
    ? (
        await c.env.DB.prepare(
          "SELECT sender_id,body,created_at FROM messages WHERE conversation_id=? ORDER BY sequence DESC LIMIT 50",
        )
          .bind(row.conversation_id)
          .all()
      ).results
    : [];
  return c.json({ data: { report: row, evidence } });
});
administration.patch("/cases/:caseId", async (c) => {
  const d = await body(
    c,
    z
      .object({
        status: z.enum(["reviewing", "resolved"]),
        resolution: z.string().trim().min(1).max(1000),
        ban_user: z.boolean().default(false),
      })
      .strict(),
  );
  const row = await c.env.DB.prepare(
    "SELECT r.target_id FROM reports r JOIN moderation_cases m ON m.report_id=r.id WHERE m.id=?",
  )
    .bind(c.req.param("caseId"))
    .first<{ target_id: string }>();
  if (!row) throw new APIError(404, "CASE_NOT_FOUND", "Case unavailable.");
  const ops = [
    c.env.DB.prepare(
      "UPDATE moderation_cases SET status=?,resolution=?,assigned_to=?,updated_at=? WHERE id=?",
    ).bind(
      d.status,
      d.resolution,
      c.get("admin").email,
      now(),
      c.req.param("caseId"),
    ),
    c.env.DB.prepare("INSERT INTO moderation_actions VALUES(?,?,?,?,?)").bind(
      id(),
      c.req.param("caseId"),
      c.get("admin").email,
      d.ban_user ? "ban" : d.status,
      now(),
    ),
  ];
  if (d.ban_user) {
    ops.push(
      c.env.DB.prepare("UPDATE users SET status='banned' WHERE id=?").bind(
        row.target_id,
      ),
      c.env.DB.prepare(
        "UPDATE refresh_sessions SET revoked_at=? WHERE user_id=?",
      ).bind(now(), row.target_id),
      c.env.DB.prepare(
        "UPDATE matches SET status='blocked' WHERE user_a=? OR user_b=?",
      ).bind(row.target_id, row.target_id),
    );
  }
  await c.env.DB.batch(ops);
  return c.json({ data: { saved: true } });
});
administration.get("/users", async (c) => {
  const { limit, cursor } = page(c);
  return c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT u.id,u.status,u.created_at,p.display_name FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id>? ORDER BY u.id LIMIT ?",
      )
        .bind(cursor, limit)
        .all()
    ).results,
  });
});
administration.get("/photos", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT id,user_id,status,created_at FROM profile_photos WHERE status='pending' ORDER BY created_at LIMIT 50",
      ).all()
    ).results,
  }),
);
administration.get("/audit", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 50",
      ).all()
    ).results,
  }),
);
administration.get("/flags", async (c) =>
  c.json({
    data: (await c.env.DB.prepare("SELECT * FROM feature_flags").all()).results,
  }),
);
administration.patch("/flags/:name", async (c) => {
  const d = await body(c, z.object({ enabled: z.boolean() }).strict());
  if (d.enabled)
    throw new APIError(
      409,
      "RELEASE_GATE",
      "Experimental features require a reviewed release configuration.",
    );
  await c.env.DB.prepare(
    "UPDATE feature_flags SET enabled=0,updated_at=? WHERE name=?",
  )
    .bind(now(), c.req.param("name"))
    .run();
  return c.json({ data: { saved: true } });
});
administration.get("/finance", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT tier,COUNT(*) AS subscribers FROM subscription_entitlements WHERE expires_at>? GROUP BY tier",
      )
        .bind(now())
        .all()
    ).results,
    notice:
      "Revenue requires App Store financial reports; entitlement counts are not revenue.",
  }),
);
administration.get("/health", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({
    data: {
      database: "available",
      mode: c.env.LOCAL_MODE === "true" ? "local" : "live",
      time: now(),
    },
  });
});

administration.get("/photos/:photoId/content", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT object_key FROM profile_photos WHERE id=? AND status='pending' AND content_hash IS NOT NULL",
  )
    .bind(c.req.param("photoId"))
    .first<{ object_key: string }>();
  if (!row)
    throw new APIError(
      404,
      "PHOTO_NOT_FOUND",
      "Pending moderation photo unavailable.",
    );
  const object = await c.env.MEDIA.get(row.object_key);
  if (!object) throw new APIError(404, "PHOTO_NOT_FOUND", "Photo unavailable.");
  return new Response(object.body, {
    headers: {
      "Content-Type":
        object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
administration.patch("/photos/:photoId", async (c) => {
  const d = await body(
    c,
    z.object({ status: z.enum(["approved", "rejected"]) }).strict(),
  );
  const result = await c.env.DB.prepare(
    "UPDATE profile_photos SET status=? WHERE id=? AND content_hash IS NOT NULL AND status='pending'",
  )
    .bind(d.status, c.req.param("photoId"))
    .run();
  if (!result.meta.changes)
    throw new APIError(
      404,
      "PHOTO_NOT_FOUND",
      "Pending moderation photo unavailable.",
    );
  return c.json({ data: { saved: true } });
});
