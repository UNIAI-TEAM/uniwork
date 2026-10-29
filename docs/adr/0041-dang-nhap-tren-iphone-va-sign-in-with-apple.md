# 0041 — Đăng nhập trên iPhone: Sign in with Apple trước lần nộp App Store đầu tiên

**Trạng thái:** accepted (2026-10-23, UNI-2141, sub của UNI-2053). Mục 2 (tạo tài khoản ngầm khi không khớp, tài khoản MFA về trình duyệt, Apple chỉ vào qua `POST /auth/apple/native`) và mục 4 (web và Android không đổi) bị thay bởi [0049](0049-dang-nhap-thong-nhat-tren-moi-nen-tang.md) ngày 2026-10-27; các mục còn lại vẫn giữ. Đề xuất ngày 2026-10-22 với số tạm 0041 (giữ số,
`README.md` đã dành 0038–0041 cho các bản nháp mobile). Chấp nhận phương án A ở phần server (OIDC của Apple kiểm ở
server, liên kết theo `apple_id`, không gộp email relay, thu hồi token khi xoá tài khoản), với nút Apple **native** trên
màn đăng nhập của app thay vì nút trên trang web (mục "Quyết định" nói vì sao).
**Liên quan:** [0011](0011-mobile-la-app-expo-doc-lap.md) (UniChat mobile đăng nhập qua trình duyệt hệ thống, PKCE),
[0038](0038-cuoc-goi-native-android-va-ke-hoach-callkit-ios.md) (cuộc gọi native; phần iOS đi PushKit + CallKit),
`docs/runbooks/unichat-mobile-release.md` › App Store Connect.

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
- Apple đòi app có Sign in with Apple thu hồi token của người dùng khi họ xoá tài khoản (`POST
  https://appleid.apple.com/auth/revoke`), và chỉ lần đổi authorization code mới trả token để thu hồi.

## Các phương án

**A. Sign in with Apple trên trang đăng nhập web, qua server.** Nhà cung cấp OIDC thứ hai bên cạnh Google: Services
ID, callback `form_post` (POST cross-site, cookie state `SameSite=None; Secure`), xác minh tên miền `app.uniworkos.com`,
kiểm `id_token` theo JWKS của Apple, cột `users.apple_id`, không gộp email relay, thu hồi khi xoá tài khoản. App không
cần code native. Chi phí: L.

**A′. Như A ở server, nhưng nút Apple native trên màn đăng nhập của app.** `expo-apple-authentication` mở sheet của
Apple; app gửi identity token (aud là bundle id), nonce gốc, authorization code và tên (chỉ lần đầu) tới server; server
kiểm và trả **phiên native** như lần đổi code PKCE. Không cần Services ID, callback hay xác minh tên miền. Chi phí: M.

**B. Ẩn Google trên trang đăng nhập khi mở từ app iPhone.** 4.8 không còn áp dụng; tài khoản chỉ Google phải có "đặt
mật khẩu" trước; trải nghiệm hai nền tảng khác nhau. Chi phí: S.

**C. Xin ngoại lệ doanh nghiệp trong ghi chú cho reviewer.** Rủi ro bị từ chối cao vì có tự đăng ký và Google.

## Quyết định

1. Chọn **A′** trước lần nộp App Store đầu tiên (kể cả TestFlight external testing). Lý do chọn nút native thay vì nút
   web của A: màn đăng nhập của app là màn reviewer thấy đầu tiên, HIG của Apple muốn nút hệ thống
   (`ASAuthorizationAppleIDButton`) và không đặt nó thấp hơn lựa chọn khác, Face ID thay cho gõ mật khẩu Apple trong
   trình duyệt, và không có callback cross-site hay Services ID nào phải vận hành. Phần server của A giữ nguyên.
