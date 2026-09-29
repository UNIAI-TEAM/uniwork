# Office Launch Bridge contract

**Revision:** 1.3 (2026-09-30)
**Feature:** `g4-02a-auth-bridge-contract` / G4-05a (UNI-834)  
**Decision gate:** G4-D4 (with G4-D1 identity values) - **decided 2026-09-29
12:40 UTC+7** (`decisions/gates-2026-09-29.md`: launch-ticket TTL 120 s
approved; launch commands audit transactionally with no outbox event;
`office_launch_sessions` carries `organization_id` and is not tenant-exempt)  
**Status:** **CONTRACT r1.3 - published for G3-09 / 05b**. No route, service,
migration or token minting is shipped by this document. This revision pins the
05a values for client identity, clock skew, operation/version semantics,
descriptor fields, anti-enumeration mapping, launch URL and receipt handoff.
Questions 3 (persistence names/indexes/cleanup) and 7 (revocation) remain
explicit 05b items; they are not silently decided here.

Executable examples and refusal cases are kept in the companion vectors:
[`launch-ticket.json`](vectors/launch-ticket.json),
[`deep-link.json`](vectors/deep-link.json), and
[`exchange.json`](vectors/exchange.json).

The Bridge opens one selected Document in Office after a user deliberately
starts the action in the authenticated web app. It hands off a narrow,
single-use capability. It never creates a login session, carries a login code,
or bypasses the normal Documents API authorization checks.

## Boundary with desktop login

There are two opaque values with different issuers and audiences:

| Value | Issued by | Redeemed at | What it can do | What it can never do |
| --- | --- | --- | --- | --- |
| Desktop authorization `code` | Auth consent flow after login/MFA | `POST /auth/desktop/exchange` | Create a device session after PKCE verification | Open a Document, replace a refresh token, or travel in a deep link |
| Office `launch_ticket` | Authenticated web Document command | `POST /office/sessions/exchange` | Open one selected Document/version for one device/account | Create an account/session, grant ACL, carry bytes, or work for another account/deployment |

The values must use different prefixes/issuers in internal representations and
must be rejected by the other endpoint. Neither is logged or returned in an
event payload. A copied ticket is useless without a live device session for
the same account and deployment, and a copied login code is useless without
the client verifier and exact redirect binding.

## Endpoint contract (published for 05a/05b)

Paths are relative to the configured deployment API origin (`/api/v1`). DTO
names are drafts only; 05b registers them with the existing `api` wrapper and
OpenAPI builder.

### `POST /documents/{documentID}/office/sessions` — create launch session

The authenticated web session calls this after the caller's live Document ACL
has been checked. The request carries the intended operation, not a local path
or arbitrary URL.

**JSON (`sdi.CreateOfficeLaunchSessionSDI`):**

| Field | Required | Rule |
| --- | --- | --- |
| `operation` | yes | `view` or `edit`; the server may reduce it to the current ACL. |
| `version` | no | Positive historical version number; omitted means current. Historical versions are read-only. |
| `deployment_id` | yes | Must equal the web session's configured deployment. |
| `client_id` | yes | Allow-listed Office client ID; public identifier only. |
| `return_hint` | no | `office` (construct the approved deep link) or `none` (do not offer a handoff); never an arbitrary redirect or URL. |

The path `documentID` is the only resource selector. The service resolves
organization/workspace and the caller's effective ACL; it does not trust IDs
from the body. It returns 404/403 according to the Documents policy without
confirming a foreign Document.

**Response (`sdo.OfficeLaunchSessionSDO`, 201):**

```json
{
  "launch_ticket": "<opaque single-use value>",
  "launch_url": "uniwork-office://open?ticket=<percent-encoded-ticket>",
  "expires_at": "2026-09-29T10:02:00Z",
  "document_id": "01J8X4DOC0N1P2Q3R4S5T6U7",
  "operation": "edit",
  "version": 0
}
```

The web host constructs the approved scheme/deep link from the opaque ticket
and configured deployment profile. Its exact shape is
`uniwork-office://open?ticket=<encodeURIComponent(launch_ticket)>`; the query
contains exactly one `ticket` key. The URL carries no title, filename, path,
bytes, storage URL, access token, refresh token, login code or arbitrary
`server_url`. The ticket expires after 120 seconds (approved by G4-D4) and is
single-use.

