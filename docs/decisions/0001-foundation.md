# ADR 0001 — One product, an edge API, explicit trust boundaries

Status: implemented for local development; production approval outstanding.

Use SwiftUI and native Apple frameworks for iOS 17+, Hono/Zod on Workers, D1 for authoritative records, R2 for private media, one Durable Object per conversation for live coordination, Queues and a transactional outbox for asynchronous work. The admin portal uses Next.js 16, Tailwind 4 and Radix Dialog. Native clients hold opaque sessions in Keychain. No production seed profiles or generated engagement.

D1 `batch` provides atomic ordered statements; it does not support arbitrary application-level BEGIN/COMMIT transactions. Unique directed swipes, canonical unordered matches, per-conversation message sequences and conditional consumable ledger debits enforce invariants. Repository interfaces isolate profile/match/conversation persistence. A PostgreSQL migration needs new adapters, concurrency/load tests and spatial indexing, not a new API contract.

D1 discovery uses coarse private coordinates, capped candidate scans and Haversine mutual-radius checks. It is suitable for validating the workflow, not evidence for 100,000-user capacity. Score weights are product hypotheses. Cursor pagination scans stable UUID order; compatibility sorting applies within the fetched page. Global ranking and fair sampling require later measured work.

An optional Node service wraps Apple's official App Store Server Library, certificate-chain checks, online revocation checks and current subscription status reconciliation. Its `crypto.X509Certificate` and OCSP dependency are a runtime compatibility boundary that has not been validated in workerd. This is an explicit exception to the requested all-Workers deployment, rather than claiming SDK compatibility. It is not required to develop free dating features. Production purchases stay disabled until its HTTPS deployment and Apple sandbox integration pass. Consolidation into Workers remains preferable after compatibility is demonstrated.

No Redis, Kubernetes, AI provider or biometric search. No E2EE claim. The server processes readable messages; reported evidence is scoped to moderators and audited.

Native onboarding currently consolidates the requested eighteen screens into four sections. Several nonessential profile fields and advanced UI interactions remain unimplemented; see readiness.md. This is not the final production feature set.
