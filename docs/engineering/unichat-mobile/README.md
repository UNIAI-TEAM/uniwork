# UniChat mobile — tài liệu kỹ thuật

> **Trạng thái:** shipped · 2026-10-22

Thiết kế từng phần của `apps/chat-mobile`. Bản đồ tầng, ranh giới và luật có test giữ ở `apps/chat-mobile/CLAUDE.md`;
mỗi file dưới đây là một phần, sửa hành vi phần nào thì sửa file đó cùng PR. Lý do của các quyết định lớn nằm ở ADR
(`docs/adr/0011-*`, `docs/adr/0037-*`, `docs/adr/drafts/0038-*`), không lặp lại ở đây.

| File | Phần |
| --- | --- |
| [boundaries.md](boundaries.md) | Ranh giới import, allowlist của core, lớp mutation, luật chất lượng và cấu trúc của lint |
| [config-security.md](config-security.md) | `app.config.ts`, biến build, bundle id, ký OTA, sao lưu Android, ghim TLS |
| [lib-and-theme.md](lib-and-theme.md) | Tầng thuần `lib/`, theme và token, tương phản, font |
| [realtime.md](realtime.md) | Ba tầng socket, decoder frame, luật socket, ân hạn nền, khôi phục phiên |
| [offline-first.md](offline-first.md) | Mở lạnh, kho trên máy, outbox, lượt chờ, nháp, cache đĩa, reconnect |
| [observability.md](observability.md) | Báo lỗi, Sentry, log, cấu hình từ xa và công tắc, thống kê, toast, đăng xuất |
| [store-compliance.md](store-compliance.md) | Xoá tài khoản, pháp lý, giấy phép, đồng ý AI, báo cáo và chặn, FGS, hồ sơ store |
| [device-privacy.md](device-privacy.md) | Ẩn nội dung thông báo, khoá app, chặn chụp màn hình |
| [navigation.md](navigation.md) | Deep link và phản hồi thông báo |
| [chat.md](chat.md) | Tab Chat: key, cache, màn hình, file route |
| [calls.md](calls.md) | Cuộc gọi, cuộc gọi native Android, kênh thông báo, push đổ chuông, kind giàu |
| [performance.md](performance.md) | Model hàng, danh sách tái chế, timeline dài, cửa sổ trượt, ảnh, bundle |
| [ux-a11y-i18n.md](ux-a11y-i18n.md) | Trình đọc màn hình, cảm giác, chuyển động, quy ước nền tảng, cỡ chữ, quyền, ngôn ngữ |
| [testing-ci.md](testing-ci.md) | Lệnh, hai lớp test, sàn coverage, máy thật, `mobile-verify.yml` |
| [release.md](release.md) | Profile EAS, version và runtime, phát hành, OTA, sức khoẻ bản phát hành, Maestro, icon |

Baseline bảo mật: `docs/engineering/unichat-mobile-masvs.md`. Vận hành: `docs/runbooks/unichat-mobile-release.md`.
