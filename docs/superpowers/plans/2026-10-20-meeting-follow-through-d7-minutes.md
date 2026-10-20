# Đợt 7 (UNI-2003): biên bản là trang UniNote — kế hoạch triển khai

> **Trạng thái:** in-progress — kế hoạch ngày 2026-10-20; đã làm xong trên nhánh `feature/UNI-2003-meetings-sau-hop-dot-7-bien-ban-la-trang` (xếp trên UNI-2002 → UNI-1999 → UNI-1998 …): cột biên bản, `renderMinutes`, lập/chốt/bỏ chốt trong một giao dịch, bốn route sau cờ `meeting_minutes`, mục Biên bản trên trang cuộc họp, dòng hệ quả ADR 0016; chờ review và merge.

**Mục tiêu:** Clerk lập biên bản của một cuộc họp đã kết thúc thành một trang UniNote: số liệu dựng từ bảng, diễn giải lấy từ tóm tắt mới nhất; chủ trì và thư ký được sửa; "chốt" là một phiên bản tài liệu mà cuộc họp ghi id; bỏ chốt giữ lịch sử. Spec: `docs/superpowers/specs/2026-10-20-meeting-follow-through-design.md` §1.1 G9, §1.3 D12, §4, §5.2, §6.6, §7.6, §8.1, §8.2, §9.2 mục 4, §10, §12 dòng 7, §13.1 đợt 7, §14 Q1.

## Tệp

- Migration `999…_meeting_minutes` (bốn cột NULL trên `meetings`); query đặt/xoá các cột trong `meetings.sql`.
- Document service: `CreateSharedPageInTx` (trang ở gốc workspace, cả workspace `view`, người được chia `edit`; dùng chung phần chèn trang với `CreatePage`), `LockPageForEditInTx` + `CreateDocumentVersionInTx` (dùng chung thân với `CreateDocumentVersion`), `LevelFor`.
- Meeting service: `meeting_minutes.go` (đọc trạng thái, lập, chốt, bỏ chốt), `meeting_minutes_render.go` (`renderMinutes(facts, narrative, layout)` thuần, layout vi/en).
- API: `GET /meetings/{meetingID}/minutes`, `POST …/minutes` `{locale?}`, `POST …/minutes/finalize`, `POST …/minutes/reopen`, sau cờ `meeting_minutes`.
- Audit `meeting.minutes_created|finalized|reopened`; sự kiện `minutes.created|finalized|reopened` (ba catalogue); dòng thời gian `MINUTES_FINALIZED`.
- Core: `api/endpoints/meeting-minutes.ts` + test sai định dạng; `meetings/minutes-hooks.ts`; `meetingKeys.minutes`; realtime `minutes.*`.
- Views: `meetings/meeting-minutes-section.tsx` (Lập, chip Nháp/Đã chốt, xem bản đã chốt, cảnh báo đã sửa sau khi chốt, Chốt/Bỏ chốt); i18n vi → en.
- ADR 0016: một dòng hệ quả (§14 Q1).

## Việc và test chứng minh

1. `renderMinutes` — `TestRenderMinutes` golden cho đủ dữ liệu; không điểm danh chốt; không biểu quyết; không tóm tắt; tiếng Anh. Phiếu kín không tên, không có dòng hình thức/địa điểm.
2. Lập — `TestCreateMinutes` (DB): chủ trì và thư ký `edit`, thành viên khác `view`, người lập `manage`; cột `minutes_document_id`; audit + outbox cùng giao dịch; cuộc họp chưa `ENDED` → 409; đã có → 409 `minutes_exist`; trang vào thùng rác → lập lại được; thành viên thường → 403.
3. Chốt / bỏ chốt — `TestFinalizeMinutes`: tạo đúng một phiên bản và ghi id; chốt lại sau khi sửa thay id; thiếu `edit` → 403 `minutes_edit_required`; bỏ chốt xoá cột, phiên bản còn trong lịch sử; "đã sửa sau khi chốt".
4. HTTP + cờ — test handler; `TestIsolationMatrix`, `audit_coverage_test.go`, `scripts/events-catalogue.test.mjs`, lint migration, `TestEveryQueryNamesItsTenant`.
5. Core — `meeting-minutes.test.ts` (đúng dạng, sai dạng → null).
6. Views — `meeting-minutes-section.test.tsx` (chưa có → Lập; nháp → Chốt; đã chốt → chip, Bỏ chốt, cảnh báo đã sửa; không phải clerk → chỉ đọc).

## Quyết định

- Trạng thái biên bản đọc ở route riêng `GET …/minutes` (không nhét vào `MeetingDTO`): cần đọc trang và phiên bản để biết trang còn sống và "đã sửa sau khi chốt"; `minutes.*` làm mới query đó.
- "Đã sửa sau khi chốt" = `documents.content_saved_at` mới hơn `created_at` của phiên bản đã chốt (chỉ nội dung, đổi tiêu đề không tính).
- Chốt khi nội dung chưa đổi so với phiên bản gần nhất: ghi id phiên bản đó, không tạo phiên bản mới.
- Chưa có biên bản còn sống mà chốt/bỏ chốt → 409 `minutes_missing`.
- Cột `partial` (§7.8) chưa có trên nhánh này: bỏ ghi chú "tóm tắt dựa trên một phần cuộc họp".
- Kết quả biểu quyết chỉ nêu số phiếu và kết quả, không nêu tên người bỏ phiếu ở mọi chế độ.
- Nút xuất DOCX/PDF không làm ở đây (UNI-2004): mục Biên bản mở trang, menu của trang xuất khi #374 vào.
