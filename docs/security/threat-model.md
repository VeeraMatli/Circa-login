# Security and privacy review

This is an engineering threat model, not an audit or legal approval.

| Threat | Implemented controls | Remaining release work |
|---|---|---|
| OTP abuse / account takeover | Subject + IP cooldown/limits, five attempts, five-minute expiry, hashed OTP, one-time consumption, Keychain sessions | Turnstile/device attestation, durable abuse intelligence, provider-spend alerts, recovery UX |
| Session theft/replay | 15-minute opaque access, 30-day rotating refresh families, reuse revocation, one/all-device logout | Verify on real devices; key/credential rotation drills |
| Minor access | Server-calculated age; production requires independent signed over-18 attestation | Jurisdiction assessment, provider ceremony and adversarial age-assurance review |
| Scraping / stalking | Authenticated profile/media reads, block exclusion, no public precise location/DOB, consent visibility, coarse stored city coordinates | Population-scale enumeration analysis and location-inference audit |
| Swipe fraud / double consumption | Conditional quotas, unique directed actions, idempotency reservations, atomic consumable ledger debit, canonical match pair | High-contention remote D1 concurrency and failover tests |
| Chat object access | D1 membership on reads/sends, serialized DO writes, idempotency, persistent ordering, socket close on block/unmatch | Server-side message content moderation, spam classification and queue delay SLOs |
| Malicious media | Size cap, private R2, single-use upload tokens, structured type checks, metadata removal, queued quarantine, moderator roles | Full decoder/HEIC processor deployment, image bombs/CRC tests, moderation provider integration, secure derivative pipeline |
| Purchase fraud | Client StoreKit verification is insufficient; official Apple SDK verifier and current server-state reconciliation, ownership binding | Sandbox lifecycle suite, revocation/refund ordering, consumable fulfillment and multi-subscription reconciliation |
| Moderator misuse | Verified Access JWT, explicit roles, scoped case evidence, request audit trail | MFA policy deployment, immutable audit export, staff access reviews, evidence retention enforcement |
| CSRF / web injection | Same-origin mutation checks, output escaped by React, CSP/frame/ MIME headers, strict validated API schemas | Strict CSP nonces rather than unsafe-inline, browser security assessment |
| Data exfiltration | Bound prepared SQL, public DTO allowlist, no credential logging, private cache protection | Encryption-at-rest key ownership, data residency, independent penetration testing |

No passwords are enabled. No E2EE, face recognition, beauty ranking or AI profiling is implemented. Sensitive optional orientation/religion fields are not collected in this version. Real threat/child-safety reports are urgent human cases; statutory reporting procedures and staffed response SLAs must be established before a public launch.

Deletion immediately removes discovery, revokes sessions, deletes R2 photos/device tokens/location/auth identities, clears personal profile fields and redacts authored unreported message bodies. Reported evidence, pseudonymous relationship/financial records and backups require a formal retention pipeline. `retention_pending` is deliberately distinct from complete erasure. OTP challenges expire and are purged by the scheduler after a day. A default recommended draft policy is 30 days for routine security traces, 180 days for reported evidence unless legal hold, and provider/jurisdiction-required financial retention; these are proposals, not automatically enforced or legally reviewed. Add scoped legal holds, automatic expiry jobs, backup aging and deletion propagation before production.

The current export includes profile, preferences, authored messages and photo metadata, not photo binaries, every identity setting or an asynchronous complete archive. Expand it to the launch jurisdiction's access/export requirements. Cache data is file-protected and cleared at logout/deletion; review cross-account restoration and device backup policies on macOS/iOS.
