# UniChat mobile — Chạy, kiểm thử và CI

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

Lệnh, hai lớp test, sàn coverage, chạy trên máy thật, `mobile-verify.yml`. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

### Chạy

```bash
pnpm --filter @uniwork/chat-mobile dev        # Metro; UNICHAT_ENV=dev mặc định
pnpm --filter @uniwork/chat-mobile ios        # scripts/native-run.sh ios (prebuild rồi run)
pnpm --filter @uniwork/chat-mobile android
pnpm --filter @uniwork/chat-mobile test | typecheck | lint
pnpm --filter @uniwork/chat-mobile test:unit         # vitest, node: lib/ data/ app.config android-manifest
pnpm --filter @uniwork/chat-mobile test:components   # jest-expo + RNTL: components/**/*.test.tsx, data/**/*.test.tsx
```

Hai lớp test, không chung file (ADR 0037 — cả hai chặn ở mọi `GATE_LEVEL`):

- `vitest.config.ts` — `*.test.ts` trong `lib/`, `data/`, môi trường node, sàn
  100/100/100/100 cứng (không qua `scripts/coverage-gate.ts`); không loại file để
  qua sàn, nhánh không thể xảy ra thì viết lại. `data/server-contract.test.ts` giữ tên trường: mỗi trường mà schema
  response app parse khai (lồng nhau cũng vậy, cả item của list parse từng phần tử qua `items`) phải là một
  `json:"…"` của SDO Go trả nó (`server/internal/handler/dto/sdo/`, bảng `CONTRACTS`: /me, /workspaces, thành viên,
  /config với `mobile_flags`, chính sách ẩn push và mọi endpoint chat); mỗi dòng còn kê handler Go trả nó, và mã của
  handler đó phải trả đúng struct ấy — kể cả từng khóa của map literal (`{"message": toChatMessageDTO(msg)}`), nên đổi
  tên khóa chỉ ở handler cũng đỏ. Mọi flag trong `MOBILE_FLAG_DEFAULTS` phải là flag `Mobile: true` của
  `server/internal/featureflags/keys.go` (công tắc gọi). Thêm một endpoint app đọc thì thêm dòng vào bảng đó; file
  handler mới thì thêm vào `HANDLER_FILES` và `MOBILE_PATHS`. PR server đổi SDO, các file handler đó hay danh mục
  flag cũng chạy test này (`MOBILE_PATHS`).
