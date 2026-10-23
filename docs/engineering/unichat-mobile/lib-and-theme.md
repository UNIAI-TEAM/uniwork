# UniChat mobile — Tầng thuần `lib/` và token giao diện

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

Luật của `lib/`, theme/token, tương phản, font. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

- `lib/` — helper thuần + test vitest (env node), đo trọn ở sàn 100 %. Thuần là luật lint, không phải quy ước
  (khối `lib/**` của `eslint.config.mjs`, fixture `lib/lint-boundary.test.ts`): không import giá trị từ `react*`,
  `react-native*`, `expo*`, `@expo/*`, `@sentry/*`, `nativewind`, LiveKit, hay từ `data/`, `components/`, `app/`
  (`import type` thì được). Hook và provider ở `components/` (`components/ui/use-color-scheme.ts`,
  `components/ui/nav-theme.ts`, `components/app/i18n-provider.tsx`) hoặc `data/`
  (`data/realtime/use-ws-subscriptions.ts`); logic dùng chung giữa `lib/` và `data/` nằm ở `lib/` (ví dụ
  `lib/auth-callback-url.ts`). Lựa chọn của máy (theme, ngôn ngữ) chỉ đọc/ghi qua `data/device-preferences.ts`
  (Keychain/Keystore, `AFTER_FIRST_UNLOCK` để task nền trên máy khoá đọc được ngôn ngữ, ghi tuần tự).
  `theme.ts`/`global.css`/
  `tailwind.config.js` mirror nhau; giá trị là `packages/ui/styles/tokens.css`
  đổi sang HSL, đổi một nơi thì đổi cả ba. `radius-tokens.json` là thang
  `--radius-*` của tokens.css. Ngoại lệ có chủ ý (R4b, UNI-1916): các slot
  `chat-*` của chế độ tối và `call-surface` lấy giá trị của canvas, ghi trong
  comment — trừ `chat-bubble-own` tối, tối hơn canvas để dòng meta (giờ, dấu tick) đạt AA. Tương phản là test, không
  phải đo tay: `lib/theme-contrast.test.ts` giữ mọi cặp chữ/nền của cả hai chế độ ≥ 4.5:1 (`lib/contrast.ts`, WCAG 2.x;
  thêm bề mặt hay slot chữ thì thêm vào `PAIRS`), `lib/theme.test.ts` đỏ khi `theme.ts` và `global.css` lệch nhau. "Đã
  xem" khác "đã tới" bằng hình (huy hiệu hai tick đặc), không chỉ bằng màu. Mặt người / phòng / workspace là `--tint-*-solid` (`lib/identity-tint.ts › SOLID_TINT_BG`) theo
  `identityTint` của core (`@uniwork/core/chat/identity-tint`, bảy tint, cùng bản với web) với chữ cái của
  `@uniwork/core/chat/initials`. Font: Inter (thân) và Plus Jakarta Sans (`font-display`:
  tiêu đề, tên) nhúng bằng plugin `expo-font` trong `app.config.ts`.