2. Route `POST /api/v1/auth/apple/native` (công khai, ngân sách credential 60/phút/địa chỉ):
   - kiểm identity token theo JWKS của Apple (`https://appleid.apple.com/auth/keys`, cache trong key set, tải lại khi gặp
     `kid` lạ): `iss` = `https://appleid.apple.com`, `exp`, `aud` thuộc `APPLE_SIWA_AUDIENCES` (bundle id production và
     staging), `nonce` = SHA-256 (hex) của nonce gốc app gửi kèm (`auth.AppleVerifier`);
   - tìm tài khoản theo `users.apple_id`; không có thì theo email **chỉ khi** Apple xác minh email, email không phải
     relay riêng tư (`is_private_email`) và email của tài khoản có sẵn đã xác minh — còn lại trả 409
     `apple_account_conflict`, không gộp; không có tài khoản nào thì tạo tài khoản không mật khẩu qua đúng đường đăng ký
     bằng nhà cung cấp mà Google dùng (`email_verified_at` có, `onboarded_at` để trống: onboarding vẫn ở phía trước);
   - tài khoản bật MFA nhận 403 `mfa_required` (bước hai chỉ hỏi ở trình duyệt) và không được liên kết;
   - trả phiên thiết bị native cùng hình với `POST /auth/desktop/exchange` (`DesktopAuthService.issueDeviceSession`),
     audit `auth.login_succeeded` (`via: apple`) và `auth.desktop_session_created`;
   - sau commit (best effort, như mail đăng nhập mới của trình duyệt): liên kết theo email gửi cho chủ tài khoản mail
     `apple_linked` (thiết bị, IP, thời điểm, link tới các phiên đang mở); không thì tài khoản đã có phiên trước lần
     này nhận mail `new_login` ghi thiết bị của app. Tài khoản vừa tạo và lần đăng nhập bị từ chối không nhận gì.
3. Server đổi authorization code lấy refresh token của Apple (client secret ES256 ký bằng khoá Sign in with Apple
   `APPLE_SIWA_KEY_ID`/`APPLE_SIWA_PRIVATE_KEY` của team `APPLE_SIWA_TEAM_ID`), giữ nó **mã hoá**
   (`users.apple_refresh_token_enc`, cùng bundle id ở `users.apple_client_id`) chỉ để thu hồi: xoá tài khoản xoá các
   cột Apple trong cùng giao dịch ẩn danh hoá, rồi gọi `/auth/revoke` sau commit (best effort, log theo mã, không bao
   giờ log token). Token Apple cấp cho một lần đăng nhập bị từ chối (conflict, MFA) được trả lại ngay. Thiếu khoá thì
   đăng nhập vẫn chạy và server log cảnh báo lúc khởi động.
4. Nút Apple chỉ hiện trên iPhone có Sign in with Apple **và** khi server bật nó (`GET /auth/providers` › `apple`),
   nằm trên nút "Đăng nhập UniWork" (trình duyệt), kiểu hệ thống "Continue with Apple", đen trên nền sáng và trắng trên
   nền tối. Android và web không đổi; nút Apple trên trang web là việc sau nếu cần.
5. Không nộp bản iOS nào để review khi các owner action dưới đây chưa xong (checklist của runbook chặn việc nộp).
   Không dùng B trừ khi A′ hỏng và có hạn nộp cứng; không dùng C.

## Hệ quả

- Server: `server/internal/auth/apple.go` (verifier), `apple_client.go` (token/revoke), `service/appleauth.go`,
  `handler/apple_auth.go`, migration `users.apple_id` (+ unique index `CONCURRENTLY`). Test giữ luật:
  `TestAppleVerifierRefusesWhatAppleDidNotIssueForThisApp` (aud sai, hết hạn, nonce sai hay nonce gốc trong token, iss
  sai, chữ ký giả), `TestAppleSignInLinksOnlyAVerifiedAddressThatIsNotARelay`,
  `TestAppleSignInSendsAnMFAAccountToTheBrowserWithoutLinking`, `TestDeleteAccountRevokesTheAppleToken`,
  `TestAppleSignInTellsTheOwnerOfTheLinkAndOfEveryNewSession` (mail `apple_linked` và `new_login`, vi/en,
  `server/internal/mail/templates/`),
  `TestAppleSignInRefusals` (handler), `TestAppleNativeSignInRidesTheCredentialBudget`, và dòng
  `POST /api/v1/auth/apple/native` trong `isoRoutes` của `TestIsolationMatrix`.