**Errors:** `invalid_request` 400; `unauthorized` 401; `forbidden` 403;
`not_found` 404 under the existing anti-enumeration policy; `rate_limited` 429.

### Deep link handoff

The registered callback/scheme is selected by G4-D1 and is exact-match only.
The recommended shape is:

```
uniwork-office://open?ticket=<opaque-ticket>
```

Only the ticket may appear. The main process
resolves the deployment from its trusted profile, rejects an untrusted
`server_url`, and checks the active account before calling exchange. Cold and
warm starts target the same instance/namespace. If the ticket belongs to a
different account, the app asks the user to log in to that account; it does not
switch accounts or display Document metadata first. If Office is not installed,
the web response may show a safe install outcome without exposing the ticket in
analytics or referrers.

### `POST /office/sessions/exchange` — redeem launch session

The desktop main process sends the ticket with a valid device bearer session.
The renderer never sends the ticket directly and never receives a refresh
token.

**JSON (`sdi.ExchangeOfficeLaunchSessionSDI`):**

| Field | Required | Rule |
| --- | --- | --- |
| `launch_ticket` | yes | Opaque ticket from the deep link; not a login code. |
| `deployment_id` | yes | Must match the device session and trusted profile. |
| `client_id` | yes | Same registered Office client as creation. |
| `device_session_id` | yes | Current native device session; middleware also validates its bearer. |

**Response (`sdo.OfficeLaunchExchangeSDO`, 200):**

```json
{
  "receipt_id": "01J8X4RECEIPT1P2Q3R4S5T6U7",
  "document": {
    "id": "01J8X4DOC0N1P2Q3R4S5T6U7",
    "organization_id": "01J8X4ORGN1P2Q3R4S5T6U7V8",
    "workspace_id": "01J8X4WS0N1P2Q3R4S5T6U7V8",
    "title": "Q4 plan",
    "kind": "file",
    "operation": "edit",
    "version": 0,
    "revision": "41",
    "contract_version": "uniwork-office-engine-contract/1",
    "protocol_version": "1",
    "download_path": "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/download"
  },
  "redeemed_at": "2026-09-29T10:01:02Z"
}
```

The descriptor is metadata and a first-party download route only. It contains
no bytes, presigned storage URL, local path or secret. Exchange atomically
marks the ticket redeemed and rechecks device status, account/deployment and
Document ACL in that order. A successful exchange cannot be replayed to create
a second open session. `receipt_id` and `redeemed_at` are the only receipt
fields G3-09 may retain; they contain no ticket, token or bytes. The 05a
lost-response rule is **new ticket required**: the host must not retry a
consumed ticket or infer success from a timeout; 05b may add a same-device
metadata-only reconciliation only as an explicit contract revision.

**Errors:** `invalid_request` 400; `unauthorized` 401 for a missing or invalid
bearer token; the typed `device_revoked` (the only approved new class) for a
revoked or expired device session, rejected by the middleware before the
handler; `forbidden` 403 for account/deployment/ACL mismatch; `not_found` 404
for an unknown or already-consumed ticket where the policy requires
anti-enumeration. No new typed ticket class is introduced this phase: the
ticket policy keeps the existing 403/404 anti-enumeration classes. No error
response returns the Document title, filename,
organization or version to a caller who failed the checks.

### Desktop library path

Opening a Document already shown in the authenticated desktop library does not
use a launch ticket. The host uses the device session and the normal Documents
API directly. This prevents a stale ticket from becoming a second permission
path.

## Ticket data model (proposal)

The future identity/capability row may be named `office_launch_sessions` (name,
indexes and cleanup policy are pinned at 05b; G4-D4 approved that it carries
`organization_id` with the Document scope and is not tenant-exempt). It stores:

| Field | Rule |
| --- | --- |
| `id` | ULID text; internal receipt identifier. |
| `ticket_hash` | Hash of the opaque ticket; raw ticket is returned once and never stored. |
| `account_id` | Web creator and required native redeemer account. |
| `organization_id`, `workspace_id`, `document_id` | Scope resolved from the Document at creation; never trusted from an unbound body. |
| `operation`, `version` | `view`/`edit`; historical version is read-only. |
| `client_id`, `deployment_id`, `device_session_id` (on redeem) | Allowlist and binding information. Device ID is filled/checked at redeem, not guessed from a URL. |
| `created_at`, `expires_at`, `redeemed_at`, `revoked_at` | Single-use lifecycle. |
| `created_by`, `created_by_kind` | Human web actor attribution under repository rules. |

