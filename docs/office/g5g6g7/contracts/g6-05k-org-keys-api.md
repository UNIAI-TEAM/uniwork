# G6-05k — Desktop uses the keys saved on UniWork (API contract)

> **Trạng thái:** in-progress (server D1 + d-f1 and fork F1–F3 + fixes are built and reviewed; the E2E spec is in
> progress). Decision record:
> [ADR 0034](../../../adr/0034-desktop-dung-khoa-luu-tren-uniwork-qua-proxy-byok.md), `accepted` 2026-10-15 (user
> answered Q-K1 = (a) at 15:10 UTC+7: the person's own keys saved on UniWork).

Card G6-05k (UNI-1637), lane g6-ai_server. User decision 2026-10-14 16:15 UTC+7, Q-M3 = (b). Base: D root
9d987d353; fork read at `feature/UNI-1632-g6-05m-model-chip` 668f8a28 (G6-05m), built on
`feature/UNI-1637-g6-05k-f1` (final d37f2df33). Canonical D API doc for the routes reused here:
`docs/office/g3g4/uniwork-office-app-api-contract.md` §3.1 (keys) and §3.2 (proxy).

Citations: **D** = this repo, **F** = the fork (`uniwork-office`), paths relative to each repo root. Code is cited by
file and name, not by line, because lines move.

## 1. What "org keys" means (summary of ADR 0034 QĐ1–QĐ2)

- The keys the signed-in person **saved on UniWork** for the desktop session's selected organization: the
  rows of `GET /orgs/{orgID}/ai/credentials`, the same ones the web AI settings show. Rows are personal,
  keyed by (organization, user, provider) — D `server/migrations/9991791524388000_ai_provider_credentials.up.sql`.
- The desktop never receives a key. The shell main process sends the vendor-shaped request to the UniWork
  proxy with the device access token; the server attaches the key and calls the vendor in `ai.Gateway.Proxy`
  (D `server/internal/ai/proxy.go`).
- Gate = the web's: `OrganizationService.RequireMember` (D `server/internal/service/organization.go`) →
  `EntitlementService.Can(orgID, FeatureOfficeAIBYOK)` (`office.ai_byok`, D `server/internal/service/entitlement.go`),
  both in `AIBYOKService.Proxy` (D `server/internal/service/ai_byok.go`); key from
  `AICredentialService.Resolve` (D `server/internal/service/ai_credentials.go`).
- An organization-wide admin key is **not** in scope: the user's Q-K1 answer was (a) (2026-10-15), so it stays the
  extension path in the ADR ("Hướng mở rộng (b)"). `Resolve` could later try the personal row and then an organization row without changing
  this contract. Q-K2..Q-K5 are decided (a) by the Advisor and built as described here.

## 2. Routes

All routes below sit in the `authed` group, which already accepts the desktop device session
(`mw.RequireAuthWithDevice`, D `server/internal/handler/router/router.go`; D `server/internal/middleware/auth.go`).
Auth = `Authorization: Bearer <device access token>`.
No route is added; one response field is added and one usage-row value changes.

| # | Method + path (`/api/v1` prefix) | Status | Handler (existing) | Change |
| --- | --- | --- | --- | --- |
| R1 | `GET /orgs/{orgID}/ai/credentials` | **REUSED + additive field** | `Routes.ListAICredentials` → `aiHandlers.listAICredentials` (D `handler/ai_credentials.go`; route `handler/router/ai_credentials.go`) | adds `byok` object (§2.1) |
| R2 | `POST /orgs/{orgID}/ai/byok/{aiProvider}/chat/completions` | **REUSED** | `AiByokChatCompletions` → `byokProxy(ProxyChatCompletions)` (D `handler/router/ai_byok.go`, `handler/ai_byok.go`) | usage capability per surface (§4) |
| R3 | `POST /orgs/{orgID}/ai/byok/{aiProvider}/messages` | **REUSED** | `AiByokMessages` (D `handler/router/ai_byok.go`) | same |
| R4 | `POST /orgs/{orgID}/ai/byok/{aiProvider}/generate` | **REUSED** | `AiByokGenerate` (D `handler/router/ai_byok.go`) | same |
| R5 | `GET /orgs/{orgID}/ai/byok/{aiProvider}/models` | **REUSED** | `AiByokModels` (D `handler/router/ai_byok.go`) | none (no usage row for listings) |

Not used by the desktop: `PUT`/`DELETE …/ai/credentials/{aiProvider}` (keys are managed on the web only; the
desktop never writes a server key row), and every `/office-frame/…` route.

### 2.1 R1 response (SDO `AICredentialListSDO`, D `handler/dto/sdo/ai_credentials.go`)

```jsonc
{
  "items": [
    { "provider": "openai", "label": "", "base_url": "", "key_hint": "…cdef",
      "model": "gpt-4.1-mini", "model_updated_at": "2026-10-11T08:00:00Z",
      "created_at": "2026-10-09T08:00:00Z", "updated_at": "2026-10-09T08:00:00Z" }
  ],
  "providers": [ { "id": "openai", "protocol": "openai-compatible", "requires_base_url": false,
                   "default_base_url": "https://api.openai.com/v1" } ],
  // Additive. Absent on older servers => the desktop shows no UniWork-key source.
  "byok": { "enabled": true, "reason": "" }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `byok.enabled` | bool | the caller may use the proxy in this organization now: member + `office.ai_byok` + credential store wired. Computed by `AIBYOKService.Status` (D `service/ai_byok.go`); `AIBYOKService.Enabled` is its boolean projection, which the frame grant uses (D `handler/office_frame_ai.go`). Reads no key, calls no vendor. |
| `byok.reason` | string | `""` when enabled; otherwise one of `entitlement_required`, `subscription_inactive`, `ai_credentials_unavailable`. The service passes a coded reason through only when it is on that closed list (`allowlistedBYOKReason`); any other code is logged and answered as `enabled: false, reason: ""` (fails closed). Clients treat an unknown value as "not enabled". |

Go type: `sdo.AIBYOKStatusDTO{Enabled bool; Reason string}` with `description`/`example` tags
(`docs/api-sdi-sdo.md`), field `BYOK` of `sdo.AICredentialListSDO`. The web frame route returns the same field
(shared handler); web clients ignore it (lenient schema).

Degradation (D `listAICredentials`): when `h.AIBYOK` is not wired, or `Status` returns an error, R1 still answers
**200** with the credential rows and a neutral `byok: {"enabled": false, "reason": ""}`, and logs
`ai: byok status lookup failed` on an error — a status problem never hides a person's saved keys.
`AICredentialService.Configured()` (`byokCredentialResolver` seam) tells `Status` whether `AI_CREDENTIAL_KEY` is set.

Status codes of R1 (unchanged): 200; 404 non-member (D `service/ai_credentials.go`); 503
`ai_credentials_unavailable`; 401 / 401 `device_revoked`; 429 bucket `ai-credentials` (30/min/person,
D `router/router.go`).

### 2.2 R2–R5 (unchanged wire, see API §3.2)

- Request: the vendor's own body (openai-compatible / anthropic) or `{ model, stream, request }` (gemini),
  ≤ 16 MiB JSON (D `handler/ai_byok.go`, `maxBYOKBody`). Forwarded request headers: the per-protocol allowlist only
  (`anthropic-beta`; `openai-organization`, `openai-project`; openrouter `http-referer`, `x-title`). The client
  sends no vendor key header; the server never forwards `authorization`, `x-api-key`, `x-goog-api-key`,
  `cookie` (ADR 0029 D3).
- Response: the vendor's status and bytes unchanged. `stream: true` → `text/event-stream`, vendor SSE framing
  as-is (OpenAI `data: {...}` … `data: [DONE]`; Anthropic `event:`/`data:` pairs; Gemini `alt=sse` chunks),
  flushed per chunk (D `handler/ai_byok.go`, `serveProxyStream`). Headers: `content-type` (narrowed), `retry-after`,
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  `Cache-Control: no-cache` + `X-Accel-Buffering: no` on streams.
- Model listing (R5): the vendor's JSON (`data[].id` for OpenAI/Anthropic, `models[].name` for Gemini). The desktop
  parses it with `modelIdsOfListBody` (F `packages/ai-provider/src/provider-models.ts`), the same path as a
  direct listing.

### 2.3 Status codes (R2–R5; the desktop maps each to the web frame's `KEY_CODES` states, F `web/e2e/ai-web.spec.ts`)

| HTTP | `code` | Source | Desktop state |
| --- | --- | --- | --- |
| 400 | `provider_not_supported`, `base_url_refused`, `invalid_request` | D `ai/errors.go` (`ErrProviderNotSupported`, `ErrBaseURLRefused`) | provider error line (no retry) |
| 401 | `unauthorized` | auth middleware | one refresh + retry before the stream starts (the keys host's `authorized`/`withAccessToken` dependency), then signed-out. Only a 401 that came from UniWork ends the source (`endsSession`, backed off once per window); a gateway 401 fails that one call |
| 401 | `device_revoked` | D `middleware/auth.go` | the account is told once (`refreshAfterDeviceRevoked` → the shell's signed-out flow); the source is dropped; R1 backs off per session owner (`r1RetryOwner`) so a new sign-in reads R1 at once |
| 402 | `credits_exhausted` | not produced by the proxy (credits 0); counts as a UniWork answer only with that code | — |
| 403 | `entitlement_required` | D `service/ai_byok.go` (`Proxy`, `s.ents.Can`) | "AI is not in your plan"; source hidden until the next list read |
| 404 | `credential_missing` | D `service/ai_byok.go`; also the non-member answer | re-read R1; the group disappears |
| 424 | `provider_auth_failed` | D `ai/errors.go` | "The AI key was refused" (fix on the web) |
| 429 | none (bucket) / vendor's | `ai-byok` bucket, D `router/router.go` | wait `Retry-After`, same as web |
| 502 | `provider_unreachable` | D `ai/errors.go` | "AI provider unreachable" |
| 503 | `ai_credentials_unavailable` | D `service/ai_credentials.go`; `Proxy` keeps it when `AI_CREDENTIAL_KEY` is unset (the gate reaches `Resolve`, it is not turned into a 404) | `keys_unavailable`: "Keys on UniWork unavailable" |
| 503 | `ai_byok_not_configured` | D `handler/ai_byok.go` (`byokProxy` when `h.AIBYOK == nil`) | `keys_unavailable` |
| 503 | `unavailable` | auth middleware's 503 | `keys_unavailable` |
| 503 | **no JSON error body** (gateway page, empty) | infrastructure in front of UniWork | the outage state: desktop `keys_unavailable`; web `cloud_outage` ("UniWork is temporarily unavailable", retry in a moment), not "not set up on the server" |
| 4xx/5xx | vendor's own body (key redacted) | D `ai/proxy.go` | passed to ai-provider unchanged (bad model etc.) |

A 404 counts as a proxy answer only when `code` is `credential_missing` (F `packages/ai-provider/src/proxy-url.ts`,
`proxyAnswered`; same rule the web used before it moved there); a route-level 404 without that code = old server (§6.3).
A **402 or 503** counts as a UniWork answer only when the JSON body carries a UniWork code
(`PROXY_402_503_CODES`: `credits_exhausted`, `cloud_unavailable`, `ai_credentials_unavailable`,
`ai_byok_not_configured`, `unavailable`) or, for 503 only, when the body is not a JSON error object at all
(`jsonErrorCode` returns `null`); a vendor's own 402/503 (JSON error without those codes) passes through to
ai-provider. In the shell the 503 codes map through `KEYS_UNAVAILABLE_CODES` (F `apps/shell/src/main/uniwork-auth/keys-errors.ts`).
The org stream error sends only the localized line (with the not-entitled / credits notice tags), never `errorCode` or
`retryAfterSec`, so the renderer's generic per-code texts do not replace the wait time.

## 3. Limits

| Limit | Value | Where |
| --- | --- | --- |
| Body | 16 MiB | D `handler/ai_byok.go` |
| Rate | 60/min per person on bucket `ai-byok`, **shared** by web host, web frames and desktop (identity `user:<id>`) | D `router/router.go` |
| Rate (key list R1) | 30/min per person, bucket `ai-credentials` | D `router/router.go` |
| Server timeouts | connect 15 s, headers 15 s (streams and models), idle 60 s between chunks, total 10 min | D `ai/provider/byok_client.go` |
| Client write deadline | 60 s per chunk | D `handler/ai_byok.go` |
| Desktop proxy calls | header wait 25 s for R5 (`KEY_PROXY_HEADER_TIMEOUT_MS`, above the server's 15 s), no total cap below 10 min; the existing per-vendor stream idle rules of ai-provider apply | F `apps/shell/src/main/uniwork-auth/keys.ts` |
| Desktop R1 | 5 s timeout (`CREDENTIALS_TIMEOUT_MS`); 30 s backoff after a failure (`CREDENTIALS_RETRY_MS`); a longer `Retry-After` is obeyed up to 5 min (`CREDENTIALS_RETRY_MAX_MS`); a good list is trusted 4 s (`CREDENTIALS_TTL_MS`) | same file; constants in `keys.ts` |
| Desktop R5 cache | 10 min per (deployment, user, org, provider, `key_hint:base_url:updated_at`); 60 s retry after an error | `MODEL_LIST_TTL_MS`, `MODEL_LIST_RETRY_MS` |

## 4. Audit and metering

- One `ai_usage_events` row per R2–R4 call (none for R5): organization, actor (human), capability, provider,
  model, status, reason code, input/output tokens when the vendor reports them, latency, `correlation_id`;
  credits 0. Never prompt, answer, key or file names (D `ai/proxy.go`, `Gateway.Proxy`).
- Capability `office.byok_desktop` (`ai.CapOfficeBYOKDesktop`, beside `CapOfficeBYOK`) when the request came on a
  device session, `office.byok` otherwise. `byokProxy` reads `middleware.DeviceSession(ctx)` and passes an
  `ai.ProxySurface` (`ProxySurfaceWeb` / `ProxySurfaceDesktop`) through `AIBYOKService.Proxy` into
  `ai.ProxyRequest.Surface`; `proxyCapability(surface)` picks the value. Service code does not import middleware.
  A web session and an `office_frame` token stay `office.byok`. Metric label `uniwork_ai_calls_total{capability}`
  gains the value; no migration (`capability TEXT NOT NULL`, no check, D `migrations/092_ai_gateway.up.sql`).
- The organization usage table labels the three Office capabilities in vi/en (D
  `packages/views/ai/ai-usage-section.tsx`, keys `office_uniwork_ai`, `office_byok`, `office_byok_desktop` in
  `packages/core/i18n/locales/{vi,en}.json`; a dot in the capability is normalised to `_`, because i18next splits keys
  on `.`).
- No `audit_events` row per call (not a business command, ADR 0029 D7) → `audit_coverage_test.go` unchanged.
  Key save/delete stay web-only and keep `ai.credential.saved` / `ai.credential.deleted`.
- Runbook `docs/runbooks/UniworkAiModelErrors.md` covers `office_uniwork_ai` only; BYOK is the vendor's
  account, no alert is added.

## 5. Isolation matrix and other guards

- No new route → no new `isoRoutes` row. R2–R5 are already classified with `skipControl: reasonBYOKVendor`
  (D `handler/isolation_routes_test.go`) and R1 is a path-tenant route covered by
  `TestIsolationMatrix`; the new `byok` field carries no id and no text of another tenant.
- No new body `_id` field → `TestEveryBodyIDFieldHasAReferenceCase` unchanged.
- `TestProviderSDKOnlyInAIProvider`, `TestAIPackageOnlyCallsAiQueries` unchanged (no new vendor call path).
- OpenAPI: R1's SDO gains `byok` (`sdo.AIBYOKStatusDTO`), built at start-up; no `pathParamSDI` change.
  `TestSwaggerSpecFollowsChiRoutesAndSDI` holds the route description.

## 6. Fork side

### 6.1 Model source shape (F `packages/ai-provider/src/types.ts`, additive)

```ts
export interface AiModelSource {
  readonly chosen: string
  readonly listed?: readonly string[] | undefined
  readonly listState?: 'loading' | 'error' | undefined
  /** G6-05k: where calls for this provider go. Absent or 'local' = the key on this machine (or the web
   *  host's own rows); 'org' = the key saved on UniWork, through the UniWork proxy. Derived, never saved. */
  readonly origin?: 'local' | 'org' | undefined
}

/** the model the user picked for one provider (chip or Settings), sent beside `ai:set-settings` */
export interface AiModelPick { readonly provider: AiProviderId; readonly model: string }

export interface AiSettingsSaveOptions {
  readonly modelPick?: AiModelPick | undefined          // the chip: one pick, saved at once
  readonly modelPicks?: readonly AiModelPick[] | undefined // Settings: one pending pick per provider, one Save
}
```

- **Explicit pick marker.** A desktop model pick is recorded only when the caller sends `modelPick` / `modelPicks`
  (the chip and the Settings pane do, through all six app preloads and the shell preload). Comparing the saved
  settings with the loaded ones is gone: a plain echo of the settings never records a pick. In main,
  `modelPicksOf` merges both fields (at most one pick per provider, the last wins, the list is cut at 64 before
  validation) and `validModelPick` takes a pick only with a string provider and a trimmed model of 1..200 characters
  (`MAX_PICKED_MODEL_LENGTH`); `keepOrgServedSlots(payload, stored, host, modelPicks)` records a pick only for an
  org-served provider whose slot is not claimed locally (`localSlotClaimed`: an `apiKey`, or a custom slot with its
  own base URL, even when incomplete).
- **Where the model lives.** `chosen` for an `org` source is decided by `chosenModelFor` (F
  `apps/shell/src/main/uniwork-auth/keys.ts`): the newer of the desktop pick and the server row's `model`
  (`model_updated_at`), the same newer-wins rule G6-05m uses on the web. The desktop pick is stored with a timestamp
  per account and organization in `app-settings.json` under `uniworkAiModelPicks` (`appSettingsModelPicks` in
  `keys-wiring.ts`) and is **never** written to `ai-settings.json`. `providers[id].apiKey` stays `''` and
  `providers[id].model` stays the stored slot; readers of "the current model" use `aiEffectiveModel`
  (`packages/ai-provider/src/providers.ts`), which reads `modelSources[id].chosen` before the slot.
- `listed`/`listState` = R5 through the proxy, cached in main memory (see §3).
- `providerNeed` / `isProviderUsable` (F `packages/ai-provider/src/providers.ts`) treat
  `modelSources[id].origin === 'org'` as configured (no key needed), and `isOrgServedReady` is the shared "ready"
  check (origin `org` and `providerNeed` null) that My AI and the Sheets agent use. The desktop does **not** copy the
  web's `key_hint` placeholder into `providers[id].apiKey`: a Settings save would write the placeholder into
  `ai-settings.json` as a local key, which would then win (ADR QĐ6).
- Main decides the route per call from its own state (stored `ai-settings.json` + the R1 list it read), never from
  `request.settings`: one helper, `resolveAiRoute` (F `apps/docs/src/main/ai-org-route.ts`, reached through `aiRouteOf`
  in `docs-main.ts`), serves `ai:stream`, `ai:chat` (`chatConfigOf`) and `ai:settings-test` (`runOnRoute`). Local usable
  key → direct (today); else `org` source present and `byok.enabled` → proxy; else today's "needs key" state. A refused
  org call becomes a one-shot failure through `orgKeyChatFailure` (settings test: `ORG_KEY_TEST_KIND`).

### 6.2 Chip and copy

The group header of an `org` provider shows a quiet tag after the provider name; the tag's tooltip, the
accessible description of its options (`aria-describedby`) and the first-use note carry the privacy line. The note
shows once per provider on first open (the seen flag is kept in `localStorage` under
`uniwork.ai.orgKeyNoteSeen.<provider>`, guarded by try/catch, plus an in-window set). Strings in
`packages/ui/src/strings-ai-model-picker.ts` (every language of `AI_MODEL_PICKER_STRINGS`; vi/en below are the
reviewed ones, the other 19 locales are real translations):

| Key | vi | en |
| --- | --- | --- |
| `orgKeyTag` | Khóa trên UniWork | Key on UniWork |
| `orgKeyNote` | Gửi qua máy chủ UniWork của tổ chức bằng khóa bạn đã lưu trên UniWork. UniWork chỉ ghi số liệu sử dụng, không lưu nội dung. | Sent through your organization's UniWork server with the key you saved on UniWork. UniWork records usage only and does not store the content. |
| `orgKeyChatHint` | Chat đi qua key đã lưu trên UniWork. Tạo ảnh, phân tích media và tìm kiếm web theo mục AI Media. | Chats go through the key saved on UniWork. Image generation, media analysis and web search follow the AI Media section. |
| `orgKeyManage` | Quản lý khóa trên UniWork (web) | Manage keys on UniWork (web) |
| `orgKeyUseLocal` | Dùng khóa trên máy này | Use a key on this computer |
| `orgKeyUseLocalCancel` | Quay lại khóa trên UniWork | Back to the key on UniWork |

No internal codes, no "BYOK"/"proxy" wording, no git/GitHub. Tag, note and tooltip styling is stylesheet classes with
tokens only (`.ai-model-org-tag`, `.ai-model-org-note` in `packages/ui/src/ai-model-picker.css`; no inline style).

**Settings › AI Model on the desktop** (F `apps/shell/src/renderer/src/SettingsModal.tsx`, `settings.css`) shows an
`org` provider as a read-only row: the tag as a pill on the label line next to "API key" (`.set-org-key-tag` inside
`.set-org-key-head`, no wrap, no shrink), the note below it, **no key hint and no key or base-URL fields**, and the two
buttons "Use a key on this computer" (`data-org-key-use-local`) and "Manage keys on UniWork (web)"
(`data-org-key-manage`, opens `<server>/settings/ai`) together in the API key row (`.set-org-key-actions`). Above
Model, the hint `orgKeyChatHint` replaces the own-key hint while the row is org-served (not while a local key is being
typed). "Use a key on this computer" reveals the normal key and base-URL fields (focus moves to `#set-ai-key`);
"Back to the key on UniWork" (`data-org-key-use-local-cancel`) restores the read-only row, drops the typed key and
returns focus to the button. A typed key is sent on Save and only then wins; Save never rewrites the key slot of an
org-served provider and shows the model main resolved (`modelSources[id].chosen`), not a copy of it in the slot.

### 6.3 Transport

- `toProxyRequest` + the 404/402/503 answer rules live in `packages/ai-provider/src/proxy-url.ts` (exports
  `toProxyRequest`, `isInsideAiMount`, `proxyAnswered`, `proxyErrorBodyFields`, `isProxyContractStatus`,
  `ProxyUrlError`), re-exported for the web (`web/modules/shared/ai/transport.ts`, which rethrows anything that is not
  a `ProxyUrlError`).
- Shell main: `UniworkKeysHost` (F `apps/shell/src/main/uniwork-auth/keys.ts`, with `keys-errors.ts`,
  `keys-credentials.ts`, `abortable-response.ts` / `bindResponseToSignal`) beside the UniWork AI host: `list()` (R1,
  R5 cache), `fetchFor(provider)` = a per-call fetch that rewrites the URL with
  `toProxyRequest(base = ${apiOrigin}/api/v1/orgs/${orgId}/ai, …)`, drops vendor key headers, adds the device bearer
  and refuses any origin outside `isAllowedOrigin` and any redirect. docs-main sees the host only through
  `setUniworkKeysHost` in `ai-org-route.ts` (the shell host extends that interface).
- **Settings reads never wait on R1.** `ai:get-settings` calls `void list()` and answers from the cached state
  (stale-while-revalidate); a changed list announces itself once through `onChanged`. R1 has a 5 s timeout and a 30 s
  backoff (§3). Only a 404, or a parsed `byok.enabled === false` / missing `byok`, drops the source; 429, 5xx, timeouts
  and network errors keep the last good list. `ai:stream` waits for R1 only when no local slot is usable and no org
  source is cached, bounded by the same timeout and backoff (`resolveAiRoute`).
- **No `globalThis.fetch` patching.** `installOrgFetchDispatcher` installs one `setPrimaryFetch` dispatcher
  (F `packages/ai-provider/src/fetch.ts`), once, in `registerAiIpc`; it reads an `AsyncLocalStorage` scope per call and
  otherwise calls `globalThis.fetch`, so a local-key stream and org streams run side by side.
- Sign-out, org switch, device revoked → clear the list/cache and abort every running proxy stream (same hook
  that cancels UniWork AI turns). Offline / not signed in / R1 without `byok` / R1 404 without
  `credential_missing` → no `org` sources (G6-05m behaviour).

## 7. Tests that prove it

Names below were checked against the D tree and the fork tree (`feature/UNI-1637-g6-05k-f1`) when this was written.

D (Go, exact files; whole suites on the cloud runner):
1. `server/internal/handler/ai_byok_test.go`: `TestAIBYOKDeviceSessionStreamsAndMetersDesktopCapability` — a device-session
   bearer reaches R2 with a fake vendor and gets the SSE bytes unchanged, the row is `office.byok_desktop`, and a revoked
   device session answers 401 `device_revoked`; `TestAIBYOKWebAndDeviceSessionsShareRateLimitBudget` — a web bearer and a
   device bearer of the same user share one `ai-byok` budget (61st call → 429). Router level:
   `TestAIBYOKProxyBudgetsEachSignedInUserAcrossProviders` (`server/internal/handler/router/ai_byok_ratelimit_test.go`).
   Frame: `TestOfficeFrameAIHappyPath` (`server/internal/handler/office_frame_ai_test.go`) pins that an `office_frame`
   token records `office.byok`, never `office.byok_desktop`.
2. `server/internal/ai/proxy_test.go`: `TestProxySurfaceCapability` and `TestGatewayProxyStreamsAndMetersBYOK` — the
   desktop surface settles a row with `CapOfficeBYOKDesktop`, web keeps `CapOfficeBYOK`.
3. `server/internal/service/ai_byok_test.go`: `TestAIBYOKServiceEnabled` — `Status` returns enabled,
   `entitlement_required`, `subscription_inactive` (suspended subscription), `ai_credentials_unavailable` (unwired store),
   an unexpected coded error is logged and answered neutral, non-member → `ErrNotFound`; `TestAIBYOKServiceGates` — the
   `noBox` service (no `AI_CREDENTIAL_KEY`) still answers 503 `ai_credentials_unavailable` on `Proxy`.
4. `server/internal/handler/ai_credentials_test.go`: `TestAICredentialHTTPListCarriesBYOKStatus` — R1 carries `byok` for
   a web and a device session, is neutral when `h.AIBYOK` is nil, and stays 200 with the rows when `Status` errors.
5. Usage labels: `packages/views/settings/components/ai-tab.test.tsx` (the usage table shows the translated labels
   for `office.byok` and `office.byok_desktop`, not the raw strings) and `packages/core/i18n/parity.test.ts`.
6. Existing guards stay green: `TestIsolationMatrix`, `TestIsolationRealtime` (untouched),
   `TestProviderSDKOnlyInAIProvider`, `TestAIPackageOnlyCallsAiQueries`, `TestEveryAuditedCommandWritesItsRow`,
   `TestReusedAuditActionCommandsWriteTheirOwnRows`, `TestEveryBodyIDFieldHasAReferenceCase`,
   `TestSwaggerSpecFollowsChiRoutesAndSDI`.
7. `packages/core` is not touched (the D web host does not read `byok`).

F (vitest, exact files; run from the app directory for apps with `?raw` imports):
8. `packages/ai-provider/tests/proxy-url.test.ts` — the web table now from the shared module (chat, `/v1/messages`,
   Gemini stream/non-stream, foreign URL refused, a URL that leaves the mount refused), "distinguishes proxy 404
   credential_missing from vendor or route 404s", "counts a 402 or 503 as a proxy answer only with a UniWork code (vendor
   ones pass through)", "counts a 503 with no JSON error body (gateway page, empty body) as a UniWork answer".
   `packages/ai-provider/tests/providers.test.ts` — `origin: 'org'` is usable without a key, `origin` absent unchanged.
   `packages/ai-provider/tests/effective-model.test.ts` — `aiEffectiveModel` reads the source model before the slot.
   `packages/ai-provider/tests/ai-chat-handlers-untagged.test.ts` — the `chatConfigOf` guard.
9. `apps/shell/tests/uniwork-keys.test.ts` — "enforces the precedence table per provider: local key for X goes direct,
   org key for Y goes via proxy", "hides org sources and fails locally without calling proxy when byok.enabled is false or
   signed out", "aborts an in-flight proxied stream and clears R1/R5 caches on sign-out and on org switch", "404
   credential_missing removes the provider and re-reads R1 immediately, while vendor 404 passes through", "maps §2.3
   proxy statuses: …", "ai:get-settings answers at once while R1 never answers (local keys only, no wait)", "a failing R1
   costs one request per backoff window, and a landing R1 announces itself once", "R1 429 / 5xx keep the last good list (no
   flap, Retry-After honoured); only 404 drops the source", "a vendor 402 / 503 / 400 passes through; only a UniWork-coded
   503 is a proxy state", "ai:chat and ai:settings-test use the org key through the proxy for an org-only provider",
   "never replaces globalThis.fetch, works without a fetch dependency, and keeps concurrent streams apart", "keeps the
   device bearer out of stream errors and logs, and refuses redirects on R1 and proxy calls", "records exactly the picked
   model: the default, A then the default, never a plain echo", "one Save records a pick for each org-served provider; at
   most one per provider, malformed entries dropped", "keeps model picks apart per account and per organization", "caps a
   huge Retry-After on R1 at five minutes", "times R1 out after 5 s through the request signal and backs off", "a re-sign-in
   after device_revoked reads R1 at once, a same-session read stays quiet". `apps/shell/tests/uniwork-keys-wiring.test.ts`
   — the pick store round trip and the revoked-device refresh wiring.
10. `apps/shell/tests/settings-ai-model-list.test.ts` — the org row is read-only in en and vi, saving Settings keeps every
    local key and base URL byte-identical, "use a key on this computer" opens the key fields and cancel restores the row,
    focus moves, the tag pill and the use-local/manage buttons share the API key row, "picks for two org-served providers
    before one Save are all sent in that save". `apps/shell/tests/settings-uniwork-pick.test.ts` pins the preload wiring
    of the pick options. `apps/shell/tests/my-ai-activation.test.ts` ("is ready for a provider served by a key saved on
    UniWork, not without that source") and `apps/sheets/tests/agent-configured.test.ts` cover the shared readiness.
11. `packages/ui/tests/ai-model-picker-org-note.test.ts` — the note shows once per provider (also after a remount), org
    options are described by tag and note, the chip reads the source `chosen` model, a key on this computer renders as
    before, the styling uses classes with tokens and no inline style; `packages/ui/tests/ai-model-picker-data.test.ts` —
    a pick still writes the whole selection through the bridge.
12. Web: `web/modules/shared/ai/ai.test.ts` — "passes a vendor 402 / 503 through; a UniWork-coded one is the typed state",
    "a 503 without a JSON error body (gateway page, empty body) is the typed cloud_outage state".

E2E (one, fork, CI-replica spec on the cloud runner) — **in progress**: signed-in desktop renderer against the fake
server (`AI_PROVIDER=fake` style fake vendor): a key saved via `PUT …/ai/credentials/openai` on the server appears as
"Key on UniWork" in the chip with the live list, a streamed answer arrives, the request log shows the device bearer and
no vendor key, and after `DELETE` of the key the group disappears on the next read.

## 8. Slice plan and status

Dependencies: D1 is independent of F; F1 first on the fork, F2/F3 after F1; F2 and F3 in parallel. F can build
against today's servers with the `byok` field faked in tests; the source only lights up on a D1 server.

| Slice | Repo | Kind | Files | Status |
| --- | --- | --- | --- | --- |
| D1 server | D | BE | `server/internal/handler/dto/sdo/ai_credentials.go` (`AIBYOKStatusDTO`), `handler/ai_credentials.go`, `handler/ai_byok.go` (surface), `service/ai_byok.go` (`Status`, surface), `ai/proxy.go` (`CapOfficeBYOKDesktop`, `ProxySurface`), tests 1–4, API doc §3.1/§3.2 | **done** (acaf3d4b7, ee235dfcd, 6e0f450e4); cloud d-r1 + d-r2 pass on 8f702c37b |
| d-f1 server fixes | D | BE | `service/ai_byok.go` (503 kept, closed reason list, `Configured()`), `handler/ai_credentials.go` (degrade to 200), frame/device/inactive tests, usage-table labels | **done** (663cfeb9a, 9b1451020, cb3d0397d, bb4f9d79c); BE review r2 clear |
| D2 docs | D | docs | ADR 0034 aligned with the build, this contract, README draft note | **done**; Q-K1 = (a) answered 2026-10-15, ADR 0034 accepted: moved to `docs/adr/`, README table row and the `CLAUDE.md` Audit and Events line (naming tests 1–2) added |
| F1 shared | F | BE/FE shared | `packages/ai-provider/src/types.ts` (`origin`), `providers.ts` (`providerNeed`), `proxy-url.ts`, `web/modules/shared/ai/transport.ts`, tests 8 | **done** (2ef439e2, 7ad5c5f2) |
| F2 shell main | F | BE (Electron main) | `apps/shell/src/main/uniwork-auth/keys*.ts`, `index.ts`, `keys-wiring.ts`, `apps/docs/src/main/docs-main.ts`, `ai-org-route.ts`, test 9 | **done** (c599a708; fixes 7e5b7fb0…0d9cc4a2 fx-main, a8a431a0…4ab390ef fx2); shell reviews r1/r2 clear |
| F3 renderer | F | FE | `packages/ui/src/strings-ai-model-picker.ts`, `AiModelPicker.tsx`, `ai-model-picker.css`, `apps/shell/src/renderer/src/SettingsModal.tsx`, `settings.css`, tests 10–11 | **done** (489844bc, 5cc2f429; fixes a19796c5…812296e5 fx-ui, 285a42298…cab138215 fx3, beaa03cce, d37f2df33 fx4); FE reviews clear; tester_visual r2 pass |
| E2E | F | test | one spec in the CI-replica e2e shard | **in progress** |

Fork final: `d37f2df3`, fork cloud r3 (CI replica: `office-ci-test` 0 failed, `office-ci-e2e` 192 pass / 34 skip baseline /
0 fail). Reviewers: D1 BE reviewer; F2 BE reviewer; F1/F3 FE reviewer; visual check of the chip tag and the Settings row
(light/dark, vi/en) by tester_visual.

## 9. Residuals (none blocking)

- D owner: the Anthropic R5 model listing calls `/v1/models` without `limit`, so only a short first page is listed
  (`vendorCall` in D `server/internal/ai/proxy.go`).
- Usage table: the other capabilities (`chat_call_summary`, `email_thread_summary`, `cloud_*`, `media_analysis`) still
  render as raw strings (pre-existing, out of this slice).
- Tests only (G05K4-1, G05K4-2, to G6-05u): the 64-entry picks cap is not pinned by a test; the "org source but no model"
  not-ready case is not pinned.
- An org-served row's "use a key on this computer" mode resets on every Settings reload (by design of the transient
  form). The Settings pane keeps one pending pick per provider and sends them all in one Save; a pick equal to the stored
  slot model cannot be told from an echo and is not recorded.
- Org-wide admin keys (Q-K1 option (b)) were not chosen (user answered (a), 2026-10-15); a later card would add them in
  `Resolve` without changing the desktop contract (ADR 0034, "Hướng mở rộng (b)").
