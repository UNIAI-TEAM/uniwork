# AI trong chat — CatchUp, Ask theo kênh (C-13.7 / UNI-513)

> **Ngày:** 2026-09-11
> **Trạng thái:** in-progress — Đề xuất, triển khai MVP dưới `GATE_LEVEL=fast`
> **Spec liên quan:** `2026-09-09-chat-work-hub-design.md` §8; `2026-09-04-ai-platform-gateway-design.md` (F-09); ADR 0010
> **Tham chiếu:** UNI-513, F-09, F-10/A-01 (defer), flag `chat_work_hub`

## Mục tiêu

Cho người dùng **bắt kịp** kênh/thread từ mốc đọc cuối (CatchUp) và **hỏi UNI** ngay trong ngữ cảnh phòng/thread đang mở — chỉ từ tin nhắn họ được đọc, trả lời có trích dẫn, metering `ai.tokens` qua gateway F-09.

## Phạm vi

### Trong (MVP lát này)

- CatchUp: `POST …/ai/chat/catch-up` — tóm tắt + điểm nổi bật + gợi ý action item (không tự tạo task).
- Ask UNI focus mở rộng: `focus.kind` ∈ `task` | `meeting` | `room` | `thread` | `message`.
- UI: nút CatchUp + “Hỏi về phòng này” trên header hội thoại (khi AI enabled).
- i18n `chat.ai.*` + cập nhật mô tả focus SDI.

### Ngoài phạm vi MVP (lát sau / phụ thuộc A-01)

- Bảng `action_proposals` / `agent_action_proposals` và luồng đề xuất → người duyệt → execute (ADR 0010 đầy đủ).
- Agent là thành viên kênh, trả lời khi `@mention`.
- Persist CatchUp vào DB; scheduler CatchUp hàng ngày.
- Tóm tắt cuộc gọi trong chat (C-13.8 / UNI-514).

**Gợi ý action item ở MVP:** model trả JSON; FE hiện danh sách; người bấm → gọi `CreateTaskFromMessage` / dialog tạo task sẵn có (actor = human → hợp lệ ADR 0010).

## Quyết định đã chốt

| # | Quyết định |
|---|------------|
| 1 | Không bảng mới; CatchUp ephemeral trong response |
| 2 | Capability gateway mới `chat_catchup` (meter cùng `ai.tokens`) |
| 3 | CatchUp dùng `chat_room_members.last_read_at`; public không join → cửa sổ 48h gần nhất |
| 4 | Trần ngữ cảnh: ≤100 tin / ≤12k token (reuse `BuildContext`) |
| 5 | Cùng flag `chat_work_hub` cho UI chat; Ask/CatchUp vẫn tắt khi `capabilities.enabled=false` |
| 6 | Agent-in-channel và proposals đầy đủ → A-01 / lát sau |
| 7 | Không thêm cột `ai_*` trên bảng chat (giữ §8 work-hub) |

## Data model

Không migration. Dùng: `chat_room_members.last_read_at`, `chat_thread_followers.last_read_at`, `ListChatMessagesAfterInRoom`, `ListChatThreadMessages`, `ai_usage_events`.

## API

### CatchUp

`POST /api/v1/workspaces/{workspaceID}/ai/chat/catch-up`

**SDI:** `{ room_id, thread_root_id?, locale? }`

**SDO:** `{ summary, highlights[], action_items[{title, owner?, due?, source_message_id?}], message_count, since, usage{input_tokens, output_tokens} }`

**Lỗi:** 404 phòng/thread; 403/404 theo `authorizeRoomRead`; 402 quota; 429 rate; 503 `ai_disabled`; 200 + summary “không có tin mới” khi 0 tin.

### Ask UNI (mở rộng)

`focus.kind`: thêm `room` | `thread` | `message` (id = room_id / thread_root_id / message_id). Focus ưu tiên trong `Sources()`; vẫn có thể lẫn search workspace.

## Sự kiện

Không outbox bắt buộc (đọc + tóm tắt ephemeral). Usage vẫn qua `ai.usage.updated` của gateway.

## Quyền

Mọi đọc tin qua `ChatService.authorizeRoomRead` / thread list đã có — không đọc tin ngoài quyền người gọi. Public channel đọc được mà chưa join: CatchUp theo cửa sổ 48h, không lộ `last_read` của người khác.

## FE file map

- `packages/core/types/ai.ts` — focus + CatchUp schemas
- `packages/core/api/endpoints/ai.ts` (+ test malformed)
- `packages/core/ai/hooks.ts` — `useChatCatchUp`
- `packages/views/chat/chat-catch-up-sheet.tsx` — sheet kết quả
- `packages/views/chat/chat-conversation-header.tsx` — nút CatchUp / Ask room
- `packages/core/i18n/locales/{vi,en}.json` — `chat.ai.*`

## Kiểm thử bắt buộc

- Go: CatchUp 0 tin; CatchUp có tin; focus room chỉ lấy tin phòng đó; non-member private → not found; gateway disabled → 503.
- Core: malformed CatchUp/ask focus fallback hoặc throw đúng chỗ.
- Views: header hiện nút khi enabled; sheet render summary + action items.

## Kế thừa / bỏ

Kế thừa Ask UNI panel ⌘J (không thay). Không bỏ endpoint nào.

## Câu hỏi mở

1. CatchUp có đánh dấu đã đọc phòng sau khi xem không? MVP: **không** (người tự cuộn).
2. Có lưu CatchUp vào `ai_conversations` không? MVP: **không**.
