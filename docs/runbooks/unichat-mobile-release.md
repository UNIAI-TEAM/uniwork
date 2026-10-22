# unichat-mobile-release — phát hành, OTA và rollback bản mobile UniChat

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** không có alert — runbook vận hành của UniChat M4 (UNI-1836) · **Workflow:** `.github/workflows/chat-mobile-release.yml`, `.github/workflows/chat-mobile-production.yml`, `.github/workflows/chat-mobile-promote.yml`, `.github/workflows/chat-mobile-release-health.yml`, `.github/workflows/chat-mobile-update.yml`, `.github/workflows/mobile-verify.yml`, `.github/workflows/chat-mobile-verify.yml`

App `apps/chat-mobile` build trên EAS theo `apps/chat-mobile/eas.json`. Năm profile:

| Profile | `UNICHAT_ENV` | Phân phối | Kênh OTA | Môi trường EAS | Dùng khi |
| --- | --- | --- | --- | --- | --- |
| `development` | `dev` | internal (dev client) | `development` | `development` | Dev trên máy thật, JS từ Metro |
| `preview` | `staging` | internal (APK / ad hoc, link cài) | `preview` | `preview` | Pilot trước khi có store, QA một nhánh |
| `internal` | `staging` | store → Play internal (TestFlight khi có tài khoản Apple) | `internal` | `preview` | Mỗi tag `chat-mobile-v*` |
| `production` | `production` | store → internal track của app production, rồi promote | `production` | `production` | `chat-mobile-production.yml` từ tag trên `main`; phát hành theo giai đoạn (mục dưới) |
| `production-check` | `production` | không phát hành | `production` | `production` | Chỉ nightly `eas-local`: đúng profile `production`, tắt `autoIncrement` để version code trên store không nhảy |

`version` trong `apps/chat-mobile/app.config.ts` là version store (0.3.0 từ UNI-2053). `runtimeVersion` là
`policy: fingerprint`: hash của phần native (gói có mã native, plugin, cấu hình trong `app.config.ts` trừ `extra`,
xem `apps/chat-mobile/fingerprint.config.js`). Một bản OTA chỉ tới các bản cài cùng fingerprint, nên một thay đổi
native quên bump `version` không còn lọt qua OTA: nó đơn giản không khớp máy nào. Build number (`ios.buildNumber`,
`android.versionCode`) do EAS giữ và tự tăng (`appVersionSource: remote`), không commit. Đổi native → bump `version`
và cắt tag mới; chỉ đổi JS/asset → OTA (dưới đây), không bump. Xem fingerprint của cây hiện tại:
`cd apps/chat-mobile && UNICHAT_ENV=production npx expo-updates runtimeversion:resolve --platform android`
(`runtimeVersion` trong JSON). Biến thể **có** đổi nó: `UNICHAT_ENV` (và `EXPO_BUNDLE_IDENTIFIER_*`) đổi bundle id,
scheme, tên app, tức phần native, nên mỗi biến thể có fingerprint riêng; URL máy chủ, `SENTRY_DSN` và id dự án EAS nằm
trong `extra`, bị loại khỏi hash (`fingerprint.config.js`), không đổi nó. Một bản OTA vì thế phải build đúng biến thể
của bản store trên kênh đó (`staging` cho `internal`/`preview`, `production` cho `production`).

**Cổng trước khi phát hành (CI, ADR 0037 — chặn ở mọi `GATE_LEVEL`)**

- **Branch protection (owner, một lần — audit P0).** Chưa bật thì mọi cổng dưới đây chỉ là tư vấn: một run đỏ vẫn
  merge được. Check bắt buộc của `main` và `develop` nằm ở `scripts/branch-protection.json` (CI chính, `link` của UniAI
  và `UniChat mobile gate`); `scripts/branch-protection.test.mjs` giữ để mỗi tên là một job thật, chạy ở mọi PR, không
  bị path filter (thiếu thì check treo `pending` mãi). Bật bằng tài khoản admin: `gh auth login` rồi
  `node scripts/branch-protection.mjs --apply` (nhánh chưa bảo vệ thì đặt mới, `enforce_admins`; đã có thì chỉ thay
  danh sách check, giữ luật review); kiểm lại bằng `--check` (thoát 1 và in tên còn thiếu). Đổi tên một job trong danh
  sách thì sửa file JSON cùng PR rồi `--apply` lại sau khi merge.
- `mobile-verify.yml` chạy ở **mọi** PR vào `main`/`develop` (không path filter: job `gate` là check bắt buộc), push
  thì theo `MOBILE_PATHS` của `scripts/mobile-native-scope.mjs`. Job `scope` quyết `mobile` (thay đổi chạm app, thứ app
  import, đồ thị cài đặt, bốn workflow mobile, runbook này, và hợp đồng phía server mà test app đọc:
  `docs/events/CATALOGUE.md`, `server/internal/handler/dto/sdo/**`) và `native`. Job `gate` (`UniChat mobile gate`)
  chạy cuối dù các job khác ra sao và đỏ khi một job thay đổi cần mà không `success` — bị skip vì `scope` hỏng cũng đỏ
  (`scripts/mobile-verify-gate.mjs`; GitHub coi job skip là xanh nên không require từng job). Thêm job vào workflow thì
  thêm vào `JOBS` của script đó (`scripts/mobile-workflows.test.mjs` đỏ nếu quên). Với PR có `mobile`: job `mobile` (typecheck, lint, test vitest sàn
  100% và test component jest-expo, `knip --workspace apps/chat-mobile` (file, export, dependency thừa hay thiếu
  khai), `expo install --check` với `EXPO_OFFLINE=1` (gói native đúng version SDK đã cài đòi; offline để một bản vá
  Expo mới ra không làm đỏ mọi PR), các test hợp đồng `scripts/mobile-*.test.mjs` — trong đó
  `mobile-lockfiles.test.mjs` đỏ khi app hay thư mục trên nó có lockfile khác `pnpm-lock.yaml`, thứ làm EAS cài bằng
  npm); `doctor-bundle` (`expo-doctor`
  ghim `EXPO_DOCTOR_VERSION`, rồi `expo export --platform android` cấu hình production, đo bằng
  `scripts/mobile-bundle-budget.mjs` theo `apps/chat-mobile/bundle-budget.json`: bytecode Hermes, gzip, số module);
  `android-release` (`expo prebuild` + `./gradlew :app:assembleRelease`, x86_64) rồi `android-smoke` (APK đó trên
  emulator, `maestro/flows/smoke-launch.yaml`: mở lạnh tới màn đăng nhập) và `ios-release` (macOS: `expo prebuild -p
  ios`, CocoaPods, `xcodebuild -configuration Release -sdk iphonesimulator` ký ad-hoc — không cần tài khoản Apple — rồi
  cùng `smoke-launch.yaml` trên simulator; Xcode ghim ở `XCODE_VERSION`, chọn bằng `scripts/select-xcode.sh`: đúng bản
  đó hoặc bản vá mới nhất của nó, không bao giờ beta hay bản mới hơn image vừa thêm — image thiếu thì job đỏ và liệt kê
  các bản đang có, đổi `XCODE_VERSION` ở cả `mobile-verify.yml` lẫn `chat-mobile-verify.yml` trong một PR) chỉ khi thay
  đổi chạm binary
  (`scripts/mobile-native-scope.mjs`: code/cấu hình/asset của app, đồ thị cài đặt, file `packages/core` app import
  lúc chạy). Không đọc secret: URL máy chủ là placeholder, `SENTRY_DISABLE_AUTO_UPLOAD=true`. Đỏ ở `ios-release` mà
  Android xanh: thường là một plugin cấu hình hay gói native chỉ hỏng phía iOS (Podfile, entitlement, `Info.plist`);
  tái hiện trên máy Mac bằng đúng hai lệnh của job.
- `chat-mobile-release.yml` gọi đúng workflow đó trên SHA của tag (job `verify`, `force_native: true`) trước khi đụng
  EAS: `android-release` và `android-smoke` luôn chạy cho bản phát hành, kể cả tag bị đẩy lại (`git push -f`) mà diff
  không chạm binary. `ios-release` thì không: hai nơi gọi (bản phát hành và `chat-mobile-update.yml`) chỉ giao
  Android, nên không truyền input `ios` và gate không đòi job đó — bản Android hay OTA khẩn không chờ runner macOS và
  không đỏ vì một lỗi chỉ riêng iOS (CocoaPods sập, simulator không boot). iOS vẫn được build ở mọi PR chạm binary và
  hằng đêm. Khi có tài khoản Apple (UNI-1838) và bản phát hành giao iOS, nơi gọi đó thêm `ios: true`. Sửa một trong bốn workflow (cả `chat-mobile-update.yml`) cũng chạy `mobile-verify.yml`, để
  `scripts/mobile-workflows.test.mjs` kiểm lời hứa của chúng.
- `chat-mobile-verify.yml` hằng đêm: job `android-production` build AAB release mọi ABI từ profile production
  (không cần tài khoản), job `ios` build bản Release simulator kể cả khi thiếu biến `MAESTRO_*` (chỉ simulator và các
  luồng chờ cổng), job `eas-local` (`eas build --local --platform android`, hai profile: `preview` và
  `production-check`; đúng đường archive theo `.easignore`, nhận diện pnpm và cài đặt của EAS mà PR #387 vấp hai lần,
  và với `production-check` cả cấu hình chỉ bản production chạm — môi trường EAS `production`, chứng chỉ ký OTA mà
  `app.config.ts` đòi trên máy build EAS — nên một đêm đỏ ở đó là một tag sẽ đỏ. Không profile nào
  `autoIncrement` nên version code trên store không nhảy; cần environment `chat-mobile-nightly`, mục Thiết lập lần
  đầu. Không chạy trên PR, có chủ ý: job PR không đọc secret, và `EXPO_TOKEN` trong job của một nhánh PR đủ để phát
  một bản OTA; đường EAS của PR được giữ tĩnh bằng `.easignore` sinh ra và `scripts/mobile-lockfiles.test.mjs`), job
  `android-matrix` (APK release x86_64 cấu hình production, `smoke-launch.yaml` trên API 24 — minSdk —, 29, 33 và API 35
  RAM 2 GB, ảnh màn đăng nhập sáng/tối của từng máy trong artifact `unichat-screens-*` để người xem so; máy OEM như
  Samsung/Xiaomi cần device farm, chưa có), và các luồng Maestro — ba luồng vàng trên cả hai nền tảng, thêm
  `offline-send-relaunch.yaml` trên Android (chế độ máy bay: ba tin viết offline sống qua kill, mở lạnh offline vào
  inbox và phòng từ cache, bật mạng thì tới đúng thứ tự, mỗi tin một lần); thiếu biến `MAESTRO_*` thì run theo lịch
  **đỏ**, không xanh. `background-resume.yaml` (người khác viết lúc app ở nền, trong và quá cửa sổ ân hạn 25 s của
  socket) chạy tay: cần tài khoản thứ hai (`MAESTRO_CALLER_TOKEN`, `MAESTRO_CALLER_WS_ID`, `MAESTRO_DM_ROOM_ID`,
  `MAESTRO_API_URL`) như `call-answer-incoming.yaml`.
