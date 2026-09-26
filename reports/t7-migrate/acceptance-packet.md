# T7 Acceptance Packet — UNI-745: chat file + voice messages migrate to FileService

Lane: `t7-migrate` · Run `run_5c1df2ff658d` · Branch `feature/UNI-745-fs-chat-migrate`
Base: `5291950b` (integration root merged in and evidence re-run on it; includes Gate A0 + the UNI-745/UNI-746 Bước 0 nets)
Commits under review: `19556745` (implementation) → `610849f3` (tester-finding fixes) → HEAD (BE-review test additions + this packet)

## Scope

Chat file attachments and voice messages
(`POST …/rooms/{id}/messages/{file,voice}` + the two streaming GETs +
message delete + list/get DTOs). All chat service/handler/query/migration
work for the module. No FE files changed — the wire contract is unchanged.

## Design (per Advisor ruling, msg_08c904746e70)

- **Selectable path, not a hard switch.** The selector is the
  constructor-level dependency `ChatService.files files.Service` — set by
  `SetFiles`, read by `FilesService()`. `nil` = legacy storage pipeline,
  byte-identical. No env flag, no per-request toggle, no FS→legacy fallback
  on error (FS errors map through `mapServiceError`).
- **One path per request — never dual-write.** A send is either FS
  (`sendChatFileMessageFS`/`sendChatVoiceMessageFS`) or legacy
  (`sendChatFileMessage`/`sendChatVoiceMessage`), decided once at handler
  entry. Reads decide per *row*: `file_id` column set ⇒ `files.Open`;
  empty ⇒ legacy `object_key` object (pre-migration rows until the T9b
  backfill).
- **Schema**: nullable `chat_messages.file_id TEXT` (migration 900),
  `idx_chat_messages_file_id` CONCURRENTLY where `file_id IS NOT NULL`
  (901). Placeholder numbers — Advisor renumbers at merge (plan §3.4).
- **Metadata snapshot, no locator**: post-migration rows carry
  `{file_id, filename, content_type, size_bytes[, duration_ms]}` — verified
  values from `files.File`; `object_key` never written. Parsers accept
  either reference so rows from either path read correctly.
- **Idempotency**: chat keeps `client_msg_id` as the client dedupe key and
  derives the FS upload key as
  `chat/{kind}/{roomID}/{senderID}/{client_msg_id}/{sha256(payload)[:8]}` —
  the payload digest is required because a voice note's filename is
  constant and `commandFingerprint` does not bind body bytes. Same key +
  same file ⇒ replay the earlier message; same key + different command ⇒
  `idempotency_conflict` (409).
- **Claim in transaction**: `files.Upload` stages → send permission is
  re-checked → `ClaimInTx` + `chat_messages` insert in one transaction.
  Post-upload refusal cancels the staged upload; a unique-violation race
  re-checks the winner on a fresh connection (the loser tx is aborted) and
  replays iff the winner stored the same file.
- **Delete releases, never deletes bytes**: `DeleteChatMessage` soft-deletes
  and calls `ReleaseInTx` inside the same transaction; GC owns bytes.
- **Reference provider**: `chat.messages` (`ChatService.FileReferenceProvider`)
  reports `files.HoldActive` for `file_id`s on live rows via
  `ListChatMessageFileRefs` (`deleted_at IS NULL`); soft-deleted rows drop
  out because the reference was released at delete.
- **Scope**: `files.ScopeOrgWorkspaceOptional` — org from the room, workspace
  anchor optional (org-level DM/group rooms have no workspace).

## Authz preserved

`authorizeRoom`/`requireCanSendMessageInRoom` run identically on the FS
path: room membership, workspace membership, DM block (pre-upload AND
re-checked after staging), per-room send restrictions. Covered by
`TestSendFileMessageRequiresRoomMembershipAndHonoursDMBlockFS` and the
unchanged legacy ACL/block e2e+handler tests.

## Changed files

- `server/migrations/900_chat_messages_file_id.{up,down}.sql`,
  `901_chat_messages_file_id_idx.{up,down}.sql` — placeholder numbers.
- `server/pkg/db/queries/chat.sql` — `file_id` in both media inserts +
  `ListChatMessageFileRefs`; regenerated sqlc (v1.31.1): `chat.sql.go`,
  `chat_links.sql.go`, `models.go`.
- `server/internal/service/chat_media_message.go` — NEW: shared FS send
  core (upload → authz recheck → claim+insert tx), open, release, upload
  key, scope, metadata.
- `server/internal/service/chat_file_message.go` — `SendFileMessage`,
  `OpenChatFileMessage`, `FileMessageInfo.FileID`; legacy
  `PrepareFileMessage`/`CreateFileMessage` unchanged.
- `server/internal/service/chat_voice_message.go` — `SendVoiceMessage`,
  `OpenChatVoiceMessage`, `VoiceMessageInfo.FileID`; legacy pair unchanged.
  One refactor-only touch: the duration check inside the shared
  `validateVoiceMessageInput` was extracted to `validateVoiceDurationMS`
  (same bounds, same message — BE reviewer F-BE-2, informational).
