# UniChat — Trang tải trên landing `/unichat` như `/office` (lát L1)

> **Trạng thái:** in-progress — Đề xuất, chờ duyệt. Lát L1 của epic UNI-1826; issue UNI-1837.

**Ngày:** 2026-10-16 · **Spec cha:** `2026-10-16-chat-native-apps-design.md` §3.1, §6 D6 · **Tiền lệ:** `apps/web/app/office/page.tsx` (`publicPage`, `seoMetadata`), `apps/web/platform/marketing-dictionary.ts` (danh sách trang lean), `apps/web/platform/seo.ts` (`SoftwareApplication` cho `/office`), `apps/web/features/landing/office-downloads.tsx` (`useOfficeInstallers`, `groupOfficeInstallers`, `readBrowserPlatformGuess`), `packages/views/office/{installer-instructions,os-glyphs}.tsx`, `packages/core/office/desktop-platform.ts`, `GET /api/v1/config` (`office_installers`), `OFFICE_INSTALLER_{DEV,BETA,STABLE}_URLS`

## 1. Mục tiêu
Trang công khai `/unichat` giới thiệu UniChat và cho tải đúng bản: desktop theo hệ điều hành và kênh, điện thoại theo store (TestFlight / Play internal trong pilot); mọi link đến từ `GET /api/v1/config`, không hard-code; SEO và i18n như các trang landing khác.

## 2. Thiết kế
### 2.1 Server
Tổng quát hóa parser `OFFICE_INSTALLER_<CHANNEL>_URLS` cho `UNICHAT_INSTALLER_{DEV,BETA,STABLE}_URLS` (cùng khóa nền tảng, cùng kiểu `OfficeInstallerOption`); thêm `UNICHAT_STORE_IOS_URL`, `UNICHAT_STORE_ANDROID_URL`, `UNICHAT_TESTFLIGHT_URL`, `UNICHAT_PLAY_INTERNAL_URL`. `PublicConfigSDO` thêm `unichat_installers` (channel → options) và `unichat_stores {ios, android, testflight, play_internal}`; `.env.example` liệt kê; `scripts/env-example.test.mjs`.
### 2.2 Core
`packages/core/api/endpoints/config.ts`: schema khoan dung cho hai trường mới + malformed-response test; `selectInstallerChannel` dùng chung với Office.
### 2.3 Web
`apps/web/app/unichat/page.tsx` (`publicPage("/unichat")`, `generateMetadata`), `marketing-dictionary.ts` thêm `/unichat` vào danh sách lean, `seo.ts` thêm `SoftwareApplication` "UniChat" (operatingSystem: Windows, macOS, Linux, iOS, Android), sitemap, OG image. Nội dung (`features/landing/unichat-*`): hero "Chat cho công việc", bốn điểm khác Telegram (tin → task, kênh gắn dự án, follow-up/nhắc việc, gọi có ghi âm và tóm tắt), ảnh chụp màn hình desktop và điện thoại, khối tải, FAQ ngắn, liên kết Bảo mật. Khối tải tổng quát hóa `office-downloads.tsx` thành `app-downloads.tsx` nhận catalogue (`office_installers` | `unichat_installers`) và nhãn; huy hiệu App Store/Google Play theo hướng dẫn thương hiệu của hai hãng; điện thoại thấy huy hiệu store của mình trước, máy tính thấy bản của hệ điều hành mình (`readBrowserPlatformGuess`); env trống → "Chưa phát hành, đăng ký nhận tin" thay vì nút rỗng. Header/footer landing thêm "UniChat" cạnh "Office". i18n `landing.unichat.*` vi/en (`scripts/i18n-landing-keys.test.mjs`).

## 3. Tiêu chí hoàn thành và test
- Trang render vi/en; Lighthouse a11y ≥ 95; không URL cứng; env trống → trạng thái "chưa phát hành".
- `scripts/env-example.test.mjs`, `scripts/i18n-landing-keys.test.mjs`, `seo.test.ts` có `/unichat`, test schema `config` (malformed → fallback), test Go parser map URL UniChat.
- Office downloads không đổi hành vi (test hiện có xanh).
- Lệnh: `pnpm --filter @uniwork/web test`; `pnpm --filter @uniwork/core test -- config`; `make test-go` (gói `config`, `handler`); e2e landing hiện có không đỏ.

## 4. Rủi ro
Trang sống trước khi có bản phát hành thật — trạng thái "chưa phát hành" phải trung thực (PRODUCT.md); huy hiệu store có điều kiện sử dụng.

## 5. Để builder quyết
Có tuyến `GET /api/v1/unichat/download?platform&channel` chuyển hướng như Office hay chỉ link thẳng (đề xuất: link thẳng); bố cục ảnh; nội dung FAQ.
