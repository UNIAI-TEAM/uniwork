# Desktop authentication contract (PROPOSED)

**Revision:** 1.1 (2026-09-29)  
**Feature:** `g4-02a-auth-bridge-contract` (UNI-831)  
**Decision gate:** G4-D4 - **decided 2026-09-29 12:40 UTC+7** (`decisions/gates-2026-09-29.md`: UNI-831 proposal approved, audit transactional)  
**Status:** PROPOSED; this document is a design input, not a statement that the
endpoints or migrations exist. Revision 1.1 applies the G4-D4 decision: PKCE
public client with main owning verifier/state; code TTL 120 s and pending
attempt 10 min; access/refresh lifetimes per the current auth policy;
`device_sessions` tenant-exempt and bound to the existing session family; every
command audits transactionally with no outbox event; typed `device_revoked`;
separate `/auth/desktop/devices`. What is still open inside the gate
(rate-limit numbers, final `client_id`, consent CSRF details) is listed with the
lane's proposal under [G4-D4 open questions](#g4-d4-open-questions).

This contract covers the public-client login used by UniWork Office. It is
deliberately limited to the wire contract and the security decisions needed by
G4-D4. Routes, handlers, services, token minting, consent UI, migrations and
production fakes are 02b/03b work and are out of scope for this revision.

## Decisions this revision makes

* Office is a public OAuth-style client. There is no client secret in the
  binary, installer, renderer or callback URL.
* The **desktop main process owns** the PKCE verifier, `state` and pending
  attempt. The server receives and verifies the derived `code_challenge` and
  the registered `state` value; it does not generate either value. This is the
  correction to DOC-005 section 2. The verifier is sent only to exchange.
* The code is a short-lived, single-use authorization code. It is never a
  launch ticket, refresh token or web session cookie.
* The desktop session is attached to the existing account/session-family
  model. A device session is an additional revocation and presentation layer;
  it does not create a second authorization model and does not bypass
  organization, workspace or Document ACL checks.
* Refresh tokens are returned to the main process over TLS and are stored only
  in the host secure store. They are never sent to the renderer, URL, logs or
  analytics. The existing web HttpOnly refresh-cookie flow remains unchanged.
* The **approved defaults** (G4-D4, 2026-09-29) are a 120 second
  authorization-code TTL, a 10 minute client pending-attempt TTL, and a 120
  second launch-ticket TTL (the latter is specified in [the Bridge
  contract](launch-bridge-contract.md)). Access and refresh lifetimes remain
  the auth service policy values; Office does not silently extend them, and
  02b configures exactly the approved values.

## Security and compatibility invariants

1. `code_challenge` is `BASE64URL(SHA-256(ASCII(code_verifier)))` without
   padding (RFC 7636 S256), never a hexadecimal digest. The verifier is an
   RFC 7636 high-entropy string generated with the host CSPRNG.
2. `redirect_uri` must exactly match the registered value
   `uniwork-office://auth/callback`; scheme, host, path, case and query are not
   normalized. `genoffice://`, near-miss paths and arbitrary `next` URLs are
   rejected.
3. A callback is useful only when the client has a live pending attempt whose
   `state`, deployment, client ID and deadline match. A URL containing a
   `code` never starts a session by itself. A restart loses the verifier and
   requires a new login.
4. Server-side authorization codes are stored as a hash and are bound to
   account, client ID, challenge, redirect URI, deployment and expiry. Redeem
   is atomic; replay, wrong verifier, wrong redirect and expired codes all
   return the same non-disclosing `auth_code_invalid` outcome.
5. Login, MFA and device consent happen in the system browser. A GET may create
   or display an attempt, but cannot approve a device or issue a code. Approval
   is a CSRF-protected POST and is not triggered by browser prefetch, link
   scanners or analytics fetches.
6. Every cloud request checks the access token **and** current device-session
   status. Revocation therefore blocks the next request even while an access
   JWT remains inside its normal expiry. Refresh rotation and reuse detection
   are serialized per device session.
7. Account/deployment changes increment the host session generation, cancel
   pending work and clear old query/plaintext state before the new scope is
   rendered. A late callback or response is discarded by generation and cannot
   move data across accounts or deployments.
8. Metadata and audit records contain IDs, action, outcome and bounded client
   metadata only. They never contain access/refresh tokens, authorization code,
   verifier, password, raw ticket or Document bytes, and the same values never
   reach logs, telemetry, crash dumps or diagnostics (spec §4.2).

