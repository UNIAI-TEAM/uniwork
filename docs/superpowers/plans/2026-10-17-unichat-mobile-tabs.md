# UniChat M2b — Tab Cuộc gọi, Danh bạ, Cài đặt — Kế hoạch triển khai

> **Trạng thái:** shipped — merge vào develop 2026-10-17 qua PR #340 (squash 22b9e8a67); issue UNI-1833.

**Goal:** Ba tab còn lại của app mobile đủ dùng: lịch sử cuộc gọi xuyên phòng (một tuyến đọc mới), danh bạ workspace mở DM, cài đặt tài khoản/thiết bị/thông báo/giao diện/ngôn ngữ/workspace/đăng xuất.

**Spec:** `docs/superpowers/specs/2026-10-16-unichat-mobile-tabs-design.md` (§2–§5). Mẫu plan: `2026-10-17-unichat-mobile-foundation.md`.

## Ràng buộc

- Server chỉ thêm `GET /api/v1/workspaces/{workspaceID}/chat/call-logs?cursor&limit`: chỉ đọc, không bảng, không event, không audit. Một index partial (không phải bảng) để trang không quét mọi tin của tổ chức — tiền lệ `idx_chat_messages_org_files`.
- Mobile mở hội thoại **chỉ** qua `deepLinkHref()` (`lib/deep-link.ts`): hàng cuộc gọi → `?room=&message=`, người → `?dm=`. Không sửa `(tabs)/chat.tsx`, không tạo màn hội thoại (M2a).
- Logic web copy sang `lib/*.ts` có dòng nguồn + test parity (ADR 0011); `lib/**`, `data/**` giữ coverage 100 %.
- Chuỗi giao diện: lấy từ `packages/core/i18n/locales` qua `scripts/sync-i18n.mjs` (khối PATHS riêng của M2b); chuỗi chỉ mobile nằm dưới `mobile.calls|contacts|settings`.

## Quyết định builder (spec §7 và chỗ spec lệch code)

| Mục | Chọn | Lý do |
|---|---|---|
| SDO call-log | Phẳng: `message_id, room_id, room_kind, room_name, peer_user_id?, call_id, outcome, video, caller_id, caller_name, duration_seconds, started_at, ended_at, participants[]`; vỏ `{call_logs, next_cursor}` (null ở trang cuối) | Client vẽ hàng không cần ghép thêm; không trả URL ghi âm (tab không cần, bớt bề mặt) |
| Tập phòng | Đúng tập `ListChatRooms` của web: kênh của workspace này + DM/nhóm của tổ chức mà người gọi là thành viên invited/active; DM cần người gọi trong member set; DM với người mình đã chặn bị bỏ như sidebar; phòng lưu trữ bị bỏ | "Hiện đúng các cuộc gọi web hiện trong phòng của người dùng" |
| Ràng tenant | `m.organization_id = $org` (org lấy từ `RequireMember`) + `r.workspace_id = $ws` cho kênh | DM/nhóm là phòng cấp tổ chức, `workspace_id = $n` một mình sẽ làm mất chúng |
| Con trỏ | `encodeFeedCursor`/`decodeFeedCursor` có sẵn (`<micros>.<id>`), keyset `(created_at, id COLLATE "C")` | Không thêm định dạng thứ hai |
| Nhỡ/đã nghe | Một danh sách, không nhóm; biểu tượng + màu theo luật web (`voice-call-log-row.tsx`: nhỡ = `unanswered` và người gọi không phải mình → màu destructive) | Giữ đúng ngữ nghĩa web, ít UI |
| Hiện diện ở Danh bạ | Tab tự gọi heartbeat `POST …/chat/presence` (visible) mỗi 15 s khi đang mở và đọc `online_user_ids` | Cùng nguồn snapshot với web; không tạo store presence trùng với M2a. Khi M2a có store chung thì tab chuyển sang đọc store |
| Người bị vô hiệu hóa | Ẩn: `GET /orgs/{org}/members?status=deactivated` trừ khỏi `GET /workspaces/{ws}/members` | `GET …/members` vẫn trả họ (hàng workspace giữ lại), mà `ResolveDM` từ chối họ |
| Người bị chặn | Vẫn hiện trong danh bạ như picker web; banner chặn ở màn DM (M2a) đọc `getChatBlockStatus` như `chat-page-view.tsx` | Web không có API liệt kê chặn; gọi N lần là quá đắt |
| Thiết bị | Mục riêng trong Cài đặt; server đánh dấu `current`; ẩn thiết bị đã thu hồi | Spec §4 |
| Thu hồi ≤ 1 phút | Server đã có: `DELETE …/devices/{id}` → `session.revoked` → hub đóng socket 4001; refresh → `device_revoked`. Mobile thêm: phiên kết thúc (`onChange(null)`) khi còn user → đăng xuất như 401 | Trước đây chỉ request API 401 mới đưa về màn đăng nhập |
| Push | Ý định lưu SecureStore `push_enabled` (mặc định bật); tắt = `DELETE /me/push-subscriptions` trước, lưu sau (lỗi → giữ bật, báo lỗi); `registerPushToken` bỏ qua khi tắt | Tắt phải thu hồi phía server; mở lại app không tự đăng ký lại |
| Chuyển workspace | Hàng mở `/select-workspace` có sẵn | Tái dùng |
| Điều khoản/Riêng tư | Bỏ | Web chưa có trang nào; thêm khi M4 có URL chính sách |

