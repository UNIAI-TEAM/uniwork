# T7 Tester Report (round 1) - UNI-745 chat file + voice FileService migration

- Lane: `t7-migrate` - Run `run_8490c3eddc4f` - Task `task_b7e91db366fa` (dispatch `ctx_24ddd772a389`)
- Worktree: `D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/worktrees/dev-uniwork/feature-UNI-745-fs-chat-migrate`
- Branch: `feature/UNI-745-fs-chat-migrate` - Revision under test: `19556745` (only commit on top of root `5291950b`), worktree clean at test time
- Mode: read + run only; the only file written by this stage is this report.
- Env: `../.env.worktree` exported into every go command; `GOCACHE=D:\.go-build-cache`, `GOTMPDIR=D:\.gotmp-t7`, `GOFLAGS=-p=2`; one go command at a time, foreground, cwd `server/`.
- Stage outcome: **succeeded**. Test verdict: **pass** on all 7 checks. No blocking defect found; 6 review findings, all LOW except one integration risk (F-T7-6) that must land with the T3/T9 wiring.

## 1. Check results (command -> result)

| # | Command | Verdict | Evidence |
|---|---|---|---|
| 1 | `go vet ./internal/handler ./internal/service ./migrations` | **pass** | no diagnostics, exit 0 (16.8s) |
| 2 | `go test ./migrations -count=1 -v` | **pass** | 18/18 PASS, `ok ... 109.204s`, exit 0; 900/901 placeholders lint clean (incl. `TestMigrationNumericPrefixesAreUnique`, `TestNewMigrationsCreateIndexesConcurrently`, `TestRenamedChatMigrationVersions`) |
| 3 | `go test ./internal/service -run 'FS$|FileReference|ReleasesFileReference|VerifiedBytes' -count=1 -v` | **pass (1 expected SKIP)** | `ok ... 144.433s`, exit 0: 10 PASS (metadata file_id, client_msg_id replay/conflict, concurrent same key, membership + DM block, release on delete + provider before/after, `files.Open` verified bytes, policy refusals, validation, voice validation, voice non-audio) + `TestSendVoiceMessageHappyPathFS` SKIP: "voice upload refused by the raw sniffer: pending t1c-content-detect (UNI-739) merge" |
| 4 | `go test ./internal/handler -run 'FS$|FSLeaves' -count=1 -v` | **pass (1 expected SKIP)** | `ok ... 48.420s`, exit 0: `TestSendAndStreamChatFileMessageFS` PASS (send 200 -> DTO -> replay same id -> 409 `idempotency_conflict` -> stream bytes equal + headers -> 415), `TestChatFileMessageFSLeavesLocalStorageEmpty` PASS (LOCAL_UPLOAD_DIR stays empty), `TestSendChatVoiceMessageFS` SKIP (415, pending UNI-739) |
| 5a | `go test ./internal/handler -run 'TestSniffChat|TestToChatMessageDTO|TestChatFileMessage|TestChatVoiceMessage|TestChatFileAndVoice|TestChatFileMessageStorageKey|TestChatFileMessageOutsideRoom|TestChatFileMessageCrossOrganization|TestChatFileMessageIdempotent' -count=1 -v` | **pass** | `ok ... 155.212s`, exit 0, no SKIP/FAIL: both sniffers, both DTO mappers, second-member download, idempotent resend, size/type rejection pins, voice duration/size/type pins, outside-room deny, cross-org guessed-id deny, DM-block + send-restriction, storage-key + delete pins, plus `TestChatFileMessageFSLeavesLocalStorageEmpty` pulled in by the prefix |
| 5b | `go test ./internal/service -run 'TestChatFileAndVoiceCapsPin|TestChatMessageMetadataKeepsStorageLocatorPin|TestChatFileMessageClientMsgIDIdempotencyPin|TestFileMessage|TestVoiceMessage|TestCreateFileMessage|TestCreateVoiceMessage|TestValidateFileMessageInput|TestValidateVoiceMessageInput|TestSanitizeChatFilename|TestExtForChatFileContentType|TestDeleteChatMessage' -count=1 -v` | **pass** | `ok ... 66.700s`, exit 0, no SKIP/FAIL; metadata-keeps-`object_key` pin still green on the legacy path |
| 6 | `go test ./internal -run 'TestLayering|TestActorConstructedOnlyInService|TestAuditAndOutboxWritesGoThroughTheAuditPackage' -count=1 -v` | **pass** | `ok ... 5.505s`, exit 0, 3/3 PASS |
| 7 | Adversarial review of `git show 19556745` | **performed** | findings F-T7-1..F-T7-6 below |