- `jest.config.js` — `components/**/*.test.tsx` và hook React của lớp data
  (`data/**/*.test.tsx`, như `use-call-realtime.test.tsx`: công tắc gọi đổi giữa
  cuộc gọi không được cắt cuộc gọi), preset `jest-expo` với
  `@testing-library/react-native` 14 (mọi `render`/`fireEvent` đều `await`), truy
  vấn theo role và label như người dùng VoiceOver/TalkBack. Render qua
  `test/render.tsx` (i18n tiếng Việt, `QueryClient` mới với `gcTime: Infinity` — query
  đã unmount không để lại timer giữ Jest không thoát), `viText(key)` là chuỗi
  người nghe. `Switch` của Android không truy được theo role trong renderer: truy theo label. `test/jest-setup.ts` mock `expo-router`, `expo-audio`, safe area,
  Reanimated, `react-native-keyboard-controller` (mock của chính nó), `expo-haptics` — **không** mock cổng quyền: component
  hỏi quyền đi qua cổng thật trên mock của module expo (`components/ui/permission-gate.test.tsx` giữ cổng đó: primer
  trước, prompt hệ thống sau Tiếp tục, Cài đặt khi hệ thống không hỏi nữa); test nào khẳng định lượt hỏi thì tự mock
  `@/components/ui/permission-gate` trong file của nó — và làm đỏ test nào log
  `console.error` (update ngoài `act`…). Cử chỉ test bằng `react-native-gesture-handler/jest-utils` (`withTestId` +
  `fireGestureHandler`; `react-native-gesture-handler/jestSetup` nạp sẵn ở `test/jest-setup.ts` vì mọi sheet có
  `GestureHandlerRootView`); `onUpdate` chỉ chạy từ sự kiện ACTIVE thứ hai. Test đếm render chờ hàng xuất hiện (`waitFor`), không chờ một khoảng cố định.
  `test/jest-resolver.js` thay resolver của worklets (bản gốc khớp mọi đường dẫn
  pnpm có chữ `react-native-worklets`, làm mất mock native của Expo). Coverage đo **cả cây** `components/**`, các
  hook React của `data/` mà vitest bỏ ra và file route `app/**` (mỗi file đúng một lớp đo). File route chỉ ghép, không
  định nghĩa component con (`lib/route-files.test.ts`), nên được giữ như **một nhóm** ở sàn `routes` của
  `coverage-floor.json` (khoá thư mục của jest, cộng dồn), không theo từng file. `app/_layout.tsx` không có test route
  nào render: dịch vụ mới khởi lúc boot vào `data/app-startup.ts` (vitest, 100 %), layout chỉ gọi một dòng — nối dây
  ngay trong file route kéo sàn `routes` xuống đỏ. `test/routes/*.test.tsx` render chúng
  qua expo-router thật (`test/route-render.tsx › renderRoutes`: `jest.unmock("expo-router")` trong file test, mock
  NetInfo, route con chưa test thì thay bằng stand-in) — cổng vào/đăng nhập/chọn workspace ở `test/routes/entry.test.tsx`;
  mọi màn trong workspace (layout với socket, thanh tab, Chat/Cuộc gọi/Danh bạ/Cài đặt, phòng, chi tiết, chủ đề, tin
  mới, nhóm mới, kênh, giấy phép, công tắc gọi của server) ở `test/routes/workspace.test.tsx`, trên một server giả sau
  `api.request` (theo đường dẫn; mọi thứ khác trả `{}`) và socket giả `test/fake-ws-client.ts` (test đóng vai server:
  trạng thái, frame, reconnect, phiên bị kết thúc). Server giả chỉ trả lời sau khi router đã mount: `renderRouter` mount
  dưới fake timer, và một lô cập nhật TanStack hẹn trên fake timer mà `renderRoutes` không chạy sẽ giữ mọi cập nhật sau.
  Sàn theo từng file ở `coverage-floor.json` (`scripts/mobile-coverage-floor.mjs --write` sau một lần
  `test:components`: lấy số cao hơn giữa sàn cũ và hôm nay, không bao giờ hạ; file đã xoá thì rời); file chưa ghi
  (component mới) gộp vào sàn `global` 90/80/90/90 — component mới không test thì đỏ
  (`scripts/mobile-coverage-floor.test.mjs`). Thêm test thì chạy lại `--write` để nâng sàn. `--write` chỉ ghi file mới
  khi nó đã đạt sàn `global` (ghi theo số hiện có thì component chưa test rời nhóm global mãi) và đỏ khi một file đã
  ghi mà còn tồn tại không có trong lần chạy (chạy cả `test:components`, không chạy một phần). File dưới sàn `global`
  chỉ là nợ đã ghi lúc có sàn theo file (`BELOW_GLOBAL` trong test đó): danh sách chỉ co lại, không file nào được thêm.
  Không đặt test dưới `app/` (expo-router coi là route).

Máy thật không thấy `localhost` của máy dev: đặt `UNICHAT_API_URL=http://<LAN IP>:8080`
và `UNICHAT_APP_URL=http://<LAN IP>:3000` khi chạy, và chạy server + web với
`FRONTEND_ORIGIN` / `NEXT_PUBLIC_{API,WS,APP}_URL` trỏ cùng IP (một bản sao
`.env`, `make start ENV_FILE=…`); `apps/web/next.config.mjs` tự cho host của
`NEXT_PUBLIC_APP_URL` vào `allowedDevOrigins`, thiếu thì trang đăng nhập trắng.
Server dev phải bật `DESKTOP_AUTH_CLIENTS` (`.env.example`) với client
`uniwork-chat-mobile`. Ký bằng Apple ID cá nhân (Personal Team) thì team không
có push và associated domains: build tay với file entitlements rỗng.

