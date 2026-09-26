# T7 BE Review — UNI-745 chat file + voice FileService migration

- Lane: `t7-migrate` · Run `run_8490c3eddc4f` · Task `task_3be24dcaecc3`
- Worktree: `D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/worktrees/dev-uniwork/feature-UNI-745-fs-chat-migrate`
- Revision under review: `19556745` + `610849f3` on root `5291950b` (`git diff 5291950b..HEAD`)
- Mode: read-only review; the only file written by this stage is this report.

`stage_outcome: succeeded`
`review_verdict: clear`

## Summary

Read the acceptance packet (design doc) and the tester's round-1 report
(F-T7-1..F-T7-6), then reviewed both commits against the diff, cross-checking
every claim in the packet against the actual code rather than trusting the
prose. The design holds: one path per request, claim+insert in a single
transaction, `client_msg_id` idempotency with a payload-bound upload key,
delete releases the reference atomically, tenant scope is org+optional
workspace off the room (never client input), the DTO never leaks
`file_id`/`object_key`, and the legacy pipeline below the selector branch is
functionally untouched (one refactor-only extraction noted below, no
behavior change). No dual-write path exists. `go vet`/tester's test runs are
consistent with the code read here.

Both follow-up fixes in `610849f3` are logically correct on inspection, but
neither shipped with a regression test, which is this review's one new
finding (F-BE-1). Everything else is a carry-forward of tester findings the
packet already tracks as accepted risk (F-T7-1, F-T7-3, F-T7-5, F-T7-6) —
none block this stage.

## Verification of the two follow-up commits against tester findings

- **F-T7-4 (staged upload cancelled only on `idempotency_conflict`) — FIXED.**
  `chat_media_message.go:116-121`: the `if codedIs(err, files.CodeIdempotencyConflict)`
  guard was removed; `cancelStagedUpload` now runs unconditionally on any
  `commitChatMediaMessage` error. Traced every return path in
  `commitChatMediaMessage` (tx-begin failure, json marshal failure, the
  pre-check conflict, the post-insert unique-violation conflict, a bare
  insert/commit error) — all reach this `if err != nil` branch, all now
  cancel. The replay path (`created=false, err=nil`) correctly skips
  cancellation since the file is legitimately claimed by the earlier commit.
  Verdict: fix is correct, but **no test exercises it** — see F-BE-1.
- **F-T7-2 (column NULL, metadata carries `file_id` → false legacy 404) — FIXED.**
  `chat_media_message.go:355-362`: when `msg.FileID` is invalid/empty, the
  code now falls back to `row.File.FileID` / `row.Voice.FileID` (parsed from
  metadata by `fileMessageFromMetadata`/`voiceMessageFromMetadata`) before
  concluding "legacy object_key row" and returning an empty `Reader`. The
  fallback value comes from server-written metadata, never client input, so
  it does not reopen a tenant/ACL gap — `chatFileScope(room)` still gates the
  `files.Open` call the same as the primary case. The handler's own
  `reader.Body == nil` → `ObjectKey == ""` fallback
  (`handler/chat_file_message.go:254`, `handler/chat_voice_message.go:242`)
  is now only reached when both column and metadata truly lack a reference,
  so it's still correct after this change. Verdict: fix is correct, but
  **no test exercises it** — see F-BE-1.
- **F-T7-1 (metadata nil, column set → 404, view disappears) — left open,
  as expected.** `openChatMediaMessage` still requires `row.File`/`row.Voice`
  non-nil before it will even look at the column (`chat_media_message.go:339-346`).
  Tester rated this LOW/latent/not reachable from any T7 writer; the packet
  doesn't list it as a required fix for this round. Not reachable today
  since every writer in this diff sets column and metadata together in the
  same `commitChatMediaMessage` call. No regression from this round.
- **F-T7-3, F-T7-5, F-T7-6 — unchanged, correctly still open.** All three are
  integration-stage concerns the packet already tracks (error vocabulary
  publication before cutover, `ReadPresign` vs. `files.Open` on `chat_voice`
  in the pre-existing `registry.go`, and provider registration riding the
  `SetFiles` wiring PR). None are regressions introduced by `19556745` or
  `610849f3`, and none are actionable inside this lane — they need the T3/T9
  wiring owner and/or the FS registry owner, exactly as the packet's
  "Integration requests" section says.

