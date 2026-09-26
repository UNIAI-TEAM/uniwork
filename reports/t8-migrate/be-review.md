# T8 BE Review — UNI-746 recording migration to FileService

Reviewer: BE reviewer (claude claude-sonnet-5) · review-only, no edits
Commit under review: `3b434165` (feat), context from `f394819b` (acceptance packet)
Method: read-only diff + full-file read of every path in scope; no `go build`/`go test` run.

## stage_outcome

Reviewed. All items on the Advisor contract checklist hold in the code as
written and are exercised by `meeting_recording_fs_test.go`. Two non-blocking
reliability gaps and a few nits are flagged below for the Advisor / T9c
integrator; none contradicts the stated contract, so nothing here should
block this lane's merge into the FileService root.

## review_verdict: clear

## Contract checklist (all hold)

- **Wiring-level selectable path** — `s.files`/`voiceRecordingFileServices`
  default nil; every branch point (`StartRecording`/`StartVoiceRecording`,
  `finishRecordingFromProvider`/`FinishVoiceRecordingByEgress`, playback
  handlers) gates on `!= nil` and falls through to the untouched legacy code.
  `TestMeetingRecordingLegacyPathUnchangedWithoutFiles` pins byte-identical
  legacy behavior (meeting_recording_fs_test.go:249).
- **Exactly one storage path per request, no dual-write** — `target`/`fileID`
  are set in one `if s.files != nil` block and threaded through unconditionally;
  no code path builds both a legacy `FilePrefix` write and an FS write target.
- **No env flag / fallback** — confirmed; selection is purely the `SetFiles`/
  `SetVoiceRecordingFiles` call, no `os.Getenv`/config read in the reviewed files.
- **Provider output reserved before LiveKit start, `OperationID` = row id** —
  `recID := util.NewID()` is minted first, `RegisterProviderOutput(..., OperationID: recID)`
  runs before `s.provider.StartRecording`/`s.conference.StartRecording` in both
  meeting_ai.go:372-405 and chat_voice_recording.go:98-128.
- **Webhook = `CompleteProviderOutput` then `ClaimInTx` + row COMPLETE in one tx** —
  `finishRecordingFileClaim` (meeting_ai.go:543-610) and
  `finishVoiceRecordingFileClaim` (chat_voice_recording.go:246-308) both call
  `CompleteProviderOutput` outside a transaction, then open one `pool.Begin`,
  `ClaimInTx` + `FinishRecordingByEgress`/`FinishChatVoiceRecordingByEgress` on
  the same `db.Queries.WithTx(tx)`, then commit. Audit write for the meeting
  path is inside the same tx (`s.writeAudit(ctx, q, ...)`, meeting_ai.go:605).
- **Retryable = `storage_unavailable`/`file_not_ready` only** — both finish
  functions check `fe.Code != files.CodeStorageUnavailable && fe.Code != files.CodeNotReady`
  before failing the row; every other code fails it. Matches
  `TestMeetingRecordingFileServiceStorageDownRetries` (row stays PROCESSING,
  no claim, retry with a fresh event completes it).
- **Failed egress never resurrected** — both finish functions gate on
  `rec.Status == RecordingActive || rec.Status == RecordingProcessing` before
  acting; a terminal row (COMPLETE/FAILED) is a no-op on replay. Pinned by
  `TestMeetingRecordingFileServiceReplayAndLateEvents` and
  `TestChatVoiceRecordingFileServiceFailedEgress`.
- **`file_url` never stored on FS rows** — `InsertMeetingRecordingParams`/
  `InsertChatVoiceRecordingParams` never set `FileUrl`; the SQL uses
  `file_url = COALESCE(sqlc.narg('file_url'), file_url)` (meeting_ai.sql:42,48;
  chat_voice_recording.sql:25,34) so an omitted param leaves the column
  untouched (stays NULL) rather than overwriting it.
- **Playback re-authorizes in service layer** — every playback method
  (`ResolveMeetingRecordingPlaybackURL`, `MeetingRecordingFileSize`,
  `OpenMeetingRecording` and their chat equivalents) starts by calling
  `GetMeetingRecordingForPlayback`/`GetVoiceRecordingForPlayback`, which
  re-runs `authorizeActiveParticipant`/`authorizeVoiceSignalRoom`. Handlers
  hold no `files` types and never cache an authorization result across the
  size call and the open call.
