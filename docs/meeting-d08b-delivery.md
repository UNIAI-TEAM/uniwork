# D08b delivery report — Meeting: world-class gap closure

Spec: `docs/superpowers/specs/2026-08-29-meeting-world-class-design.md`.
Builds on D08a (control plane + LiveKit). Nothing in the lifecycle / admission
boundary changed: LiveKit still never decides meeting state.

## 1. In-room collaboration (no server)

Data-channel topic `uw.signal` (`packages/views/meetings/meeting-signals.ts`):
raise/lower hand (tile badge + sidebar orders hands first), reactions (5 emoji,
3 s bubble), host `mute_request` (target's client mutes itself; they can
unmute, as in Meet). `use-meeting-signals.tsx` is a React context scoped to
the room — client state only, nothing persisted.

Stage order (`conference-layout.ts`): screen share → speaking (most recent
first) → rest, stable; grid / spotlight / sidebar with ‹ › paging.
`orderTracks`, `paginate`, reducer and codec are unit-tested. Host-only
`mute_request` (send gated by `canHost`; receive honours host LiveKit identity).

## 2. Transcript → AI summary → tasks

- Captions: Web Speech API on the client (`meeting-captions.tsx`), language from
  i18n (`vi-VN` / `en-US`). Final sentences → `POST /meetings/{id}/transcript`
  (IN_PROGRESS only). Overlay shows interim text. Button hidden when the
  browser lacks `SpeechRecognition`.
- `POST /meetings/{id}/summary` (host/admin, IN_PROGRESS|ENDED) → `ai.Gateway`
  (`meeting_summarization`; `ANTHROPIC_API_KEY` / other providers) →
  `meeting_summaries` (summary, decisions JSON, action_items JSON, usage_event_id).
  Chat persist is included with transcript and notes. `GET` returns the latest.
  503 `ai_not_configured` without a provider; `GET /workspaces/{id}/meeting-capabilities`
  lets the UI hide the button.
- `POST /meetings/{id}/summary/tasks` creates workspace tasks through
  `TaskService.Create`, description carries "Từ cuộc họp: <title>".
- Detail page: `MeetingSummaryPanel` — summary, decisions, checkable action
  items → "Tạo N việc", collapsible transcript, recordings list.

## 3. Recording (LiveKit Egress)

`ConferenceProvider` gained `StartRecording` / `StopRecording`. LiveKit adapter
uses `RoomCompositeEgress` → MP4 to S3 (`LIVEKIT_RECORDING_BUCKET` +
`AWS_*`). `meeting_recordings` rows: ACTIVE → PROCESSING (stop / meeting end)
→ COMPLETE|FAILED via `egress_ended` webhook (`file_url`). Control bar shows the
record button to hosts only when the capability is on; header shows a REC badge
to everyone.

## 4. Lifecycle & calendar

- `RunAutoEnd` (every 60 s) and `room_finished`: IN_PROGRESS past `ends_at`
  with no ACTIVE conference → ENDED immediately; ACTIVE rooms stay in
  overtime until the host extends/ends, or `ends_at + 2h`. Audit
  `MEETING_AUTO_ENDED`, actor `system`.
- `GET /meetings/{id}/calendar.ics` — RFC 5545 with the join URL
  (`/{org}/{ws}/meetings/{id}`); "Thêm vào lịch" on the detail page.

## 5. Ops & verification

- Prometheus `uniwork_meetings_total{event}`: started, ended, auto_ended,
  summary_ok, summary_error.
- Migrations 037–040 (tables + three CONCURRENTLY indexes, no FKs); 098
  `meeting_summaries.usage_event_id`.
- Go: `TestTranscriptAndSummaryToTasks`, `TestRecordingLifecycle`,
  `TestAutoEndOverdue`, `TestRenderICS`, `TestCalendarICSJoinURL`,
  `TestParseSummaryJSONTolerant`. `make test-go` green.
- FE: endpoint malformed-response cases for every new endpoint, signals
  reducer/codec, layout ordering/paging. `pnpm lint`, `typecheck`, `test` green.
- E2E: `e2e/meetings.spec.ts` (create → ics download → start → summary panel →
  end) — runs without LiveKit or an Anthropic key.

## 6. Deliberately left for later

Recurring meetings + Google Calendar sync, guest cookie completion, native
mobile, breakout rooms. Persisted in-room chat, AUDIENCE role, server-enforced mute,
and proactive JWT refresh landed post-D08b. **User guide (vi):**
[`docs/guides/meeting-ai-tasks.md`](guides/meeting-ai-tasks.md). STT worker:
[`deploy/meeting-stt-agent/`](../deploy/meeting-stt-agent/).