- **Chưa có: luồng đã đăng nhập trên PR** (review P2, hoãn có lý do). PR chỉ chạy `smoke-launch.yaml` (mở lạnh tới
  màn đăng nhập); `chat-read-send.yaml` chỉ chạy hằng đêm với staging. Câu hỏi thiết kế cần chốt trước khi viết job
  `android-signed-in` (native scope, qua `scripts/maestro-retry.sh`, thêm vào `JOBS` của
  `scripts/mobile-verify-gate.mjs`): job đó phải dựng server trong job như job `e2e` của `ci.yml` (binary server +
  `postgres:16` + `redis:7` + bản build Next production, vì đăng nhập đi qua trang web trong trình duyệt hệ thống —
  `maestro/subflows/sign-in.yaml` đã viết sẵn), rồi app trên emulator phải tới được nó. Bản Release staging/production
  chỉ nhận `https://` (`app.config.ts`) và Android từ chối cleartext. Hai đường: (a) một biến thể thử nghiệm build
  Release với `UNICHAT_ENV=dev` trỏ `http://10.0.2.2:<port>`, cộng một network security config chỉ cho phép cleartext
  tới đúng `10.0.2.2` — đổi tư thế TLS của binary nên cần test chứng minh không profile EAS nào bật nó; (b) proxy TLS tự
  ký trong job với CA cài vào emulator — Android 7+ không tin CA người dùng nếu app không khai, CA hệ thống cần
  emulator `-writable-system`, nặng và giòn. Hướng nghiêng về (a). Đường gọi đến (`call-answer-incoming.yaml`) vẫn
  chỉ chạy tay: cần FCM thật và tài khoản thứ hai. Hoãn vì: job này không chạy được trên máy làm (không Docker,
  không emulator), mà một job bắt buộc sai sẽ chặn mọi PR native; cần một lượt thử trên CI trước khi gate đòi nó.
- **Đo hiệu năng trên thiết bị** (`scripts/mobile-perf.mjs`, trần ở `apps/chat-mobile/perf-budget.json`; chặn ở mọi
  `GATE_LEVEL`). `android-smoke` mỗi PR chạm binary: kích thước APK x86_64, rồi 5 lần mở lạnh (`am force-stop` →
  `am start -W`), trung vị của `TotalTime` (Android tới khung đầu — splash) và của thời gian từ lúc khởi chạy tới
  mốc `first-screen` (màn đầu vẽ xong dưới splash vừa nhấc). Nightly Android (`chat-mobile-verify.yml`, tài khoản
  staging): 5 lần mở lạnh tới mốc `inbox` (danh sách phòng đã vẽ, đã đăng nhập), rồi `perf-open-room.yaml` mở
  `MAESTRO_ROOM_ID`, reset `dumpsys gfxinfo`, `perf-scroll-room.yaml` cuộn lùi 20 lần rồi xuống lại; đo % khung giật,
  khung p90 và PSS. Mốc là một dòng `UniChatPerf mark=<tên>` trong logcat (`ReactNativeJS`), chỉ bản build với
  `UNICHAT_PERF_MARKS=1` mới ghi (`data/logger.ts › perfMark`; `extra` nằm ngoài fingerprint) — không bản store hay OTA
  nào đặt nó (`scripts/mobile-workflows.test.mjs`). Emulator không có GPU: số khung để so giữa các bản, không phải lời
  hứa về một điện thoại; cảm nhận trên máy thật là việc của Sentry (mục Kiểm tra 8).
  Trần đặt 2026-10-22 là **tạm**: chưa run nào đo app này, nên chúng chỉ bắt hồi quy thô. Sau 5 run xanh đầu tiên của
  mỗi job, đặt mỗi trần = số tệ nhất trong 5 run + 15 % trong một commit trích các run; từ đó trần chỉ hạ, và chỉ nâng
  trong commit thêm sức nặng, ghi lý do. Phòng `MAESTRO_ROOM_ID` cần ≥ 500 tin để lần cuộn tải nhiều trang: gieo một lần
  bằng một access token của tài khoản thử (`TOKEN`), id workspace (`WS_ID`) và URL API staging (`API`):
  `for i in $(seq 1 500); do curl -fsS -X POST "$API/api/v1/workspaces/$WS_ID/chat/rooms/$MAESTRO_ROOM_ID/messages"
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'
  -d "{\"body\":\"Seed $i\",\"client_msg_id\":\"perf-seed-$i\"}" >/dev/null; done` (`client_msg_id` cố định nên
  chạy lại không nhân đôi). Đỏ ở đây:
  xem bảng trong step summary — số nào vượt, so với run xanh trước để tìm commit; trên máy dev, render của hàng xem bằng
  các test đếm render (mục Kiểm tra 8), chi phí dựng timeline bằng `lib/timeline-perf.test.ts`.
- **Canary: chứng minh mỗi cổng đỏ được (owner, một lần sau khi nhánh UNI-2053 lên remote — audit "gates-never-ran").**
  Một cổng chỉ tính khi đã thấy nó đỏ trên một commit cố ý hỏng. `node scripts/mobile-canary.mjs --list` liệt kê các
  canary (thiếu peer, thiếu babel plugin, chuỗi locale chỉ iOS lọt sang Android, crash lúc boot, KDoc có `/*`, token
  cuộc gọi giả qua được, job `scope` crash, lockfile npm, `.gitignore` lệch `.easignore`) cùng job phải đỏ. Mỗi canary:
  `git switch -c canary/<tên> origin/<nhánh>` → `node scripts/mobile-canary.mjs <tên>` (canary đổi `package.json` in
  thêm `pnpm install --lockfile-only`) → commit, push, mở PR nháp vào `develop` → xác nhận đúng job đó đỏ **và**
  `UniChat mobile gate` đỏ → đóng PR, xoá nhánh. Ghi link run vào bảng dưới; không merge nhánh canary nào.
  `scripts/mobile-canary.test.mjs` đỏ khi code đổi làm một canary không còn áp được.

  | Canary | Job phải đỏ | Run đỏ (link) | Ngày |
  | --- | --- | --- | --- |
  | missing-peer | mobile, expo-doctor and JS bundle budget | | |
  | babel-plugin | expo-doctor and JS bundle budget, Android release build | | |
  | ios-only-locale | mobile, Android release build | | |
  | boot-crash | Android cold-start smoke, iOS simulator release build | | |
  | kotlin-parse | mobile, Android release build | | |
  | launch-token | Android release build | | |
  | scope-crash | UniChat mobile gate | | |
  | foreign-lockfile | mobile | | |
  | easignore-drift | mobile | | |

- **Lượt chạy thiết bị chập chờn.** Mọi lần chạy Maestro trong `mobile-verify.yml` và nightly đi qua
  `scripts/maestro-retry.sh`: hỏng thì chạy lại một lần; lần hai qua thì xanh nhưng để lại cảnh báo "Flaky device run"
  và một dòng `flaky:` trong step summary, hai lần hỏng thì đỏ. Một luồng cứ phải nhờ lần chạy lại (thấy trong các
  summary) là lỗi cần sửa — luồng chờ thiếu, hay app crash lúc có lúc không — không phải nhiễu. Tắt lượt chạy lại khi
  điều tra: `MAESTRO_ATTEMPTS=1`.
- Phiên bản công cụ ghim trong workflow: `EAS_CLI_VERSION` (release và OTA, cùng một số), `MAESTRO_VERSION` (nightly, tải zip release
  thay vì script cài), `EXPO_DOCTOR_VERSION`. Nâng trong một PR riêng.
- Ngân sách bundle: hạ trần khi bundle nhỏ đi; chỉ nâng trong commit thêm sức nặng đó, ghi lý do trong body. Đo tại
  máy: `UNICHAT_ENV=production UNICHAT_API_URL=https://api.example.invalid UNICHAT_APP_URL=https://app.example.invalid
  pnpm --filter @uniwork/chat-mobile exec expo export --platform android --platform ios --output-dir /tmp/uc
  --dump-sourcemap` rồi `node scripts/mobile-bundle-budget.mjs /tmp/uc` (trần riêng cho Android và iOS).
- Bản release Android chạy R8 và thu gọn tài nguyên (`app.config.ts` › `expo-build-properties`). Crash chỉ có ở bản
  release (`ClassNotFoundException`, `NoSuchMethodError` trong một module native) thường là một lớp R8 đã bỏ: thêm luật
  `-keep` vào `ANDROID_KEEP_RULES` (đổi fingerprint: bản store mới), xác nhận bằng `android-smoke` và nightly. Bật R8
  đổi fingerprint của bản đầu tiên mang nó: bump `version` trước bản store kế tiếp.

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
   đủ tài khoản và tên khoá: `docs/evidence/unichat/release-accounts.md`. **Push có xác thực** (audit bảo mật
   "push-preview-plaintext"): expo.dev › Project settings › Access tokens tạo token, đặt `EXPO_ACCESS_TOKEN` cho server
   production (Secret Kubernetes `uniwork-expo`, key `EXPO_ACCESS_TOKEN`, chart đọc qua `be.secrets.expo`, tuỳ chọn;
   thiếu thì server vẫn chạy nhưng log lỗi lúc khởi động và push đi không xác thực) rồi bật **Enhanced Security for Push Notifications** ở
   cùng trang — theo thứ tự đó, bật trước thì mọi push không token bị Expo từ chối. Kiểm: gửi một tin DM tới máy thật,
   `push_receipts` không có lỗi `InvalidCredentials`.
5. GitHub → Settings → Environments, hai environment (bản store chạy từ tag, OTA chạy tay trên nhánh; một environment
   giới hạn tag sẽ từ chối mọi run OTA trước bước đầu):
   - `chat-mobile-release` (`chat-mobile-release.yml`): Deployment branches and tags → Selected → tag `chat-mobile-v*`;
     secret `EXPO_TOKEN` (robot token của tài khoản Expo tổ chức).
   - `chat-mobile-update` (`chat-mobile-update.yml`): Deployment branches → Selected → nhánh `main` và `develop`;
     secret `EXPO_TOKEN` (cùng token), `EAS_UPDATE_PRIVATE_KEY` (bước 9), `SENTRY_AUTH_TOKEN` và variables
     `SENTRY_ORG`, `SENTRY_PROJECT` (bước 8). Nên thêm Required reviewers.
   - `chat-mobile-production` (`chat-mobile-production.yml`, `chat-mobile-promote.yml`): Deployment branches and tags →
     Selected → tag `chat-mobile-v*` **và** nhánh `main` (promote chạy trên nhánh); **Required reviewers** (owner);
     secrets `EXPO_TOKEN`, `SENTRY_AUTH_TOKEN`, `PLAY_SERVICE_ACCOUNT_JSON` (khoá JSON của một service account Google
     Cloud có quyền phát hành trên `com.uniworkos.chat` — có thể dùng lại khoá đã tải lên EAS cho submit), variables
     `SENTRY_ORG`, `SENTRY_PROJECT` (và `SENTRY_URL` nếu Sentry tự host).
   - `chat-mobile-release-health` (`chat-mobile-release-health.yml`): mục Sức khoẻ bản phát hành.
   - `chat-mobile-nightly` (`chat-mobile-verify.yml` › `eas-local`): Deployment branches → Selected → nhánh `main` (lịch
     chạy đọc từ nhánh mặc định); secret `EXPO_TOKEN` (cùng robot token). **Không** đặt Required reviewers: run theo lịch
     sẽ đứng chờ duyệt. Thiếu token thì run theo lịch đỏ ở job đó.
   Không thêm khoá Apple/Google vào GitHub.
