# apps/chat-mobile

App Expo (iOS + Android) của UniChat: đăng nhập ngay trong app (email + mật khẩu, Apple, Google, bước hai và màn chọn,
ADR 0047; `app/(auth)/`, `components/auth/`, `data/auth/sign-in.ts`), PKCE qua trình duyệt hệ thống cho phần còn lại,
chọn workspace (chưa có thì trả lời lời mời: `components/workspace/pending-invitations.tsx`, link `/invite/{token}`
mở màn xem trước), phương thức đăng nhập trong Cài đặt, một socket realtime, push, deep link, bốn tab (Chat, Cuộc gọi,
Danh bạ, Cài đặt) và cuộc gọi. Luật gốc: ADR 0011 (mobile chỉ import kiểu và hàm thuần từ `packages/core`) và ADR 0043
(cổng chất lượng). File này là **bản đồ**: tầng, ranh giới, đặt gì ở đâu và luật nào có test giữ. Thiết kế từng phần nằm ở
`docs/engineering/unichat-mobile/` (mục lục: `docs/engineering/unichat-mobile/README.md`); sửa hành vi một phần thì
sửa file của phần đó cùng PR.
`scripts/mobile-docs.test.mjs` giữ file này ngắn (≤ 200 dòng) và mọi tài liệu nó trỏ tới tồn tại.

## Tầng và chiều phụ thuộc

`app/` → `components/` → `data/` → `lib/` (mũi tên là "được import"); `@uniwork/core` chỉ qua allowlist. Mọi chiều
ngược lại là lỗi lint, có fixture test (`lib/lint-boundary.test.ts`, `lib/lint-quality.test.ts`,
`lib/lint-structure.test.ts`, `lib/lint-copy.test.ts`).

| Tầng | Đặt gì | Không được |
| --- | --- | --- |
| `app/` | File route: đọc param, ghép màn. Một export default (cộng tên kê trong `lib/route-files.test.ts`). | Định nghĩa component/hook con; đọc/ghi cache trực tiếp; đặt test dưới `app/`. |
| `components/` | Component, hook giao diện, sheet. Đổi trạng thái server chỉ qua hook `data/mutations/*`. | Import giá trị từ endpoint/lệnh (`COMMAND_MODULES` trong `eslint.config.mjs`); `Modal` của react-native ngoài `components/ui/call-aware-modal.tsx`; sheet trượt ngoài `BottomSheet`. |
| `data/` | Transport, endpoint, query/mutation, store zustand (`data/stores/*`), cache, realtime, dịch vụ native, hook của tầng data. | Import `components/` hay `app/`, kể cả `import type`. |
| `lib/` | Logic thuần, test vitest ở sàn 100 %. Thu hẹp giá trị lạ bằng guard (`lib/unknown-shape.ts`). | Import giá trị từ React, react-native, expo, Sentry, LiveKit, `data/`, `components/`; ép kiểu (`as`, trừ `as const`). |

Chi tiết và lý do: `docs/engineering/unichat-mobile/boundaries.md`.

## Dùng chung với web, không copy

- Logic thuần dùng chung nằm ở core và được import; thêm module thì thêm vào `core-allowlist.json` (một nguồn cho lint
  và `scripts/mobile-core-allowlist.test.mjs`, test đi theo import bắc cầu) và `exports` của core.
- Endpoint là factory nhận transport (`@uniwork/core/api/endpoints/chat-*-api`); web bind `request` của `http.ts`, app
  bind qua `toChatRequest` (`data/chat-api.ts`). Thao tác cache dùng chung cũng vậy (`chat/chat-cache-records`,
  `chat/room-timeline-cache`: nhận key và transport của mỗi bên).
- Phần mirror từ repo `usf` (`apps/mobile`) ghi "Ported from usf apps/mobile/<path>" ở đầu file và sạch tên thương
  hiệu usf (`scripts/no-usf-leak.test.mjs`).
