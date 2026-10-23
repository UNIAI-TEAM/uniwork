# UniChat — bằng chứng nghiệm thu trưởng thành (Q1)

> **Trạng thái:** in-progress — lập 2026-10-17 trên `develop` `aab341175` trong Q1 (UNI-1838); cập nhật mỗi khi một ô có
> bằng chứng mới. Spec: `docs/superpowers/specs/2026-10-16-unichat-maturity-pilot-design.md` §2; checklist gốc ở mô tả
> epic UNI-1826; plan `docs/superpowers/plans/2026-10-17-unichat-maturity-pilot.md`.

Thư mục này giữ bằng chứng của checklist trưởng thành. Ảnh, video và số liệu đi vào bình luận trên UNI-1838 (nhật ký
`[pilot]`, `[test]`); bảng dưới trỏ tới chúng. Trạng thái:

- **done** — có bằng chứng trong repo hoặc CI, không cần thêm gì.
- **cần người** — phải có người chạy trên máy thật, đọc console store hay dự pilot; kịch bản ở `test-scripts.md`.
- **chờ tài khoản** — không làm được tới khi có tài khoản phát hành (`release-accounts.md`).
- **chờ M4 phase 2** — ba luồng Maestro vàng viết ở PR #346 (UNI-1836, 2026-10-18); chưa chạy đêm nào.

| Tệp | Nội dung |
| --- | --- |
| [`test-scripts.md`](test-scripts.md) | Kịch bản chéo web + desktop + điện thoại (K1–K9), smoke desktop ký tên, smoke mobile máy thật |
| [`security-review-2026-10-17.md`](security-review-2026-10-17.md) | Rà soát bảo mật hai app, server và workflow; phát hiện và bản sửa |
| [`release-accounts.md`](release-accounts.md) | Tài khoản phát hành → tên khóa chính xác → nơi đặt |
| [`go-no-go-template.md`](go-no-go-template.md) | Mẫu báo cáo một trang cho chủ sở hữu |
| [`r4b-mobile/`](r4b-mobile/) | Ảnh simulator iPhone 16e (390×844) của app mobile sau đợt khớp canvas R4b (UNI-1916), sáng và tối; `00-tong-quan.jpg` là bảng gộp |
| [`../../runbooks/unichat-pilot.md`](../../runbooks/unichat-pilot.md) | Runbook pilot: chuẩn bị, triage mỗi sáng, đo, điều kiện dừng |

## Checklist (spec Q1 §2 + epic UNI-1826)

