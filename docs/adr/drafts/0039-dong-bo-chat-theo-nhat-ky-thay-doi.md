# 0039 — Đồng bộ chat theo nhật ký thay đổi: `GET /chat/sync?since=`

**Trạng thái:** proposed (UNI-2053, theo dõi ở UNI-2071, 2026-10-22). Số 0039 là tạm, đổi nếu ADR khác land trước. Chưa có
code: bản nháp này mở việc mà bản audit mobile 2026-10-21 xếp ở Giai đoạn 3 ("Sequence event của server
cùng `/sync?since=seq`", effort L) để nó có chỗ được theo dõi thay vì để ngỏ. Chấp nhận thì chuyển ra
`docs/adr/`, thêm vào bảng của `README.md`, đưa luật vào `CLAUDE.md` kèm test giữ luật.
**Liên quan:** [0009](../0009-audit-va-outbox-cung-transaction.md) (audit + outbox cùng transaction),
[0011](../0011-mobile-la-app-expo-doc-lap.md) (mobile là app Expo độc lập, §5: frame mất khi socket rớt),
[0015](../0015-va-cache-tu-frame-realtime-theo-catalogue.md) (vá cache từ frame chỉ với trường `Patch`).

## Bối cảnh

Frame chat mang id, không mang nội dung, và đa số là `ephemeral` (`docs/events/CATALOGUE.md`:
`chat.message.created`, `.updated`, `.deleted` đi thẳng `EventPublisher.Publish`, không qua outbox). Hệ quả
đo được trên điện thoại (`apps/chat-mobile`):

- Mỗi frame của phòng đang hiện là một `GET …/messages/{id}`; một phòng bận gộp được nhờ catch-up theo
  burst (`BURST_CATCH_UP_MIN`), nhưng sửa, xoá, biểu cảm vẫn là một GET mỗi frame.
- Frame gửi lúc socket rớt là mất hẳn. Vì vậy mỗi lần reconnect — về foreground sau cửa sổ ân hạn 25 s,
  mạng quay lại, server deploy — `chat-realtime.ts › reconnect` invalidate sáu họ key (rooms, nicknames,
  members, call log, unread summary, threads) và `refreshLoadedRoomTimelines` refetch **mọi trang đã cuộn**
  của timeline đang hiện, để thấy sửa/xoá/biểu cảm lúc offline. Trên mạng di động chập chờn, đó là phần lớn
  lưu lượng của app.
- Phòng không ai xem chỉ bị đánh dấu stale (UNI-1078); bản offline được đọc lại lúc app rời foreground
  (`timeline-refresh.ts`) bằng cách so `last_message_at` — so sánh không thấy sửa và xoá, và thấy trả lời
  chủ đề như tin mới (đã vá bằng mốc theo giá trị, vẫn là đoán).

Telegram (`pts` + `getDifference`), Discord (`RESUME` với `seq`) và Slack (`rtm` + `conversations.history`
theo `oldest`) đều giải bài này bằng một số thứ tự phía server: client nói "tôi đã thấy tới N", server trả
mọi thay đổi sau N, hoặc nói "quá xa, tải lại".

## Quyết định (đề xuất)

1. **Nhật ký thay đổi chat theo workspace.** Bảng `chat_changes` (`organization_id`, `workspace_id`,
   `seq BIGINT` tăng đơn điệu theo workspace, `room_id`, `message_id`, `kind`
   (`created`|`updated`|`deleted`|`reaction`|`pin`|`read`), `created_at`), ghi **trong cùng transaction**
   với lệnh đổi tin, cạnh `audit_events`/`outbox_events` (mở rộng 0009 cho chat). `seq` cấp bằng một dòng
   đếm theo workspace khoá `FOR UPDATE` (không sequence toàn cục: thứ tự chỉ cần trong một workspace).
   Không FK, index `CONCURRENTLY` (0001); có `organization_id` (0008). Giữ 7 ngày; dọn theo lô.
2. **`GET /api/v1/workspaces/{ws}/chat/sync?since=<seq>&limit=`** trả các thay đổi sau `since` trong những
   phòng người gọi là thành viên — mỗi dòng mang bản ghi tin hiện tại (đã ký URL media theo
   `chatMediaSigningWindow`) hoặc tombstone — cùng `next_seq`. `since` cũ hơn phần còn giữ, hay quá `limit`
   × N trang, trả `410 resync_required`: client làm như hôm nay (invalidate và refetch). Tenant qua
   `RequireMember`; route vào `isoRoutes` của `TestIsolationMatrix`; SDI/SDO qua `apiOp`.
3. **Frame chat mang `seq`.** `chat.message.*` thêm khoá `seq` (không phải nội dung: catalogue và
   `scripts/events-catalogue.test.mjs` cần một khoá "thứ tự" được phép, như cặp revision của 0015). Client
   thấy lỗ (`seq` > `last_seq + 1`) thì gọi `sync` thay vì GET từng tin; reconnect gọi `sync?since=last_seq`
   thay vì refetch mọi trang.
4. **Client giữ `last_seq` theo workspace** bên cạnh cache đĩa (`query-persister.ts`), nên mở lạnh offline
   rồi có mạng cũng chỉ hỏi phần chênh, và bản offline của phòng không ai xem được vá bằng chính nhật ký
   (hết đoán theo `last_message_at`, hết bản mang theo bị bỏ khi có frame — `dropCarriedTimeline`).

## Hệ quả

- Reconnect từ "sáu họ key + mọi trang đã cuộn" xuống một request trong trường hợp thường; sửa/xoá lúc
  offline tới đúng tin mà không tải lại trang.
- Thêm một lần ghi trong transaction của mỗi lệnh chat và một bảng có retention; cần test outbox/audit
  coverage cho các lệnh chat còn đi `ephemeral`.
- Web (`packages/core/realtime`) có thể dùng cùng endpoint; không bắt buộc ở bước đầu.
- Hoãn vì effort L và vì cần chấp nhận ADR này (mở rộng 0009 cho chat, thêm khoá thứ tự vào catalogue như
  0015) — không phải vì hạ tầng test: test DB của server chạy ở CI.

## Trạng thái

proposed — chờ chủ sản phẩm và người giữ `server/internal/realtime` duyệt; việc theo dõi là UNI-2071
(sub-issue của UNI-2053).
