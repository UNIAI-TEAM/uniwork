# 0041 — Đăng nhập trên iPhone: Sign in with Apple trước lần nộp App Store đầu tiên

**Trạng thái:** proposed (UNI-2053, 2026-10-22). Số 0041 là tạm, đổi nếu ADR khác land trước. Chưa có code: phương án
được chọn cần tài khoản Apple Developer (UNI-1838), mà tài khoản đó chưa có. Chấp nhận thì chuyển ra `docs/adr/`, thêm
vào bảng của `README.md`, đưa luật vào `CLAUDE.md` kèm test giữ luật (mục "Hệ quả").
**Liên quan:** [0011](../0011-mobile-la-app-expo-doc-lap.md) (UniChat mobile đăng nhập qua trình duyệt hệ thống, PKCE),
[0038](0038-cuoc-goi-native-android-va-ke-hoach-callkit-ios.md) (phần iOS cũng chờ tài khoản Apple),
`docs/runbooks/unichat-mobile-release.md` › Play Console App content và App Store Connect.

## Bối cảnh

Audit mobile 2026-10-22, chiều "i18n & tuân thủ store", gap `ios-sign-in-with-apple` (P1, verifier xác nhận): Apple
Guideline 4.8 chưa được xử lý ở đâu cả.

- UniChat trên iPhone đăng nhập bằng cách mở trang đăng nhập web trong `ASWebAuthenticationSession`
  (`apps/chat-mobile/data/auth/flow.ts`, PKCE). Trang đó có nút "Tiếp tục với Google"
  (`packages/views/auth/login-view.tsx` › `GoogleButton`) và link tự đăng ký (`paths.register()`).
- 4.8 (bản 2024): app dùng một dịch vụ đăng nhập bên thứ ba hay mạng xã hội để lập hoặc xác thực tài khoản chính phải
  có thêm một lựa chọn đăng nhập tương đương mà (a) chỉ lấy tên và email, (b) cho người dùng giấu email, (c) không theo
  dõi quảng cáo khi chưa đồng ý. Sign in with Apple thoả cả ba.
- Các ngoại lệ của 4.8 không vừa: "chỉ dùng hệ thống tài khoản riêng của công ty" sai vì có Google; "app doanh nghiệp
  đăng nhập bằng tài khoản tổ chức có sẵn" yếu vì ai cũng tự đăng ký được.
- Tài khoản chỉ có Google không có mật khẩu, và quên mật khẩu không cấp mật khẩu cho tài khoản như vậy
  (`server/internal/service/password_reset.go` › `Request` bỏ qua user không có `password_hash`).

## Các phương án

**A. Sign in with Apple trên trang đăng nhập web, qua server.** Thêm nhà cung cấp OIDC thứ hai bên cạnh Google
(`server/internal/handler/google.go`, `service/googleauth.go`): Services ID và khoá `.p8` từ biến môi trường (thiếu thì
nút ẩn, như Google), client secret là JWT ES256 ký bằng khoá đó, callback `form_post` (POST cross-site, nên cookie
state phải `SameSite=None; Secure`), kiểm `id_token` theo JWKS của Apple (`iss`, `aud`, `exp`, `nonce`), cột
`users.apple_id` (migration mới, ULID không đổi), email relay riêng tư không gộp với tài khoản có sẵn theo email trừ khi
Apple báo `email_verified` và không phải relay. Xoá tài khoản phải gọi `POST https://appleid.apple.com/auth/revoke` với
token đã lưu (Apple bắt buộc với app có Sign in with Apple). Chạy được trong `ASWebAuthenticationSession`, nên app
không cần code native. Chi phí: L. Cần: tài khoản Apple Developer, Services ID, xác minh tên miền `app.uniworkos.com`.

**B. Ẩn Google trên trang đăng nhập khi mở từ app iPhone.** App iOS thêm một tham số vào URL ủy quyền, trang ủy quyền
chuyển nó sang `/login` và `/register`, hai trang ẩn nút Google. 4.8 không còn áp dụng vì app chỉ dùng hệ thống tài
khoản riêng. Chi phí: S. Hệ quả: tài khoản chỉ có Google không đăng nhập được trên iPhone (trừ khi Safari đã có phiên
web), nên phải có thêm "đặt mật khẩu" cho tài khoản chỉ Google trước khi chọn B; trải nghiệm hai nền tảng khác nhau.

**C. Xin ngoại lệ doanh nghiệp trong ghi chú cho reviewer.** Chi phí: gần như không. Rủi ro bị từ chối cao vì có tự
đăng ký và Google; mỗi lần bị từ chối mất vài ngày.

## Quyết định (đề xuất)

1. Chọn **A** trước lần nộp App Store đầu tiên (kể cả TestFlight external testing, vì Beta App Review đọc metadata và
   luồng đăng nhập). TestFlight internal testing không qua review, nên làm được trước khi A xong.
2. Không nộp bản iOS nào để review khi A chưa land: dòng "Sign in with Apple (Apple 4.8)" của checklist trong runbook
   chặn việc nộp.
3. Chỉ dùng **B** nếu A chưa kịp và có hạn nộp cứng, và chỉ khi tài khoản chỉ Google đặt được mật khẩu.
4. Không dùng **C**.

## Hệ quả

- Android và web không đổi; Play không có quy định tương đương.
- Khi A land: test handler cho callback `form_post` (state, nonce, `id_token` sai `aud`/hết hạn bị từ chối), test
  service gộp tài khoản theo `apple_id` và không gộp theo email relay, test xoá tài khoản gọi revoke (giả lập), dòng
  `.env.example` cho các biến Apple, và test giao diện login/register hiện nút Apple khi server bật nó.
- Chính sách quyền riêng tư thêm Apple vào bảng nhà cung cấp ("Đăng nhập bằng Apple, khi bạn chọn"), cùng PR với A
  (`privacy-content.test.ts` đọc bảng của `store/listing.md`).
- Owner action: tạo Services ID và khoá Sign in with Apple khi có tài khoản Apple, và xác minh tên miền.
