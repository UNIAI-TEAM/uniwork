# 0049 — Đăng nhập thống nhất: một tài khoản, cùng phương thức trên web, máy tính và điện thoại

**Trạng thái:** accepted (2026-10-27) — chủ sản phẩm duyệt hướng trong phiên thiết kế ngày 2026-10-27. Thay mục 2
(tạo tài khoản ngầm, tài khoản MFA về trình duyệt, Apple chỉ vào qua `POST /auth/apple/native`) và mục 4 (web và
Android không đổi) của [0041](0041-dang-nhap-tren-iphone-va-sign-in-with-apple.md); thay quyết định "UniChat mobile
đăng nhập qua trình duyệt hệ thống" của spec nền mobile
(`docs/superpowers/specs/2026-10-16-unichat-mobile-foundation-design.md` §3.3). Phần còn lại của 0041 (kiểm identity
token theo JWKS, liên kết theo `apple_id`, không gộp email relay, thu hồi token khi xoá tài khoản) giữ nguyên. Spec:
`docs/superpowers/specs/2026-10-27-dang-nhap-thong-nhat-design.md`.
**Liên quan:** [0007](0007-actor-kind-agent-la-actor-hang-nhat.md) (attribution), [0011](0011-mobile-la-app-expo-doc-lap.md)
(mobile là app Expo độc lập), [0012](0012-audit-bat-bien-bang-quyen-db-va-trigger.md) (audit),
[0031](0031-uniwork-la-oauth-server-cho-client-ai-ben-ngoai.md), [0032](0032-mot-tai-khoan-mot-to-chuc.md) (một người
một tổ chức), [0041](0041-dang-nhap-tren-iphone-va-sign-in-with-apple.md).

## Bối cảnh

- Web có email + mật khẩu và Google. iPhone có Sign in with Apple native và "Đăng nhập UniWork" qua trình duyệt.
  Android và desktop chỉ có trình duyệt. Mỗi nền tảng một bộ cách vào, nên một người dùng Apple trên iPhone không
  vào được web (không mật khẩu, quên mật khẩu bỏ qua tài khoản không mật khẩu, web không có nút Apple).
- Khi danh tính Google/Apple không khớp tài khoản nào, server **tạo ngay** một tài khoản mới. Với nhân viên công ty,
  Apple ID thường là email cá nhân khác email công việc, nên phần lớn lần bấm Apple sinh ra một tài khoản trống,
  không thuộc tổ chức nào, không nhận được lời mời (ADR 0041 › Hệ quả).
- Không có cách đặt hay đổi mật khẩu khi đã đăng nhập, không có cách liên kết hay gỡ Google/Apple. Chủ tổ chức chỉ có
  Google bị chặn ở chuyển quyền sở hữu (`password_required`) mà không có đường ra.
- Lỗi bảo mật: Google liên kết theo email mà **không kiểm** tài khoản có sẵn đã xác minh email
  (`GoogleAuthService.SignIn`, `LinkGoogleAccount`), rồi đánh dấu nó đã xác minh. Người đăng ký trước bằng email của
  nạn nhân giữ được mật khẩu của mình sau lần nạn nhân đăng nhập Google đầu tiên (pre-account takeover). Google còn
  liên kết **trước** bước MFA và không ghi audit.

## Quyết định

1. **Một bộ phương thức ở mọi nơi.** Email + mật khẩu, Google, Apple, và bước xác thực hai lớp. Web có cả ba; máy
   tính (UniChat desktop, UniWork Office) đăng nhập qua trang web nên có theo; app iPhone/Android có màn đăng nhập
   **trong app**: mật khẩu, Google native (SDK), Apple (sheet native trên iPhone, qua trình duyệt trên Android), hai
   lớp, đăng ký bằng email. Đăng nhập qua trình duyệt (PKCE) còn lại là đường phụ. Nút nhà cung cấp đứng trên form ở
   mọi nền tảng.
