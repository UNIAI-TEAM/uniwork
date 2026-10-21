# Thư ký AI S6 (UNI-2028): phụ đề dịch Việt ↔ Anh — kế hoạch triển khai

> **Trạng thái:** in-progress — kế hoạch; đã gộp chồng B (S1, S2, đợt 5 UNI-2001, S5) vào nhánh này và nối "Ghi nhận đã họp" với tóm tắt tự tạo; S6 đang làm.

**Spec:** `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` §1.3 D11, §5.3 (B9),
§7.1 (`POST /meetings/{meetingID}/agent/translate`), §7.2 (`PUT /meetings/{meetingID}/caption-language`),
§8 (`caption_translate@1` / `caption_translate`), §10 (chọn ngôn ngữ phụ đề), §12 dòng S6, §12.1.
Cờ `meeting_caption_translate` (review_at 2027-01-18). Nhánh này cũng là nhánh tích hợp cuối của
chương trình UNI-1995.

## Mục tiêu

Người trong phòng (cả khách) chọn phụ đề Gốc / Tiếng Việt / English. Server đặt attribute
`uw.caption_lang` cho đúng participant đó; agent thấy có người cần ngôn ngữ L khác ngôn ngữ của
đoạn thì gom đoạn final (≤ 1 giây), gọi `/agent/translate`, phát bản dịch lên `uw.caption.<L>`
cùng `uw.segment_id`. Bản dịch không lưu. Trần 1 lần gọi mỗi giây mỗi ngôn ngữ mỗi cuộc họp, giữ
ở cả agent lẫn server.

## Việc

1. **Server — AI.** Capability `caption_translate` (model nhanh), prompt `caption_translate@1`
   (giữ tên riêng và thuật ngữ trong danh sách từ khóa, không thêm ý; lời nói trong
   `<untrusted>`), `ParseCaptionTranslateJSON`. Golden mới trong `TestPromptSnapshots`.
2. **Server — dịch.** `MeetingService.AgentTranslate`: token agent → cuộc họp + lần chạy; bỏ qua
   lặng lẽ (trả `skipped`) khi lần chạy đã đóng, cờ tắt, gói thiếu `meeting.ai_summary`, AI chưa
   cấu hình, vượt trần 1/giây, hết tín dụng AI. Danh sách từ khóa lấy từ ngữ cảnh cuộc họp
   (`AgentContext`). Test DB: dịch đúng nhãn, đúng usage; từng kiểu bỏ qua; trần.
3. **Server — chọn ngôn ngữ.** `MeetingService.SetCaptionLanguage`: người đang trong phòng (thành
   viên hoặc khách), cuộc họp đang diễn ra; `lang` ∈ {"", vi, en}; chọn vi/en khi tính năng không
   có thì 404 `feature_disabled` (gói thiếu → 403 `entitlement_required`); đặt attribute qua
   `SetParticipantAttributes`. Test với adapter giả (§12.1).
4. **Server — HTTP.** SDI/SDO, route agent (`registerMeetingAgent`) và route trong phòng
   (`registerPublicMeetings`, budget `joinLimit`), lớp isolation (`isoRoutes`,
   `CaptionSegmentSDI.segment_id` miễn trừ như `AgentSegmentSDI.segment_id`), cờ trong `keys.go`.
5. **Agent (Python).** `scribe/translate.py`: đọc `uw.caption_lang` của mọi người, gom final theo
   ngôn ngữ đích ≤ 1 giây, trần 1 lần/giây/ngôn ngữ, gọi `/agent/translate` không thử lại, phát
   `uw.caption.<L>`. pytest cho gom lô và trần; ruff.
6. **Web.** Endpoint `setCaptionLanguage` + test phản hồi sai định dạng; hook; lớp phụ đề có bộ
   chọn Gốc / Tiếng Việt / English, đọc topic của ngôn ngữ đã chọn, thiếu bản dịch thì hiện bản gốc;
   tắt phụ đề thì trả về Gốc. i18n vi rồi en.

## Quyết định

Ghi đủ trong báo cáo `.superpowers/reports/UNI-2028-report.md` dưới dạng
`Decision: cái gì — vì sao — giá nếu sai`.
