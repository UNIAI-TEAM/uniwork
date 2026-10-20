# Thư ký AI S4 (UNI-2026): tóm tắt tự tạo khi họp xong — kế hoạch triển khai

> **Trạng thái:** in-progress — đang làm.

**Spec:** `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` §1.3 D16, D18,
§4.5 (A5), §6.2 (`meeting_summaries.created_by_kind`, cài đặt tổ chức `auto_summary`), §8
(`meeting_summary@…`, actor hệ thống), §9 (audit `meeting.summary_created`, kind
`meeting_summary_ready`), §10 (chip "Tóm tắt tự tạo"), §12 dòng S4, §12.1. Spec cha:
nhắc tóm tắt `meeting_summary_reminder` (C-11 §9.1 V1). Không có cờ mới.

## Mục tiêu

Cuộc họp chuyển `ENDED` → sau 10 giây (90 giây hoặc sớm hơn khi agent gọi
`/agent/finished`, nếu lúc kết thúc còn lần chạy thư ký đang mở) worker trong
`MeetingService.RunWorkers` gọi `SummarizeAuto`. Thành công → chủ trì và thư ký nhận
`meeting_summary_ready` thay cho nhắc tóm tắt. Thất bại → nhắc như cũ. Tổ chức tắt được
(mặc định bật).

## Việc

1. **Migration + sqlc.**
   - `meeting_summaries.created_by_kind TEXT NOT NULL DEFAULT 'human'` + CHECK.
   - `meeting_settings` (một dòng mỗi tổ chức, không dòng = mặc định bật), mẫu
     `document_settings`.
   - `meeting_auto_summaries`: hàng đợi bền, một dòng mỗi cuộc họp (`due_at`, `attempts`,
     `lease_until`), xoá khi xong.
   - Query: ghi kind khi lưu tóm tắt; đọc/ghi cài đặt; xếp hàng, nhận việc (`SKIP LOCKED` +
     thuê), xoá, gọi sớm, kiểm còn trong hàng.
2. **Service.**
   - `Summarize` tách thân chung `summarize(ctx, m, actor, locale)`; `storeSummary` nhận
     actor (cột kind, audit, nhật ký cuộc họp).
   - `SummarizeAuto(ctx, meetingID)`: chỉ `ENDED`, chưa có tóm tắt; actor
     `system:meeting_auto_summary`, locale `vi`; chung khóa thuê `meeting_summary_runs`.
   - `endMeeting` xếp hàng trong cùng transaction khi cài đặt bật và tóm tắt AI dùng được;
     `AgentFinished` của cuộc họp đã `ENDED` gọi sớm.
   - Worker `auto_summary` (5 giây, tối đa 4 việc song song mỗi node): nhận một dòng, chạy,
     xoá dòng; không thành công → phát `meeting.auto_summary_failed` (cùng transaction xoá
     dòng) để luật nhắc chạy lại; quá 3 lần nhận (node chết giữa chừng) → bỏ và nhắc.
   - Cài đặt: `GetMeetingSettings`, `SetMeetingAutoSummary` (owner/admin tổ chức, audit
     `meeting.settings_changed`).
3. **Thông báo.** Kind `meeting_summary_ready` (in-app, email, đẩy; tiêu đề vi/en), luật
   `summary.created` → chỉ khi tóm tắt do hệ thống tạo, gửi chủ trì + thư ký là thành viên;
   luật `meeting.ended` im khi cuộc họp còn trong hàng; luật `meeting.auto_summary_failed`
   dùng chung luật nhắc. Link đẩy và link trong app tới mục tóm tắt.
4. **HTTP.** `GET/PUT /orgs/{orgID}/meetings/settings` (SDI/SDO); `created_by_kind` trong
   tóm tắt.
5. **Web.** core: kind mới, schema `created_by_kind`, endpoint + hook cài đặt (test phản hồi
   sai định dạng); views: bảng kind, chip "Tóm tắt tự tạo", tab cài đặt "Cuộc họp"; i18n vi
   rồi en.

## Test chứng minh

- Go DB: `SummarizeAuto` chỉ khi `ENDED`; không trùng với bấm tay (giữ khóa thuê → không
  tạo); `created_by_kind = 'system'` và audit actor hệ thống; kết thúc → xếp hàng (10 s /
  90 s), cài đặt tắt → không xếp hàng; `AgentFinished` gọi sớm; worker chạy dòng đến hạn,
  thất bại phát sự kiện nhắc; cài đặt đọc/ghi + audit + quyền.
- Thông báo: ready tới chủ trì + thư ký, không tới người khác; tóm tắt tay không gửi
  ready; `meeting.ended` im khi trong hàng; sự kiện thất bại → nhắc. `TestKindsMatchClientList`,
  `TestTitles`, `audit_coverage_test.go`, `events-catalogue.test.mjs`, lint migration,
  `TestEveryQueryNamesItsTenant`.
- Vitest: endpoint cài đặt (đúng + sai định dạng), chip, tab cài đặt.

## Quyết định

Ghi trong báo cáo `.superpowers/reports/UNI-2026-report.md`.
