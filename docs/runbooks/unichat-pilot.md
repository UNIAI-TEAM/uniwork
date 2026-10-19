# unichat-pilot — pilot nội bộ UniChat (Q1)

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** không có alert — runbook vận hành của UniChat Q1 (UNI-1838) · **Spec:** `docs/superpowers/specs/2026-10-16-unichat-maturity-pilot-design.md` §3

Pilot chứng minh UniChat dùng được làm kênh chat chính của nhân sự nội bộ. Thông số (spec Q1 §3, epic UNI-1826 điều kiện 1):

| Thông số | Giá trị |
| --- | --- |
| Nơi chạy | Tổ chức nội bộ trên production (`uniworkos.com`) |
| Thời gian | ≥ 10 ngày làm việc **liên tục**; ngày dừng pilot thì đếm lại từ đầu |
| Mức dùng | ≥ 80 % nhân sự trong danh sách pilot dùng UniChat (desktop hoặc điện thoại) mỗi ngày làm việc |
| Kênh phản hồi | Kênh `#unichat-feedback` ngay trong UniChat |
| Triage | 15 phút mỗi sáng; sự cố P1 đóng trong 2 ngày làm việc |
| Dừng pilot | Mất tin, trùng tin, hoặc sự cố bảo mật (mục Khắc phục) |
| Nhật ký | Bình luận `[pilot]` trên UNI-1838, một bình luận mỗi ngày |
| Bằng chứng | `docs/evidence/unichat/README.md`; báo cáo cuối `docs/evidence/unichat/go-no-go-template.md` |

**Chuẩn bị (trước ngày 1)**