- `server/internal/service/chat.go` — `files` field only (T8-owned shared
  file; kept to two lines + import so T8's `SetVoiceRecordingFiles` merges
  cleanly).
- `server/internal/service/chat_actions.go` — `DeleteChatMessage` releases
  the reference in the delete transaction.
- `server/internal/service/chat_file_refs.go` — NEW: `chat.messages`
  `ReferenceProvider`.
- `server/internal/handler/chat_file_message.go`,
  `chat_voice_message.go` — selector branch + `*FS` send/stream functions;
  legacy functions byte-identical below the branch.
- `server/internal/handler/chat_test.go` — `setupChatFixtureOn(srv, tag)`
  helper so FS tests wire filesfake without changing the default fixture.
- `server/internal/handler/chat_media_fs_test.go`,
  `server/internal/service/chat_media_fs_test.go` — NEW filesfake suites.

DTO/SDO files, `chat-media.ts`, chat hooks, and all FE code: **unchanged**
(endpoints, multipart fields, response shape and DTO fields identical).

## s0-chat findings — how this task changes each

- **F1 soft delete keeps bytes** — on the FS path delete releases the
  reference and the collector owns bytes; legacy unchanged.
- **F2 `client_msg_id` conflict not enforced** — FS path returns
  `idempotency_conflict` for a different command under the same key
  (handler test asserts HTTP 409); legacy unchanged by design.
- **F3 `object_key` in metadata** — FS path stores `file_id` + verified
  snapshot only; regression test asserts no `object_key`/`file_id` leak in
  the DTO.
- **F4 cross-org e2e/API split** — `chatFileScope` carries the org; the
  FS-path service test covers room-membership denial; cross-org handler
  coverage runs on the unchanged legacy net (API split covered by
  `TestChatFileMessageCrossOrganizationGuessedIDsBlocked`).

## Evidence

Run with `GOCACHE/GOTMPDIR` on D:, `GOFLAGS=-p=2`, one go command at a
time (host guard msg_0f3c85bbd438), `.env.worktree` exported.
`-race` not available (no CGO) — CI covers it.

- `go vet ./internal/handler ./internal/service` — **clean**.
- `go test ./migrations -count=1` — **ok** (900/901 lint clean).
- FS service suite
  `go test ./internal/service -run 'FS$|FileReference|ReleasesFileReference|VerifiedBytes|MetadataFileIDFallback|CancelsStagedUpload' -count=1 -v` —
  **12 PASS, 1 SKIP** (308s final run): metadata file_id, replay/conflict,
  concurrent same-key (1 row, 1 event), membership+DM block, release on
  delete + provider before/after, `files.Open` verified bytes, policy
  refusals (type/oversize), validation, storage_unavailable when unwired,
  staged-upload cancel on a post-upload commit error (injected ClaimInTx
  failure → `file_upload_canceled` on replay; F-BE-1), metadata-only
  `file_id` read fallback (column NULL → streams via FS; F-BE-1).
  `TestSendVoiceMessageHappyPathFS` SKIPs — pending t1c detector.
- FS handler suite `go test ./internal/handler -run 'FS$|FSLeaves' -count=1 -v` —
  **2 PASS, 1 SKIP**: upload→claim→DTO→replay→409 conflict→`files.Open`
  stream with headers→415 rejection; local storage stays empty on FS path;
  voice send SKIPs (415, pending t1c).
- Legacy regression net **unchanged and green** (Advisor ruling cond. 3):
  `go test ./internal/handler -run '<chat file/voice tests>'` — **all PASS**
  incl. sniffers, size/type rejections, DM block, outside-room/cross-org
  deny, storage-key+delete pins, idempotent resend. Service-side legacy
  suite — **all PASS** (prepare/create/metadata/pin tests).
- Arch guards `go test ./internal -run 'TestLayering|TestActor…|TestAuditAndOutbox…'` —
  **PASS** (chat sends/delete are not audited commands — unchanged design).
- **E2E**: `e2e/files-chat.spec.ts` — **6/6 PASS** (2.5m) on the legacy
  path incl. `@files-smoke` file send + second-member download, voice
  playback, client_msg_id dedupe, cross-org deny, type rejection, DM
  block. (One cold-start `beforeAll` flake on first run — Next dev compile;
  passed on retry with warm routes.)
- FS-path e2e: **runs only after integration** — `files.Service` is not
  wired in `cmd/server/main.go` (integrator-owned); until `SetFiles` is
  called there, e2e can only exercise the legacy path.

## Legacy branches kept (removal conditions — plan §7 step 8 / T9c)