## Task 1 — Tuyến call-logs (server, test trước)

**Files:** `server/migrations/9991792236980972_chat_messages_org_call_logs_idx.{up,down}.sql`, `server/pkg/db/queries/chat_call_logs.sql` (+ `make sqlc`), `server/internal/service/chat_voice_call_logs.go`, `server/internal/handler/chat_call_logs.go`, `server/internal/handler/dto/{sdi,sdo}/chat.go`, `server/internal/handler/router/{chat.go,routes.go}`, `server/internal/handler/router.go`, `docs/api-sdi-sdo.md`.

- [x] `TestChatCallLogsHTTP` (`internal/handler/chat_call_logs_test.go`) đỏ: ba cuộc gọi (nhóm, DM nhỡ, DM có nghe) qua invite/accept/hangup; A thấy 3 mới nhất trước, `limit=2` → `next_cursor` → trang 2 một hàng, cursor null; C chỉ thấy cuộc gọi nhóm; D (không trong phòng) rỗng; B chặn A → B không thấy DM; người ngoài 403/404; cursor rác 400.
- [x] Migration index, query, service, handler, route, SDI/SDO; xanh. `TestIsolationMatrix`, `TestEveryBodyIDFieldHasAReferenceCase`, `./internal/handler/router/...`, `TestEveryQueryNamesItsTenant`, migration lint.

## Task 2 — Tab Cuộc gọi (mobile)

**Files:** `apps/chat-mobile/data/queries/call-logs.ts` (+test: schema lỏng, malformed → rỗng, phân trang), `lib/call-log-display.ts` (+test parity với `voice-call-log-row.tsx`, `voice-call-duration.ts`), `app/(app)/[org]/[ws]/(tabs)/calls.tsx`, `components/people/person-avatar.tsx`.

- [x] Hàng: avatar/tên phòng hoặc người (biệt danh cho DM), nhãn web, giờ; chạm → `deepLinkHref({room, message})`; kéo để tải lại; cuộn tải trang sau; refetch khi tab focus.

## Task 3 — Tab Danh bạ (mobile)

**Files:** `data/queries/contacts.ts` (+test), `lib/contacts-display.ts` (+test parity `workspace-member-picker-utils.ts`, `chat-search-fold.ts`, `contacts-store.ts › displayLabelForChatContact`), `app/(app)/[org]/[ws]/(tabs)/contacts.tsx`.

- [x] Trừ chính mình và người bị vô hiệu hóa; nhãn = biệt danh → tên → email; nhóm theo chữ cái (bỏ dấu); tìm theo tên/email bỏ dấu; chấm hiện diện; chạm → `deepLinkHref({dm})`.

## Task 4 — Tab Cài đặt (mobile)

**Files:** `data/queries/devices.ts` (+test), `data/push.ts` (+test), `app/_layout.tsx` (phiên kết thúc → đăng xuất), `app/(app)/[org]/[ws]/(tabs)/settings.tsx`, `components/settings/*.tsx`.

- [x] Hồ sơ (từ `/me` trong auth store), Thiết bị (liệt kê, "Thiết bị này", thu hồi có xác nhận), Thông báo (công tắc + giải thích rule không push khi đang hoạt động nơi khác), Giao diện, Ngôn ngữ (giữ của M1), Workspace, phiên bản, Đăng xuất.

## Task 5 — Kiểm và bàn giao

- [x] `pnpm --filter @uniwork/chat-mobile test|lint|typecheck`; `node apps/chat-mobile/scripts/sync-i18n.mjs --check`; Go mục tiêu ở Task 1; `gofmt`/`go vet` gói đã chạm.
- [x] Đánh dấu plan, `make issue-pr`, thân PR tiếng Việt, ghi chú `[agent]`.
- [ ] Smoke trên simulator/máy (sáng/tối, VoiceOver/TalkBack, thu hồi thiết bị thật, tắt push thật) — orchestrator làm sau; plan chuyển `shipped` khi xong.