1. Điều kiện vào pilot (`docs/evidence/unichat/README.md`): M3 đã lên `develop` (PR #345) và foreground service Android
   khi gọi (UNI-1880) xong; một bản desktop đã cắt
   theo `docs/runbooks/unichat-desktop-release.md` và qua smoke trên máy sạch; bản mobile đã cài được trên ít nhất một
   iPhone và hai máy Android thật (`docs/evidence/unichat/test-scripts.md` §3, §4). Chưa có tài khoản Apple Developer thì
   iPhone không cài được bản nào (TestFlight và ad hoc đều cần tài khoản), nên pilot chỉ chạy với Android và desktop,
   và báo cáo go/no-go phải ghi rõ điều đó.
2. Server production (`deploy/app/env/uniwork-be.env`, qua PR):
   - `DESKTOP_AUTH_CLIENTS` có `uniwork-chat-desktop` và `uniwork-chat-mobile` với `uniworkchat://auth/callback`
     (`.env.example`, mục Desktop auth).
   - `EXPO_ACCESS_TOKEN` nếu tài khoản Expo bật "enhanced push security" (`docs/evidence/unichat/release-accounts.md`).
   - `UNICHAT_INSTALLER_BETA_URLS` (hoặc kênh đang dùng) từ `installer-urls.env` của release desktop;
     `UNICHAT_TESTFLIGHT_URL`, `UNICHAT_PLAY_INTERNAL_URL` khi có — trang `/apps/unichat` hiện chúng.
   - `UNICHAT_IOS_TEAM_ID`, `UNICHAT_ANDROID_SHA256` khi có tài khoản (universal link; thiếu thì
     `/.well-known/*` trả 404 và link `https://` mở trình duyệt thay vì app — không chặn pilot).
3. Trong tổ chức nội bộ: tạo kênh `#unichat-feedback`, ghim tin hướng dẫn (link `/apps/unichat`, cách báo lỗi: mô tả, ảnh,
   thiết bị, giờ xảy ra, có `X-Trace-Id` thì gửi kèm). Lập danh sách người tham gia (mẫu số của 80 %) và ghi vào
   bình luận đầu tiên của nhật ký.
4. Ghi số mốc trước ngày 1: phiên bản desktop và mobile đang cài, giá trị hiện tại của các truy vấn ở mục Kiểm tra.

**Triage mỗi sáng (15 phút)**

1. Đọc `#unichat-feedback` từ lần triage trước; mỗi báo cáo nhận một mức:
   - **P1** — không đăng nhập được, tin không tới/tới hai lần, push DM hoặc nhắc đến không tới với từ hai người,
     app crash lúc mở, rò rỉ dữ liệu. Mở sub-issue của UNI-1838 ngay (`make issue-sub PARENT=UNI-1838 TITLE="…"`),
     hạn đóng 2 ngày làm việc.
   - **P2** — sai hiển thị, số chưa đọc lệch một lúc rồi tự đúng, chậm. Sub-issue, không hạn cứng.
   - **P3** — góp ý. Gom vào một bình luận cuối tuần.
2. Chạy các truy vấn ở mục Kiểm tra, ghi số vào nhật ký ngày.
3. Đăng bình luận nhật ký trên UNI-1838:

   ```text
   [pilot] Ngày N/10 — YYYY-MM-DD
   Dùng hôm qua: desktop a, mobile b, tổng c / d người (x %)
   P1: mở … / đóng … (UNI-…); P2 mới: …
   Push: gửi … (sent) · bỏ … theo kind (chat_dm …, chat_mentioned …, chat_thread_replied …) · phàn nàn "không nhận push" …
   Mất/trùng tin: không | có → DỪNG (mục Khắc phục)
   Ghi chú: …
   ```

## Triệu chứng

- Người dùng báo tin nhắn không tới, tới hai lần, hoặc thứ tự sai giữa web, desktop và điện thoại.
- Người dùng báo không nhận push trên điện thoại khi máy tính đang mở UniChat nhưng họ không ngồi máy.
- Số chưa đọc hoặc nhắc đến trên điện thoại khác web hay desktop sau khi đã mở app vài giây.
- Desktop trắng màn hình, treo, hoặc kẹt ở trang "Không kết nối được tới UniChat" khi mạng vẫn có.
- Không đăng nhập được, hoặc bị đăng xuất giữa ngày.
- Mức dùng hằng ngày dưới 80 % hai ngày liền.

## Kiểm tra

1. **Người dùng hằng ngày** (mỗi lần app đổi access token 15 phút một lần thì `device_sessions.last_used_at` cập nhật,
   nên một app mở trong ngày là một dòng). Chạy chỉ đọc trên production:

   ```sql
   SELECT d.client_id, count(DISTINCT d.user_id) AS users
   FROM device_sessions d
   JOIN organization_members m ON m.user_id = d.user_id
   WHERE m.organization_id = '<id tổ chức nội bộ>' AND m.deactivated_at IS NULL
     AND d.client_id IN ('uniwork-chat-desktop', 'uniwork-chat-mobile')
     AND d.last_used_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh'
     AND d.last_used_at <  date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
   GROUP BY ROLLUP (d.client_id);
   ```

   Dòng `client_id` rỗng là tổng (một người dùng cả hai app đếm một lần). Chia cho số người trong danh sách pilot.
2. **Push bị bỏ** — metric `uniwork_push_suppressed_total{kind}` (`server/internal/metrics/notifications.go`; push
   chat bị bỏ vì người nhận có nhịp presence từ trang đang hiện trong 120 giây, `server/internal/notification/push_consumer.go`).
   Trong Prometheus/Grafana:

   ```promql
   sum by (kind) (increase(uniwork_push_suppressed_total[1d]))
   sum by (result) (increase(uniwork_push_sent_total[1d]))
   ```

   Tỷ lệ bỏ / (bỏ + `sent`) theo ngày đặt cạnh số phàn nàn "không nhận push trên điện thoại khi desktop mở mà tôi
   không ngồi máy" trong `#unichat-feedback`. Spec không có metric `notification_push_suppressed_total`; tên đúng là
   tên ở trên.
3. **Mất hoặc trùng tin** — khi có báo cáo: lấy id phòng và khoảng giờ; so danh sách tin trên web (nguồn sự thật) với
   desktop và điện thoại. Trùng tin trên server (hai dòng cùng `client_msg_id`) khác với trùng chỉ ở cache client
   (mở lại phòng thì hết) — ghi rõ là loại nào. Luồng outbox: `docs/ops/RUNBOOK_OUTBOX.md`.
4. **Desktop** — main process chỉ log ra stdout (không có tệp log): nhờ người dùng mở app từ terminal
   (`/Applications/UniChat.app/Contents/MacOS/UniChat` trên macOS, đường dẫn `UniChat.exe` trong thư mục cài trên
   Windows, tệp AppImage hoặc `unichat` trên Linux), tái hiện rồi gửi phần output. Phiên bản: tên tệp cài đã dùng
   (`unichat_<version>_…`).
5. **Request lỗi** — `X-Trace-Id` → `/admin/trace/<id>` (`docs/runbooks/README.md`, mục trace id).

## Khắc phục

1. **Dừng pilot** khi có một trong ba: mất tin (server có, client không bao giờ hiện dù mở lại phòng), trùng tin trên
   server, hoặc sự cố bảo mật (token/nội dung lộ, truy cập chéo tổ chức). Làm ngay:
   - Đăng `[pilot] DỪNG — <lý do>` trên UNI-1838 và trong `#unichat-feedback`; mọi người quay về web cho tới khi sửa.
   - Mở sub-issue P1 với bằng chứng; sự cố bảo mật thì thu hồi thiết bị liên quan trước khi điều tra (danh sách
     thiết bị native của tài khoản: `GET /api/v1/auth/desktop/devices`, thu hồi một máy:
     `DELETE /api/v1/auth/desktop/devices/{deviceSessionID}`; trên mobile là mục thiết bị ở tab Cài đặt).
   - Sửa, phát bản mới (OTA cho lỗi chỉ JS theo `docs/runbooks/unichat-mobile-release.md`), rồi bắt đầu lại đếm 10
     ngày làm việc.
2. **Phàn nàn "không nhận push" lặp lại** (từ ba người, hoặc hai ngày liền) khi metric bỏ push tăng: bật dự phòng chỉ
   phía client đã ghi ở spec Q1 §2 — một idle timer 60 giây không chuột/bàn phím làm
   `packages/core/chat/use-chat-presence-heartbeat.ts` gửi `visible: false` (hôm nay nó gửi `isHostFocused()`), để cửa
   sổ desktop mở mà người không ngồi máy không còn giữ push. Thay đổi web có test, không đổi server (ngưỡng 120 giây giữ
   nguyên). Ghi quyết định vào nhật ký.
3. **Lệch số chưa đọc** giữa điện thoại và web: chụp cả hai màn, ghi id phòng; mở P2 (P1 nếu không tự đúng sau khi mở
   lại app). Đối chiếu với parity test `apps/chat-mobile/lib/rooms-display.test.ts`.
4. **Desktop trắng/treo**: đóng hẳn và mở lại; gửi output main (mục Kiểm tra bước 4). Bản mac chưa ký không tự cập
   nhật — tải tay ở `/apps/unichat`.
5. **Mức dùng dưới 80 %**: hỏi trực tiếp người không dùng (thiếu bản cho máy của họ, không nhận push, thói quen), ghi
   lý do vào nhật ký; ngày dưới ngưỡng vẫn tính vào 10 ngày nhưng phải giải thích trong báo cáo go/no-go.

## Leo thang

- Mất/trùng tin, sự cố bảo mật: chủ epic UNI-1826 ngay khi dừng pilot; sự cố bảo mật cũng theo quy trình sự cố của
  công ty.
- Server production (5xx, outbox chậm, Redis): runbook alert tương ứng trong `docs/runbooks/README.md`.
- Bản cài, ký số, store, OTA: `docs/runbooks/unichat-desktop-release.md`, `docs/runbooks/unichat-mobile-release.md`;
  tài khoản phát hành: người giữ tài khoản (`docs/evidence/unichat/release-accounts.md`).
- Kết thúc pilot: điền `docs/evidence/unichat/go-no-go-template.md`, gửi chủ sở hữu sản phẩm duyệt.