This is a Document-scoped business capability. It is **not** the account-level
`device_sessions` exemption and must carry the applicable `organization_id`
with the Document scope. There is no foreign key; service code resolves and
cleans relationships in a transaction.

## Six-step Bridge handoff

| Step | Client behavior | Server authority |
| --- | --- | --- |
| 1. Create | Web posts the selected Document and operation. | Check web session and effective Document ACL; create hash/expiry/scope. |
| 2. Exchange | Main sends opaque ticket with device bearer. | Check account, deployment, device status, ticket hash/expiry and ACL; redeem atomically. |
| 3. Download | Host calls first-party download route, including each Range request. | Recheck session/ACL; stream through Documents/FileService, never presign storage. |
| 4. Prepare | Host creates an immutable save intent with base revision/checksum. | No durable write permission is granted by the ticket. |
| 5. Upload | Host uses existing `POST /documents/{documentID}/uploads`. | Existing Documents/FileService and engine provider-output rules apply. |
| 6. Complete | Host calls existing version commit with `upload_id`, `base_revision` and `Idempotency-Key`. | Existing G1 checks permission/base/quota/engine and transaction-bound audit/outbox/idempotency apply. |

The Bridge adds no alternate upload, commit, presign or version API. A stale
base returns `document_version_conflict` (409) without overwriting or creating
a version; a revoke before commit returns the existing permission failure and
leaves the local draft blocked.

## Command audit and outbox policy

Launch sessions touch a Document, so the `recordAuth` credential exception does
not apply. G4-D4 (2026-09-29) approved these commands as transactional:
`audit.Recorder.Record(ctx, q, Entry)` on the same transaction as the ticket
mutation, ids/metadata only, and no outbox event this phase (no consumer).

| Command | Audit action / actor-resource | Scope and transaction | Failure / event policy |
| --- | --- | --- | --- |
| Create launch session | `office.launch_session_created`; human web actor and `office_launch_session:<id>` | Organization + workspace + Document; ticket row, audit row and any state change use the same transaction. | ACL/config/rate-limit failure leaves no ticket or audit row. IDs/operation/version only; no raw ticket. No outbox event (G4-D4: no consumer). |
| Exchange/redeem | `office.launch_session_redeemed`; native account actor and target session/document IDs | Same transaction for ticket consume, receipt and audit; live device/ACL checks precede mutation. | Reuse/expiry/ACL failure cannot create a receipt or second audit. No outbox event (G4-D4: no consumer). |
| Revoke/cancel ticket | `office.launch_session_revoked`; actor and ticket/document IDs | Ticket revoke and audit share one transaction. | Idempotent repeated revoke records one state transition. No credential payload or broad workspace broadcast; no outbox event (G4-D4). |
| Download/range | Existing Document access-log policy; actor and Document/version IDs | Read-only request; no launch-session state mutation. | Permission failure returns existing anti-enumeration error; no event. |

Business mutations in steps 5/6 use the existing `audit.Recorder.Record` with
the mutation transaction and their established outbox catalogue rows. Do not
use the best-effort `AuthService.recordAuth` path for a Document-scoped
launch command, and do not create an event merely to produce an outbox row.
G4-D4 closed the event question for this phase: no launch event is emitted. If
a consumer appears later, the ids-only event must land in one change across
`server/internal/outbox/catalogue.go`, `packages/core/types/events.ts` and
`docs/events/CATALOGUE.md` with that consumer named.

## Required safety behavior

* Consent and launch creation require an explicit user action. Browser
  prefetch/GET cannot approve or create a ticket; any approval form is
  CSRF-protected.
* Tickets and descriptors are `no-store`; raw values are redacted from URL,
  referrer, access logs, telemetry, crash reports and clipboard diagnostics.
* A ticket is bound to account, deployment, client, organization, workspace,
  Document, operation and version. It cannot be upgraded from view to edit or
  from a historical version to current without a new ACL-checked request.
* Session/device revocation is checked at exchange, download, every Range and
  commit. A cached descriptor is never an authorization oracle.
* Wrong account, deployment or missing app state causes a login/profile error,
  never an automatic account switch or metadata preview. A late callback after
  account switch is discarded by the host generation.
