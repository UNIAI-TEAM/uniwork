# G6-05k — Desktop uses the keys saved on UniWork (API contract)

> **Trạng thái:** in-progress (draft, contract first; nothing implemented). Decision record:
> [ADR 0034 draft](../../../adr/drafts/0034-desktop-dung-khoa-luu-tren-uniwork-qua-proxy-byok.md), `proposed`.

Card G6-05k (UNI-1637), lane g6-ai_server. User decision 2026-10-14 16:15 UTC+7, Q-M3 = (b). Base: D root
9d987d353; fork read at `feature/UNI-1632-g6-05m-model-chip` 668f8a28 (G6-05m). Canonical D API doc for the
routes reused here: `docs/office/g3g4/uniwork-office-app-api-contract.md` §3.1 (keys) and §3.2 (proxy).

Citations: **D** = this repo, **F** = the fork (`uniwork-office`), paths relative to each repo root.

## 1. What "org keys" means (summary of ADR 0034 D1–D2)

- The keys the signed-in person **saved on UniWork** for the desktop session's selected organization: the
  rows of `GET /orgs/{orgID}/ai/credentials`, the same ones the web AI settings show. Rows are personal,
  keyed by (organization, user, provider) — D `server/migrations/9991791524388000_ai_provider_credentials.up.sql:9-25`.
- The desktop never receives a key. The shell main process sends the vendor-shaped request to the UniWork
  proxy with the device access token; the server attaches the key and calls the vendor in `ai.Gateway.Proxy`
  (D `server/internal/ai/proxy.go:109-196`).
- Gate = the web's: `OrganizationService.RequireMember` (D `server/internal/service/organization.go:135`) →
  `EntitlementService.Can(orgID, "office.ai_byok")` (D `server/internal/service/entitlement.go:221`), both in
  `AIBYOKService.Proxy` (D `server/internal/service/ai_byok.go:42-69`); key from
  `AICredentialService.Resolve` (D `server/internal/service/ai_credentials.go:368`).
- An organization-wide admin key is **not** in scope (open question Q-K1).

## 2. Routes

All routes below sit in the `authed` group, which already accepts the desktop device session
(`mw.RequireAuthWithDevice`, D `server/internal/handler/router/router.go:204-209`;
D `server/internal/middleware/auth.go:23-60`). Auth = `Authorization: Bearer <device access token>`.
No route is added; one response field is added and one usage-row value changes.

| # | Method + path (`/api/v1` prefix) | Status | Handler (existing) | Change |
| --- | --- | --- | --- | --- |
| R1 | `GET /orgs/{orgID}/ai/credentials` | **REUSED + additive field** | `Routes.ListAICredentials` → `aiHandlers.listAICredentials` (D `handler/ai_credentials.go:40-66`; route `handler/router/ai_credentials.go:73-79`) | adds `byok` object (§2.1) |
| R2 | `POST /orgs/{orgID}/ai/byok/{aiProvider}/chat/completions` | **REUSED** | `AiByokChatCompletions` → `byokProxy(ProxyChatCompletions)` (D `handler/router/ai_byok.go:22-29`, `handler/ai_byok.go:22-45`) | usage capability per surface (§4) |
| R3 | `POST /orgs/{orgID}/ai/byok/{aiProvider}/messages` | **REUSED** | `AiByokMessages` (D `handler/router/ai_byok.go:30-37`) | same |
| R4 | `POST /orgs/{orgID}/ai/byok/{aiProvider}/generate` | **REUSED** | `AiByokGenerate` (D `handler/router/ai_byok.go:38-45`) | same |
| R5 | `GET /orgs/{orgID}/ai/byok/{aiProvider}/models` | **REUSED** | `AiByokModels` (D `handler/router/ai_byok.go:46-52`) | none (no usage row for listings, D `ai/proxy.go:125`) |

Not used by the desktop: `PUT`/`DELETE …/ai/credentials/{aiProvider}` (keys are managed on the web only; the
desktop never writes a server key row), and every `/office-frame/…` route.

### 2.1 R1 response (SDO `AICredentialListSDO`, D `handler/dto/sdo/ai_credentials.go:28-31`)

