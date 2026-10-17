# UniChat — kịch bản kiểm thử tay (chéo thiết bị, smoke desktop, smoke máy thật)

> **Trạng thái:** in-progress — kịch bản cho người chạy, lập 2026-10-17 trong Q1 (UNI-1838); chưa kịch bản nào chạy.
> Mỗi lần chạy: một bình luận `[test] Kx — <ngày> — <người chạy>` trên UNI-1838 với kết quả từng bước và ảnh/video,
> rồi cập nhật cột Trạng thái ở `docs/evidence/unichat/README.md`.

CI không nhìn được màn hình máy thật, nên các bước dưới là phần còn lại của checklist trưởng thành (spec Q1 §2) sau
khi test tự động đã xanh. Gặp lỗi thì mở sub-issue của UNI-1838 kèm bước tái hiện; lỗi sửa được bằng mã thì kèm test
tự động trong PR sửa.

## 0. Chuẩn bị

- Tài khoản **A** (người kiểm) đăng nhập cùng lúc trên: web (Chrome, `https://app.uniworkos.com` hoặc staging),
  UniChat desktop, UniChat trên điện thoại (một iPhone khi có tài khoản Apple, hai máy Android thật).
- Tài khoản **B** (người gửi) trên web, cùng workspace.
- Có sẵn: một phòng workspace `R`, một nhóm `G` có A và B, DM A–B, một luồng trong `R`.
- Đồng hồ: bật hiển thị giây trên điện thoại và máy tính; quay màn hình điện thoại khi đo thời gian.
- Server: quyền xem Prometheus/Grafana (`uniwork_push_suppressed_total`, `uniwork_push_sent_total`) và log của
  `uniwork-be`.

## 1. Kịch bản chéo web + desktop + điện thoại

| # | Mục checklist | Bước | Kỳ vọng | Bằng chứng |
| --- | --- | --- | --- | --- |
| K1 | Parity | Cả ba thiết bị của A ở danh sách hội thoại. B gửi 3 tin vào `R`, 1 tin nhắc `@A` trong `G`, 1 DM. Chờ 10 s. Rồi A mở `R` trên điện thoại. | Trước khi mở: số chưa đọc của `R`, `G`, DM và dấu nhắc đến của `G` **bằng nhau** trên ba thiết bị; badge dock/taskbar của desktop bằng tổng web. Sau khi mở `R` trên điện thoại: `R` về 0 trên web và desktop trong vài giây. | Ảnh ba màn hình trước/sau |
| K2 | Realtime — mất mạng 60 s | A mở `R` trên điện thoại và desktop. Tắt mạng cả hai (chế độ máy bay / tắt Wi-Fi). Trong 60 s: B gửi 5 tin đánh số 1–5; A gõ và gửi 1 tin trên điện thoại. Bật mạng lại. | Tin 1–5 hiện **đúng một lần**, đúng thứ tự, trên cả hai; tin của A gửi đi đúng một lần sau khi nối lại (web của B thấy một tin). Không phải mở lại app. | Video điện thoại; ảnh web của B |
| K3 | Realtime — hết hạn token | A mở `R` trên desktop và điện thoại (foreground), không chạm gì **16 phút** (access token sống 15 phút; socket bị đóng `4001`). B gửi 1 tin. | Tin hiện trong vài giây, không về màn đăng nhập, không phải tải lại. | Ảnh có giờ |
| K4 | Push — thời gian và preview | Desktop của A **thoát hẳn**, điện thoại khóa màn. B gửi lần lượt: DM, tin nhắc `@A` trong `G`, trả lời vào luồng của A. Lặp tới đủ **20 mẫu**, ghi giờ gửi (web của B) và giờ banner hiện (video điện thoại). | Mỗi push có tiêu đề người gửi/phòng và preview nội dung (~120 ký tự); chạm mở đúng phòng/luồng. p95 = mẫu lớn thứ 19 trong 20 ≤ 10 s. | Bảng 20 mẫu; video |
| K5 | Không push khi đang hoạt động | Desktop của A mở, **cửa sổ đang focus**, A thao tác. B gửi DM. Sau đó A chuyển sang app khác (cửa sổ UniChat mất focus) **hơn 2 phút**, B gửi DM nữa. | Lần 1: không push trên điện thoại; `uniwork_push_suppressed_total{kind="chat_dm"}` tăng 1. Lần 2: điện thoại nhận push (nhịp presence khi mất focus gửi `visible: false`, không giữ push). | Ảnh Grafana/PromQL; video |
| K6 | Preview không vào log | Sau K4, lấy một chuỗi duy nhất trong tin B đã gửi (vd. `pilot-7f3k`). Tìm trong log server khoảng giờ đó: `kubectl logs deploy/uniwork-be --since=1h \| grep -F 'pilot-7f3k'`. | Không dòng nào. | Lệnh và output rỗng |
| K7 | Đăng xuất | A đăng xuất trên điện thoại. B gửi DM. Trên web: Cài đặt → thiết bị (hoặc tab Cài đặt của desktop). | Không push tới điện thoại; thiết bị điện thoại không còn trong danh sách đang hoạt động. | Ảnh |
| K8 | Sáng/tối, vi/en | Trên điện thoại và desktop: đổi giao diện sáng/tối/hệ thống, đổi ngôn ngữ vi/en. | Không chữ nào là khóa i18n thô; tương phản đọc được ở cả hai chế độ. | Ảnh 4 tổ hợp |
| K9 | Trợ năng | Bật VoiceOver (iOS) / TalkBack (Android). Đi hết tab bar (Chat · Cuộc gọi · Danh bạ · Cài đặt) và danh sách hội thoại; mở một phòng. | Mỗi phần tử đọc ra nhãn có nghĩa; không phần tử nào bị bỏ qua hay đọc "button" trống. | Video có tiếng |

