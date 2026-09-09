# Catalogue sự kiện UniWork

> **Trạng thái:** shipped · **Cập nhật:** 2026-09-04 · **Nguồn máy đọc:** `server/internal/outbox/catalogue.go` và `packages/core/types/events.ts`

Bảng dưới là hợp đồng giữa server và mọi client. Ba nơi phải khớp nhau —
file này, `catalogue.go`, `events.ts` — và `scripts/events-catalogue.test.mjs`
đỏ khi lệch. Thêm sự kiện là thêm một dòng ở cả ba nơi.

## Quy tắc

- Tên `<thực thể>.<động từ>`, chữ thường, động từ ở thì quá khứ.
- **Không nhúng phiên bản vào tên.** `event_version` là một cột. Đổi payload theo
  cách phá vỡ thì tăng `v`, consumer switch theo cột, giữ cả hai ít nhất một
  release.
- **Payload chỉ mang id.** Không nội dung, không email, không token. Consumer cần
  nội dung thì đọc lại qua API, nên một sự kiện không bao giờ lộ trường mà người
  đọc không được xem.
- **Phạm vi** quyết định ai nhận: `workspace` (mọi người trong workspace),
  `organization` (mọi kết nối trong tổ chức, dù đang ở workspace nào — danh bạ
  và phòng ban thuộc về công ty, không thuộc một workspace),
  `user` (các kết nối của đúng một người), `chat` (một phòng đã đăng ký),
  `room` (từng thành viên phòng, giải quyết lúc gửi — cần cho sự kiện thành viên
  vì người vừa được thêm chưa đăng ký phòng), `-` (không có client nào nghe).
- **Cách gửi**: `outbox` ghi cùng transaction với thay đổi rồi phát bởi
  `outbox.Dispatcher` — mất process cũng không mất sự kiện. `ephemeral` phát
  thẳng qua socket, không lưu. Tiêu chí cho `ephemeral` chỉ có một câu: **mất thì
  không ai thiệt**. Gõ phím, tín hiệu thoại, một dòng transcript mà dòng sau thay
  thế. Thứ người dùng sẽ hỏi lại sau này thì luôn là `outbox`.

## Bảng

