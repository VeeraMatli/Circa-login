import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import { APIError, hash, now } from "./domain";
import type { AppEnv, Env } from "./types";
export type C = Context<AppEnv>;
export async function body<T extends z.ZodType>(
  c: C,
  schema: T,
): Promise<z.infer<T>> {
  const size = Number(c.req.header("content-length") ?? 0);
  if (size > 32768)
    throw new APIError(413, "BODY_TOO_LARGE", "Request too large.");
  const text = await c.req.text();
  if (text.length > 32768)
    throw new APIError(413, "BODY_TOO_LARGE", "Request too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new APIError(400, "INVALID_JSON", "Expected JSON.");
  }
  const result = schema.safeParse(parsed);
  if (!result.success)
    throw new APIError(
      400,
      "VALIDATION_ERROR",
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return result.data;
}
export async function limit(
  env: Env,
  key: string,
  max: number,
  window = 60,
): Promise<void> {
  const start = Math.floor(now() / window) * window;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits(key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count`,
  )
    .bind(await hash(key), start)
    .first<{ count: number }>();
  if (!row || row.count > max)
    throw new APIError(429, "RATE_LIMITED", "Please wait before trying again.");
}
export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.req
    .header("authorization")
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token)
    throw new APIError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const session = await c.env.DB.prepare(
    `SELECT s.id,s.user_id FROM refresh_sessions s JOIN users u ON u.id=s.user_id WHERE access_hash=? AND revoked_at IS NULL AND used_at IS NULL AND access_expires>? AND expires_at>? AND u.status NOT IN ('deleted','banned')`,
  )
    .bind(await hash(token), now(), now())
    .first<{ id: string; user_id: string }>();
  if (!session) throw new APIError(401, "SESSION_EXPIRED", "Sign in again.");
  c.set("userId", session.user_id);
  c.set("sessionId", session.id);
  await limit(c.env, "user:" + session.user_id, 120);
  await next();
};
export async function active(c: C) {
  const user = await c.env.DB.prepare(
    "SELECT id FROM users WHERE id=? AND status='active' AND age_assured_at IS NOT NULL",
  )
    .bind(c.get("userId"))
    .first();
  if (!user)
    throw new APIError(
      403,
      "ELIGIBILITY_REQUIRED",
      "Complete your profile and adult eligibility checks.",
    );
}
export const page = (c: C) => ({
  limit: Math.min(Math.max(Number(c.req.query("limit")) || 20, 1), 50),
  cursor: c.req.query("cursor") ?? "",
});
export function required(value: string | undefined, label: string): string {
  if (!value)
    throw new APIError(
      503,
      "PROVIDER_NOT_CONFIGURED",
      `${label} is not configured.`,
    );
  return value;
}
export async function provider(url: string, init: RequestInit) {
  if (!url.startsWith("https://"))
    throw new APIError(503, "UNSAFE_PROVIDER", "Provider must use HTTPS.");
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!res.ok)
    throw new APIError(
      502,
      "PROVIDER_FAILED",
      "The provider could not complete the request.",
    );
  return res;
}
