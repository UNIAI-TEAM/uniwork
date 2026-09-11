# 0011 — Mobile là ứng dụng Expo / React Native độc lập, không phải PWA, không tái dùng `views`

**Trạng thái:** accepted (2026-09-04) — quyết định của quangpd (chủ sở hữu sản phẩm), kế thừa kiến trúc mobile của `usf`.

## Bối cảnh

Vision bản đầu và roadmap C-08 ghi "PWA mobile 5 tab" kế thừa từ bản Lovable
(`/m/*`, service worker, manifest). `CLAUDE.md` và `PRODUCT.md` nói adapter
(`NavigationAdapter`, `StorageAdapter`, `CoreProvider`) tồn tại để "một host desktop hoặc
mobile thêm vào mà không viết lại `views`". Hai điều đó ngầm định mobile là web đóng gói.

`usf` (dự án anh em cùng monorepo pnpm/turbo, cùng Go backend) đã đi con đường khác và
có kết quả: `apps/mobile/` là ứng dụng Expo + React Native riêng, **chỉ** import type và
pure function từ `packages/core`, tự sở hữu UI, state, hooks, provider, i18n, phiên bản
React, build và nhịp phát hành. Lý do đã ghi trong `usf/apps/mobile/CLAUDE.md`: một
điện thoại không phải một tab trình duyệt (AppState, NetInfo, dữ liệu di động tính tiền,
unmount từng màn hình, sheet native), và mọi lần cố dùng chung component web trên
native đều sinh nợ.

## Quyết định

1. Mobile của UniWork là `apps/mobile/` — Expo SDK (phiên bản `usf` đang dùng), React
   Native, Expo Router, NativeWind 4 + Tailwind 3.4, react-native-reusables, TanStack
   Query, Zustand, expo-secure-store. iOS trước, Android sau khi iOS đạt DoD.
2. Mobile **không** là host của `packages/views`. Adapter trong `core` phục vụ host web
   (và desktop nếu có), không phải mobile.
3. Mobile chỉ import từ `@uniwork/core`: `import type` từ `types/*` và pure function
   (permissions rules, formatters, schema Zod, catalogue sự kiện). Không import hook,
   store, provider, query key factory của web. Cùng logic thì **copy thiết kế, không
   import** (mirror, có ghi chú nguồn ở đầu file).
4. Ngữ nghĩa sản phẩm phải khớp web (bốn điều phải bằng nhau: số đếm và hiển thị,
   quyền, enum/transition, danh tính dữ liệu); UI và tương tác được khác khi ngữ cảnh
   điện thoại đòi hỏi, và phải ghi tại điểm khác nhau đang mirror hàm nào của web.
5. Realtime: cùng giao thức WebSocket với web, nhưng ba tầng riêng (ws-client, provider,
   hook theo feature), mount listing-level ở layout workspace và per-record ở màn hình
   sở hữu; **patch trước, invalidate sau** vì dữ liệu di động tính tiền; reconnect chỉ
   invalidate key của hook đó.
6. CI: mobile không chặn PR web/backend; workflow `mobile-verify` chạy typecheck, lint,
   test thuần khi `apps/mobile/**` hoặc `packages/core/**` đổi; phát hành bằng tag
   `mobile-v*.*.*` qua EAS, OTA cho sửa JS.
7. PWA của web vẫn có thể có manifest và service worker tối thiểu để "cài lên màn hình
   chính", nhưng không phải chiến lược mobile và không có mục roadmap riêng.

## Hệ quả

- `PRODUCT.md` nguyên tắc 8 và `CLAUDE.md` § Project Shape sửa cho khớp.
- Roadmap C-08 đổi thành ứng dụng mobile Expo; spec
  `docs/superpowers/specs/2026-09-04-mobile-app-design.md` là điểm xuất phát.
- Bản cũ chỉ để lại IA 5 tab (Home, Chat, Work, Meet, More) làm tham chiếu điều hướng;
  `/m/*`, `sw-push.js`, `push-client.ts` không mang sang.
- Cái giá: hai bộ UI phải bảo trì; bù lại là trải nghiệm native thật, phát hành tách
  nhịp, và không kéo web vào ràng buộc của native.
- `packages/core` phải giữ ranh giới "pure function không đụng DOM/Next" chặt hơn, vì
  mobile là consumer thứ hai.

## Test giữ luật (điều kiện để đưa luật vào `CLAUDE.md` § Mobile Rules)

- Lint trong `apps/mobile`: cấm import từ `@uniwork/views`, `@uniwork/ui`, và từ
  `@uniwork/core` ngoài `types/*` và danh sách pure-function được phép.
- `scripts/governance.test.mjs`: nếu `apps/mobile/` tồn tại thì `apps/mobile/CLAUDE.md`
  phải tồn tại và CI chính phải filter `!@uniwork/mobile`.
- Test parity: mỗi màn hình list của mobile có test pure-function cho bước tiền xử lý
  mirror từ web (dedupe, coalesce, filter).
