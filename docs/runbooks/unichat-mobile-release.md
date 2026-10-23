# unichat-mobile-release — phát hành, OTA và rollback bản mobile UniChat

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** không có alert — runbook vận hành của UniChat M4 (UNI-1836) · **Workflow:** `.github/workflows/chat-mobile-release.yml`, `.github/workflows/chat-mobile-verify.yml`

App `apps/chat-mobile` build trên EAS theo `apps/chat-mobile/eas.json`. Bốn profile:

| Profile | `UNICHAT_ENV` | Phân phối | Kênh OTA | Môi trường EAS | Dùng khi |
| --- | --- | --- | --- | --- | --- |
| `development` | `dev` | internal (dev client) | `development` | `development` | Dev trên máy thật, JS từ Metro |
| `preview` | `staging` | internal (APK / ad hoc, link cài) | `preview` | `preview` | Pilot trước khi có store, QA một nhánh |
| `internal` | `staging` | store → TestFlight, Play internal | `internal` | `preview` | Mỗi tag `chat-mobile-v*` |
| `production` | `production` | store (Play: bản nháp) | `production` | `production` | Sau quyết định Q1; phát hành public bấm tay |

`version` trong `apps/chat-mobile/app.config.ts` là version duy nhất và là `runtimeVersion` (`policy: appVersion`):
một bản OTA chỉ tới các bản cài cùng version. Build number (`ios.buildNumber`, `android.versionCode`) do EAS giữ và tự
tăng (`appVersionSource: remote`), không commit. Đổi native (gói có mã native, plugin hay quyền trong `app.config.ts`,
nâng SDK Expo) → bump `version` và cắt tag mới; chỉ đổi JS/asset → OTA, không bump.

**Thiết lập lần đầu (khi có tài khoản, UNI-1838)**

1. EAS: tài khoản tổ chức Expo. `cd apps/chat-mobile && eas init` (dự án `unichat`), ghi id vào hằng `EAS_PROJECT_ID`
   trong `app.config.ts` qua PR (không phải bí mật). Từ đó app có `updates.url` và đăng ký push.
2. Biến máy chủ trong EAS, cho `preview` và `production`:
   `eas env:create --environment preview --name UNICHAT_API_URL --value <url> --visibility plaintext`, tương tự
   `UNICHAT_APP_URL`. Thiếu thì build staging/production đỏ với `UNICHAT_API_URL is required when UNICHAT_ENV=…`.
3. Apple: Apple Developer Program (tổ chức). App Store Connect: tạo app `com.uniworkos.chat.staging` (bản `internal`;
   `com.uniworkos.chat` khi tới production). `eas credentials -p ios` để EAS tạo chứng chỉ phân phối và profile. Tạo
   App Store Connect API key (vai trò App Manager), tải lên EAS qua `eas credentials -p ios`. Ghi Apple ID số của app
   vào `submit.internal.ios.ascAppId` trong `eas.json`. TestFlight: nhóm thử nội bộ, thêm người thử.
4. Google: Play Console, tạo app `com.uniworkos.chat.staging`. Bản AAB đầu tiên phải tải tay (API của Google không tạo
   được bản đầu): `eas build -p android --profile internal`, tải `.aab` lên Internal testing. Service account Google
   Cloud có quyền phát hành trên app → khoá JSON tải lên EAS (`eas credentials -p android`, mục khoá cho submit). Khoá
   FCM V1 cho push cũng tải lên EAS ở cùng màn đó (khoá khác). Push Android còn cần `google-services.json` của dự án
   Firebase (app `com.uniworkos.chat`, `.staging`, `.dev`) làm biến EAS kiểu file:
   `eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment <env>` cho
   `development`, `preview`, `production` — `app.config.ts` chuyển nó vào `android.googleServicesFile`. Danh sách đầy
   đủ tài khoản và tên khoá: `docs/evidence/unichat/release-accounts.md`.
