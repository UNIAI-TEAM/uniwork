# 0013 — Console `/admin` có màn Tổng quan làm cửa vào; trần màn hình lên 7

**Trạng thái:** accepted (2026-09-07) — mở rộng giới hạn "tối đa 6 màn hình" trong
`docs/superpowers/specs/2026-09-04-platform-admin-observability-design.md` §4 (#3).
Luật giữ nguyên ở `CLAUDE.md` § Platform Admin and Observability; test giữ màn hình:
`packages/views/admin/overview.test.tsx`, `e2e/admin-contrast.spec.ts`,
`e2e/admin.spec.ts`.

## Bối cảnh

F-11 đặt mục tiêu vận hành: một sự cố đi từ alert → dashboard → trace → log →
audit trong mười phút, không cần SSH. Spec cùng lúc đặt một giới hạn ngược
chiều — tối đa sáu màn hình, thêm màn hình phải có ADR — vì console cũ trong
`unidigiwork` đã biến thành bãi tính năng không ai bảo trì.

Sáu màn hình đã ship đúng như spec, nhưng cửa vào `/admin` là danh sách tổ chức.
Người trực ca mở console lúc có alert nhìn thấy một danh bạ: không có readiness,
không có số sự kiện chết trong outbox, không biết có bao nhiêu tổ chức đang bị
tạm ngưng. Những số đó nằm ở màn System, là mục cuối trong nav, và màn System
lúc đó không tự làm mới — một bảng số đứng yên không phân biệt được "0 vì khoẻ"
với "0 vì đã đóng băng từ mười phút trước".

Nói cách khác: giới hạn sáu màn hình bảo vệ đúng thứ nó sinh ra để bảo vệ, còn
mục tiêu mười phút thì không có màn hình nào phục vụ trực tiếp.

## Quyết định

1. **Trần là bảy màn hình, và màn thứ bảy là Tổng quan.** `/admin` trả về tình
   trạng nền tảng; danh sách tổ chức chuyển sang `/admin/organizations`, khớp
   với `/admin/organizations/{id}` đã có.
2. **Tổng quan không có dữ liệu riêng.** Nó chỉ đọc `GET /admin/system` và hai
   lần gọi danh sách tổ chức với `limit=1` để lấy `total`. Không thêm endpoint,
   không thêm bảng, không thêm quyền. Một màn hình cần endpoint riêng thì nó là
   tính năng mới, không phải cửa vào.
3. **Mỗi ô là một câu hỏi trực ca thật sự hỏi**, và mỗi ô chỉ tay sang nơi trả
   lời tiếp: readiness → System, số tổ chức → danh sách, sự kiện chết → runbook
   outbox. Không biểu đồ, không chuỗi thời gian: dữ liệu chuỗi thời gian đã ở
   Grafana và console không cạnh tranh với nó.
4. **Số liệu vận hành mang tuổi của chính nó.** `useAdminSystem` tự làm mới mỗi
   15 giây và cả hai màn Tổng quan lẫn System hiện "cập nhật N giây trước" cạnh
   nút làm mới thủ công.
5. **Trần bảy là trần cứng.** Màn hình thứ tám vẫn cần một ADR mới, với cùng lập
   luận: nó phục vụ runbook nào, và vì sao runbook đó không dùng được màn hình
   đang có.

## Hệ quả

- Nav dài thêm một mục và người quen `/admin` là danh sách sẽ hụt một nhịp. Đổi
  lại, cái hụt đó chỉ xảy ra một lần, còn việc mở console lúc có sự cố thì lặp
  lại mãi.
- `paths.admin.root()` không còn trỏ tới danh sách tổ chức. Mọi link tới danh
  sách dùng `paths.admin.organizations()`; `packages/core/paths/consistency.test.ts`
  đỏ nếu một trong hai thiếu trang tương ứng.
- Tổng quan gọi ba request cho một màn hình. Chấp nhận được vì cả ba đều là
  metadata rẻ và chỉ chạy khi console mở; nếu số tổ chức lớn tới mức `count(*)`
  thành vấn đề thì câu trả lời là một endpoint tóm tắt, không phải bỏ màn hình.
- Làm mới mỗi 15 giây nghĩa là console giữ một nhịp request đều khi ai đó để tab
  mở. Đó là chủ ý cho một màn hình vận hành; nếu thành vấn đề thì hạ nhịp, không
  bỏ tuổi dữ liệu — một số vận hành không có tuổi thì không đọc được.
