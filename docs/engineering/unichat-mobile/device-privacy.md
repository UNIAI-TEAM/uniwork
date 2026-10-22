# UniChat mobile — Quyền riêng tư trên máy

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

Ẩn nội dung thông báo, khoá app, chặn chụp màn hình. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

- Quyền riêng tư trên máy (audit "Security & privacy", no-app-switcher-privacy-or-lock). Cài đặt › Quyền riêng tư và
  bảo mật (`components/settings/privacy-section.tsx`): **Hiện nội dung trong thông báo**
  (`push-previews-row.tsx`; lựa chọn của tài khoản ở server: `PUT /me/push-previews`, `user.push_previews` trên `/me`,
  `data/push-previews.ts`; tổ chức ẩn cho mọi người qua `GET/PUT /orgs/{org}/push-preview-policy` — owner/admin đổi ở web ›
  Cài đặt › Tổ chức — thì công tắc tắt, khoá và nói lý do; ẩn thì mọi push trừ chuông cuộc gọi đến chỉ nói loại việc —
  "Tin nhắn riêng mới", "Bạn được nhắc đến trong một cuộc trò chuyện", "Cuộc gọi nhỡ", "Bạn có thông báo mới" — không
  tên người gửi, phòng, việc, tài liệu hay chữ trong tin, thân trống: tiêu đề cũng đi qua Expo/FCM/APNs như thân;
  `PushConsumer` của server thay cả hai, `hiddenPushTitle` ở `server/internal/notification/push_body.go`. Chuông giữ tên
  người gọi vì nghe máy cần biết ai gọi), **Khoá UniChat** (`expo-local-authentication`: Face ID, vân tay
  hay mã khoá của máy — bật hay tắt đều phải chứng minh chủ máy trước, máy không có khoá màn hình thì nói vậy) với "Khoá lại
  sau khi rời app" (ngay, 1, 5, 15 phút) và **Chặn chụp màn hình** (`expo-screen-capture`: Android `FLAG_SECURE`, cũng
  xoá ảnh trong màn đa nhiệm; iOS chặn chụp/quay). Luật thuần ở `lib/app-lock.ts` (`shouldLock`: mở lạnh luôn khoá,
  về foreground sau ≥ thời gian đã chọn ở nền thì khoá; chỉ `background` tính là rời app — Face ID, kéo thanh thông
  báo làm app `inactive`); lựa chọn là của máy, trong Keychain cạnh theme/ngôn ngữ (`device-preferences` key
  `privacy`), đọc một lần lúc boot (`data/privacy-settings.ts`, tối đa 3 s; quá hạn thì tạm coi cả hai tắt, nhưng câu
  trả lời đến muộn vẫn được áp — `restored` — và guard coi nó là lần mở lạnh, Keychain chậm không tắt khoá cả phiên), nối với nền tảng ở
  `components/app/privacy.ts` (iOS bật app switcher protection khi một trong hai đang bật).
  `components/app/privacy-guard.tsx` (gắn ở `app/_layout.tsx`, trên mọi thứ): khi bật một trong hai, app không ở
  foreground thì phủ một lớp trơn (ảnh đa nhiệm không có cuộc trò chuyện); khoá thì hiện màn khoá và hỏi Face ID ngay
  (một lần mỗi lần khoá hiện ở foreground; huỷ thì nút Mở khoá hỏi lại); chỉ khi có người đăng nhập; cuộc gọi đang đổ
  chuông hay đang diễn ra không bao giờ bị giữ sau màn khoá (nghe từ màn khoá của máy phải nối được), hết cuộc gọi thì
  khoá lại; chưa biết lựa chọn thì phủ (app có khoá không hiện inbox một khung hình). Trong lúc đó chỉ cuộc gọi hiện:
  `data/stores/app-lock-store.ts` (`engaged`, guard ghi) làm màn cuộc gọi không thu nhỏ được (đang thu nhỏ thì phóng
  to lại) và đóng mọi `CallAwareModal` đang mở khi khoá bật (Modal là cửa sổ native riêng, nằm trên màn khoá; sheet của
  chính cuộc gọi đang diễn ra — `keepOpenForCall` — thì giữ). Màn Face ID/mã khoá của chính app (`authenticateOwner`,
  đếm ở `ownerPrompts`) không tính là rời app: trên Android màn mã khoá là activity khác, app thành `background`, nếu
  tính thì "Ngay" khoá lại ngay sau khi mở. Trình chọn ảnh/tệp và hộp thoại quyền của hệ thống vẫn tính là rời app. Android: `USE_BIOMETRIC`/
  `USE_FINGERPRINT` là quyền thường; `READ_MEDIA_IMAGES`/`DETECT_SCREEN_CAPTURE` mà `expo-screen-capture` khai cho
  listener chụp màn hình (app không dùng) bị chặn.
- **Mức tối thiểu của tổ chức** (audit "Security & privacy", privacy-defaults-off). Owner/admin bật "Bắt buộc khoá
  UniChat" và "Bắt buộc chặn chụp màn hình" ở web › Cài đặt › Tổ chức › UniChat trên điện thoại
  (`GET/PUT /orgs/{org}/mobile-security-policy`, `OrganizationService.SetMobileSecurityPolicy`, audit
  `organization.mobile_security_policy_changed`; route, không phải feature flag — flag chỉ ẩn năng lực). Trên máy,
  `components/app/privacy-floor-sync.tsx` (gắn ở `app/_layout.tsx`) đọc chính sách của tổ chức của workspace hiện tại
  (`data/queries/mobile-security-policy.ts`, schema chặt: câu trả lời lệch là `null`, giữ mức cũ chứ không gỡ) và đưa
  vào `data/privacy-settings.ts › setFloor`; mức đó lưu cạnh lựa chọn trong Keychain (`floor` trong JSON `privacy`), nên
  lần mở lạnh sau áp ngay trước khi mạng trả lời; nghe được trước khi đọc xong Keychain thì chỉ lưu sau khi đọc (không
  ghi đè lựa chọn bằng mặc định). Cái được áp là `withFloor(lựa chọn, mức)` (`lib/app-lock.ts`): guard và nền tảng
  dùng nó; Settings hiện công tắc bật, khoá và nói "Tổ chức của bạn yêu cầu…"; thời gian khoá lại vẫn là của người
  dùng. Đăng xuất (auth đã khôi phục xong mà không còn ai) gỡ mức. Tổ chức bắt buộc khoá mà máy không có khoá màn hình:
  màn khoá nói đặt mã/vân tay/khuôn mặt trong Cài đặt của máy (cũng đúng khi người dùng gỡ khoá màn hình sau khi bật).
  Yêu cầu mới tới máy đang mở thì có hiệu lực từ lần mở lạnh hay lần quay lại sau thời gian khoá lại kế tiếp.
