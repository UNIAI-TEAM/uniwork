# Bộ dữ liệu phát triển G6-08 (`docs/office/g5g6g7/devset/`)

> **Trạng thái:** Hoàn thành (w21: bảng đo lường trong `docs/office/g5g6g7/g6-08-devset-report.md` tái lập được từ `devset/runs/` đã commit; `G6-08`, UNI-1373 — tách biệt hoàn toàn với `docs/office/g5g6g7/holdout/`)

Tài liệu này mô tả bộ dữ liệu phát triển (dev set) tổng hợp dùng để đo lường và tinh chỉnh gói chỉ dẫn `office_uniwork_ai` từ `@1` lên `@2` trong phạm vi `G6-08` (ADR 0037).

## Ranh giới giữa Dev Set và Holdout

- **Dev set (`docs/office/g5g6g7/devset/`)** được xây dựng hoàn toàn từ dữ liệu tổng hợp mới (`dev-xlsx-orders-xyz.xlsx` và `dev-docx-proposal-vi.docx`) để kiểm thử, phân tích lỗi và tinh chỉnh gói chỉ dẫn `office_uniwork_ai@2` cùng trần token (`MaxTokens`).
- **Holdout (`docs/office/g5g6g7/holdout/`)** chỉ dành riêng cho cổng đánh giá độc lập `G6-14`. Tác nhân thực hiện `G6-08` **tuyệt đối không mở** `docs/office/g5g6g7/holdout/cases/*`.
- Bài kiểm thử tự động `scripts/office/devset.test.mjs` quét lập trình toàn bộ câu hỏi trong `cases.json` (sau chuẩn hóa chữ thường, dấu câu và khoảng trắng) đối chiếu với `docs/office/g5g6g7/holdout/cases/*.json` để đảm bảo không có câu hỏi nào trùng với holdout, đồng thời kiểm tra không có thông tin nhạy cảm (IP, `http(s)://host:port`, tiền tố khóa `sk-...`).

## Cấu trúc thư mục

- `README.md` — tài liệu mô tả bộ dữ liệu phát triển và ranh giới với holdout.
- `cases.json` — danh sách 20 ca kiểm thử song ngữ (`vi` + `en`, gồm 16 ca XLSX và 4 ca DOCX) kèm oracle chấm điểm tự động.
- `fixtures/manifest.json` — danh mục tệp mẫu tổng hợp, mã băm SHA-256 và đường dẫn tệp oracle đi kèm.
- `fixtures/dev-xlsx-orders-xyz.xlsx` & `.oracle.json` — bảng tính tổng hợp gồm 2 trang tính (`Bán hàng T1`, `Kiểm toán`) bao phủ:
  - Các dòng có dạng doanh thu `X` (số lượng, cột `D`), `Y` (đơn giá, cột `E`), `Z` (chiết khấu, cột `F` lưu không đồng nhất: `5%`, số nguyên `10` nghĩa là `10%`, `10%`, và ô trống `0%`).
  - Dòng ẩn (`BH-105` tại dòng 6, `hidden="1"`) và hai dòng tổng (`D8/G8` dùng `SUM` tính cả dòng ẩn = `61020`; `D9/G9` dùng `SUBTOTAL(109)` bỏ qua dòng ẩn = `51300`).
  - Ô lỗi (`#DIV/0!` ở `H7`, `#N/A` ở `I7`).
  - Ô công thức có giá trị bộ nhớ đệm cũ (`Kiểm toán!D2` dùng `LEGACYCACHE(B2,C2)` với giá trị lưu sẵn `99999` không được tính lại bởi bộ máy công thức; `Kiểm toán!D3` lưu cache cũ `88888` cho `B3*C3 = 10000`).
  - Ô công thức không được hỗ trợ (`Kiểm toán!D4` dùng `FILTERXML(B4,"//tygia")` trả về `#NAME?`).
  - Chuỗi số theo định dạng vùng miền (`"1.250,5"` tại `Kiểm toán!B5`) và quy tắc làm tròn đến hàng đơn vị (`Kiểm toán!D5:E6`).
- `fixtures/dev-docx-proposal-vi.docx` & `.oracle.json` — tài liệu đề xuất phương án kho vận gồm 7 khối văn bản (`index` `0..6`) dùng để kiểm thử chỉnh sửa đoạn văn đang chọn mà không làm thay đổi các đoạn còn lại.
- `runs/run-v1-<sha>.json` & `runs/run-v2-<sha>.json` — kết quả thô của hai lượt chạy thật (`@1` dựng từ server ở commit `4df589a37`, `@2` từ commit hiện hành): mỗi ca có `prompt_id`, model phân giải, công cụ đã gọi, điểm oracle, ba loại độ trễ, và 4 lượt chạy qua giao diện bảng điều khiển. Bảng trong báo cáo được tính từ đúng hai tệp này.

## Lệnh kiểm tra và chạy đo lường

```bash
# Sinh fixture (bỏ qua nếu không sửa trình sinh) và kiểm tra khớp đĩa:
node scripts/office/devset.mjs
node scripts/office/devset.mjs --check

# Kiểm định lược đồ, quét bí mật, tách biệt holdout, oracle phủ định, run JSON + bảng báo cáo:
node --test scripts/office/devset.test.mjs scripts/office/instruction-pack-tools.test.mjs

# Tính lại bảng báo cáo từ runs/ ( --check báo lệch, --write ghi lại ):
node scripts/office/devset-report.mjs --check

# Chạy đo lường thật (dev upstream qua biến môi trường; xem docs/office/g5g6g7/dev-upstream.md):
#   @2 = server ở commit hiện hành, @1 = server dựng từ 4df589a37 trong worktree tạm (tự xoá sau khi chạy)
node scripts/office/devset-run.mjs --server-sha 4df589a37 --db-url "$UNIWORK_DEVSET_DB_URL" \
  --frame-dir <fork-checkout> --out docs/office/g5g6g7/devset/runs/run-v1-4df589a37.json
node scripts/office/devset-run.mjs --server-sha <commit-@2> --db-url "$UNIWORK_DEVSET_DB_URL" \
  --frame-dir <fork-checkout> --out docs/office/g5g6g7/devset/runs/run-v2-<commit-@2>.json
node scripts/office/devset-run.mjs --help
```

`--frame-dir` bật phần chứng minh giao diện bảng điều khiển: runner tự gõ prompt của từng ca vào panel thật của fork (docs/sheets × vi/en), chấm câu trả lời bằng `scoreDevCase` và **từ chối ghi summary** nếu không đủ 4 tổ hợp hoặc một tổ hợp không gọi tới façade bằng `frame_token`. Harness chỉ đọc checkout fork: mọi liên kết `@genoffice` được dựng trong thư mục harness ở `/tmp`.
