import { Hono } from "hono";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { APIError, hash, id, now, secret } from "./domain";
import { auth, body, limit, provider, required, type C } from "./http";
import type { AppEnv } from "./types";
export const authentication = new Hono<AppEnv>();
async function session(c: C, userId: string, family = id()) {
  const access = secret(),
    refresh = secret(),
    sessionId = id();
  await c.env.DB.prepare(
    "INSERT INTO refresh_sessions(id,user_id,family_id,refresh_hash,access_hash,access_expires,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      sessionId,
      userId,
      family,
      await hash(refresh),
      await hash(access),
      now() + 900,
      now() + 2592000,
      now(),
    )
    .run();
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: 900,
    user_id: userId,
  };
}
async function identity(
  c: C,
  providerName: string,
  subject: string,
  linkUser?: string,
) {
  const existing = await c.env.DB.prepare(
    "SELECT user_id FROM auth_identities WHERE provider=? AND provider_subject=?",
  )
    .bind(providerName, subject)
    .first<{ user_id: string }>();
  if (existing) {
    if (linkUser && existing.user_id !== linkUser)
      throw new APIError(
        409,
        "IDENTITY_UNAVAILABLE",
        "This identity cannot be linked.",
      );
    const u = await c.env.DB.prepare("SELECT status FROM users WHERE id=?")
      .bind(existing.user_id)
      .first<{ status: string }>();
    if (!u || ["deleted", "banned"].includes(u.status))
      throw new APIError(403, "ACCOUNT_UNAVAILABLE", "Account is unavailable.");
    return existing.user_id;
  }
  const userId = linkUser ?? id(),
    t = now();
  const ops = linkUser
    ? []
    : [
        c.env.DB.prepare(
          "INSERT INTO users(id,created_at,updated_at) VALUES(?,?,?)",
        ).bind(userId, t, t),
        c.env.DB.prepare(
          "INSERT INTO profiles(user_id,created_at,updated_at) VALUES(?,?,?)",
        ).bind(userId, t, t),
        c.env.DB.prepare(
          "INSERT INTO dating_preferences(user_id) VALUES(?)",
        ).bind(userId),
        c.env.DB.prepare(
          "INSERT INTO privacy_preferences(user_id) VALUES(?)",
        ).bind(userId),
        c.env.DB.prepare(
          "INSERT INTO notification_preferences(user_id) VALUES(?)",
        ).bind(userId),
      ];
  ops.push(
    c.env.DB.prepare(
      "INSERT INTO auth_identities(id,user_id,provider,provider_subject,verified_at) VALUES(?,?,?,?,?)",
    ).bind(id(), userId, providerName, subject, t),
  );
  try {
    await c.env.DB.batch(ops);
  } catch (e) {
    if (String(e).includes("UNIQUE constraint")) {
      const winner = await c.env.DB.prepare(
        "SELECT user_id FROM auth_identities WHERE provider=? AND provider_subject=?",
      )
        .bind(providerName, subject)
        .first<{ user_id: string }>();
      if (winner && !linkUser) return winner.user_id;
    }
    throw e;
  }
  return userId;
}
for (const kind of ["email", "phone"] as const) {
  const table =
    kind === "email" ? "email_verifications" : "phone_verifications";
  authentication.post(`/${kind}/start`, async (c) => {
    const data = await body(
      c,
      z
        .object({
          destination:
            kind === "email"
              ? z.email().max(254)
              : z.string().regex(/^\+[1-9]\d{7,14}$/),
        })
        .strict(),
    );
    const subject =
      kind === "email"
        ? data.destination.trim().toLowerCase()
        : data.destination;
    await limit(c.env, `otp:${kind}:${subject}`, 1, 60);
    await limit(
      c.env,
      `otp-ip:${c.req.header("cf-connecting-ip") ?? "local"}`,
      10,
      3600,
    );
    const code = String(
        crypto.getRandomValues(new Uint32Array(1))[0]! % 1000000,
      ).padStart(6, "0"),
      challenge = id();
    await c.env.DB.prepare(
      `INSERT INTO ${table}(id,subject,code_hash,expires_at,sent_at) VALUES(?,?,?,?,?)`,
    )
      .bind(
        challenge,
        subject,
        await hash(challenge + code),
        now() + 300,
        now(),
      )
      .run();
    if (c.env.LOCAL_MODE !== "true") {
      if (kind === "email")
        await provider("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${required(c.env.EMAIL_API_KEY, "Email")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: required(c.env.EMAIL_FROM, "Email sender"),
            to: subject,
            subject: "Your Anvaya verification code",
            text: `Your code is ${code}. It expires in 5 minutes. Never share it.`,
          }),
        });
      else
        await provider(
          `https://api.twilio.com/2010-04-01/Accounts/${required(c.env.SMS_ACCOUNT, "SMS account")}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(c.env.SMS_ACCOUNT + ":" + required(c.env.SMS_TOKEN, "SMS"))}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              From: required(c.env.SMS_FROM, "SMS sender"),
              To: subject,
              Body: `Anvaya code: ${code}. Expires in 5 minutes.`,
            }).toString(),
          },
        );
    }
    return c.json(
      {
        data: {
          challenge_id: challenge,
          expires_in: 300,
          ...(c.env.LOCAL_MODE === "true"
            ? { local_code: code, mock: true }
            : {}),
        },
      },
      202,
    );
  });
  authentication.post(`/${kind}/verify`, async (c) => {
    const data = await body(
      c,
      z
        .object({ challenge_id: z.uuid(), code: z.string().regex(/^\d{6}$/) })
        .strict(),
    );
    await limit(
      c.env,
      `verify-ip:${c.req.header("cf-connecting-ip") ?? "local"}`,
      30,
      300,
    );
    const row = await c.env.DB.prepare(
      `UPDATE ${table} SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND expires_at>? AND attempts<5 RETURNING subject,code_hash`,
    )
      .bind(data.challenge_id, now())
      .first<{ subject: string; code_hash: string }>();
    if (!row || row.code_hash !== (await hash(data.challenge_id + data.code)))
      throw new APIError(400, "INVALID_OTP", "The code is invalid or expired.");
    const consumed = await c.env.DB.prepare(
      `UPDATE ${table} SET consumed_at=? WHERE id=? AND consumed_at IS NULL`,
    )
      .bind(now(), data.challenge_id)
      .run();
    if (!consumed.meta.changes)
      throw new APIError(400, "INVALID_OTP", "The code is invalid or expired.");
    const userId = await identity(c, kind, row.subject);
    return c.json({ data: await session(c, userId) });
  });
  authentication.post(`/link/${kind}`, auth, async (c) => {
    const data = await body(
      c,
      z
        .object({ challenge_id: z.uuid(), code: z.string().regex(/^\d{6}$/) })
        .strict(),
    );
    const row = await c.env.DB.prepare(
      `UPDATE ${table} SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND expires_at>? AND attempts<5 RETURNING subject,code_hash`,
    )
      .bind(data.challenge_id, now())
      .first<{ subject: string; code_hash: string }>();
    if (!row || row.code_hash !== (await hash(data.challenge_id + data.code)))
      throw new APIError(400, "INVALID_OTP", "The code is invalid or expired.");
    const consumed = await c.env.DB.prepare(
      `UPDATE ${table} SET consumed_at=? WHERE id=? AND consumed_at IS NULL`,
    )
      .bind(now(), data.challenge_id)
      .run();
    if (!consumed.meta.changes)
      throw new APIError(400, "INVALID_OTP", "The code is invalid or expired.");
    await identity(c, kind, row.subject, c.get("userId"));
    return c.json({ data: { linked: true } });
  });
}
authentication.post("/apple", async (c) => {
  await limit(
    c.env,
    "apple-ip:" + (c.req.header("cf-connecting-ip") ?? "local"),
    20,
    300,
  );
  const data = await body(
    c,
    z
      .object({
        identity_token: z.string().min(20).max(10000),
        nonce: z.string().min(32).max(128),
      })
      .strict(),
  );
  const { payload } = await jwtVerify(
    data.identity_token,
    createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys")),
    {
      issuer: "https://appleid.apple.com",
      audience: c.env.APPLE_BUNDLE_ID,
      algorithms: ["RS256"],
    },
  ).catch(() => {
    throw new APIError(
      401,
      "INVALID_APPLE_TOKEN",
      "Apple sign-in could not be verified.",
    );
  });
  if (
    !payload.sub ||
    payload.nonce !== (await hash(data.nonce)) ||
    !payload.iat ||
    payload.iat < now() - 300
  )
    throw new APIError(
      401,
      "INVALID_APPLE_TOKEN",
      "Apple sign-in could not be verified.",
    );
  await c.env.DB.prepare(
    "INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1)",
  )
    .bind("apple-nonce:" + (await hash(data.nonce)), now())
    .run()
    .catch(() => {
      throw new APIError(401, "REPLAY", "Sign-in has already been used.");
    });
  return c.json({
    data: await session(c, await identity(c, "apple", payload.sub)),
  });
});
authentication.post("/refresh", async (c) => {
  await limit(
    c.env,
    "refresh-ip:" + (c.req.header("cf-connecting-ip") ?? "local"),
    60,
    60,
  );
  const data = await body(
    c,
    z.object({ refresh_token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  );
  const old = await c.env.DB.prepare(
    "SELECT * FROM refresh_sessions WHERE refresh_hash=?",
  )
    .bind(await hash(data.refresh_token))
    .first<{
      id: string;
      user_id: string;
      family_id: string;
      used_at: number | null;
      revoked_at: number | null;
      expires_at: number;
    }>();
  if (!old) throw new APIError(401, "INVALID_REFRESH", "Sign in again.");
  if (old.used_at) {
    await c.env.DB.prepare(
      "UPDATE refresh_sessions SET revoked_at=? WHERE family_id=?",
    )
      .bind(now(), old.family_id)
      .run();
    throw new APIError(
      401,
      "REFRESH_REUSE",
      "Session family revoked. Sign in again.",
    );
  }
  if (old.revoked_at || old.expires_at <= now())
    throw new APIError(401, "INVALID_REFRESH", "Sign in again.");
  const access = secret(),
    refresh = secret();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO refresh_sessions(id,user_id,family_id,refresh_hash,access_hash,access_expires,expires_at,created_at) SELECT ?,user_id,family_id,?,?,?,?,? FROM refresh_sessions WHERE id=? AND used_at IS NULL AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=user_id AND status NOT IN ('banned','deleted'))`,
    ).bind(
      id(),
      await hash(refresh),
      await hash(access),
      now() + 900,
      now() + 2592000,
      now(),
      old.id,
    ),
    c.env.DB.prepare(
      "UPDATE refresh_sessions SET used_at=? WHERE id=? AND used_at IS NULL",
    ).bind(now(), old.id),
  ]);
  if (!result[0]?.meta.changes) {
    await c.env.DB.prepare(
      "UPDATE refresh_sessions SET revoked_at=? WHERE family_id=?",
    )
      .bind(now(), old.family_id)
      .run();
    throw new APIError(401, "REFRESH_REUSE", "Session family revoked.");
  }
  return c.json({
    data: {
      access_token: access,
      refresh_token: refresh,
      expires_in: 900,
      user_id: old.user_id,
    },
  });
});
authentication.post("/logout", auth, async (c) => {
  await c.env.DB.prepare("UPDATE refresh_sessions SET revoked_at=? WHERE id=?")
    .bind(now(), c.get("sessionId"))
    .run();
  return c.json({ data: { logged_out: true } });
});
authentication.post("/logout-all", auth, async (c) => {
  await c.env.DB.prepare(
    "UPDATE refresh_sessions SET revoked_at=? WHERE user_id=?",
  )
    .bind(now(), c.get("userId"))
    .run();
  return c.json({ data: { logged_out: true } });
});