Root `typecheck`/`test`/`lint` và CI chính lọc `!@uniwork/chat-mobile`;
app kiểm ở `.github/workflows/mobile-verify.yml`, chạy ở mọi PR (job `scope` quyết `mobile`/`native` theo
`scripts/mobile-native-scope.mjs`, kể cả khi PR server đổi `docs/events/CATALOGUE.md` hay `dto/sdo/**`), kết thúc ở job
`gate` — check bắt buộc duy nhất của mobile (`scripts/branch-protection.json`), đỏ khi một job thay đổi cần mà không
xanh (`scripts/mobile-verify-gate.mjs`; thêm job thì thêm vào `JOBS` ở đó): job `mobile` (typecheck, lint,
hai lớp test, `pnpm knip --workspace apps/chat-mobile`, `expo install --check` offline — version gói native theo SDK
đã cài —, `scripts/mobile-*.test.mjs`, trong đó `mobile-lockfiles.test.mjs` cấm lockfile ngoài `pnpm-lock.yaml`), `doctor-bundle` (`expo-doctor` rồi
`expo export --platform android --platform ios` giữ trong `bundle-budget.json` bởi
`scripts/mobile-bundle-budget.mjs`, trần cho từng nền tảng — iOS có ngân sách trước khi có bản build) và `android-release` (`expo prebuild` +
`./gradlew :app:assembleRelease` x86_64 — Kotlin của `modules/*/android` thì job `mobile` chạy ktlint ở mọi PR mobile
(ghim `KTLINT_VERSION` + checksum, kiểu ở `.editorconfig` › `[*.{kt,kts}]`; trong KDoc đừng viết `/*`, Kotlin coi là
mở comment lồng), chỉ khi `scripts/mobile-native-scope.mjs`
nói thay đổi chạm binary) rồi `android-smoke` (cài APK đó lên emulator, chạy
`maestro/flows/smoke-launch.yaml` qua `scripts/maestro-retry.sh` (chạy lại một lần, lần hai qua thì cảnh báo "flaky"
chứ không im; mọi lượt Maestro trong CI đi qua nó): mở lạnh tới màn đăng nhập, không cần server — `ios-release` làm cùng việc đó trên
simulator iOS với bản Release ký ad-hoc, cùng điều kiện native ở PR (nơi gọi chỉ Android thì bỏ qua), Xcode ghim ở
`XCODE_VERSION` qua `scripts/select-xcode.sh`; cuối job, ở font_scale 2.0 và dark mode,
`flows/a11y-large-text-dark.yaml` (màn đăng nhập cuộn được, vẫn tới nút) rồi `scripts/mobile-a11y-audit.mjs` (dump
uiautomator: mọi điều khiển của app có tên và ≥ 48 dp; hitSlop không thấy được trong dump nên nightly audit phòng ở
44 dp, chỉ cảnh báo); rồi `scripts/mobile-perf.mjs` đo kích
thước APK và 5 lần mở lạnh — tới khung đầu, tới mốc `js-boot` và tới mốc `first-screen` — theo `perf-budget.json`
(profile `android`); `ios-release` đo 5 lần mở lạnh trên simulator (profile `ios-simulator`), chặng 2 GB của nightly
matrix theo profile `android-2gb`; nightly đo thêm mở lạnh tới `inbox` và khung/bộ nhớ khi cuộn phòng dài, runbook ›
Đo hiệu năng trên thiết bị, gồm cách `tighten` đặt trần từ 5 run). Mốc là `perfMark(name)` của
`data/logger.ts` (một dòng `UniChatPerf mark=<tên> at=<ms>` trong log máy và, cho iOS, trong tệp của
`data/perf/marks-file.ts`, mỗi tên một lần mỗi tiến trình), chỉ bản build với
`UNICHAT_PERF_MARKS=1` (`extra.perfMarks`) mới ghi; mốc mới thì thêm vào `scripts/mobile-perf.mjs`. Thêm gói làm bundle nặng hơn trần thì nâng trần cùng
commit, ghi lý do; bundle nhỏ đi thì hạ trần. Không có script `build`.
Thêm gói native bằng `pnpm --filter @uniwork/chat-mobile exec expo install <pkg>`;
nếu Metro kẹt vì layout isolated của pnpm thì dừng và báo, không thêm
`.npmrc` hoist.
