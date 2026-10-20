# Thư ký AI S1 (UNI-2023): thư ký AI nền — kế hoạch triển khai

> **Trạng thái:** in-progress — đủ 5 lớp trên nhánh `feature/UNI-2023-meetings-thu-ky-ai-s1-thu-ky-ai-nen-ghi-lo` (ADR, migration, server, agent + CI + deploy, web; e2e có cổng `E2E_SCRIBE=1`); chưa chạy thật với LiveKit + agent + AssemblyAI, chờ review và merge.

**Spec:** `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` §1.3, §3, §4.1,
§4.2, §4.6, §6.1, §6.2 (`scribe_off_at/_by`, cột segment), §7.1, §7.2 (`PUT /scribe`,
capabilities), §9, §10, §12 dòng S1, §12.1; spec cha §5.4, §7.8. Số liệu S0:
`2026-10-20-meeting-scribe-agent-s0-results.md`.

## Mục tiêu

Mỗi cuộc họp online của tổ chức có quyền gói có một agent `uniwork-scribe` vào phòng, ghi
lời từng người (đoạn final lưu DB, chống trùng), phát phụ đề `uw.caption` cho cả phòng,
dùng từ khóa theo ngữ cảnh; server gọi agent, cấp token theo cuộc họp, đo phút vào gói
`meeting.transcription`. Client đọc phụ đề của agent, lọc agent theo kind `AGENT`, quay về
Web Speech khi không có agent.

## Lớp và việc (mỗi lớp một commit)

1. **ADR + docs.** ADR 0037 (agent gọi STT trực tiếp, LLM qua `ai.Gateway`, agent không ghi
   bảng nghiệp vụ); dòng luật trong `CLAUDE.md` mục Audit and Events; guard trong
   `scripts/governance.test.mjs`: `apps/meeting-agent/requirements.txt` không có SDK LLM.
2. **Migration + query.** `meeting_scribe_runs` (+ index `(meeting_id, created_at)`,
   unique `(meeting_id) WHERE status IN ('DISPATCHED','ACTIVE')`); `meetings.scribe_off_at/_by`;
   cột segment (`source`, `client_segment_id` + unique, `start_ms`, `end_ms`,
   `speaker_label`, `language`, `transcription_id`); `meeting_summaries.partial`; feature
   `meeting.transcription` (quota, phút, accumulate) cho các gói. Test: lint migration,
   `TestEveryQueryNamesItsTenant`.
3. **Server.**
   - `internal/meetings/agent_token.go`: token `uwma_` ký HMAC-SHA256 bằng
     `MeetingRuntime.HMACKey` (= `JWT_SECRET`, cùng khóa cookie khách), có `meeting_id`,
     `organization_id`, `run_id`, hạn = max(giờ kết thúc dự kiến, bây giờ) + 4 giờ. Test: ký/kiểm,
     sai chữ ký, hết hạn.
   - `middleware.RequireMeetingAgentToken`: không có `Bearer uwma_` → 401; sai/hết hạn/khác
     `{meetingID}` → 404. Route `/meetings/{meetingID}/agent/started|context|segments|finished`
     trong wrapper `api` (SDI/SDO), nhóm riêng ngoài `RequireAuth`; rate limit `meeting-agent`
     600/phút theo token; bỏ qua limiter toàn cục như `/mcp`. Test handler: 404/401, token
     tổ chức A không đọc/ghi cuộc họp tổ chức B; isolation matrix.
   - `ConferenceProvider.DispatchScribe/RemoveScribe` (LiveKit `AgentDispatchClient` +
     `RemoveParticipant`; fake đếm lần gọi).
   - `ensureScribe` (`meeting_scribe.go`): gọi sau `ensureProviderSession` ở Bắt đầu / Họp tức
     thì và vòng quét 15 giây trong `RunWorkers`. Test: không gọi khi phòng trống / tắt / hết
     phút / cờ tắt; hai lần gọi đồng thời chỉ một dispatch; phòng trống > 60 s → run FINISHED,
     có người lại → run mới; 3 lần không ACTIVE sau 60 s → FAILED, thử lại sau 10 phút.
   - Agent API: `AgentStarted`, `AgentContext` (từ khóa: tiêu đề, tên người, dự án,
     workspace, locale; không email), `AppendAgentSegments` (≤ 50 đoạn, ≤ 4.000 ký tự, chống
     trùng `(meeting_id, client_segment_id)`, `start_ms/end_ms`, cộng `speech_ms`, nhận khi
     `IN_PROGRESS` hoặc `ENDED` ≤ 10 phút), `AgentFinished`. Xoá `AppendTranscriptFromAgent`,
     route `/transcript/agent`, `MEETING_STT_AGENT_SECRET`.
   - Hạn mức: `meeting.transcription` đo phút bằng `RecordUsage` (không từ chối; cảnh báo
     80/100% qua `quota.threshold` sẵn có), kiểm còn phút khi mở run.
   - `PUT /meetings/{id}/scribe {enabled}` (chủ trì/admin): `scribe_off_at/_by`, audit
     `meeting.scribe_toggled`, sự kiện `scribe.updated`; tắt giữa chừng thì gỡ agent.
   - Capabilities `scribe` thay `server_stt`; chi tiết cuộc họp có `scribe_enabled`,
     `scribe_status`.
   - Cờ `meeting_scribe` (review 2027-01-18); env `MEETING_SCRIBE_ENABLED`,
     `MEETING_SCRIBE_AGENT_NAME`, `MEETING_SUMMARY_MAX_RUNES`.
   - Spec cha §7.8: ngân sách tóm tắt theo cấu hình (mặc định 240.000 ký tự, vừa model 128k token; gateway không cho biết cửa sổ ngữ cảnh), lease tăng theo
     độ dài, `meeting_summaries.partial`.
4. **Agent + CI + deploy.** `apps/meeting-agent/` (Python 3.13, `livekit-agents==1.8.8`,
   `CLAUDE.md`), STT `assemblyai` (`universal-3-6-pro`, `["vi","en"]`, keyterms ≤ 100) hoặc
   `fake`; đóng phiên STT sau 30 s im; pytest với STT giả; ruff. Xoá
   `deploy/meeting-stt-agent/`. Dockerfile, Helm Deployment/HPA/NetworkPolicy,
   `.github/workflows/meeting-agent-verify.yml`, alert + runbook.
5. **Web.** Core: schema capabilities `scribe`, meeting `scribe_enabled/scribe_status`,
   summary `partial`, `setMeetingScribe` + test sai định dạng, hook, realtime `scribe.updated`.
   Views: lớp phụ đề `uw.caption`, lọc kind `AGENT`, chip "AI đang ghi lời" + nút bật/tắt cho
   chủ trì, giữ Web Speech khi không có agent; vitest.

## Quyết định ghi lại trong báo cáo

Token có thêm `run_id` (để đoạn và kết thúc ghi đúng lần chạy); phút đo mỗi khi qua mốc
phút (không chờ 5 phút) và làm tròn lên khi run kết thúc; `dispatched_at` và
`stt_session_ms` là hai cột thêm vào `meeting_scribe_runs`; "phòng có người" = có phiên điểm
danh đang mở; hạn mức gói: Starter 60, Team 1.200, Business 6.000 phút/tháng.
