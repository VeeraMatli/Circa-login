import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  Status,
  type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";
import { readFileSync } from "node:fs";
export interface VerifiedPurchase {
  transaction_id: string;
  original_transaction_id: string;
  product_id: string;
  app_account_token: string;
  bundle_id: string;
  expires_at: number;
  revoked: boolean;
  environment: "Sandbox" | "Production";
  signed_at: number;
  notification_id?: string;
}
export function configuration(environment: NodeJS.ProcessEnv) {
  const require = (key: string) => {
    const value = environment[key];
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  };
  const mode = require("APPLE_ENVIRONMENT");
  if (!["Sandbox", "Production"].includes(mode))
    throw new Error("APPLE_ENVIRONMENT must be Sandbox or Production");
  const env =
    mode === "Production" ? Environment.PRODUCTION : Environment.SANDBOX;
  const bundle = require("APPLE_BUNDLE_ID");
  const roots = require("APPLE_ROOT_CERT_PATHS")
    .split(",")
    .map((path) => readFileSync(path.trim()));
  const appId =
    mode === "Production" ? Number(require("APPLE_APP_ID")) : undefined;
  if (appId !== undefined && !Number.isSafeInteger(appId))
    throw new Error("Invalid Apple application ID");
  const verifier = new SignedDataVerifier(roots, true, env, bundle, appId);
  const client = new AppStoreServerAPIClient(
    readFileSync(require("APPLE_PRIVATE_KEY_PATH"), "utf8"),
    require("APPLE_KEY_ID"),
    require("APPLE_ISSUER_ID"),
    bundle,
    env,
  );
  return { verifier, client, bundle, mode: mode as "Sandbox" | "Production" };
}
export async function verifyPurchase(
  signed: string,
  config: ReturnType<typeof configuration>,
): Promise<VerifiedPurchase> {
  let transaction: JWSTransactionDecodedPayload,
    notificationId: string | undefined;
  // Determine payload kind only to choose a verifier; no decoded unverified field is trusted.
  const part = signed.split(".")[1];
  if (!part) throw new Error("Invalid JWS");
  const hint = JSON.parse(Buffer.from(part, "base64url").toString()) as Record<
    string,
    unknown
  >;
  if ("notificationType" in hint) {
    const notification =
      await config.verifier.verifyAndDecodeNotification(signed);
    notificationId = notification.notificationUUID;
    if (!notification.data?.signedTransactionInfo)
      throw new Error("Notification has no transaction");
    transaction = await config.verifier.verifyAndDecodeTransaction(
      notification.data.signedTransactionInfo,
    );
  } else transaction = await config.verifier.verifyAndDecodeTransaction(signed);
  const original = transaction.originalTransactionId;
  if (!original) throw new Error("Missing original transaction ID");
  // Reconcile against the current server state; a valid old receipt cannot restore an expired/revoked subscription.
  const status = await config.client.getAllSubscriptionStatuses(original);
  let expiry = 0,
    revoked = true,
    latest = transaction,
    found = false;
  for (const group of status.data ?? []) {
    for (const item of group.lastTransactions ?? []) {
      if (
        item.originalTransactionId !== original ||
        !item.signedTransactionInfo
      )
        continue;
      const value = await config.verifier.verifyAndDecodeTransaction(
        item.signedTransactionInfo,
      );
      if (value.appAccountToken !== transaction.appAccountToken)
        throw new Error("App account binding mismatch");
      let expiration = value.expiresDate ?? 0;
      if (item.status === Status.BILLING_GRACE_PERIOD) {
        if (!item.signedRenewalInfo)
          throw new Error("Missing grace-period verification");
        const renewal = await config.verifier.verifyAndDecodeRenewalInfo(
          item.signedRenewalInfo,
        );
        expiration = Math.max(expiration, renewal.gracePeriodExpiresDate ?? 0);
      }
      if (item.status === Status.REVOKED || value.revocationDate)
        expiration = 0;
      if (!found || expiration >= expiry) {
        found = true;
        expiry = expiration;
        latest = value;
        revoked = item.status === Status.REVOKED || !!value.revocationDate;
      }
    }
  }
  if (
    !found ||
    !latest.transactionId ||
    !latest.productId ||
    !latest.appAccountToken ||
    !latest.bundleId ||
    !latest.signedDate
  )
    throw new Error("Incomplete verified subscription state");
  return {
    transaction_id: latest.transactionId,
    original_transaction_id: original,
    product_id: latest.productId,
    app_account_token: latest.appAccountToken,
    bundle_id: latest.bundleId,
    expires_at: Math.floor(expiry / 1000),
    revoked,
    environment: config.mode,
    signed_at: Math.floor(Date.now() / 1000),
    notification_id: notificationId,
  };
}