## Endpoint surface

All paths are relative to the configured deployment API origin (`/api/v1`).
The `client_id` is a public, allow-listed identifier; it is not a secret.
The draft DTO names below are intentionally unregistered until 02b.

### `GET /auth/desktop/start`

The main process sends the values it generated and opens the returned URL in
the system browser. The server validates the allowlist and creates an
authorization attempt; it does not issue a code at this step.

**Query (`sdi.DesktopStartSDI`):**

| Field | Required | Rule |
| --- | --- | --- |
| `client_id` | yes | Registered Office client ID; unknown IDs fail closed. |
| `code_challenge` | yes | Exactly 43 unpadded base64url characters: `BASE64URL(SHA-256(verifier))` for S256. The RFC 7636 43--128 range applies to the verifier (see exchange), not the challenge. |
| `code_challenge_method` | yes | Exactly `S256`; `plain` is rejected. |
| `state` | yes | Opaque client state, echoed only in the callback; never used as a credential. |
| `redirect_uri` | yes | Exact registered callback URI. |
| `deployment_id` | yes | Must match the configured deployment profile; never taken from an arbitrary URL. |
| `device_label` | no | Display label, max 100 Unicode runes after sanitization; not identity. |
| `platform` / `build` | no | Bounded telemetry metadata, max 64/64 ASCII characters. |

**Response (`sdo.DesktopStartSDO`, 200):**

```json
{
  "authorization_url": "https://app.example.test/auth/desktop/authorize?...",
  "attempt_expires_at": "2026-09-29T10:10:00Z"
}
```

The URL contains the allow-listed client, challenge, method, state and exact
redirect. It never contains a verifier, token, password, launch ticket or
arbitrary `next` URL. `attempt_expires_at` is informational; the client still
enforces its own 10 minute pending-attempt deadline.

**Errors:** `invalid_request` (400) for malformed fields; `unauthorized` (401)
for an unavailable deployment; `rate_limited` (429) with `Retry-After` for
start abuse. Error bodies use the existing `sdo.ErrorSDO` envelope and do not
reveal whether an account exists.

### Browser login, MFA and consent (server continuation)

The authorization URL enters the existing web login/MFA policy. The consent
page shows the app name, sanitized device label, deployment and signed-in
account. It has **Approve** and **Cancel** forms. The approve form is a
same-site, single-use CSRF-protected POST; GET, HEAD, prefetch and an iframe
load cannot approve. On approval the server creates a hashed, single-use code
bound to the attempt and redirects exactly once to
`uniwork-office://auth/callback?code=...&state=...`. The callback response is
`Cache-Control: no-store`, contains no analytics markup, and the code/state are
redacted from access logs, referrers and telemetry.

### `POST /auth/desktop/exchange`

The main process calls this endpoint over TLS after checking its pending
attempt locally.

**JSON (`sdi.DesktopExchangeSDI`):**

| Field | Required | Rule |
| --- | --- | --- |
| `client_id` | yes | Same allow-listed client as start. |
| `code` | yes | Opaque callback code; never a launch ticket. |
| `code_verifier` | yes | Original RFC 7636 verifier; sent only over TLS in this request. |
| `redirect_uri` | yes | Exact registered callback URI, byte-for-byte. |
| `deployment_id` | yes | Same configured deployment as the attempt. |
| `device_label` / `platform` / `build` | no | Bounded metadata; server uses the approved attempt values when present. |

**Response (`sdo.DesktopSessionSDO`, 200):**

```json
{
  "account_id": "01J8X4K2M0N1P2Q3R4S5T6U7V8",
  "device_session_id": "01J8X4DEVN1P2Q3R4S5T6U7V8",
  "session_id": "01J8X4SESSN1P2Q3R4S5T6U7V8",
  "access_token": "<opaque-or-jwt>",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "<opaque>",
  "refresh_expires_in": 2592000,
  "refresh_rotates": true
}
```

The token pair is returned only to the TLS caller (desktop main). The renderer
receives session metadata through the host bridge, never the refresh token.
Redeem is atomic: a successful code cannot be redeemed again, including after a
lost response. A bad code/verifier/redirect/deployment is an indistinguishable
`auth_code_invalid` (401); rate limiting is 429.