Host guard honoured: no `./internal/service` full-package run, no `scripts/test-go.sh`, no parallel go commands.
`-race` was **not** available (no CGO), so the concurrency assertions in `TestSendFileMessageConcurrentSameKeyFS` (4 goroutines, same `client_msg_id`) ran without the race detector; that limit applies to every check above.

## 2. Adversarial review - what held

- **No dual-write.** The path is chosen once at handler entry (`handler/chat_file_message.go:53-59`, `handler/chat_voice_message.go:45-51`, same for the two stream handlers at `:190-196` / `:184-190`), and the FS send writes no storage locator (`service/chat_media_message.go:291-303`) and never touches `h.Storage`. `TestChatFileMessageFSLeavesLocalStorageEmpty` proves no object reaches the module backend on a send + retry.
- **Idempotency.** Replay returns `created=false`, so no last-read touch, no room touch and no `chat.message.created` publish (`service/chat_media_message.go:122-129`); the conflict path returns before `ClaimInTx`/insert (`:166-171`, claim at `:173`) and the aborted transaction is discarded by the deferred rollback (`:156`); the unique-violation race re-checks the winner on a fresh connection with the tx deliberately abandoned (`:206-217`), and the concurrency test asserts exactly one row and one event. A retry after delete yields 409 rather than a replay - pre-existing behaviour (`GetChatMessageByClientMsgID` filters `deleted_at`, `uidx_chat_messages_room_sender_client_msg_id` is not partial), identical on the legacy path, not a T7 regression.
- **Release paths.** `SoftDeleteChatMessage` is the only writer that removes chat messages from the live set in the service layer, and `DeleteChatMessage` releases in the same transaction (`service/chat_actions.go:65-85`). The provider filters `deleted_at IS NULL`, so any future row-removal path also drops its hold. No hard-delete path exists to miss.
- **Scope/tenant.** Reads are gated by `authorizeRoomRead` (public-channel-aware, same helper the legacy `GetFileMessage` used via `GetRoomMessage`) + `GetChatMessageInRoom`; the file id always comes from the row, never from client input, so a guessed file id cannot be opened from another room. `Open` runs under `chatFileScope(room)` = org + optional workspace anchor, matching `ScopeOrgWorkspaceOptional`. Outsider/block denials are asserted in check 3.
- **Error mapping internals.** `filesError` copies code + status and wraps `ErrNotFound` / `ErrConflict` so `errors.Is` keeps working (`service/file_errors.go:24-46`); `errClientMsgIDConflict` uses `files.CodeIdempotencyConflict` with 409, consistent with `files.StatusForCode`; `mapServiceError` renders `CodedError` before the sentinel branches (`handler/auth.go:146-180`), so no code/status can disagree. The only drift is the vocabulary itself (F-T7-3).

## 3. Findings

**F-T7-1 - LOW (latent, read robustness). A row whose `file_id` column is set but whose metadata carries neither `file_id` nor `object_key` is unreadable and disappears from the DTO.**
`service/chat_media_message.go:336-345` builds the file/voice view from metadata only (`row.File` / `row.Voice`, parsed at `service/chat_file_message.go:284-306`, `service/chat_voice_message.go:306-328`), and returns `ErrNotFound` when it is nil; the comment at `:346` ("the column is authoritative") only holds for the `files.Open` call below. Impact: streaming GET -> 404 `not_found`, and the list/send DTO loses the file block, even though the column still identifies servable bytes. Not reachable from a T7 writer (both column and metadata are written together), but reachable from any data fix/backfill that writes the column without rewriting metadata.
Suggested fix: when the metadata view is nil but `msg.FileID.Valid`, synthesize the view from the column (name/size/type from `files.ResolveMany` or the `Reader` returned by `Open`) instead of 404; add a unit test that seeds such a row.

**F-T7-2 - LOW (latent, read robustness). The mirror case: metadata carries `file_id`, the column is NULL -> the legacy branch swallows it.**
`service/chat_media_message.go:347-355` reads the reference from the column only, so it returns an empty `files.Reader`; the handler then requires a non-empty `object_key` and answers 404 `not_found` (`handler/chat_file_message.go:254-262`, `handler/chat_voice_message.go:242-250`) although the metadata names a file that exists. Same reachability argument as F-T7-1.
Suggested fix: fall back to the metadata file id (`row.File.FileID` / `row.Voice.FileID`) before deciding "legacy object_key row".

