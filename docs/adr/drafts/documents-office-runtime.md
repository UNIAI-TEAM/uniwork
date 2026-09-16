# NNNN — Runtime cho engine Office đa định dạng (UniWork Office)

> **Trạng thái:** proposed — bản nháp chuẩn bị ở DOC-001 (1a.4), chưa được chấp nhận.
> Số ADR chỉ được cấp khi quyết định được chấp nhận, sau bằng chứng DOC-003/004.
> File này nằm ở `drafts/`, không được governance test đếm và chưa có hiệu lực.

**Issue:** UNI-665 (DOC-001) · **Parent:** UNI-656.
**Sẽ thay thế:** [0018](../0018-engine-office-chay-o-sidecar-node.md) khi được chấp nhận.
**Nguồn:** spec G0 §2.1 (BRAND-01), §8.1 (INT-01), §7; checklist DOC-002..006.

---

## Bối cảnh

ADR 0018 chốt một quyết định đúng cho thời điểm của nó: engine Office chạy ở sidecar
Node, dùng chung với ứng dụng desktop, và **phạm vi chỉ DOCX**. Quyết định đó được giữ
nguyên trong lịch sử; tài liệu này không viết đè nó.

Phạm vi đã đổi (2026-09-16): sáu nhóm định dạng DOCX/XLSX/PPTX/PDF/Markdown/HTML nằm
trong phạm vi, có editor trực tiếp trên **web** và trên **UniWork Office** desktop, dùng
cùng danh tính, quyền, phiên bản và audit. Ba câu hỏi mở của 0018 vì thế không còn đủ:

1. **Một runtime hay nhiều?** 0018 giả định mọi engine đi qua một sidecar Node. Khảo sát
   cho thấy Sheets có engine **Rust native** (`apps/sheets/native/xlsx-engine`), PDF có
   thao tác content-stream, và sáu app có cấu trúc không hoàn toàn giống nhau. "Một
   sidecar Node cho tất cả" là giả thuyết, không phải kết luận.
2. **Web hay chỉ desktop?** 0018 kết luận web không sửa DOCX giữ nguyên định dạng. Yêu
   cầu mới là web sửa được, ở mức ma trận Q1-B.
3. **Xử lý nội dung ở đâu?** Q4-A: browser/worker hoặc hạ tầng nội bộ UniWork; **không**
   gửi file sang nhà cung cấp Office/OCR bên ngoài; bộ on-premise phải chứa runtime được chọn.

Đồng thời, brand đổi: bề mặt sản phẩm là **UniWork Office** (`uniwork-office`), GenOffice
chỉ còn là tên nguồn upstream (BRAND-01).

## Quyết định (đề xuất — chờ bằng chứng)

1. **Nguồn GenOffice được nhập chọn lọc vào monorepo UniWork**, pin commit + checksum +
   dependency closure, giữ `LICENSE`/`NOTICE`, ghi patch có nguồn gốc, **loại `/ee`**
   (bước kiểm CI). Build phải dựng lại được từ checkout sạch, không phụ thuộc
   `../genoffice` hay symlink của máy cá nhân.
2. **Module engine dùng chung qua adapter**, với **entry point browser tách khỏi
   Node/Electron/native**. Không kéo Node/Electron/native vào bundle client.
3. **Go sở hữu auth, ACL, quota, commit phiên bản, audit/outbox.** Engine không có tài
   khoản riêng, không có kho phiên bản riêng, không ghi bảng nghiệp vụ. Documents tiếp
   tục là kho duy nhất (ADR 0016).
4. **Office Engine Service nội bộ** cho phần cần xử lý phía server/native, có thể chạy
   cùng máy UniWork bằng process/container riêng và **có trong bộ on-premise (E-01)**.
   Client chỉ gọi API UniWork, không giữ credential hay gọi thẳng endpoint engine.
5. **Runtime cho từng capability được chốt theo bằng chứng DOC-003/004**, không theo
   giả định: TypeScript engine thử trong worker khi phù hợp; Rust native hoặc tác vụ phía
   server đi qua service nội bộ; **không mặc định Rust chạy được bằng WASM**; desktop có
   thể chạy engine local (chuẩn bị cho offline G5).
6. **Một engine, nhiều nơi chạy, nhưng fidelity phải được đo riêng từng nơi.** Cùng
   engine version giúp giảm sai lệch, **không** thay kiểm thử theo nền tảng; phiên bản,
   font, runtime, bộ giải mã ảnh đều phải ghi trong kết quả.
7. **Brand sản phẩm là `UniWork Office`**; app/bundle id, scheme, user-data và kênh cập
   nhật tách khỏi upstream để không ghi đè bản GenOffice đang cài và không nhận lại binary
   mang brand cũ. Giữ attribution và **không** đổi nội dung trong file người dùng.

### Chưa chốt (câu hỏi còn chặn)

| # | Câu hỏi | Chờ |
| --- | --- | --- |
| O-01 | Runtime cuối cùng cho từng định dạng/thao tác (browser / worker / service nội bộ / native desktop) | DOC-003/004 |
| O-02 | Cách chạy engine Rust native ở phía server (process, sidecar, hay biên dịch khác) | DOC-003/004 |
| O-03 | PDF: engine nào sửa nội dung lớp chữ, giới hạn đã kiểm | DOC-003 |
| O-04 | Hợp đồng login desktop và đơn vị phiên bản/xung đột | DOC-005 |
| O-05 | Số ADR, giá trị app id/scheme/update feed/keychain cụ thể | 1b.1 + DOC-004/005 |

## Hệ quả

- Sơ đồ triển khai vẫn nhiều hơn một runtime so với app thuần Go; đây là cái giá đã cân
  nhắc và chỉ được chấp nhận nếu DOC-003/004 chứng minh cần thiết.
- Bộ on-premise **phải** chứa runtime đã chọn; thiếu nó là lỗi phát hành, không phải
  giới hạn đã biết.
- Nâng cấp upstream là quy trình có kiểm: chạy lại fixture theo engine/adapter/protocol
  version; rollback không mất nháp.
- Bề mặt web và desktop phải cho cùng kết quả trên cùng tài liệu, cùng quyền và cùng
  lịch sử phiên bản; khác biệt chỉ ở nơi engine chạy.
- Việc chấp nhận ADR này **tự động chuyển 0018 sang `superseded by NNNN`**, thêm chỉ mục
  ở `docs/adr/README.md`, và thêm luật tương ứng vào `CLAUDE.md` kèm tên test giữ luật.

## Test giữ luật (đề xuất; số/đường dẫn chốt khi chấp nhận)

- Arch test: chỉ adapter Office gọi tới engine service; engine service không import gói
  nghiệp vụ và không đọc bảng nghiệp vụ.
- Test: credential engine không xuất hiện trong bundle client.
- CI bộ cài E-01: runtime được chọn có mặt trong compose và Helm.
- CI bản fork: không tồn tại đường dẫn `/ee`; `LICENSE`/`NOTICE` khớp upstream.
- Fixture: chạy lại theo engine/adapter/protocol version khi nâng upstream.

## Trạng thái

`proposed` — chưa có hiệu lực. Chưa sửa ADR 0018, chưa thêm vào chỉ mục, chưa thêm luật
vào `CLAUDE.md`. Việc chấp nhận thuộc bước 1b.1 sau khi DOC-003/004 có bằng chứng và
người có thẩm quyền quyết định.