```jsonc
{
  "items": [
    { "provider": "openai", "label": "", "base_url": "", "key_hint": "…cdef",
      "model": "gpt-4.1-mini", "model_updated_at": "2026-10-11T08:00:00Z",
      "created_at": "2026-10-09T08:00:00Z", "updated_at": "2026-10-09T08:00:00Z" }
  ],
  "providers": [ { "id": "openai", "protocol": "openai-compatible", "requires_base_url": false,
                   "default_base_url": "https://api.openai.com/v1" } ],
  // NEW (additive). Absent on older servers => the desktop shows no UniWork-key source.
  "byok": { "enabled": true, "reason": "" }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `byok.enabled` | bool | the caller may use the proxy in this organization now: member + `office.ai_byok` + credential store wired. Same computation as `AIBYOKService.Enabled` (D `service/ai_byok.go:76-91`), which the frame grant already uses (D `handler/office_frame_ai.go:63`). Reads no key, calls no vendor. |
| `byok.reason` | string | `""` when enabled; otherwise the gate's code: `entitlement_required`, `subscription_inactive` (the entitlement service's codes), or `ai_credentials_unavailable`. Clients treat an unknown value as "not enabled". |

New Go type: `sdo.AIBYOKStatusDTO{Enabled bool; Reason string}` with `description`/`example` tags
(`docs/api-sdi-sdo.md`). `Enabled` gains a sibling that returns the reason (or `Enabled` returns
`(bool, string, error)`); the frame caller keeps its boolean. The web frame route returns the same field
(shared handler); web clients ignore it (lenient schema).

Status codes of R1 (unchanged): 200; 404 non-member (D `service/ai_credentials.go:156-170`); 503
`ai_credentials_unavailable`; 401 / 401 `device_revoked`; 429 bucket `ai-credentials` (30/min/person,
D `router/router.go:262`).

### 2.2 R2–R5 (unchanged wire, see API §3.2)

- Request: the vendor's own body (openai-compatible / anthropic) or `{ model, stream, request }` (gemini),
  ≤ 16 MiB JSON (D `handler/ai_byok.go:17`). Forwarded request headers: the per-protocol allowlist only
  (`anthropic-beta`; `openai-organization`, `openai-project`; openrouter `http-referer`, `x-title`). The client
  sends no vendor key header; the server never forwards `authorization`, `x-api-key`, `x-goog-api-key`,
  `cookie` (ADR 0029 D3).
- Response: the vendor's status and bytes unchanged. `stream: true` → `text/event-stream`, vendor SSE framing
  as-is (OpenAI `data: {...}` … `data: [DONE]`; Anthropic `event:`/`data:` pairs; Gemini `alt=sse` chunks),
  flushed per chunk (D `handler/ai_byok.go:60-94`). Headers: `content-type` (narrowed), `retry-after`,
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  `Cache-Control: no-cache` + `X-Accel-Buffering: no` on streams.
- Model listing (R5): the vendor's JSON (`data[].id` for OpenAI/Anthropic, `models[].name` for Gemini).

### 2.3 Status codes (R2–R5; the desktop maps each to the web frame's `KEY_CODES` states, F `web/e2e/ai-web.spec.ts:15-22`)

| HTTP | `code` | Source | Desktop state |
| --- | --- | --- | --- |
| 400 | `provider_not_supported`, `base_url_refused`, `invalid_request` | D `ai/errors.go:55-57` | provider error line (no retry) |
| 401 | `unauthorized` | auth middleware | one refresh + retry before the stream starts (shell `authorized()`), then signed-out |
| 401 | `device_revoked` | D `middleware/auth.go:44-49` | signed-out flow of the shell; source dropped |
| 402 | `credits_exhausted` | not produced by the proxy (credits 0) | — |
| 403 | `entitlement_required` | D `service/ai_byok.go:54` | "AI is not in your plan"; source hidden until the next list read |
| 404 | `credential_missing` | D `service/ai_byok.go:57-63`; also the non-member answer (`:43-48`) | re-read R1; the group disappears |
| 424 | `provider_auth_failed` | D `ai/errors.go:58` | "The AI key was refused" (fix on the web) |
| 429 | none (bucket) / vendor's | `ai-byok` bucket, D `router/router.go:219` | wait `Retry-After`, same as web |
| 502 | `provider_unreachable` | D `ai/errors.go:59` | "AI provider unreachable" |
| 4xx/5xx | vendor's own body (key redacted) | D `ai/proxy.go:178-188` | passed to ai-provider unchanged (bad model etc.) |

A 404 counts as a proxy answer only when `code` is `credential_missing` (same rule as F
`web/modules/shared/ai/transport.ts:89-98`); a route-level 404 without that code = old server (§5).

## 3. Limits

| Limit | Value | Where |
| --- | --- | --- |
| Body | 16 MiB | D `handler/ai_byok.go:17` |
| Rate | 60/min per person on bucket `ai-byok`, **shared** by web host, web frames and desktop (identity `user:<id>`) | D `router/router.go:196`, `:219`, `:285-297` |
| Rate (key list R1) | 30/min per person, bucket `ai-credentials` | D `router/router.go:262` |
| Server timeouts | connect 15 s, headers 15 s (streams and models), idle 60 s between chunks, total 10 min | D `ai/provider/byok_client.go:66-75` |
| Client write deadline | 60 s per chunk | D `handler/ai_byok.go:51` |
| Desktop client | header wait ≥ 20 s (above the server's 15 s), no total cap below 10 min; the existing per-vendor stream idle rules of ai-provider apply | F slice 1 |

## 4. Audit and metering

- One `ai_usage_events` row per R2–R4 call (none for R5): organization, actor (human), capability, provider,
  model, status, reason code, input/output tokens when the vendor reports them, latency, `correlation_id`;
  credits 0. Never prompt, answer, key or file names (D `ai/proxy.go:124-152`).
- **Change:** capability `office.byok_desktop` (new const beside `CapOfficeBYOK`, D `ai/proxy.go:33`) when the
  request came on a device session, `office.byok` otherwise. The handler reads `middleware.DeviceSession(ctx)`
  (D `middleware/auth.go:99`) and passes a `Surface` value down through `AIBYOKService.Proxy` into
  `ai.ProxyRequest`; service code does not import middleware. Metric label `uniwork_ai_calls_total{capability}`
  gains the value; no migration (`capability TEXT NOT NULL`, no check, D `migrations/092_ai_gateway.up.sql:30`).
- No `audit_events` row per call (not a business command, ADR 0029 D7) → `audit_coverage_test.go` unchanged.
  Key save/delete stay web-only and keep `ai.credential.saved` / `ai.credential.deleted`.
- Runbook `docs/runbooks/UniworkAiModelErrors.md` covers `office_uniwork_ai` only; BYOK is the vendor's
  account, no alert is added.

## 5. Isolation matrix and other guards

- No new route → no new `isoRoutes` row. R2–R5 are already classified with `skipControl: reasonBYOKVendor`
  (D `handler/isolation_routes_test.go:382-385`) and R1 is a path-tenant route covered by
  `TestIsolationMatrix`; the new `byok` field carries no id and no text of another tenant.
- No new body `_id` field → `TestEveryBodyIDFieldHasAReferenceCase` unchanged.
- `TestProviderSDKOnlyInAIProvider`, `TestAIPackageOnlyCallsAiQueries` unchanged (no new vendor call path).
- OpenAPI: R1's SDO gains `byok` (`sdo.AIBYOKStatusDTO`), built at start-up; no `pathParamSDI` change.

## 6. Fork side

### 6.1 Model source shape (F `packages/ai-provider/src/types.ts:154-161`, additive)

```ts
export interface AiModelSource {
  readonly chosen: string
  readonly listed?: readonly string[] | undefined
  readonly listState?: 'loading' | 'error' | undefined
  /** NEW (G6-05k): where calls for this provider go. Absent or 'local' = the key on this machine (or the
   *  web host's own rows); 'org' = the key saved on UniWork, through the UniWork proxy. Derived, never saved. */
  readonly origin?: 'local' | 'org' | undefined
}
```

- `chosen` for an `org` source = the server row's `model` (R1), the same newer-wins rule G6-05m uses on the
  web against a local pick (desktop pick stored in the account store, not in `ai-settings.json`).
- `listed`/`listState` = R5 through the proxy, cached in main memory per (deployment, user, org, provider,
  `key_hint:base_url:updated_at`), 10 min TTL, 60 s retry after an error (G6-05m web rule).
- `providerNeed` / `isProviderUsable` (F `packages/ai-provider/src/providers.ts:469`) treat
  `modelSources[id].origin === 'org'` as configured (no key needed). The desktop does **not** copy the web's
  `key_hint` placeholder into `providers[id].apiKey` (F `web/modules/shared/ai/web-ai.ts:626-632`): a Settings
  save would write the placeholder into `ai-settings.json` as a local key, which would then win (ADR D6).
- Main process decides the route per call from its own state (stored `ai-settings.json` + the R1 list it read),
  never from `request.settings` (F `apps/docs/src/main/docs-main.ts:3973-3990` already sanitises settings):
  local usable key → direct (today); else `org` source present and `byok.enabled` → proxy; else today's
  "needs key" state.

### 6.2 Chip and copy

The group header of an `org` provider shows a quiet tag after the provider name; the tag's tooltip and the
first-use notice carry the privacy line. New strings in `packages/ui/src/strings-ai-model-picker.ts` (every
language of `AI_MODEL_PICKER_STRINGS`; vi/en below are the reviewed ones, others follow the glossary):

| Key | vi | en |
| --- | --- | --- |
| `orgKeyTag` | Khóa trên UniWork | Key on UniWork |
| `orgKeyNote` | Gửi qua máy chủ UniWork của tổ chức bằng khóa bạn đã lưu trên UniWork. UniWork chỉ ghi số liệu sử dụng, không lưu nội dung. | Sent through your organization's UniWork server with the key you saved on UniWork. UniWork records usage only and does not store the content. |
| `orgKeyManage` | Quản lý khóa trên UniWork (web) | Manage keys on UniWork (web) |

No internal codes, no "BYOK"/"proxy" wording, no git/GitHub. Settings › AI Model on the desktop shows an
`org` provider as a read-only row (key hint + `orgKeyManage` link opening the web settings), no edit field.

### 6.3 Transport

- Move `toProxyRequest` + the 404 rule from F `web/modules/shared/ai/transport.ts:44-98` into
  `packages/ai-provider` (e.g. `src/proxy-url.ts`), re-export for the web (no behaviour change there).
- Shell main: a `UniworkKeysHost` beside `UniworkAiHost` (F `apps/docs/src/main/docs-main.ts:3783-3796`):
  `list()` (R1 + R5 cache), `fetchFor(provider)` = a per-call fetch that rewrites the URL with
  `toProxyRequest(base = ${apiOrigin}/api/v1/orgs/${orgId}/ai, …)`, drops vendor key headers, adds the device
  bearer through `authorized()` (pattern F `apps/shell/src/main/uniwork-auth/ai-chat.ts:46-60`) and refuses any
  origin outside `isAllowedOrigin`. The global `setPrimaryFetch` (F `packages/ai-provider/src/fetch.ts:20-29`)
  is **not** used on desktop: local-key calls keep the direct fetch in the same process.
- Sign-out, org switch, device revoked → clear the list/cache and abort every running proxy stream (same hook
  that cancels UniWork AI turns). Offline / not signed in / R1 without `byok` / R1 404 without
  `credential_missing` → no `org` sources (G6-05m behaviour).

## 7. Tests that prove it

D (Go, exact files; whole suites on the cloud runner):
1. `server/internal/handler/ai_byok_test.go` (or the existing handler test file for the proxy): a **device-session**
   bearer reaches R2 with a fake vendor and gets the SSE bytes unchanged; a web bearer and a device bearer of
   the same user share one `ai-byok` budget (61st call → 429).
2. `server/internal/ai/proxy_test.go`: `Surface: desktop` settles a row with capability `office.byok_desktop`,
   web keeps `office.byok` (extend the test at `:287-324`); mutation check: swapping the two fails.
3. `server/internal/service/ai_byok_test.go`: the status method returns `(true, "")`, `(false,
   "entitlement_required")`, `(false, "ai_credentials_unavailable")`; non-member → `ErrNotFound`.
4. `server/internal/handler/ai_credentials_test.go`: R1 carries `byok` for both a web and a device session;
   an older-shape test client that ignores it still parses.
5. Existing guards stay green: `TestIsolationMatrix`, `TestIsolationRealtime` (untouched),
   `TestProviderSDKOnlyInAIProvider`, `TestAIPackageOnlyCallsAiQueries`, audit coverage.
6. `packages/core` is not touched (no web host change); if the D web host reads `byok`, add a malformed-response
   case in `packages/core/api/endpoints/*.test.ts`.

F (vitest, exact files):
7. `packages/ai-provider`: `proxy-url.test.ts` — the web table (chat, `/v1/messages`, Gemini stream/non-stream,
   models, foreign URL refused, `byok/../..` refused) now from the shared module; `providers.test.ts` —
   `origin: 'org'` is usable without a key, `origin` absent unchanged.
8. `apps/shell/tests/uniwork-keys.test.ts` — precedence table (local key / org key / both / neither / `byok.enabled`
   false / R1 without `byok`), bearer added in main and never in renderer-visible settings, sign-out and org
   switch abort a running stream and clear the cache, 404 `credential_missing` re-reads R1.
9. `apps/shell/tests/settings-ai-model-list.test.ts` — an `org` provider is a read-only row; saving Settings
   never writes an `org` provider's key slot.
10. `packages/ui` picker test — group tag + tooltip in vi/en; `origin` absent renders as today.

E2E (one, fork, CI-replica spec on the cloud runner): signed-in desktop renderer against the fake server
(`AI_PROVIDER=fake` style fake vendor): a key saved via `PUT …/ai/credentials/openai` on the server appears as
"Key on UniWork" in the chip with the live list, a streamed answer arrives, the request log shows the device
bearer and no vendor key, and after `DELETE` of the key the group disappears on the next read.

## 8. Slice plan

Dependencies: D1 is independent of F; F1 first on the fork, F2/F3 after F1; F2 and F3 in parallel. F can build
against today's servers with the `byok` field faked in tests; the source only lights up on a D1 server.

| Slice | Repo | Kind | Files | Depends |
| --- | --- | --- | --- | --- |
| D1 server | D | BE | `server/internal/handler/dto/sdo/ai_credentials.go` (+ `AIBYOKStatusDTO`), `server/internal/handler/ai_credentials.go`, `server/internal/handler/ai_byok.go` (surface), `server/internal/service/ai_byok.go` (status + surface), `server/internal/ai/proxy.go` (`CapOfficeBYOKDesktop`, `ProxyRequest.Surface`), tests 1–4, `docs/office/g3g4/uniwork-office-app-api-contract.md` §3.1/§3.2 lines | ADR accepted |
| D2 docs | D | docs | move ADR 0034 out of `drafts/`, README table, `CLAUDE.md` Audit and Events line naming tests 1–2 | acceptance |
| F1 shared | F | BE/FE shared | `packages/ai-provider/src/types.ts` (`origin`), `src/providers.ts` (`providerNeed`), new `src/proxy-url.ts` (+ index export), `web/modules/shared/ai/transport.ts` (import from the package), tests 7 | — |
| F2 shell main | F | BE (Electron main) | new `apps/shell/src/main/uniwork-auth/keys.ts` (`UniworkKeysHost`: R1/R5 client, cache, per-call fetch, abort on sign-out), `apps/shell/src/main/uniwork-auth/index.ts` (wire), `apps/docs/src/main/docs-main.ts` (`ai:stream` route choice, `modelSourcesOf` adds `org`, `ai:get-settings`), test 8 | F1 |
| F3 renderer | F | FE | `packages/ui/src/strings-ai-model-picker.ts`, `packages/ui/src/AiModelPicker.tsx` (tag + tooltip + first-use note), `apps/shell/src/renderer/src/SettingsModal.tsx` (read-only row), tests 9–10 | F1 |
| E2E | F | test | one spec in the CI-replica e2e shard | D1, F2, F3 |

Reviewers: D1 BE reviewer; F2 BE reviewer; F1/F3 FE reviewer; visual check of the chip tag (light/dark, vi/en)
by tester_visual.
