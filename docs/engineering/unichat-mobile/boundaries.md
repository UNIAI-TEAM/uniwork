# UniChat mobile — Ranh giới import và luật lint

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

Ranh giới giữa các tầng, allowlist của core, lớp mutation và các luật chất lượng mà `eslint.config.mjs` giữ. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

### Ranh giới import (lint, không phải quy ước)

`eslint.config.mjs` dùng `@typescript-eslint/no-restricted-imports`: cấm
`@uniwork/views*`, `@uniwork/ui*`, `next/*`, `@react-navigation/*`, đường
dẫn tương đối vào `packages/*`; cấm `@uniwork/core` và mọi subpath trừ
allowlist trong `scripts/mobile-core-allowlist.test.mjs` (`api/schema`,
`api/endpoints/chat-schemas`, `permissions/rules`, `paths/paths`,
`paths/marketing`, `types/events`, các `chat/*-utils` thuần…) và
`@uniwork/core/types/*` chỉ với `import type`, trừ module `types/*` có trong allowlist (`types/ai`: schema zod thuần). Hai danh sách phải giống
nhau; test đó đi theo import bắc cầu của từng mục nên mục không thuần phải
tách file ở core, không nới lint. Fixture: `lib/lint-boundary.test.ts`.
Logic thuần dùng chung nằm ở core và được import (UNI-2053 S7: `chat/search-fold`, `chat/initials`,
`chat/identity-tint`, `chat/contact-labels`, `chat/typing-label`, `chat/voice-call-{types,kind,invites,duration}`,
`chat/room-timeline-pages` — trang timeline và mọi phép thuần trên nó, tách khỏi `room-timeline.ts` của core —,
`chat/chat-mention-utils` — token nhắc tên, nháp composer, bộ chọn nhắc tên —, `chat/chat-cache-records` — frame làm gì với
một bản ghi: dòng danh sách phòng, số trả lời của gốc chủ đề, chỗ của một trả lời —, `chat/room-timeline-cache` — mở, bắt
kịp, đánh dấu stale timeline trên `QueryClient`, nhận key và transport của mỗi bên —, `chat/chat-message-cache` — tin
từ câu trả lời, frame hay lệnh xoá vào cache, nhận key, transport, viewer và hook cho phần mỗi bên giữ riêng —, `chat/send-retry` — khi nào gửi lại
một tin, đọc `status` của ApiError mỗi bên theo cấu trúc nên không import transport —, `chat/optimistic-merge` — ghép
hàng đang gửi của mỗi bên với timeline của server —; web và điện thoại cùng một bản; thêm mục thì
thêm vào `core-allowlist.json` và `exports` của core). Endpoint dùng chung là factory nhận transport
(`api/endpoints/chat-{rooms,messages,threads,channels,media,forward,voice,users,presence}-api`, đọc câu trả lời qua
`chat-endpoint-kit`): web bind `request` của `http.ts` (file endpoint web chỉ còn dòng bind cộng phần multipart của
trình duyệt), điện thoại bind transport của nó qua `toChatRequest` (`data/chat-api.ts`). Còn lại trong `data/chat-api.ts`:
gửi multipart (phần tệp `{uri}` của React Native), câu trả lời chỉ điện thoại đọc (cuộc gọi đi, đang ghi âm) và bản đọc
gọn của follow-up, liên kết tin, task, thành viên workspace — bản copy, `web-copies.json` đếm. Logic khác của web:
**copy, ghi nguồn ở comment đầu file** ("Copied/Ported from …", "← packages/…"), test parity — không import.
`web-copies.json` ghi sha256 của từng file nguồn web mà mỗi bản copy nêu, lúc bản copy được rà lần cuối, và
`copiedCodeChars` — cỡ code của mọi bản copy (ký tự không phải khoảng trắng, bỏ dòng comment, nên xuống dòng hay thụt lề
không làm nó đổi), một ratchet chỉ đi xuống (`--write` hạ nó khi bản copy co lại, không bao giờ nâng; test đỏ khi bản copy
lớn ra; nâng là sửa tay trong PR có lý do vì sao không chia sẻ được qua core). Cạnh ratchet là `target`: cỡ đích
(54 000 ký tự, khoảng 1 500 dòng code), hạn `by` (launch + 1, đặt tay) và lý do; `--write` giữ nguyên nó, test đỏ khi
quá hạn mà ratchet còn trên đích, nên dời hạn cũng là sửa tay trong PR có lý do;
`scripts/mobile-web-copies.test.mjs` (chạy cả ở `ci.yml`, nên PR chỉ sửa web cũng đỏ) đỏ khi một nguồn đổi, khi có
bản copy mới chưa ghi, hay khi header và manifest lệch. Rà bản copy (port bản sửa hoặc quyết định không áp dụng) rồi
`node scripts/mobile-web-copies.mjs --write`.