2. **Một bộ quy tắc khớp tài khoản cho mọi nhà cung cấp** (`service/identity_resolve.go`), đánh giá theo thứ tự cố định:
   (a) khớp mã định danh của nhà cung cấp (`google_id`, `apple_id`);
   (b) không có thì theo email đã được nhà cung cấp xác minh. Chỉ email **thuộc quyền nhà cung cấp** (Gmail hay `hd`
   của Workspace; iCloud hay relay của Apple) mới được tự liên kết hay thu hồi; email khác chỉ cho "đăng nhập để liên
   kết". Tài khoản có sẵn **chưa** xác minh email bị **thu hồi về chủ hộp thư** trước mọi kiểm tra khác và **không hỏi
   bước hai**: xoá mật khẩu, TOTP, mã khôi phục, mọi danh tính nhà cung cấp, phiên, phiên thiết bị, MCP grant, push,
   lượt đồng ý desktop/MCP đang mở do người chưa chứng minh hộp thư để lại. Tài khoản chưa xác minh không bật được MFA
   và không liên kết được nhà cung cấp, nên không cài được gì sống qua lần thu hồi. Quên mật khẩu trên tài khoản chưa
   xác minh là thu hồi theo hộp thư. Tài khoản đã xác minh → liên kết (bật MFA thì chỉ ghi sau khi bước hai qua); danh
   tính chủ tài khoản đã **gỡ** thì không tự liên kết lại theo email;
   (c) không khớp ai → **không tạo tài khoản**: server cấp một vé đăng nhập và client hiện màn chọn "Tôi đã có tài
   khoản" / "Tôi được mời bằng email khác" (mã gửi tới email công việc, rồi liên kết, thu hồi hay tạo theo địa chỉ đó) /
   "Tạo tài khoản mới". Bấm nhà cung cấp từ màn đăng ký (`intent=sign_up`) thì tạo ngay. Danh tính đang nằm ở một tài
   khoản **chưa từng vào tổ chức nào** được chuyển sang tài khoản đang liên kết khi người dùng xác nhận.
3. **Blob đưa cho client được niêm phong theo mục đích**: `SecretSealer.SealFor/OpenFor(purpose)` đặt mục đích làm
   additional data của AES-GCM với khoá con HKDF riêng; blob của mục đích này không mở được ở mục đích khác. Vé đăng
   nhập (15 phút) gắn kênh: vé web chỉ trong cookie HttpOnly, vé native chỉ trong JSON và chỉ dùng được cùng nonce gốc
   app giữ. Liên kết từ vé chỉ nhận phiên mở **sau** khi vé được cấp; không thì phải có bằng chứng. Vé không lưu bảng:
   tạo và liên kết đều idempotent nhờ unique index.
4. **Token thử thách MFA gắn kênh** (`web` | `native` + client + deployment) và mang danh tính chờ liên kết. Route
   native trả `mfa_required` + token thay cho 403. Mười lần sai bước hai hay bằng chứng khoá 15 phút và báo mail.
5. **Mọi thay đổi nhạy cảm cần một step-up token** 10 phút, gắn với phiên đang dùng, lấy bằng: TOTP nếu bật hai lớp;
   không thì mật khẩu, mã 6 số gửi tới email tài khoản (mã nói rõ việc nó cho phép, không nhận mã dev), hay trên app
   token Apple/Google mới của danh tính đã liên kết. Áp cho đặt/đổi mật khẩu, liên kết, gỡ liên kết, **bật MFA**, xoá
   tài khoản, chuyển quyền sở hữu và chuyển tổ chức khi nhận lời mời (bỏ `password_required`). Không bao giờ gỡ phương
   thức cuối, không gỡ Apple của tài khoản có email relay. Đổi mật khẩu hay gỡ liên kết luôn thu hồi mọi phiên khác
   (web, thiết bị, MCP grant) và đánh dấu `credentials_revoked_at` để lệnh nhạy cảm từ chối access token cũ hơn. Mỗi
   thay đổi ghi audit và xếp mail trong cùng giao dịch.
6. **Liên kết từ Cài đặt trên web** đi qua trình duyệt đang đăng nhập: lệnh bearer (kèm step-up token) trả
   `authorization_url` mang `link_token` 5 phút gắn `user_id` + `session_id`; `start` và đầu nhận kết quả chỉ chấp nhận
   khi cookie refresh của chính trình duyệt đó thuộc đúng phiên còn sống ấy. Danh tính đang ở một tài khoản trống thì
   vé để lại cho phép chính phiên ấy xác nhận chuyển không cần bằng chứng mới, nhưng chỉ tới hạn của step-up token đã
   cho bắt đầu liên kết. Trong shell desktop và Android-với-Apple,
   nút liên kết mở trang Cài đặt web ở trình duyệt hệ thống. App liên kết Google (SDK) và Apple trên iPhone (sheet)
   bằng lệnh bearer mang identity token.
7. **Sign in with Apple trên web**: Services ID (`APPLE_SIWA_WEB_CLIENT_ID`) gộp với primary App ID để `sub` trùng với
   app; `response_mode=form_post`; cookie state `SameSite=None; Secure`; callback POST chỉ đổi code (có `redirect_uri`)
   và kiểm token rồi chuyển sang một GET cùng site để có cookie phiên; verifier web và native tách audience. Google web
   thêm PKCE, nonce và luôn chọn tài khoản.
