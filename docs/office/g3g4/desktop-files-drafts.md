# Desktop local files and protected drafts (G4-04a/04b)

> **Status:** 04a/04b host ports and blocked-state surface are implemented.
> The editor-host recovery driver and packaged OS/system evidence are separate
> stages; a missing macOS runner remains explicitly not run.

## Handle model

The Electron main process is the only process that receives a filesystem path.
An OS open picker or an already-validated open event calls `FileHandleRegistry`.
The registry rejects missing/non-file targets, symlinks in the selected path,
and files that cannot be opened for a lock probe. It records the canonical path
and a `(size, mtime, device, inode)` signature. The renderer receives only a
random `file_<base64url>` handle, display name, size, timestamp and SHA-256;
it never receives the path and cannot choose a path in an IPC payload.

Handles belong to one main-process registry (session/window lifetime). Closing
the window/session calls `revokeSession`, which drops every record. A stale or
unknown handle returns a typed refusal. Before each write the canonical path,
symlink state, lock probe and signature are checked again. A changed signature
returns `external_modification`; it is never silently overwritten.

## Local write protocol

Save and Save As serialize bytes to a randomly named temporary file beside the
destination. The temporary file is opened exclusively, written with a bounded
size, flushed with `fsync`, closed, and renamed over the destination. A failure
during temp write, flush, or rename removes only the temp file and leaves the
previous destination bytes. Save As obtains its destination from a main-process
picker. There is no renderer-supplied Save As path.

The replace operation intentionally does not unlink the destination first. On
platforms where an open destination prevents replacement it returns the typed
`replace_failed` refusal, preserving the old bytes. A successful write issues a
new handle for the new target while the original handle remains scoped to the
opened document.

## Draft format and key boundary

`DesktopDraftStore` stores one JSON envelope per draft under a SHA-256 namespace
directory. The directory name is opaque; account/deployment/document/base data
are retained in the authenticated envelope and are never used as a renderer
storage key. A plaintext checkpoint is encrypted with AES-256-GCM. The AAD is
the complete deployment/account/organization/workspace/document identity, both
base fields, and the generation. The envelope stores nonce, ciphertext plus GCM
tag, ciphertext checksum, generation, byte length and update time. It stores no
plaintext and no raw key.

`DraftKeyStore` is deliberately separate from the refresh-token credential
store. The real G4-D2 adapters are Windows DPAPI plus a restricted-ACL key file
and macOS Keychain; the proposed implementation library is Electron's
`safeStorage` for DPAPI/Keychain wrapping, with `node:fs/promises` plus the OS
ACL tooling for the Windows key-file permissions. The production adapter wraps
the key with Electron `safeStorage`, persists only the wrapped key in a
channel- and namespace-isolated file, and applies a
restricted ACL (Windows `icacls`, mode `0600` elsewhere). A missing key, bad
tag, checksum mismatch or corrupt envelope is a typed
`draft_recovery_locked` outcome and never creates an empty replacement.

The store implements the shared `DraftRecoveryAdapter`: metadata-only list,
session/deployment/account binding, live edit check, complete base-pair
comparison, ambiguous lookup, generation-bound compare-and-delete, and
clear-memory separate from durable deletion. Atomic writes are temp-beside-row,
`fsync`, then rename; an interrupted write therefore leaves the last confirmed
row. All checkpoint and durable-delete transactions pass through one store
mutation queue, so overlapping requests cannot let an older generation land
after a newer one. Compare-and-delete refuses an ambiguous `draftId` rather
than selecting an arbitrary document namespace. A bounded `withPlaintextTemp`
helper gives native adapters a restricted lifecycle temp and removes its
directory in `finally`.

The 2-second scheduler accepts only a caller-marked stable plaintext snapshot.
It calls the draft store only: no local target write, upload, commit, or cloud
receipt is reachable from that path. A failed checkpoint remains a typed
not-protected error and leaves the prior row unchanged.

## Fault table

| Fault | Typed result | Durable invariant |
| --- | --- | --- |
| picker cancelled | `{ opened: false }` | no handle is issued |
| renderer sends path | IPC schema refusal | path never reaches a renderer command |
| symlink/escape | `symlink_refused` | no bytes read or written |
| locked target | `locked` | no temp/target mutation |
| target changed after open | `external_modification` | previous bytes remain |
| temp write/fsync/replace failure | `write_failed` / `replace_failed` | previous bytes remain; temp cleaned |
| wrong draft AAD/key/tag | `draft_recovery_locked` | old ciphertext remains |
| stale generation | `generation_conflict` | newer row remains |
| session/account mismatch | `forbidden` / `token_expired` | no metadata or payload disclosure |
| disk full/unavailable | `storage_unavailable` | last confirmed draft remains |

