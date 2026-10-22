# Validation evidence — October 22, 2026

Executed in the Linux cloud instance with Node 24.19.0, npm 11.9.0, Python 3.12.14, Wrangler 4.152.0, Next 16.4.2 and the official Swift 6.0.3 Linux toolchain. The Swift archive signature verified against release-key fingerprint 52BB7E3DE28A71BE22EC05FFEF80A866B47A981F obtained from the official swiftlang/swift-org-website repository. No TLS, checksum or signature checks were disabled.

| Command/check | Observed result |
|---|---|
| `bash scripts/setup-cloud.sh` | Frozen npm install, repeat local migration with no pending migrations, repeatable local reference seed, installed Swift activation passed |
| `npm run check` | ESLint, strict TypeScript for API/admin/verifier, **16 Vitest tests**, **65** OpenAPI operation coverage/identifier checks, SQLite foreign-key/integrity/schema validation passed |
| `npm run test:integration` | **18 unittest scenarios passed** against an isolated actual Worker, D1, R2, Durable Objects and Queue consumer |
| `npm run test:admin` | **3 Playwright browser tests passed** against actual local API/admin using system Chromium; dashboard navigation/health, cross-origin mutation rejection, mobile navigation/no overflow |
| `npm run check:swift` | All native sources syntax-parse; strict Swift formatting; **6 Swift Testing contract tests passed** using the same native Models.swift source |
| Swift 6 strict-concurrency typecheck of Models.swift | Passed with module cache in the writable workspace |
| `npm run build` | Worker dry-run bundle, Node Apple verifier TypeScript compilation and Next production build passed |
| `npm run build:cloudflare -w @anvaya/admin` | OpenNext Cloudflare Worker artifact generated successfully |
| `npm audit --omit=dev --audit-level=high` | Zero reported production-dependency advisories at time of execution; not a security audit |
| Deployment renderer (synthetic fixture only) | LOCAL_MODE=false, isolated resource bindings, existing entrypoint/migrations paths and bounded queue retries verified; generated fixture removed; no deploy |
| Xcode project OpenStep syntax and references | Parsed and all object references resolved; no Apple SDK involved |
| Terraform HCL / GitHub Actions YAML / Apple plists / entitlements / shared scheme syntax | Parsed successfully; not Terraform provider validation or an Xcode build |
| `npm run local` then `python3 scripts/wait-services.py` | Both loopback HTTP services passed readiness after a stop/reinstall/restart |
| `python3 scripts/demo.py` | Created three explicitly synthetic local members through OTP + profile APIs; no production seed |

Integration coverage includes valid email/phone OTP, invalid attempt lockout, forced expired-OTP fixture, resend throttling, verified identity linking, DOB/minor rejection, mass assignment rejection, private-field exclusion, reciprocal eligibility, concurrent reciprocal likes with one match, idempotency conflict/replay, message persistence/authorization/duplicates, two-peer WebSocket delivery, Worker restart/history recovery, report creation and moderator-only audited resolution, premium gating/expiry, virtual-location behavior, Super Like/Boost balance protection, invalid/valid media, private quarantine, local queue moderation, deletion, blocking, export, access expiry, refresh rotation/reuse-family revocation and absent-provider rejection. These are scenarios with multiple assertions, not exhaustive coverage of every requested test matrix.

The Swift runner prints an empty XCTest discovery phase followed by **six executed Swift Testing tests**. The latter is the evidence; the zero-XCTest phase alone is not a passing functional suite. Native XCTest/XCUITest sources have not executed here.

Initial failures were corrected: user auth middleware intercepted admin routes; export lacked its specific auth scope; Wrangler attempted an unwritable home config path; browser selectors matched two headings; an admin path validator rejected underscore feature names; Vitest discovered Playwright files; Swift wire-field names needed explicit CodingKeys for strict formatting. The current scripts use writable config/cache paths and separate test runners.

Playwright's browser download was rejected by the network policy. The preinstalled `/usr/bin/chromium` was used successfully; no network policy was broadened. OpenNext bundling initially logged a home-directory write failure; the saved build script sets XDG_CONFIG_HOME/WRANGLER_LOG_PATH and the corrected build passed.

Not executed: full iOS SDK compilation/simulator/device tests; native accessibility audit; real Apple login, APNs or App Store Sandbox lifecycle; independently configured email/SMS/age/media/moderation providers; hosted Workers/R2/D1/Queues/Access deployment; official Swift OpenAPI generator build; Terraform init/plan/apply; CI workflows in GitHub; disaster recovery; 100/1k/10k/100k-user performance scenarios; legal/App Store review. Do not convert source presence or a local mock result into a production claim.