| Topic | v | Payload | Phạm vi | Cách gửi |
| --- | --- | --- | --- | --- |
| `ai.usage.updated` | 1 | `organization_id`, `workspace_id` | workspace | outbox |
| `audit.export_requested` | 1 | `export_id`, `organization_id` | - | outbox |
| `audit.exported` | 1 | `export_id`, `organization_id`, `user_id` | user | outbox |
| `chat.mention.created` | 1 | `room_id`, `message_id`, `sender_id` | user | ephemeral |
| `chat.message` | 1 | `meeting_id` | workspace | ephemeral |
| `chat.message.created` | 1 | `room_id`, `message_id` | chat | ephemeral |
| `chat.message.deleted` | 1 | `room_id`, `message_id` | chat | ephemeral |
| `chat.message.updated` | 1 | `room_id`, `message_id` | chat | ephemeral |
| `chat.room.activity` | 1 | `room_id`, `workspace_id` | workspace | ephemeral |
| `chat.room.created` | 1 | `room_id` | room | outbox |
| `chat.room.member_added` | 1 | `room_id`, `user_id` | room | outbox |
| `chat.room.member_removed` | 1 | `room_id`, `user_id` | room | outbox |
| `chat.room.updated` | 1 | `room_id`, `workspace_id` | workspace | ephemeral |
| `chat.typing` | 1 | `room_id`, `user_id` | chat | ephemeral |
| `chat.voice.accept` | 1 | `room_id`, `user_id` | user | ephemeral |
| `chat.voice.hangup` | 1 | `room_id`, `user_id` | user | ephemeral |
| `chat.voice.invite` | 1 | `room_id`, `user_id` | user | ephemeral |
| `conference.session_ready` | 1 | `meeting_id`, `version` | workspace | ephemeral |
| `flag.updated` | 1 | `flag_key` | - | outbox |
| `host.transferred` | 1 | `meeting_id`, `version` | workspace | outbox |
| `invitation.responded` | 1 | `meeting_id`, `version` | workspace | outbox |
| `invite_link.revoked` | 1 | `meeting_id`, `version` | workspace | outbox |
| `join_request.approved` | 1 | `meeting_id`, `version` | workspace | outbox |
| `join_request.canceled` | 1 | `meeting_id`, `version` | workspace | outbox |
| `join_request.created` | 1 | `meeting_id`, `version` | workspace | outbox |
| `join_request.rejected` | 1 | `meeting_id`, `version` | workspace | outbox |
| `meeting.canceled` | 1 | `meeting_id`, `version` | workspace | outbox |
| `meeting.created` | 1 | `meeting_id`, `version` | workspace | outbox |
| `meeting.deleted` | 1 | `meeting_id`, `version` | workspace | outbox |
| `meeting.ended` | 1 | `meeting_id`, `version` | workspace | outbox |
| `meeting.started` | 1 | `meeting_id`, `version` | workspace | outbox |
| `meeting.updated` | 1 | `meeting_id`, `version` | workspace | outbox |
| `invitation.revoked` | 1 | `organization_id`, `invitation_id` | organization | outbox |
| `member.deactivated` | 1 | `organization_id`, `user_id` | user | outbox |
| `member.invited` | 1 | `organization_id`, `user_id`, `workspace_id` | user | outbox |
| `member.joined` | 1 | `organization_id`, `user_id`, `workspace_id` | user | outbox |
| `member.left` | 1 | `organization_id`, `user_id` | user | outbox |
| `member.reactivated` | 1 | `organization_id`, `user_id` | user | outbox |
| `member.removed` | 1 | `organization_id`, `user_id`, `workspace_id` | user | outbox |
| `member.role_changed` | 1 | `organization_id`, `user_id`, `workspace_id` | user | outbox |
| `notification.created` | 1 | `notification_id`, `user_id` | user | outbox |
| `notification.push` | 1 | `notification_id`, `user_id` | - | outbox |
| `organization.created` | 1 | `organization_id` | user | outbox |
| `organization.updated` | 1 | `organization_id` | user | outbox |
| `organization.suspended` | 1 | `organization_id`, `user_id` | user | outbox |
| `organization.unsuspended` | 1 | `organization_id`, `user_id` | user | outbox |
| `organization.ownership_transferred` | 1 | `organization_id`, `user_id` | user | outbox |
| `profile.updated` | 1 | `organization_id`, `user_id` | organization | outbox |
| `department.created` | 1 | `organization_id`, `department_id` | organization | outbox |
| `department.updated` | 1 | `organization_id`, `department_id` | organization | outbox |
| `department.archived` | 1 | `organization_id`, `department_id` | organization | outbox |
| `people.exported` | 1 | `organization_id`, `user_id` | - | outbox |
| `participant.invited` | 1 | `meeting_id`, `version` | workspace | outbox |
| `participant.removed` | 1 | `meeting_id`, `version` | workspace | outbox |
| `provider.end_session` | 1 | `room_name` | - | outbox |
| `provider.ensure_session` | 1 | `meeting_id`, `room_name`, `session_id` | - | outbox |
| `provider.remove_participant` | 1 | `room_name`, `identity` | - | outbox |
| `quota.threshold` | 1 | `organization_id`, `user_id` | user | outbox |
| `recording.ready` | 1 | `meeting_id` | workspace | ephemeral |
| `recording.started` | 1 | `meeting_id` | workspace | ephemeral |
| `recording.stopped` | 1 | `meeting_id` | workspace | ephemeral |
| `subscription.changed` | 1 | `organization_id`, `subscription_id`, `user_id` | user | outbox |
| `summary.created` | 1 | `meeting_id` | workspace | ephemeral |
| `task.comment_added` | 1 | `task_id`, `comment_id`, `workspace_id` | workspace | outbox |
| `task.comment_updated` | 1 | `task_id`, `comment_id`, `workspace_id` | workspace | outbox |
| `task.comment_deleted` | 1 | `task_id`, `comment_id`, `workspace_id` | workspace | outbox |
| `task.comment_resolved` | 1 | `task_id`, `comment_id`, `workspace_id` | workspace | outbox |
| `task.comment_unresolved` | 1 | `task_id`, `comment_id`, `workspace_id` | workspace | outbox |
| `comment.reaction_added` | 1 | `task_id`, `comment_id`, `workspace_id` | workspace | outbox |
| `comment.reaction_removed` | 1 | `task_id`, `comment_id`, `workspace_id` | workspace | outbox |
| `task.reaction_added` | 1 | `task_id`, `workspace_id` | workspace | outbox |
| `task.reaction_removed` | 1 | `task_id`, `workspace_id` | workspace | outbox |
| `task.subscribed` | 1 | `task_id`, `workspace_id` | workspace | outbox |
| `task.unsubscribed` | 1 | `task_id`, `workspace_id` | workspace | outbox |
| `attachment.uploaded` | 1 | `attachment_id`, `task_id`, `workspace_id` | workspace | outbox |
| `attachment.deleted` | 1 | `attachment_id`, `task_id`, `workspace_id` | workspace | outbox |
| `task.created` | 1 | `task_id`, `workspace_id` | workspace | outbox |
| `task.deleted` | 1 | `task_id`, `workspace_id` | workspace | outbox |
| `task.updated` | 1 | `task_id`, `workspace_id` | workspace | outbox |
| `task_label.created` | 1 | `label_id`, `workspace_id` | workspace | outbox |
| `task_label.deleted` | 1 | `label_id`, `workspace_id` | workspace | outbox |
| `task_label.updated` | 1 | `label_id`, `workspace_id` | workspace | outbox |
| `task_pin.created` | 1 | `pin_id`, `workspace_id` | workspace | outbox |
| `task_pin.deleted` | 1 | `pin_id`, `workspace_id` | workspace | outbox |
| `task_pin.reordered` | 1 | `workspace_id`, `user_id` | workspace | outbox |
| `task_property.created` | 1 | `property_id`, `workspace_id` | workspace | outbox |
| `task_property.updated` | 1 | `property_id`, `workspace_id` | workspace | outbox |
| `task_status.created` | 1 | `status_id`, `workspace_id` | workspace | outbox |
| `task_status.deleted` | 1 | `status_id`, `workspace_id` | workspace | outbox |
| `task_status.updated` | 1 | `status_id`, `workspace_id` | workspace | outbox |
| `task_view.created` | 1 | `view_id`, `workspace_id` | workspace | outbox |
| `task_view.deleted` | 1 | `view_id`, `workspace_id` | workspace | outbox |
| `task_view.updated` | 1 | `view_id`, `workspace_id` | workspace | outbox |
| `task_view_preference.updated` | 1 | `workspace_id`, `user_id`, `scope_id` | workspace | outbox |
| `project.created` | 1 | `project_id`, `workspace_id` | workspace | outbox |
| `project.deleted` | 1 | `project_id`, `workspace_id` | workspace | outbox |
| `project.updated` | 1 | `project_id`, `workspace_id` | workspace | outbox |
| `project_resource.created` | 1 | `resource_id`, `project_id`, `workspace_id` | workspace | outbox |
| `project_resource.deleted` | 1 | `resource_id`, `project_id`, `workspace_id` | workspace | outbox |
| `project_resource.updated` | 1 | `resource_id`, `project_id`, `workspace_id` | workspace | outbox |
| `transcript.appended` | 1 | `meeting_id` | workspace | ephemeral |
| `webhook.deliver` | 1 | `subscription_id`, `event_id` | - | outbox |
| `workspace.created` | 1 | `workspace_id`, `organization_id` | workspace | outbox |
| `workspace.updated` | 1 | `workspace_id`, `organization_id` | workspace | outbox |
| `workspace_agent.added` | 1 | `workspace_id`, `agent_id` | workspace | outbox |

## Sự kiện không nằm ở đây

`provider.*` và `webhook.deliver` là việc hạ tầng: chúng ra lệnh cho nhà cung cấp
hội nghị hoặc cho consumer webhook, không có client nào nghe, nên phạm vi là `-`.
Chúng vẫn nằm trong catalogue vì vẫn đi qua cùng một outbox và cùng một vòng
retry.