## Focus-area findings

**F-BE-1 — LOW/MEDIUM (test coverage). The two follow-up fixes in `610849f3` shipped without any new or updated test.**
`server/internal/service/chat_media_message.go` changed in `610849f3` (both
the cancel-on-every-error branch and the metadata-fallback branch), but the
commit's diff touches only that one file plus the two report markdown files
— no test file changed. Concretely: no existing test drives
`commitChatMediaMessage` to a non-idempotency-conflict error *after* a
successful `Upload` (the closest candidates,
`TestSendFileMessagePolicyRefusalsFS` and the two `*ValidationFS` tests, all
fail before `Upload` succeeds, so `cancelStagedUpload` is never reached in
them), and no test seeds a row with `file_id` NULL + metadata `file_id` set
to exercise the new fallback branch in `openChatMediaMessage`. Both fixes
read as correct from the code (traced above), but that is reasoning, not
verification, and this is exactly the kind of one-line conditional change
where a copy/paste or an inverted condition would pass every existing green
suite silently.
Impact: none today (the fixes are net-additive safety nets — this is a
missing-net-improvement, not a live regression), but a future edit to either
branch has no test to catch a reintroduction of the tester's original bugs.
Fix owner: tester round 2 / T7 owner, before merge — add (a) a test that
forces a post-upload failure (e.g. a canceled `ctx` right before commit, or
a forced marshal/insert error via a bad `replyToID` if one exists, or a
lower-level fake hook) and asserts the staged file is canceled, not left
behind; and (b) a seeded-row test (direct SQL insert with `file_id = NULL`,
metadata `file_id` set) proving `OpenChatFileMessage`/`OpenChatVoiceMessage`
now stream instead of 404.

**F-BE-2 — LOW (informational, not a defect). `validateVoiceMessageInput` was refactored, not left byte-identical, though behavior is unchanged.**
`server/internal/service/chat_voice_message.go`: the duration check was
extracted into a new `validateVoiceDurationMS` helper, called both by
`validateVoiceMessageInput` (legacy + FS shared validator) and directly by
the new `SendVoiceMessage` (`chat_voice_message.go:258`). This is a pure
extraction — same bounds, same error message, same call order — verified by
diff (no logic changed inside the moved lines) and by the tester's green
legacy-suite run including `TestValidateVoiceMessageInput`. The acceptance
packet's "Changed files" table describes the legacy voice pair as
"unchanged"; this one shared validator is the one legacy-adjacent line that
did move, which is worth naming precisely for whoever reads the packet as
the byte-identical guarantee, even though nothing here behaves differently.
Fix owner: none required; packet wording nit only, safe to leave as is or
correct in a docs pass.

## Focus areas checked and cleared

- **Transactional correctness**: claim + insert share one tx in
  `commitChatMediaMessage` (`chat_media_message.go:153-224`); every return
  path before `tx.Commit` is preceded by the deferred rollback; the
  unique-violation race re-checks the winner on `s.q` (fresh connection, not
  the aborted tx) and only replays when `chatMediaCommandMatches`. Delete +
  `ReleaseInTx` share one tx in `chat_actions.go:65-87`; publish happens only
  after `tx.Commit` succeeds, matching the send path's post-commit publish.
  Cancel-on-every-error verified above (F-BE-1 is a test gap, not a logic bug).
