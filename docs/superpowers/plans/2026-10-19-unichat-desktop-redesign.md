# UniChat desktop — giao diện kiểu Telegram — Kế hoạch triển khai

> **Trạng thái:** in-progress — UNI-1980 (UniChat R6, con của UNI-1826), nhánh `feature/UNI-1980-unichat-r6-desktop-telegram`, PR vào `develop`.

**Goal:** Đưa UniChat desktop (web app ở layout chỉ Chat trong shell Electron) về đúng bản thiết kế đã duyệt trên canvas "UniChat Desktop Redesign": cấu trúc và tương tác của Telegram Desktop, giữ nguyên token UniWork (xanh `#0a52e6`, Inter + Plus Jakarta Sans, `--chat-*`, `--call-*`).

**Nguồn:** ảnh chụp hiện trạng và 12 màn đề xuất trên canvas (trang "Hiện trạng" và "Đề xuất"). Phần lớn thay đổi nằm trong `packages/views` (dùng chung với web); thêm một endpoint tìm tin trên mọi phòng (`server/`, `packages/core`), route `/chat/settings` (`apps/web`) và màn đăng nhập desktop (`apps/web/platform`). Không đụng `apps/chat-desktop`.

## Các phần

- [x] 01 Rail: nhãn dưới biểu tượng, ô 40px, vạch chỉ báo màu primary, ô Tin nhắn mở dùng brand-subtle (`layout/workspace-rail.tsx`).
- [x] 01 Đầu cột một dòng (tên phạm vi ▾ + nút soạn), ô tìm 36px, tab 13px vừa cột (`chat-sidebar-header.tsx`, `chat-sidebar.tsx`).
- [x] 01 "Bắt kịp nhanh" thành hàng mảnh, ẩn khi không có tin chưa đọc (`chat-sidebar-catch-up.tsx`).
- [x] 01 Hàng hội thoại 64px, hàng đang mở tô brand đặc, badge đảo màu, dòng "Nháp:" (`chat-sidebar-rows.tsx`, `chat-sidebar-list.tsx`).
- [x] 01 Header 56px; nhóm "N thành viên · M đang hoạt động"; tin riêng "Đang hoạt động" khi online (`chat-conversation-header.tsx`, `chat-page-conversation-toolbar.tsx`).
- [x] 02 Thanh hover gọn (❤️, emoji, trả lời, …) bên cạnh bong bóng; menu chuột phải/nhấn giữ có hàng cảm xúc và nhóm thao tác; bỏ nhấn-giữ-hiện-thanh (`chat-message-hover-actions.tsx`, `chat-message-menu-items.tsx`).
- [x] 04 Thẻ khởi đầu thu thành chip một dòng khi đã có tin (`chat-conversation-intro.tsx`).
- [x] 04 Composer phẳng sát đáy: kẹp giấy (menu đính kèm) · ô nhập · emoji · mic/gửi (`chat-composer.tsx`).
- [x] 03 Cột thông tin: media thành danh sách dọc có số, hàng mô tả/link/thông báo, thành viên có trạng thái.
- [x] 05 Tìm kiếm ⌘K có mục Tin nhắn (trích đoạn, tô từ khớp) và nhảy tới tin.
- [x] 06 Giao diện tối: kiểm tra từng màn trên token tối (dòng đang mở tô `--primary` tối, chữ tối; không cần token mới).
- [x] 07 Trang Cài đặt trong app desktop (Hồ sơ, Thông báo, Tùy chọn, Bảo mật, Phím tắt, Về UniChat) — route `/chat/settings`; avatar ở chân rail mở nó (bỏ bánh răng và menu tài khoản). Thông báo chỉ giữ các loại `chat_*` và thêm 3 tuỳ chọn trên máy (âm thanh, nội dung tin, số trên biểu tượng — `core/chat/device-notification-store.ts`); Phím tắt chỉ giữ ⌘K tìm cuộc trò chuyện và các phím cố định của ô nhập.
- [x] 08–09 Cuộc gọi: thanh điều khiển có nhãn, chip Đang ghi; dải cuộc gọi đang diễn ra trên đầu khung chat; thẻ cuộc gọi đến. Nhãn, chip, bảng người tham gia và thẻ cuộc gọi đến đã có sẵn; mới là `ChatActiveCallBar` khi thu nhỏ. Nút Rời tách đôi (Rời ▾) không làm: "Kết thúc cho mọi người" giữ là nút riêng có hộp xác nhận.
- [x] 10 Màn chào: điểm nhấn tính năng, bước chờ trình duyệt có các bước.
- [x] 11–12 Cửa sổ hẹp: cột danh sách thu thành cột avatar dưới ~1000px (container query `@max-3xs/chatlist`); một cột dưới `md` (768px) là bố cục web mobile có sẵn — app desktop không chạm tới vì `MIN_WINDOW_WIDTH` là 900.

## Đợt chỉnh theo Telegram sau khi duyệt

- [x] Hover tin: không còn dải nền cả dòng; chỉ một nút ❤️ tròn cạnh bong bóng, đủ thanh khi focus bằng bàn phím.
- [x] Chat riêng không vẽ avatar cạnh tin; bong bóng cuối chuỗi có đuôi (tin chữ, tin thoại).
- [x] Thanh trả lời/sửa thành hàng riêng trên ô nhập (cột ↩ thẳng kẹp giấy, ✕ tròn thẳng mic); Esc huỷ trả lời; thanh trượt mở, micro ↔ gửi biến hình (tắt khi giảm chuyển động).

## Còn lại

- Về UniChat: nút "Kiểm tra cập nhật" (cần thêm IPC ở `apps/chat-desktop`) và "Gửi phản hồi".
- Bảo mật: thứ tự canvas (Phiên đăng nhập trước MFA).

## Kiểm tra

Test đích theo từng file (`NODE_OPTIONS=--no-experimental-webstorage npx vitest run chat/…`), `pnpm --filter @uniwork/views typecheck`, ảnh chụp qua CDP từ app Electron dev (`electron-vite dev --remoteDebuggingPort 9222`). Bộ đầy đủ để CI chạy.
