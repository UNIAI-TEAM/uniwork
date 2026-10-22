# UniChat mobile — UX, trợ năng và ngôn ngữ

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

Trình đọc màn hình, cảm giác, chuyển động, quy ước Android, cỡ chữ, quyền, ngôn ngữ và ngày giờ. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

- UX, trợ năng và ngôn ngữ (UNI-2053 S6; audit U1–U3, P2 UX/i18n). **Trình đọc màn hình**: live region chỉ chạy trên
  Android, nên chỗ nào có `accessibilityLiveRegion` thì gọi `useAnnounce` (`components/ui/a11y.ts`, chỉ iOS, một lần
  mỗi lần đổi) — banner kết nối, lỗi đăng nhập, bong bóng gõ, thông báo push ở Cài đặt, dòng trạng thái cuộc gọi
  (đồng hồ cuộc gọi là `timer`, không live region). Tin mới của người khác ở đáy phòng đang mở được đọc
  (`lib/arrivals.ts` = luật live region của web; `use-arrival-announcements.ts`: một tin "Bình: …", nhiều tin "N tin
  nhắn mới", tối đa một câu mỗi 4 s, chỉ khi trình đọc màn hình bật; iOS xếp hàng sau lời VoiceOver đang đọc
  — `announceForAccessibilityWithOptions(…, { queue: true })` —, Android đưa câu vào live region `polite` ẩn
  `components/ui/live-region.tsx` vì Android 16 bỏ announcement event). Bong bóng là một phần tử: nhãn gồm trích dẫn, nội
  dung, trạng thái (đang gửi/chờ mạng/lỗi/đã sửa) và đã gửi/đã tới/đã xem; tin chưa gửi có hint; hành động
  `reply` (nơi vuốt trả lời được), `react` (👍, hay "Bỏ cảm xúc" khi đã thả), `longpress` (menu), `open_quote` (trích
  dẫn ẩn khỏi cây trợ năng khi bong bóng là một phần tử) và một `link_n` mỗi liên kết; card có nút riêng
  (ảnh, tệp, bình chọn…) giữ nút và đọc chân tin là một dòng; ô album có `longpress` và ô đầu nói "Album N ảnh".
  **Cảm giác**: `react-native-keyboard-controller` (`KeyboardProvider` ở root; `KeyboardAvoidingView` của nó cho phòng
  và tạo nhóm; inset home indicator của composer co theo `progress` của bàn phím); rung `data/haptics.ts` (iOS
  impact/selection/notification, Android hằng số phản hồi của hệ thống) cho gửi, nhấn giữ (tin, phòng, liên kết), biểu
  cảm, nghe/gác máy, lúc vuốt trả lời vượt ngưỡng (`swipe-to-reply.tsx`, mỗi lần vượt một lần), lúc bắt đầu ghi âm và
  khi một tin của mình chuyển sang lỗi lúc phòng đang mở (`use-send-failure-feedback.ts`, kèm câu đọc cho trình đọc màn
  hình) — instance ở `components/ui/haptics.ts`. **Chuyển động**: `useReduceMotion` (`components/ui/a11y.ts`) là cách
  đọc duy nhất công tắc giảm chuyển động (bắt đầu ở "đứng yên"); `CallAwareModal` đổi `slide` thành `fade` cho mọi sheet
  khi bật. Toast đọc một lần: TalkBack qua live region, VoiceOver qua `announceForAccessibility` (chỉ iOS); vạch "N tin chưa đọc" (`lib/unread-divider.ts`, port
  `firstUnreadIndex`/`unreadSinceOf` của web): con trỏ đã đọc và số chưa đọc chụp từ danh sách phòng lúc mở (trước khi
  mở phòng đánh dấu đã đọc), vạch nằm trên tin đầu tiên của người khác sau con trỏ, giữ tới khi rời phòng; quá màn đầu
  thì phòng mở tại vạch (không animate; link tới một tin thắng); tin chưa đọc vượt các trang đã tải thì phòng tải thêm
  trang cũ (`components/chat/use-unread-backfill.ts`, tối đa `UNREAD_BACKFILL_PAGES` = 4 trang, tức tới ~250 tin chưa
  đọc, không khi đang fetch) rồi vẽ vạch và mở tại đó; vượt nữa thì không vẽ vạch thay vì vẽ sai chỗ (mở ở tin mới nhất); nút về tin mới nhất `components/chat/jump-to-latest.tsx` khi cuộn lên hoặc đang
  xem trang cũ (`onJumpToLatest`), đếm tin người khác gửi từ lúc rời đáy (`countNewSince`, như web), tự gửi thì cuộn
  xuống (`latestSignal` của `MessageList`); ảnh xem lớn `zoomable-image.tsx` (chụm, chạm hai lần, kéo khi phóng to, vuốt
  dọc ở 1x để đóng; toán ở `lib/zoom.ts`; Modal có `GestureHandlerRootView` riêng). **Quy ước Android** (`lib/platform-ui.ts`, `components/ui/ripple.ts`): nút back
  là mũi tên trên Android, chevron trên iOS; vùng chạm tối thiểu 44 pt (iOS) / 48 dp (Android) — `Button` (mọi size,
  size nhỏ qua `hitSlop`) và `HeaderIconButton` tự tính `hitSlopFor`; điều khiển tự dựng trải `useTapTarget(cỡ vẽ, tròn?)`
  (`components/ui/tap-target.ts`: `hitSlop` bù tới vùng chạm của nền tảng + `android_ripple`) — composer (đính kèm,
  sticker, gửi, mic, huỷ trả lời, dòng gợi ý @), thanh cảm xúc và menu nhấn giữ (`message-actions.tsx`: nút cảm xúc
  44 pt, dòng menu 48 dp trên Android), cảm xúc/chủ đề/trích dẫn trên tin, tin thoại (phát, tốc độ), pill workspace,
  chip lọc, tab Tin nhắn/Kênh, Thử lại; điều khiển nằm cạnh nhau (chip, cảm xúc, tab) chỉ nới trên/dưới để chạm không
  rơi sang hàng xóm. `Button`, nút header, dòng của sheet, dòng phòng, dòng người, dòng Cài đặt có `android_ripple`
  theo mực của theme. Test component đọc ripple ở `nativeBackgroundAndroid` của view host. **Cỡ chữ**: vai trò ở
  `lib/type-scale.json` (`text-meta` … `text-display-xl`, `text-emoji*`; tailwind và `cn()` đọc cùng file — thiếu
  `extendTailwindMerge` thì `text-footnote` bị coi là màu); `lib/type-scale.test.ts` đỏ khi `app/`/`components/` dùng
  `text-sm`… hay `text-[13px]`. Phần tử chứa chữ dùng `min-h-*` + padding dọc, không `h-*` cố định (cả `Button`, ô tìm kiếm, ô nhập); cùng test đỏ
  khi một chuỗi class có `h-*` cố định mà không có chiều rộng cố định (ô icon/avatar), không phải đường kẻ ≤ 2 và không
  nằm trong `FIXED_HEIGHT_OK` (scrim, skeleton, sóng âm, minh hoạ — ghi lý do); chỉ huy hiệu chặn
  cỡ chữ (`BADGE_MAX_FONT_SCALE` 1.4) và nhãn tab (`TAB_LABEL_MAX_FONT_SCALE` 1.3, như tab bar native giữ nhãn cố định).
  **Quyền**: `data/permissions.ts` (màn giải thích `components/ui/permission-primer.tsx`
  qua `stores/permission-primer-store.ts`, instance native `components/ui/permission-gate.ts`): đã cấp thì đi tiếp, hệ
  thống còn hỏi được thì giải thích rồi mới hỏi, không hỏi được nữa thì mở `Linking.openSettings`; `once` (thông báo lúc
  mở app) chỉ hỏi một lần mỗi máy (nhớ ngay khi màn giải thích đã hiện, dù "Để sau" hay từ chối ở hộp thoại hệ thống:
  Android 13+ lần từ chối đầu vẫn báo `canAskAgain`) và không tự đưa ra Cài đặt; Cài đặt › Thông báo hỏi lại. Micro trước tin thoại
  (`use-voice-recorder.ts`) và trước gọi/nghe (`ensureCallPermissions(withCamera, callId)`; cuộc gọi vẫn đi tiếp khi bị
  từ chối; nút Nghe chỉ nghe đúng cuộc gọi đã bấm — `acceptCall(callId)` — và màn giải thích của cuộc gọi đang nghe không
  bị đóng khi chính cuộc gọi đó đổ chuông), camera
  trước gọi video và trước khi bật camera giữa cuộc gọi (`components/calls/toggle-camera.ts`; tắt camera không hỏi); ảnh không cần (trình chọn của hệ thống). **Ngôn ngữ**: chuỗi tiếng Anh có `{{count}}` là cặp
  `_one`/`_other`, tiếng Việt một khoá (như core; `lib/i18n.test.ts` đỏ khi thiếu); i18next 26 không có
  `Intl.PluralRules` (Hermes) vẫn chọn one/other theo luật tiếng Anh. Ngôn ngữ app lên server (`users.locale`, push và
  email theo nó): `data/locale-sync.ts` gửi `PATCH /me` lần đăng nhập đầu của mỗi tài khoản trên máy và mỗi lần đổi
  ngôn ngữ trong app (khoá `locale_synced:<userId>` trong kho trên máy); đổi trên web sau đó thì giữ tới khi máy đổi lại.
  Chuỗi của lát này ở `scripts/i18n-ux.mjs`. Máy chỉ có ngôn ngữ khác vi/en thì app nói tiếng Anh (`matchSupportedLocale`;
  không biết ngôn ngữ nào thì tiếng Việt). Lựa chọn trong Cài đặt lưu kèm ngôn ngữ hệ thống lúc chọn (`en|vi`,
  `data/locale-preference.ts`): đổi ngôn ngữ theo app của hệ thống sau đó (iOS Cài đặt › UniChat, Android 13+) thì hệ
  thống thắng và lựa chọn cũ bị thay; đọc một lần lúc boot (`loadLocalePreference`), splash chờ (`useLocaleReady`) nên
  khung hình đầu đã đúng ngôn ngữ; ngôn ngữ hệ thống được hỏi lại mỗi lần app về foreground (`refresh`, cùng chỗ với
  công tắc 12/24 giờ), vì Android 13+ đổi ngôn ngữ theo app mà không khởi động lại tiến trình (iOS thì có); task không giao diện (`data/app-locale.ts`) theo cùng luật. Ngày giờ chỉ qua
  `lib/locale-format.ts › dateTimeFormat`: ngôn ngữ của app (tiếng Anh viết `en-GB`, ngày trước tháng), giờ theo công tắc
  12/24 giờ của máy (`expo-localization › getCalendars`, đọc lại mỗi lần app về foreground); đừng gọi
  `toLocale*String`/`new Intl.DateTimeFormat` ở nơi khác. Số cũng vậy: `numberFormat` (vi nhóm bằng ".", thập phân
  bằng ","; en ngược lại) — cỡ tệp trên thẻ tệp (`lib/message-display.ts › formatFileSize`) và mọi `{{count}}` của chuỗi
  dịch (`countFormatter` của `lib/i18n/singleton.ts`, `interpolation.alwaysFormat`; chuỗi không dùng định dạng
  `{{x, number}}` của i18next, `lib/i18n.test.ts` giữ). `formatSyntax` của `eslint.config.mjs` đỏ khi `toFixed`,
  `toLocale*` hay `new Intl.*` xuất hiện ngoài `lib/locale-format.ts`. Chữ dựng ngoài JSX (toast, `Alert`, lời đọc
  `announceForAccessibility*`, title/body/name của thông báo và kênh) cũng phải qua `t()` (`copySyntax`, fixture
  `lib/lint-copy.test.ts`). Luật lint chữ (`i18next/no-literal-string`, `jsx-only`) bắt cả
  chuỗi trong biểu thức JSX và các prop người dùng đọc hay nghe (`accessibilityLabel`, `accessibilityHint`,
  `placeholder`, `title`, `label`…; fixture `lib/lint-copy.test.ts`); `lib/i18n.test.ts` đỏ khi vi và en khác
  `{{placeholder}}`.
