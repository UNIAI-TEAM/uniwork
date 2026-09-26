# T8 Migration Tester Report

Revision tested: `49dd74efcffada109597840a8a4b444a26e355` (includes migration commit `3b434165` and the latest meeting-list playability regression test).

## stage_outcome

completed

## test_verdict

pass

All requested focused Go test commands passed. The extra migration lint and meeting-list UI regression test passed; the findings below are nonblocking reliability and test-coverage gaps, not failures in the tested normal paths.

## Evidence

Commands ran sequentially from `server` with `TEST_DATABASE_URL=postgres://uniwork:uniwork@localhost:5432/uniwork_feature_uni_746_fs_recording_migrate_689_test?sslmode=disable`, `GOCACHE=D:/.gocache-worktree746`, `GOTMPDIR=D:/.gotmp-worktree746`, and `GOFLAGS=-p=2`:

- `go test ./internal/service/ -run 'TestMeetingRecording|TestChatVoiceRecording|TestRecordingReference|TestFinishVoiceRecording' -count=1 -timeout 9m` - PASS, 179.918s.
- `go test ./internal/meetings/ ./internal/files/... -count=1` - PASS.
- `go test ./internal/handler/ -run 'Recording|Voice|MeetingList' -count=1` - PASS, 76.359s.
- `go test ./migrations/ -run 'Lint|Migration' -count=1` - PASS.
- `pnpm --filter @uniwork/views exec vitest run meetings/meeting-list-view.test.tsx --coverage.enabled=false` - PASS, 11 tests.

Behavior checks confirmed:

- The meeting and chat FileService paths reserve a provider output, persist `file_id` without `file_url`, pass `OutputTarget` to the fake provider, complete via filesfake, and play back via `ResolveMany` and `Open`.
- FS webhook replay and late success after failed egress are no-ops; failed egress marks the recording failed. Transient filesfake storage failure leaves the row processing and a later distinct event id completes it.
- The no-FileService meeting test asserts no `OutputTarget`, the legacy `FilePrefix`, and `file_url` written on finish. The existing chat recording lifecycle test asserts the legacy `file_url` finish/read behavior; source inspection confirms nil chat FileService passes a nil output target.
- Handler inspection confirms `file_id` rows with FileService enabled return through service playback, while legacy rows use `KeyFromURL` and the S3/storage path. FileService errors return through `mapServiceError` with no fallback. Legacy handler behavior is covered by the passing regression suite, including S3 range behavior.

`@files-smoke` and browser/LiveKit E2E were not run: the worktree API (`localhost:18769`) and frontend (`localhost:13689`) were not running, and this lane's FileService is not wired in `main`. The test package proves service behavior with filesfake; real LiveKit Egress, MinIO, and integrated HTTP FileService playback remain post-integration checks.

## Findings

### F1 - medium: retryable completion error can strand a recording

- **file:line:** `server/internal/service/meeting_queries.go:42`; retryable branches at `server/internal/service/meeting_ai.go:573` and `server/internal/service/chat_voice_recording.go:268`.
- **trigger:** `CompleteProviderOutput` returns `storage_unavailable` or `file_not_ready`, then LiveKit redelivers the same provider event id.
- **impact:** `HandleProviderEvent` deduplicates the event and returns before retrying completion, leaving the row `PROCESSING`; no recording reconciler re-drives it.
- **severity:** medium; user-visible recording remains unavailable after a transient storage fault.

### F2 - low: completion selects the path from current wiring, not the row

- **file:line:** `server/internal/service/meeting_ai.go:520`; `server/internal/service/chat_voice_recording.go:223`.
- **trigger:** a row is created with `file_id` while FileService is wired, then a process handles its finish event with FileService unset.
- **impact:** the legacy finish branch can store `file_url` on that FS row and skip claiming the reserved output, leaving an orphaned file. This requires mixed wiring across a restart or runtime reconfiguration.
- **severity:** low; operational misconfiguration risk before FileService is wired consistently at integration.

### F3 - low: HTTP FileService cutover has no direct handler test

- **file:line:** `server/internal/handler/meeting_ai.go:221`; `server/internal/handler/chat_voice.go:160`.
- **trigger:** the `Recording|Voice|MeetingList` handler suite runs without a fake FileService-backed recording row.
- **impact:** HTTP dispatch from an FS `file_id` row to service playback, and the no-fallback response on an FS read error, are verified by inspection rather than an automated handler assertion.
- **severity:** low; normal service playback behavior is covered in the filesfake suite, while this leaves a cutover regression gap at the handler boundary.