- **Reference providers** — `MeetingRecordingProvider` (meeting_ai.go:731-766)
  and `chatVoiceRecordingProvider` (chat_voice_recording.go:530-566) both
  report `Purposes()` matching the purpose used at reservation
  (`files.MeetingRecording`/`files.ChatCallRecording`) and `HeldBy` returns
  `HoldActive` for any live row's `file_id`, verified by
  `TestRecordingReferenceProviders`.
- **Arch boundary (`internal/service` is the only `internal/files` importer)** —
  confirmed by grep: no `internal/files` import in `internal/meetings/*.go` or
  `internal/handler/{meeting_ai,chat_voice,recording_playback}.go`.
  `meetings.RecordingOutputTarget` deliberately mirrors `files.WriteTarget`
  instead of importing it (provider.go:82-98), and
  `TestFilesContractIsALeafCalledOnlyFromTheServiceTier` (arch_test.go:431)
  enforces the rule generally.
- **LiveKit `outputTargetKey` decode/validation** (livekit.go:169-213) — parses
  the write-target URL, requires PUT-or-empty method, an unexpired lease,
  https/http with a host, validates host against the configured recording
  endpoint (path-style and virtual-hosted-style), extracts the decoded
  (`u.Path`, not `EscapedPath`) object key, and requires a `.mp4` suffix with a
  comment correctly explaining why (egress appends an extension to a
  suffix-less path, which would land bytes outside the reserved object).
  Reasoning and code agree.
- **Webhook replay idempotency** — dedup happens one level up, in
  `HandleProviderEvent` (meeting_queries.go:34-45): `InsertProviderEvent` on
  `(provider_key, provider_event_id)` (unique index from migration 022) short
  circuits a duplicate delivery before `finishRecordingFromProvider` ever
  runs, so both FS and legacy finish paths are covered by the same gate. Not
  part of this diff, but it is exactly the mechanism the finish functions rely
  on for "replay is a no-op," and it is correctly upstream of both.
- **SQL lives in the query files** — no query string construction inside
  meeting_ai.go/chat_voice_recording.go; all statements are sqlc-generated
  from `meeting_ai.sql`/`chat_voice_recording.sql`.

## Findings

### F1 — [medium] "a later provider event retries" assumes a retry vector that may not exist in production
- **file:line**: `server/internal/service/meeting_ai.go:573-585`,
  `server/internal/service/chat_voice_recording.go:268-283`;
  dedup gate at `server/internal/service/meeting_queries.go:34-45`.
- **trigger**: `CompleteProviderOutput` returns `CodeStorageUnavailable` or
  `CodeNotReady` on the finish webhook. The row is deliberately left
  PROCESSING/ACTIVE, per the comment, "a later provider event for the same
  egress finishes the job inside the session lease."
- **impact**: The only thing that can re-drive this row is another call into
  `HandleProviderEvent` for the same egress. That call is gated by
  `InsertProviderEvent` on `(provider_key, provider_event_id)` — if LiveKit's
  webhook retry (on a non-2xx or timeout) redelivers the *same* event id, the
  dedup insert returns `n == 0` and `HandleProviderEvent` returns before ever
  reaching the recording-finish code, so the retry is silently swallowed. If
  LiveKit only emits one `recording_ended`/egress-ended event per egress
  (typical for this kind of webhook), there is no second, distinct-ID event to
  supply the retry the comment assumes, and no reconciler polls PROCESSING FS
  rows (confirmed: no such reconciler exists — `RunWorkers`'s only ticks are
  `ProcessWebhookInbox`, `ReconcileStaleAttendance`,
  `ReconcileProviderDesync`, none of which touch `meeting_recordings`/
  `chat_voice_recordings` status). A transient storage blip during the finish
  window can therefore strand a recording in PROCESSING forever, with no
  operator-visible signal beyond the row's own status. The unit test
  (`TestMeetingRecordingFileServiceStorageDownRetries`) only proves the retry
  *works when a second event does arrive* — it supplies a distinct
  `ProviderEventID` by hand, so it does not exercise (or catch) the redelivery
  scenario above.
- **severity**: medium — no data corruption or wrong-tenant exposure, but a
  plausible user-visible stuck recording with no built-in recovery path.
- **fix owner**: BE / Advisor — confirm LiveKit's webhook retry semantics
  (same event id vs. new id on redelivery) before T9c; if redelivery reuses
  the id, either add a sweep for PROCESSING FS rows past their reservation
  deadline, or don't let the provider_event_id dedup suppress a retry attempt
  on a non-terminal row.