- **Idempotency**: `chatMediaUploadKey` binds kind + room + sender + client
  key + `sha256(payload)[:8]`, so a different file under the same
  `client_msg_id` cannot silently replay; `chatMediaCommandMatches` requires
  same kind and same `file_id` before treating a hit as a replay, otherwise
  `errClientMsgIDConflict()` (409). The text-vs-file key-sharing quirk
  (`TestSendFileMessageClientMsgIDFS`'s "text reuse of the file key" case) is
  pre-existing `sendMessage` behavior in `chat.go`, untouched by this diff —
  not a T7 regression.
- **Tenant/ACL**: `chatFileScope` returns org (required) + workspace
  (optional, from `roomAnchorWorkspaceID`) and is used identically for
  upload, claim and read. `authorizeRoom`/`requireCanSendMessageInRoom` gate
  sends (checked pre- and post-upload); `authorizeRoomRead` gates opens. The
  file id read path never takes client input — it is always the row's own
  `file_id` column or its own metadata, both server-written.
- **Layer/arch**: `go vet` clean per tester; new code lives in
  `internal/service` (chat → files leaf), handlers only call
  `h.Chat.SendFileMessage`/`OpenChatFileMessage`/etc., no direct DB access
  from handlers, no `internal/audit` table writes anywhere in this diff
  (chat sends/deletes are correctly unaudited, matching existing design and
  the passing `TestAuditAndOutboxWritesGoThroughTheAuditPackage`). Actor
  construction (`audit.User(userID)`) is used the same way every other
  service-tier file in this codebase uses it — not a boundary violation
  (the "actor construction only in service" rule is about keeping handlers
  from building one, and this code is in `internal/service`).
- **Metadata/DTO**: `chatMediaMetadata` writes only
  `{file_id, filename, content_type, size_bytes, duration_ms?}` — no
  storage locator, ever, on the FS path. `toChatMessageDTO`
  (`handler/chat.go`) whitelists `Filename/ContentType/SizeBytes` (file) and
  `DurationMS/ContentType/SizeBytes` (voice) into the DTO structs — `FileID`
  and `ObjectKey` are structurally impossible to leak since the DTO types
  don't carry those fields at all.
- **Legacy preservation**: `git diff 5291950b..HEAD` on
  `chat_file_message.go`/`chat_voice_message.go` confirms
  `PrepareFileMessage`/`CreateFileMessage`/`PrepareVoiceMessage`/`CreateVoiceMessage`
  are untouched (diff shows only additive functions/fields around them); the
  one non-additive touch is the `validateVoiceMessageInput` extraction
  (F-BE-2, cosmetic). `DeleteChatMessage` calls `releaseChatMessageFile`
  which no-ops on `s.files == nil` or an invalid/empty `FileID` — legacy rows
  and the unwired path both delete exactly as before.
- **Migration hygiene**: `900_chat_messages_file_id.{up,down}.sql` is a
  nullable `ADD COLUMN IF NOT EXISTS` / `DROP COLUMN IF EXISTS` pair (no
  backfill, no default, no lock risk); `901_chat_messages_file_id_idx.{up,down}.sql`
  is a lone `CREATE INDEX CONCURRENTLY IF NOT EXISTS ... WHERE file_id IS NOT NULL`
  / `DROP INDEX CONCURRENTLY IF EXISTS`, each alone in its file per the
  concurrent-index rule. Numbers are explicitly flagged placeholder in the
  packet, pending Advisor renumbering at merge — expected, not a defect.

## Findings summary

| ID | File:line | Severity | Fix owner |
|---|---|---|---|
| F-BE-1 | `server/internal/service/chat_media_message.go:108-121,344-362` | LOW/MEDIUM (test coverage) | T7 owner / tester round 2, before merge |
| F-BE-2 | `server/internal/service/chat_voice_message.go:63-81` | LOW (informational, packet wording) | none required |
| F-T7-1 (carried) | `server/internal/service/chat_media_message.go:336-346` | LOW (latent, not reachable from any T7 writer) | future data-fix/backfill author |
| F-T7-3 (carried) | `server/internal/service/file_errors.go:24-46` | LOW (intentional contract drift, unpublished) | T9c cutover owner |
| F-T7-5 (carried) | `server/internal/files/registry.go:207-211` | LOW/MEDIUM (integration question) | FileService owner |
| F-T7-6 (carried) | `server/internal/service/chat_file_refs.go:46-48` | MEDIUM (integration risk, not a defect here) | integrator (T3/T9 wiring PR) |

No finding blocks this stage. `review_verdict: clear` — recommend F-BE-1 be
closed (add the two tests) before or immediately after this lands, and that
the carried F-T7-3/F-T7-5/F-T7-6 items ride the wiring PR as the packet
already commits to.