| Branch | Location | Removal condition |
|---|---|---|
| Legacy send: sniff + `h.Storage.Upload` + `PrepareFileMessage`/`CreateFileMessage` | `handler/chat_file_message.go`, `service/chat_file_message.go` | T9c: FileService unconditionally wired; drop prepare/create pair + sniffer. |
| Same for voice (`sniffChatVoiceContentType`, `PrepareVoiceMessage`/`CreateVoiceMessage`) | `handler/chat_voice_message.go`, `service/chat_voice_message.go` | T9c: drop pair + sniffer + `chatVoiceExtByType`. |
| `h.Storage == nil` refuse + `h.Storage.GetReader` streams | both handler files | T9c: all rows carry file_id; storage dependency removed from chat handlers. |
| `reader.Body == nil` legacy-object fallback in `streamChat*FS` | both handler files | T9b: backfill writes file_id on pre-migration rows; fallback deleted. |
| `object_key` in `FileMessageInfo`/`VoiceMessageInfo` + metadata parsers | `service/chat_{file,voice}_message.go` | T9b: no `object_key` rows remain; field dropped. |
| `supportedChatFileContentTypes`/`supportedVoiceContentTypes` allowlists | `service/chat_{file,voice}_message.go` | T9c: policy lives in the FS registry only; validate* helpers reduce to envelope checks. |

## Integration requests / flags

1. **Wiring (integrator)**: construct the real `files.Service` in
   `cmd/server/main.go` (owned by the integrator), call
   `chatSvc.SetFiles(fs)`, **and register `chatSvc.FileReferenceProvider()`
   (`chat.messages`) in the same wiring step** — the collector otherwise
   sees no holds for `chat_messages.file_id` and may reclaim bytes that
   live messages still reference (tester F-T7-6). Until then production
   runs the legacy path — exactly as tested.
2. **Org-less rooms**: `chatFileScope` returns empty org/workspace for
   rooms without them; `ScopeOrgWorkspaceOptional` tolerates that. If a
   stricter scope is decided centrally, chat follows the registry row.
3. **Voice verified type**: filesfake sniffs with `http.DetectContentType`,
   which cannot produce `audio/*` for WebM/Ogg/MP4 containers — voice
   uploads on the FS path answer `file_type_rejected` (415) today.
   t1c-content-detect (UNI-739) owns the shared detector + registry fix;
   the voice tests flip green once it merges. Per Advisor ruling, T7 did
   not touch `registry.go`/`filesfake`.
4. **`chat_voice` read mode**: the registry row declares `ReadPresign` but
   chat streams voice bytes through `files.Open` (per-request ACL needs a
   proxy). Confirm with the FS owner that `Open` is legal for a presign
   purpose, or flip the row to `ReadProxy` at cutover (tester F-T7-5;
   the fake does not enforce read mode in `Open`, so nothing catches a
   mismatch until the real service).
5. **Error-code vocabulary at cutover**: the FS path surfaces contract
   codes (`file_type_rejected`/`file_too_large`/`file_not_found`/
   `idempotency_conflict`) where the legacy path answered
   `unsupported_media_type`/`too_large`/`not_found`/silent replay. Status
   codes are unchanged; the FE currently keys off the legacy codes, so the
   vocabulary must be published (API docs + FE error handling) before the
   selector flips (tester F-T7-3).
6. **Idempotency-key payload digest**: the upload key includes
   `sha256(payload)[:8]` so a different recording/file under one
   `client_msg_id` is a different command — needed because the fake's
   `commandFingerprint` does not bind body bytes. If the contract later
   binds payloads into the key, drop the digest from
   `chatMediaUploadKey`.
7. **Unclaimed staged uploads**: post-upload errors cancel the staged
   upload (fixed per tester F-T7-4 — cancel now runs on every terminal
   error, not only conflicts); a replayed-by-race duplicate stays staged
   until GC — bounded, GC-owned.
8. **Backfill contract for T9b**: rows must carry `file_id` in BOTH the
   column and the metadata snapshot — the provider reads the column, the
   read path now tolerates metadata-only references (tester F-T7-2 fix),
   but a column-only row would still render without file metadata in the
   DTO (tester F-T7-1, latent).

## Stage reports

- Tester (codex deepseek-4.1, effort xhigh — requested deepseek-4.1+max,
  `max` rejected for this model): **pass** on all 7 checks (vet, migration
  lint 18/18, FS service 10+1skip, FS handler 2+1skip, both legacy nets
  green unchanged, arch guards, adversarial diff review). 6 findings, none
  blocking; F-T7-2 (metadata file_id fallback) and F-T7-4 (cancel on any
  post-upload error) fixed in `610849f3` and retested green; F-T7-3/5/6
  carried as integration flags above. Report:
  `reports/t7-migrate/tester-r1.md`.
- BE Reviewer (claude claude-sonnet-5): **`review_verdict: clear`** — no
  blocking defect; design verified against the diff (one path per request,
  claim+insert tx, payload-bound upload key, delete release atomic, tenant
  scope server-derived, DTO never leaks `file_id`/`object_key`, legacy
  functionally untouched). F-BE-1 (the two `610849f3` fixes lacked
  regression tests) **closed here** by
  `TestSendFileMessageCancelsStagedUploadOnCommitErrorFS` +
  `TestOpenChatFileMessageMetadataFileIDFallbackFS`; F-BE-2 (the
  `validateVoiceMessageInput` extraction is refactor-only) recorded in the
  changed-files table above; carried F-T7-1/3/5/6 remain integration-stage
  items as listed. Report: `reports/t7-migrate/be-review.md`.
- FE Reviewer: **not applicable** — zero FE/UI files changed (wire
  contract unchanged).
