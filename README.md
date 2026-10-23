# Anvaya

**Where meaningful connections begin.** Adults-only dating software built with SwiftUI, Cloudflare Workers/D1/R2/Durable Objects/Queues, and a Next.js operations portal.

This repository began as an empty README. It now contains a runnable local API/admin implementation and native iOS source with a generated Xcode project. It is **not production-ready or feature-complete**. Read the [release-readiness ledger](docs/release/readiness.md) for precisely implemented, mocked, untested and unfinished features.

## Local development

Requires Node 24, npm and Python 3.12+. macOS/iOS additionally require Xcode 16+ and Swift 6. The existing cloud checkout is isolated; use it directly and do not create worktrees unless requested.

```sh
npm run setup                # npm ci + frozen dependencies + local D1 migrations
npm run db:seed              # local reference interests/prompts only
npm run dev                  # Worker on loopback port 8787
```

In another terminal:

```sh
ANVAYA_LOCAL_ADMIN=true npm run dev:admin   # admin on loopback port 3000
python3 scripts/demo.py                     # optional, labeled synthetic LOCAL users
```

Do not deploy the local config or expose local admin/OTP mocks publicly. Local auth returns `local_code` from email/phone `/start`; the native app labels it as a mock. Synthetic demo users use New York city coordinates and are never seeded in production. Photo autoapproval, DOB-only age assurance, APNs delivery records and `/v1/dev/entitlements` are local mocks. All external production integrations fail closed if required configuration is missing.

```sh
npm run check:swift          # Linux/macOS shared contracts + Swift syntax/format (no iOS SDK)
npm run check                # lint, strict TS, unit tests, contract + schema checks
npm run test:integration     # isolated real Worker + D1/R2/DO/Queue workflow, including restart
npm run test:admin           # Playwright against running API + admin; system Chromium on Linux
npm run build                # Worker dry-run, verifier compile, Next production build
npm run build:cloudflare -w @anvaya/admin
```

For browser tests set CHROMIUM_PATH to an installed browser if `/usr/bin/chromium` is unavailable. On a normal developer machine `npx playwright install chromium` installs a compatible browser; this cloud image already has system Chromium.

## iOS on macOS

```sh
python3 scripts/generate-xcode.py
open apps/ios/Anvaya.xcodeproj
xcodebuild test -project apps/ios/Anvaya.xcodeproj -scheme Anvaya \
  -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO
```

Choose an available simulator if that model is absent. Debug API_BASE_URL defaults to loopback for a Mac-hosted API. The cloud Worker is on another machine: run the API locally on the Mac, or configure an approved authenticated HTTPS staging endpoint. Do not expose cloud mocks to the Internet. Configure Release API_BASE_URL, ANVAYA_BUNDLE_ID and DEVELOPMENT_TEAM through build settings; the default production URL is deliberately nonfunctional. Real Apple login, notifications and purchases require capabilities/provisioning and provider setup. Native source compilation requires macOS and is not claimed by Linux syntax checks.

If the simulator cannot connect to the server, run these commands from the repository root **on the same Mac as Xcode**:

```sh
npm run setup
npm run dev                 # keep this terminal running
```

In a second Mac terminal, `curl --fail http://127.0.0.1:8787/health` should succeed. Run the app using the **Debug** configuration and retry signup. Starting the API in the Codex cloud terminal does not start it on your Mac. Local signup displays a labeled mock verification code; it does not deliver email or SMS. Real delivery requires a deployed API and configured providers.

## Project map

```text
apps/ios/Anvaya.xcodeproj       iOS 17+, Swift 6 project + shared scheme
apps/ios/Anvaya/                native App/Core/Features/Resources
apps/ios/AnvayaTests/           Swift Testing contract/navigation tests
apps/ios/AnvayaUITests/         XCTest UI registration test
apps/admin/                    Next.js, Tailwind, Radix admin + browser tests
services/api/src/              Hono routes, authorization, repositories, DO, queue/scheduler
services/api/migrations/       forward-only D1 SQL; synthetic reference seeds are separate
services/apple-verifier/       optional Node wrapper for Apple's official verification SDK
packages/api-contract/         OpenAPI 3.1 and optional Swift generation package
packages/shared-types/         generated TypeScript contracts
infrastructure/               Cloudflare Terraform + deployment renderer
scripts/                       setup/demo, contract/schema/project checks
 tests/integration/            isolated real-runtime workflows
 tests/performance/            explicitly unexecuted capacity scenarios
 docs/                         architecture, decisions, API, security, operations, release
.github/workflows/             checks, macOS tests, protected API deployment
```

## Operating documentation

- [Architecture diagram](docs/architecture/overview.md) and [decisions](docs/decisions/0001-foundation.md)
- [API contracts](docs/api/README.md) and [OpenAPI](packages/api-contract/openapi.json)
- [Provider/credential setup](docs/operations/providers.md)
- [Deployment, migrations, backups and rollback](docs/operations/deployment.md)
- [Security/privacy threat model](docs/security/threat-model.md)
- [Cost assumptions and formulas](docs/operations/cost-model.md)
- [Validation evidence](docs/operations/validation.md)
- [App Store procedure](docs/release/app-store.md), [policy drafts](docs/release/policies.md) and [outstanding work](docs/release/readiness.md)

No production deployment, external provider success, App Store approval, legal review or population-scale capacity is implied by this source code.
