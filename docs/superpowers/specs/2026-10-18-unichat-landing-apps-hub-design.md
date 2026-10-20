# UniChat L2 — Landing UniChat thiết kế lại và hub ứng dụng `/apps`

> **Trạng thái:** in-progress — issue UNI-1913 (sub-issue của epic UNI-1826), nhánh `feature/UNI-1913-unichat-l2-landing-unichat-thiet-ke-lai`.

**Ngày:** 2026-10-18 · **Bản thiết kế đã duyệt:** canvas Claude `https://claude.ai/artifact/9KNjRGbwMhZzQRn5DTVohU` (trang "UniChat": Desktop · 1440, Điện thoại · 390; trang "Hệ sinh thái": Quy hoạch, Menu Ứng dụng, Hub /apps · Desktop/Điện thoại, Menu · Điện thoại, Thành phần dùng chung, Office trong khung mới) · **Spec trước:** `2026-10-16-unichat-landing-download-design.md` (L1, shipped).

## 1. Mục tiêu

Hiện thực đúng bản thiết kế đã duyệt:

1. Một nhánh `/apps` cho mọi ứng dụng của hệ sinh thái: hub `/apps`, trang `/apps/office`, `/apps/unichat`. `/office` và `/unichat` (cùng bản `/vi/…`) chuyển hướng 308 về đường dẫn mới.
2. Menu header "Ứng dụng" thay menu "Office", đọc từ một danh mục ứng dụng.
3. Trang UniChat làm lại: tiêu đề bong bóng, sân khấu dựng theo giao diện chat thật có hiệu ứng tin nhắn → việc, phần tính năng sân khấu dính khi cuộn, khối tải dùng chung, hỏi đáp, ứng dụng khác, lời kết.
4. Hub `/apps`: thẻ ứng dụng trên nền chung, ma trận tải (máy tính) hoặc danh sách cho máy này (điện thoại), hỏi đáp, lời kết.
5. Trang Office giữ bố cục B đã duyệt, chỉ nhận thanh ứng dụng, khối tải dùng chung và mục ứng dụng khác.

## 2. Quyết định

| # | Quyết định | Lý do |
| --- | --- | --- |
| D1 | Đường dẫn `/apps`, `/apps/office`, `/apps/unichat`; giữ slug `office`, `unichat` trong danh sách dành riêng; thêm `apps`. | Một slug gốc cho mọi ứng dụng sau này (bản Quy hoạch). |
| D2 | Chuyển hướng 308 cấu hình trong `next.config.mjs` (`redirects`), danh sách nằm trong một module có test. | Chạy trước proxy, giữ link cũ và SEO. |
| D3 | Khóa route vẫn là `office`, `unichat`; thêm khóa `apps`. Breadcrumb SEO của `/apps/*` có cha `/apps`. | `seo-copy` và structured data giữ nguyên khóa. |
| D4 | Danh mục `apps-catalog.ts` (web, office, unichat; Office for Personal chỉ hiện "đang phát triển" trong menu) là nguồn của menu, hub, mục "ứng dụng khác", footer. | Thêm ứng dụng = thêm một mục. |
| D5 | Sân khấu UniChat là minh họa tĩnh dựng bằng HTML/CSS theo đúng thông số giao diện chat thật (`packages/views/chat`, `apps/chat-mobile`), không mount component thật. | Component thật cần query/API; landing không có phiên. |
| D6 | Khối tải `AppDownload` dùng chung cho Office và UniChat; giữ mọi hành vi L1 (máy người xem lên đầu, link store công khai thắng link pilot, ghi chú pilot, chưa ký số, chưa phát hành, lỗi + thử lại, cấu hình lệch thì suy biến). | Bảng Thành phần dùng chung, trạng thái A–F. |
| D7 | Màu chỉ từ token (`--brand`, `--brand-subtle`, `--muted`, `--tint-*`, `--chat-sender-*`, `--landing-stage`, `--landing-deep`…); sáng/tối theo theme của site. | Luật UI của repo. |
| D8 | Hiệu ứng chỉ chạy một lần khi tải, có nút "Phát lại"; `prefers-reduced-motion` hiện ngay trạng thái cuối. Phần tính năng đổi bước theo cuộn (IntersectionObserver) và theo bấm. | Bản thiết kế, nguyên tắc chuyển động của PRODUCT.md. |
| D9 | Hub chọn ma trận hay danh sách theo thiết bị người xem (UA điện thoại), không theo độ rộng; ma trận cuộn ngang trong khung khi hẹp. | Một DOM, đúng bản Hub điện thoại. |
| D10 | Header giữ nút bên phải hiện có (đăng nhập, bắt đầu, tùy chọn ngôn ngữ/giao diện); chỉ đổi nhóm menu. | Header dùng chung cả site; bản thiết kế không đổi chiến lược CTA. |

## 3. Nội dung

- Mọi chữ qua `t("landing.…")`, vi và en viết riêng. Khóa mới: `landing.nav.apps`, `landing.apps.*` (menu, danh mục, thanh ứng dụng, khối tải dùng chung, hub, ứng dụng khác); `landing.unichat.*` viết lại (hero, stage, story, devices, data, closing), giữ `download.*`, `mobile.*`, `installersError`, `retry`, `faq.*`, `security`.
- Dữ liệu minh họa dùng danh tính hư cấu của `product-demo-data.ts` (Khánh Vy, Mai An, Gia Minh, Bảo Lâm, An Nhiên, Demo Studio) và chú thích `landing.lovable.sample`.
- Không số liệu, khách hàng, giá hay ngày phát hành bịa. Office for Personal chỉ ghi "Đang phát triển".

## 4. Hành vi

- Thanh ứng dụng: dính ngay dưới header nổi; breadcrumb "Ứng dụng › {app}"; mục đang xem được gạch chân theo cuộn; nút tải ghi theo máy người xem ("Tải cho macOS", "Tải cho iPhone"…), không đoán được thì "Tải {app}". Điện thoại: tên ứng dụng mở danh sách mục (mục đầu là "Tất cả ứng dụng").
- Khối tải: thẻ nổi bật cho máy người xem (máy tính: mọi biến thể đã phát hành; Mac thêm dòng hướng dẫn chip; điện thoại: link store, pilot thì ghi chú), các nền tảng khác là các ô gọn; ứng dụng không có bản cho máy người xem thì nói thật và chỉ sang bản web; chưa phát hành/lỗi giữ câu chữ L1.
- Menu "Ứng dụng": danh sách từ danh mục; ô "Tải cho máy này" theo hệ điều hành người xem (máy tính); "Tất cả ứng dụng và bản tải" dẫn về `/apps`.

## 5. Kiểm thử

- Core: `paths/consistency.test.ts` (builder ↔ trang), route catalogue.
- Web: test trang UniChat, Office, hub; test khối tải (A–F, thứ tự, store/pilot, suy biến); test header (menu Ứng dụng); test SEO, dictionary, search-proxy; test danh sách chuyển hướng.
- Repo: `scripts/i18n-landing-keys.test.mjs`, parity vi/en, reserved slugs sinh lại.
- Soát trực quan bản dựng thật ở 1440 và 390, sáng và tối.

## 6. Ngoài phạm vi

Bản OG riêng cho `/apps`; gộp `*_installers`/`*_stores` thành map theo ứng dụng ở `/api/v1/config` (khi có ứng dụng thứ ba); ảnh chụp thật của UniChat (sân khấu là minh họa dựng theo nguồn).
