# Meeting — nâng cấp lên đẳng cấp thế giới (D08b)

Ngày: 2026-08-29. Nền: D08a (control plane + LiveKit) đã xong. Tài liệu này chốt
những gì D08b làm, làm ở đâu, và những gì cố ý để lại.

## Mục tiêu

Đóng khoảng cách với Meet/Zoom về trải nghiệm trong phòng, và vượt họ ở điểm
duy nhất phù hợp `PRODUCT.md`: **AI ghi biên bản → việc cần làm thành task**.

## Phạm vi (theo thứ tự triển khai)

### 1. Trong phòng họp — lớp cộng tác (data channel, không cần server)

Tất cả đi qua LiveKit data channel, topic `uw.signal`, payload JSON
`{ kind, from, target?, value? }`:

| kind | Ai gửi | Hiệu ứng |
| --- | --- | --- |
| `hand` | ai cũng được | `value: true/false`; tile hiện ✋, sidebar sắp người giơ tay lên đầu |
| `reaction` | ai cũng được | emoji nổi lên trên tile 3s (👍 ❤️ 😂 🎉 👏) |
| `mute_request` | host/admin | client đích tự tắt mic (giống Meet: người bị tắt vẫn tự bật lại được) |

Hooks: `packages/views/meetings/use-meeting-signals.ts` (state `hands`,
`reactions`, gửi qua `useDataChannel("uw.signal")`). Không lưu DB. Không
metadata participant (tránh round-trip server).

Layout: `meeting-conference.tsx` ưu tiên **share screen → người đang nói →
còn lại**, tối đa 9 tile/trang, phân trang bằng nút ‹ › (`useSpeakingParticipants`
+ `useTracks`). Hàm thuần `orderTracks()` có test.

### 2. Transcript trực tiếp + tóm tắt AI + tạo task

- Caption: client dùng Web Speech API (`SpeechRecognition`, `lang` theo i18n:
  `vi-VN`/`en-US`). Mỗi câu final → `POST /meetings/{id}/transcript`
  `{ text, spoken_at }`. Overlay caption dưới stage; toggle trong control bar.
  Chrome/Edge/Safari hỗ trợ; trình duyệt không hỗ trợ ẩn nút.
  *Lý do:* không cần STT server, không cần Egress/S3, chạy được ngay.
  Nâng cấp sau: LiveKit Agents + STT server-side khi cần độ chính xác cao.
- Bảng `meeting_transcript_segments(id, meeting_id, participant_id, speaker_name,
  text, spoken_at, created_at)`; index CONCURRENTLY `(meeting_id, spoken_at)`.
- `GET /meetings/{id}/transcript` — mọi thành viên workspace.
- `POST /meetings/{id}/summary` — host/admin, meeting IN_PROGRESS hoặc ENDED.
  Server gom transcript + notes + chat (nếu client gửi) → Claude
  (`claude-opus-5`, Go SDK `anthropic-sdk-go`, tool `record_meeting_summary`
  ép JSON) → lưu `meeting_summaries(id, meeting_id, summary, decisions JSON,
  action_items JSON, model, created_by, created_at)`. Trả bản mới nhất.
  `GET /meetings/{id}/summary` đọc bản mới nhất.
- `POST /meetings/{id}/summary/tasks` `{ items: [{title, assignee_id?}] }` →
  `TaskService.Create` từng item, description `"Từ cuộc họp: <title>"`.
  Trả danh sách task id.
- Không có `ANTHROPIC_API_KEY` → 503 `ai_not_configured`; UI ẩn nút.
- Sự kiện realtime: `transcript.appended` (id-only) → invalidate
  `meetingKeys.transcript`; `summary.created` → `meetingKeys.summary`.

### 3. Ghi hình (LiveKit Egress)

- Provider port thêm `StartRecording(room) (egressID)` / `StopRecording(egressID)`.
  LiveKit adapter dùng `EgressClient.StartRoomCompositeEgress` ghi file MP4 vào
  S3 (`AWS_*` đã có trong `.env.example`). Fake provider đếm gọi.
- Bảng `meeting_recordings(id, meeting_id, egress_id, status, file_url,
  started_by, started_at, ended_at)`.
- `POST /meetings/{id}/recording/start|stop` — host/admin. `End` meeting tự
  stop mọi recording ACTIVE. Webhook `egress_ended` cập nhật `file_url`, status.
- Control bar: nút ghi (host), badge 🔴 REC cho mọi người.
- Egress chưa cấu hình (`LIVEKIT_EGRESS_S3_BUCKET` trống) → 503, UI ẩn nút.

### 4. Vòng đời & lịch

- Worker `RunAutoEnd` (cùng goroutine outbox, mỗi 60s): meeting IN_PROGRESS
  có `ends_at + 2h < now` và không có attendance mở → `End` với actor
  `system`. Audit `MEETING_AUTO_ENDED`.
- `GET /meetings/{id}/calendar.ics` — file iCalendar chuẩn RFC 5545 (stdlib
  `text/template` không cần lib). Nút "Thêm vào lịch" ở detail.

### 5. Kiểm chứng & vận hành

- Prometheus: `uniwork_meetings_total{event=started|ended|auto_ended}`,
  `uniwork_meeting_join_decisions_total{decision}`,
  `uniwork_meeting_summaries_total{outcome}`.
- E2E `e2e/meetings.spec.ts`: tạo → mời → RSVP → start → detail hiện
  IN_PROGRESS → end → ICS tải được. Không cần LiveKit.
- Go test: transcript append/list, summary với fake AI client, auto-end, ICS.
- FE test: `orderTracks`, signals reducer, endpoints malformed-response.

## Cố ý để lại (ngoài D08b)

- Recurring meeting + đồng bộ Google Calendar hai chiều (cần OAuth scope mới).
- Guest cookie hoàn thiện + mobile native.
- STT server-side worker (LiveKit Agents) — ingestion API + `server_stt` capability đã land; xem `2026-09-08-meeting-stt-agents-evaluation.md`.
- Breakout room; caption dịch.

**Đã ship sau D08b:** chat persist (`meeting_chat_messages`, `POST/GET .../chat`); role `AUDIENCE` + host mute cứng qua `UpdateParticipant` (`POST .../participants/{id}/publish`); proactive JWT refresh trên client.

## Ranh giới không đổi

LiveKit vẫn không quyết định lifecycle. Mọi bảng mới: ULID TEXT, không FK,
index CONCURRENTLY một file. Mọi query lọc qua `authorize()` của meeting
(`workspace_id` + `RequireMember`).