6. Server staging và production: `DESKTOP_AUTH_CLIENTS` có
   `uniwork-chat-mobile=uniworkchat://auth/callback|uniworkchat-dev://auth/callback` (`.env.example`). Universal link
   (`applinks:app.uniworkos.com`) cần Team ID của Apple trong AASA và SHA-256 của khoá Play App Signing trong
   `assetlinks.json` (web, lát N3).
8. **Sentry (báo crash, UNI-2053).** Tạo project React Native trong tổ chức Sentry. Trong EAS, cho `preview` và
   `production`: `SENTRY_DSN` (plaintext — DSN không phải bí mật, và `eas update` trong CI phải đọc được nó),
   `SENTRY_ORG`, `SENTRY_PROJECT` (plaintext) và `SENTRY_AUTH_TOKEN` (secret, token tổ chức quyền
   `project:releases` + `org:read`). Bản build có token thì Gradle/Xcode tải source map và symbol native lên Sentry;
   thiếu token thì build vẫn xanh (`SENTRY_ALLOW_FAILURE=true` trong `eas.json`) và crash hiện stack chưa giải.
   Thiếu `SENTRY_DSN` thì app không khởi động Sentry. GitHub Environment `chat-mobile-update`: secret
   `SENTRY_AUTH_TOKEN`, variables `SENTRY_ORG`, `SENTRY_PROJECT` cho source map của OTA; Environment
   `chat-mobile-production` cùng ba thứ đó (bản production chứng minh symbol đã lên). Bản production và OTA kênh
   `production` không phát khi thiếu báo crash (trừ khi miễn có ghi lại). Đặt alert crash-free sessions < 99.5 %
   (`docs/evidence/unichat/go-no-go-template.md`) trong Sentry; việc dừng rollout khi dưới ngưỡng là của job Sức khoẻ
   bản phát hành.
9. **Ký OTA (EAS Update code signing).** Chứng chỉ công khai đã commit: `apps/chat-mobile/certs/eas-update-certificate.pem`
   (sinh 2026-10-22 bằng `npx expo-updates codesigning:generate --key-output-directory ../../.secrets/unichat-keys
   --certificate-output-directory certs --certificate-validity-duration-years 10 --certificate-common-name "UniChat"`,
   RSA 2048, hết hạn 2036-10-22; `app.config.test.ts` đỏ khi nó không còn là chứng chỉ code-signing thật hay còn dưới
   2 năm). Khoá riêng nằm **trên máy đã sinh** ở `.secrets/unichat-keys/private-key.pem` (git bỏ qua, `.easignore` cũng
   vậy) — **việc của owner, một lần, trước OTA đầu tiên**: chép nội dung PEM vào kho bí mật của tổ chức và secret
   `EAS_UPDATE_PRIVATE_KEY` của Environment `chat-mobile-update`, rồi xoá bản trên máy
   (`rm -P .secrets/unichat-keys/private-key.pem`). Khoá riêng **không bao giờ** vào repo. Mọi binary staging và
   production từ đây nhúng chứng chỉ và từ chối bản OTA không ký: `app.config.ts` ném lỗi trên máy build EAS khi thiếu
   chứng chỉ (`UNICHAT_ENV` khác `dev`), và `chat-mobile-update.yml` không phát bản không ký trên kênh nào (thiếu chứng
   chỉ hoặc thiếu khoá thì đỏ). Mất khoá = không phát OTA được cho các binary đó tới bản store kế tiếp mang chứng chỉ
   mới. **Xoay chứng chỉ** (lộ khoá, hay còn dưới 2 năm): sinh cặp mới như trên, thay file, đổi `EAS_UPDATE_PRIVATE_KEY`,
   bump `version` và cắt bản store (chứng chỉ là phần native); máy cũ chỉ nhận OTA ký bằng khoá cũ tới khi cập nhật.
   Các bản 0.3.0 build trước khi có chứng chỉ (một AAB production ngày 2026-10-21) nhận OTA không ký: không đưa lên
   track người dùng thấy; build lại.
10. Nightly (`chat-mobile-verify.yml`): trên staging, một org thử có một workspace, một **phòng nhóm** (group, không
   phải kênh mặc định của workspace) và một tài khoản thành viên của phòng đó, đăng nhập bằng email/mật khẩu (không
   MFA, không chỉ Google). Phòng nhóm vì cuộc gọi nhóm vào thẳng phòng LiveKit mà không cần người thứ hai; mỗi đêm
   gửi một tin `Maestro <số>` vào phòng. Repository variables `MAESTRO_API_URL`, `MAESTRO_APP_URL`,
   `MAESTRO_ORG_SLUG`, `MAESTRO_WS_SLUG`, `MAESTRO_ROOM_ID`; secrets `MAESTRO_TEST_EMAIL`, `MAESTRO_TEST_PASSWORD`.
   Lịch chạy chỉ có hiệu lực khi workflow nằm trên `main`; trước đó chạy tay bằng "Run workflow" (bỏ chọn
   `maestro` để chỉ build). Thiếu một biến thì run theo lịch đỏ với tên biến thiếu.

**Cắt một bản store**

1. Trên `develop`/`main`, `version` trong `app.config.ts` là version mới nếu có đổi native từ tag trước.
2. `git tag chat-mobile-v<version> <sha>` rồi `git push origin chat-mobile-v<version>`.
3. Workflow: `verify` (mọi kiểm tra của PR trên SHA của tag) → gate `EXPO_TOKEN` → commit trên `main`/`develop` →
   tag khớp `version` → `eas build --platform android --profile internal --non-interactive --auto-submit`. Play
   internal hiện ngay sau submit; người thử cài qua link opt-in. iOS: khi có tài khoản Apple (bước 3 của thiết lập),
   đổi `--platform android` thành `--platform all` trong `chat-mobile-release.yml`; Apple xử lý bản build 15–30 phút
   trước khi hiện ở TestFlight.

**Phát hành production theo giai đoạn (Play, App Store)**: bản production được build **một lần** và chính binary đó
đi qua các track (audit "no-production-pipeline-binary-promotion"); một bản store tới một phần máy trước và chỉ mở rộng
theo crash-free sessions của Sentry cho đúng release đó (`<bundle id>@<version>+<build>`; máy đã nhận một OTA báo dưới
`…+<build>.ota.<id>`, mục Phát OTA).

1. **Build.** Viết "Có gì mới" cho version đó trong `apps/chat-mobile/store/release-notes.md` (vi-VN và en-US, ≤ 500 ký
   tự mỗi ngôn ngữ; nháp từ commit: `node scripts/mobile-release-notes.mjs draft`), tag `chat-mobile-v<version>` trên
   `main`. GitHub → Actions → "UniChat mobile production build" → Use workflow from → **Tags** → tag đó. Workflow
   `chat-mobile-production.yml` (Environment `chat-mobile-production`, có Required reviewers): `verify` trên SHA của
   tag → thiếu `EXPO_TOKEN` thì đỏ → tag phải là tag, trên `main`, khớp `version` và có release notes → **báo crash bắt
   buộc**: môi trường EAS `production` có `SENTRY_DSN` và Environment có `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` +
   `SENTRY_PROJECT`, thiếu thì đỏ (bản build vẫn build được khi thiếu Sentry — `SENTRY_ALLOW_FAILURE` trong `eas.json`
   — nhưng không được nộp; tick `allow_missing_crash_reporting` để miễn, summary ghi lại) → `eas build --profile
   production --wait` → kiểm Sentry đã có release `com.uniworkos.chat@<version>+<version code>` (Gradle tải source map
   và symbol dưới tên đó; không có là tải hỏng, đỏ) → `eas submit --profile production-internal --id <build>`: đúng
   binary đó lên **internal track của app production** `com.uniworkos.chat`. Summary ghi version code.
2. **Thử** bản đó trên internal track của app production (người thử nội bộ, checklist máy thật bên dưới).
3. **Promote** (cùng binary, theo version code): Actions → "UniChat mobile promote" (`chat-mobile-promote.yml`,
   Environment `chat-mobile-production`, secret `PLAY_SERVICE_ACCOUNT_JSON`) → `action: promote`, `version_code`,
   `version`, `from_track: internal`, `to_track: production` (hay `alpha`/`beta` trước), `status`. Script
   `scripts/mobile-play-release.mjs` chỉ nhận version code **đã live** trên track nguồn (không bao giờ build lại) và gửi
   kèm release notes của version đó. Khi app `com.uniworkos.chat` trên Play chưa có bản phát hành công khai nào, Play chỉ
   nhận bản nháp: `status: draft`, rồi Play Console → Production → bản nháp → Edit release → **Staged rollout** 5 %.
   Từ khi app đã công khai: `status: inProgress`, `rollout: 0.05` (5 %). `submit.production.android` trong `eas.json`
   (dùng khi nộp tay bằng `eas submit --profile production`) cũng đổi thành
   `"releaseStatus": "inProgress", "rollout": 0.05` qua PR lúc đó.
4. Mở rộng 5 % → 20 % → 50 % → 100 %, mỗi bước sau ít nhất 24 giờ, chỉ khi crash-free sessions của release ≥ 99.5 %
   (Sentry → Releases) trên ít nhất 200 phiên, và không có lỗi mới chặn luồng chính (đăng nhập, đọc/gửi tin, push, gọi):
   "UniChat mobile promote" với `from_track` = `to_track` = `production`, `status: inProgress`, `rollout` mới;
   100 % là `status: completed`.
5. Dừng khi crash-free < 99.5 % hoặc có lỗi chặn: "UniChat mobile promote" với `action: halt`, `to_track: production`,
   `version_code` (hoặc Play Console → Production → **Halt rollout**; máy đã cài giữ bản đó, máy mới không nhận). Job
   **Sức khoẻ bản phát hành** (mục dưới) tự làm việc này khi đủ phiên. Lỗi chỉ ở JS: OTA sửa trên kênh `production`
   (cùng runtime, đánh dấu `critical`), theo dõi lại rồi promote lại cùng version code ở tỷ lệ cũ (resume). Lỗi native:
   revert, bump patch, cắt bản store mới và bắt đầu lại từ 5 %. Lỗi ở một tính năng: kill switch (mục dưới).
6. iOS: khi nộp bản production bật **Phased release for automatic updates** (App Store Connect, 7 ngày); Pause phased
   release theo cùng ngưỡng 99.5 %. Chưa có đường iOS tự động (UNI-1838: tài khoản Apple).

