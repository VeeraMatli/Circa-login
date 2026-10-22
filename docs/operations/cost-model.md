# Cost model — estimates, not capacity evidence

No provider prices have been verified during this task. Unit-price cells are intentionally blank inputs. Populate them from the linked official pricing pages with the date/currency/region and contractual plan before budgeting. Do not treat blank prices as free. Infrastructure estimates exclude tax, refunds, payment commissions, staff and legal costs.

| Driver | Planning assumption per registered user/month | Formula | Official unit-price source |
|---|---|---|---|
| Workers | 30% MAU, 20 sessions/MAU, 35 requests/session | N × .3 × 20 × 35 requests plus queue/cron | https://developers.cloudflare.com/workers/platform/pricing/ |
| D1 reads | 40 rows read/API request (measure query plans) | requests × 40 rows | https://developers.cloudflare.com/d1/platform/pricing/ |
| D1 writes | 15% of API requests, 3 indexed row writes each | requests × .15 × 3 | Same D1 source; indexed writes also matter |
| D1 storage | 0.5 MB/member plus 250 messages × 1 KB/MAU | N × .5 MB + N × .3 × 250 KB | Same D1 source |
| R2 storage | 5 photos × .4 MB per approved member | N × 2 MB (plus backups, processing and quarantines) | https://developers.cloudflare.com/r2/pricing/ |
| R2 operations | 10 uploads/replacements + 500 photo reads/MAU | N × .3 × (10 class A, 500 class B) | Same R2 source; caching changes reads |
| Durable Objects | 20 × 8 minutes of chat/member active month, 250 message events | N × .3 × 20 × 480 socket seconds plus event CPU/storage | https://developers.cloudflare.com/durable-objects/platform/pricing/ ; hibernation changes billed duration |
| Queues | 5 photo jobs + 300 notification jobs/MAU, 3 operations/job before retries | N × .3 × 305 × 3 | https://developers.cloudflare.com/queues/platform/pricing/ |
| SMS | 20% of new users, 1.5 messages per attempt | new_users × .2 × 1.5 × country-specific rate | https://www.twilio.com/en-us/sms/pricing |
| Email | 80% new users × 1.5 OTPs, plus recovery | new_users × .8 × 1.5 + recovery emails | https://resend.com/pricing |
| Image processing/moderation | 5 initial photos plus 1 replacement/MAU | new_users × 5 + N × .3 | Obtain quotes for region, retention and human escalation |
| APNs | 300 notification attempts/MAU | N × .3 × 300; include Worker/provider overhead | https://developer.apple.com/programs/whats-included/ ; developer membership is separate |
| AI | Disabled | 0 requests unless explicitly enabled with a budget | Provider quote required before enabling |
| Admin / verifier hosting | Monthly base + request/compute usage | provisioned plan + measured usage | Cloudflare and chosen verifier host official plan |
| Monitoring/backups | 10% sampled non-sensitive traces, encrypted DB/media copies | event bytes × retention + stored backup GB + operations | Chosen official providers; restrict staff access |

| Registered users | Assumed MAU | API requests/month | D1 read rows | Photo storage before backups |
|---:|---:|---:|---:|---:|
| 100 | 30 | 21,000 | 840,000 | 0.2 GB |
| 1,000 | 300 | 210,000 | 8,400,000 | 2 GB |
| 10,000 | 3,000 | 2,100,000 | 84,000,000 | 20 GB |
| 100,000 | 30,000 | 21,000,000 | 840,000,000 | 200 GB |

Cost(driver) = max(0, usage - included plan allocation) × official unit rate + applicable base price. Sum all drivers and include paid-provider minimums. Registered-user count is not concurrent activity. These are workload assumptions, not measured readiness or a promise of monthly cost.

Implemented safeguards: 25 free Likes per rolling 24 hours, authenticated request limits, OTP abuse limits, 10 MB uploads/9 photos, 2,000-character messages, 30 sends/minute, bounded provider timeouts, three queue retries then DLQ, high-cost features default off. Costs still need provider-side SMS spending caps, Cloudflare budget notifications, R2 lifecycle rules, cost dashboards, rate-limit storage monitoring and measured alert thresholds. Set 50/80/100% monthly-budget alerts in provider accounts and test delivery; no deployed budget alerts are claimed.