### `POST /auth/desktop/refresh`

The main process sends the current refresh token from the secure store.

**JSON (`sdi.DesktopRefreshSDI`):** `device_session_id`, `refresh_token` and
`deployment_id` are required. The server hashes the token, checks device and
session-family status, revokes the presented token, and atomically returns a
new pair with the same device/session IDs. One refresh operation may be in
flight per device session; a concurrent request receives 409
`refresh_in_flight`, while replay/reuse receives 401 `refresh_reused` and
revokes that device session/family according to the approved auth policy.

**Response:** `sdo.DesktopSessionSDO` with `account_id`, IDs, access token,
`expires_in`, replacement refresh token and `refresh_rotates: true`. Raw refresh
tokens are never persisted or logged.

### `POST /auth/desktop/logout`

**JSON (`sdi.DesktopLogoutSDI`):** required `device_session_id` and
`deployment_id`; optional `scope` is `device` (default) or `family`.
`device` revokes this desktop device only. `family` revokes the existing
session family and all its native sessions; whether browser sessions are also
covered by password reset/revoke-all is the existing auth-policy decision, not
a client-side assumption. Logout is idempotent for an already-revoked device.

**Response:** `sdo.StatusSDO` `{ "status": "ok" }`. The main process deletes
its secure-store token after the server acknowledgement or a confirmed
`unauthorized`; it keeps encrypted draft keys/bytes under the separate draft
contract. A network timeout does not claim success: reconcile by listing the
device, then retry with the same idempotency key if the final API adds one.

### `GET /auth/desktop/devices`

The authenticated caller lists only its own device sessions. The bearer token
and current device status are required; organization membership is not needed
for this account-level identity view.

**Response (`sdo.DesktopDeviceListSDO`):** rows contain IDs, sanitized label,
platform/build, `created_at`, `last_used_at`, `expires_at`, `revoked_at` (null
when live), and `current`. No refresh digest, IP, raw user agent or token is
returned to another client. Rows are metadata only and may be paged by an
opaque cursor if the existing session-management surface requires it.

### `DELETE /auth/desktop/devices/{deviceSessionID}`

The caller may revoke only a device session belonging to its account. The
service checks the current session family before mutation and applies the same
middleware check as logout. It returns `sdo.StatusSDO`; a repeated revoke is
idempotent. A missing or foreign ID is an indistinguishable 404/403 according
to the existing session-management policy and never confirms another user's
device.

## Device-session model and existing sessions

The proposed `device_sessions` identity-infrastructure row has these logical
fields (migration names and exact indexes are 02b):

| Field | Meaning and protection |
| --- | --- |
| `id` | ULID text, the device-session identifier exposed in DTOs. |
| `user_id` | Account owner; no foreign key (repository rule). |
| `session_family_id` | Existing auth family/session lineage used for rotation and family revoke. |
| `client_id`, `deployment_id` | Allow-listed public client and deployment binding. |
| `device_label`, `platform`, `build` | Sanitized, bounded presentation/build metadata. |
| `created_at`, `last_used_at`, `expires_at`, `revoked_at` | Lifecycle and immediate middleware gate. |
| `refresh_token_digest` | Hash/digest only; raw token is never stored. Rotation replaces it atomically. |
| `created_by_kind` (if required by migration rules) | `human`/`agent`/`system`; the auth command supplies the applicable actor. |

`device_sessions` is account identity infrastructure, not a tenant business
table. It must not carry a fabricated `organization_id`, and it must not be
used as a reason to skip `RequireMember` for workspace, organization or
Document operations. If the table has no `organization_id`, 02b must add the
exact table name and the rationale “account/session identity can span zero or
many organizations; no single organization is correct” to
`tenantExemptTables`, then pass `TestNewTablesCarryOrganizationID` and
`TestTablesWithoutOrganizationIDAreTheKnownDebt`. The exemption is not to be
widened to launch tickets or Document tables.

The existing browser session rows and refresh-cookie rotation remain the
source of web behavior. A desktop device row references the session family but
does not merge cookies, change `recordAuth`, or make a browser session a
desktop session. Password reset/revoke-all policy must explicitly include
native rows; a single-device logout must not sign out unrelated browser rows.

## Middleware and revocation behavior

