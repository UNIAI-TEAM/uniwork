# Office Editor Host v1

This document is the shared G3 web and G4 desktop contract for an Office editor
session and an explicit cloud Save. It is a product-level contract in
`@uniwork/core/office`; engine wire versions remain owned by
`@uniwork/office-contracts` and `@uniwork/office-engine`.

## Contract identity

`OfficeIdentity` binds one editor session to a deployment, account, organization,
workspace, and document. `generation` changes when the account, deployment, or
editor binding changes. A callback is usable only when all identity fields and
the generation still match the intent. `baseVersionId` is opaque and
`baseRevision` is always a decimal string; clients never convert a revision to a
JavaScript number.

`OfficeSessionState` contains tab, selection, identity references, dirty
generation, and Save state only. Document and version payloads stay in TanStack
Query. The Zustand store has no persistence side effect and no document bytes.

The engine seam is the existing `OfficeHostAdapter` from
`@uniwork/office-contracts`; core does not define another host port or registry.
`OfficeEnginePort` is a type-only view of the environment-neutral
`OfficeEngine` facade. Browser and desktop provide the concrete transport.

## Save pipeline

An editor supplies a stable snapshot with a generation and fingerprint. The
coordinator persists one immutable `OfficeSaveIntent` before starting work. The
intent keeps its idempotency key, identity, base revision/version, snapshot
generation, and fingerprint across every retry.

The injected transport performs these steps:

1. Serialize the stable snapshot through the G2 engine facade.
2. Upload or register the provider output through the G1 mutation seam.
3. Commit `{ upload_id, base_revision }` with the same `Idempotency-Key`.
4. Validate a receipt before changing the local base. A receipt must carry the
   same intent id, idempotency key, document id, version id, decimal revision,
   checksum/size, and engine metadata.

`upload` is not `saved`. A malformed upload or commit response leaves the intent
and draft recoverable and never enters `saved`. A timeout or ambiguous response
reconciles the same intent before any new Save can start. A payload mismatch or
key reuse with a different fingerprint stops retry. A 409 base conflict keeps
the original base and the local snapshot. The only Save action is
`coordinator.save(entryPoint)`. `button`, `menu`, `shortcut`, and `dialog` all
use that guard. While N is saving, every entry point returns `saving`; no N+1
request is queued. Typing may advance the dirty generation while N runs. Receipt
N advances the base but leaves the state `dirty` for N+1. A timer, idle period,
blur, leave, reconnect, checkpoint, or logout never calls Save; checkpoint is a
draft adapter operation only.

### Intent lifecycle and session changes

- An intent stops being pending only when its outcome is settled: a matching
  receipt (the base advances), a terminal refusal (`stop`, or
  `stale_generation`), or a reconcile that answers "not committed". Terminal
  outcomes clear the durable intent and refuse a replacement intent for the
  same generation, so the same bytes are never retried under a fresh key.
  `conflict` is settled the same way and stays `conflict`: every Save entry
  point refuses until an explicit resolve exists.
- An unresolved (ambiguous) intent survives a new edit and a `setIdentity`
  change. The next Save reconciles it under its own identity and key first. If
  the session moved on, the intent is settled only after that reconcile, and
  only then does the current session mint its own intent. If the reconcile
  question itself fails, the coordinator answers `blocked` and mints nothing.
- A receipt that arrives after the generation changed is never `saved`; the
  document base still advances when the document binding matches, because the
  commit is real. The state stays a kept-draft error until a new edit starts a
  fresh intent on the advanced base.
- A `401` without a code (bodiless answer) is still dispatched as
  `unauthorized` from the HTTP status alone; `token_expired` and
  `draft_recovery_locked` remain model-only outcomes this lane does not claim
  as HTTP.
- The coordinator raises client-side codes when a seam answer is outside its
  schema (`malformed_serialized_output`, `malformed_upload_receipt`,
  `malformed_commit_receipt`) or when the session changes mid-save
  (`stale_generation`). They are not provider error codes.

## State contract

| State | Meaning | Save behavior |
| --- | --- | --- |
| `ready` | Open session has no unsaved generation. | No cloud call. |
| `dirty` | Current editor generation is newer than the saved generation. | Explicit Save creates one intent. |
| `saving` | One intent is serializing, uploading, committing, or reconciling. | All Save entry points refuse; no queue. |
| `saved` | Receipt matches identity and intent and no newer generation exists. | No cloud call until dirty. |
| `error` | Outcome is known to be unsuccessful or malformed. | A pending intent reconciles, then retries with the same fingerprint/key; a terminal stop creates a new intent only after a new edit. |
| `conflict` | Server rejected the intent because the base is stale. | Preserve local/server bases; every Save refuses until an explicit resolve exists. |
| `blocked` | Permission, quota, missing document, or recovery policy blocks the action. | Keep the protected draft; a later Save reconciles then replays the same intent/key; do not retry blindly in a loop. |
| `readonly` | The current capability permits viewing but not editing. | Do not create an intent; the capability row that set it is the only way back to `dirty`/`ready`. |
| `incompatible` | Engine, protocol, contract, or operation support is incompatible. | Read-only or recovery action only. |

