# UniChat L1 — Trang tải `/unichat` trên landing — Kế hoạch triển khai

> **Trạng thái:** in-progress — mã xong trên nhánh `feature/UNI-1837-unichat-l1-trang-tai-tren-landing-unicha`, chờ review PR; issue UNI-1837.

**Mục tiêu:** Trang công khai `/unichat` (và `/vi/unichat`) giới thiệu UniChat và cho tải đúng bản: desktop theo hệ điều hành và kênh từ `unichat_installers`, điện thoại theo store từ `unichat_stores`; mọi link đến từ `GET /api/v1/config`; env trống thì nói thật "chưa phát hành".

**Kiến trúc:** Server dùng lại parser `OFFICE_INSTALLER_<CHANNEL>_URLS` (tách thành `parseInstallers`, cùng khóa nền tảng, cùng kiểu `config.OfficeInstaller`) cho `UNICHAT_INSTALLER_<CHANNEL>_URLS`; link store chỉ nhận `https` có host, không kèm thông tin đăng nhập, sai thì ẩn. Core: schema khoan dung + `officeInstallerOptions` dùng chung. Web: `office-downloads.tsx` đổi thành `app-downloads.tsx` nhận catalogue và tiền tố chữ; trang mới `unichat-page.tsx` dùng lại lớp CSS của `/office`.

**Spec:** `docs/superpowers/specs/2026-10-16-unichat-landing-download-design.md`.

## Ràng buộc chung

- Hợp đồng với D2 (UNI-1835): giá trị `UNICHAT_INSTALLER_{DEV,BETA,STABLE}_URLS` cùng định dạng JSON `{"<platform>":"<url>"}` và cùng khóa `DESKTOP_INSTALLER_KINDS` như Office. Không sửa `scripts/office/installer-urls.mjs`, `apps/chat-desktop/`.
- Office giữ nguyên hành vi: test `office-page.test.tsx`, `office_installers_test.go`, các test Office trong `config_test.go` xanh, không đổi kỳ vọng.
- Không có biến legacy số ít cho UniChat (chỉ Office có, gỡ 2026-11-02).
- Không URL cứng; không nút chết; không huy hiệu/ảnh/con số bịa (PRODUCT.md › Evidence on Hand).

## Task 1 — Server: catalogue UniChat trong `/api/v1/config`

Tệp: `server/internal/config/{config.go,office_installers.go,unichat_downloads.go}` (+ `unichat_downloads_test.go`), `server/internal/handler/dto/sdo/common.go`, `server/internal/handler/config.go` (+ `config_test.go`), `.env.example`.

- [x] Test đỏ: `TestUniChatInstallersShareTheOfficeContract` (map hợp lệ, cùng thứ tự nền tảng, không thừa kế legacy của Office, map sai → lỗi, `http` chỉ loopback ở dev), `TestUniChatStoresAcceptOnlyHTTPS`, `TestLoadUniChatDownloadEnv`; `TestConfigPublishesUniChatCatalogue` (env trống → mảng rỗng + bốn link rỗng, map sai → rỗng, không rò sang Office).
- [x] Tách `parseInstallers(channel, raw, legacy)`; `OfficeInstallers` gọi nó với biến Office; `UniChatInstallers` gọi với biến UniChat, không legacy.
- [x] `UniChatStores()` trả `config.UniChatStoreLinks{ios, android, testflight, play_internal}`, giá trị không an toàn thành `""`.
- [x] `ConfigSDO` thêm `unichat_installers` (`OfficeInstallerChannelsSDO`) và `unichat_stores` (`config.UniChatStoreLinks`); handler gom ba kênh của cả hai catalogue bằng `installerChannels`.
- [x] `.env.example` liệt kê bảy biến (`scripts/env-example.test.mjs`).

## Task 2 — Core: schema khoan dung

Tệp: `packages/core/api/endpoints/config.ts` (+ `config.test.ts`), `packages/core/api/endpoints/office-desktop.ts`.

- [x] Test đỏ: catalogue UniChat theo kênh, hàng lạ/không an toàn bị bỏ; store `javascript:`/`http:`/số/có thông tin đăng nhập → `""`; khối UniChat méo → rỗng mà không làm mất flags.
- [x] `PublicConfig.unichat_installers` (cùng kiểu Office), `PublicConfig.unichat_stores`; `officeInstallerOptions` nhận tên trường để log drift đúng.

## Task 3 — Tuyến, SEO, từ điển

Tệp: `packages/core/paths/{paths,marketing,reserved-slugs}.ts`, `server/internal/service/reserved_slugs.json`, `apps/web/app/unichat/page.tsx`, `apps/web/platform/{public-page.tsx,marketing-dictionary.ts,seo.ts,seo-copy.ts}` (+ test).

- [x] Test đỏ: `seo.test.ts` có `/unichat` (canonical/alternates, sitemap có `/unichat` và `/vi/unichat`, JSON-LD `SoftwareApplication` "UniChat" với Windows, macOS, Linux, iOS, Android; Office giữ entry của nó); `consistency.test.ts` (builder `paths.unichat()` ↔ trang); `marketing-dictionary.test.ts` (`/unichat` lean, chỉ nó nhận `landing.unichat`).
- [x] `MARKETING_ROUTES` thêm `{ path: "/unichat", key: "unichat" }`; `GLOBAL_PREFIXES` thêm `/unichat`; slug `unichat` dành riêng (`pnpm generate:reserved-slugs`).
- [x] OG: `/office` dùng thẻ gốc, `/unichat` cũng vậy (không thêm ảnh mới).

## Task 4 — Khối tải và trang

