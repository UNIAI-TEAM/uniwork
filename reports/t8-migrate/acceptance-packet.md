# T8 Acceptance Packet — UNI-746: recording migration to FileService

Lane: `t8-migrate` · Run `run_5c1df2ff658d` · Branch `feature/UNI-746-fs-recording-migrate`
Base: `5291950b` (Gate A0; integration root `118d939a` already an ancestor — no merge needed)
Commit under review: `3b434165`

## Scope

Meeting recordings (`meeting_recordings`) and chat-call recordings
(`chat_voice_recordings`) produced through LiveKit Egress, including playback
routes, service code, provider seam, and the meeting-side FE playability
signal.

## Design (Advisor-approved, msg_748bfa31db3c)

- Wiring-level selectable path: `SetFiles`/`SetVoiceRecordingFiles`; **nil =
  legacy, byte-identical**. No env flag, no implicit fallback.
- `meetings.RecordingOutputTarget` mirrors `files.WriteTarget` in the provider
  seam because `internal/meetings` may not import `internal/files` (arch test
  `TestFilesContractIsALeafCalledOnlyFromTheServiceTier`).
- `OperationID` = server-minted recording row id (egress id does not exist
  until after provider start). Webhook binds `egress_id -> row -> (file_id,
  operation id)`.
- `file_id` nullable on both recording tables; per-row FS/legacy choice on
  finish (row carries `file_id` ⇒ FS claim path).
- Playback through neutral service types; Range via `Open(Offset, Length)`.
- FE playability = `status === "COMPLETE"` (legacy COMPLETE rows always have
  `file_url`; FS COMPLETE rows have a claimed `file_id`).

## One path per request — no dual write

`StartRecording`/`StartVoiceRecording` (`server/internal/service/meeting_ai.go:355`,
`server/internal/service/chat_voice_recording.go:63`):

1. Authorize + validate; mint `recID`.
2. FS wired → `RegisterProviderOutput` (purpose `MeetingRecording` /
   `ChatCallRecording`, tenant scope, `OperationID = recID`,
   `Deadline = now + 24h` — lease must outlive the recording, egress uploads
   at finalize) → build `RecordingOutputTarget`, hold `file_id`.
3. Provider `StartRecording` gets `OutputTarget` (FS) **or** `FilePrefix`
   (legacy). LiveKit writes exactly the reserved key
   (`meetings/livekit.go` `outputTargetKey`: PUT only, unexpired, host/bucket
   must equal the configured recording endpoint, `.mp4` suffix required —
   LiveKit appends an extension to extension-less filepaths, which would land
   bytes beside the reserved object; the decoded key is passed verbatim).
4. Row insert carries `file_id` (FS) or not (legacy). On insert failure the
   chat path stops the egress.

Finish (`finishRecordingFileClaim` meeting_ai.go:543,
`finishVoiceRecordingFileClaim` chat_voice_recording.go:246):

- Row `file_id` set → FS path: `CompleteProviderOutput` verifies the object
  (`OperationID` = row id), then `ClaimInTx` + row → COMPLETE in one tx;
  `recording.ready` published after commit. `file_url` is never stored on FS
  rows; the webhook's provider URL is discarded.
- `RecordingFailed` → row FAILED (non-terminal only); pending output expires
  with its session.
- Retryable = `storage_unavailable`, `file_not_ready` → row stays
  ACTIVE/PROCESSING, a later provider event retries. All other verify
  refusals (wrong bytes, over cap, rejected type, expired/deleted) → row
  FAILED rather than stuck forever (no reconciler re-drives recordings).
- Terminal rows: replay is a no-op (both paths); late success after FAILED
  does not resurrect.
- Row without `file_id` → legacy `FinishRecordingByEgress` + `file_url` —
  unchanged.

## Playback

Service-side, re-authorized per call (`authorizeActiveParticipant` /
`authorizeVoiceSignalRoom`): `ResolveMeetingRecordingPlaybackURL`,
`MeetingRecordingFileSize`, `OpenMeetingRecording` (meeting_ai.go:643+);
`ResolveVoiceRecordingPlaybackURL`, `VoiceRecordingFileSize`,
`OpenVoiceRecording` (chat_voice_recording.go:436+). `ResolveMany`
(ReadPresign, inline disposition) for the URL route; `Open` for the ranged
proxy route.

Handlers (`handler/meeting_ai.go`, `handler/chat_voice.go`,
`handler/recording_playback.go`): row `file_id` + service FS-enabled ⇒ FS
playback; otherwise the legacy `Storage.KeyFromURL` → presign /
`streamRecordingObject` path, header-identical via the shared
`streamRecordingRange` helper (Range math, 206/416 responses unchanged). FS
errors map through `mapServiceError` — no silent fallback to the other store.
Guest list filter: FS rows become visible at COMPLETE+file_id
(`meeting_ai.go:190`).

## Reference providers (FS-C1 §6)

- `meetings.recordings` → `MeetingService.FileReferenceProvider()`
  (`ListMeetingRecordingFileHolds`, purpose `MeetingRecording`).
- `chat.voice_recordings` → `ChatService.VoiceRecordingFileReferenceProvider()`
  (`ListChatVoiceRecordingFileHolds`, purpose `ChatCallRecording`).

Both report `HoldActive` for live rows' `file_id`s.

## Changed files

- `server/migrations/910_recording_file_ids.{up,down}.sql` — nullable
  `file_id` on `meeting_recordings` + `chat_voice_recordings`.
- `911_recording_file_id_idx`, `912_chat_voice_recording_file_id_idx` —
  CONCURRENTLY indexes, one statement per file.
- `server/pkg/db/queries/{meeting_ai,chat_voice_recording}.sql` +
  regenerated sqlc (v1.31.1, pinned).