8. **Route native** dưới `/api/v1/auth/native/*`, chỉ cho client native khai trong `NATIVE_SIGN_IN_CLIENTS`, trả một
   kiểu kết quả: `signed_in`, `mfa_required`, `identity_unmatched` hay `link_required`. Google native bắt buộc nonce và
   `azp` là client app. `POST /auth/apple/native` giữ hợp đồng cũ (mã lỗi cũ, tạo ngay) qua bộ chuyển mã cho bản app đã
   phát hành, hạn xem lại 2027-01-31.
9. **Route công khai mở phiên chống login CSRF**: từ chối `Sec-Fetch-Site: cross-site` và body không phải JSON. Ngân
   sách thử có tên: mật khẩu theo địa chỉ + email (web và native chung), bước hai theo người, step-up theo người.
10. `/auth/providers` thêm cờ, không đổi nghĩa cờ cũ: `google` (web), `apple` (native iPhone, như 0041), `apple_web`,
    `google_native`.

## Hệ quả

- Server: `identity_resolve.go`, `sign_in_ticket.go`, `step_up.go`, `sign_in_methods.go`, `native_sign_in.go`,
  `handler/web_sign_in.go`, `handler/apple_web.go`; cột mới trên `users` (`google_*`/`apple_*` email, ngày liên kết,
  subject đã gỡ; `password_changed_at`, `credentials_revoked_at`, bộ đếm bước hai), `email_verification_codes.purpose`
  và `action`, bảng `sign_in_email_claims`; audit `auth.sign_in_method_linked`, `auth.sign_in_method_unlinked`,
  `auth.password_set` (đổi mật khẩu dùng lại `auth.password_changed`, `via: settings`); mail `sign_in_method_changed`
  (thay `apple_linked`), `step_up_code`, `sign_in_email_claim`. `TestOnlyBrowserFlowsRedirect` cho phép thêm
  `handler/web_sign_in.go` và `handler/apple_web.go`.
- Test giữ luật: `TestProviderSignInLinksByEmailOnlyWhenBothSidesVerified`, `TestProviderSignInTrustsOnlyAuthoritativeEmail`,
  `TestProviderSignInReclaimsAnUnverifiedAccount`, `TestReclaimNeverAsksTheSquattersSecondFactor`,
  `TestUnverifiedAccountsCannotEnrolMFAOrLink`, `TestAnUnlinkedProviderIsNotRelinkedByEmail`,
  `TestProviderSignInWithoutAMatchIssuesATicketNotAnAccount`, `TestSignInTicketIsBoundToItsChannel`,
  `TestTicketLinkNeedsASessionStartedAfterTheTicket`, `TestSealedBlobsDoNotCrossPurposes`,
  `TestMFAChallengeIsBoundToItsChannel`, `TestLinkWaitsForTheSecondFactor`, `TestSecondFactorLocksAfterTenFailures`,
  `TestSignInMethodChangesNeedAProof`, `TestMFAEnrolmentNeedsAProof`, `TestStepUpTokenDiesWithItsSession`,
  `TestTheLastSignInMethodCannotBeRemoved`, `TestPasswordChangeRevokesEveryOtherSession`,
  `TestLinkStartNeedsTheSameBrowserSession`, `TestAppleWebCallbackChecksStateNonceAndAudience`,
  `TestWebAndNativeAppleAudiencesStayApart`, `TestGoogleNativeNeedsANonceAndTheAppAzp`,
  `TestNativeDoorsTakeOnlyNativeClients`, `TestLegacyAppleNativeKeepsItsCodes`, `TestCredentialRoutesRefuseCrossSiteForms`.
- Web: nút Apple cạnh Google trên đăng nhập/đăng ký (và vì vậy desktop), trang `/auth/continue` (màn chọn), mục
  "Phương thức đăng nhập" đầu tab Bảo mật (lên cả cài đặt UniChat desktop) và trang `/settings` cho người chưa có
  workspace; mọi lệnh nhạy cảm dùng chung một hộp "xác nhận là bạn".
- Mobile: màn đăng nhập, hai lớp, màn chọn, đăng ký + xác minh email, mục Phương thức đăng nhập, nhận lời mời trong
  app; Google qua module Expo riêng `modules/unichat-google-sign-in` trên API có nonce của Google (GoogleSignIn 9,
  Credential Manager), vì bản miễn phí của `@react-native-google-signin/google-signin` không có nonce (native, version
  app lên 0.4.0). Đăng nhập trình duyệt giữ làm đường phụ. `apps/chat-mobile/CLAUDE.md` và MASVS cập nhật theo.
