# Thư ký AI S5 (UNI-2027): tóm tắt phần đã lỡ và Hỏi UNI về cuộc họp — kế hoạch triển khai

> **Trạng thái:** in-progress — đủ server (prompt `meeting_catch_up@1`, route catch-up gom 2 phút qua Redis hoặc bộ nhớ, tool `get_meeting_transcript` ở registry P0 và agent), core (endpoint, hook) và web (thẻ người vào muộn, ô Hỏi UNI trong phòng và trang chi tiết) trên nhánh `feature/UNI-2027-…`; chưa chạy với model thật, chờ review và merge.

**Spec:** `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` §1.1, D10, D17,
§5.1 (B7), §5.2 (B8), §7.2 (catch-up), §8, §10, §12 dòng S5, §12.1. Spec cha
`2026-10-20-meeting-follow-through-design.md` §7.3 (quy tắc nguồn transcript, đã có từ
UNI-2001: `TranscriptSources` + `ListTranscriptSegments*` với `rich`). Không cờ mới.

## Mục tiêu

- B7: thành viên workspace vào phòng muộn ≥ 10 phút so với `actual_start_at` thấy thẻ
  "Bạn vào sau N phút — xem tóm tắt phần đã lỡ" trong copilot; bấm mới gọi
  `POST /meetings/{meetingID}/catch-up`. Server đọc transcript (quy tắc §7.3) và ghi chú từ
  đầu họp, gọi `meeting_catch_up@1` (capability `meeting_catch_up`) qua `ai.Gateway`, mỗi ý
  có mốc giờ trỏ về đoạn lời; kết quả gom theo cuộc họp 2 phút (Redis nếu có, không thì
  bộ nhớ). Khách / người ngoài workspace: 403.
- B8: tool đọc `get_meeting_transcript` (khoảng thời gian, tìm theo từ, ≤ 200 đoạn) cạnh
  `get_meeting_context` (registry P0) và trong registry agent P1; ô "Hỏi UNI" trong copilot
  phòng họp và trang chi tiết gọi Ask UNI có sẵn với `focus {kind: meeting}`; câu trả lời chỉ
  người hỏi thấy; nút "Chia sẻ vào chat cuộc họp" gửi bằng `useAppendMeetingChat`.

## File

- Server: `internal/ai/policy.go`, `internal/ai/prompts.go` (+ golden
  `meeting_catch_up_v1.golden`), `pkg/db/queries/meeting_ai.sql` (một query theo khoảng
  thời gian), `internal/service/meeting_catch_up.go` (+ test), `internal/service/askuni_sources.go`,
  `internal/service/askuni_agent_tools.go` (+ test), `internal/handler/ai.go` hoặc
  `meetings`, `internal/handler/router/meetings.go`, `router.Routes`, SDI/SDO.
- Core: `api/endpoints/meeting-summary.ts` (+ test sai định dạng), `meetings/summary-hooks.ts`,
  `types/meeting.ts`, i18n vi/en.
- Views: `meeting-copilot/meeting-catch-up-card.tsx`, `meeting-copilot/meeting-ask-box.tsx`
  (thay `meeting-copilot-footer.tsx` "sắp có"), `meeting-room-copilot-tab.tsx`,
  `meeting-room-sidebar.tsx`, `meeting-conference.tsx`, `meeting-detail-view.tsx`.

## Việc và test chứng minh

1. Prompt + capability: golden snapshot `TestPromptSnapshots`, `TestSystemPromptsEndWithUntrustedFooter`.
2. Catch-up service: `TestMeetingCatchUp*` — người ngoài workspace 403; cuộc họp chưa bắt
   đầu 409; không nguồn thì không gọi model; năm người gọi (tuần tự và đồng thời) chỉ một
   lần gọi gateway trong 2 phút; mỗi ý có `segment_id` + `spoken_at` của đoạn lời; nguồn
   theo quy tắc §7.3 (có `AGENT` thì bỏ `CAPTION`).
3. Tool `get_meeting_transcript`: `TestAskUniToolsAreReadOnly` (6 tool, đều đọc),
   `TestAskAgentToolsAreReadOnly` (thứ tự mới), test lọc khoảng giờ / từ khóa / trần 200 /
   người ngoài workspace và workspace khác → not_found.
4. Route: `TestIsolationMatrix` / `TestEveryBodyIDFieldHasAReferenceCase`, OpenAPI catalog.
5. Client: test sai định dạng endpoint; vitest thẻ (ẩn khi vào sớm, khách; bấm mới gọi) và ô
   hỏi (gửi focus meeting, chia sẻ vào chat).

## Quyết định

Ghi trong báo cáo `UNI-2027-report.md` (Decision: … — … — …).