**Sức khoẻ bản phát hành (tự động, audit "rollout-gating-manual")**: `chat-mobile-release-health.yml` chạy mỗi giờ
(phút 17) `scripts/mobile-release-health.mjs`: đọc tổng phiên và crash-free sessions 24 giờ qua của mọi release
production trong Sentry (`/api/0/organizations/<org>/sessions/`, `groupBy=release`, `environment=production`), theo tên
release mà app tự đặt — `com.uniworkos.chat@<version>+<version code>` là bundle nhúng của bản store,
`…+<version code>.ota.<id>` là một bản OTA trên nó. Ngưỡng là của mục trên: **< 99.5 % trên ≥ 200 phiên**, hoặc
**< 98 % trên ≥ 50 phiên** (vỡ nặng, không chờ đủ 200), thì:
- bản OTA đang rollout dở (`eas update:list` có `rolloutPercentage` < 100, `eas update:view` chứa id đó):
  `eas update:revert-update-rollout --group <group>` (ký bằng `EAS_UPDATE_PRIVATE_KEY`) — máy trong phần rollout quay
  về bản trước;
- bản store: halt staged rollout của version code đó trên track production qua `scripts/mobile-play-release.mjs`;
- bản OTA đã 100 %, hay bản store không còn rollout: **không tự làm gì**, ghi "needs a person" — người trực republish
  bản trước hay roll back về bản nhúng (mục Khắc phục), vì máy không biết bản trước có tốt hơn không.
Run **đỏ** mỗi khi có release dưới ngưỡng (kể cả khi đã dừng được), summary liệt kê từng release và việc đã làm; GitHub
báo người theo dõi repo. Bật khi production có người dùng: repository variable `UNICHAT_RELEASE_HEALTH=on`; từ lúc đó
thiếu thiết lập là đỏ. Chạy tay ("Run workflow") mặc định `dry_run` (chỉ báo cáo). Environment
`chat-mobile-release-health`: Deployment branches → `main`, **không** Required reviewers (lịch chạy không chờ duyệt
được); secrets `SENTRY_AUTH_TOKEN` (quyền `org:read`), `EXPO_TOKEN`, `EAS_UPDATE_PRIVATE_KEY`,
`PLAY_SERVICE_ACCOUNT_JSON`; variable `SENTRY_ORG` (`SENTRY_URL` nếu tự host). Một alert trong Sentry (crash-free <
99.5 %) vẫn nên đặt để báo trong giờ trước lượt chạy kế tiếp; server có thêm alert `UniChatMobileServerErrors` cho lỗi
5xx theo bản app (mục Kiểm tra).

**Thống kê sản phẩm theo bản (audit "no-product-analytics")**: ngoài crash-free, một bản được đánh giá theo cách
người dùng dùng nó — `uniwork_mobile_events_total{event,result,os,client_version,client_update}` và
`uniwork_mobile_event_duration_seconds{event,os,client_version}` (Prometheus, từ `data/analytics.ts`; ẩn danh, người
dùng tắt được), vẽ sẵn ở dashboard Grafana **UniWork · UniChat mobile** (`deploy/grafana/dashboards/unichat-mobile.json`:
lần mở, tỷ lệ gửi được, mở từ push, tỷ lệ nối cuộc gọi theo version và theo bản OTA, p75 màn đầu / gửi / nối gọi theo
version, tỷ lệ 5xx theo bản build). So bản mới với bản trước trong cùng khung giờ: tỷ lệ gửi hỏng
`sum by (client_version) (rate(uniwork_mobile_events_total{event="message_send",result="failed"}[1h])) / sum by
(client_version) (rate(uniwork_mobile_events_total{event="message_send"}[1h]))`, tỷ lệ nối cuộc gọi được, số lần mở từ
push, và p75 `first_screen`. Một bản làm tỷ lệ gửi hỏng hay nối cuộc gọi hỏng tăng rõ là lý do dừng mở rộng dù
crash-free vẫn đạt. Số người dùng hằng ngày cho go/no-go không lấy từ bộ đếm này (ẩn danh, không đếm người): đếm người
riêng biệt có request đã xác thực từ app trong log truy cập, mỗi ngày —
Loki `count(count by (user_id) (count_over_time({container=~".*server.*"} | json | client_platform="mobile" | user_id != "" [1d])))`
— chia cho số người trong danh sách pilot.

**Bản cài trực tiếp (chưa có store)**: `eas build -p android --profile preview` cho link tải APK. iOS ad hoc cần Apple
Developer và đăng ký máy (`eas device:create`) trước `eas build -p ios --profile preview`.

**Phát OTA (chỉ JS, từ CI)**: GitHub → Actions → "UniChat mobile OTA update" → Run workflow trên `develop`/`main`,
chọn `channel` (`internal` | `preview` | `production`), `rollout_percentage` (mặc định 10), `message`
(`UNI-nnn: …`), `critical` (mặc định tắt) và `allow_missing_crash_reporting` (mặc định tắt). Workflow `chat-mobile-update.yml` (Environment `chat-mobile-update`): `verify` (mọi kiểm tra của PR
trên SHA, kể cả build Android) → thiếu `EXPO_TOKEN` thì **đỏ** → commit trên `main`/`develop` → kênh quyết định môi
trường EAS và biến thể như profile build của kênh trong `eas.json` (`internal`/`preview` → `preview` + `UNICHAT_ENV=staging`;
`production` → `production` + `UNICHAT_ENV=production`; `eas update` không đọc `env` của profile build nên workflow tự
đặt) → cấu hình phải đúng biến thể (`extra.APP_ENV`) và có URL máy chủ, sai thì **đỏ**; kênh `production` còn phải có
báo crash: `SENTRY_DSN` trong môi trường EAS và `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` trong Environment
`chat-mobile-update` (source map), thiếu thì **đỏ** trừ khi tick `allow_missing_crash_reporting` (summary ghi lại việc
miễn đó) — một bản OTA production không được mở rộng theo một tỷ lệ crash-free không ai đọc được; kênh staging chỉ
notice → so runtime (fingerprint) của
bản OTA với bản store mới nhất trên kênh, khác thì **warning** (thường là đổi native, cần bản store) → ký bằng
`EAS_UPDATE_PRIVATE_KEY` (bắt buộc trên mọi kênh: thiếu chứng chỉ hay thiếu khoá thì đỏ) →
`eas update --platform android --channel <kênh> --environment <env> --rollout-percentage <n>` → tải source map lên
Sentry. Job summary ghi runtime, group (thứ `eas update:edit` và lệnh revert nhận) và id bản Android của OTA. App tải
bản mới lúc mở; ngoài ra khi quay lại foreground (một phút sau lúc mở, rồi tối đa 30 phút một lần,
`data/updates-controller.ts`) app hỏi lại và tải. Bản thường áp dụng ở lần mở lạnh sau. **Bản `critical`** (và lệnh
`eas update:roll-back-to-embedded`) được áp dụng khi app đã ở nền liên tục một phút (Android), hay lúc người dùng quay
lại sau ≥ 10 phút vắng (iOS đóng băng app ở nền), khi không có cuộc gọi nào đang reo hay đang nói và không có màn hệ thống
app đang chờ (đăng nhập Google/UniWork, chọn ảnh/tệp, hộp xin quyền) — không bao giờ lúc người dùng vừa rời app một
chút; dùng cho bản sửa crash hay lỗi dữ liệu, không cho bản thường (mỗi lần
áp dụng là một lần app khởi động lại khi người dùng quay lại). Breadcrumb `updates` trong Sentry ghi lúc tải và lúc áp
dụng. Mỗi máy chạy một bản OTA báo về Sentry dưới release riêng `<bundle id>@<version>+<build>.ota.<id bản Android>`
(bản nhúng trong binary vẫn là `<bundle id>@<version>+<build>`), nên crash-free sessions được tính cho từng bản OTA,
và job tự động ở mục **Sức khoẻ bản phát hành** đọc đúng con số đó. Theo dõi crash của bản đó trong Sentry khoảng một
ngày rồi mở rộng: `eas update:edit --branch <kênh>` và chọn tỷ lệ mới
(hoặc `--rollout-percentage 100`). Phát tay từ máy chỉ khi CI không chạy được, và phải đặt
biến thể và ký giống CI (thiếu `UNICHAT_ENV` là cấu hình dev: không máy nào nhận):
`cd apps/chat-mobile && UNICHAT_ENV=staging eas update --platform android --channel internal --environment preview
--message "UNI-nnn: …" --rollout-percentage 10 --private-key-path <khoá>` (kênh `production`: `UNICHAT_ENV=production`,
`--environment production`) rồi `pnpm exec sentry-expo-upload-sourcemaps dist`.

**Chặn bản cũ và tắt tính năng từ server (UNI-2053)**: `GET /api/v1/config` trả `min_supported_mobile_version` và
`mobile_flags`; app đọc lúc mở và mỗi lần quay lại foreground, và giữ câu trả lời cuối trên máy (tối đa 30 ngày):
máy mở lạnh không có mạng vẫn theo công tắc và mức tối thiểu lần cuối nó nghe được.

- Bắt cập nhật: đặt `UNICHAT_MOBILE_MIN_SUPPORTED_VERSION=<MAJOR.MINOR.PATCH>` trên server (sai dạng thì server không
  khởi động) và khởi động lại. Máy dưới mức đó chỉ còn màn "Cần cập nhật UniChat" với link store (`UNICHAT_STORE_*`,
  hoặc link thử nghiệm khi store chưa có). Chỉ đặt sau khi bản mới đã có trên store/track mà người dùng thấy.
- Tắt gọi: `FF_UNICHAT_MOBILE_CALLS=false` (cả hệ thống) hoặc override theo tổ chức/người dùng ở console admin
  (flag `unichat_mobile_calls`). Máy ẩn nút gọi, không đổ chuông (cả màn đổ chuông native của Android), push cuộc gọi
  cũ (đã tới máy) mở phòng; cuộc gọi đang diễn ra không bị cắt và giữ dịch vụ cuộc gọi của nó. Server cũng ngừng gửi push "X đang gọi" cho người mà công tắc tắt (đánh giá theo người nhận và
  tổ chức của cuộc gọi, như máy đọc nó; dòng inbox vẫn còn, `uniwork_push_suppressed_total{kind="chat_call_incoming"}`
  đếm) và không gửi push "kết thúc" (`chat.voice.ring_closed`), nên máy không reo kể cả khi app chưa đọc cấu hình.
  Bật lại: xoá biến/override.
- Tắt một phần khác của app (mặc định bật, cùng cách đặt: `FF_<KEY>=false` hoặc override ở console):
  `unichat_mobile_media_upload` (ẩn gửi ảnh/tệp trong menu đính kèm; tin đã xếp hàng vẫn đi),
  `unichat_mobile_voice_messages` (ẩn nút ghi tin thoại), `unichat_mobile_ai_catch_up` (ẩn banner "Bắt kịp nhanh"),
  `unichat_mobile_outbox_flush` (ngừng tự gửi lại tin và thao tác đang chờ khi có mạng lại / về foreground / socket nối
  lại — chúng nằm yên trên máy; gửi từ ô soạn tin và nút Thử lại vẫn chạy; dùng khi bản app gây bão gửi lại).
- Bật dần cho một phần người dùng: `FF_<KEY>=N%` hoặc trong tệp `FEATURE_FLAGS_FILE`
  `<key>: {default: false, percent: {percent: N, by: user_id}}` — cùng một người luôn trong hay ngoài (băm id người
  dùng), khoảng N % tổng số; đổi cần khởi động lại server. Override ở console chỉ bật/tắt (người > tổ chức > toàn hệ
  thống) và thắng tỷ lệ.
