# 0007 — Agent là actor hạng nhất; mọi bản ghi có `actor_kind`

**Trạng thái:** accepted (2026-09-04) — chấp nhận bởi quangpd trong phiên Giai đoạn 0 (UNI-420). Luật tương ứng vào `CLAUDE.md` cùng lúc với test giữ luật (xem mục cuối); đến lúc đó reviewer giữ luật bằng tay theo DoD.

## Bối cảnh

Định vị sản phẩm (`PRODUCT.md`, `docs/vision/PROJECT_VISION.md` §2.3) là "agent đồng
sở hữu công việc". Bản cũ (`unidigiwork`) thêm AI sau khi schema đã có, nên hành động
của AI lưu ở bảng riêng (`ai_task_executions`, `ai_action_proposals`) và không phân biệt
được trong `created_by` của task, comment, document. Hệ quả: UI không thể gắn attribution
nhất quán, audit không lọc được theo agent, và "hoàn tác hành động của agent" không có
điểm bám.

Schema hiện tại của UniWork (`users`, `created_by TEXT`) cũng chỉ biết người.

## Quyết định

1. Có bảng `agents` (ULID, `organization_id`, tên, avatar, trạng thái, `owner_user_id`,
   cấu hình) tách khỏi `users`. Agent không có email, không đăng nhập, không refresh token.
2. Mọi bảng nghiệp vụ có người tạo/sửa mang cặp cột `created_by` + `created_by_kind`
   (`human` | `agent` | `system`), tương tự `updated_by` + `updated_by_kind` khi có.
   Cột `_kind` là `TEXT` với `CHECK`; migration mới phải có, bảng cũ backfill `human`.
3. Agent có thể là thành viên workspace (`workspace_members` mở rộng `member_kind`)
   với role riêng cho agent; `RequireMember` là nơi duy nhất quyết định, không đổi.
4. Mọi API trả actor dưới dạng `{ id, kind, display_name, avatar_url }`; FE render badge
   theo `kind`; không suy `kind` từ tên hay avatar.
5. Audit và outbox mang `actor_id` + `actor_kind`; log có cùng hai trường.

## Hệ quả

- Migration cho mọi bảng nghiệp vụ hiện có: thêm cột `_kind` mặc định `human`;
  `server/migrations/lint_test.go` mở rộng để bắt buộc cặp cột này ở bảng mới.
- Service nhận `Actor{ID, Kind}` thay vì `userID string`; đây là refactor chữ ký lớn, làm
  một lần ở đầu Giai đoạn F trước khi có thêm feature.
- Quyền: agent không bao giờ là `owner`; policy hành động ghi của agent theo ADR 0010.
- Cái giá: mọi handler và test phải truyền actor; bù lại attribution, undo, filter theo
  agent và "agent là thành viên" đều là một mô hình.

## Test giữ luật (điều kiện để đưa luật vào `CLAUDE.md`)

- `server/migrations/lint_test.go`: bảng mới có `created_by` phải có `created_by_kind`.
- `server/internal/arch_test.go`: không file nào ngoài `service` tạo `Actor`.
- Contract test: DTO có `actor` phải có `kind`.


## Cập nhật 2026-10-01 — `guest` chỉ có ở audit và outbox (UNI-893)

Khách vào họp bằng link mời (không có tài khoản) được bỏ phiếu. Đây là lệnh đầu tiên của
khách được audit. Ghi khách là `human` sẽ đặt guest session id vào chỗ của user id; ghi
`system` thì đổ hành động cho người khác. Vì vậy thêm `audit.KindGuest = "guest"` và
`audit.Guest(id)`, với `id` là guest session id (`meeting_participants.guest_id`).

- `guest` chỉ xuất hiện ở `audit_events.actor_kind` và `outbox_events.actor_kind`. Hai cột
  này không có `CHECK`, nên không cần migration.
- Không cột `_kind` nào của bảng nghiệp vụ nhận `guest`. `CHECK (human|agent|system)` giữ
  nguyên, vì khách không tạo bản ghi có người tạo. `notifications.actor_kind` cũng có
  `CHECK`, mà `actorKindOf` (`internal/notification/rules.go`) chép nguyên kind của outbox.
  Hôm nay chưa quy tắc nào phản ứng với sự kiện họp. Quy tắc nào sau này phản ứng với sự
  kiện của khách phải đổi `guest` sang `system` trước khi ghi.
- `guest` không phải actor hạng nhất như agent: không có bảng, không có DTO actor riêng.
  Quyết định 1–5 ở trên không đổi. `internal/arch_test.go` chặn `audit.Guest(`/`KindGuest`
  ngoài tầng service, giống `System(`/`KindAgent`.
- Cũng trong đợt này, actor `"system"` mà job tự kết thúc họp truyền vào được ghi là
  `system` (`meeting-auto-end`) thay vì `human`. Riêng dòng thời gian cuộc họp vẫn lưu
  `actor_id = "system"`.