- App: `data/auth/apple.ts` (nonce, sheet), `data/auth/apple-transport.ts` (hai route), `MobileSession.loginWith`
  (phiên do server cấp không qua trình duyệt), `components/auth/apple-sign-in-button.tsx`, plugin
  `expo-apple-authentication` (entitlement `com.apple.developer.applesignin`) — `app.config.test.ts`,
  `data/auth/apple-transport.test.ts`, `data/auth/session-login-with.test.ts`, `test/routes/entry.test.tsx`.
- Chính sách quyền riêng tư thêm Apple vào bảng nhà cung cấp và dòng "Đăng nhập bằng Apple (chỉ iPhone)" của
  `store/listing.md` (`privacy-content.test.ts`).
- Xoá tài khoản chỉ Apple vẫn xác nhận bằng cách gõ lại email; với email relay thì đó là địa chỉ dài của Apple (app hiện
  nó làm placeholder). Xác nhận lại bằng sheet của Apple là việc sau.
- Tài khoản tạo bằng Sign in with Apple chưa vào được workspace nào chỉ bằng điện thoại. Lời mời chỉ đọc và nhận
  được bởi tài khoản đã chứng minh đúng hộp thư được mời (`invitation_accept.go` › `sameMailbox`); app chưa có màn
  nhận lời mời, và trên web tài khoản chỉ có Apple không đăng nhập được (web chưa có nút Apple, không có mật khẩu, quên
  mật khẩu bỏ qua nó). Với Ẩn địa chỉ email (Hide My Email) còn tệ hơn: địa chỉ của tài khoản là địa chỉ relay của
  Apple nên lời mời gửi tới email công việc thuộc về tài khoản khác. Hiện giờ màn workspace trống của tài khoản relay
  nói điều đó và chỉ đường đang đi được: đăng xuất rồi đăng nhập qua trình duyệt bằng email đã được mời
  (`mobile.account.no_workspace_relay`, `lib/apple-relay.ts`, `test/routes/entry.test.tsx`; từ 2026-10-29, UNI-2287,
  `lib/apple-relay.ts` nhường chỗ cho `isAppleRelayEmail` của `packages/core/auth/sign-in-rules.ts`, nhận cả
  `private.icloud.com`). Việc sau, owner là luồng mobile UNI-2053, cần xong trước khi mở App Store cho người ngoài
  TestFlight: nhận lời mời ngay trong app
  (`GET /api/v1/me/invitations` đã có), hay thêm và xác minh một địa chỉ thứ hai cho tài khoản; cân nhắc gợi ý chọn
  "Chia sẻ email của tôi" cạnh nút Apple cho người vào workspace công ty.
- Mail tới địa chỉ relay (mã xác minh, `new_login`, lời mời) chỉ tới được người dùng khi tên miền gửi mail của
  UniWork đã đăng ký với Private Email Relay Service của Apple (Certificates, Identifiers & Profiles › Services › Sign
  in with Apple for Email Communication) và qua SPF/DKIM. Owner action, cùng nhóm bên dưới.
- Server-to-server notification của Apple (người dùng gỡ quyền từ cài đặt Apple ID) chưa được nhận: phiên native vẫn
  sống tới khi hết hạn hay bị thu hồi. Việc sau.
- Owner action: bật capability Sign In with Apple cho App ID `com.uniworkos.chat` (và `.staging`) — EAS bật khi ký nếu
  dùng credential do EAS quản lý; tạo khoá Sign in with Apple (Keys) gắn App ID chính; đặt `APPLE_SIWA_AUDIENCES`,
  `APPLE_SIWA_TEAM_ID`, `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY` trên server rồi deploy (chạy migration).
