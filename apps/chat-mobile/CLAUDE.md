# apps/chat-mobile

App Expo (iOS + Android) của UniChat: đăng nhập PKCE qua trình duyệt hệ thống, chọn workspace, một socket realtime,
push, deep link, bốn tab (Chat, Cuộc gọi, Danh bạ, Cài đặt) và cuộc gọi. Luật gốc: ADR 0011 (mobile chỉ import kiểu
và hàm thuần từ `packages/core`) và ADR 0037 (cổng chất lượng). File này là **bản đồ**: tầng, ranh giới, đặt gì ở đâu
và luật nào có test giữ. Thiết kế từng phần nằm ở `docs/engineering/unichat-mobile/` (mục lục:
`docs/engineering/unichat-mobile/README.md`); sửa hành vi một phần thì sửa file của phần đó cùng PR.
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
  xuống (`scripts/mobile-web-copies.test.mjs`, chạy cả ở `ci.yml`). Rà bản copy rồi `node scripts/mobile-web-copies.mjs
  --write`. Bản copy mới phải có lý do vì sao không thành module core được.

## Luật có test giữ

- Mọi input không tin được đi qua zod và degrade thay vì throw: REST qua `parseWithFallback` (mỗi endpoint một case
  malformed trong `data/chat-api.test.ts`), frame qua `data/realtime/frames.ts` (đối chiếu `docs/events/CATALOGUE.md`),
  cache đĩa qua schema mạng (`data/persisted-schema.lock.json`). Schema đổi thì quyết định bump version.
- `data/server-contract.test.ts`: mỗi trường schema app đọc là một trường JSON của SDO Go trả nó; mỗi flag trong
  `MOBILE_FLAG_DEFAULTS` là flag `Mobile: true` của `server/internal/featureflags/keys.go`.
- Không nuốt lỗi: `.catch(bestEffort(...))` (`data/report.ts`) hoặc `settled()` (`lib/settled.ts`); log qua
  `data/logger.ts` (`no-console` ở nơi khác); lỗi một thao tác là `toast.error(...)`.
- Không `any`, không `x!` trong `app/`/`components/`; dòng mã nguồn ≤ 150 ký tự (`max-len`); file ≤ 500 dòng.
- Mọi chữ người dùng đọc hay nghe đi qua `t()` (`i18next/no-literal-string`); chuỗi viết ở nguồn i18n rồi chạy
  `scripts/sync-i18n.mjs` (vi và en đủ, `lib/i18n.test.ts`); ngày giờ chỉ qua `lib/locale-format.ts`.
- Vùng chạm 44 pt / 48 dp qua `useTapTarget` / `hitSlopFor`; tương phản AA ở cả hai chế độ (`lib/theme-contrast.test.ts`);
  cỡ chữ theo vai trò (`lib/type-scale.test.ts`).
- Quyền native, dịch vụ nền và loại dữ liệu khớp `store/listing.md` (`android-manifest.test.ts`,
  `store-listing.test.ts`); thêm quyền thì sửa bảng ở đó, checklist ở `docs/runbooks/unichat-mobile-release.md`.
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
| Mở lạnh, kho trên máy, outbox, lượt chờ, nháp, cache đĩa | `docs/engineering/unichat-mobile/offline-first.md` |
| Báo lỗi, Sentry, log, cấu hình từ xa, thống kê | `docs/engineering/unichat-mobile/observability.md` |
| Xoá tài khoản, pháp lý, đồng ý AI, báo cáo, hồ sơ store | `docs/engineering/unichat-mobile/store-compliance.md` |
| Ẩn thông báo, khoá app, chặn chụp màn hình | `docs/engineering/unichat-mobile/device-privacy.md` |
| Deep link, phản hồi thông báo | `docs/engineering/unichat-mobile/navigation.md` |
| Tab Chat: key, cache, màn hình, file route | `docs/engineering/unichat-mobile/chat.md` |
| Cuộc gọi, cuộc gọi native Android, kênh và push | `docs/engineering/unichat-mobile/calls.md` |
| Hiệu năng danh sách, timeline, ảnh, bundle | `docs/engineering/unichat-mobile/performance.md` |
| Trợ năng, cảm giác, quy ước nền tảng, ngôn ngữ | `docs/engineering/unichat-mobile/ux-a11y-i18n.md` |
| Lệnh, hai lớp test, CI | `docs/engineering/unichat-mobile/testing-ci.md` |
| Profile EAS, phát hành, OTA, Maestro | `docs/engineering/unichat-mobile/release.md` |
| Baseline bảo mật OWASP MASVS L1 | `docs/engineering/unichat-mobile-masvs.md` |
| Runbook phát hành và vận hành | `docs/runbooks/unichat-mobile-release.md` |

## Đặt code mới ở đâu

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
  theo fingerprint).

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
- `react-native-css-interop`: phụ thuộc của `nativewind` mà `metro.config.js` trỏ tới (một bản duy nhất trong
  bundle); app không khai nó.