- Thứ còn phải copy ghi nguồn ở comment đầu file; `web-copies.json` ghi hash nguồn và ratchet `copiedCodeChars` chỉ đi
  xuống, cùng `target` (cỡ đích, hạn `by`, lý do): quá hạn mà ratchet còn trên đích thì test đỏ
  (`scripts/mobile-web-copies.test.mjs`, chạy cả ở `ci.yml`). Rà bản copy rồi `node scripts/mobile-web-copies.mjs
  --write`. Bản copy mới phải có lý do vì sao không thành module core được.

## Luật có test giữ

- Mọi input không tin được đi qua zod và degrade thay vì throw: REST qua `parseWithFallback` (mỗi endpoint một case
  malformed trong `data/chat-api.test.ts`; ngoại lệ có chủ đích là `listWorkspaces`, đi qua `fetchStrict` và hiện lỗi
  kèm Thử lại, vì `[]` nghĩa là "bạn chưa ở workspace nào"), frame qua `data/realtime/frames.ts` (đối chiếu `docs/events/CATALOGUE.md`),
  cache đĩa qua schema mạng (`data/persisted-schema.lock.json`). Schema đổi thì quyết định bump version.
- `data/server-contract.test.ts`: mỗi trường schema app đọc là một trường JSON của SDO Go trả nó; mỗi flag trong
  `MOBILE_FLAG_DEFAULTS` là flag `Mobile: true` của `server/internal/featureflags/keys.go`.
- `scripts/mobile-route-catalogue.test.mjs`: mọi path `/api/v1` app gọi (kể cả core nó chạy) là route router đăng ký.
- Không nuốt lỗi: `.catch(bestEffort(...))` (`data/report.ts`) hoặc `settled()` (`lib/settled.ts`); log qua
  `data/logger.ts` (`no-console` ở nơi khác); lỗi một thao tác là `toast.error(...)`.
- Không `any`, không `x!` trong `app/`/`components/`; dòng mã nguồn ≤ 150 ký tự (`max-len`); file ≤ 500 dòng.
- Mọi chữ người dùng đọc hay nghe đi qua `t()` (`i18next/no-literal-string`); chuỗi viết ở nguồn i18n rồi chạy
  `scripts/sync-i18n.mjs` (vi và en đủ, `lib/i18n.test.ts`; commit chạm locale của core mà bản copy của app cũ thì
  `.githooks/pre-commit` chặn ở mọi `GATE_LEVEL`); toast, alert, lời đọc cho trình đọc màn hình và chữ của thông báo
  trong file `.ts` cũng vậy (`copySyntax` của `eslint.config.mjs`); ngày giờ và số (`{{count}}`, cỡ tệp) chỉ qua
  `lib/locale-format.ts` (`formatSyntax`: không `toFixed`/`toLocale*`/`new Intl` ở nơi khác).
- Vùng chạm 44 pt / 48 dp qua `useTapTarget` / `hitSlopFor`; tương phản AA ở cả hai chế độ (`lib/theme-contrast.test.ts`);
  cỡ chữ theo vai trò (`lib/type-scale.test.ts`); hàng đặt tên, dấu và giờ cạnh nhau thì xếp chồng ở cỡ chữ trợ năng
  (`useLargeText`), menu/sheet dài thì cuộn trong chiều cao còn lại (`lib/action-menu-layout.ts`, `ActionSheet`).
- Quyền native, dịch vụ nền và loại dữ liệu khớp `store/listing.md` (`android-manifest.test.ts`,
  `store-listing.test.ts`); thêm quyền thì sửa bảng ở đó, checklist ở `docs/runbooks/unichat-mobile-release.md`. Mọi
  quyền binary Android xin, kể cả quyền thư viện Maven gộp vào, có trong `android-permissions.json` kèm ai thêm, vì sao
  giữ, Play hỏi gì (`scripts/mobile-apk-scan.mjs` đọc APK/AAB thật); không cần thì chặn bằng `blockedPermissions`.
- Mọi tin FCM vào `UniChatMessagingService` trước (`modules/unichat-calls`, ưu tiên trên dịch vụ của expo-notifications,
  `android-manifest.test.ts › messagingServices`): push đổ chuông reo không cần JavaScript, phần còn lại đi tiếp với `tag` của server nhấc lên chỗ
  expo-notifications đọc (`PushTag.kt`: mỗi push của phòng thay thông báo của phòng);
  chữ và công tắc của chuông native ghi qua `data/calls/native-ring.ts` (chi tiết: `calls.md`).