## 2. Smoke desktop (D1 + D2) — ký tên trên mỗi hệ điều hành

Chạy trên **máy sạch** (chưa từng cài UniChat) cho macOS (Apple Silicon và Intel nếu có), Windows 11 x64,
Ubuntu x64; bản từ release `chat-desktop-v…` (`docs/runbooks/unichat-desktop-release.md`).

| Bước | Kỳ vọng | mac | win | linux |
| --- | --- | --- | --- | --- |
| Cài từ tệp trên trang `/unichat` (hoặc release) | Cài được; cảnh báo chưa ký đúng như ghi chú release | ☐ | ☐ | ☐ |
| Mở lần đầu | Màn chào UniChat, không phải landing | ☐ | ☐ | ☐ |
| Đăng nhập | Trình duyệt hệ thống mở trang consent → bấm cho phép → quay về app, vào chat | ☐ | ☐ | ☐ |
| Thoát và mở lại | Vẫn đăng nhập (không rơi về `/login`) | ☐ | ☐ | ☐ |
| Badge | B gửi tin: số trên dock/taskbar (Windows: chấm đỏ) bằng tổng chưa đọc | ☐ | ☐ | ☐ |
| Banner khi mất focus | Chuyển sang app khác; B gửi DM → banner hệ điều hành; bấm banner → đúng phòng | ☐ | ☐ | ☐ |
| Deep link | Trong trình duyệt mở `uniworkchat://open?url=%2F<org>%2F<ws>%2Fchat%3Froom%3D<id>` → app mở đúng phòng | ☐ | ☐ | ☐ |
| Link ngoài | Bấm một link `https://` ngoài app trong tin → mở trình duyệt hệ thống, cửa sổ app không đổi | ☐ | ☐ | ☐ |
| Chia sẻ màn hình | Vào cuộc gọi, chia sẻ màn hình; người kia thấy | ☐ | ☐ | ☐ |
| Mất mạng | Tắt mạng → trang "Không kết nối được tới UniChat"; bật lại → tự vào lại app | ☐ | ☐ | ☐ |
| Renderer crash: dừng cưỡng bức tiến trình renderer (macOS "UniChat Helper (Renderer)" trong Activity Monitor, Windows Task Manager, Linux `kill -9`) | Cửa sổ qua trang offline vài giây rồi tự tải lại app, không treo trắng | ☐ | ☐ | ☐ |
| Tự cập nhật: cài bản cũ hơn một bản, mở app, chờ, thoát | Windows/Linux: lần mở sau là bản mới. macOS chưa ký: thông báo "Đã có bản UniChat mới" mở trang tải | ☐ | ☐ | ☐ |
| Đăng xuất trong app | Về màn chào; thiết bị bị thu hồi trong danh sách thiết bị trên web | ☐ | ☐ | ☐ |

Người chạy ký: tên, ngày, phiên bản tệp cài cho từng cột.

## 3. Smoke mobile trên máy thật (M1, M2a, M2b, M3)

Chưa có bản nào chạy trên simulator hay máy thật cho M2a/M2b/M3 (2026-10-17). Chạy trước pilot, trên một iPhone
(khi có tài khoản Apple) và hai máy Android khác hãng; bản `preview` hoặc TestFlight/Play internal.

| Bước | Kỳ vọng | iOS | Android 1 | Android 2 |
| --- | --- | --- | --- | --- |
| Đăng nhập | Sheet trình duyệt → consent → quay về app; chọn workspace | ☐ | ☐ | ☐ |
| Mở lại sau khi kill app | Vẫn đăng nhập | ☐ | ☐ | ☐ |
| Tab Chat | Danh sách hội thoại, số chưa đọc như web (K1) | ☐ | ☐ | ☐ |
| Gửi văn bản, ảnh, tệp; trả lời; reaction; sửa/xóa tin của mình | Hiện đúng trên web của B | ☐ | ☐ | ☐ |
| Kind chưa hỗ trợ | Hàng "Mở trên web" mở trình duyệt trong app | ☐ | ☐ | ☐ |
| Push | Cho phép thông báo; K4 một mẫu; chạm mở đúng phòng | ☐ | ☐ | ☐ |
| Link `https://app.uniworkos.com/<org>/<ws>/chat?room=<id>` (khi đã có AASA/assetlinks) | Mở app ở đúng phòng | ☐ | ☐ | ☐ |
| Tab Cuộc gọi, Danh bạ, Cài đặt | Lịch sử cuộc gọi; danh bạ mở DM; Cài đặt: thiết bị, bật/tắt push, giao diện, ngôn ngữ, đổi workspace, đăng xuất | ☐ | ☐ | ☐ |
| Gọi (M3) | Gọi 1:1 và nhóm với web; nhận cuộc gọi khi app foreground và qua push | ☐ | ☐ | ☐ |
| Nền 10 phút rồi mở lại | Tin mới hiện, không trùng | ☐ | ☐ | ☐ |