- `server/internal/meetings/{provider,livekit,fake}.go` —
  `RecordingOutputTarget` seam, LiveKit key decode/validate, fake capture.
- `server/internal/service/{meeting,meeting_ai,chat_voice_recording}.go` —
  FS start/finish/playback, reference providers, `sync.Map` chat seam.
- `server/internal/handler/{meeting_ai,chat_voice,recording_playback}.go` —
  per-row playback cutover, guest filter.
- `packages/views/meetings/{meeting-list-recording-button,meeting-room-copilot-tab,meeting-room-files-tab,meeting-summary-panel}.tsx` —
  playability = `status === "COMPLETE"`. `chat-voice.ts` needed no change
  (already keyed on `recording_status`).
- `server/internal/service/meeting_recording_fs_test.go` — new filesfake suite.

## Evidence

Run with `GOCACHE/GOTMPDIR` on D:, `GOFLAGS=-p=2`, one go command at a time
(host guard msg_93b34455e218), `TEST_DATABASE_URL` = worktree test DB.

- `go build ./... && go vet ./...` — clean (cold cache).
- `go test ./internal/service/ -run 'TestMeetingRecording|TestChatVoiceRecording|TestRecordingReference|TestFinishVoiceRecording' -count=1` — **ok 181s**.
  Covers: FS lifecycle (register→target→provider write→complete→claim→row),
  replay + late-events (failed egress, no resurrection), storage-outage retry
  (row stays PROCESSING, retry completes), legacy byte-identical path,
  chat FS lifecycle + idempotent start, chat failed egress, both reference
  providers.
- `go test ./internal/meetings/ ./internal/files/... -count=1` — **ok**.
- `go test ./internal/handler/ -run 'Recording|Voice|MeetingList' -count=1` —
  **ok 172s** (Bước 0 regression suite incl. S3 legacy Range + authz).
- `go test ./migrations/ -run 'Lint|Migration'` — **ok**.
- `go test ./internal/` (arch tests incl.
  `TestFilesContractIsALeafCalledOnlyFromTheServiceTier`) — **ok**.

## Legacy branches kept (removal conditions — plan §7 step 8 / T9c)

| Branch | Location | Removal condition |
|---|---|---|
| `FilePrefix` on `StartRecordingRequest`, `filepath = FilePrefix + "-{time}.mp4"` | meetings/provider.go, livekit.go | T9c cutover: when FileService is unconditionally wired, drop `FilePrefix` and the S3 output branch. |
| `file_url` write on finish (`FinishRecordingByEgress`/`FinishChatVoiceRecordingByEgress`) | meeting_ai.go:524, chat_voice_recording.go:227 | T9c: all rows FS-claimed; column dropped after data migration. |
| `file_url` playback (`KeyFromURL` → presign / `streamRecordingObject` S3 branch) | handler/meeting_ai.go, chat_voice.go, recording_playback.go | T9c: no legacy rows remain; streamRecordingRange's S3 closure is deleted with it. |
| Guest filter's `FileUrl.Valid` clause | handler/meeting_ai.go:190 | T9c: every COMPLETE row is FS; filter reduces to status check. |
| `GetMeetingRecordingForPlayback`/`GetVoiceRecordingForPlayback` `file_url` fallback | meeting_ai.go:504, chat_voice_recording.go:420 | T9c: single `file_id` check remains. |
| `patchVoiceCallLogRecording` / `attachVoiceRecordingToCallLog` `recording_url` meta | chat_voice_recording.go | T9c: meta key dropped once clients stop reading it (call-log playback already keys on recording_status). |
| DTO `file_url` field (`toRecordingDTO`, `chatVoiceRecordingDTO`) | handler DTOs | T9c: field removed after FE stops reading it (playability already on status). |

## Integration requests / flags

1. **Wiring**: no real `files.Service` constructor exists in this root
   (contract + filesfake only). When T3 lands: construct once in
   `cmd/server/main.go`, call `meetingSvc.SetFiles(fs)` and
   `chatSvc.SetVoiceRecordingFiles(fs)`, and register both reference
   providers with the registry.
2. **T7 shared-file handoff**: `ChatService` struct is T7-owned; the FS
   handle rides a `sync.Map` sidecar (`voiceRecordingFileServices`) keyed by
   instance. Fold into a plain `files` field when T7's seam lands — setter
   signatures stay.
3. **`.mp4` key suffix**: T3 owns key minting; registry policy 'provider-output
   keys for MeetingRecording and ChatCallRecording end with .mp4' lands after
   t1c. The adapter validates but never mutates the decoded key.
4. **`LIVEKIT_RECORDING_*` env must point at the FileService bucket** — the
   adapter validates the write-target host/bucket against the configured
   recording endpoint, so a mismatch fails `StartRecording` loudly
   (`recording_not_configured`), never silently.
5. **Org-less chat rooms**: `roomOrganizationID`/`roomAnchorWorkspaceID`
   return `""` for nullable room fields; FS mode on such rooms fails
   `RegisterProviderOutput` with `file_scope_invalid` → surfaced as
   `recording_not_configured`. Legacy mode still works. If org-less rooms
   must record under FS, a scope decision is needed (purpose policy or room
   backfill).
6. **Verify-failure = FAILED**: non-retryable `CompleteProviderOutput`
   refusals fail the row because nothing re-drives stuck recordings; a
   reconciler (if added later) may revisit this.
7. **t1c detector**: filesfake currently uses `http.DetectContentType`; my
   tests pass an explicit `video/mp4` content type, so they are green
   today and unaffected by the pending detector swap.

## Stage reports

- Tester (codex gpt-6-luna): _pending_
- BE reviewer (claude claude-sonnet-5): _pending_
- FE reviewer (claude claude-sonnet-5): _pending_
