# unichat-mobile-release — phát hành, OTA và rollback bản mobile UniChat

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** không có alert — runbook vận hành của UniChat M4 (UNI-1836) · **Workflow:** `.github/workflows/chat-mobile-release.yml`, `.github/workflows/chat-mobile-production.yml`, `.github/workflows/chat-mobile-promote.yml`, `.github/workflows/chat-mobile-release-health.yml`, `.github/workflows/chat-mobile-update.yml`, `.github/workflows/chat-mobile-rollback.yml`, `.github/workflows/mobile-verify.yml`, `.github/workflows/chat-mobile-verify.yml`

App `apps/chat-mobile` build trên EAS theo `apps/chat-mobile/eas.json`. Năm profile:

| Profile | `UNICHAT_ENV` | Phân phối | Kênh OTA | Môi trường EAS | Dùng khi |
| --- | --- | --- | --- | --- | --- |
| `development` | `dev` | internal (dev client) | `development` | `development` | Dev trên máy thật, JS từ Metro |
| `preview` | `staging` | internal (APK / ad hoc, link cài) | `preview` | `preview` | Pilot trước khi có store, QA một nhánh |
| `internal` | `staging` | store → Play internal (TestFlight khi có tài khoản Apple) | `internal` | `preview` | Mỗi tag `chat-mobile-v*` |
| `production` | `production` | store → internal track của app production, rồi promote | `production` | `production` | `chat-mobile-production.yml` từ tag trên `main`; phát hành theo giai đoạn (mục dưới) |
| `production-check` | `production` | không phát hành | `production` | `production` | Chỉ nightly `eas-local`: đúng profile `production`, tắt `autoIncrement` để version code trên store không nhảy |

`version` trong `apps/chat-mobile/app.config.ts` là version store (0.3.1; 0.3.0 từ UNI-2053). `runtimeVersion` là
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

**Cổng trước khi phát hành (CI, ADR 0043 — chặn ở mọi `GATE_LEVEL`)**

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
  `docs/events/CATALOGUE.md`, `server/internal/handler/dto/sdo/**`), `native` và `e2e` (khi `native`, hoặc khi thay đổi
  chạm thứ các luồng đã đăng nhập chạy ngoài binary: ba flow, subflow và script Maestro, seed, code chat và đăng nhập
  desktop của server, trang đồng ý của web). Job `gate` (`UniChat mobile gate`)
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
  Samsung/Xiaomi chạy hằng tuần ở `chat-mobile-device-farm.yml`, mục dưới), và các luồng Maestro — ba luồng vàng trên cả hai nền tảng, thêm
  `offline-send-relaunch.yaml` trên Android (chế độ máy bay: ba tin viết offline sống qua kill, mở lạnh offline vào
  inbox và phòng từ cache, bật mạng thì tới đúng thứ tự, mỗi tin một lần); thiếu biến `MAESTRO_*` thì run theo lịch
  **đỏ**, không xanh. `background-resume.yaml` (người khác viết lúc app ở nền, trong và quá cửa sổ ân hạn 25 s của
  socket) chạy ở mọi PR chạm binary trên server dựng trong job (mục dưới). Tài khoản thứ hai đăng nhập ngay trong
  flow (`maestro/scripts/peer-session.js`, `MAESTRO_CALLER_EMAIL` + `MAESTRO_CALLER_PASSWORD`): access token sống 15
  phút, nên không giữ token trong secret.
- **Luồng đã đăng nhập trên PR** (`mobile-verify.yml` › `android-e2e`, audit "nightly-never-scheduled"; mỗi PR có
  output `e2e` của `scope` — chạm binary, hoặc chạm `chat-read-send`/`offline-send-relaunch`/`background-resume.yaml`,
  `maestro/subflows/**`, `maestro/scripts/**`, `scripts/mobile-e2e-seed.mjs`, `server/internal/{handler,service}/chat*.go`,
  route chat và auth, `desktop_auth.go`, trang `/auth/desktop` của web — trong `JOBS` của `scripts/mobile-verify-gate.mjs`). Job dựng cả hệ thống trong runner như job `e2e` của
  `ci.yml`: `postgres:16` và `redis:7` là service container, server Go (migrate rồi chạy, `APP_ENV=development`,
  `DEV_VERIFICATION_CODE=123456`, file vào đĩa local, `DESKTOP_AUTH_CLIENTS` nhận redirect `uniworkchat-dev://`), bản
  build Next production cho trang đăng nhập và đồng ý. `scripts/mobile-e2e-seed.mjs` tạo qua API (đúng đường onboarding
  của web) ba tài khoản, một tổ chức và workspace, nhóm "UniChat Maestro" và DM của tài khoản thứ hai với tài khoản thử,
  rồi ghi các biến `MAESTRO_*` vào `$GITHUB_ENV` (mật khẩu được `::add-mask::`). App là biến thể dev build Release
  (`UNICHAT_ENV=dev`, id `com.uniworkos.chat.staging` để các flow dùng chung, không dự án EAS): chỉ biến thể này được
  cleartext (`app.config.ts`; `app.config.test.ts` giữ để không profile EAS nào ngoài development client build nó). App
  gọi API ở `10.0.2.2:8080` (địa chỉ của runner nhìn từ emulator, nên chế độ máy bay cắt được thật), Chrome mở trang web
  ở `localhost:3000` qua `adb reverse` (secure context như site thật). Chạy `chat-read-send.yaml`,
  `offline-send-relaunch.yaml` và `background-resume.yaml` qua `scripts/maestro-retry.sh`; không đọc secret nào. Artifact
  `maestro-e2e`: ảnh chụp và log server/web (không log Maestro: nó ghi mật khẩu được gõ), và khi một flow đỏ hẳn thì
  log máy: `scripts/maestro-retry.sh` chép `adb logcat -d` vào `logcat.txt` (`MAESTRO_LOGCAT`) trước khi emulator tắt,
  bước sau bỏ mọi dòng chứa mật khẩu và lọc `ReactNativeJS`/`ReactNative`/`AndroidRuntime` ra `logcat-js.txt` (in luôn
  vào log job). Màn "This screen hit a problem" là lỗi render một error boundary đã bắt: câu lỗi JavaScript nằm ở
  `logcat-js.txt`, không ở ảnh chụp. Đỏ ở đây mà nightly xanh: thường là seed lệch API (log server trong artifact) hay
  trang web đổi chữ mà `lib/maestro-flows.test.ts` chưa thấy.
  Lần chạy xanh đầu tiên trên GitHub là việc owner xem trước khi bật branch protection (mục trên): job chưa từng chạy
  trên runner thật.
- **Máy thật hằng tuần** (`chat-mobile-device-farm.yml`, Firebase Test Lab, audit "no-real-device-farm"): mỗi thứ Hai
  `scripts/mobile-ftl-devices.mjs` chọn máy từ danh mục của Test Lab (mỗi hãng Samsung, Xiaomi, Oppo, Vivo, Google một
  máy ở Android mới nhất, cộng máy có Android cũ nhất từ API 24; chỉ máy mà danh mục ghi `supportedAbis` có `arm64-v8a`,
  vì APK chỉ build arm64 và máy cũ giá rẻ chỉ 32-bit sẽ cài lỗi `INSTALL_FAILED_NO_MATCHING_ABIS`), rồi hai lượt: APK
  release arm64 cấu hình production
  (server placeholder, không tài khoản) mở lạnh và được Robo của Test Lab bò qua — crash, ANR hay không vẽ được màn đầu
  là đỏ; và APK test instrumented của module gọi (`modules/unichat-calls/android/src/androidTest`) — thông báo cuộc gọi
  đến hiện trong khay của từng hãng với Nghe/Từ chối. Không có ở đây: luồng đã đăng nhập (Maestro không chạy trên Test
  Lab) và push FCM tới app bị kill dưới trình quản lý pin của OEM (checklist máy thật ở mục Cuộc gọi native trên
  Android). Đỏ: mở kết quả Test Lab (link trong log của bước) — video, logcat và ảnh từng máy.