- Đăng xuất bỏ các công tắc đã giữ trên máy (chúng có thể là của riêng người trước); mức tối thiểu và link store ở lại.
  Người kế tiếp chạy theo mặc định tới khi server trả lời cho họ.

**Play Console App content và App Store Connect (trước bản production đầu tiên; làm lại khi quyền, dịch vụ hay dữ liệu
đổi).** Nguồn chữ là `apps/chat-mobile/store/listing.md`; danh sách quyền và dịch vụ của bản release là
`apps/chat-mobile/android-manifest.test.ts` (in lại bằng `node apps/chat-mobile/scripts/android-manifest.mjs`). Đánh dấu
từng mục khi đã nộp:

- [ ] **Privacy policy**: `https://app.uniworkos.com/privacy` (tiếng Việt `/vi/privacy`). Trang phải nói đúng những gì
  app làm: AI (Anthropic, khi bất kỳ thành viên nào dùng AI trên nội dung chung; màn đồng ý trên điện thoại chỉ cho yêu
  cầu của chính người dùng), báo cáo vi phạm (chủ sở hữu/quản trị viên thấy cả người báo cáo; báo thẳng nhà vận hành qua
  `contact@unicomhub.com`), xoá tài khoản trong app, 18+. `apps/web/features/landing/privacy-content.test.ts` giữ hai
  câu đó.
- [ ] **Data safety** (Play) / **App Privacy** (Apple): điền theo bảng "Quyền riêng tư" của `store/listing.md`, gồm
  dòng "Xử lý AI" (chia sẻ với nhà cung cấp dịch vụ Anthropic khi người dùng **hoặc một thành viên khác** dùng tính
  năng AI — đừng khai "chỉ theo yêu cầu người dùng") và "Báo cáo vi phạm". Mã hoá
  khi truyền: có. Người dùng yêu cầu xoá dữ liệu được: có.
- [ ] **Account deletion** (Play bắt buộc với app cho tạo tài khoản; Apple 5.1.1(v)): trong app ở Cài đặt › Xóa tài
  khoản (đăng xuất mọi thiết bị, xoá dữ liệu trên máy). URL xoá cho Play:
  `https://app.uniworkos.com/privacy#delete-account` (mục "Lưu giữ và xóa dữ liệu", neo cố định). Ghi chú cho reviewer
  Apple: "Settings › Delete account".
- [ ] **Foreground service permissions**: đúng một dịch vụ, cuộc gọi (`expo.modules.unichatcalls.CallService`,
  `phoneCall|microphone|camera`; `android-manifest.test.ts` giữ đúng ba `FOREGROUND_SERVICE_*` đó; expo-audio tắt
  phát nền, `MediaProjectionService` của WebRTC bị gỡ bằng `plugins/with-removed-android-services.js`). Mỗi loại
  khai trong Play Console › App content › Foreground service permissions: tác vụ người dùng thấy được ("cuộc gọi
  thoại/video giữa thành viên tổ chức đang diễn ra, có thông báo cuộc gọi với Gác máy"; `microphone`/`camera`: micro và
  camera của chính người dùng trong cuộc gọi họ gọi hoặc nghe), hệ quả nếu bị hoãn (cuộc gọi mất tiếng/hình khi khoá
  máy), và **một video ngắn** (quay màn hình: nhận cuộc gọi trên máy khoá → Nghe → khoá máy giữa cuộc gọi, tiếng vẫn
  còn → thông báo cuộc gọi đang diễn ra → Gác máy). Thiếu video là bị từ chối.
- [ ] **Full-screen intent** (Android 14+, `USE_FULL_SCREEN_INTENT`): khai app là ứng dụng gọi điện (Play Console › App
  content › Full-screen intent: "Calling — shows the incoming call screen of a VoIP call"). Không được duyệt thì Android
  14+ không cấp sẵn, cuộc gọi chỉ là thông báo heads-up và Cài đặt › Thông báo hiện dòng "Hiện cuộc gọi đến toàn màn
  hình".
- [ ] **Target audience and content**: nhóm tuổi **chỉ 18+**; không nhắm tới trẻ em; không quảng cáo (Ads: No).
- [ ] **Content rating** (IARC): app nhắn tin công việc; không bạo lực/tình dục/cờ bạc; Interactive elements:
  **Users interact** (nhắn tin, gọi giữa thành viên tổ chức); không chia sẻ vị trí, không mua trong app. Apple: Age
  Rating **18+**, khớp chính sách (dịch vụ dành cho người từ 18 tuổi).
- [ ] **User-generated content** (Play UGC, Apple 1.2): khai báo app có nội dung do người dùng tạo; cơ chế: báo cáo tin
  nhắn hoặc người (nhấn giữ tin › Báo cáo; chi tiết cuộc trò chuyện › Báo cáo/Chặn), chặn nhắn tin riêng, chủ sở hữu và
  quản trị viên tổ chức thấy báo cáo (lý do, người/tin bị báo cáo, người báo cáo) trong Nhật ký hoạt động
  (`chat.report.created`) và xử lý theo chính sách của tổ chức; lời mô tả chỉ có trong bản xuất dữ liệu của tổ chức.
  Chưa có màn hình xử lý báo cáo, nên kênh tới nhà vận hành là `contact@unicomhub.com`: hộp thư đó phải có người trực
  và trả lời báo cáo nội dung (Apple 1.2 đòi xử lý kịp thời) trước khi nộp.
- [ ] **App access**: tài khoản demo (mục "Tài khoản demo cho review" của `store/listing.md`).
- [ ] **Government apps / Financial features / Health**: không.

**Kiểm tra trên máy trước bản store (offline và realtime, UNI-2053 S3).** Test node và jest giữ logic; chỉ máy thật
(bản `preview` hoặc `internal`) xác nhận phần native — MMKV mã hoá, splash, thư mục outbox, socket giữ khi gọi:

- [ ] Đã đăng nhập, bật chế độ máy bay, kill app, mở lại: splash rồi thẳng vào danh sách chat với dữ liệu cũ, banner
  "Đang chờ mạng…", không về màn đăng nhập. Server trả 5xx (staging tắt API) cũng vậy.
- [ ] Offline: gửi chữ, một ảnh, một tin thoại, một nhắc hẹn; thả một biểu cảm, bình chọn; kill app; mở lại vẫn thấy
  bốn bong bóng "Chờ có mạng để gửi"; bật mạng: tin tới đúng thứ tự, mỗi tin một lần (xem trên web), biểu cảm và phiếu
  khớp, ảnh không mất dù đã xoá cache của trình chọn ảnh.
- [ ] Mạng chập chờn (Network Link Conditioner / `adb shell svc wifi disable` vài giây): banner "Đang kết nối…" chỉ
  hiện khi mất quá 1.5 s và tự tắt; tin mới vẫn hiện, không phải mở lại phòng.
- [ ] Offline: sửa một tin và xoá một tin khác — hiện ngay; kill, mở lại vẫn thế; bật mạng: web thấy đúng bản sửa và
  tin đã xoá. Gửi một ảnh lớn (video ≥ 50 MB) rồi gõ một tin chữ: chữ tới trước sau khoảng 4 s, ảnh tới sau.
- [ ] Chuyển sang app khác dưới 25 s rồi quay lại: không có banner "Đang kết nối…", tin người khác gửi lúc đó đã có.
  Ở nền hơn 25 s: quay lại thì nối lại trong vài giây và phòng có đủ tin. Push về một phòng của workspace khác, bấm vào:
  phòng mở với tin mới nhất kể cả khi tắt mạng ngay sau khi chạm.
- [ ] Hai workspace: viết tin offline ở workspace A, chuyển sang B (hoặc màn chọn workspace), bật mạng: tin ở A vẫn đi.
- [ ] Gọi 1-1, bên gọi đưa app xuống nền khi đang đổ chuông, bên nghe bắt máy: bên gọi vào cuộc gọi (không hết giờ
  "không ai nghe"). Android là chính; iOS có thể bị hệ điều hành treo app nền giữa hai frame tới khi có CallKit.
- [ ] Đăng xuất rồi đăng nhập tài khoản khác: không thấy phòng, tin hay hàng đợi của tài khoản trước.

**UX, trợ năng và ngôn ngữ (UNI-2053 S6).** Test node/jest giữ nhãn, hành động, thông báo cho trình đọc màn hình,
cử chỉ ảnh (qua tiện ích test của react-native-gesture-handler) và màn giải thích quyền; chỉ máy thật xác nhận cảm giác
và giọng đọc. Một iPhone (VoiceOver) và một máy Android (TalkBack):

- [ ] VoiceOver và TalkBack: mỗi bong bóng là một điểm dừng đọc người gửi, giờ, trích dẫn, nội dung, trạng thái (đang
  gửi, chờ mạng, gửi lỗi, đã sửa) và đã gửi/đã tới/đã xem; vuốt lên/xuống (Actions / rotor) có "Thao tác với tin nhắn"
  và "Xem tin gốc"; tin gửi lỗi có gợi ý mở tùy chọn gửi lại. Ảnh trong album đọc "Album N ảnh" ở ảnh đầu.
- [ ] Người khác gửi tin khi đang mở phòng: nghe "Bình: …"; năm tin liền nhau: một câu "N tin nhắn mới", không đọc
  chồng. Tắt mạng: VoiceOver đọc "Đang chờ mạng…" (iOS không có live region). Đồng hồ cuộc gọi không đọc mỗi giây.
- [ ] Bàn phím: composer bám theo bàn phím từng khung hình, không giật khoảng trống home indicator (iPhone có Face ID),
  Android không trễ một nhịp; màn tạo nhóm cũng vậy.
- [ ] Rung: gửi tin, nhấn giữ tin, thả biểu cảm, nghe/gác máy có phản hồi; Android tắt "Phản hồi khi chạm" thì không rung.
- [ ] Cuộn lên trong phòng: nút tròn mũi tên xuống hiện; người khác gửi tin thì nút đếm số tin mới (99+); bấm thì về tin
  mới nhất; tự gửi một tin khi đang cuộn lên thì danh sách cuộn xuống tin đó.
- [ ] Cuộn lùi xa trong một phòng dài (≥ 10 trang, ~500 tin) rồi bấm nút về tin mới nhất: danh sách đứng yên ở tin mới
  nhất, không nhảy (các trang cũ nhất quá 8 trang bị bỏ — `data/timeline-window.ts`); cuộn lên lại thì chúng tải lại.
- [ ] Danh sách chat ở đầu (offset 0), người khác nhắn vào một phòng ở dưới: phòng đó hiện ở hàng đầu, không nằm ngay
  trên mép màn hình; danh bạ: gõ tìm khi đang ở giữa danh sách thì kết quả bắt đầu từ kết quả đầu tiên (FlashList 2 tắt
  `maintainVisibleContentPosition`).