## G3 §4.4 provider handoff matrix

The `code` is the branch key and `error_class` is the UI dispatch class. The
client does not parse provider messages. “Existing” means the code/class and
HTTP behavior are evidenced in the current G1/G2 tree or handoff. “Pending”
means the product model supports the row, but this lane does not claim that a
new server mapping exists.

| G3 §4.4 row | Provider code / class / HTTP | Contract status and client action |
| --- | --- | --- |
| Open running / success | Client state; no HTTP error | Existing client state; `loading`/`ready` is outside the Save states. |
| Edit / sending / receipt | Client state; no HTTP error | Existing client state; `dirty` → `saving` → `saved`, or `dirty` when a newer generation exists. |
| Revision conflict | `revision_conflict` / `conflict` / 422; file commit uses `document_version_conflict` / `conflict` / 409 | Existing G1 mappings; `conflict`, preserve both bases. |
| Idempotency in flight | `in_flight` and auth/idempotency baseline `idempotency_in_flight` / `conflict` / 409 | Existing provider codes; reconcile the same intent/key with bounded retry. |
| Idempotency payload mismatch | `payload_fingerprint_mismatch` / `conflict` / 409; `idempotency_payload_mismatch` is a client alias | Provider `payload_fingerprint_mismatch` is existing; stop on a different payload/key reuse. |
| Upload invalid or expired | `document_upload_invalid`, `upload_missing`, `upload_checksum_mismatch` / `conflict` | Existing G1/G2 vocabulary; reconcile the old intent before asking for a new Save. |
| Quota | `quota_exceeded` / `quota` / 403 | Existing G1 mapping; `blocked`, retain the draft. |
| File too large | `file_too_large` / quota / 413 | Existing FileService mapping; `blocked`, no automatic retry. |
| Unauthorized | `unauthorized` / `session` or permission / 401 | Existing auth baseline; require the current auth transport and keep the draft. |
| Token expired | `token_expired` / session / HTTP mapping not established | Model-only DOC-005 outcome; this lane does not claim a server 401. |
| Lost edit, retained view | Provider permission result / permission | Existing permission concept; `readonly` for committed bytes and `blocked` for protected local draft. |
| Forbidden or lost view | `forbidden` / permission / provider policy status | Existing ACL class behavior; `blocked`, stop mutation and protect the draft. |
| Not found or deleted | `not_found` / missing / 404; `document_deleted` mapping is pending | `not_found` is existing; deletion-specific code is pending and remains safe `blocked`. |
| Engine incompatible | `engine_incompatible` / incompatible / 409 | Existing G2 negotiation and rollback mapping; `incompatible`, allow only proven read/recovery. |
| Storage unavailable | `storage_unavailable` / storage / provider-specific 503 or existing Documents fallback | Existing code/class; retain intent and allow bounded retry after session/permission checks. |
| Network, timeout, engine crash | `engine_timeout`, `engine_overloaded`, `engine_crashed` / engine | Existing G2 codes/classes; reconcile ambiguous outcomes, then bounded retry with the same key. |
| Draft recovery locked | `draft_recovery_locked` / recovery policy / HTTP mapping not established | Model-only DOC-005/host outcome; this lane does not claim an HTTP endpoint. |
| Open corrupt, unsupported, or password cancel | G2 typed `OpenOutcome` failure classes; engine error code when present | Existing engine contract; keep `open-error` at the host boundary and never offer Save for a blank substitute. |

Unknown codes or classes dispatch to safe `error` with a correlation id when
provided. They never become `saved`, never enable an unknown capability, and
never trigger an unbounded retry.

## Capability and provider limits

Capability rows carry format, operation, host, engine build, contract revision,
status, reason, and fidelity warnings. `unknown` is safe and does not grant
editing. The host feeds the coordinator the serialize row for its editor format
(`toOfficeCapabilityEntry`); a status other than `available` moves the session
to `readonly` and refuses Save, and a row that turns `available` restores
`dirty`/`ready`. A downgrade that lands while a save is already in flight is
applied when that save settles. The current handoff proves the following
provider facts:

| Format / operation | Current provider evidence | G3/G4 implication |
| --- | --- | --- |
| `md`, `html` serialize and blank | G1/G2 real-store round trip is recorded | Consumer integration may use the seam; H4 full product acceptance remains separate. |
| `pdf` open/serialize | G1/G2 round trip is recorded; editor fidelity remains format-owned | Capability must carry the provider evidence level. |
| `xlsx` | G2 adapter and Q7 handoff exist; full H4 matrix is not claimed by this lane | Do not infer full six-format acceptance from the package merge. |
| `docx`, `pptx` server serialize | `unsupported_operation` with `not_bound` is recorded | Keep server capability false; client editor work remains format-lane owned. |
| `xls` → `xlsx`, `odt` → `docx` convert | Q7 operation and result shape are handed off | Accept via `job_id` and result warning/content; do not commit conversion output through the source document version path. |
| Export and other conversion pairs | `unsupported_operation` with a provider reason | Mark unavailable/pending; never claim H4. |

H4 and six-format acceptance are not established by this contract. Format lanes
must attach their own evidence before changing a capability row to available.

