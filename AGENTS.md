# Zyra engineering

Use the current checkout. Cloud tasks are already isolated; do not create worktrees unless requested.
Read README.md and docs/release/readiness.md before changing release gates.

- Keep secrets, OTPs and bearer tokens out of logs, source and analytics.
- Local mocks require LOCAL_MODE=true and loopback-only listeners. Never deploy that configuration.
- D1 is authoritative. Keep object-level authorization, conditional quota debits, unique canonical matches and message idempotency intact.
- Essential safety remains free. Preserve reciprocal consent, blocked-user exclusions and adult eligibility.
- Do not invent completed Apple, moderation, age-assurance, APNs, hosted or performance validation.
- Run npm run check, npm run test:integration, npm run build after changes. For admin, start local API and admin and run npm run test:admin.
- iOS requires Xcode 16+ on macOS. Regenerate the project with python3 scripts/generate-xcode.py after adding Swift files. Compile with Swift 6 strict concurrency. Do not claim builds from Linux.
- The OpenAPI source is scripts/generate-contract.py. Run npm run contract:generate after API contract changes and review generated output.