- iPhone (ADR 0038, `calls-ios.md`): mọi VoIP push vào `modules/unichat-calls/ios/CallCenter.swift` được báo cho CallKit trước completion
  của PushKit, kể cả `end` và payload lạ (`native-modules.test.ts › every VoIP push is reported to CallKit`); module iOS
  tên `UniChatCallKit`, khác `UniChatCalls` của Android, và call center chỉ chạy khi Info.plist khai `voip`
  (`UNICHAT_IOS_CALLS=1`, `app.config.test.ts`). Hai nửa tới app qua một `NativeCallSession`
  (`data/calls/native-call-session.ts`, `native-call-session.test.ts`).
- Mọi lệnh cần "xác nhận là bạn" (đặt/đổi mật khẩu, liên kết/gỡ liên kết, xoá tài khoản, chuyển quyền, liên kết vé)
  đi qua `components/settings/use-step-up.ts` (`run(action, command)`): token chỉ trong bộ nhớ
  (`data/auth/step-up-store.ts`), bằng chứng hỏi trước khi mở sheet của Apple/Google, lệnh ở `data/mutations` bọc
  `withHeldStepUp` để token bị từ chối được quên (`components/settings/step-up-sheet.test.tsx`).
- Công tắc mobile mới: `MOBILE_FLAG_DEFAULTS` (`data/remote-config.ts`) và `server/internal/featureflags/keys.go` cùng
  PR, có `ReviewAt`.
- Coverage: vitest (`lib/`, `data/` trừ hook React) 100/100/100/100; jest (`components/`, hook của `data/`, route theo
  nhóm) theo sàn từng file ở `coverage-floor.json`, chỉ đi lên (`node scripts/mobile-coverage-floor.mjs --write` sau
  một lần chạy đủ `test:components`).

## Bản đồ tài liệu

| Phần | Tài liệu |
| --- | --- |
| Ranh giới, allowlist, lớp mutation, luật lint | `docs/engineering/unichat-mobile/boundaries.md` |
| `app.config.ts`, biến build, ký OTA, ghim TLS | `docs/engineering/unichat-mobile/config-security.md` |
| `lib/`, theme, token, tương phản | `docs/engineering/unichat-mobile/lib-and-theme.md` |
| Socket, frame, ân hạn nền, khôi phục phiên | `docs/engineering/unichat-mobile/realtime.md` |
| Mở lạnh, kho trên máy, outbox, gửi tiếp ở nền, lượt chờ, nháp, cache đĩa | `docs/engineering/unichat-mobile/offline-first.md` |
| Báo lỗi, Sentry, log, cấu hình từ xa, thống kê | `docs/engineering/unichat-mobile/observability.md` |
| Xoá tài khoản, pháp lý, đồng ý AI, báo cáo, hồ sơ store | `docs/engineering/unichat-mobile/store-compliance.md` |
| Ẩn thông báo, khoá app, chặn chụp màn hình | `docs/engineering/unichat-mobile/device-privacy.md` |
| Deep link, phản hồi thông báo | `docs/engineering/unichat-mobile/navigation.md` |
| Tab Chat: key, cache, màn hình, file route | `docs/engineering/unichat-mobile/chat.md` |
| Cuộc gọi, cuộc gọi native Android, kênh và push | `docs/engineering/unichat-mobile/calls.md` |
| Cuộc gọi trên iPhone: PushKit, CallKit, token VoIP, `NativeCallSession` | `docs/engineering/unichat-mobile/calls-ios.md` |
| Hiệu năng danh sách, timeline, ảnh, bundle | `docs/engineering/unichat-mobile/performance.md` |
| Trợ năng, cảm giác, quy ước nền tảng, ngôn ngữ | `docs/engineering/unichat-mobile/ux-a11y-i18n.md` |
| Lệnh, hai lớp test, CI | `docs/engineering/unichat-mobile/testing-ci.md` |
| Profile EAS, phát hành, OTA, Maestro | `docs/engineering/unichat-mobile/release.md` |
| Baseline bảo mật OWASP MASVS L1 | `docs/engineering/unichat-mobile-masvs.md` |
| Runbook phát hành và vận hành | `docs/runbooks/unichat-mobile-release.md` |