- [ ] Ảnh xem lớn: chụm phóng to quanh ngón tay, chạm hai lần phóng to/thu nhỏ, kéo ảnh đang phóng to không đổi trang,
  ở 1x vuốt ngang đổi ảnh, vuốt xuống (hoặc lên) đóng và nền mờ dần; Android trong Modal cũng chạy (GestureHandlerRootView).
- [ ] Cỡ chữ hệ thống lớn nhất (iOS Larger Accessibility Sizes, Android Font size + Display size lớn nhất): danh sách
  chat, phòng, composer, Cài đặt không cắt chữ; nút và chip cao lên theo chữ; số trên huy hiệu chỉ to tới 1.4×.
- [ ] Màn giải thích quyền: lần đầu ghi tin thoại, gọi, gọi video, bật camera giữa cuộc gọi thoại, lần đầu vào app (thông báo) đều hiện màn của UniChat
  trước hộp thoại hệ thống; "Để sau" không hiện hộp thoại; đã từ chối hẳn thì màn nói quyền đang tắt và "Mở Cài đặt"
  mở đúng trang của UniChat. Lời nhắc thông báo lúc mở app chỉ hiện một lần mỗi máy, kể cả khi bấm "Tiếp tục" rồi từ
  chối ở hộp thoại hệ thống (Android 13+: mở lại app không hỏi nữa); Cài đặt › Thông báo hỏi lại.
- [ ] Nghe từ thông báo trên máy cài mới, đang khoá (Android): bấm "Nghe" thì màn giải thích micro hiện và ở lại trên màn
  đổ chuông; "Tiếp tục" hiện hộp thoại hệ thống, rồi cuộc gọi mới nối (micro đã được hỏi).
- [ ] Trải nghiệm hoàn thiện (audit UX 8/10). Phòng ngoài 12 phòng có cache, tắt mạng giữa lúc mở: "Không tải được tin
  nhắn · Thử lại", không phải lời mời "bắt đầu trò chuyện"; bật mạng rồi "Thử lại" thì tin hiện. Link trong tin: chạm mở
  trình duyệt trong app, nhấn giữ có Mở/Sao chép/Chia sẻ (rung), VoiceOver/TalkBack có hành động "Liên kết …" trên bong
  bóng; `**đậm**` hiện đậm. Viết dở trong một phòng, rời phòng và kill app: mở lại thấy nguyên chữ và trích dẫn, danh
  sách phòng hiện "Nháp: …" màu đỏ; gửi thì nháp mất. Phòng có ≥ 20 tin chưa đọc: mở ra ở vạch "N tin chưa đọc" gần đầu
  màn hình (không phải ở tin mới nhất); phòng có ~120 tin chưa đọc (quá một trang 50 tin): sau một nhịp tải trang cũ
  vẫn mở ở vạch đó. Mọi sheet: kéo grabber xuống đóng, kéo ngắn bật lại, sheet có danh sách vẫn cuộn
  được; VoiceOver vuốt hai ngón hình chữ Z đóng sheet; bật Giảm chuyển động thì sheet hiện mờ dần, không trượt. Dark
  mode: giờ và dấu tick trên bong bóng của mình đọc rõ, "đã xem" là huy hiệu tick đặc khác "đã tới". Android: nút back là
  mũi tên, nút/hàng có hiệu ứng gợn sóng (cả nút gửi/đính kèm/mic của composer, thanh cảm xúc, chip lọc, tin thoại), vuốt trả lời rung một nhịp khi qua ngưỡng. Tin thoại: chạm thanh sóng để tua,
  chip 1×/1.5×/2×, TalkBack vuốt lên/xuống tua 5 s. CI đã chạy màn đăng nhập ở font_scale 2.0 + dark và audit nhãn/48 dp
  (`scripts/mobile-a11y-audit.mjs`); nightly chạy lại `chat-read-send` ở cỡ chữ lớn nhất + dark: đọc cảnh báo audit của
  phòng trong log job.
- [ ] Thông báo tin nhắn (Android, app đã kill và app ở nền): thông báo DM/nhắc tên/trả lời chủ đề có "Trả lời" và "Đánh
  dấu đã đọc"; "Trả lời" gõ một câu rồi Gửi: thông báo biến mất, người kia nhận tin (một lần), phòng hết chưa đọc trên
  web; tắt mạng rồi trả lời: tin nằm trong outbox và đi khi mở app có mạng; "Đánh dấu đã đọc": huy hiệu phòng về 0. Đổi
  ngôn ngữ app: nút đổi theo. iOS (khi có bản build): hai nút mở app rồi chạy (không mất câu trả lời).
  Chỉ máy thật xác nhận đường app đã kill: test chỉ giữ dạng payload task nền nhận (`content.dataString`, theo
  `NotificationSerializer` của expo-notifications 57); vòng xoay mãi trên ô trả lời mà tin không đi là task không đọc
  được payload — xem log `push` "chat notification action" trong logcat.
- [ ] Ngôn ngữ: iOS Cài đặt › UniChat › Ngôn ngữ và Android 13+ Cài đặt › Ứng dụng › UniChat › Ngôn ngữ chỉ liệt kê
  Tiếng Việt và English; đổi ngôn ngữ trong app rồi nhận một push: push nói đúng ngôn ngữ đó (`users.locale` đổi theo,
  xem bằng `GET /api/v1/me`). Tiếng Anh: "1 reply", "2 replies".

**Thứ tự phát hành cuộc gọi native (owner).** Server chỉ gửi push cuộc gọi data-only tới máy Android đã đăng ký token
với `call_ui` (bản 0.3.0 trở lên có module native; app đăng ký lại mỗi lần mở); bản 0.2.x và iPhone vẫn nhận push "X
đang gọi" hiển thị, nên deploy server trước hay sau bản store đều không làm máy cũ mất cuộc gọi. Push hiển thị giờ mang
kênh `calls`/`messages`/`mentions`/`general` mà bản 0.2.x chưa tạo: Expo đưa chúng vào kênh dự phòng của app (vẫn hiện,
tên kênh "Miscellaneous"). Khi 0.3.0 đã có trên track người dùng thấy, đặt `UNICHAT_MOBILE_MIN_SUPPORTED_VERSION=0.3.0`
để mọi máy có cùng giao diện cuộc gọi. Kiểm sau deploy: `push_subscriptions.user_agent = 'expo/android; call-ui'` tăng
dần theo số máy đã cập nhật.

**Cuộc gọi native trên Android (UNI-2053 S4, `docs/adr/drafts/0038-…`).** Test node/jest giữ chính sách (khi nào reo,
khi nào dịch vụ chạy, ai được báo) với module native giả; test JVM Robolectric của module
(`modules/unichat-calls/android/src/test`, chạy trong `android-release`) giữ token khởi chạy, hành động chờ, thông báo
như hệ thống nhận, dịch vụ nền của cuộc gọi, nút Từ chối/Gác máy, màn khoá và tiếng reo theo chế độ chuông; test
instrumented (`src/androidTest`, chạy trên emulator của `android-smoke`) giữ thông báo đổ chuông như System UI vẽ nó (khay,
Nghe/Từ chối). Đỏ ở bước `am instrument`: tải artifact `maestro-smoke` không có gì cho nó — đọc log job (dòng
`FAILURES!!!` và stack), tái hiện bằng `./gradlew :unichat-calls:connectedDebugAndroidTest` trên một emulator API 35.
Chỉ máy Android thật (bản `preview`/`internal` có `GOOGLE_SERVICES_JSON` và FCM) xác nhận phần còn
lại — nhạc chuông, màn toàn màn hình, push khi app bị kill, OEM. Chạy test đó trên máy dev cần Android SDK:
`cd apps/chat-mobile && pnpm exec expo prebuild -p android --no-install && (cd android && ./gradlew
:unichat-calls:testReleaseUnitTest)`. Hai tài khoản, A gọi B (luồng có sẵn:
`maestro/flows/call-answer-incoming.yaml`, chạy tay):