- **Đo hiệu năng trên thiết bị** (`scripts/mobile-perf.mjs`, trần ở `apps/chat-mobile/perf-budget.json`; chặn ở mọi
  `GATE_LEVEL`). `android-smoke` mỗi PR chạm binary: kích thước APK x86_64, rồi một lần mở không tính giờ (tới mốc,
  rồi `am force-stop`), `cmd package compile -f -m speed-profile` để mọi lần đo cùng một trạng thái biên dịch, rồi 10
  lần mở lạnh (`am force-stop` → chờ CPU máy lắng: từng cửa sổ 1 s của `/proc/stat` tới khi bận ≤ 25 %, tối đa 10 s →
  `am start -W`), trung vị của `TotalTime` (Android tới khung đầu của activity — app giữ khung đó tới khi nhấc splash,
  ngay trước mốc `first-screen`, nên nó là màn đầu cộng ~150 ms, không phải splash) và của thời gian từ lúc khởi chạy
  tới mốc `first-screen` (màn đầu vẽ xong dưới splash vừa nhấc). Cạnh đó, không chặn: CPU bận bao nhiêu trước mỗi lần
  (`cpuBusyPercent`, `settleMs`, `loadavg1`) và một app đối chứng mở lạnh sau mỗi lần (`controlTtidMs`, Settings) để
  phân biệt app chậm với runner chậm; summary ghi khoảng min–max của từng số qua các lần. Lệnh `startup` làm vậy ở cả
  nightly và chặng 2 GB. Nightly Android (`chat-mobile-verify.yml`, tài khoản
  staging): 5 lần mở lạnh tới mốc `inbox` (danh sách phòng đã vẽ, đã đăng nhập), rồi `perf-open-room.yaml` mở
  `MAESTRO_ROOM_ID`, reset `dumpsys gfxinfo`, `perf-scroll-room.yaml` cuộn lùi 20 lần rồi xuống lại; đo % khung giật,
  khung p90 và PSS; sau khi đã đếm khung, `perf-jump-quote.yaml` chạm trích dẫn của tin "Perf jump quote" và chờ tin
  nó trích ("Perf jump target", cách hơn 200 tin, ngoài trang mới nhất) hiện, được tô (`message-highlighted`).
  Mỗi lần mở lạnh còn đo tới mốc `js-boot` (dòng đầu của bundle, `data/perf/boot-clock.ts`): trước
  nó là phần native, sau nó là đồ thị module JS và boot. Chặng 2 GB của `android-matrix` (nightly) đo 5 lần mở lạnh
  tới `first-screen` theo profile `android-2gb`; `ios-release` (mỗi PR chạm iOS) đo 5 lần mở lạnh bản Release trên
  simulator theo profile `ios-simulator` (`simctl launch`, mốc đọc từ tệp `Documents/unichat-perf-marks.txt` của app —
  log release của iOS bỏ `console.info`; `data/perf/marks-file.ts`). Trên iOS mọi số tính từ lúc kernel khởi tiến
  trình app (`sysctl` trên host: app simulator là một tiến trình của host, cùng đồng hồ với mốc); phần `simctl launch`
  tự tốn ghi riêng (`launchOverheadMs`), kèm React factory (`reactFactoryMs`: dòng `_setUpFeatureFlags` trong unified
  log của từng lần, lưu thành `ios-startup-run<N>.log` cạnh tệp JSON) và lúc React Native bắt đầu chạy bundle
  (`rnBundleEntryMs`, mốc `rn-bundle-entry` từ `performance.rnStartupTiming`) để quy thời gian trước dòng đầu của
  bundle. Runtime bridgeless ghi ba mốc khởi động của RN (`startTime`, `initializeRuntimeStart`,
  `executeJavaScriptBundleEntryPointStart`) liền nhau ngay trước khi Hermes chạy bundle, nên chỉ mốc cuối được ghi:
  khoảng trước nó (factory, host, instance, đọc bundle) là phần native; mốc nằm ngoài khoảng từ lúc khởi tiến trình
  tới `js-boot` thì bị bỏ, kèm cảnh báo. Mỗi tệp kết quả giữ số của từng lần dưới `samples`, cạnh trung vị. Mốc là một dòng `UniChatPerf mark=<tên> at=<ms>`
  trong logcat (`ReactNativeJS`), chỉ bản build với
  `UNICHAT_PERF_MARKS=1` mới ghi (`data/logger.ts › perfMark`; `extra` nằm ngoài fingerprint) — không bản store hay OTA
  nào đặt nó (`scripts/mobile-workflows.test.mjs`). Emulator không có GPU: số khung để so giữa các bản, không phải lời
  hứa về một điện thoại; cảm nhận trên máy thật là việc của Sentry (mục Kiểm tra 8, kèm profile Hermes ở 5 % phiên).
  Trần đặt 2026-10-22 là **tạm** (profile nằm trong `provisional` của `perf-budget.json`, summary ghi "provisional
  ceilings"): chưa run nào đo app này, nên chúng chỉ bắt hồi quy thô. Mỗi job tải số của run lên artifact
  `unichat-perf-android` (PR), `unichat-perf-android-nightly`, `unichat-perf-android-2gb`, `unichat-perf-ios-simulator`
  (giữ 90 ngày). Sau 5 run xanh của một job: `gh run download <run> -n <artifact> -D runs/<run>` cho từng run, rồi
  `node scripts/mobile-perf.mjs tighten --profile <android|android-2gb|ios-simulator> runs/*/*.json` in đề xuất và
  `--write` ghi: mỗi trần = số tệ nhất + 15 %, không bao giờ cao hơn trần cũ, profile rời `provisional` khi mọi chỉ số
  có đủ 5 run. Commit đó trích URL các run; từ đó trần chỉ hạ, và chỉ nâng trong commit thêm sức nặng, ghi lý do.
  Ngoại lệ đã đặt tay một lần (vì `tighten` chỉ đọc run xanh và chỉ hạ): `ios-simulator` (hai trần mở lạnh, 2026-10-23)
  và ba trần mở lạnh của `android` (UNI-2142, 2026-10-23). `TotalTime` 3000 và `first-screen` 6000 đo cùng một khoảnh
  khắc, và trần 3000 đánh rớt khoảng 1/9 run sạch (3092 và 3329 trong 25 job 2026-10-22/23; cùng một commit cho 2056 và
  2748); nay là trung vị tệ nhất của 25 job đó + 15 %: `TotalTime` 3829, `first-screen` 3534, `js-boot` 2069. Với
  nhiễu ~22 % giữa các run trên emulator này, một trần tuyệt đối cho một run chỉ bắt hồi quy thô (+50 % bắt khoảng
  1/3, +100 % khoảng 4/5), không bắt +30 %. Để bắt được, đọc `cpuBusyPercent` và `controlTtidMs` của 5 run đo kiểu mới:
  nếu nhiễu trong run và giữa các run đã giảm thì `tighten` từ chính các run đó.
  Trần tạm có hạn: qua `provisionalUntil` (2026-12-31) mà profile còn trong `provisional` thì
  `scripts/mobile-perf.test.mjs` đỏ — đo rồi `tighten`, không lùi ngày nếu không ghi lý do trong body commit.
  **A/B danh sách tin** (`unichat_mobile_timeline_recycled`, FlashList 2 thay FlatList đảo ngược): (1) nightly như
  thường 5 đêm làm mốc; (2) bật override mức người dùng cho tài khoản `MAESTRO_TEST_EMAIL` ở console admin (hay
  `FF_UNICHAT_MOBILE_TIMELINE_RECYCLED=true` trên staging) và chạy 5 đêm nữa; so `scrollJankyPercent`,
  `scrollP90FrameMs`, `memoryPssMB` của hai nhóm artifact `unichat-perf-android-nightly`; cú nhảy tới trích dẫn thì
  `perf-jump-quote.yaml` kiểm mỗi đêm trên danh sách mà tài khoản đang được phát, cả hai nhóm. Cộng tay trên máy thật:
  mở phòng có dòng chưa đọc ngoài màn đầu và mở link tới một tin cũ (cả hai phải mở tại đó, không ở đáy), và neo cuộn
  dưới bàn phím (chỉ máy thấy). Thắng thì bật dần
  `FF_…=10%` ở production và so khung chậm/đơ theo tag `timeline_list` trong Sentry › Performance; thua hay lỗi thì
  tắt — phòng mở sau đó về FlatList, không cần bản mới. Phòng `MAESTRO_ROOM_ID` cần ≥ 500 tin để lần cuộn tải nhiều trang: gieo một lần
  bằng một access token của tài khoản thử (`TOKEN`), id workspace (`WS_ID`) và URL API staging (`API`):
  `for i in $(seq 1 500); do curl -fsS -X POST "$API/api/v1/workspaces/$WS_ID/chat/rooms/$MAESTRO_ROOM_ID/messages"
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'
  -d "{\"body\":\"Seed $i\",\"client_msg_id\":\"perf-seed-$i\"}" >/dev/null; done` (`client_msg_id` cố định nên
  chạy lại không nhân đôi). Cho `perf-jump-quote.yaml`, gieo tiếp một lần theo đúng thứ tự (cần `jq`): đích, 200 tin
  đệm, rồi tin trả lời trích đích —
  `TARGET=$(curl -fsS -X POST "$API/api/v1/workspaces/$WS_ID/chat/rooms/$MAESTRO_ROOM_ID/messages" -H "Authorization:
  Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"body":"Perf jump target","client_msg_id":"perf-jump-target"}'
  | jq -r .id)`; vòng `for` như trên với `Jump fill $i` / `perf-jump-fill-$i` cho `i` từ 1 tới 200; rồi
  `-d "{\"body\":\"Perf jump quote\",\"client_msg_id\":\"perf-jump-quote\",\"reply_to_message_id\":\"$TARGET\"}"`.
  Tin mỗi đêm `chat-read-send.yaml` gửi nằm dưới tin trả lời; flow cuộn lên tìm nó (tối đa 60 s), nên chỉ phải gieo lại
  khi phòng đã nhận vài trăm tin sau nó. Đỏ ở đây:
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
  điều tra: `MAESTRO_ATTEMPTS=1`. Trên iOS, driver XCTest của Maestro được chờ 5 phút
  (`MAESTRO_DRIVER_STARTUP_TIMEOUT: "300000"` ở mỗi job iOS; mặc định 2 phút không đủ cho lần mở đầu trên simulator vừa
  boot), và trước lần chạy lại `MAESTRO_IOS_UDID` cho script dừng `xcodebuild` và runner còn sót của lần trước. Thông báo
  "iOS driver not ready in time" ở cả hai lần nghĩa là driver không lên nổi trong 5 phút, xem log xctest_runner trong
  artifact `maestro-smoke-ios`.
- Phiên bản công cụ ghim trong workflow: `EAS_CLI_VERSION` (release và OTA, cùng một số), `MAESTRO_VERSION` (nightly, tải zip release
  thay vì script cài), `EXPO_DOCTOR_VERSION`. Nâng trong một PR riêng.
- Ngân sách bundle: hạ trần khi bundle nhỏ đi; chỉ nâng trong commit thêm sức nặng đó, ghi lý do trong body. Đo tại
  máy: `UNICHAT_ENV=production UNICHAT_API_URL=https://api.example.invalid UNICHAT_APP_URL=https://app.example.invalid
  pnpm --filter @uniwork/chat-mobile exec expo export --platform android --platform ios --output-dir /tmp/uc
  --dump-sourcemap` rồi `node scripts/mobile-bundle-budget.mjs /tmp/uc` (trần riêng cho Android và iOS).
- Bản release Android chạy R8 và thu gọn tài nguyên (`app.config.ts` › `expo-build-properties`). Crash chỉ có ở bản
  release (`ClassNotFoundException`, `NoSuchMethodError` trong một module native) thường là một lớp R8 đã bỏ: thêm luật
  `-keep` vào `ANDROID_KEEP_RULES` (đổi fingerprint: bản store mới), xác nhận bằng `android-smoke` và nightly. Lớp mã
  native tìm theo tên thì ghi thêm một lớp của gói đó vào `REQUIRED_DEX_CLASSES` (`scripts/mobile-apk-scan.mjs`, đọc tên
  từ dex của một bản release: tên đã bị đổi như `com.oney.WebRTCModule.q` thì không ghi); test của scan đỏ khi một luật
  `-keep class <gói>.**` không có lớp nào ở đó. Scan chỉ biết các lớp đã ghi: khi thêm hoặc nâng một thư viện native
  (LiveKit/WebRTC, Nitro, MMKV…), tìm trong `lib/*/*.so` của bản release các tên lớp dạng `a/b/C` mà mã native tìm, xem
  luật `-keep` của thư viện có đúng gói không (0.3.0 (11): luật của LiveKit giữ `org.jni_zero`, lớp thật ở
  `livekit.org.jni_zero`), rồi ghi lớp đó vào danh sách. Bật R8
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
   **Đã làm 2026-10-22** (thẳng với `com.uniworkos.chat`, không qua `.staging`): Team ID `XJAM488A6D`
   (`EXPO_APPLE_TEAM_ID` trên EAS, `UNICHAT_IOS_TEAM_ID` ở `deploy/app/env/uniwork-fe.env`), app App Store Connect
   "UniWork Chat" (tên "UniChat" đã có người giữ) Apple ID `6825689656` → `submit.production.ios.ascAppId`. EAS giữ
   chứng chỉ phân phối, profile, khoá APNs (`.p8` tự tạo ở Keys để server dùng cho push VoIP sau này) và khoá
   App Store Connect API. Tên đó là tên trên cả hai store (`store/listing.md › Tên trên store`, sinh ra
   `store/apple/store.config.json` và `store/play/*/title.txt`; `store-listing.test.ts` giữ): Play Console › Main store
   listing › App name cũng là "UniWork Chat". Tên dưới biểu tượng trên máy vẫn là "UniChat".
4. Google: Play Console, tạo app `com.uniworkos.chat.staging`. Bản AAB đầu tiên phải tải tay (API của Google không tạo
   được bản đầu): `eas build -p android --profile internal`, tải `.aab` lên Internal testing. Service account Google
   Cloud có quyền phát hành trên app → khoá JSON tải lên EAS (`eas credentials -p android`, mục khoá cho submit). Khoá
   FCM V1 cho push cũng tải lên EAS ở cùng màn đó (khoá khác). **Đã làm 2026-10-21/22** thẳng với `com.uniworkos.chat`:
   bản `0.2.0 (7)` tải tay lên Internal testing (link `UNICHAT_PLAY_INTERNAL_URL`), Firebase `uniwork-unichat`, service
   account `eas-play-submit@uniwork-unichat.iam.gserviceaccount.com` (cần bật *Google Play Android Developer API*
   trong dự án Cloud), SHA-256 khoá ký Play ở `UNICHAT_ANDROID_SHA256`. Chạy `eas submit` từ máy nhớ đặt
   `UNICHAT_ENV=production` trước lệnh: thiếu nó `app.config.ts` đọc ra gói `.dev` và EAS hỏi khoá cho app dev.
   Push Android còn cần `google-services.json` của dự án
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
     `SENTRY_ORG`, `SENTRY_PROJECT` (bước 8). Nên thêm Required reviewers. `chat-mobile-rollback.yml` chạy trong cùng
     Environment này (cùng khoá ký, cùng người duyệt).
   - `chat-mobile-production` (`chat-mobile-production.yml`, `chat-mobile-promote.yml`): Deployment branches and tags →
     Selected → tag `chat-mobile-v*` **và** nhánh `main` (promote chạy trên nhánh); **Required reviewers** (owner);
     secrets `EXPO_TOKEN`, `SENTRY_AUTH_TOKEN`, `PLAY_SERVICE_ACCOUNT_JSON` (khoá JSON của một service account Google
     Cloud có quyền phát hành trên `com.uniworkos.chat` — có thể dùng lại khoá đã tải lên EAS cho submit), variables
     `SENTRY_ORG`, `SENTRY_PROJECT` (và `SENTRY_URL` nếu Sentry tự host). Khi có tài khoản Apple: secrets `ASC_KEY_ID`,
     `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY` (App Store Connect API key vai trò App Manager, nội dung `.p8`) và variable
     `ASC_APP_ID` (Apple ID số của `com.uniworkos.chat`) — "UniChat mobile promote" với `platform: ios` đọc chúng.
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
   `production` không phát khi thiếu báo crash (trừ khi miễn có ghi lại). **Alert của Sentry là code**
   (`deploy/sentry/unichat-mobile-alerts.json`: crash-free sessions < 99.5 %, cold start p75 > 3 s, crash mới hay quay
   lại, bản OTA máy không khởi động được): đặt variables `SENTRY_PROJECT` và `SENTRY_ALERT_TEAM` (slug team nhận email)
   cho Environment `chat-mobile-release-health`, token có thêm `alerts:write`, rồi chạy "UniChat mobile release health"
   với `sync_alerts`; mỗi lượt chạy giờ sau so lại và cảnh báo khi ai đó sửa tay trong Sentry. Muốn alert gọi pager
   (PagerDuty/Opsgenie/Slack đã nối vào Sentry): variable `SENTRY_ALERT_EXTRA_ACTIONS` =
   `{"metric": [<action của metric alert>], "issue": [<action của issue alert>]}` theo dạng API của Sentry. Đổi alert
   thì sửa file đó qua PR, không sửa trong UI. Việc dừng rollout khi dưới ngưỡng là của job Sức khoẻ bản phát hành.
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
   Job `android-two-party` (push FCM thật, cuộc gọi đến khi app ở nền và khi tiến trình bị kill, background resume)
   cần thêm một **tài khoản thứ hai** trong cùng workspace, đã có DM với tài khoản thử: variables
   `MAESTRO_CALLER_EMAIL`, `MAESTRO_CALLER_WS_ID` (id workspace), `MAESTRO_DM_ROOM_ID` (DM của hai tài khoản); secrets
   `MAESTRO_CALLER_PASSWORD` và `UNICHAT_GOOGLE_SERVICES_JSON` (nội dung `google-services.json` của app staging, cùng
   file với biến file EAS; thiếu thì APK nightly không đăng ký push token). Máy chủ staging phải gửi push qua Expo tới
   dự án EAS có khoá FCM V1. Job `android-upgrade` không cần gì thêm: nó cài APK đêm trước (artifact
   `unichat-staging-apk`, giữ 14 ngày), đêm đầu tiên ghi notice và bỏ qua.
11. Máy thật (`chat-mobile-device-farm.yml`): một project Google Cloud bật Firebase Test Lab (Cloud Testing API và
   Cloud Tool Results API), một service account có vai trò Firebase Test Lab Admin (và đọc bucket kết quả); variable
   `FIREBASE_TEST_LAB_PROJECT` (id project), secret `FIREBASE_TEST_LAB_SA_KEY` (khoá JSON). Thiếu thì run theo lịch đỏ.
   Hạn mức miễn phí của Test Lab không đủ cho sáu máy mỗi tuần: project cần gói Blaze.
12. Kiểm cài đặt trước lần chạy theo lịch đầu tiên và trước tag đầu tiên: `gh auth login` bằng tài khoản admin rồi
   `node scripts/mobile-ci-provisioning.mjs --check`. Script đọc mọi `vars.X`, `secrets.X` và `environment:` mà các
   workflow mobile dùng (đọc từ chính file workflow, không có danh sách thứ hai), đối chiếu với repository và đúng
   environment của job, in từng tên `ok`/`MISSING` và thoát 1 khi thiếu tên bắt buộc (`OPTIONAL` trong script, mỗi tên
   một lý do). Chỉ đọc tên, GitHub không trả giá trị.

**Cắt một bản store**

1. Trên `develop`/`main`, `version` trong `app.config.ts` là version mới nếu có đổi native từ tag trước; `version` của
   `apps/chat-mobile/package.json` đổi cùng (`app.config.test.ts` đỏ khi hai số lệch).
2. `git tag chat-mobile-v<version> <sha>` rồi `git push origin chat-mobile-v<version>`.
3. Workflow: `verify` (mọi kiểm tra của PR trên SHA của tag) → gate `EXPO_TOKEN` → commit trên `main`/`develop` →
   tag khớp `version` → `eas build --platform android --profile internal --non-interactive --auto-submit`. Play
   internal hiện ngay sau submit; người thử cài qua link opt-in. iOS: khi có tài khoản Apple (bước 3 của thiết lập),
   đổi `--platform android` thành `--platform all` trong `chat-mobile-release.yml`; Apple xử lý bản build 15–30 phút
   trước khi hiện ở TestFlight.

**Phát hành production theo giai đoạn (Play, App Store)**: bản production được build **một lần** và chính binary đó
đi qua các track (audit "no-production-pipeline-binary-promotion"); một bản store tới một phần máy trước và chỉ mở rộng
theo sức khoẻ của Sentry cho đúng release đó (`<bundle id>@<version>+<build>.<android|ios>`; máy đã nhận một OTA báo
dưới `…<os>.ota.<id>`, mục Phát OTA; tên có OS vì số build iOS và version code Android do EAS đếm riêng nên trùng được).

1. **Build.** Viết "Có gì mới" cho version đó trong `apps/chat-mobile/store/release-notes.md` (vi-VN và en-US, ≤ 500 ký
   tự mỗi ngôn ngữ; nháp từ commit: `node scripts/mobile-release-notes.mjs draft`), tag `chat-mobile-v<version>` trên
   `main`. GitHub → Actions → "UniChat mobile production build" → Use workflow from → **Tags** → tag đó. Workflow
   `chat-mobile-production.yml` (Environment `chat-mobile-production`, có Required reviewers): `verify` trên SHA của
   tag → thiếu `EXPO_TOKEN` thì đỏ → tag phải là tag, trên `main`, khớp `version` và có release notes → **báo crash bắt
   buộc**: môi trường EAS `production` có `SENTRY_DSN` và Environment có `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` +
   `SENTRY_PROJECT`, thiếu thì đỏ (bản build vẫn build được khi thiếu Sentry — `SENTRY_ALLOW_FAILURE` trong `eas.json`
   — nhưng không được nộp; tick `allow_missing_crash_reporting` để miễn, summary ghi lại) → `eas build --profile
   production --wait` → **quét bảo mật AAB** vừa dựng (`scripts/mobile-apk-scan.mjs`: một credential — khoá riêng, token
   Sentry/GitHub, khoá AWS/Stripe/AI, service account Play, token `uwm_` — trong bất kỳ file nào thì đỏ và không nộp; log
   chỉ in tên luật, file và vài ký tự đầu. Xử lý: tìm biến môi trường EAS hay file đã lọt vào bundle, gỡ, xoay vòng
   credential đó vì nó đã nằm trong một artifact trên EAS, build lại; chỉ khi chắc là dương tính giả mới thêm vào
   `apps/chat-mobile/apk-scan-baseline.json` kèm lý do; `dex-class-missing` là R8 đã bỏ một lớp mã native tìm theo tên,
   như `livekit.org.jni_zero.JniInit` khiến 0.3.0 (11) chết khi mở: thêm luật `-keep` mà lỗi in ra vào
   `ANDROID_KEEP_RULES`, bump `version`, build lại; `permission-unlisted` là bản build xin một quyền ngoài
   `apps/chat-mobile/android-permissions.json`, thường do nâng thư viện: không cần thì chặn bằng `blockedPermissions`
   trong `app.config.ts`, cần thì thêm vào danh sách kèm ai thêm, vì sao giữ, Play hỏi gì, và cập nhật `store/listing.md`
   › Quyền cùng mục App content dưới đây nếu Play cần khai) → kiểm Sentry đã có release `com.uniworkos.chat@<version>+<version code>` (Gradle tải source map
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
6. iOS: khi nộp bản production bật **Phased release for automatic updates** (App Store Connect, 7 ngày). Tạm dừng, chạy
   lại hay phát cho mọi máy: "UniChat mobile promote" với `platform: ios`, `version` (`action: halt` = pause;
   `promote` + `status: inProgress` = resume, `completed` = phát hết) qua `scripts/mobile-asc-release.mjs`; job Sức khoẻ
   bản phát hành tự pause khi bản iOS dưới ngưỡng. Build, TestFlight và nộp review iOS chưa tự động (UNI-1838: tài khoản
   Apple; sau đó đổi `--platform android` thành `--platform all` ở các workflow phát hành và thêm `ascAppId`).

**Sức khoẻ bản phát hành (tự động, audit "rollout-gating-manual", "thresholds-unreachable-at-pilot-scale",
"health-gate-platform-blind")**: `chat-mobile-release-health.yml` chạy mỗi giờ (phút 17) `scripts/mobile-release-health.mjs`
hai lần: `--app production` (Sentry environment `production`, kênh OTA `production`) và `--app staging` (bản thử
`com.uniworkos.chat.staging`, environment `staging`, kênh `internal` và `preview`). Nó đọc 24 giờ qua của mọi release
trong Sentry theo tên app tự đặt — `<bundle id>@<version>+<build>.<android|ios>` là bundle nhúng của bản store,
`….ota.<id>` là một bản OTA trên nó (tên cũ không có OS là Android) — và dừng release khi **một** điều sau đúng:
- crash-free sessions **< 98 % trên ≥ 50 phiên** (vỡ nặng) hoặc **< 99.5 % trên ≥ 200 phiên**;
- **≥ 3 người** đã crash và crash-free users < 99.5 % (nhóm nhỏ không bao giờ đủ 200 phiên một ngày);
- một **crash mới**: issue unhandled có `firstRelease` là release đó, **≥ 2 người** gặp;
- một bản OTA mà **≥ 2 máy** không khởi động được (issue `OtaLaunchError`, tag `failed_update_id`, do
  `data/release/launch-health.ts` báo — kể cả khi bản đó chưa có phiên nào vì máy chưa từng chạy được nó);
- chỉ Android: **Play vitals** của version code (ngày đủ dữ liệu gần nhất, trễ 1–2 ngày) vượt ngưỡng "bad behaviour"
  của Google — user-perceived crash rate > 1,09 % hoặc ANR rate > 0,47 % trên ≥ 20 người **và** tỉ lệ đó ứng với ≥ 3
  người (cùng ngưỡng `UNICHAT_HEALTH_MIN_CRASHED_USERS` của luật Sentry: Play chỉ cho một ngày, nên ở cỡ pilot một
  người crash trên 20–91 người đã vượt 1,09 %) (`scripts/mobile-play-vitals.mjs`; service account cần quyền "View app
  quality information", thiếu thì chỉ cảnh báo).

Pilot nhỏ: hạ các con số bằng repository variables `UNICHAT_HEALTH_MIN_SESSIONS`, `UNICHAT_HEALTH_SEVERE_MIN_SESSIONS`,
`UNICHAT_HEALTH_MIN_CRASHED_USERS`, `UNICHAT_HEALTH_NEW_CRASH_MIN_USERS`, `UNICHAT_HEALTH_LAUNCH_FAILURE_MIN_USERS`,
`UNICHAT_HEALTH_VITALS_MIN_USERS` (số nguyên ≥ 1; sai dạng thì run đỏ); ngưỡng phần trăm là của runbook, không đổi. Với
pilot vài chục người, bắt đầu staged rollout ở 20–50 % thay vì 5 % và mở rộng sau ít nhất 24 giờ không có crash mới.
Dừng thế nào, theo nền tảng:
- bản OTA đang rollout dở: `eas update:revert-update-rollout --group <group>` (ký bằng `EAS_UPDATE_PRIVATE_KEY`) — máy
  trong phần rollout quay về bản trước;
- bản store Android: halt staged rollout của version code đó trên track đầu tiên trong production, beta, alpha đang có
  nó (`scripts/mobile-play-release.mjs`);
- bản store iOS: pause phased release của version đó trên App Store (`scripts/mobile-asc-release.mjs`, cần `ASC_*`);
- bản OTA đã 100 %: **không tự làm gì**, ghi "needs a person" — người trực chạy "UniChat mobile rollback" (mục Khắc
  phục), vì máy không biết bản trước có tốt hơn không. Bản thử (staging) trên Play internal/TestFlight: không có
  rollout để dừng, chỉ liệt kê ("fix forward").
Run **đỏ** khi giờ đó nó vừa dừng một release hoặc cần người làm. Release đã dừng từ trước — đã halt, đã pause, hay bản
OTA đã bị một group mới hơn cùng runtime thay (sau revert hay bản sửa) — chỉ được liệt kê, **không** đỏ: máy đã cài vẫn
giữ nó nên crash-free 24 giờ còn thấp cả ngày, và một run đỏ mỗi giờ cho việc đã làm xong dạy người ta bỏ qua màu đỏ.
Bật khi production có người dùng: repository variable `UNICHAT_RELEASE_HEALTH=on`; từ lúc đó thiếu thiết lập là đỏ.
Chạy tay ("Run workflow") mặc định `dry_run` (chỉ báo cáo). Environment `chat-mobile-release-health`: Deployment
branches → `main`, **không** Required reviewers (lịch chạy không chờ duyệt được); secrets `SENTRY_AUTH_TOKEN` (quyền
`org:read`, `event:read`), `EXPO_TOKEN`, `EAS_UPDATE_PRIVATE_KEY`, `PLAY_SERVICE_ACCOUNT_JSON`, và khi có tài khoản
Apple `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`; variables `SENTRY_ORG` (`SENTRY_URL` nếu tự host), `ASC_APP_ID`.
Báo trong vài phút, không chờ lượt chạy kế tiếp: alert Prometheus `UniChatMobileCrashes` (> 2 % lần mở lạnh của một bản
đến sau một crash) và `UniChatMobileUpdateLaunchFailures` (≥ 3 lần một giờ máy không chạy được một bản OTA) đi qua
Alertmanager như mọi alert server, cùng `UniChatMobileServerErrors` cho lỗi 5xx theo bản app (mục Kiểm tra).

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
dụng. Mỗi máy chạy một bản OTA báo về Sentry dưới release riêng `<bundle id>@<version>+<build>.<os>.ota.<id bản của
OS đó>` (bản nhúng trong binary là `<bundle id>@<version>+<build>.<os>`), nên crash-free sessions được tính cho từng bản OTA,
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

- Nhắc cập nhật (không chặn, làm trước): đặt `UNICHAT_MOBILE_RECOMMENDED_VERSION=<MAJOR.MINOR.PATCH>` trên server (sai
  dạng thì server không khởi động) khi bản đó đã có trên store/track người dùng thấy. Máy dưới mức đó thấy một dải "Đã có
  UniChat x.y.z" trên danh sách chat (`components/app/update-nudge.tsx`) với nút mở store; "Để sau" ẩn nó tới khi server
  nhắc một bản mới hơn. Không hiện khi store của nền tảng đó chưa có link, hay khi máy đã dưới mức tối thiểu (màn chặn
  thay nó). Đặt mức tối thiểu chỉ sau vài ngày nhắc, cho bản thật sự không được dùng nữa.
- Bắt cập nhật: đặt `UNICHAT_MOBILE_MIN_SUPPORTED_VERSION=<MAJOR.MINOR.PATCH>` trên server (sai dạng thì server không
  khởi động) và khởi động lại. Máy dưới mức đó chỉ còn màn "Cần cập nhật UniChat" với link store (`UNICHAT_STORE_*`,
  hoặc link thử nghiệm khi store chưa có). Chỉ đặt sau khi bản mới đã có trên store/track mà người dùng thấy.
- Tắt gọi: `FF_UNICHAT_MOBILE_CALLS=false` (cả hệ thống) hoặc override theo tổ chức/người dùng ở console admin
  (flag `unichat_mobile_calls`). Máy ẩn nút gọi, không đổ chuông (cả màn đổ chuông native của Android), push cuộc gọi
  cũ (đã tới máy) mở phòng; cuộc gọi đang diễn ra không bị cắt và giữ dịch vụ cuộc gọi của nó. Server cũng ngừng gửi push "X đang gọi" cho người mà công tắc tắt (đánh giá theo người nhận và
  tổ chức của cuộc gọi, như máy đọc nó; dòng inbox vẫn còn, `uniwork_push_suppressed_total{kind="chat_call_incoming"}`
  đếm) và không gửi push "kết thúc" (`chat.voice.ring_closed`), nên máy không reo kể cả khi app chưa đọc cấu hình.
  Bật lại: xoá biến/override.
- Gọi trên iPhone: tắt mặc định bằng flag riêng `unichat_mobile_calls_ios` (chưa có CallKit/PushKit: iPhone khoá máy chỉ
  kêu một tiếng ngắn và banner "X đang gọi" nằm lại sau khi cuộc gọi kết thúc). Server gộp nó vào
  `mobile_flags.unichat_mobile_calls` của máy gửi `X-Client-OS: ios` (`featureflags.MobileFlagsFor`) nên iPhone ẩn nút
  gọi, và push đổ chuông bỏ qua đăng ký `expo/ios` (`PushConsumer.SetMobileCallsIOS`, đếm `skipped`); Android vẫn reo.
  Chỉ bật (`FF_UNICHAT_MOBILE_CALLS_IOS=true` hoặc override) khi bản iOS có CallKit/PushKit; `unichat_mobile_calls=false`
  vẫn tắt gọi trên mọi nền tảng. Flag này **không** bật được gọi trên một bản iOS build thiếu `UNICHAT_IOS_CALLS=1`
  (app đọc `extra.iosCalls`, `lib/runtime-extra.ts › lackingFlags`): bản đó không khai background `audio` và luôn ẩn gọi,
  nên gọi trên iPhone tới người dùng bằng một binary mới qua App Review (Apple 2.3.1), không bằng công tắc.
  `app.config.ts` từ chối `UNICHAT_IOS_CALLS=1` khi `modules/unichat-calls` chưa có phần iOS.
- Tắt một phần khác của app (mặc định bật, cùng cách đặt: `FF_<KEY>=false` hoặc override ở console):
  `unichat_mobile_media_upload` (ẩn gửi ảnh/tệp trong menu đính kèm; tin đã xếp hàng vẫn đi),
  `unichat_mobile_voice_messages` (ẩn nút ghi tin thoại), `unichat_mobile_ai_catch_up` (ẩn banner "Bắt kịp nhanh"),
  `unichat_mobile_outbox_flush` (ngừng tự gửi lại tin và thao tác đang chờ khi có mạng lại / về foreground / socket nối
  lại — chúng nằm yên trên máy; gửi từ ô soạn tin và nút Thử lại vẫn chạy; dùng khi bản app gây bão gửi lại; tắt cả
  đường nền bên dưới), `unichat_mobile_background_send` (ngừng gửi tiếp khi app đã rời màn hình: iOS không xin thêm
  thời gian và bỏ task theo lịch, Android huỷ job WorkManager — phần còn nợ chờ lần mở app sau; dùng khi job nền làm hao
  pin hay gửi lặp),
  `unichat_mobile_chat_sync` (ngừng đồng bộ theo nhật ký thay đổi `GET …/chat/sync`: reconnect lại refetch mọi
  timeline đang hiện như trước; dùng khi endpoint sync chậm hay trả sai — app không cần bản mới).
- `unichat_mobile_timeline_recycled` thì ngược lại: mặc định **tắt** (FlatList đảo ngược); bật là A/B danh sách tin
  trên FlashList 2 (mục Đo hiệu năng trên thiết bị), tắt là quay về FlatList ở phòng mở kế tiếp.
- Bật dần cho một phần người dùng: `FF_<KEY>=N%` hoặc trong tệp `FEATURE_FLAGS_FILE`
  `<key>: {default: false, percent: {percent: N, by: user_id}}` — cùng một người luôn trong hay ngoài (băm id người
  dùng), khoảng N % tổng số; đổi cần khởi động lại server. Override ở console chỉ bật/tắt (người > tổ chức > toàn hệ
  thống) và thắng tỷ lệ.
- Đăng xuất bỏ các công tắc đã giữ trên máy (chúng có thể là của riêng người trước); mức tối thiểu và link store ở lại.
  Người kế tiếp chạy theo mặc định tới khi server trả lời cho họ.

**Play Console App content và App Store Connect (trước bản production đầu tiên; làm lại khi quyền, dịch vụ hay dữ liệu
đổi).** Nguồn chữ là `apps/chat-mobile/store/listing.md`; danh sách quyền và dịch vụ của bản release là
`apps/chat-mobile/android-manifest.test.ts` (in lại bằng `node apps/chat-mobile/scripts/android-manifest.mjs`), cộng các
quyền thư viện Maven gộp vào mà chỉ binary có — danh sách đầy đủ, mỗi quyền một lý do và cột Play cần gì, là
`apps/chat-mobile/android-permissions.json`, `scripts/mobile-apk-scan.mjs` giữ nó trên APK và AAB thật. Đánh dấu
từng mục khi đã nộp:

- [ ] **Privacy policy**: `https://app.uniworkos.com/privacy` (tiếng Việt `/vi/privacy`). Trang phải nói đúng những gì
  app làm: AI (Anthropic, khi bất kỳ thành viên nào dùng AI trên nội dung chung; màn đồng ý trên điện thoại chỉ cho yêu
  cầu của chính người dùng; người từ chối hay rút lại thì tin họ viết không vào yêu cầu AI nào, dù ai yêu cầu), báo cáo vi phạm (chủ sở hữu/quản trị viên thấy cả người báo cáo; báo thẳng nhà vận hành qua
  `contact@unicomhub.com`), xoá tài khoản trong app, 18+. `apps/web/features/landing/privacy-content.test.ts` giữ hai
  câu đó.
- [ ] **Data safety** (Play) / **App Privacy** (Apple): điền theo bảng "Quyền riêng tư" của `store/listing.md`, gồm
  dòng "Xử lý AI" (thu thập khi người dùng **hoặc một thành viên khác** dùng tính năng AI — đừng khai "chỉ theo yêu cầu
  người dùng") và "Báo cáo vi phạm". Câu "Shared" theo một luật (đoạn dưới bảng của listing, `store-listing.test.ts`):
  Expo/APNs/FCM, Sentry và Anthropic là nhà cung cấp dịch vụ, nên Data safety khai "không chia sẻ" ở mọi dòng; chính
  sách vẫn nêu tên từng bên. Mã hoá
  khi truyền: có. Người dùng yêu cầu xoá dữ liệu được: có.
- [ ] **Terms of use / EULA**: `https://app.uniworkos.com/terms` (`/vi/terms`), luật sư của chủ sở hữu đã duyệt chữ
  (`apps/web/features/landing/terms-content.ts`; `terms-content.test.ts` giữ mục cấm nội dung phản cảm `#acceptable-use`,
  cam kết 24 giờ và các mục tối thiểu của Apple). App Store Connect › License Agreement: chọn dùng điều khoản này làm EULA
  riêng hoặc giữ EULA chuẩn của Apple.
- [ ] **Account deletion** (Play bắt buộc với app cho tạo tài khoản; Apple 5.1.1(v)): trong app ở Cài đặt › Xóa tài
  khoản (đăng xuất mọi thiết bị, xoá dữ liệu trên máy); người không ở workspace nào vào Cài đặt từ màn chọn workspace;
  chủ sở hữu là thành viên duy nhất đóng tổ chức cùng lúc ngay trong app (gõ lại địa chỉ tổ chức). URL xoá cho Play:
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
  Nhà vận hành thấy mọi báo cáo ở `/admin/chat-reports`, gỡ được tin bị báo cáo cho mọi người ("Gỡ tin nhắn") và nhận
  alert `UniChatReportFiled` và `UniChatReportOverdue` (runbook cùng tên): trước
  khi nộp, hai alert đó phải tới người trực (Alertmanager), có ít nhất một tài khoản platform `admin` đóng được báo cáo và gỡ được tin, và
  hộp thư `contact@unicomhub.com` có người trực — **mọi báo cáo được xử lý trong 24 giờ**, điều khoản sử dụng hứa vậy
  (Apple 1.2).
- [ ] **Sign in with Apple (Apple 4.8, chỉ iOS)**: trang đăng nhập mà app mở có "Tiếp tục với Google" và cho tự đăng ký,
  nên bản iOS gửi review (cả TestFlight external) phải hiện nút Apple — ADR
  [0041](../adr/0041-dang-nhap-tren-iphone-va-sign-in-with-apple.md). Trước khi nộp: App ID `com.uniworkos.chat` (và
  `.staging`) bật capability Sign In with Apple (EAS bật khi ký bằng credential nó quản lý; không thì Certificates,
  Identifiers & Profiles › Identifiers › App ID › Sign In with Apple, "Enable as a primary App ID", rồi tạo lại profile);
  một khoá ở Keys › "+" › Sign in with Apple › Configure với primary App ID `com.uniworkos.chat`, tải `.p8` (một lần);
  server production có `APPLE_SIWA_AUDIENCES=com.uniworkos.chat,com.uniworkos.chat.staging` và
  `APPLE_SIWA_TEAM_ID=XJAM488A6D` (`deploy/app/env/uniwork-be.env`), `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY`
  (nội dung `.p8`, Secret `uniwork-apple`, `deploy/app/env/README.md › Apple`) và đã deploy bản có
  migration `users.apple_id`; `GET https://uniworkos.com/api/v1/auth/providers` trả `"apple":true`. Tên miền và địa
  chỉ gửi mail của UniWork đã đăng ký ở Certificates, Identifiers & Profiles › Services › Sign in with Apple for Email
  Communication (qua SPF/DKIM), không thì mail tới địa chỉ relay của "Ẩn email" bị Apple bỏ. Thử trên máy
  thật: đăng nhập bằng Apple (cả "Ẩn email"), đăng xuất, đăng nhập lại vào đúng tài khoản (hộp thư nhận mail
  `new_login`), xoá tài khoản — log server không có `apple revoke failed`. Ghi chú review: "Sign in with Apple is on the first screen."
- [ ] **iOS background modes (Apple 2.5.4)**: Info.plist của bản nộp chỉ có `UIBackgroundModes: processing` khi gọi còn
  tắt trên iPhone (`app.config.test.ts` đọc Info.plist cuối của bản release), và ghi chú review giải thích nó: "UniChat
  schedules a background processing task (BGTaskScheduler) that sends messages the user wrote while offline once the
  network is back; to try it, turn on Airplane Mode, send a message, leave the app, turn Airplane Mode off" (iOS chạy
  task khi nó muốn: reviewer có thể không thấy nó chạy, ghi chú nói vậy). Bản có gọi build với `UNICHAT_IOS_CALLS=1`
  và ghi chú review nói cách thử cuộc gọi.
- [ ] **iOS privacy manifest**: bản iOS archive đầu tiên trên EAS — mở `.xcarchive` trong Xcode › Organizer › Generate
  Privacy Report, đối chiếu với `store/listing.md` › "iOS privacy manifest" (dữ liệu thu thập, không tracking, lý do API).
  Email ITMS-91053/91061 sau khi upload nghĩa là một lý do hay một SDK thiếu manifest: thêm vào
  `app.config.ts › IOS_PRIVACY_MANIFEST` (và bảng của listing, `store-listing.test.ts` giữ hai bên khớp).
- [ ] **Store listing**: chữ của Play (main store listing, vi và en) dán từ `apps/chat-mobile/store/play/<locale>/*.txt`,
  feature graphic `store/play/feature-graphic.png`; App Store: `eas metadata:push` (đường dẫn ở `eas.json ›
  submit.production.ios.metadataPath`, sinh bởi `node apps/chat-mobile/scripts/store-metadata.mjs` từ `listing.md`).
  Icon hi-res của Play: `store/play/icon-512.png`. Ảnh chụp: mục "Ảnh chụp và đồ hoạ" của `listing.md` — bấm chạy
  `.github/workflows/chat-mobile-store-screenshots.yml` (emulator Pixel 2 1080 × 1920 và simulator iPhone Pro Max
  1320 × 2868, vi và en, rồi `check`; cần các biến `MAESTRO_*` của `chat-mobile-verify.yml` trỏ tới workspace dữ liệu
  review), tải artifact, xem từng ảnh rồi commit vào `apps/chat-mobile/store/`; trên máy thì
  `node apps/chat-mobile/scripts/store-screenshots.mjs capture …` cho vi và en trên mỗi nền tảng, rồi `… check`;
  `chat-mobile-promote.yml` từ chối lên production khi `check` đỏ. Support URL hiện là trang chính sách (có địa chỉ liên hệ);
  có trang hỗ trợ riêng thì đổi trong script.
- [ ] **App access**: tài khoản demo (mục "Tài khoản demo cho review" của `store/listing.md`).
- [ ] **Government apps / Financial features / Health**: không.

**Kiểm tra trên máy trước bản store (offline và realtime, UNI-2053 S3).** Test node và jest giữ logic; chỉ máy thật
(bản `preview` hoặc `internal`) xác nhận phần native — MMKV mã hoá, splash, thư mục outbox, socket giữ khi gọi:

- [ ] Server production đã phục vụ route iOS thăm dò (`lib/reachability.ts`):
  `curl -i https://uniworkos.com/api/v1/healthz` trả `200` `application/json` `{"status":"ok"}`. TestFlight build 4
  ra trước khi route lên production; app nay coi 404 của server cũ là tới được, nhưng vẫn kiểm trước mỗi bản iOS.
- [ ] Đăng nhập mới trên iPhone qua Wi-Fi và 4G: màn chọn workspace hiện đủ workspace như web, không có banner
  "Đang chờ mạng…" ở tab Chat.
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

**Kiểm tra bảo mật trên máy trước bản store (audit "Security & privacy").** Test giữ chính sách (allowlist deep link,
lọc báo lỗi, mức tối thiểu của tổ chức, quét APK/AAB); chỉ máy thật xác nhận phần nền tảng. Mỗi bản store trên Android;
trên iOS là **lượt kiểm bảo mật iOS bắt buộc trước bản iOS đầu tiên** (mọi kiểm soát iOS hiện chỉ có trong cấu hình và
test JS), rồi mỗi bản store. Ghi kết quả (ảnh, lệnh, log) vào bằng chứng go/no-go, dòng Bảo mật.

- [ ] Android: bản release không debuggable (`adb shell run-as com.uniworkos.chat ls` báo "not debuggable") và không
  sao lưu (`adb shell bmgr backupnow com.uniworkos.chat` không sao lưu gì); job quét APK của `mobile-verify.yml` xanh.
- [ ] Link từ ngoài không mở màn trong: `adb shell am start -a android.intent.action.VIEW -d "uniworkchat://account"`
  và App Link `https://<host>/<org>/<ws>/room/<id>/info` (iOS: dán vào Safari/Notes) đều về trang chủ, không tới màn xoá
  tài khoản hay thông tin phòng; link chat `…/chat?room=<id>` vẫn mở phòng.
- [ ] Ẩn nội dung thông báo (người dùng tắt trong app, hay tổ chức bật ở web): push tin riêng chỉ hiện "Tin nhắn riêng
  mới", push việc/tài liệu chỉ "Bạn có thông báo mới" — không tên người, phòng hay tiêu đề, kể cả trên màn khoá; chuông
  cuộc gọi đến vẫn hiện tên người gọi.
- [ ] Mức tối thiểu của tổ chức: owner bật "Bắt buộc khoá UniChat" và "Bắt buộc chặn chụp màn hình" ở web › Cài đặt ›
  Tổ chức. Trên máy thành viên, mở lại app: Cài đặt hiện hai công tắc bật, bị khoá, kèm "Tổ chức của bạn yêu cầu…"; mở
  lạnh hỏi Face ID/vân tay/mã; chụp màn hình bị chặn, màn đa nhiệm trống. Máy không có khoá màn hình: màn khoá nói đặt
  khoá trong Cài đặt của máy. Owner tắt lại: lựa chọn của người dùng quay lại. Đăng xuất: mức tối thiểu được gỡ.
- [ ] Ghim TLS (Khắc phục 19, runbook `unichat-tls-pins`): qua mitmproxy mà CA của nó được máy **tin** (Android: CA
  trong kho hệ thống của máy ảo/máy test đã root; iOS: CA người dùng cài và bật Full Trust), REST, socket `wss://` và
  cuộc gọi LiveKit đều hỏng mà không lộ token, trong khi một host không ghim (ảnh/tệp của tin nhắn trên S3, hay một
  trang công khai trong trình duyệt của máy) vẫn tải được qua cùng proxy; trên mạng thường mọi thứ chạy.
- [ ] iOS — Keychain sau gỡ cài: gỡ app, cài lại, mở: về màn đăng nhập (dấu cài đặt trong MMKV), thiết bị cũ biến mất
  khỏi danh sách thiết bị trên web (đã thu hồi).
- [ ] iOS — bản sao lưu: sao lưu mã hoá bằng Finder, mở bằng công cụ đọc backup (iMazing hay `idevicebackup2` +
  giải nén): không có token phiên (item Keychain là `ThisDeviceOnly`, không đi theo backup), file MMKV là dữ liệu mã
  hoá, không có ảnh hay tệp nào của tin đã gửi. Ảnh của tin **chưa gửi** nằm ở `Documents/outbox` (đã biết: chưa loại
  khỏi backup, cần một lệnh native — ghi lại có hay không).
- [ ] iOS — màn đa nhiệm: tắt cả khoá và chặn chụp thì ảnh đa nhiệm là cuộc trò chuyện; bật một trong hai thì ảnh bị
  che (app switcher protection + lớp phủ của guard). Bật chặn chụp: chụp màn hình ra ảnh trống, quay màn hình ra đen.
- [ ] iOS — đăng nhập: `ASWebAuthenticationSession` trả callback về app và đăng nhập xong; mở
  `uniworkchat://auth/callback?code=x&state=y` từ Safari khi không có lượt đăng nhập nào thì không đăng nhập được gì.
- [ ] iOS — ghim TLS và socket: kiểm riêng socket `wss://` qua mitmproxy (chưa xác minh `NSPinnedDomains`
  phủ WebSocket SocketRocket/CFStream); nếu socket vẫn nối được qua proxy thì ghi là lỗ hổng đã biết và mở việc.
- [ ] iOS — redirect: chưa xác minh URLSession có giữ `Authorization` khi theo 3xx sang host khác; app chặn 3xx cho
  mọi request JSON (`data/auth/strict-fetch.ts`), upload multipart vẫn theo fetch của React Native — bỏ qua dòng này nếu
  server không trả 3xx nào (`TestOnlyBrowserFlowsRedirect`).

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
  chat, phòng, composer, Cài đặt không cắt chữ; nút và chip cao lên theo chữ; số trên huy hiệu chỉ to tới 1.4×, nhãn tab
  tới 1.3×. Hàng phòng: tên hai dòng, giờ và huy hiệu xuống dòng dưới; nhật ký cuộc gọi: giờ dưới kết quả; Cài đặt: giá
  trị dưới nhãn.
- [ ] Menu nhấn giữ tin của mình (nhiều hàng nhất) trên máy Android 360 × 640 dp ở cỡ chữ mặc định và lớn nhất, và trên
  iPhone SE: thanh cảm xúc không bị cắt ở trên, menu cuộn được tới "Xóa", tin nâng lên còn 2–3 dòng. Menu nhấn giữ một
  phòng ở cỡ chữ lớn nhất: các hàng cuộn được, kéo grabber vẫn đóng sheet.
- [ ] VoiceOver (iPhone thật, chưa có bản iOS ký thì ghi "chưa kiểm" vào checklist go/no-go) và TalkBack: trên bong bóng,
  Actions/rotor có "Trả lời", "Thả cảm xúc Thích" trước "Thao tác với tin nhắn" và chạy đúng; trên hàng phòng có chưa
  đọc: "Đánh dấu đã đọc", "Ghim hội thoại", "Tắt thông báo" trước "Quản lý phòng"; menu nhấn giữ tin vuốt chữ Z đóng.
  Người khác gửi tin khi VoiceOver đang đọc một dòng khác: câu "Bình: …" đợi đọc xong mới nói (không cắt ngang);
  TalkBack đọc câu đó khi rảnh (live region), không bỏ qua khi hai câu giống hệt liền nhau. Tab Cuộc gọi/Danh bạ khi
  tắt mạng lúc mở lần đầu: đọc "Không tải được … Kiểm tra kết nối mạng rồi thử lại.", có nút Thử lại.
- [ ] Vuốt hàng phòng (Android và iOS): phải quá ngưỡng rồi thả thì hết chưa đọc (rung một nhịp khi qua ngưỡng), ngắn
  thì bật lại; trái thì lộ Ghim và Tắt tiếng, chạm một nút chạy lệnh rồi đóng; mở hàng khác hay cuộn thì hàng trước
  đóng; chạm hàng đang mở thì đóng, không mở phòng. Danh sách cuộn dọc không bị vuốt ngang cướp.
- [ ] Android 11+: trong phòng, bàn phím mở, kéo danh sách tin xuống chạm bàn phím thì bàn phím đi theo ngón tay và đóng
  khi thả dưới nửa; composer đi cùng. Chọn giao diện Tối trên máy để Sáng, kill app rồi mở: khung đầu sau splash đã tối.
- [ ] Màn giải thích quyền: lần đầu ghi tin thoại, gọi, gọi video, bật camera giữa cuộc gọi thoại, lần đầu vào app (thông báo) đều hiện màn của UniChat
  trước hộp thoại hệ thống; "Để sau" không hiện hộp thoại; đã từ chối hẳn thì màn nói quyền đang tắt và "Mở Cài đặt"
  mở đúng trang của UniChat. Lời nhắc thông báo lúc mở app chỉ hiện một lần mỗi máy, kể cả khi bấm "Tiếp tục" rồi từ
  chối ở hộp thoại hệ thống (Android 13+: mở lại app không hỏi nữa); Cài đặt › Thông báo hỏi lại.
- [ ] Nghe từ thông báo trên máy cài mới, đang khoá (Android): bấm "Nghe" thì màn giải thích micro hiện và ở lại trên màn
  đổ chuông; "Tiếp tục" hiện hộp thoại hệ thống, rồi cuộc gọi mới nối (micro đã được hỏi).
- [ ] Trải nghiệm hoàn thiện (audit UX 8/10). Phòng ngoài 24 phòng có cache, tắt mạng giữa lúc mở: "Không tải được tin
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
- [ ] Chạm thông báo tin nhắn khi app đã bị kill (Android và iOS): app mở thẳng vào phòng của tin đó, một lần (không mở
  hai lần, không mở lại sau khi app reload bản OTA).
- [ ] Thông báo tin nhắn (Android, app đã kill và app ở nền): thông báo DM/nhắc tên/trả lời chủ đề có "Trả lời" và "Đánh
  dấu đã đọc"; "Trả lời" gõ một câu rồi Gửi: thông báo biến mất, người kia nhận tin (một lần), phòng hết chưa đọc trên
  web; tắt mạng rồi trả lời: tin nằm trong outbox và đi khi mở app có mạng; "Đánh dấu đã đọc": huy hiệu phòng về 0. Đổi
  ngôn ngữ app: nút đổi theo. iOS (khi có bản build): hai nút mở app rồi chạy (không mất câu trả lời).
  Chỉ máy thật xác nhận đường app đã kill: test chỉ giữ dạng payload task nền nhận (`content.dataString`, theo
  `NotificationSerializer` của expo-notifications 57); vòng xoay mãi trên ô trả lời mà tin không đi là task không đọc
  được payload — xem log `push` "chat notification action" trong logcat.
- [ ] Mỗi tin một push (UNI-2141; app ở nền hay đã kill, server đã deploy migration `pushed_message_id`, `pushed_message_at`): người kia gửi
  liên tiếp 4 tin DM trong 10 giây — Android: một thông báo của phòng, chữ đổi theo tin mới nhất, tiêu đề thêm "· 4 tin
  nhắn mới", chỉ reo/rung ở tin đầu, và sau các tin im thông báo vẫn ở mục thường (không bị dồn vào "Im lặng") và còn
  biểu tượng trên thanh trạng thái (Cài đặt › Thông báo của UniChat có kênh "Tin nhắn liền sau"); iPhone: 4 thông báo
  xếp chồng dưới một mục của phòng, chỉ tin đầu có tiếng. Chờ hơn 30 giây rồi gửi tin nữa: reo lại. Đọc phòng trên web
  rồi gửi tin: reo ngay. Tắt thông báo phòng: không push nào. Nhóm 3 người, một người gửi tin không nhắc ai: hai người
  kia đều nhận push "X đã nhắn trong <nhóm>", gom và im như DM; tắt push "Tin nhắn trong nhóm và kênh" ở Cài đặt ›
  Thông báo: tin thường không còn push, tin nhắc tên vẫn reo. "Trả lời" ở thông báo tin thứ hai sau khi đã trả lời tin
  đầu: tin vẫn đi (khoá hành động theo id tin); chạm thông báo đó sau khi đã chạm thông báo của tin đầu: mở đúng tin
  mới. Android cho thấy nhiều thông báo của cùng một phòng thay vì một là bước nhấc tag (`PushTag.kt`) không chạy —
  xem logcat "push tag not lifted". Bản Android cũ (chưa đăng ký `chat_quiet`): chỉ nhận tin reo, mỗi tin một thông
  báo, tiêu đề không có "· N tin nhắn mới", không có kênh dự phòng "Miscellaneous" mới.
- [ ] Ngôn ngữ: iOS Cài đặt › UniChat › Ngôn ngữ và Android 13+ Cài đặt › Ứng dụng › UniChat › Ngôn ngữ chỉ liệt kê
  Tiếng Việt và English; đổi ngôn ngữ trong app rồi nhận một push: push nói đúng ngôn ngữ đó (`users.locale` đổi theo,
  xem bằng `GET /api/v1/me`). Tiếng Anh: "1 reply", "2 replies".
- [ ] Ngôn ngữ do hệ thống đổi sau: chọn English trong app, rồi đổi ngôn ngữ theo app của hệ thống sang Tiếng Việt —
  app mở lại bằng tiếng Việt (hệ thống thắng lựa chọn cũ), mở lạnh không thấy khung hình nào bằng ngôn ngữ kia. Android:
  đổi trong Cài đặt khi UniChat đang chạy ở nền rồi quay lại (không vuốt tắt app) — app đổi sang tiếng Việt ngay, không
  cần mở lạnh. Máy chỉ có tiếng Nhật/Hàn: app nói tiếng Anh.
- [ ] Giờ 12/24: tắt "Giờ 24 giờ" của máy (iOS Cài đặt › Cài đặt chung › Ngày & giờ; Android Cài đặt › Hệ thống › Ngày
  và giờ) khi app ở nền, quay lại: giờ của tin, danh sách phòng và nhật ký cuộc gọi đổi sang "2:05 CH"/"2:05 pm".
- [ ] Biểu tượng (Android): thông báo tin và cuộc gọi trên thanh trạng thái là glyph bong bóng một màu (không phải ô trắng);
  Android 13+ bật "Biểu tượng theo chủ đề" thì icon UniChat đổi màu theo hình nền.
- [ ] Không workspace: tài khoản bị gỡ khỏi mọi workspace đăng nhập vào màn chọn workspace thấy lời giải thích và nút Cài
  đặt; Cài đặt có chính sách, điều khoản, giấy phép, đăng xuất và Xóa tài khoản.

**Thứ tự phát hành cuộc gọi native (owner).** Server chỉ gửi push cuộc gọi data-only tới máy Android đã đăng ký token
với `call_ui` (bản 0.3.0 trở lên có module native; app đăng ký lại mỗi lần mở); bản 0.2.x và iPhone vẫn nhận push "X
đang gọi" hiển thị, nên deploy server trước hay sau bản store đều không làm máy cũ mất cuộc gọi. Push hiển thị giờ mang
kênh `calls`/`messages`/`mentions`/`general` mà bản 0.2.x chưa tạo: Expo đưa chúng vào kênh dự phòng của app (vẫn hiện,
tên kênh "Miscellaneous"). Khi 0.3.1 đã có trên track người dùng thấy, đặt `UNICHAT_MOBILE_MIN_SUPPORTED_VERSION=0.3.1`
để mọi máy có cùng giao diện cuộc gọi (không dùng 0.3.0: bản Android 0.3.0 (11) chết khi mở, chỉ lên track nội bộ). Kiểm sau deploy: `push_subscriptions.user_agent = 'expo/android; call-ui'` tăng
dần theo số máy đã cập nhật.

**Cuộc gọi native trên Android (UNI-2053 S4, `docs/adr/0038-…`).** Test node/jest giữ chính sách (khi nào reo,
khi nào dịch vụ chạy, ai được báo) với module native giả; test JVM Robolectric của module
(`modules/unichat-calls/android/src/test`, chạy trong `android-release`) giữ token khởi chạy, hành động chờ, thông báo
như hệ thống nhận, dịch vụ nền của cuộc gọi, nút Từ chối/Gác máy, màn khoá và tiếng reo theo chế độ chuông; test
instrumented (`src/androidTest`, chạy trên emulator của `android-smoke`) giữ thông báo đổ chuông như System UI vẽ nó (khay,
Nghe/Từ chối), kể cả khi nó đến từ một push FCM qua đường native không có JavaScript (`NativeCallPushRingTest`: push
Expo data-only → thông báo trong khay → push kết thúc gỡ nó). Đỏ ở bước `am instrument`: tải artifact `maestro-smoke` không có gì cho nó — đọc log job (dòng
`FAILURES!!!` và stack), tái hiện bằng `./gradlew :unichat-calls:connectedDebugAndroidTest` trên một emulator API 35.
Chỉ máy Android thật (bản `preview`/`internal` có `GOOGLE_SERVICES_JSON` và FCM) xác nhận phần còn
lại — nhạc chuông, màn toàn màn hình, push khi app bị kill, OEM. Chạy test đó trên máy dev cần Android SDK:
`cd apps/chat-mobile && pnpm exec expo prebuild -p android --no-install && (cd android && ./gradlew
:unichat-calls:testReleaseUnitTest)`. Hằng đêm `chat-mobile-verify.yml › android-two-party` chạy
`maestro/flows/call-answer-incoming.yaml` trên emulator Google APIs với FCM thật, khi app ở nền và khi tiến trình bị
kill (Nghe từ CallStyle, nối, gác máy); phần dưới là thứ chỉ máy thật kiểm được. Hai tài khoản, A gọi B:

- [ ] B kill app, khoá máy; A gọi 1-1: màn B sáng, màn đổ chuông toàn màn hình hiện trên màn khoá (tên A, "Cuộc gọi
  thoại đến", Nghe / Từ chối), nhạc chuông là nhạc chuông của máy; chế độ rung chỉ rung, im lặng không kêu. Chuông hiện
  trong vòng 1–2 s sau khi A bấm gọi (đường native, không chờ JavaScript); `adb logcat -s UniChatCalls ReactNativeJS`
  không thấy JavaScript khởi động cho tới khi bấm Nghe.
- [ ] B kill app; A nhắn DM cho B (thông báo hiện trên máy B); B đọc phòng đó trên web: trong vài phút (push ưu tiên
  thường, máy ngủ sâu thì lâu hơn) thông báo trên máy B biến mất và số trên biểu tượng giảm, app vẫn đóng.
- [ ] B mở phòng DM với A trên web và chat qua lại vài tin (máy B không hiện thông báo vì B đang đọc): `adb logcat -s
  ReactNativeJS` trên máy B (app đã kill) không thấy task nền chạy cho mỗi lần đọc (không có `room read elsewhere`).
- [ ] B kill app, bật mạng; A nhắn DM cho B; đợi thông báo hiện rồi tắt mạng máy B (chế độ máy bay) và chạm thông báo:
  phòng mở ngay trên tin mới của A, không quay vòng chờ (`chat push` `prefetched` trong log của task nền).
- [ ] B gọi 1-1 cho C rồi bấm Home khi C còn đổ chuông; A gọi B: máy B không reo cuộc gọi của A, A nghe "bận".
- [ ] B đang nghe một cuộc gọi điện thoại (hoặc cuộc gọi Zalo/WhatsApp); A gọi UniChat: B thấy thông báo cuộc gọi đến có
  Nghe / Từ chối (heads-up) nhưng không có nhạc chuông lặp đè lên cuộc gọi đang nghe — chỉ một tiếng bíp chờ cuộc gọi;
  app đang mở thì chỉ rung ngắn.
- [ ] Trên Xiaomi/Redmi, Oppo/realme, vivo và Samsung có pin "tối ưu": Cài đặt › Thông báo hiện dòng "Cho UniChat chạy
  nền" và (trừ Samsung) "Bật tự khởi động cho UniChat"; mỗi dòng mở đúng trang của hệ thống/hãng; bật xong, quay lại app
  thì dòng pin biến mất. Vuốt tắt app khỏi đa nhiệm, A gọi: B vẫn đổ chuông.
- [ ] Nghe: app mở trên màn cuộc gọi và nối; khoá máy giữa cuộc gọi — tiếng hai chiều vẫn còn sau 2 phút; thanh thông
  báo có "Cuộc gọi thoại · chạm để quay lại" với đồng hồ và Gác máy; Gác máy ở đó kết thúc cuộc gọi ở cả hai bên.
- [ ] Nghe từ màn khoá chưa mở khoá: màn cuộc gọi hiện ngay trên màn khoá (không đòi mở khoá); gác máy thì màn khoá
  trở lại như trước.
- [ ] B kill app, khoá máy; A gọi rồi gác ngay khi màn B vừa sáng (app còn đang mở lạnh): B thấy lại màn khoá của máy,
  không phải phòng chat với A.
- [ ] B kill app, khoá máy; A gọi, B không chạm gì tới khi hết chuông: chậm nhất 75 s sau lần màn sáng, máy B về màn
  khoá của máy (watchdog `CallLockScreen.HOLD_MS`), không để app mở trên màn khoá. Nghe rồi nói chuyện quá 75 s: màn cuộc
  gọi vẫn ở trên màn khoá tới khi gác máy.
- [ ] Như trên nhưng để màn tự tắt trước 75 s và máy nằm yên (ngủ sâu) vài phút rồi bấm nút nguồn: màn khoá của máy hiện,
  không phải UniChat (`CallLockScreen.recheck` ở `onResume`, theo `elapsedRealtime`).
- [ ] Nghe từ màn khoá rồi bấm thu nhỏ cuộc gọi: Android hỏi PIN/vân tay trước; huỷ thì màn cuộc gọi ở nguyên, không thấy
  chat nào; mở khoá thì cuộc gọi thu thành nút "Quay lại cuộc gọi", và khoá máy lại thì màn khoá che app như thường.
- [ ] Cuộc gọi thoại ở loa trong: áp máy vào tai thì màn tắt (máy có cảm biến tiệm cận), bỏ ra thì sáng lại; chuyển loa
  ngoài hay Bluetooth thì che cảm biến không tắt màn; gọi video không bao giờ tắt màn; gác máy thì màn không còn tắt khi che.
  Thu nhỏ cuộc gọi rồi gõ tin, hoặc bấm Home sang app khác: che cảm biến không tắt màn; mở lại màn cuộc gọi
  thì áp tai lại tắt màn.
- [ ] Đang gọi UniChat (Android 12+), có cuộc gọi điện thoại tới: khi chỉ đổ chuông, cuộc gọi UniChat vẫn nghe/nói; nghe
  cuộc gọi điện thoại thì màn UniChat hiện "Đang tạm giữ", bên kia không nghe thấy cuộc điện thoại và mình không nghe bên
  kia; gác cuộc điện thoại thì hai bên nghe lại nhau, micro đang tắt từ trước vẫn tắt. (Android 11 trở xuống: không giữ,
  ghi nhận là giới hạn đã biết.)
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
- [ ] B khoá máy (app ở nền) ngay sau khi đọc tin, A nhắn DM trong 10 s sau đó: B nhận push (không còn "im" 2 phút sau
  khi rời app). B đang mở workspace X trên máy, A nhắn vào kênh của workspace Y: B vẫn nhận push của Y.
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

**Cuộc gọi trên iPhone: PushKit + CallKit (UNI-2141, ADR 0038 §4, `docs/engineering/unichat-mobile/calls-ios.md`).**
Test node/jest giữ phần JavaScript (đăng ký token VoIP, `NativeCallSession`, Nghe/Từ chối/Kết thúc của CallKit, đồng bộ
engine → CallKit, tắt tiếng và giữ máy); `native-modules.test.ts` giữ hình của Swift (mọi VoIP push được báo cho CallKit
trước completion, module `UniChatCallKit` và subscriber khởi động được autolink). Swift chỉ được biên dịch ở
`mobile-verify › ios-release` (simulator, không ký): đỏ ở bước build thì đọc log Xcode của job (lỗi trong pod
`UniChatCalls`), sửa, đẩy lại. Thứ tự bật (owner), mỗi bước một lần (phía server: `calls.md` › Cuộc gọi trên iPhone):

1. **Apple Developer › Identifiers**: App ID `com.uniworkos.chat` và `com.uniworkos.chat.staging` bật capability **Push
   Notifications** (EAS bật khi ký nếu thiếu; kiểm lại bằng tay). VoIP push dùng topic `<bundle id>.voip`, không cần App
   ID riêng.
2. **Apple Developer › Keys**: tạo khoá **Apple Push Notifications service (APNs)**, môi trường Sandbox & Production
   (`AuthKey_<KeyID>.p8`, tải được đúng một lần), ghi Key ID; Team ID là `XJAM488A6D`. Cất `.p8` trong kho bí mật.
3. **Server**: Secret `uniwork-apple` (`APNS_KEY_ID`, `APNS_PRIVATE_KEY` = nội dung PEM của `.p8`; lệnh tạo và cách
   xoay khoá ở `deploy/app/env/README.md › Apple`) trong namespace của server, `APNS_TEAM_ID=XJAM488A6D` đã nằm trong
   `deploy/app/env/uniwork-be.env`; deploy, log có "APNs VoIP push enabled". Thiếu khoá thì iPhone giữ hành vi cũ.
4. **EAS** (`eas env:create`, môi trường `preview` cho profile `internal`, rồi `production`): `UNICHAT_IOS_CALLS=1`.
   Không đặt trong `eas.json` (`app.config.test.ts › is set by no EAS profile`). Biến này đổi Info.plist (thêm `voip`,
   `audio`) nên đổi fingerprint: cần bản store mới (`eas build -p ios --profile internal`), không OTA được.
5. **App Store Connect**: App Review Information › Notes: "UniChat uses PushKit VoIP pushes only to ring incoming
   voice/video calls between members of an organization through CallKit; background audio keeps an ongoing call
   audible." kèm tài khoản demo gọi được. **Pricing and Availability**: bỏ storefront **Trung Quốc đại lục** (Apple không
   duyệt app dùng CallKit ở đó). Mô tả App Store thêm lại dòng "Gọi thoại và video" / "Voice and video calls"
   (`store/listing.md`).
6. **Công tắc**: chạy checklist dưới trên bản TestFlight với `unichat_mobile_calls_ios` bật cho một người thử (console
   `/admin` › Feature flags, override theo user); qua hết thì bật cho tổ chức rồi toàn cục. Tắt lại là rollback: server
   thôi gửi VoIP, iPhone ẩn nút gọi.

Kiểm sau deploy: `push_subscriptions` có hàng `transport = 'apns_voip'` cho iPhone đã mở bản mới, `apns_environment` đúng
(TestFlight là `production`); metric `uniwork_push_apns_voip_total` không có `reason` `InvalidProviderToken` (sai khoá hay
Team) hay `TopicDisallowed`/`DeviceTokenNotForTopic` (sai bundle id/topic). Checklist trên iPhone thật (bản TestFlight,
hai tài khoản cùng tổ chức, A gọi B; B là iPhone):

- [ ] B mở app một lần sau khi cài (đã đăng nhập), rồi kill app (vuốt khỏi đa nhiệm) và khoá máy; A gọi 1-1: màn cuộc
  gọi đến của iOS hiện trên màn khoá trong 1–3 s với tên A, nhạc chuông của máy.
- [ ] Trượt để nghe trên màn khoá (app đã kill, máy khoá), **không mở app**: màn của iOS chuyển sang đang gọi, tiếng hai
  chiều có trong vài giây (app nối LiveKit ở nền), A thấy B đã nghe; mở khoá và chạm biểu tượng UniChat trên màn của
  iOS: app mở đúng màn cuộc gọi. Không có tiếng và A vẫn thấy đang đổ chuông: lần mở app ở nền không nối scene nên
  JavaScript không chạy (`calls-ios.md` › Native); ghi vào checklist go/no-go, kiểm tiếp: sau khoảng 30 s màn của iOS
  báo cuộc gọi thất bại và tự đóng (không treo "đang gọi"), A thấy B từ chối khi B mở app. Có lỗi này thì runbook và mô
  tả cho người dùng phải nói "mở UniChat để nghe" cho tới khi có bản sửa.
- [ ] Trượt để nghe trên màn khoá rồi A gác ngay, trước khi B có tiếng: màn của iOS trên máy B đi mất, không treo.
- [ ] Gác máy trên màn của iOS: A thấy cuộc gọi kết thúc; A gác trước: màn của iOS trên máy B đi mất.
- [ ] Từ chối trên màn khoá (app đã kill): A thấy "từ chối" trong vài giây, không đợi hết chuông; trên máy B không có
  màn cuộc gọi đến thứ hai nào sáng lên sau đó (một `end` gửi nhầm tới iPhone đã từ chối là một cuộc gọi ma). Làm lại
  với app đang mở.
- [ ] Không ai nghe: máy B thôi reo khi hết cửa sổ đổ chuông (khoảng 60 s), A thấy "không trả lời"; A gác ngay sau
  đó thì máy B không sáng lại.
- [ ] Máy B bật chế độ máy bay, A gọi rồi gác trong 60 s; B tắt chế độ máy bay: không reo, nhiều nhất một chớp màn
  cuộc gọi đến tắt ngay (push `end` APNs giữ lại).
- [ ] B có iPhone và máy thứ hai (Android hay web): nghe ở máy kia thì iPhone thôi reo trong vài giây (push `end`); nghe
  trên iPhone thì cuộc gọi trên iPhone không bị cắt khi `end` của lượt đổ chuông tới.
- [ ] Bật Không làm phiền / Tập trung: cuộc gọi theo luật của iOS cho cuộc gọi (không reo nếu iOS chặn), app không lỗi;
  tắt đi, gọi lại thì reo. Công tắc chuông im lặng: chỉ rung.
- [ ] App đang mở trên màn hình: cuộc gọi hiện banner của iOS, app không reo thêm tiếng thứ hai; nghe ở banner hay ở
  app đều nối, màn của iOS và app cùng ở trạng thái đang gọi; từ chối trong app thì banner đi mất.
- [ ] Trong cuộc gọi: tắt tiếng trên màn của iOS thì A không nghe B; bật lại thì nghe. Có cuộc điện thoại tới và B nghe
  (giữ UniChat): màn UniChat hiện "Đang tạm giữ"; gác cuộc điện thoại rồi quay lại UniChat thì nghe lại.
- [ ] Tai nghe Bluetooth / AirPods: nghe bằng nút tai nghe khi đổ chuông; tiếng đi qua tai nghe.
- [ ] Cài đặt › Thông báo trong app › tắt push trên máy: hàng `apns_voip` của máy bị gỡ, A gọi thì iPhone không reo; bật
  lại thì hàng quay lại. Đăng xuất: hàng bị gỡ.
- [ ] Bản cài từ Xcode (ký development) đăng ký `apns_environment = 'sandbox'` và reo qua APNs sandbox.
- [ ] Bản TestFlight có gọi, rồi cập nhật lên một bản không có gọi (không `UNICHAT_IOS_CALLS`) giữ nguyên đăng nhập, mở
  app một lần: hàng `apns_voip` của máy bị gỡ; A gọi thì máy nhận push "A đang gọi" như iPhone chưa có CallKit.
- [ ] `unichat_mobile_calls_ios` tắt: iPhone không reo, không có nút gọi; cuộc gọi đang diễn ra không bị cắt.

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
4. Crash: Sentry, lọc `release` (`<bundle id>@<version>+<build>.<os>`, thêm `.ota.<id>` cho một bản OTA) và tag
   `update_id`/`channel`; crash-free sessions theo release. Bản OTA máy không khởi động được: issue `OtaLaunchError`
   (tag `ota_failure`, `failed_update_id`, `failed_update_evidence`; runbook `UniChatMobileUpdateLaunchFailures.md`). Server: header `X-Client-Version`/`X-Client-OS`/`X-Client-Update-Id` của mỗi request và
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
   JS stall nằm trong measurements của chúng. Mẫu 10 % phiên production, mọi phiên dev/staging; một nửa phiên được mẫu
   ở production (5 % tổng) và mọi phiên dev/staging mang profile Hermes (`profilesSampleRate`): mở transaction chậm →
   tab Profile cho stack đã tiêu thời gian trên luồng JS (tên hàm và thời gian, không nội dung). So sánh TTFD p75 giữa
   hai release trước khi mở rộng rollout. Alert hiệu năng của Sentry là code (`deploy/sentry/unichat-mobile-alerts.json`,
   áp bằng `sync_alerts` ở trên): `app.start.cold` p75 > 3 s trong 1 giờ. Khi Sentry đã có tên transaction thật của tab
   Chat và phòng, thêm vào cùng file TTFD (`ui.load.full_display`) p75 tab Chat > 2,5 s và phòng > 2 s, và tỷ lệ khung
   đơ (`frames_frozen_rate`) > 1 %. Số p75 của release đang rollout đi vào báo cáo go/no-go
   (`docs/evidence/unichat/go-no-go-template.md` › Hiệu năng). Trên máy dev, số render của hàng khi gõ/hiện diện/tin mới:
   `pnpm --filter @uniwork/chat-mobile exec jest components/chat/conversation-renders.test.tsx components/chat/chat-tab-renders.test.tsx`.

## Khắc phục

1. Tag sai hoặc commit ngoài `main`/`develop`: `git push origin :refs/tags/<tag>`, `git tag -d <tag>`, tag lại.
2. Tag không khớp version: sửa `version` qua PR rồi tag lại, hoặc tag đúng version đang có.
3. `UNICHAT_API_URL is required`: thêm biến vào môi trường EAS (Thiết lập lần đầu, bước 2), "Re-run failed jobs".
4. Lỗi submit: sửa khoá/`ascAppId` theo bước 3–4 rồi `UNICHAT_ENV=<staging|production> eas submit -p <ios|android>
   --profile <internal|production-internal> --latest`
   (không build lại). Play báo app nháp: hoàn tất thiết lập app trên Play Console, hoặc tạm đặt
   `"releaseStatus": "draft"` cho `submit.internal.android` và phát hành tay trên Console.
5. **Rollback OTA** (nhanh nhất, cho lỗi chỉ ở JS), từ CI, không cần khoá trên máy ai: Actions →
   "UniChat mobile rollback" (`chat-mobile-rollback.yml`, Environment `chat-mobile-update`, ký bằng
   `EAS_UPDATE_PRIVATE_KEY` của nó) →
   `channel`, `platform`, `reason` (UNI-nnn và lỗi gì, ≥ 10 ký tự) và `action`:
   - `revert-rollout`: bản đang rollout dở (dưới 100 %) — máy trong phần rollout quay về bản trước (job Sức khoẻ tự làm
     việc này khi đủ ngưỡng);
   - `republish-previous`: bản đã 100 % — bản trước nó cùng runtime được phát lại, ký, thành bản mới nhất (`group` để
     trống là bản mới nhất của kênh; script từ chối khi bản đó còn đang rollout hay đã bị bản mới hơn thay);
   - `roll-back-to-embedded`: không có bản trước nào tốt — máy của runtime đó quay về bundle trong binary
     (`runtime_version` để trống là runtime của bản mới nhất); máy áp dụng như một bản `critical`.
   Tick `dry_run` để xem kế hoạch trước. Máy nhận ở lần mở hay lần quay lại foreground tiếp theo. Sau đó sửa và phát OTA
   mới. Chỉ khi CI không chạy được mới làm tay bằng `eas update:republish` / `eas update:roll-back-to-embedded` /
   `eas update:revert-update-rollout`, ký bằng khoá lấy từ kho bí mật của tổ chức.
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
   chạy tay với `maestro` bỏ chọn — run theo lịch sẽ đỏ mỗi đêm cho tới khi có, có chủ đích. Đỏ ở bước đầu của
   `android-two-party`: thiếu tài khoản thứ hai hay `UNICHAT_GOOGLE_SERVICES_JSON` (bước 10; `node
   scripts/mobile-ci-provisioning.mjs --check` liệt kê tên thiếu). Đỏ ở luồng push thật mà luồng deep link xanh: push
   không tới emulator (token chưa đăng ký vì APK thiếu file Firebase, hay khoá FCM V1 của dự án EAS sai) — ảnh chụp
   trong artifact `maestro-android-two-party` cho thấy khay thông báo. Đỏ ở `android-upgrade`: phiên, outbox hay cache
   không qua được bản cài đè — đối chiếu `data/persisted-schema.lock.json` và `CACHE_SCHEMA_VERSION` giữa hai SHA.
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
   chế độ "hạn chế" và tự khởi động của vài hãng thì không: Cài đặt › Thông báo của app có dòng "Cho UniChat chạy nền" và
   "Bật tự khởi động", hướng dẫn người dùng bấm vào), hoặc `uniwork_push_sent_total{result="failed"}` tăng ở server.
   Push tới mà không reo khi app đóng: đường native (`UniChatMessagingService`, `NativeCallPush.kt`) cần cấu hình chuông
   app ghi lúc mở (`RingConfig`): người dùng chưa mở app lần nào sau khi cài/cập nhật thì push đi đường JavaScript cũ;
   `adb logcat -s UniChatCalls` cho biết lỗi native. Tỷ lệ `call_push{result="native"}` trên `shown` theo bản cho biết
   đường nào đang chạy (alert `UniChatCallRingSlow` khi chuông trễ). Reo mà không toàn màn hình: Android 14 đã thu hồi
   full-screen intent (Cài đặt › Thông báo trong app có dòng bật lại) hoặc Play chưa duyệt khai báo. Từ chối không tới
   người gọi khi app đã kill: Android từ chối khởi động task nền — hành động chờ tới lần mở app sau (người gọi vẫn hết
   giờ đổ chuông). Mất tiếng khi khoá máy: dịch vụ cuộc gọi không chạy (Sentry/breadcrumb của bản đó; quyền micro chưa
   cấp lúc bắt đầu thì dịch vụ chạy lại khi LiveKit nối). Lỗi trong Kotlin cần bản store; trong lúc chờ có thể tắt gọi
   (mục 12).
19. **Ghim khoá TLS** (`apps/chat-mobile/tls-pins.json`, bật cho mọi bản staging và production; audit bảo mật
   "no-pinning-or-attestation"). Runbook riêng: `docs/runbooks/unichat-tls-pins.md` — host và khoá đang ghim, vì sao
   OTA không sửa được pin, đổi CA hay host đã ghim, gia hạn `expires`, sự cố app bị khoá. Job
   `chat-mobile-tls-pins.yml` kiểm chuỗi thật mỗi ngày. Kiểm sau mỗi bản store, trên Android và (khi có) iOS: app vào
   được inbox và gọi được trên mạng thường; qua proxy chặn TLS mà máy **tin** CA của proxy thì cả request REST, socket
   `wss://` và cuộc gọi LiveKit đều hỏng, app báo mất kết nối, không lộ token. Android: CA người dùng tự cài **không**
   chứng minh gì — từ Android 7 app (targetSdk ≥ 24) không tin CA người dùng, và network security config của app không
   thêm `<trust-anchors>` nào, nên mọi kết nối qua proxy đó đều hỏng dù có pin hay không. Đặt CA của mitmproxy vào kho
   hệ thống: máy ảo image Google APIs (không phải Google Play) `emulator -writable-system`, `adb root && adb remount`,
   đẩy `<hash>.0` (`openssl x509 -inform PEM -subject_hash_old -in mitmproxy-ca-cert.pem`) vào
   `/system/etc/security/cacerts/` rồi `adb reboot`; hay một máy test đã root. iOS: CA người dùng cài rồi bật Cài đặt ›
   Cài đặt chung › Giới thiệu › Cài đặt tin cậy chứng nhận (Full Trust) là phép thử hợp lệ. Cùng thiết lập đó phải có
   **đối chứng**: một host không ghim (ảnh/tệp của tin nhắn tải từ S3 qua URL ký sẵn, hay một trang công khai trong
   trình duyệt của máy) vẫn tải được qua proxy — chứng tỏ máy tin proxy, nên host đã ghim hỏng là vì pin. Đối chứng
   cũng hỏng thì phép thử không đo gì: sửa thiết lập, đừng ghi là đạt. Ghi kết quả vào bằng chứng của bản (iOS: kiểm riêng socket, vì chưa xác minh `NSPinnedDomains` có phủ
   WebSocket SocketRocket hay không). Lỗi ghim không phân biệt được với mất mạng trong JS (đều là lỗi mạng), nên không
   có sự kiện Sentry riêng: theo dõi tỉ lệ `ApiError` status 0 theo bản sau khi bật.

## Leo thang

- Tài khoản Apple Developer, Google Play Console, Expo tổ chức, chứng chỉ và khoá: người giữ tài khoản (UNI-1838).
- EAS sự cố: <https://status.expo.dev>; app đang cài vẫn chạy, chỉ chậm build/OTA. GitHub: <https://www.githubstatus.com>.
- Bản lỗi làm app không mở được để nhận OTA hay bản sửa (expo-updates tự quay về bản nhúng khi bản OTA crash lúc mở;
  nếu chính binary lỗi thì không): chủ epic UNI-1826, báo người thử gỡ và cài lại bản tốt qua TestFlight/Play.
