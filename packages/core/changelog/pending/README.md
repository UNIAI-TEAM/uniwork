# Bản nháp phát hành

Sau mỗi push/merge vào `develop`, workflow **Changelog** tạo artifact
`changelog-unreleased` gồm `unreleased.md` và `unreleased.json`.

Tải JSON từ lần chạy mới nhất, lưu thành `<version>.json` trong thư mục này.
Chọn lại số phiên bản nếu cần; viết title, summary, note và các mục cập nhật
bằng Việt/Anh; quyết định include/exclude cho mọi commit chưa phân loại.
Đặt `ready: true` sau review và merge file vào develop. Chỉ thay đổi file notes
ở bước này: `sourceRef` trong bản nháp phải phản ánh code sẽ phát hành.

Tag `v<version>` trên commit develop đã chứa file duyệt này kích hoạt cập nhật
catalog và các locale qua PR tự động, sau đó tạo GitHub Release. Catalog công
khai chỉ nhận nội dung đã duyệt, không nhận các bản nháp.

Hướng dẫn cấu hình và lệnh thử: `docs/public-changelog.md`.
