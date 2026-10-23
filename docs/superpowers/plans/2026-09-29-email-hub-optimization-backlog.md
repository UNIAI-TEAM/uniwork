# Email Hub — kế hoạch tối ưu & tránh lỗi ngầm (dài hạn)

> **Trạng thái:** in-progress (backlog — chưa triển khai hết)

**Mục tiêu:** Giữ trải nghiệm ổn khi mailbox lớn, thread dài, nhiều folder và retention cache bật — tránh lỗi ngầm (list cũ, IMAP nghẽn, pane đọc không cập nhật, body “mất” không giải thích được).

**Phạm vi:** `packages/core/email-hub/`, `packages/views/email-hub/`, `server/internal/service/email_hub*.go`, `server/internal/emailhub/`, realtime `email_hub.*`.

**Liên quan:** ADR `docs/adr/0022-email-hub-cache-retention-trong-postgres.md`, governor `server/internal/service/email_hub_governor.go`, sync client `packages/core/email-hub/hooks-sync.ts`.

**Không thay thế:** spec sản phẩm Email Hub riêng (nếu có); plan này là engineering backlog + checklist hồi quy.

---

## Lỗi ngầm thường gặp (đọc trước khi sửa)

| Triệu chứng | Nguyên nhân thường gặp | File / cơ chế |
| --- | --- | --- |
| Archive/Trash/Spam “thiếu mail mới” | Lazy sync chỉ **force** khi list rỗng; folder nặng bỏ qua sync mềm khi mở | `hooks-sync.ts` (`emailHubHeavyLazySyncFolders`) |
| Thread dài load rất lâu / timeout | Mỗi message thiếu body = một `useEmailHubThread` → IMAP xếp hàng 1 lock/account | `email-hub-conversation-message.tsx` |
| Đang đọc thread không thấy reply mới | WS chỉ invalidate **list**, không invalidate `conversation` / `thread` detail | `use-realtime-sync.ts` |
| Badge Snoozed / inbox unread lệch hoặc tốn API | Sidebar dùng `useEmailHubThreads` cả page chỉ để `counts` | `email-hub-view.tsx` (`snoozedMeta`, `inboxMeta`) |
| Mail cũ: retry mãi, user nghĩ bug | Body bị retention strip; UI chỉ `load_error` chung | ADR 0022, `email_hub_retention.go` |
| Mở mail → list nháy unread | Invalidate list trong lúc đọc (đã có pause — **đừng bỏ**) | `query-cache.ts` |
| Prefetch + đọc mail cùng lúc chậm | Top-5 prefetch + hover cạnh tranh `beginInteractive` IMAP | `email-hub-view.tsx`, governor |

---

## Thứ tự triển khai (ưu tiên)

Làm lần lượt; mỗi bước có PR riêng + test/checklist bên dưới. Đánh dấu `- [x]` khi xong.

### P0 — Giảm tải IMAP & request (tránh timeout ngầm)

- [x] **P0-1 — Lazy body trong conversation**
  - **Việc làm:** Chỉ fetch body khi message vào viewport (Intersection Observer) hoặc user expand; giới hạn concurrent body fetch phía client (ví dụ 2).
  - **Chạm:** `email-hub-conversation-message.tsx`, có thể hook `useEmailHubThreadBodyWhenVisible`.
  - **Test:** `packages/views/email-hub/` — thread giả 5+ message, mock HTTP, assert số lần gọi `getEmailHubThread` với `body=1`.
  - **Hồi quy tay:** Mở thread Gmail 10+ mail, scroll từ từ — không flood network tab.

- [x] **P0-2 — Giảm prefetch cạnh tranh IMAP**
  - **Việc làm:** Prefetch list từ 5 → 2; không prefetch khi `readingEmail`; hover prefetch debounce 150ms.
  - **Chạm:** `email-hub-view.tsx`.
  - **Hồi quy tay:** Mở mail nặng HTML trong khi list scroll nhanh — body vẫn load ưu tiên.

### P1 — Đồng bộ folder & realtime (tránh data “cũ mà tưởng mới”)

- [x] **P1-1 — Sync khi vào folder nặng (không chỉ khi rỗng)**
  - **Việc làm:** Khi chuyển sang ARCHIVE/TRASH/SPAM: một lần `syncEmailHub(..., force: false)` debounced (respect governor); giữ force khi list rỗng.
  - **Chạm:** `hooks-sync.ts`, có thể thêm flag env `EMAIL_HUB_HEAVY_FOLDER_SYNC=1` để tắt nhanh nếu cần.
  - **Test:** integration hoặc handler test nếu đã có pattern sync folder.
  - **Hồi quy tay:** Archive có sẵn cache → mail mới trên Gmail xuất hiện sau refresh hoặc ≤1 phút (theo governor).

- [x] **P1-2 — Snoozed folder sync**
  - **Việc làm:** Khi `folder === SNOOZED`, chạy sync tương tự SENT (không nằm `emailHubLazySyncFolders` hiện tại — mở rộng hoặc hook riêng).
  - **Chạm:** `hooks-sync.ts`, `email-hub-view.tsx`.
  - **Hồi quy tay:** Snooze mail → chuyển tab Snoozed → thấy đúng hàng.