Lớp mutation (UNI-2053 S7, audit T4): `app/` và `components/` đổi trạng thái server chỉ qua hook ở
`data/mutations/*` (`messages`, `rooms`, `safety`, `account` — cả đồng ý AI —, `push`; mỗi hook là một `useMutation` qua `useCommand` của
`command.ts`, key mutation là tên lệnh nên lỗi là bug tới Sentry một lần qua `MutationCache`, lỗi mong đợi —
offline, 4xx, `RefusedError` của `data/report.ts` — thì không; màn hình báo lỗi từ `mutateAsync`). Mọi lệnh chạy
ngay cả khi offline (`networkMode: "always"`): gửi, thử lại, biểu cảm, bình chọn vào hàng đợi bền ngay lúc đó, lệnh
khác lỗi ngay — mặc định `"online"` của TanStack giữ mutation ở trạng thái paused, tin không vào outbox và mất khi app
bị kill (`data/mutations/offline.test.tsx`). Lệnh và việc
chúng làm với cache ở `data/chat-actions.ts`, `safety-actions.ts`, `chat-send.ts`, `pending-ops.ts`. Lint cấm
`app/`/`components/` import giá trị từ `@/data/{api,chat-api,chat-actions,chat-send,pending-ops,safety-api,
safety-actions,account-api,ai-consent}`, `revokeDevice` và `setPushEnabled`/`registerPushToken`/`unregisterPushToken`
của `@/data/push` (`import type` vẫn được; trừ `app/_layout.tsx` và `app/(app)/_layout.tsx` — composition root trao
transport và endpoint cho dịch vụ lúc boot, như đăng ký push — và file test, vốn mock transport). Query mới thì thêm `*Options` ở
`data/queries/`, không gọi `chatApi` trong component.

Cùng file lint còn giữ năm luật chất lượng (fixture: `lib/lint-quality.test.ts`):
`@typescript-eslint/no-explicit-any` bật (base tắt cho web); bộ `all` của
`eslint-plugin-react-native-a11y` (role, state, value, action, live region,
`importantForAccessibility` hợp lệ; không touchable trong phần tử `accessible`)
trừ `has-accessibility-hint` — tắt có lý do ghi trong config: hint chỉ dùng khi
nhãn không nói rõ kết quả; `i18next/no-literal-string` (`jsx-text-only`)
như `packages/views`; `no-console` ngoài `data/logger.ts`; và không `Modal` của react-native
ngoài `components/ui/call-aware-modal.tsx` (sheet phải đóng khi có cuộc gọi đến; trừ sheet ghi `keepOpenForCall` của
chính cuộc gọi đó — màn giải thích micro khi nghe từ thông báo). Tắt một luật ở
một dòng thì ghi lý do ở dòng trên.

Ba luật cấu trúc (fixture: `lib/lint-structure.test.ts`): `data/` không import `components/` hay `app/`, kể cả `import
type` (thứ cả hai cần nằm ở `data/` hay `lib/`, hiệu ứng nền tảng do composition root tiêm vào); `lib/` không ép kiểu
(`@typescript-eslint/consistent-type-assertions` `never`, `as const` vẫn được) mà thu hẹp bằng guard của
`lib/unknown-shape.ts` (`isRecord`, `asRecord`, `pathOf`); và không dòng mã nguồn nào dài quá 150 ký tự (`max-len`, trừ URL
và regex) — trần 500 dòng mỗi file vô nghĩa khi một dòng gói ba câu lệnh.