The bearer middleware continues to validate signature, expiry and the `sid`
claim. For a desktop token it additionally resolves the device-session ID and
rejects revoked/expired/mismatched deployment rows before the request reaches
the service. The check is intentionally live (a short bounded cache may be
used only with an invalidation path); deleting a refresh token alone is
insufficient. G4-D4 (2026-09-29) approved the typed `device_revoked` error
class for a revoked or expired native device session: it is additive, keeps the
existing envelope shape, and ships with the malformed-response tests and every
DTO/client update in the same change. All other bearer failures keep the
compatible `unauthorized` error.

Authorization is still evaluated per request. A valid device session does not
grant organization, workspace or Document access, and a launch ticket cannot
replace it. Download/range and commit calls repeat the live session and ACL
checks; local cache is never the authorization oracle.

## Audit and event policy (G4-D4 decided)

G4-D4 approved this table on 2026-09-29 with the audit-transactional rule:
every credential command records through
`audit.Recorder.Record(ctx, q, Entry)` on the same transaction as its mutation,
ids/metadata only, and emits **no outbox event** because no consumer exists.
The credential exception is explicit; it is not inherited from the best-effort
`recordAuth` baseline. “No event” means no outbox row and no direct publish
anywhere in this table.

| Command | Action / actor and resource | Scope | Transaction and failure semantics | Event |
| --- | --- | --- | --- | --- |
| Start attempt | `auth.desktop_start`; anonymous actor (`system` where required), resource `desktop_attempt:<id>` | Account unknown; `audit.NoOrganization` | Attempt creation and its audit row are one transaction. Rate-limit/config failure returns an error; no partial attempt. | None (G4-D4: no consumer). Attempt is not a business event. |
| Consent approve / code issue | `auth.desktop_consent_approved`; human account actor, resource user ID | Account; `NoOrganization` | Approval, code hash and audit are one transaction. CSRF/prefetch/replay failure writes no approval. | None; code is credential material. |
| Exchange / device create | `auth.desktop_session_created`; human account actor, resource device-session ID | Account; `NoOrganization` | Code redeem, device row, refresh digest and audit are one transaction. Any failure rolls back all; no duplicate audit on replay. | None (G4-D4: no consumer); a future event must be ids-only and catalogue-backed. |
| Refresh / rotate | `auth.desktop_token_rotated`; account actor, resource device-session ID | Account; `NoOrganization` | Presented digest revoke, replacement digest and audit are one transaction. Reuse/replay revokes per policy; no raw token in metadata. | None. Credential-only operation. |
| Logout device | `auth.desktop_session_revoked`; account actor, resource device-session ID | Account; `NoOrganization` | Device/family revoke and audit commit together. Idempotent repeat produces at most one audit row for the state transition. | None (G4-D4: no consumer). |
| Revoke-all/password reset | Existing auth action plus native device resources | Account; `NoOrganization` | Existing password/reset transaction must include native rows or explicitly document a compensating policy; failure cannot claim complete revoke. | Existing auth policy; no new credential payload. |
| Device list | No state change; no audit row by default | Account | Read-only; authorization failure is returned without enumeration. | None. |
| Device revoke by ID | `auth.desktop_session_revoked`; account actor, target device-session ID | Account; `NoOrganization` | Ownership check, revoke and audit are one transaction. Foreign IDs reveal no existence. | None (G4-D4: no consumer). |

This deliberately differs from business Document commands: those must use
`audit.Recorder.Record(ctx, q, Entry, emit...)` on the same mutation
transaction, with outbox events when a consumer exists. The current
`AuthService.recordAuth` baseline is best-effort, account-level,
`audit.NoOrganization`, and emits no outbox because login has no consumer.
G4-D4 approved the same no-outbox result for the credential commands above but
through a transactional Recorder call, not best-effort; the exception is
explicit and never inferred from the baseline. It does not extend to
Document-scoped commands: launch-ticket create/redeem/revoke follows the
stricter transactional policy in the Bridge contract.

## Compatibility and operational requirements

* Keep `unauthorized` response compatibility for existing web clients. Any
  new `error_class` is additive and requires malformed-response tests.
* Rate-limit start, exchange and refresh independently; fail closed when
  redirect/client/deployment configuration is missing or invalid. Every new
  environment variable must be validated and represented in `.env.example`.
* Correlation IDs may be retained in audit/access logs, but secret query/body
  fields are redacted before logging, and the same redaction covers telemetry,
  crash dumps and diagnostics (spec §4.2). The callback response and all token
  responses are `no-store`.