| Mục | Cách đo | Bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| **Parity — test** | Test parity của `apps/chat-mobile/lib/*-display.ts` (chạy đúng case của test web) xanh | `rooms-display`, `typing-display`, `timeline-display`, `message-display`, `people-display`, `contacts-display`, `call-log-display` `.test.ts`; workflow Mobile Verify xanh trên `aab341175` ([run 39044687513](https://github.com/UNIAI-TEAM/uniwork/actions/runs/39044687513)); 56 tệp / 726 test xanh ở máy sau khi rebase lên M3 (2026-10-18) | done |
| **Parity — chéo thiết bị** | Số chưa đọc và nhắc đến bằng nhau trên web, desktop, điện thoại cùng tài khoản | `test-scripts.md` K1: ảnh ba màn hình | cần người (iPhone: chờ tài khoản) |
| **Realtime — test** | Reconnect khi socket đóng `4001`, replay scope, hàng gửi theo `client_msg_id` | `apps/chat-mobile/data/realtime/realtime-provider.test.ts` ("4001 → refreshSession once → forceReconnect"), `refresh-for-socket.test.ts`, `ws-client.test.ts`, `data/chat-send.test.ts` | done |
| **Realtime — mất mạng 60 s, hết hạn token** | Không mất, không trùng tin; không rơi hội thoại sau 15 phút | `test-scripts.md` K2, K3: video, ảnh web của người gửi | cần người |
| **Push — preview, không log** | Preview đúng, không có trong log | Server: preview đọc lúc giao (`server/internal/notification/push_consumer.go`); không dòng log nào mang preview (rà soát §6); token thiết bị không còn trong lỗi Expo (bản sửa S-F3). Máy thật: `test-scripts.md` K4, K6 | done (mã) · cần người (máy) |
| **Push — ≤ 10 s p95** | 20 mẫu tay/ngày trong pilot | `test-scripts.md` K4 (bảng 20 mẫu). Maestro không đo độ trễ: `push-open-room.yaml` chỉ kiểm chạm push mở đúng phòng, push là APNs giả qua `simctl push` (iOS) hoặc link (Android), không đi từ server | cần người · chờ tài khoản (EAS, Firebase) |
| **Push — không push khi đang hoạt động** | Không push khi cửa sổ desktop đang focus; có push sau 2 phút mất focus | Rule 120 s (`push_consumer.go`, `pushActiveWindow`), metric `uniwork_push_suppressed_total{kind}` (`server/internal/metrics/notifications.go`); nhịp presence gửi `visible = isHostFocused()` (`packages/core/chat/use-chat-presence-heartbeat.ts`). Máy thật: K5 | done (mã) · cần người |
| **Bỏ push — đối chiếu phàn nàn** | Đếm `uniwork_push_suppressed_total{kind}` theo ngày, so với phàn nàn trong `#unichat-feedback`; lặp lại → idle timer 60 s phía client | `docs/runbooks/unichat-pilot.md` (Kiểm tra bước 2, Khắc phục bước 2). Spec từng ghi `notification_push_suppressed_total` — tên đó không tồn tại, tên đúng ở cột trái | cần người (pilot) |
| **Ổn định — crash-free** | ≥ 99,5 % phiên không crash 7 ngày cuối pilot trên App Store Connect / Play Console | Ảnh console | chờ tài khoản · cần người |
| **Ổn định — desktop tự phục hồi** | Renderer crash hoặc bị giết → app tự tải lại | `apps/chat-desktop/src/main/offline.ts` nghe `render-process-gone` (thêm trong Q1), test `offline.test.ts`; smoke "Renderer crash" ở `test-scripts.md` §2 | done (mã) · cần người (smoke) |
| **Bảo mật** | `security-review`; `pnpm audit --audit-level high`, `govulncheck`, `gitleaks`; `webPreferences`/IPC; refresh token không rời main/SecureStore; `TestIsolation*` không đổi | [`security-review-2026-10-17.md`](security-review-2026-10-17.md): 0 high, 4/5 medium đã sửa, 1 chờ quyết định (UNI-1877); CI trên `aab341175` ([run 39044687522](https://github.com/UNIAI-TEAM/uniwork/actions/runs/39044687522)): `secrets` (gitleaks), `frontend-build` (`pnpm audit`), `backend-test (rest)` (govulncheck), `backend-test (handler)` (`TestIsolation*`) xanh | done · UNI-1877 chờ chủ sở hữu |
| **Trợ năng / i18n** | VoiceOver/TalkBack qua tab bar và danh sách; chạm ≥ 44 px; sáng/tối/hệ thống; vi/en ngang hàng | `scripts/i18n-chat-key-parity.test.mjs`, `apps/chat-mobile/lib/i18n.test.ts` (chuỗi mobile sinh từ locale core bằng `scripts/sync-i18n.mjs`); máy thật: `test-scripts.md` K8, K9 | done (test) · cần người (máy) |
| **Desktop — bản cài, tự cập nhật, smoke** | Bản cài mac/win/linux từ tag; tự cập nhật Windows/Linux; badge, banner, deep link, chia sẻ màn hình | Workflow `chat-desktop-release.yml` và runbook có từ D2; **chưa tag nào được cắt** (không có run). Smoke ký tên: `test-scripts.md` §2 | cần người (cắt tag, smoke) |
| **Desktop — ký số** | Bản mac đã ký + notarize (tự cập nhật macOS), Windows đã ký | `release-accounts.md` #1–#5, #17; ký Windows cần đổi workflow (UNI-1879) | chờ tài khoản |
| **Mobile — TestFlight + Play internal** | Tag `chat-mobile-v*` → build có ở cả hai | Workflow `chat-mobile-release.yml` có từ M4; chưa chạy (thiếu `EXPO_TOKEN`) | chờ tài khoản |
| **Mobile — Maestro 5 đêm** | Ba luồng vàng xanh 5 đêm liên tiếp | `apps/chat-mobile/maestro/flows/{chat-read-send,push-open-room,call-join}.yaml` (PR #346), chạy trên iOS và Android trong `chat-mobile-verify.yml`. Gọi nhóm một tài khoản: chứng minh vào phòng LiveKit và cúp, không chứng minh đổ chuông DM, nhận cuộc gọi, âm thanh hai người (vẫn ở `test-scripts.md`). Chưa đêm nào chạy: chờ biến `MAESTRO_*` (`MAESTRO_ROOM_ID` là phòng nhóm) và workflow lên `main` | chờ M4 phase 2 (PR #346) · cần người (đặt `MAESTRO_*`) |
| **Mobile — chạy trên máy thật** | M1/M2a/M2b/M3 chạy trên iPhone và hai máy Android | Chưa lần nào (2026-10-18). `test-scripts.md` §3. Gọi khi app ở nền trên Android chưa giữ micro: foreground service (UNI-1880) | cần người (iPhone: chờ tài khoản) · UNI-1880 |
| **Landing `/apps/unichat`** | Trang sống với catalogue từ `GET /api/v1/config`, link store/TestFlight, SEO `SoftwareApplication` | Mã: PR #341 (L1). Sống: cần deploy và đặt `UNICHAT_INSTALLER_*_URLS`, `UNICHAT_TESTFLIGHT_URL`, `UNICHAT_PLAY_INTERNAL_URL` (`release-accounts.md` #10, #16, #23) rồi chụp URL | cần người · chờ tài khoản |
| **Tài liệu** | `apps/chat-*/CLAUDE.md`, hai runbook phát hành, dòng Hệ quả ADR 0011 | `apps/chat-desktop/CLAUDE.md`, `apps/chat-mobile/CLAUDE.md` (cập nhật trong Q1: `GOOGLE_SERVICES_JSON`); `docs/runbooks/unichat-desktop-release.md`, `docs/runbooks/unichat-mobile-release.md` (+ `unichat-pilot.md`); ADR 0011 mục Hệ quả có dòng "iOS + Android ship cùng lúc theo spec UniChat §5" (thêm ở M1, PR #337) | done |
| **Pilot** | ≥ 10 ngày làm việc liên tục, ≥ 80 % dùng hằng ngày, 0 mất/trùng tin, P1 đóng trong 2 ngày | Nhật ký `[pilot]` trên UNI-1838; truy vấn người dùng hằng ngày ở `docs/runbooks/unichat-pilot.md` | cần người |
| **Tài khoản phát hành** | Apple (tổ chức) duyệt, tên "UniChat"/"UniWork Chat" giữ, Play Console có app, ký Windows và notarization chạy trong workflow | `release-accounts.md` | chờ tài khoản (chủ sở hữu) |
| **Go/no-go** | Báo cáo một trang được chủ sở hữu duyệt; roadmap C-19 → CÓ | `go-no-go-template.md` | cần người |

## Việc mở (sub-issue)

| Issue | Việc | Chặn |
| --- | --- | --- |
| UNI-1877 | Tự cập nhật Windows/Linux chưa ký tin bất kỳ ai ghi được release `chat-desktop-feed` — chủ sở hữu chọn giữ hay chỉ thông báo | Mục Bảo mật (quyết định), go/no-go |
| UNI-1878 | Các phát hiện bảo mật mức thấp của rà soát 2026-10-17 | Phát hành store công khai (không chặn pilot) |
| UNI-1879 | Ký Windows bằng token/HSM: đổi bước ký của workflow theo nhà cung cấp | Desktop — ký số |
| UNI-1880 | Foreground service Android khi đang gọi (giữ micro khi app ở nền; Android 14+ đòi `foregroundServiceType`) | Mobile — gọi trên Android ở nền; nên xong trước pilot |
| UNI-1836 | M4 phase 2: ba luồng Maestro vàng (đăng nhập → tin; push → phòng; vào cuộc gọi) — PR #346; còn 5 đêm xanh | Mobile — Maestro 5 đêm |
