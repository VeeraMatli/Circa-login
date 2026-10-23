import { SignJWT, importPKCS8 } from "jose";
import { APIError, now, id } from "./domain";
import { provider, required } from "./http";
import type { Env } from "./types";
export async function dispatch(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT id,kind,payload FROM outbox_events WHERE delivered_at IS NULL ORDER BY created_at LIMIT 100",
  ).all<{ id: string; kind: string; payload: string }>();
  for (const row of rows.results) {
    await env.EVENTS.send({
      kind: "notification",
      event_id: row.id,
      event_kind: row.kind,
      ...(JSON.parse(row.payload) as object),
    });
    await env.DB.prepare("UPDATE outbox_events SET delivered_at=? WHERE id=?")
      .bind(now(), row.id)
      .run();
  }
  await env.DB.prepare("DELETE FROM email_verifications WHERE expires_at<?")
    .bind(now() - 86400)
    .run();
  await env.DB.prepare("DELETE FROM phone_verifications WHERE expires_at<?")
    .bind(now() - 86400)
    .run();
  await env.DB.prepare("DELETE FROM rate_limits WHERE window_start<?")
    .bind(now() - 86400 * 2)
    .run();
  await env.DB.prepare("DELETE FROM idempotency_keys WHERE expires_at<?")
    .bind(now())
    .run();
}
async function notify(env: Env, d: Record<string, unknown>) {
  const recipients =
    typeof d.recipient === "string"
      ? [d.recipient]
      : [d.user_a, d.user_b].filter((x): x is string => typeof x === "string");
  for (const user of recipients) {
    const preference = await env.DB.prepare(
      "SELECT * FROM notification_preferences WHERE user_id=?",
    )
      .bind(user)
      .first<{
        matches: number;
        messages: number;
        quiet_start: number | null;
        quiet_end: number | null;
      }>();
    const enabled =
      d.event_kind === "match" ? preference?.matches : preference?.messages;
    const hour = new Date().getUTCHours();
    const quiet =
      preference?.quiet_start != null &&
      preference.quiet_end != null &&
      (preference.quiet_start < preference.quiet_end
        ? hour >= preference.quiet_start && hour < preference.quiet_end
        : hour >= preference.quiet_start || hour < preference.quiet_end);
    const existing = await env.DB.prepare(
      "SELECT id FROM notification_deliveries WHERE user_id=? AND event_id=? AND status IN ('sent','mock','suppressed')",
    )
      .bind(user, String(d.event_id))
      .first();
    if (existing) continue;
    if (!enabled || quiet) {
      await env.DB.prepare(
        "INSERT INTO notification_deliveries VALUES(?,?,?,'suppressed',0,?) ON CONFLICT(user_id,event_id) DO UPDATE SET status='suppressed'",
      )
        .bind(id(), user, String(d.event_id), now())
        .run();
      continue;
    }
    if (d.event_kind === "message" && typeof d.conversation_id === "string") {
      const muted = await env.DB.prepare(
        "SELECT muted FROM conversation_settings WHERE conversation_id=? AND user_id=?",
      )
        .bind(d.conversation_id, user)
        .first<{ muted: number }>();
      if (muted?.muted) continue;
    }
    const devices = await env.DB.prepare(
      "SELECT token,environment FROM device_registrations WHERE user_id=?",
    )
      .bind(user)
      .all<{ token: string; environment: string }>();
    if (env.LOCAL_MODE !== "true" && devices.results.length) {
      const key = await importPKCS8(
        required(env.APNS_KEY, "APNs signing key").replace(/\\n/g, "\n"),
        "ES256",
      );
      const jwt = await new SignJWT({})
        .setProtectedHeader({
          alg: "ES256",
          kid: required(env.APNS_KEY_ID, "APNs key ID"),
        })
        .setIssuer(required(env.APNS_TEAM_ID, "APNs team ID"))
        .setIssuedAt()
        .sign(key);
      for (const device of devices.results) {
        await provider(
          `https://${device.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com"}/3/device/${device.token}`,
          {
            method: "POST",
            headers: {
              Authorization: `bearer ${jwt}`,
              "apns-topic": env.APPLE_BUNDLE_ID,
              "apns-push-type": "alert",
              "apns-priority": "10",
              "apns-collapse-id": String(d.event_id),
            },
            body: JSON.stringify({
              aps: {
                alert: {
                  title: "Circa",
                  body:
                    d.event_kind === "match"
                      ? "A new connection is waiting."
                      : "You have a new message.",
                },
                sound: "default",
              },
              conversation_id: d.conversation_id,
            }),
          },
        );
      }
    }
    await env.DB.prepare(
      "INSERT INTO notification_deliveries VALUES(?,?,?,?,1,?) ON CONFLICT(user_id,event_id) DO UPDATE SET status=excluded.status,attempts=attempts+1",
    )
      .bind(
        id(),
        user,
        String(d.event_id),
        env.LOCAL_MODE === "true" ? "mock" : "sent",
        now(),
      )
      .run();
  }
}
export async function processQueue(batch: MessageBatch, env: Env) {
  for (const message of batch.messages) {
    try {
      const d = message.body as Record<string, unknown>;
      if (d.kind === "moderate_photo") {
        const photo = await env.DB.prepare(
          "SELECT object_key,status FROM profile_photos WHERE id=?",
        )
          .bind(String(d.photo_id))
          .first<{ object_key: string; status: string }>();
        if (!photo || photo.status !== "pending") {
          message.ack();
          continue;
        }
        let approved = env.LOCAL_MODE === "true";
        if (!approved) {
          const obj = await env.MEDIA.get(photo.object_key);
          if (!obj)
            throw new APIError(404, "MEDIA_MISSING", "Uploaded media missing.");
          const response = await provider(
            required(env.MODERATION_URL, "Content moderation"),
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${required(env.MODERATION_TOKEN, "Moderation token")}`,
                "Content-Type":
                  obj.httpMetadata?.contentType ?? "application/octet-stream",
              },
              body: obj.body,
            },
          );
          const verdict = (await response.json()) as { verdict?: string };
          if (
            !["approved", "rejected", "review"].includes(verdict.verdict ?? "")
          )
            throw new Error("Invalid moderation response");
          if (verdict.verdict === "review") {
            message.ack();
            continue;
          }
          approved = verdict.verdict === "approved";
        }
        await env.DB.prepare("UPDATE profile_photos SET status=? WHERE id=?")
          .bind(approved ? "approved" : "rejected", String(d.photo_id))
          .run();
      } else if (d.kind === "notification") await notify(env, d);
      else throw new Error("Unknown queue event");
      message.ack();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "queue_failure",
          message_id: message.id,
          error_type: error instanceof Error ? error.name : "unknown",
        }),
      );
      message.retry({ delaySeconds: 30 });
    }
  }
}