- Chính sách quyền riêng tư và store listing: Apple không còn "chỉ iPhone"; Google có SDK trên mobile.
- 2026-10-29 (UNI-2287): Apple cấp địa chỉ relay mới của Sign in with Apple ở `private.icloud.com` thay
  `privaterelay.appleid.com` (địa chỉ cũ vẫn chuyển thư; Ẩn địa chỉ email của iCloud+ vẫn ở `icloud.com`). Cả hai tên
  miền là relay và thuộc quyền Apple ở mục 2, so khớp đúng tên miền sau `@` cuối. Mỗi phía giữ một danh sách: server
  `appleRelayDomains` (`identity_resolve.go`), core `APPLE_RELAY_DOMAINS` (`packages/core/auth/sign-in-rules.ts`, web
  và điện thoại cùng đọc). `TestAppleRelayDomainsMatchTheClients` (`server/internal/service/apple_relay_domains_test.go`,
  job backend chạy ở mọi PR) hỏng khi hai danh sách khác nhau, `TestNoOtherServerSourceNamesAnAppleRelayDomain` khi mã
  server khác tự chép quy tắc, `scripts/apple-relay-domains.test.mjs` khi mã web hay điện thoại tự chép.
- Owner action: tạo Services ID cho web (gộp với `com.uniworkos.chat`, return URL
  `https://<API_PUBLIC_URL>/api/v1/auth/apple/callback`), đặt `APPLE_SIWA_WEB_CLIENT_ID`; tạo OAuth client Google trong
  cùng Google Cloud project với client web: iOS một client mỗi bundle id (`com.uniworkos.chat`, `.staging`, `.dev`),
  Android một client mỗi package cộng SHA-1 của khoá ký (khoá của EAS mỗi biến thể, và khoá Play App Signing cho bản
  phát hành qua Play); đặt `UNICHAT_GOOGLE_IOS_CLIENT_ID` (client iOS của biến thể) và `UNICHAT_GOOGLE_WEB_CLIENT_ID`
  (client web, `GOOGLE_CLIENT_ID` của server) trong từng môi trường EAS, và mọi client iOS, Android vào
  `GOOGLE_NATIVE_CLIENT_IDS` của server (thiếu thì app đi Google qua trình duyệt); đặt `UNICHAT_IOS_TEAM_ID` và
  `UNICHAT_ANDROID_SHA256` (gồm chứng chỉ Play App Signing) trên host web phục vụ `app.uniworkos.com`, nơi AASA và
  assetlinks cho AutoFill gợi ý mật khẩu đã lưu trên màn đăng nhập của app; đăng ký domain gửi mail ở "Sign in with Apple for Email
  Communication" kèm SPF/DKIM (không có thì mã xác nhận không tới được tài khoản relay). Apple web không chạy được trên
  `http://localhost` (Apple chỉ nhận return URL https, cookie `SameSite=None` cần `Secure`): thử trên staging hay qua
  tunnel https. Tải ảnh logo Sign in with Apple của Apple (developer.apple.com/design/resources) làm asset của app rồi
  thay dấu `logo-apple` của Ionicons trong pill Apple tự vẽ (`ProviderButton`, Android; và pill iOS theo ngôn ngữ của
  app nếu chọn làm). Ở archive 0.4.0 đầu tiên, xem privacy report của Xcode cho manifest của GoogleSignIn, AppAuth và
  GTM* (comment trong `app.config.ts` nói chúng không thêm loại dữ liệu nào) trước khi trả lời App Privacy.
- Tiến độ owner action (2026-10-29): không có server staging riêng, bản `.staging` gọi server dev
  `uniwork.unicomhub.com` (EAS `preview`), nên audience Apple và client Google của nó nằm ở env dev, production chỉ nhận
  `com.uniworkos.chat` (`scripts/app-dev-env.test.mjs`). Services ID `com.uniworkos.web` đã tạo cho `uniworkos.com` và
  `uniwork.unicomhub.com` và đặt ở cả hai server; `UNICHAT_IOS_TEAM_ID`, `UNICHAT_ANDROID_SHA256` đã có trên production.
  Client Google (project `uniwork-509403`): bản store có client iOS và một client Android cho mỗi khoá ký Play (khoá
  đang dùng và hai khoá trước), ở `GOOGLE_NATIVE_CLIENT_IDS` của production; bản `.staging` có client iOS và client
  Android (khoá EAS) ở env dev, cùng web client riêng của dev. `UNICHAT_GOOGLE_*` đặt cho EAS `preview` và `production`.
- Chưa làm: thông báo server-to-server của Apple (người dùng gỡ quyền), địa chỉ email thứ hai cho tài khoản relay,
  SSO doanh nghiệp. Bộ quy tắc ở mục 2 là chỗ thêm nhà cung cấp sau.
