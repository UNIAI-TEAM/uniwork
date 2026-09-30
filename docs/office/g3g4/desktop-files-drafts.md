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

04b owns the shared Q8/system matrix: the real DPAPI/ACL and Keychain adapters,
logout/restart/re-login live-session and ACL checks, account-B isolation in a
packaged binary, disk-full/key-loss/corrupt recovery UI, crash recovery to the
last confirmed checkpoint, and the single local/cloud Save guard. The typed
`desktop:draft-list`, `desktop:draft-recover` and `desktop:draft-discard` IPC
commands bind account/deployment/document identity in main; recover returns
bytes only for a live edit ACL and a matching revision/version base. Blocked or
locked states have no export/copy/clipboard action. Close/logout/update use the
same lifecycle coordinator: Save must return a confirmed receipt, keep draft
must return a stored/unchanged checkpoint, discard is generation-bound, and
stay leaves all bytes untouched. Packaged Q-DESKTOP-SYSTEM evidence is recorded
per OS; a missing macOS runner is explicitly `not run`, never a pass. The
renderer exposes localized, non-exporting available/conflict/blocked/locked/
unavailable states through its recovery element and status mapping. The editor
host remains responsible for supplying the live document context and driving
those states; the Electron bootstrap fails closed until it is attached.

The Windows system smoke is runnable with `pnpm --filter @uniwork/office-desktop smoke:recovery-system`. It launches the real Electron binary with an isolated `userData` directory, exercises the DPAPI-backed `safeStorage` key adapter, verifies that the persisted file contains only the wrapped key (never the raw 256-bit key), checks the namespace directory ACL is restricted to the current Windows account, and deletes the key. The successful run is recorded in `D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/office-g3g4/reports/g4-04b-desktop-recovery/windows-safe-storage-system.log`.

The editor-driven AC-4 sequence (edit, kill, restart, offer recovery and restore) is deferred to G4-06a/G4-08 because this lane has no document editor host, seeded protected-draft seam, or packaged account-A/account-B visual harness. The packaged-dev visual leg is therefore not claimed as a pass here; the fail-closed `context: () => undefined` placeholder remains until that host context is supplied.

The smoke resolves the Windows principal through `whoami.exe` (the inherited `USERDOMAIN`/`USERNAME` values are not trusted), and parses both the namespace directory and generated key-file ACLs. It rejects inherited or unexpected explicit principals; the Windows defaults permitted by the platform are the current account with Modify, `NT AUTHORITY\SYSTEM` with Full Control, and the per-session `NT AUTHORITY\LogonSessionId_*` read/execute entry. When `dist/build-identity.json` exists, the smoke uses that packaged channel projection; otherwise it uses the source manifest projection, matching the corresponding Electron host mode.