- [ ] B kill app, khoá máy; A gọi 1-1: màn B sáng, màn đổ chuông toàn màn hình hiện trên màn khoá (tên A, "Cuộc gọi
  thoại đến", Nghe / Từ chối), nhạc chuông là nhạc chuông của máy; chế độ rung chỉ rung, im lặng không kêu.
- [ ] Nghe: app mở trên màn cuộc gọi và nối; khoá máy giữa cuộc gọi — tiếng hai chiều vẫn còn sau 2 phút; thanh thông
  báo có "Cuộc gọi thoại · chạm để quay lại" với đồng hồ và Gác máy; Gác máy ở đó kết thúc cuộc gọi ở cả hai bên.
- [ ] Nghe từ màn khoá chưa mở khoá: màn cuộc gọi hiện ngay trên màn khoá (không đòi mở khoá); gác máy thì màn khoá
  trở lại như trước.
- [ ] B kill app, khoá máy; A gọi rồi gác ngay khi màn B vừa sáng (app còn đang mở lạnh): B thấy lại màn khoá của máy,
  không phải phòng chat với A.
- [ ] A gọi rồi đưa app xuống nền (Home) trước khi B nghe; B nghe: tiếng hai chiều vẫn còn ở A sau 2 phút, thông báo
  "đang diễn ra" của A chuyển sang đồng hồ; A mở lại app: không lỗi, cuộc gọi vẫn chạy.
- [ ] Bản 0.2.x còn cài trên một máy Android khi server đã deploy: A gọi, máy đó vẫn hiện push "A đang gọi" (không
  mất cuộc gọi).
- [ ] Từ chối trên thông báo khi app đã kill: chuông tắt ngay, A thấy "từ chối" trong vài giây (không phải đợi 45 s).
- [ ] B có hai máy Android: nghe ở máy 1 thì máy 2 thôi reo trong vài giây; A gác máy khi B chưa nghe thì máy B thôi
  reo và hiện "Cuộc gọi nhỡ từ A" (kênh Cuộc gọi nhỡ).
- [ ] B đang mở app ở workspace khác của cùng tổ chức (hoặc màn chọn workspace): cuộc gọi hiện thông báo heads-up có
  Nghe / Từ chối; đang mở đúng workspace: chỉ màn cuộc gọi trong app reo, không kèm thông báo.
- [ ] Đang mở một sheet (nhấn giữ tin, ảnh xem lớn) khi cuộc gọi tới: sheet đóng, nút Nghe bấm được.
- [ ] Trong cuộc gọi có tai nghe Bluetooth: lần gọi đầu hỏi quyền "thiết bị ở gần"; nút Âm thanh liệt kê Bluetooth /
  Loa trong / Loa ngoài và chuyển được; cuộc gọi thoại bắt đầu ở loa trong, gọi video ở loa ngoài.
- [ ] Android 14: Cài đặt hệ thống › Ứng dụng › UniChat › Thu hồi "toàn màn hình": cuộc gọi chỉ còn heads-up, Cài đặt ›
  Thông báo trong app hiện dòng bật lại và mở đúng trang.
- [ ] Cài đặt hệ thống › Thông báo của UniChat: các kênh "Cuộc gọi đến", "Cuộc gọi đang diễn ra", "Cuộc gọi nhỡ",
  "Lượt nhắc đến bạn", "Tin nhắn", "Thông báo khác" theo ngôn ngữ app; không còn kênh "Chat"; biểu tượng app có số
  tin chưa đọc (launcher hỗ trợ).
- [ ] `FF_UNICHAT_MOBILE_CALLS=false`: không máy nào reo, cuộc gọi đang diễn ra vẫn tiếp tục với thông báo của nó.
- [ ] Không gì ngoài nút Nghe nhận cuộc gọi (audit bảo mật, `CallLaunchTokens.kt`). Trong lúc A đang gọi B, trên máy B:
  `adb shell am start -a android.intent.action.VIEW -d 'uniworkchat://open?url=<link chat của cuộc gọi>%26answer%3D1'`
  và cùng lệnh với `--es expo.modules.unichatcalls.CALL_LAUNCH <callId> --es expo.modules.unichatcalls.LAUNCH_TOKEN x
  --ez expo.modules.unichatcalls.ANSWER true`: app chỉ hiện màn đổ chuông, micro không mở; máy đang khoá thì app không
  hiện trên màn khoá. Bấm Nghe trên thông báo thì nghe như thường.
- [ ] Mở một link `https://app.uniworkos.com/<org>/<ws>/chat?dm=<userId>` từ trình duyệt: app hỏi "Mở cuộc trò chuyện
  riêng?" kèm tên người; Hủy thì không tạo phòng nào. Chạm một người ở tab Danh bạ, hay "Nhắn tin" ở thành viên trong
  thông tin phòng: mở thẳng cuộc trò chuyện, không hỏi.
- [ ] Android 9–12 (quyền bộ nhớ đã bị gỡ): gửi ảnh từ thư viện, chụp ảnh từ composer, gửi một tệp PDF — không lỗi quyền.
- [ ] Cài đặt › Quyền riêng tư và bảo mật › Khoá UniChat: bật đòi Face ID/vân tay trước; kill app, mở lại: màn khoá và
  hộp thoại sinh trắc hiện ngay, Huỷ thì ở lại màn khoá, "Mở khoá" hỏi lại; về Home 30 s rồi quay lại với "1 phút":
  không khoá, quá 1 phút: khoá. Máy khoá + có cuộc gọi đến: nghe được ngay, không qua màn khoá của UniChat; trong cuộc
  gọi không có nút thu nhỏ (khoá đang bật); gác máy thì màn khoá UniChat hiện. Mở một ảnh (trình xem ảnh) hay menu của
  tin, về Home quá thời gian khoá rồi quay lại: ảnh/menu đã đóng, chỉ màn khoá hiện. Android, "Ngay", mở khoá bằng mã
  PIN của máy (không vân tay): mở xong vào app, không khoá lại và hỏi lần nữa. Tắt Khoá UniChat cũng đòi Face ID/mã
  khoá; Huỷ thì công tắc vẫn bật. Máy không đặt khoá màn hình: công tắc nói cần đặt khoá trước.
- [ ] Bật "Chặn chụp màn hình": Android chụp màn hình báo bị chặn, màn đa nhiệm của UniChat trơn; iOS ảnh chụp và
  quay màn hình của UniChat đen, trình chuyển app thấy lớp phủ. Tắt: chụp lại được.
- [ ] Gỡ app trên iPhone khi đang đăng nhập rồi cài lại: mở app vào màn đăng nhập (không vào thẳng inbox cũ); web ›
  Thiết bị không còn phiên của máy cũ.

## Triệu chứng

- Run release xanh với notice `EXPO_TOKEN is not set` — đúng khi chưa thiết lập; sau thiết lập là thiếu secret.
- Run release đỏ ở job `verify`: một kiểm tra của PR không qua trên SHA của tag (thường là commit chưa qua PR).
- PR đỏ ở `Bundle budget` (`… is over the ceiling …`), ở `expo-doctor`, ở `Android release build`, hoặc ở
  `Android cold-start smoke` (app crash lúc mở; artifact `maestro-smoke` có log và ảnh chụp).
- Run release đỏ: `… is on neither main nor develop`, `… does not match app.config.ts version`, `eas build` (cấu hình,
  cài gói, biên dịch native) hoặc submit (khoá ASC/Play, `ascAppId`, bản Play đầu chưa tải tay,
  `Only releases with status draft may be created on draft app`).
- Bản mới không hiện ở TestFlight/Play internal sau 1 giờ.
- OTA không tới máy, tới nhầm bản native, hoặc bản OTA làm app lỗi/crash.
- Nightly: đỏ ở `gate` với `The Maestro flows cannot run, not set: …`; đỏ ở `android-production`; đỏ ở bước build;
  đỏ ở bước Maestro (`Sign in`, `Push opens the room`, `Offline sends survive a kill` — tin chờ không hiện lại sau
  kill là outbox/kho mã hoá không giữ: xem issue `source:device-store` trên Sentry; tin không tới sau khi bật mạng là
  luồng flush; tin hiện hai lần là `client_msg_id` không được server khử trùng).
- Play/App Review từ chối: "Foreground service permissions" (loại FGS chưa khai báo hoặc thiếu video), "Account
  deletion" (không tìm thấy lối xoá trong app hoặc URL), "User generated content" (thiếu báo cáo/chặn), "Data safety"
  lệch với hành vi, hoặc Apple 5.1.2(i) (gửi dữ liệu cho AI không hỏi).
- PR đỏ ở `android-manifest.test.ts`: một gói native, plugin hay tuỳ chọn plugin đổi quyền hoặc dịch vụ Android.
- Android không reo khi app đóng (chỉ reo khi mở), reo mà không có màn toàn màn hình, Từ chối không tới người gọi,
  hay mất tiếng khi khoá máy giữa cuộc gọi (cuộc gọi native, `modules/unichat-calls`).
- Người dùng báo tin kẹt "Chờ có mạng để gửi" khi đã có mạng, app mở vào danh sách trống dù trước đó có dữ liệu, hoặc
  banner "Đang kết nối…" không tắt.

## Kiểm tra

1. Bản build: `eas build:list --platform all --limit 5` (trạng thái, version, build number, profile); log ở link EAS
   trong run của workflow.
2. Version: `pnpm --filter @uniwork/chat-mobile exec expo config --type public --json | jq .version` bằng phần sau
   `chat-mobile-v` của tag.
3. OTA: `eas update:list --branch internal` — cột runtime version (fingerprint) phải bằng runtime của bản cài đang
   lỗi/đang chờ; `eas channel:view internal` cho biết kênh trỏ nhánh nào. Trên máy: Cài đặt › Giới thiệu hiện phiên
   bản, bản dựng, kênh và 8 ký tự đầu của id bản cập nhật ("Bản cài sẵn trong ứng dụng" khi chưa nhận OTA); nút
   "Sao chép thông tin phiên bản" cho chuỗi đầy đủ kèm runtime.
4. Crash: Sentry, lọc `release` (`<bundle id>@<version>+<build>`) và tag `update_id`/`channel`; crash-free sessions
   theo release. Server: header `X-Client-Version`/`X-Client-OS`/`X-Client-Update-Id` của mỗi request và
   `client_version` của socket cho biết bản nào đang gọi. Lệch hợp đồng app–server: issue mức `warning` có tag
   `endpoint` (route, id thành `{id}`), `http_status` và `error_code`, mỗi tổ hợp một issue — 400/409/413/415/422 mà màn
   hình không tự giải thích; tăng đột ngột sau một lần deploy server là dấu hiệu server đổi hợp đồng mà bản app chưa
   theo. 401/403/404/408/410/429 và mất mạng không thành issue. Lỗi bị bỏ qua có chủ ý (gửi tín hiệu gác máy, beat hiện
   diện, ghi lựa chọn trên máy…) để breadcrumb `warning` theo scope (`calls`, `presence`, `auth`, `theme`…), đi kèm
   crash kế tiếp; `"report"` thì còn thành issue khi không phải lỗi mong đợi.
5. Cấu hình một biến thể: `UNICHAT_ENV=staging UNICHAT_API_URL=… UNICHAT_APP_URL=… pnpm --filter
   @uniwork/chat-mobile exec expo config --type public` (tên, bundle id, scheme, `updates`, `extra`).
6. Offline và realtime: Sentry, lọc release đó, tìm breadcrumb `device store unavailable` (kho mã hoá không mở được
   — Keychain/Keystore khoá, module native thiếu: app chạy bằng bộ nhớ, không giữ gì qua lần mở), `outbox copy failed`
   (tệp gửi từ chỗ trình chọn để lại), `cached rooms not restored`/`not saved`/`unreadable`, `cached queries dropped`
   (bản cache đĩa của bản trước không còn đọc được qua schema hiện tại — một OTA đổi shape: các query đó chỉ refetch;
   tăng mạnh sau một OTA mà dữ liệu không đổi shape thì xem `CACHE_SCHEMA_VERSION`), và lỗi tag `source:pending-op`
   (server từ chối hẳn một lượt đọc/biểu cảm/bình chọn). Tin kẹt "Chờ có mạng để gửi": máy thử lại sau 2, 5, 15 rồi mỗi
   60 s, và ngay khi có mạng, socket nối lại hay app về foreground — tin vẫn kẹt nghĩa là server trả lỗi tạm thời
   (5xx/429/timeout) cho `POST …/messages`; xem log server theo `X-Client-Version`. Socket: `client_version` trong log hub.
7. Nightly: artifact `maestro-ios` / `maestro-android` của run chỉ có ảnh chụp màn hình (log lệnh của Maestro ghi mật
   khẩu đã gõ và repo công khai, nên không tải lên); log từng bước nằm trong log của job. Bước đầu đỏ là nguyên nhân,
   các bước sau thường là hệ quả.
8. Hiệu năng (khi bản build có `SENTRY_DSN`): Sentry › Performance, lọc release đó. Transaction `app.start.cold`/
   `app.start.warm` cho thời gian mở app; mỗi màn là một transaction điều hướng với `ui.load.initial_display` (TTID) và,
   ở tab Chat và một phòng, `ui.load.full_display` (TTFD: danh sách phòng / trang tin mới nhất đã vẽ); khung chậm/đơ và
   JS stall nằm trong measurements của chúng. Mẫu 10 % phiên production, mọi phiên dev/staging. So sánh TTFD p75 giữa
   hai release trước khi mở rộng rollout. Alert hiệu năng của Sentry (thiết lập một lần, khi có dự án Sentry —
   Alerts › Create › Performance/Metric, môi trường `production`, mỗi release): `app.start.cold` p75 > 3 s trong 1 giờ;
   TTFD (`ui.load.full_display`) p75 của transaction tab Chat > 2,5 s và của phòng > 2 s; tỷ lệ khung đơ
   (`frames_frozen_rate`) > 1 % — gửi tới kênh on-call mobile. Số p75 của release đang rollout đi vào báo cáo go/no-go
   (`docs/evidence/unichat/go-no-go-template.md` › Hiệu năng). Trên máy dev, số render của hàng khi gõ/hiện diện/tin mới:
   `pnpm --filter @uniwork/chat-mobile exec jest components/chat/conversation-renders.test.tsx components/chat/chat-tab-renders.test.tsx`.

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
   - Hoặc quay về bản nhúng trong binary: `eas update:roll-back-to-embedded --branch internal --runtime-version <fingerprint>`
     (fingerprint lấy ở cột runtime version của `eas update:list`).
   - Bản đang rollout dở (dưới 100 %): `eas update:edit --branch internal` đặt tỷ lệ về 0, hoặc republish bản trước.
   Máy nhận ở lần mở tiếp theo. Sau đó sửa và phát OTA mới. Bản OTA rollback cũng phải ký nếu app có chứng chỉ.
6. **Rollback bản store** (lỗi native, hoặc OTA không cứu được): store không cho hạ build number, nên đi tới. Revert
   trên `develop`, bump `version` (patch), tag. Trong lúc chờ: TestFlight → build lỗi → Expire build; Play Console →
   Internal testing → tạm dừng/thay release bằng bản mới. OTA cũ không áp vào bản mới vì runtime version khác.
7. Nightly đỏ ở `Join a call` với cuộc gọi cũ còn treo trong phòng thử (một đêm trước dừng giữa cuộc gọi): kết thúc
   nó từ web bằng tài khoản thử rồi "Re-run failed jobs".
8. Nightly đỏ ở sheet đăng nhập nhiều đêm liền mà app không đổi: chụp màn từ artifact, đối chiếu nút/nhãn của trang
   login/consent web với `apps/chat-mobile/maestro/subflows/sign-in.yaml`; web đổi chữ thì sửa subflow cùng PR đó.
9. PR vượt ngân sách bundle: bảng trong job summary cho biết số nào; tìm gói mới kéo vào cây (số module tăng) và bỏ
   hoặc nạp lười. Nếu sức nặng là có chủ đích, nâng trần trong `apps/chat-mobile/bundle-budget.json` cùng commit đó,
   ghi lý do trong body. `expo-doctor` đỏ: làm theo lời khuyên của nó (lệch phiên bản gói thì
   `pnpm --filter @uniwork/chat-mobile exec expo install --check`). `Android release build` đỏ mà EAS chưa đụng tới:
   tái hiện bằng `expo prebuild -p android` + `./gradlew :app:assembleRelease` trên máy có Android SDK.
   `Android cold-start smoke` đỏ: tải artifact `unichat-release-apk`, cài lên emulator/máy, `adb logcat` lúc mở
   (thường là module native thiếu hoặc lỗi JS lúc boot); `maestro test apps/chat-mobile/maestro/flows/smoke-launch.yaml`.
10. PR đỏ ở `conversation-renders` hoặc `chat-tab-renders` (số render của hàng tăng): một cell nhận closure mới, object
    dựng trong render, hoặc màn hình đăng ký cả store (gõ, hiện diện) thay vì một selector theo phòng/người. Đọc mục
    Hiệu năng của `apps/chat-mobile/CLAUDE.md`; đừng nới số trong test nếu không có lý do ghi trong body commit.
11. Nightly đỏ ở `gate`: đặt các biến/secrets `MAESTRO_*` (Thiết lập lần đầu, bước 10); chưa có server staging thì
   chạy tay với `maestro` bỏ chọn — run theo lịch sẽ đỏ mỗi đêm cho tới khi có, có chủ đích.
12. Lỗi chỉ ở một tính năng (gọi) mà OTA chưa sửa kịp: tắt bằng `FF_UNICHAT_MOBILE_CALLS=false` (mục "Chặn bản cũ
   và tắt tính năng từ server"). Bản cũ có lỗi mà bản mới đã lên store: đặt `UNICHAT_MOBILE_MIN_SUPPORTED_VERSION`.
13. OTA không tới máy: runtime (fingerprint) của bản OTA khác bản cài (thay đổi chạm native → cần bản store); hoặc app
   có chứng chỉ mà bản OTA không ký/ký sai khoá (log của expo-updates trên máy: `code signing`); hoặc bản OTA build sai
   biến thể (bản phát trước khi workflow tự đặt `UNICHAT_ENV`: runtime khác mọi bản store, phát lại từ CI). Run OTA đỏ ở
   "The update is the channel's variant, with its servers": `… would be built as dev` là `UNICHAT_ENV` không tới bước
   đó (sửa workflow), `… has no apiUrl` là thiếu `UNICHAT_API_URL`/`UNICHAT_APP_URL` trong môi trường EAS của kênh.
   Warning `runtime … differs`: bản OTA không tới bản store mới nhất của kênh; đổi native thì cắt bản store trước.
   Run OTA dừng trước bước đầu với lỗi deployment protection: Environment `chat-mobile-update` chưa cho nhánh đang
   chạy (Thiết lập lần đầu, bước 5).
14. Bị store từ chối vì App content: đối chiếu checklist "Play Console App content và App Store Connect" ở trên với lý
   do trong thư từ chối; sửa khai báo trên Console (không cần build mới) nếu app đã đúng. FGS: so danh sách
   `node apps/chat-mobile/scripts/android-manifest.mjs` với khai báo; loại thừa thì gỡ bằng plugin/tuỳ chọn, loại thật
   thì khai báo kèm video. Xoá tài khoản: kiểm tra Cài đặt › Xóa tài khoản trên bản đã nộp và URL `#delete-account`
   còn trỏ đúng mục.
15. `android-manifest.test.ts` đỏ: quyền/dịch vụ mới có chủ đích thì cập nhật danh sách trong test, bảng quyền của
   `store/listing.md` và khai báo Play cùng PR; không chủ đích thì tìm gói kéo nó vào (`scripts/android-manifest.mjs`
   đọc manifest của từng thư viện) và gỡ bằng `tools:node="remove"` trong `plugins/with-removed-android-services.js`.
16. Tin kẹt trong hàng đợi hay cache trên máy hỏng: sửa nguyên nhân ở server (tin chờ tự đi khi server nhận lại, mỗi
   tin một lần nhờ `client_msg_id`). Một máy cụ thể: đăng xuất rồi đăng nhập lại xoá hàng đợi, tệp chờ và cache trên
   máy đó (tin chưa gửi mất — báo người dùng). Cache trên máy giữ qua bản store mới và OTA (buster là
   `CACHE_SCHEMA_VERSION` + user; bản ghi đọc lại qua schema): cache sai nghĩa sau một bản thì bump
   `CACHE_SCHEMA_VERSION` trong `data/persisted-cache.ts` và phát OTA — mọi máy bỏ bản cũ ở lần mở sau.
   Kho mã hoá không mở được: Sentry có issue `source:device-store` — tag `outcome:memory` (lần mở đó chạy bằng bộ
   nhớ, tin xếp hàng mất nếu app bị kill; nhiều máy cùng lúc là lỗi native của `react-native-mmkv`/
   `react-native-nitro-modules`, cần bản store) hoặc `device_store_key_lost` / `outcome:file_deleted` (khoá trong
   Keychain/Keystore mất mà tệp còn — khôi phục sang máy mới, Keystore bị xoá —, tệp bị xoá có chủ ý, hàng đợi và cache
   của máy đó mất; tăng đột biến sau một bản thì nghi lỗi đọc khoá, xem breadcrumb `device store key not read`).
17. Khoá Apple/Google hết hạn hoặc lộ: thu hồi ở Apple/Google, tạo khoá mới, tải lại bằng `eas credentials`; `EXPO_TOKEN`
   lộ: thu hồi robot token trên expo.dev, tạo token mới vào Environment. Khoá ký OTA lộ: tạo cặp khoá/chứng chỉ mới,
   commit chứng chỉ mới, cắt bản store (binary cũ vẫn tin chứng chỉ cũ cho tới khi người dùng cập nhật; đặt
   `UNICHAT_MOBILE_MIN_SUPPORTED_VERSION` khi bản mới đủ phổ biến).

18. Cuộc gọi native trên Android hỏng (triệu chứng ở trên). Không reo khi app đóng: push data-only không tới — thiếu
   `GOOGLE_SERVICES_JSON` của bản build, máy tắt thông báo hay đang tiết kiệm pin nặng (Doze vẫn nhận FCM ưu tiên cao;
   chế độ "hạn chế" của vài hãng thì không: hướng dẫn người dùng bỏ hạn chế pin cho UniChat), hoặc
   `uniwork_push_sent_total{result="failed"}` tăng ở server. Reo mà không toàn màn hình: Android 14 đã thu hồi
   full-screen intent (Cài đặt › Thông báo trong app có dòng bật lại) hoặc Play chưa duyệt khai báo. Từ chối không tới
   người gọi khi app đã kill: Android từ chối khởi động task nền — hành động chờ tới lần mở app sau (người gọi vẫn hết
   giờ đổ chuông). Mất tiếng khi khoá máy: dịch vụ cuộc gọi không chạy (Sentry/breadcrumb của bản đó; quyền micro chưa
   cấp lúc bắt đầu thì dịch vụ chạy lại khi LiveKit nối). Lỗi trong Kotlin cần bản store; trong lúc chờ có thể tắt gọi
   (mục 12).
19. **Ghim khoá TLS** (`apps/chat-mobile/plugins/with-tls-pins.js`, tắt mặc định; audit bảo mật
   "no-pinning-or-attestation"). Bật: lấy SPKI SHA-256 của khoá CA trung gian đang ký chứng chỉ của API và web, và của
   ít nhất một CA dự phòng (CA khác, hoặc khoá kế tiếp của cùng CA):
   `openssl s_client -connect api.uniworkos.com:443 -showcerts </dev/null | awk '/BEGIN/{n++} n==2' | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`
   (`n==2` là chứng chỉ trung gian; dự phòng tính từ PEM của CA đó). Đặt trong môi trường EAS của bản build (`preview`
   trước, `production` sau một tuần không lỗi): `UNICHAT_TLS_PINS=<pin1>,<pin2>` và `UNICHAT_TLS_PIN_EXPIRES=<ngày,
   ~12 tháng sau>`; config từ chối một pin, pin sai dạng, thiếu hay quá ngày hết hạn. Đây là thay đổi native (bản store
   mới). Xoay vòng: thêm pin của CA mới vào bản store trước khi server đổi CA, bỏ pin cũ ở bản sau; gia hạn ngày hết hạn
   mỗi bản store. Sự cố (server đổi sang CA không có trong pin): Android tự bỏ ghim sau ngày hết hạn, trước đó cần bản
   store mới; iOS không có hết hạn — chỉ bật pin trên bản iOS khi đã có quy trình phát bản khẩn. OTA vẫn tới được vì
   `u.expo.dev` không bị ghim, nhưng OTA không đổi được cấu hình native. Kiểm sau khi bật: app vào được inbox trên mạng
   thường; qua proxy chặn TLS (mitmproxy với CA người dùng tự cài) thì app báo mất kết nối, không lộ token.

## Leo thang

- Tài khoản Apple Developer, Google Play Console, Expo tổ chức, chứng chỉ và khoá: người giữ tài khoản (UNI-1838).
- EAS sự cố: <https://status.expo.dev>; app đang cài vẫn chạy, chỉ chậm build/OTA. GitHub: <https://www.githubstatus.com>.
- Bản lỗi làm app không mở được để nhận OTA hay bản sửa (expo-updates tự quay về bản nhúng khi bản OTA crash lúc mở;
  nếu chính binary lỗi thì không): chủ epic UNI-1826, báo người thử gỡ và cài lại bản tốt qua TestFlight/Play.
