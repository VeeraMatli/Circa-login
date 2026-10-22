# System boundaries

```mermaid
flowchart LR
  IOS[SwiftUI iOS 17+] -->|TLS + opaque bearer| API[Hono Worker]
  Admin[Next.js admin] -->|Verified Cloudflare Access JWT| API
  Access[Cloudflare Access + MFA] --> Admin
  API --> D1[(D1 authoritative records)]
  API --> R2[(R2 quarantined media)]
  API --> DO[Conversation Durable Object]
  DO -->|Hibernating WebSockets| IOS
  DO --> D1
  D1 --> Outbox[Scheduled outbox dispatcher]
  Outbox --> Queue[Queues + dead-letter queue]
  Queue --> APNs[APNs]
  Queue --> Moderation[Configured moderation service]
  API --> Identity[Email / SMS / Apple JWKS]
  API --> Age[Independent age attestation JWKS]
  API --> Verifier[Optional Apple SDK verifier]
  Verifier --> Apple[App Store Server API + OCSP]
```

Private fields are excluded from public profile DTOs. API reads use prepared statements. Admin user lists omit private identities and profile preferences. Only moderators can read evidence attached to a safety case. Audit every privileged request. Financial dashboards count entitlements; they do not fabricate revenue or churn.

Queues are at least once. Media moderation and notification delivery records are idempotent. Outbox delivery marks enqueue completion, not device delivery. An APNs accepted response is not evidence that a device displayed a notification. Live WebSockets do not survive snapshots; start the services again in each task.
