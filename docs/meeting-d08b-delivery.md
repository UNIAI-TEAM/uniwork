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
first) → rest, stable; 9 tiles per page with ‹ › paging. `orderTracks`,
`paginate`, reducer and codec are unit-tested.

## 2. Transcript → AI summary → tasks

- Captions: Web Speech API on the client (`meeting-captions.tsx`), language from
  i18n (`vi-VN` / `en-US`). Final sentences → `POST /meetings/{id}/transcript`
  (IN_PROGRESS only). Overlay shows interim text. Button hidden when the
  browser lacks `SpeechRecognition`.
- `POST /meetings/{id}/summary` (host/admin, IN_PROGRESS|ENDED) → Claude
  (`server/internal/ai`, Anthropic Go SDK, `ANTHROPIC_API_KEY`,
  `ANTHROPIC_MODEL` default `claude-opus-5`) → `meeting_summaries`
  (summary, decisions JSON, action_items JSON). `GET` returns the latest.
  503 `ai_not_configured` without a key; `GET /workspaces/{id}/meeting-capabilities`
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

- `RunAutoEnd` (every 60 s, in the server shutdown context): IN_PROGRESS
  meetings past `ends_at + 2h` with no open attendance → ENDED, audit
  `MEETING_AUTO_ENDED`, actor `system`.
- `GET /meetings/{id}/calendar.ics` — RFC 5545 with the join URL
  (`/{org}/{ws}/meetings/{id}`); "Thêm vào lịch" on the detail page.

## 5. Ops & verification

- Prometheus `uniwork_meetings_total{event}`: started, ended, auto_ended,
  summary_ok, summary_error.
- Migrations 030–033 (tables + three CONCURRENTLY indexes, no FKs).
- Go: `TestTranscriptAndSummaryToTasks`, `TestRecordingLifecycle`,
  `TestAutoEndOverdue`, `TestRenderICS`, `TestCalendarICSJoinURL`,
  `TestParseSummaryJSONTolerant`. `make test-go` green.
- FE: endpoint malformed-response cases for every new endpoint, signals
  reducer/codec, layout ordering/paging. `pnpm lint`, `typecheck`, `test` green.
- E2E: `e2e/meetings.spec.ts` (create → ics download → start → summary panel →
  end) — runs without LiveKit or an Anthropic key.

## 6. Deliberately left for later

Recurring meetings + Google Calendar sync, guest cookie completion, native
mobile, server-side STT (LiveKit Agents), breakout rooms, persisted chat.
See spec §"Cố ý để lại".
