# FollowUps — triage tin nhắn thành việc phải làm (C-13.6 / UNI-512)

> **Ngày:** 2026-09-11
> **Trạng thái:** in-progress
> **Spec liên quan:** `2026-09-09-chat-work-hub-design.md` (lát 3 message↔task)
> **Tham chiếu:** UNI-512, F-07 notifications, flag `chat_work_hub`

## Mục tiêu

Cho phép mỗi người đánh dấu một tin nhắn (hoặc root thread) thành FollowUp cá nhân — có ghi chú, hạn, trạng thái — xem danh sách của mình, chuyển thành task, và thấy FollowUp trong inbox thông báo sẵn có (không mở hộp thư thứ hai).

## Phạm vi

- Trong: CRUD FollowUp theo `user_id` + `message_id`; list theo workspace; complete/reopen; convert → `CreateTaskFromMessage`; notification kind `chat_follow_up` khi tạo; UI action trên tin + sheet danh sách trong chat; deep link inbox → `/chat`.
- Ngoài: scheduler nhắc due (chờ jobs), FollowUp nhóm/shared, UI mobile, ack Posts.

## Quyết định đã chốt

| # | Quyết định |
|---|------------|
| 1 | Bảng `chat_message_follow_ups`; unique `(user_id, message_id)` |
| 2 | Neo `message_id` (thread = root id phía client) |
| 3 | Open/done qua `completed_at` (null = open) |
| 4 | Flag `chat_work_hub` (cùng lớp work hub) |
| 5 | Inbox: outbox `chat.follow_up.created` → kind `chat_follow_up` (vẫn gửi cho actor) |
| 6 | Convert task = gọi API lát 3 rồi đánh dấu done |

## Data model

`chat_message_follow_ups`: id, organization_id, workspace_id, room_id, message_id, user_id, note, due_at, completed_at, created_by, created_by_kind, created_at, updated_at. Indexes CONCURRENTLY riêng.

## API

- `GET /workspaces/{ws}/chat/follow-ups`
- `POST /workspaces/{ws}/chat/messages/{messageID}/follow-ups` body: note?, due_at?
- `PATCH /workspaces/{ws}/chat/follow-ups/{id}` body: note?, due_at?, completed?
- `DELETE /workspaces/{ws}/chat/follow-ups/{id}`
- `POST /workspaces/{ws}/chat/follow-ups/{id}/task` → tạo task từ message rồi complete

## Sự kiện

`chat.follow_up.created|updated|completed|deleted` — payload ids only (`follow_up_id`, `workspace_id`, `room_id`, `message_id`, `user_id`).

## FE

`packages/core/chat` endpoints/hooks; `chat-message-hover-actions` + sheet list; inbox kind + href chat.

## Kiểm thử

Service create/list/complete; notification rule; endpoint schema fallback; UI action smoke.