* Do not introduce a second host auth transport, a password form in the
  renderer, a device-code fallback, a raw-token file fallback, or an
  organization ID invented for an account-level row.

## G4-D4 open questions

Each item is annotated with its G4-D4 status (decision record
`decisions/gates-2026-09-29.md`). Open items carry the lane's proposal; 02b
pins the final value.

1. **Identity and registration (D1/D4) - partly decided.** G4-D1 accepted the
   appId `com.uniwork.office`, executable/scheme `uniwork-office`, callback
   `uniwork-office://auth/callback` and internal schemes. **Open:** the final
   public `client_id` value (**proposal:** `uniwork-office`, matching the
   executable/scheme), the deployment identifiers and the per-platform
   allowlist registration, including coexistence with GenOffice.
2. **TTL and rotation - TTLs decided.** 120 seconds for codes and 10 minutes
   for pending attempts are approved; access/refresh lifetimes stay at the
   current auth policy. **Open:** refresh grace window, reuse response and the
   maximum device-session lifetime (02b names the implemented values within
   that policy).
3. **Session-family relation - relation decided.** The device session is bound
   to the existing session family. **Open:** whether the token minter accepts a
   `device_session` claim directly or middleware resolves a separate binding,
   plus the revoke-all/password-reset fan-out mechanics to native rows and the
   cache invalidation SLA.
4. **Audit exception - decided.** Every credential command uses a
   transaction-bound `audit.Recorder.Record` with `audit.NoOrganization` and no
   outbox event; the explicit credential exception is recorded in the audit
   table above and never inferred from `recordAuth`.
5. **Tenant exemption - decided.** `device_sessions` is the only account-level
   identity table exempted from `organization_id`; its rationale is approved as
   written above ("account/session identity can span zero or many
   organizations; no single organization is correct") and the exemption never
   widens to launch tickets or Document tables.
6. **Consent and CSRF - open (details).** The approval POST is same-site,
   single-use and CSRF-protected, and GET/prefetch cannot approve. **Open:**
   exact token/field and the user-visible behavior when consent is canceled or
   expires (**proposal:** a single-use token bound to the attempt and echoed in
   a hidden field of the approve form, on top of the existing SameSite=Lax
   session cookie, mirroring the `uniwork_oauth_state` pattern; cancel returns
   to the app with a typed result and creates no code).
7. **Errors and rate limits - error decided, limits open.** The typed
   `device_revoked` class is approved (additive; other failures keep
   `unauthorized`). **Open:** rate-limit numbers (**proposal:** the existing
   credential bucket for start and exchange, 60/min per IP as `credentialLimit`
   today, a 60/min per-device-session guard for refresh, `Retry-After` on every
   429 and fail-closed config validation).
8. **Device management surface - decided.** The separate
   `/auth/desktop/devices` list/revoke surface is approved; a caller sees and
   revokes only its own devices. **Open:** pagination details and whether the
   current device may revoke itself through the list (02b).

## Deferred implementation and verification

02b/03b must add the server fake, route registration and OpenAPI operations
from the DTO drafts, then test wrong verifier, expired/replayed code, exact
redirect, consent CSRF/prefetch, refresh concurrency/reuse, secure-store
failure and immediate revoke. The DTO drafts must also gain the bound and enum
validation the documents state (exact challenge length and `S256`, device
label 100 runes, platform/build 64 characters, `scope`/`operation`/`return_hint`
enums) when 02b registers them. The RFC 7636 and callback rejection vectors in
`docs/office/g3g4/vectors/` are executable with the repository's Node 22
runtime and pin this revision's wire assumptions; the verifier is wired into
`scripts/check.sh`, so the repository gate runs it.

Release items carried with the G4-D4 contract release:

* Update `docs/office/g0/login-sync-contract.md` §2's endpoint list to state
  that the server receives and validates the client challenge/state and to
  point at §2.2, syncing SDI/SDO/fake/tests in the same change (spec §4.1, plan
  G4-02); the old evidence model keeps its provenance.
* Add the exact `device_sessions` name and rationale to `tenantExemptTables`
  and pass `TestNewTablesCarryOrganizationID` and
  `TestTablesWithoutOrganizationIDAreTheKnownDebt`; never widen the exemption
  to launch tickets or Document tables.