- Vừa màn hình và cỡ chữ lớn (UNI-2053, audit UX 8/10). **Menu nhấn giữ** (`components/chat/message-actions.tsx`) tính
  bố cục từ cửa sổ, inset và cỡ chữ (`lib/action-menu-layout.ts`): tin được nâng lên còn 3 dòng trên cửa sổ < 700 pt,
  2 dòng ở cỡ chữ trợ năng (1 dòng nếu không thì menu ngắn hơn 2,5 hàng), thẻ menu rộng theo chữ tới 1.5× và cao tối đa
  phần còn lại, quá thì cuộn (iOS nháy thanh cuộn) — máy 360 × 640 dp ở cỡ chữ mặc định đã tràn trước đây; cột menu là
  một lớp modal với VoiceOver và vuốt chữ Z đóng nó. **ActionSheet** chặn ở 85 % màn hình; hàng tràn thì cuộn và sheet
  chỉ kéo từ grabber (`dragFrom="handle"`), vừa thì kéo từ đâu cũng được. **Cỡ chữ trợ năng**: `useLargeText()`
  (`components/ui/a11y.ts`, `fontScale ≥ LARGE_TEXT_SCALE` 1.6 ở `lib/type-scale.ts`) — hàng phòng cho tên và dòng cuối
  hai dòng mỗi thứ, dấu/giờ/huy hiệu xuống dòng dưới; hàng nhật ký cuộc gọi đưa giờ xuống dưới kết quả; hàng Cài đặt
  xuống dòng nhãn và đặt giá trị dưới nó. Preset Jest của React Native báo `fontScale` 2, nên `test/jest-setup.ts` đặt
  về 1; test cỡ chữ lớn tự `jest.spyOn(Dimensions, "get")`. **Danh sách phụ** (Cuộc gọi, Danh bạ, Nhắn tin mới, Tạo
  nhóm, Kênh): `components/ui/list-states.tsx` — `ListSkeleton` (khung hàng, một phần tử progressbar) và
  `ListLoadError` (nói cái gì hỏng, gợi ý kiểm tra mạng, Thử lại; live region `assertive` trên Android, `useAnnounce`
  trên iOS). **Splash** chờ cả theme đã lưu (`useThemeReady`, cờ `ready` của `data/theme-preference.ts`), nên chọn
  tối trên máy sáng không còn một khung sáng. **Bàn phím** kéo xuống từ danh sách tin: iOS bằng
  `keyboardDismissMode="interactive"`, Android bằng `KeyboardGestureArea` (`interpolator="ios"`,
  `components/chat/timeline-list.tsx`; Android 11+). Kiểm trên thiết bị: `maestro/flows/message-menu-large-text.yaml`
  (nightly, Android font_scale 2.0 + dark + cửa sổ 360 × 640 dp; iOS AX5 + dark) và
  `flows/a11y-large-text-dark.yaml` trên simulator ở mỗi PR chạm iOS (`mobile-verify.yml › ios-release`).
