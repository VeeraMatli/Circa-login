import { Hono } from "hono";
import { z } from "zod";
import { APIError, id, now } from "./domain";
import { auth, body, provider, required, type C } from "./http";
import type { AppEnv } from "./types";
export const purchases = new Hono<AppEnv>();
const verifiedSchema = z.object({
  transaction_id: z.string().min(1),
  original_transaction_id: z.string().min(1),
  product_id: z.string(),
  app_account_token: z.uuid(),
  bundle_id: z.string(),
  expires_at: z.number().int(),
  revoked: z.boolean(),
  environment: z.enum(["Sandbox", "Production"]),
  signed_at: z.number().int(),
  notification_id: z.string().optional(),
});
async function reconcile(c: C, signed: string, userId?: string) {
  // Contract for a private verifier running Apple's official SignedDataVerifier, including x5c chain and online revocation checks.
  const res = await provider(
    required(
      c.env.PURCHASE_VERIFIER_URL,
      "Apple transaction verification service",
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${required(c.env.PURCHASE_VERIFIER_TOKEN, "Purchase verifier token")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signed_payload: signed,
        bundle_id: c.env.APPLE_BUNDLE_ID,
      }),
    },
  );
  const v = verifiedSchema.parse(await res.json());
  if (
    v.bundle_id !== c.env.APPLE_BUNDLE_ID ||
    (userId && v.app_account_token !== userId)
  )
    throw new APIError(
      403,
      "PURCHASE_OWNER_MISMATCH",
      "Purchase does not belong to this account.",
    );
  const product = await c.env.DB.prepare(
    "SELECT tier,kind FROM subscription_products WHERE id=? AND enabled=1",
  )
    .bind(v.product_id)
    .first<{ tier: string; kind: string }>();
  if (!product)
    throw new APIError(400, "UNKNOWN_PRODUCT", "Product is not enabled.");
  if (product.kind !== "subscription")
    throw new APIError(
      409,
      "CONSUMABLE_NOT_ENABLED",
      "Consumable purchase fulfillment is not enabled.",
    );
  const existing = await c.env.DB.prepare(
    "SELECT user_id FROM purchase_transactions WHERE original_id=? LIMIT 1",
  )
    .bind(v.original_transaction_id)
    .first<{ user_id: string }>();
  if (existing && existing.user_id !== v.app_account_token)
    throw new APIError(
      403,
      "PURCHASE_OWNER_MISMATCH",
      "Purchase is already bound to another account.",
    );
  const expiry = v.revoked ? now() : v.expires_at;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO purchase_transactions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at,revoked_at=excluded.revoked_at,verified_at=excluded.verified_at",
    ).bind(
      v.transaction_id,
      v.app_account_token,
      v.product_id,
      v.original_transaction_id,
      v.expires_at,
      v.revoked ? now() : null,
      v.environment,
      now(),
    ),
    c.env.DB.prepare(
      `INSERT INTO subscription_entitlements(user_id,tier,expires_at,original_transaction_id,updated_at,source_signed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET tier=excluded.tier,expires_at=excluded.expires_at,original_transaction_id=excluded.original_transaction_id,updated_at=excluded.updated_at,source_signed_at=excluded.source_signed_at WHERE excluded.source_signed_at>=subscription_entitlements.source_signed_at`,
    ).bind(
      v.app_account_token,
      product.tier,
      expiry,
      v.original_transaction_id,
      now(),
      v.signed_at,
    ),
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO entitlement_events VALUES(?,?,?,?)",
    ).bind(
      v.notification_id ?? v.transaction_id,
      v.app_account_token,
      v.revoked ? "revoked" : "verified",
      now(),
    ),
  ]);
  return { synced: true };
}
purchases.get("/entitlements", auth, async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT tier,expires_at FROM subscription_entitlements WHERE user_id=? AND expires_at>?",
  )
    .bind(c.get("userId"), now())
    .first();
  return c.json({ data: row ?? { tier: "free", expires_at: null } });
});
purchases.get("/products", auth, async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        c.env.LOCAL_MODE === "true"
          ? "SELECT id,tier,kind FROM subscription_products"
          : "SELECT id,tier,kind FROM subscription_products WHERE enabled=1",
      ).all()
    ).results,
    pricing_source: "StoreKit localized product metadata",
  }),
);
purchases.post("/purchases/sync", auth, async (c) => {
  const d = await body(
    c,
    z.object({ signed_transaction: z.string().min(20).max(20000) }).strict(),
  );
  return c.json({
    data: await reconcile(c, d.signed_transaction, c.get("userId")),
  });
});
purchases.post("/webhooks/apple", async (c) => {
  const d = await body(
    c,
    z.object({ signedPayload: z.string().min(20).max(20000) }).strict(),
  );
  return c.json({ data: await reconcile(c, d.signedPayload) });
});
purchases.post("/consumables/redeem", auth, async (c) => {
  const d = await body(
      c,
      z
        .object({ kind: z.literal("boost"), idempotency_key: z.uuid() })
        .strict(),
    ),
    me = c.get("userId"),
    ledgerId = id();
  const duplicate = await c.env.DB.prepare(
    "SELECT id FROM consumable_ledger WHERE reference=? AND user_id=?",
  )
    .bind("boost:" + d.idempotency_key, me)
    .first();
  if (duplicate) return c.json({ data: { redeemed: true } });
  const r = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO consumable_ledger SELECT ?,?,'boost',-1,?,? WHERE EXISTS(SELECT 1 FROM consumable_balances WHERE user_id=? AND kind='boost' AND balance>0)`,
    ).bind(ledgerId, me, "boost:" + d.idempotency_key, now(), me),
    c.env.DB.prepare(
      `UPDATE consumable_balances SET balance=balance-1 WHERE user_id=? AND kind='boost' AND balance>0 AND EXISTS(SELECT 1 FROM consumable_ledger WHERE id=?)`,
    ).bind(me, ledgerId),
    c.env.DB.prepare(
      "INSERT INTO profile_boosts SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM consumable_ledger WHERE id=?)",
    ).bind(id(), me, now(), now() + 1800, ledgerId),
  ]);
  if (
    !r[0]?.meta.changes &&
    !(await c.env.DB.prepare(
      "SELECT id FROM consumable_ledger WHERE reference=? AND user_id=?",
    )
      .bind("boost:" + d.idempotency_key, me)
      .first())
  )
    throw new APIError(403, "BALANCE_REQUIRED", "No Boosts available.");
  return c.json({ data: { redeemed: true } });
});
purchases.post("/dev/entitlements", auth, async (c) => {
  if (c.env.LOCAL_MODE !== "true")
    throw new APIError(404, "NOT_FOUND", "Not found.");
  const d = await body(
    c,
    z
      .object({
        tier: z.enum(["free", "plus", "gold", "elite"]),
        duration_seconds: z.number().int().min(0).max(3600),
        super_likes: z.number().int().min(0).max(10).default(0),
        boosts: z.number().int().min(0).max(10).default(0),
      })
      .strict(),
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO subscription_entitlements(user_id,tier,expires_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET tier=excluded.tier,expires_at=excluded.expires_at,updated_at=excluded.updated_at",
    ).bind(c.get("userId"), d.tier, now() + d.duration_seconds, now()),
    ...(["super_like", "boost"] as const).map((kind) =>
      c.env.DB.prepare(
        "INSERT INTO consumable_balances VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET balance=excluded.balance",
      ).bind(
        c.get("userId"),
        kind,
        kind === "boost" ? d.boosts : d.super_likes,
      ),
    ),
  ]);
  return c.json({ data: { mock: true } });
});
