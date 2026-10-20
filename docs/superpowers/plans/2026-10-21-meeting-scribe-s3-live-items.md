# Thư ký AI S3 (UNI-2025): việc đề xuất ngay trong lúc họp — kế hoạch triển khai

> **Trạng thái:** in-progress — mới có kế hoạch; nhánh `feature/UNI-2025-…` đã gộp hai chồng (A: việc sau họp, căn cứ, biên bản; B: thư ký S1 + S2).

**Spec:** `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` §1.3 D15, §4.4,
§6.1 (con trỏ rút việc — S1 đã thêm cột), §6.2 (`meeting_action_items.source` `LIVE` — CHECK
đã cho phép), §7.1 (`POST /meetings/{meetingID}/agent/extract`), §8, §9, §10, §12 dòng S3,
§12.1; spec cha D6 (việc `LIVE` giữ khi tạo lại tóm tắt). Cờ `meeting_scribe`.

## Mục tiêu

Trong lúc họp, agent hỏi server theo nhịp; server đọc các đoạn lời mới sau con trỏ, hỏi
model qua `ai.Gateway` (`meeting_live_items@1`), thêm việc `LIVE` vào "Việc sau họp" (lọc
trùng tiêu đề với mọi việc của cuộc họp), phát `action_item.created`, dời con trỏ. Copilot
và mục "Việc sau họp" hiện việc đó ngay, nhãn "Trong lúc họp · HH:mm".

## Bước 0 — gộp hai chồng

`git merge origin/feature/UNI-2024-…`; giải xung đột giữ cả hai ý; `make sqlc`; kiểm
migrate, build, vet, test migration, catalogue, governance, typecheck, vitest meetings,
test service của cả hai chồng.

## Việc

1. **AI** (`server/internal/ai`): capability `meeting_live_items` (model `fast`, 1024 token),
   prompt `meeting_live_items@1` (render dùng chung `renderMeetingSummary` @5: tiêu đề, khối
   việc đã có, transcript có nhãn, tất cả trong `<untrusted>`; luật không đoán người, không
   đoán hạn), `ParseLiveItemsJSON` (mảng rỗng là câu trả lời đúng). Test: snapshot golden,
   parser.
2. **Server** (`MeetingService.AgentExtract`, `meeting_scribe_extract.go`): kiểm token/run,
   trạng thái (đang họp hoặc 10 phút xả sau khi kết thúc); cờ `meeting_scribe`, quyền gói
   `meeting.ai_summary`, AI bật — thiếu thì im lặng bỏ qua + metric; trần 20 lần mỗi giờ của
   lần chạy; đọc ≤ 200 đoạn sau con trỏ (con trỏ lớn nhất trong các lần chạy của cuộc họp);
   gọi gateway với actor hệ thống `meeting_scribe`; hết tín dụng AI → bỏ qua + metric; một
   transaction: khóa việc của cuộc họp, dời con trỏ có điều kiện (gọi trùng thì lần sau
   không ghi gì), thêm việc `LIVE` + audit `meeting.action_item_created` + `action_item.created`.
   Route `POST /meetings/{meetingID}/agent/extract` (SDO `created`, `skipped`). Test DB:
   thêm việc + audit + outbox + con trỏ; lọc trùng tiêu đề; trần 20/giờ; hết tín dụng; cờ
   tắt; việc `LIVE` sống qua tạo lại tóm tắt; con trỏ không đọc lại.
3. **Agent** (`apps/meeting-agent`): `scribe/extract.py` `ExtractCadence` (≥ 3 phút và ≥ 15
   đoạn mới, hoặc lặng ≥ 20 giây sau ≥ 5 đoạn; ≤ 20 lần/giờ; thêm một lần khi phòng đóng),
   `UniworkClient.extract` (không thử lại: mỗi lần là một lời gọi model), khóa trong
   `SegmentBatcher.flush` để xả trước khi rút việc không gửi trùng lô. pytest với đồng hồ giả.
4. **Web**: nhãn `LIVE` kèm giờ tạo (`Trong lúc họp · 10:42`); nhãn capability trong cài đặt AI.
   Vitest cho hàng việc.

## Quyết định

Ghi trong báo cáo `.superpowers/reports/UNI-2025-report.md`.