* If exchange loses its response, the client treats the result as unknown and
  requests a new launch ticket; it never blindly redeems a consumed ticket.
  Commit continues to use its existing idempotency receipt and never creates
  a second version.

## Operation and descriptor matrix (pinned for 05a)

| Requested operation | Current version (`version = 0`) | Historical version (`version > 0`) | Descriptor operation |
| --- | --- | --- | --- |
| `view` | read-only open | read-only open | `view` |
| `edit` | editable open when live ACL permits | **read-only** open; restore/copy is a separate ACL-checked command | `view` |

The historical row is never upgraded to edit by the client or ticket. The
descriptor field set is exactly the G2 wire vocabulary used above:
`id`, `organization_id`, `workspace_id`, `title`, `kind`, `operation`,
`version`, `revision`, `contract_version`, `protocol_version`, and
`download_path`. `contract_version` is
`uniwork-office-engine-contract/1`; `protocol_version` is the decimal string
`"1"`; `download_path` is a first-party `/api/v1/documents/{id}/download`
route and never a presigned URL.

## G4-D4 open questions

Each item is annotated with its G4-D4 status (decision record
`decisions/gates-2026-09-29.md`). Items 1, 2, 4, 6 and 8 are pinned above for
05a. Items 3 and 7 remain explicit questions for 05b.

1. **D1 identity - resolved for 05a.** G4-D1 accepted the scheme/host/path,
   `uniwork-office://open` uses that scheme, and the appId/exe identity is
   `com.uniwork.office`. The public client id is **`uniwork-office`**. The
   primary process owns the single-instance lock, registers the scheme once,
   and sends cold argv plus warm second-instance/open-url callbacks through
   one handler. Per-platform installer registration and GenOffice coexistence
   remain G4-07 concerns.
2. **TTL and replay receipt - resolved for 05a.** The 120 second default and
   single-use redeem are approved. The maximum accepted clock skew is **30
   seconds**. A lost exchange response follows the **new ticket required**
   rule; no replay or implicit receipt lookup is allowed. A future metadata-
   only reconciliation requires a 05b contract revision.
3. **Ticket persistence - decided.** The table carries `organization_id` with
   the Document scope and does not enter the account-level `tenantExemptTables`
   list. **Open:** final name, indexes and the cleanup policy (05b).
4. **Operation/version semantics - resolved for 05a.** The operation matrix
   above is normative: `view` and `edit` are accepted; historical versions
   are read-only even when `edit` was requested. The descriptor field set is
   the G2 wire set listed above, with no bytes, local path, storage key or
   secret. Restore/copy is outside the ticket and requires its own ACL check.
5. **Audit/outbox - decided.** Transactional `audit.Recorder.Record` on the
   mutation transaction, ids/metadata only, no outbox event this phase; a later
   event must be ids-only, catalogue-backed and consumer-named.
6. **Anti-enumeration - resolved for 05a.** Preserve the existing Documents
   mapping: `404 not_found` for unknown, expired or already-consumed tickets;
   `403 forbidden` for account/deployment/ACL mismatch. Missing/invalid bearer
   remains `401 unauthorized`, and a revoked device remains typed
   `device_revoked`. None of these responses carries document metadata. The
   desktop fake and consumer map the same reasons to typed outcomes without
   making a second exchange call for a terminal ticket.
7. **Revocation behavior - open.** Confirm whether a ticket can be explicitly
   revoked by logout/password reset, and the invalidation path/SLA for
   descriptors already downloaded (05b with the auth owner).
8. **G3 consumer handoff - resolved for 05a.** G3-09 consumes the exact
   `uniwork-office://open?ticket=<encodeURIComponent(ticket)>` URL and the
   create response fields `launch_ticket`, `launch_url`, `expires_at`,
   `document_id`, `operation`, and `version`. A successful exchange receipt
   exposes only `receipt_id` and `redeemed_at` beside the descriptor; the
   ticket itself is never renderer-visible, logged or included in diagnostics.

## Deferred implementation and verification

05b must register the DTOs and routes, implement atomic hash/redeem/revoke,
connect live ACL/device middleware, and add tests for copied tickets, wrong
account/deployment, expiry/replay, prefetch/CSRF, revoke after download and
lost exchange response. It must also run the audit-coverage, events-catalogue,
tenant guard and OpenAPI checks. The draft structs and JSON vectors in this
revision are intentionally un-routed and do not alter generated OpenAPI.