Tệp: `apps/web/features/landing/app-downloads.tsx` (đổi tên từ `office-downloads.tsx`), `apps/web/features/landing/{unichat-page.tsx,unichat-page.test.tsx,unichat.css}`, `packages/core/i18n/locales/{vi,en}.json`.

- [x] Test đỏ `unichat-page.test.tsx`: vi/en render; env trống → hai `role=status` "chưa phát hành" (máy tính, điện thoại), không link nào; catalogue đủ → nút đúng URL, catalogue Office không lẫn vào; Windows UA → cột Windows trước; iPhone UA → khối điện thoại trước, iPhone trước; Android UA → Android trước; TestFlight/Play internal khi chưa có store chính, kèm ghi chú bản thử; phản hồi méo không ném.
- [x] `app-downloads.tsx`: `useAppInstallers(catalogue)`, `AppDownloadColumns({ catalogue, copy, visitorFirst })`; Office gọi với `office_installers`, `landing.office`, không `visitorFirst` → giữ thứ tự và DOM cũ.
- [x] `unichat-page.tsx`: hero, bốn điểm, link trang tính năng Chat và trang Bảo mật, khối tải (máy tính + điện thoại, cột store nằm trong cùng tệp), FAQ 4 câu.
- [x] i18n `landing.unichat.*`, `landing.nav.unichat`, `landing.nav.unichatDescription` vi/en.

## Task 5 — Header/footer

Tệp: `apps/web/features/landing/{header-directory.tsx,header-directory.css,site-footer.tsx,office-header.test.tsx}`, `e2e/landing-opening.spec.ts`.

- [x] Header: mục thứ ba "UniChat" trong menu Office (ba mục một hàng); footer: "UniChat" ngay dưới "Office" trong cột Sản phẩm.
- [x] Cập nhật kỳ vọng số link của menu Office trong test header và e2e `landing-opening`.

## Task 6 — Kiểm và PR

- [x] Go: `go test ./internal/config/`, `go test ./internal/handler/ -run 'Config|OfficeAPIOrigin|OpenAPI|Swagger'`, `go test ./internal/handler/router/ ./internal/handler/dto/...`, `go test ./internal/service/ -run Slug`, `gofmt -l`, `go vet`, `staticcheck`.
- [x] TS: vitest core `config`, `paths`, `i18n`; vitest web toàn bộ (chỉ còn lỗi có sẵn ở `platform/office-frame/frame-*`); `node --test scripts/env-example.test.mjs scripts/i18n-landing-keys.test.mjs`; `tsc` web + core; eslint các tệp đụng tới; `pnpm knip`.
- [x] Kiểm trên trình duyệt (dev server, config giả qua `page.route`): header vừa ở 1240px, trạng thái trống, catalogue đủ ở 1240px và 390px không cuộn ngang, JSON-LD.
- [x] e2e landing chạy cục bộ trên `next dev` (không có API Go; `/api/v1/config` do một máy chủ giả trả catalogue Office): `landing-opening` 10/10, `seo` 5/5, `landing-office-design` + `landing-office-editions` 9/9 (một ca đầu hụt 5s vì dev server biên dịch `/request-demo` lần đầu, chạy lại xanh). CI chạy lại trên bản build production.
- [ ] `make issue-pr KEY=UNI-1837`, thân PR tiếng Việt, comment `[agent]`.

## Để builder quyết (spec §5 và câu hỏi mở) — đã chốt

1. **Tuyến chuyển hướng hay link thẳng:** link thẳng. Trang công khai, không cần tổ chức hay audit lượt tải; route chuyển hướng chỉ thêm một bề mặt API mà không thêm thông tin. Office giữ route có kiểm thành viên của nó.
2. **Ảnh chụp màn hình:** không có ảnh thật của app UniChat (desktop/điện thoại chưa phát hành) nên không đặt ảnh. Trang dẫn tới `/features/chat`, nơi đã có bản xem trước chat dựng từ component thật. Ảnh thật thêm khi có bản phát hành (sau D2/M4).
3. **Huy hiệu store:** nút thường mang tên store ("App Store", "Google Play", "TestFlight", "Google Play (thử nghiệm)") dưới tiêu đề cột có icon `Smartphone`. Artwork chính thức của Apple/Google có điều kiện dùng và gắn với một trang store đã đăng; thêm khi app lên store.
4. **FAQ:** bốn câu — tài khoản, khác gì chat trên web, nơi lưu tin nhắn, cài bản điện thoại. Không hỏi giá, không ngày phát hành (PRODUCT.md).
5. **Env trống:** "chưa phát hành" kèm lối dùng chat trên web; không có "đăng ký nhận tin" vì sản phẩm chưa có tính năng đó.
6. **Thứ tự theo thiết bị:** chỉ UniChat bật `visitorFirst`; Office giữ thứ tự cố định để không đổi hành vi (spec §3). Trên điện thoại, khối store đứng trước khối máy tính; đọc user agent sau hydrate (`useSyncExternalStore`), HTML server luôn theo thứ tự máy tính trước.
7. **Yêu cầu hệ thống:** dùng dòng mặc định theo nền tảng của bản cài desktop (`office.desktop.install.req.*`); artifact có `requirements` riêng thì hiện cái đó.
8. **Header:** "UniChat" là mục thứ ba trong menu Office (cùng nhóm ứng dụng máy tính). Link thẳng trên thanh đã thử và đo: ở 1240px nó đẩy "Bắt đầu ngay" ra ngoài header 31px (thanh chỉ dư 22px).
9. **Không nêu tên đối thủ** (Telegram) trên trang công khai; bốn điểm khác biệt nói bằng tính năng.
10. **Slug `unichat` dành riêng:** `/unichat` là tuyến gốc nên tổ chức không được lấy slug này (docs/conventions.md › Routes).