5. GitHub → Settings → Environments → `chat-mobile-release`: giới hạn tag `chat-mobile-v*`, thêm secret `EXPO_TOKEN`
   (robot token của tài khoản Expo tổ chức). Không thêm khoá Apple/Google vào GitHub.
6. Server staging và production: `DESKTOP_AUTH_CLIENTS` có
   `uniwork-chat-mobile=uniworkchat://auth/callback|uniworkchat-dev://auth/callback` (`.env.example`). Universal link
   (`applinks:app.uniworkos.com`) cần Team ID của Apple trong AASA và SHA-256 của khoá Play App Signing trong
   `assetlinks.json` (web, lát N3).
7. Nightly (`chat-mobile-verify.yml`): trên staging, một org thử có một workspace, một **phòng nhóm** (group, không
   phải kênh mặc định của workspace) và một tài khoản thành viên của phòng đó, đăng nhập bằng email/mật khẩu (không
   MFA, không chỉ Google). Phòng nhóm vì cuộc gọi nhóm vào thẳng phòng LiveKit mà không cần người thứ hai; mỗi đêm
   gửi một tin `Maestro <số>` vào phòng. Repository variables `MAESTRO_API_URL`, `MAESTRO_APP_URL`,
   `MAESTRO_ORG_SLUG`, `MAESTRO_WS_SLUG`, `MAESTRO_ROOM_ID`; secrets `MAESTRO_TEST_EMAIL`, `MAESTRO_TEST_PASSWORD`.
   Lịch chạy chỉ có hiệu lực khi workflow nằm trên `main`; trước đó chạy tay bằng "Run workflow".

**Cắt một bản store**

1. Trên `develop`/`main`, `version` trong `app.config.ts` là version mới nếu có đổi native từ tag trước.
2. `git tag chat-mobile-v<version> <sha>` rồi `git push origin chat-mobile-v<version>`.
3. Workflow: gate `EXPO_TOKEN` → commit trên `main`/`develop` → tag khớp `version` → `eas build --platform all
   --profile internal --non-interactive --auto-submit`. Apple xử lý bản build 15–30 phút trước khi hiện ở TestFlight;
   Play internal hiện ngay sau submit. Người thử cài qua lời mời TestFlight và link opt-in của Play internal.

**Bản cài trực tiếp (chưa có store)**: `eas build -p android --profile preview` cho link tải APK. iOS ad hoc cần Apple
Developer và đăng ký máy (`eas device:create`) trước `eas build -p ios --profile preview`.

**OTA (chỉ JS)**: `cd apps/chat-mobile && eas update --channel internal --environment preview --message "UNI-nnn: …"`
(production: `--channel production --environment production`). App tải bản mới lúc mở và áp dụng ở lần mở sau.

## Triệu chứng

- Run release xanh với notice `EXPO_TOKEN is not set` — đúng khi chưa thiết lập; sau thiết lập là thiếu secret.
- Run release đỏ: `… is on neither main nor develop`, `… does not match app.config.ts version`, `eas build` (cấu hình,
  cài gói, biên dịch native) hoặc submit (khoá ASC/Play, `ascAppId`, bản Play đầu chưa tải tay,
  `Only releases with status draft may be created on draft app`).
- Bản mới không hiện ở TestFlight/Play internal sau 1 giờ.
- OTA không tới máy, tới nhầm bản native, hoặc bản OTA làm app lỗi/crash.
- Nightly: notice `Maestro skipped, not set: …`; đỏ ở bước build; đỏ ở bước Maestro (`Sign in`, `Push opens the room`).

## Kiểm tra

1. Bản build: `eas build:list --platform all --limit 5` (trạng thái, version, build number, profile); log ở link EAS
   trong run của workflow.
2. Version: `pnpm --filter @uniwork/chat-mobile exec expo config --type public --json | jq .version` bằng phần sau
   `chat-mobile-v` của tag.
