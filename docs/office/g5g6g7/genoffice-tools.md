# UniWork Office — Bảng công cụ agent genoffice (G6-01)

> **Trạng thái:** in-progress — bản khung; cột tay và khối trích xuất đang được điền (UNI-1363).

## 1. Nguồn, cách tái tạo và kiểm tra

- **Fork tại SHA:** `0d03b185` (fork `main`), là pin web hiện tại `0.1.0-0d03b18`
  ([office-web-modules](../office-web-modules.md)). Mọi `path:line` trong tài liệu này đọc tại SHA đó.
- **Nguồn duy nhất của tên công cụ cho G6-14:** instruction pack `office_uniwork_ai@N` chỉ được nhắc tên công cụ có
  trong cột `tool` của khối trích xuất (§3). Cột tay (§4–§9) là nhận định của người viết, không là nguồn tên.
- **Tái tạo cột cơ học** (trong worktree fork, không checkout, không chạy code sản phẩm):

  ```bash
  node scripts/genoffice-tools-extract.mjs --rev 0d03b185 > /tmp/genoffice-tools.md
  ```

- **Kiểm AC-2** (khối giữa hai marker = đầu ra script, từng byte), chạy ở gốc repo D với `FORK` trỏ tới worktree fork:

  ```bash
  node "$FORK/scripts/genoffice-tools-extract.mjs" --repo "$FORK" --rev 0d03b185 > /tmp/extract.md
  sed -e '1,/^<!-- extract:begin -->$/d' -e '/^<!-- extract:end -->$/,$d' \
    docs/office/g5g6g7/genoffice-tools.md | diff - /tmp/extract.md && echo AC-2 OK
  ```

- Đồng bộ upstream hoặc đổi pin: G7-06 chạy lại script tại SHA mới; cột cơ học lệch → cập nhật khối §3 và mở một hàng
  review tay cho owner F + Product (§10).

## 2. Từ vựng chốt theo code

PENDING (W2).

## 3. Cột cơ học (sinh bằng script, không sửa tay)

<!-- extract:begin -->
PENDING extractor output (W1)
<!-- extract:end -->

## 4. Cột tay theo module

PENDING (W2: agent-core, docs, markdown, html; W3: sheets, slides, pdf).

## 5. Kiểm an toàn (spec §6.3)

PENDING.

## 6. Hiển thị và hoàn tác thay đổi AI (spec §6.4)

PENDING.

## 7. Công cụ hỏi lại người dùng

PENDING.

## 8. Đối chiếu ma trận tác vụ (spec §6.5)

PENDING.

## 9. Công cụ còn thiếu → G6-12

PENDING.

## 10. Ký duyệt cột tay (AC-4)

Cột tay (§2, §4–§9) chờ owner F + Product ký qua Advisor; chữ ký đóng gate G6-D4. Cột cơ học (§3) không cần ký: nó
được kiểm bằng lệnh AC-2 ở §1.
