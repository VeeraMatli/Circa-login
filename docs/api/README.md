# API contracts

Canonical OpenAPI 3.1: `packages/api-contract/openapi.json`. It documents 65 operations and shared schemas. Regenerate using `npm run contract:generate`; check route coverage using `npm run contract:check`. Shared TypeScript types are generated into `packages/shared-types/src/api.generated.ts`.

The native URLSession client implements these contracts manually in `Core/Networking`; Apple framework dependencies remain minimal. An optional Swift generator workflow is in `packages/api-contract/swift-client/`. It is not used by the app yet and has not run on this Linux host. Native contract decoding tests and macOS compilation are required before release.

All errors use `{error:{code,message,trace_id}}`; trace IDs also appear in `X-Trace-ID`. Opaque access tokens expire in 15 minutes. Refresh tokens rotate; reuse revokes the family. Mutations use validated strict object schemas; client-supplied identity/status/entitlement fields are rejected. Swipe mutations require `Idempotency-Key`. Conflicting/pending reservations return 409. A crashed pending reservation remains conservative until expiry; reconcile matches before trying a new key.

Collection responses use `{data,next_cursor}`; message history uses monotonically increasing `sequence` and `after`. Do not infer globally chronological ordering from UUID cursors. The received-like aggregate currently counts the bounded eligible candidate page, not an unbounded platform total. This limitation must be addressed before presenting a large exact count.

WebSocket: upgrade `/v1/realtime/connect?conversation_id=UUID` with the bearer header. Receive `message` events with persistent message DTOs. Send `typing` events only; send text through the idempotent REST endpoint. Reconnect then fetch REST history by sequence. No bearer credentials in query strings.