3. OTA: `eas update:list --branch internal` — cột runtime version phải bằng version của bản cài đang lỗi/đang chờ;
   `eas channel:view internal` cho biết kênh trỏ nhánh nào.
4. Cấu hình một biến thể: `UNICHAT_ENV=staging UNICHAT_API_URL=… UNICHAT_APP_URL=… pnpm --filter
   @uniwork/chat-mobile exec expo config --type public` (tên, bundle id, scheme, `updates`, `extra`).
5. Nightly: artifact `maestro-ios` / `maestro-android` của run chỉ có ảnh chụp màn hình (log lệnh của Maestro ghi mật
   khẩu đã gõ và repo công khai, nên không tải lên); log từng bước nằm trong log của job. Bước đầu đỏ là nguyên nhân,
   các bước sau thường là hệ quả.

## Khắc phục

1. Tag sai hoặc commit ngoài `main`/`develop`: `git push origin :refs/tags/<tag>`, `git tag -d <tag>`, tag lại.
2. Tag không khớp version: sửa `version` qua PR rồi tag lại, hoặc tag đúng version đang có.
3. `UNICHAT_API_URL is required`: thêm biến vào môi trường EAS (Thiết lập lần đầu, bước 2), "Re-run failed jobs".
4. Lỗi submit: sửa khoá/`ascAppId` theo bước 3–4 rồi `eas submit -p <ios|android> --profile internal --latest`
   (không build lại). Play báo app nháp: hoàn tất thiết lập app trên Play Console, hoặc tạm đặt
   `"releaseStatus": "draft"` cho `submit.internal.android` và phát hành tay trên Console.
5. **Rollback OTA** (nhanh nhất, cho lỗi chỉ ở JS):
   - Phát lại bản tốt trước: `eas update:list --branch internal` lấy group id của bản tốt, rồi
     `eas update:republish --group <group-id> --message "rollback"`.
   - Hoặc quay về bản nhúng trong binary: `eas update:roll-back-to-embedded --branch internal --runtime-version <version>`.
   Máy nhận ở lần mở tiếp theo. Sau đó sửa và phát OTA mới.
6. **Rollback bản store** (lỗi native, hoặc OTA không cứu được): store không cho hạ build number, nên đi tới. Revert
   trên `develop`, bump `version` (patch), tag. Trong lúc chờ: TestFlight → build lỗi → Expire build; Play Console →
   Internal testing → tạm dừng/thay release bằng bản mới. OTA cũ không áp vào bản mới vì runtime version khác.
7. Nightly đỏ ở `Join a call` với cuộc gọi cũ còn treo trong phòng thử (một đêm trước dừng giữa cuộc gọi): kết thúc
   nó từ web bằng tài khoản thử rồi "Re-run failed jobs".
8. Nightly đỏ ở sheet đăng nhập nhiều đêm liền mà app không đổi: chụp màn từ artifact, đối chiếu nút/nhãn của trang
   login/consent web với `apps/chat-mobile/maestro/subflows/sign-in.yaml`; web đổi chữ thì sửa subflow cùng PR đó.
9. Khoá Apple/Google hết hạn hoặc lộ: thu hồi ở Apple/Google, tạo khoá mới, tải lại bằng `eas credentials`; `EXPO_TOKEN`
   lộ: thu hồi robot token trên expo.dev, tạo token mới vào Environment.

## Leo thang

- Tài khoản Apple Developer, Google Play Console, Expo tổ chức, chứng chỉ và khoá: người giữ tài khoản (UNI-1838).
- EAS sự cố: <https://status.expo.dev>; app đang cài vẫn chạy, chỉ chậm build/OTA. GitHub: <https://www.githubstatus.com>.
- Bản lỗi làm app không mở được để nhận OTA hay bản sửa (expo-updates tự quay về bản nhúng khi bản OTA crash lúc mở;
  nếu chính binary lỗi thì không): chủ epic UNI-1826, báo người thử gỡ và cài lại bản tốt qua TestFlight/Play.
