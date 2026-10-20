# Đợt 6 (UNI-2002): căn cứ cho kết luận và việc — kế hoạch triển khai

> **Trạng thái:** in-progress — kế hoạch ngày 2026-10-20, nhánh `feature/UNI-2002-meetings-sau-hop-dot-6-can-cu-cho-ket-lu` (xếp trên UNI-1999 → UNI-1998 …).

**Mục tiêu:** Mỗi kết luận và việc AI đưa ra mang căn cứ: đoạn transcript, ghi chú hay tin nhắn chat có trong đầu vào của lần tóm tắt đó (D11). Người đọc bấm chip căn cứ để xem chính nguồn đó, và mở bản ghi tại đúng giây khi có. Spec: `docs/superpowers/specs/2026-10-20-meeting-follow-through-design.md` §1.3 D11, §5.1, §7.2, §7.8 (gạch cuối), §9.2, §13.1 đợt 6.

## Tệp

- AI: `internal/ai/prompts.go` thêm `meeting_summary@5` (mặc định mới; `@4` vẫn đăng ký), golden `meeting_summary_v5.golden`; `internal/ai/citations.go` (`Decision{text, evidence}` đọc được cả chuỗi lẫn object, `ActionItem.Evidence`); `internal/ai/fake.go` (việc từ ghi chú dẫn nhãn của ghi chú đó).
- Migration `999…_meeting_action_items_evidence` (cột `evidence TEXT NOT NULL DEFAULT '[]'`); query `InsertMeetingActionItem` thêm `evidence`; hai query đọc theo id: đoạn transcript, tin nhắn chat của một cuộc họp.
- Service: `meeting_ai.go` (`Summarize` đánh nhãn chỉ trên dòng thực sự gửi đi), file mới `meeting_evidence.go` (bảng nhãn, giải nhãn, đọc/ghi dạng `[{kind,id}]`, đọc nguồn cho popover), `meeting_summarize.go` (lưu kết luận và việc kèm căn cứ), `askuni_sources.go` / `mcp_tools_meetings.go` (đọc kết luận cả hai dạng).
- API: `GET /meetings/{meetingID}/summary` trả `decisions: [{text, evidence}]`; `GET …/action-items` trả `evidence: [{kind,id}]`; route mới `GET /meetings/{meetingID}/evidence?refs=segment:<id>,note:<id>,chat:<id>` (thành viên, ≤ 20 tham chiếu).
- Core: schema khoan dung cho kết luận (chuỗi hoặc object) và căn cứ; `api/endpoints/meeting-evidence.ts` + test sai định dạng; hook `useMeetingEvidence`.
- Views: chip căn cứ + popover (`meetings/meeting-evidence-chip.tsx`) trên kết luận của tóm tắt và trên dòng "Việc sau họp"; `MeetingRecordingDialog` nhận giây bắt đầu.

## Việc và test chứng minh

1. Prompt `@5` — `TestPromptSnapshots` (golden v5: nhãn `[S1]`/`[N1]`/`[C1]`, dòng "đã lược" không có nhãn), `TestMeetingSummaryInjectionNeutralized` cho `@5`.
2. Parse — `TestParseSummaryJSON*`: kết luận dạng chuỗi và dạng object đều đọc được; căn cứ bị cắt trần.
3. Giải nhãn — `TestResolveEvidenceLabels` (nhãn lạ, trùng, có ngoặc bị loại/chuẩn hoá); `TestSummarizeStoresEvidence` (DB: nhãn không có trong bảng bị loại, việc giữ lại khi mất hết căn cứ, kết luận lưu `[{kind,id}]`); bản cũ dạng chuỗi vẫn đọc (`TestDecodeSummaryDecisions`).
4. Đọc nguồn — `TestMeetingEvidenceSources` (đủ ba loại; id của cuộc họp khác bị bỏ qua; người ngoài 404); `TestIsolationMatrix`.
5. Core — `meeting-evidence.test.ts`, `meeting-summary.test.ts` (kết luận cả hai dạng), `meeting-action-items.test.ts` (căn cứ khoan dung).
6. Views — `meeting-evidence-chip.test.tsx` (mở popover, hiện nguồn, nút "Mở bản ghi tại mm:ss" chỉ khi tính được), test kết luận và dòng việc có chip.

## Quyết định

- Trang chi tiết chưa có mục transcript trên nhánh này, nên chip mở popover hiện chính nguồn; route đọc nguồn mới vì không route nào đọc một đoạn/tin nhắn theo id (feed transcript và chat phân trang theo thời gian).
- Một chip cho mỗi kết luận/việc ("Căn cứ · n"), popover liệt kê các nguồn của nó trong một lần gọi.
- Việc `MANUAL` (và `LIVE` sau này) có căn cứ rỗng.