- [x] **P1-3 — Realtime cập nhật pane đang đọc**
  - **Việc làm:** Trên `email_hub.inbox_changed` / `email_hub.new_mail`, nếu payload có `thread_id` (hoặc invalidate theo account khi đang mở detail): invalidate `emailHubKeys.conversation` + `threadDetailKey` cho thread đang `selectedId`.
  - **Chạm:** `use-realtime-sync.ts`, catalogue events (nếu thêm field — đồng bộ 3 nơi per CLAUDE.md).
  - **Test:** `packages/core/realtime/` hoặc email-hub hooks test mock frame.
  - **Hồi quy tay:** Đang đọc thread → reply từ Gmail → conversation cập nhật (hoặc nút refresh rõ ràng).

### P2 — API & UI rõ ràng (tránh hiểu nhầm lỗi)

- [x] **P2-1 — API counts nhẹ cho sidebar**
  - **Việc làm:** Endpoint (hoặc mở rộng accounts list) trả `{ inbox_unread, snoozed_total, … }` per account; thay `snoozedMeta` / `inboxMeta` full list.
  - **Chạm:** `server/pkg/db/queries/email_hub.sql`, handler, `packages/core/api/endpoints/email-hub.ts` + malformed test, `email-hub-view.tsx`.
  - **Quy tắc repo:** filter `organization_id`, membership qua service; SDI/SDO + `apiOp`.

- [x] **P2-2 — Copy retention / body đang tải lại**
  - **Việc làm:** Server trả flag `body_stale` hoặc client nhận diện `body_cached === false` + snippet-only sau fetch; i18n `email_hub.body_refetch_from_mailbox` (vi trước, en parity).
  - **Chạm:** SDO thread, `email-hub-thread-detail.tsx`, `email-hub-conversation-message.tsx`.

- [x] **P2-3 — Dùng `detailError` trên reading pane**
  - **Việc làm:** `EmailHubViewDetailPanel` phân biệt lỗi meta (404/403) vs lỗi body; không hiển thị snippet như đủ nội dung.
  - **Chạm:** `email-hub-view-detail-panel.tsx`, test views.

### P3 — Dọn kỹ thuật & quan sát (phòng regress)

- [x] **P3-1 — Tin một mail: bỏ fetch conversation thừa**
  - **Việc làm:** Nếu `conversation_message_count === 1` (hoặc list hint), skip `useEmailHubConversation`.
  - **Chạm:** `email-hub-thread-detail.tsx`, type thread summary nếu đã có field.

- [x] **P3-2 — Backend: gom `markThreadReadIfNeeded` trùng**
  - **Việc làm:** Một exit path trong `GetThread` sau khi body hydrate.
  - **Chạm:** `email_hub.go` — test integration read mark.

- [ ] **P3-3 — Metrics / log (tùy chọn)**
  - **Việc làm:** Counter sync skipped (governor), body fetch duration, conversation body fan-out — không log PII (email subject ok theo rule: id only in logs where possible).

---

## Checklist trước khi merge mỗi PR Email Hub

- [ ] `pnpm --filter @uniwork/core test` (email-hub hooks/endpoints nếu đụng).
- [ ] `pnpm --filter @uniwork/views test` (email-hub `*.test.tsx`).
- [ ] `cd server && go test ./internal/service/... -run EmailHub` (hoặc `make test-go` nếu đụng Go rộng).
- [ ] Không bỏ `setEmailHubListRefreshPaused` khi đang đọc mail.
- [ ] Mutation/action vẫn có toast lỗi (`use-email-hub-thread-actions.ts` pattern).
- [ ] Nếu đổi event payload client-visible: cập nhật `docs/events/CATALOGUE.md`, `outbox/catalogue.go`, `packages/core/types/events.ts` + `scripts/events-catalogue.test.mjs`.
- [ ] Env mới (nếu có): `.env.example` + `scripts/env-example.test.mjs`.

---

## Checklist hồi quy thủ công (mỗi release Email Hub hoặc sau P1/P0)

1. Kết nối account mới → inbox có mail hoặc thông báo sync thất bại (không im lặng).
2. INBOX: mail mới khi tab focus / trong vòng ~45s (watch + WS).
3. Archive (list **không** rỗng): refresh hoặc auto-sync thấy mail mới archive trên Gmail.
4. Thread 5+ messages: scroll, body hiện dần, không treo cả màn.
5. Đang đọc thread → reply ngoài Gmail → UniWork cập nhật hoặc hướng dẫn refresh.
6. Mail rất cũ (> retention body): message rõ, retry hoạt động nếu IMAP còn.
7. Mobile: mở mail → Back → focus đúng row list.
8. Bulk 20+ mark read/archive: không freeze UI; lỗi partial có toast.

---

## Anti-patterns (không làm)

- Invalidate toàn bộ `email-hub` queries khi một thread đổi — gây nháy list và mất scroll.
- Gọi IMAP song song nhiều connection/account bypass governor (`withIMAP` / `trySync`).
- Hydrate list row thành full body trong cache detail (đã cấm trong `useEmailHubThread` — giữ nguyên).
- Thêm `FOREIGN KEY` hoặc migration index không `CONCURRENTLY` (rules DB repo).
- Publish business state qua WebSocket trực tiếp thay outbox (trừ signal ephemeral đã catalogue).

---

## Theo dõi tiến độ

Cập nhật dòng **Trạng thái** đầu file:

- `in-progress` — còn checkbox mở.
- `shipped` — P0–P2 xong, checklist release đã chạy ít nhất một lần.
- `superseded` — nếu gom vào spec/ADR khác (ghi link).

Ghi issue UniWork (`UNI-nnn`) trên từng PR; commit prefix `feat(email-hub)` / `fix(email-hub)` / `perf(email-hub)`.