### F2 — [low] Finish path branches on current wiring, not on how the row was written
- **file:line**: `server/internal/service/meeting_ai.go:520-523` (`s.files != nil && rec.FileID.String != ""`),
  `server/internal/service/chat_voice_recording.go:223-226` (`f := s.voiceRecordingFiles(); f != nil && rec.FileID.String != ""`).
- **trigger**: A recording is started while FS is wired (row gets `file_id`,
  no `file_url`); before the finish webhook arrives, the process restarts (or
  is redeployed) with FileService unwired, or `SetFiles(nil)`/
  `SetVoiceRecordingFiles(nil)` is called while the row is still
  ACTIVE/PROCESSING.
- **impact**: The finish check is `files-wired AND has file_id`, not just
  `has file_id`. If wiring is off at webhook time, the code falls through to
  the legacy `FinishRecordingByEgress`/`FinishChatVoiceRecordingByEgress` call,
  which *does* pass `FileUrl`. Because the column is `COALESCE(new, old)` and
  old is NULL, this writes `file_url` onto a row that has `file_id` set —
  contradicting "file_url never stored on FS rows" — while the actual bytes
  the provider wrote (into the FileService-reserved key) are never claimed
  through `ClaimInTx`, leaving an orphaned FS reservation FileService itself
  doesn't know is "done." This requires an operational misstep (toggling the
  seam mid-flight) rather than being reachable from normal request handling,
  so it is not a day-one risk, but the invariant as coded is
  wiring-dependent rather than row-dependent.
- **severity**: low — requires an unusual ops sequence; still worth closing
  before `SetFiles`/`SetVoiceRecordingFiles` are ever toggled at runtime (e.g.
  a feature-flag-driven rollout rather than a boot-time constant).
- **fix owner**: BE — key both finish functions off `rec.FileID.String != ""`
  alone; if `s.files`/`voiceRecordingFiles()` is nil in that case, fail loudly
  (log + leave PROCESSING) instead of silently taking the legacy branch.

### F3 — [low] Minor nits, no functional impact
- `NewMeetingRecordingProvider()` (meeting_ai.go:733) is never called;
  `FileReferenceProvider()` (meeting_ai.go:764-766) constructs
  `MeetingRecordingProvider{}` directly. Dead constructor — either wire it in
  or drop it.
- `FakeProvider.RecordErr` (meetings/fake.go:31,90-93) is plumbed into
  `StartRecording` but not set by any test added in this change — currently
  unexercised test-support surface.
- Naming asymmetry: `MeetingRecordingProvider` is exported,
  `chatVoiceRecordingProvider` is not (chat_voice_recording.go:530). Cosmetic.
- `voiceRecordingFileServices` (chat_voice_recording.go:29) is a package-level
  `sync.Map` keyed by `*ChatService` pointer; no test added in this change
  calls `SetVoiceRecordingFiles(nil)` to clear its entry afterward, so each
  test `ChatService` fixture that wires a fake leaves a live map entry (and
  keeps that `*ChatService` reachable) for the rest of the test binary's
  process. Harmless in practice (process exits after `go test` completes) and
  explicitly called out in the code comment as a stopgap for T7's field
  landing — flagging only so the eventual "fold into a plain field" cleanup
  doesn't get missed and, if this pattern is copied elsewhere, doesn't grow
  in a longer-lived process.
- **fix owner**: BE (nice-to-have cleanup, no action required to merge).

## Notes on items already acknowledged in the acceptance packet (not re-raised as findings)

- Non-retryable `CompleteProviderOutput` failures (wrong bytes, over cap,
  rejected type, expired/deleted file) failing the row with "no reconciler
  re-drives stuck recordings" is explicitly called out in
  `reports/t8-migrate/acceptance-packet.md` item 6 — consistent with the code.
- Org-less chat rooms failing FS registration with `recording_not_configured`
  (packet item 5) matches `recordingFileErr`'s mapping of `CodeScopeInvalid`
  in chat_voice_recording.go.
- `.mp4` suffix / key-minting ownership deferred to T3 (packet item 3) matches
  the `outputTargetKey` guard being present but unable to be proven end-to-end
  without the real `files.Service` construction.

## What's left

- F1 needs an answer from whoever owns the LiveKit webhook contract (does a
  redelivery reuse the event id?) before T9c wires a real `files.Service`,
  since that's when storage hiccups during the finish window become a real
  possibility.
- No code changes requested to merge this lane; F1-F3 are follow-ups for the
  Advisor/T9c integrator, not blockers for `3b434165` into the FileService
  root.