## Đặt code mới ở đâu

- Module mới của `data/` vào thư mục theo tính năng (`data/<feature>/`: api, cache, store, hook của tính năng đó), không ở
  gốc `data/`: gốc là một ratchet chỉ co lại (`scripts/mobile-data-layout.test.mjs`); chuyển một module gốc vào thư mục
  thì hạ trần cùng PR.
- Query mới: `*Options` ở `data/queries/`, key từ factory của `data/queries/chat-keys.ts` (dưới `["chat", wsId]`).
- Lệnh mới: hàm ở `data/chat-actions.ts` (hay `pending-ops.ts` nếu chạy offline) và hook `useCommand` ở
  `data/mutations/*`; màn hình gọi hook, báo lỗi từ `mutateAsync`.
- Trạng thái client: store ở `data/stores/*` (persist qua kho trên máy, đọc lại qua schema của
  `lib/persisted-records.ts`); trạng thái của một màn: reducer thuần ở `lib/` (ví dụ `lib/conversation-sheets.ts`).
- Logic có nhánh của một màn: hàm thuần ở `lib/` (vitest) hay hook ở `components/`/`data/` có test jest, không trong
  file route.
- Dịch vụ khởi lúc boot: `data/app-startup.ts`; nối nền tảng ở composition root (`app/_layout.tsx`,
  `app/(app)/_layout.tsx`).
- Gói native: `pnpm --filter @uniwork/chat-mobile exec expo install <pkg>`; đổi native thì bump `version` (runtime
  theo fingerprint). iOS không link `@expo/ui`, `@expo/dom-webview`, `expo-symbols` (`expo.autolinking.ios.exclude`
  trong `package.json`): app không gọi chúng trên iOS mà chúng tốn chừng 1,6 s đăng ký native trước khi bundle chạy
  (đo trên simulator CI); dùng `@expo/ui`, một SF Symbol (`expo-symbols`) hay component DOM trên iOS thì gỡ tên đó
  khỏi danh sách trước (`native-modules.test.ts`). Bundle iOS một PR export ra mà còn chứa tên trong danh sách thì
  bước Bundle composition của `mobile-verify` đỏ (`scripts/mobile-bundle-composition.mjs`): module đó ném lỗi khi nạp.

## Lệnh

```bash
pnpm --filter @uniwork/chat-mobile dev | ios | android
pnpm --filter @uniwork/chat-mobile typecheck | lint
pnpm --filter @uniwork/chat-mobile test:unit         # vitest: lib/, data/, app.config, android-manifest
pnpm --filter @uniwork/chat-mobile test:components   # jest-expo + RNTL: components/, hook của data/, test/routes/
```

Root `typecheck`/`test`/`lint` và CI chính lọc `!@uniwork/chat-mobile`; app kiểm ở
`.github/workflows/mobile-verify.yml`, kết thúc ở job `gate` (chi tiết: `docs/engineering/unichat-mobile/testing-ci.md`).

## Ngoại lệ của knip

`knip.json` bỏ qua, mỗi tên một lý do (`scripts/mobile-knip.test.mjs` đỏ khi một tên không có ở đây):

- `@babel/plugin-transform-react-jsx`: preset `react-native-css-interop/babel` gọi nó theo tên mà không khai; thiếu
  thì bước `createReleaseUpdatesResources` của build release đỏ.
- `@expo-google-fonts/*`: `app.config.ts` chỉ trỏ tới file `.ttf` của chúng (plugin `expo-font`).
- `@sentry/cli`: bước Xcode "Upload Debug Symbols to Sentry" và Gradle của Sentry tìm nó từ thư mục app; chỉ là
  phụ thuộc của `@sentry/react-native` thì pnpm không cho với tới và build iOS đỏ trước cả `SENTRY_ALLOW_FAILURE`.
- `react-native-css-interop`: phụ thuộc của `nativewind` mà `metro.config.js` trỏ tới (một bản duy nhất trong
  bundle); app không khai nó.
