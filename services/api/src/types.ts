export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  CHAT: DurableObjectNamespace;
  EVENTS: Queue;
  LOCAL_MODE: string;
  APPLE_BUNDLE_ID: string;
  ADMIN_ORIGIN: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  SMS_TOKEN?: string;
  SMS_ACCOUNT?: string;
  SMS_FROM?: string;
  ACCESS_TEAM?: string;
  ACCESS_AUDIENCE?: string;
  ADMIN_ROLES?: string;
  AGE_JWKS_URL?: string;
  AGE_ISSUER?: string;
  AGE_AUDIENCE?: string;
  MEDIA_PROCESSOR_URL?: string;
  MEDIA_PROCESSOR_TOKEN?: string;
  MODERATION_URL?: string;
  MODERATION_TOKEN?: string;
  APNS_KEY?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  PURCHASE_VERIFIER_URL?: string;
  PURCHASE_VERIFIER_TOKEN?: string;
}
export type Variables = {
  userId: string;
  sessionId: string;
  traceId: string;
  admin: { email: string; role: string };
};
export type AppEnv = { Bindings: Env; Variables: Variables };
export interface ProfileRow {
  user_id: string;
  display_name: string;
  date_of_birth: string;
  gender: string;
  relationship_intent: string;
  bio: string;
  interests: string;
  languages: string;
  lifestyle: string;
  visibility_status: string;
  onboarding_status: string;
  date_readiness: string;
}
export interface MatchRow {
  id: string;
  user_a: string;
  user_b: string;
  status: string;
}