## 04b lifecycle and recovery

r4 status: the recovery / Save-guard / lifecycle behaviour now runs on the real
G4-06a editor host (React renderer, OfficeShell/DocxEditor) with G4-07b merged.

**One protected store, one key store.** `createDesktopDraftStore`
(`userData/drafts`) with the AC-1 `createSafeStorageDraftKeyStore`
(DPAPI/safeStorage-wrapped key file, restricted ACL) is the only draft store.
Cloud drafts and local file checkpoints are rows in it:
`createProtectedFileCheckpoints` writes a local snapshot under a path-free stable
identity (`local:<sha256(canonical path)>`), one draft id per (file, base), and
its generation floor is read from the durable row so a restart cannot regress a
confirmed checkpoint. The G4-07b update restart flushes that one store, so local
and cloud drafts are covered by the same durability pass.

**Typed draft IPC.** `desktop:draft-checkpoint|list|recover|discard` bind
account/deployment/document identity in main; `desktop:draft-list` also answers
with the live account's own rows when no document is open (restart offer) and
always filters by the live session. Recover returns bytes only for a live edit
ACL and a matching revision/version base; a base mismatch is an explicit
conflict and the draft stays. Blocked or locked states have no
export/copy/clipboard action (`assertRecoveryActionAllowed`).

**One leave decision (close/logout/update).** Two typed entries:
`desktop:leave-requested` (main -> renderer event) and `desktop:leave-resolved`
(renderer -> main channel), zod-validated in main and preload. Only one
main-generated request id is outstanding at a time; stale, duplicate and busy
answers are rejected. Main never trusts `proceeded=true` alone: `keep` requires a
durable row main can see, `save` requires a main-observed receipt recorded by the
guarded file/office save handlers after the request, and `discard` requires no
row left for the live document. A timeout or a dead renderer means stay. The
renderer renders the shared `views/office` LeaveDialog with `t()`; the 2 s tick
is a local draft checkpoint only. The update restart uses the same dialog
(reason `update`) instead of its native message box, runs its pre-flight flush
before the decision, seals only afterwards (so keep/save can still write) and
reopens writes if the install fails.

**Recovery UI.** The account-level draft offer, the document-level
`DraftRecoveryPrompt` (recover / keep / discard; recover only for a live ACL and
a matching base) and the blocked/locked/unavailable states render through the
shared registry primitives (`packages/views/office` leave-dialog and
save-status) with `t()` in vi and en, styled like the G4-06a library/editor
screens. A blocked draft exposes no export, copy or clipboard affordance.

The Windows system smoke is runnable with `pnpm --filter @uniwork/office-desktop smoke:recovery-system`. It launches the real Electron binary with an isolated `userData` directory, exercises the DPAPI-backed `safeStorage` key adapter, verifies that the persisted file contains only the wrapped key (never the raw 256-bit key), checks the namespace directory ACL is restricted to the current Windows account, and deletes the key. The successful run is recorded in `D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/office-g3g4/reports/g4-04b-desktop-recovery/windows-safe-storage-system.log`.

The editor host context is now attached (r4): main owns the live document
identity (local checkpoint or cloud open) and the leaving flow runs through the
one save guard. The packaged-dev AC-4 visual sequence (edit -> kill -> restart ->
offer/restore; logout -> login B -> login A; close with unsaved edits) is
executed by the AC-4 visual Tester on the final SHA and recorded in the lane's
acceptance packet; macOS runtime evidence remains `not run` (no macOS runner).

The smoke resolves the Windows principal through `whoami.exe` (the inherited `USERDOMAIN`/`USERNAME` values are not trusted), and parses both the namespace directory and generated key-file ACLs. It rejects inherited or unexpected explicit principals; the Windows defaults permitted by the platform are the current account with Modify, `NT AUTHORITY\SYSTEM` with Full Control, and the per-session `NT AUTHORITY\LogonSessionId_*` read/execute entry. When `dist/build-identity.json` exists, the smoke uses that packaged channel projection; otherwise it uses the source manifest projection, matching the corresponding Electron host mode.