**F-T7-3 - LOW (contract drift, intentional but unrecorded in the API surface). The FS path publishes FileService codes where the legacy path published module codes.**
`filesError` passes `file_type_rejected` / `file_too_large` / `file_not_found` / `idempotency_conflict` through unchanged (`service/file_errors.go:24-46`), while the legacy handlers answer `unsupported_media_type` (415), `too_large` (413), `not_found` (404), and silently replay a conflicting `client_msg_id`. The new codes are asserted deliberately on the FS path (`handler/chat_media_fs_test.go:78-84`) and the acceptance packet records the idempotency change as intended (F2), so this is not a defect - but the legacy-path regression net cannot see it, and the FE currently keys off the legacy codes. Success payloads/DTO fields are genuinely unchanged.
Suggested fix: before T9c flips the selector, either re-map chat's read/upload codes to the module vocabulary in the chat layer, or publish the file-code vocabulary in the API docs/SDK + FE error handling, and add an e2e assertion on the FS path.

**F-T7-4 - LOW (resource hygiene). A staged upload is cancelled only for the idempotency-conflict failure.**
`service/chat_media_message.go:108-119`: the post-upload cancel runs for `CodeIdempotencyConflict` only, so a tx-begin failure, a json marshal failure, an insert/commit failure or an aborted request context leaves the staged object behind. Bounded (<= 25 MiB per failed send) and GC-owned after the 24h claim window, so no correctness impact - it just delays reclamation.
Suggested fix: cancel on every terminal error after a successful upload (keep the current best-effort semantics for `already_claimed`).

**F-T7-5 - LOW/MEDIUM (integration question, needs the FS owner). `chat_voice` is declared `ReadPresign` but chat streams it through `files.Open`.**
`files/registry.go:207-211` sets `ReadMode: ReadPresign` for `ChatVoice`, while the chat read path always proxies bytes itself via `files.Open` (`service/chat_media_message.go:358`, called from `service/chat_voice_message.go:281-287`). The fake enforces `ReadMode` in `ResolveMany` (`files/filesfake/service.go:249`) but not in `Open` (`:290`), and `TestChatMediaRegistrySpecsMatchChatCaps` asserts the read mode for `chat_attachment` only (`service/chat_media_fs_test.go:74-76`), so nothing catches the mismatch. If the real T3 implementation refuses `Open` for a presign purpose, every voice playback breaks after the cutover.
Suggested fix: confirm with the FileService owner that `Open` is legal for any purpose (proxy route is what chat's per-request ACL needs), or flip the `chat_voice` row to `ReadProxy` to match the streaming design and extend the registry-parity test to both purposes.

**F-T7-6 - MEDIUM (integration risk, not a defect in this commit). Nothing registers the chat reference provider in production.**
`service/chat_file_refs.go:46-48` exposes `ChatService.FileReferenceProvider()`, and the only callers in the tree are tests (`service/chat_media_fs_test.go:381`); the files registry has no provider registration point yet (T3-owned), and `SetFiles` likewise has no production caller. If the integrator wires `SetFiles` without registering the provider, the collector observes no holds for `chat_messages.file_id` and may reclaim bytes that live messages still reference.
Suggested fix: make provider registration part of the same wiring step that constructs the FileService (`cmd/server/main.go`, T3/T9), and add a guard test that the wired service's provider set contains `chat.messages` for both chat purposes.

## 4. Coverage gaps (LOW)

- The FS handlers' pre-migration fallback (`reader.Body == nil` -> `h.Storage.GetReader`, `handler/chat_file_message.go:254-262`, `handler/chat_voice_message.go:242-250`) has no test with a FileService wired: every FS-path test writes `file_id` rows. This is the T9b bridge, and it is also the path that still needs `h.Storage` at cutover - worth a seeded-legacy-row test.
- No test covers F-T7-1 / F-T7-2 (metadata vs column asymmetry).
- No test enforces purpose `ReadMode` through `Open` (F-T7-5); and the FS voice happy path (send -> claim -> open) stays unverified until the UNI-739 detector lands, so today the FS voice path has only refusal + validation evidence.

## 5. Verdict

`stage_outcome: succeeded` - all 7 requested checks ran to completion with the expected results, including the two documented SKIPs (voice happy path + voice handler send, both gated on t1c-content-detect/UNI-739) and the unchanged legacy regression net on the legacy path. No high-severity defect: no dual-write, no missing release path, no idempotency hole that creates rows or republishes events, no tenant leak, and the `filesError` -> `CodedError` mapping is internally consistent. The items worth carrying forward are F-T7-6 (provider registration must ride the same wiring PR), F-T7-3 (error-code vocabulary must be published before cutover), and F-T7-5 (confirm `Open` on a presign-mode purpose with the FS owner).

Residual limits: `-race` unavailable (no CGO); FS path is unreachable in production until `SetFiles` is called by the integrator, so no FS-path e2e evidence exists; no full-package or whole-repo test run (host guard).
