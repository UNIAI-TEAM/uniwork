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

### Cơ sở bằng chứng của bảng trên (đọc trước khi trích dẫn)

O-01..O-03 **chưa** có câu trả lời ở bất kỳ tài liệu nào đã nghiệm thu. Bằng chứng hiện có chỉ là đọc source/model và các chu kỳ browser hẹp dưới đây; nó không chọn runtime:

- Handoff §3 ghi nhận đúng ba nhóm chu kỳ browser-real scoped, đều là non-gate: DOCX table edit một ô top-level bằng bàn phím, Ctrl+S và mở lại view riêng trên installed Windows Chrome 153.0.8010.50 và Edge 153.0.4234.48; PDF sửa một text run có sẵn ở trang 1, Save và mở lại bằng Orca embedded Chromium 150.0.7871.250 trên Win32; PPTX thay ảnh có sẵn slide 1 pic#3, Save và mở lại trên installed Windows Chrome 153.0.8010.50 và Edge 153.0.4234.48. Xem `docs/office/g0/pilot-handoff.md:198-203` và các row `E-DOCX-TABLE-SCOPED-CHROME/EDGE`, `E-PDF-TEXT-SCOPED-CHROMIUM`, `E-PPTX-IMAGE-SCOPED-CHROME/EDGE` trong evidence register.
- Các chu kỳ này chỉ chứng minh thao tác scoped đã nêu; chúng không đóng bất kỳ `G0-CORE-*` nào: DOCX dùng fixture khác F-DOCX-KITCHEN và chưa có protocol version; PDF chỉ là embedded Chromium, chưa có bằng chứng sửa ảnh/render; PPTX chỉ thay ảnh, không chứng minh sửa text/shape hoặc fidelity tổng quát. Mac/Safari vẫn thuộc QA-01 / UNI-671.
- **Cập nhật 2026-09-25:** sáu gate `G0-CORE-*` đã đạt bằng các chu trình thật trong trình duyệt nhúng Orca trên Windows (register tích hợp, verifier GO 8/8) và người dùng đã ghi quyết định G0 = GO; xem `docs/office/g0/pilot-handoff.md` §3. Runtime **vẫn chưa được chọn** (`runtime_chosen: false`, DOC-004 4.1) và O-01..O-03 vẫn mở, nên draft này vẫn là `proposed`. Đoạn dưới đây là ghi chép trước ngày đó.
- (Trước 2026-09-25) Vì vậy hiện **chưa có accepted sáu-format DOC-003 core gate**, runtime vẫn chưa được chọn (`runtime_chosen: false`), và không có claim về product integration hay G0 GO. DOC-004 real-adapter loopback 11/11 là bằng chứng riêng, không nâng các model case hoặc chọn runtime.
- DOC-004 §9.1 ghi **sai khác có chủ đích** so với mô hình ưu tiên của ADR này (XLSX recalc
  đặt ở service nội bộ; PDF sửa ảnh phụ thuộc Electron `nativeImage`; HTML preview phải
  re-home khỏi scheme Electron). Đây là **lý do** draft không tự chốt INT-01 là đã xong.
- Đã nghiệm thu trong E/ không nâng cấp dòng nào: `cursor-xlsx-metadata-r31-review.md`
  (SOURCE/FOCUSED accept; "Native / sidecar / served bundle: UNPROVEN"), PDF r25
  (build + initial load only), `cursor-evidence-floor-review-r3.md` (34/34 floors, tin
  nhưng không chạy lại; "Do not treat 34/34, or a synthetic `go=true`, as G0 or
  real-adapter acceptance." — `:24`), `cursor-source-safety-review-r2.md` (copy/workspace
  safety, không phải rebuild pass), `cursor-protocol-binding-review-r7.md` (bounded
  cleanup/discard slice). Không cái nào chứng minh engine/adapter nào chạy ở đâu.

⇒ Quyết định 1..7 ở trên **vẫn là đề xuất**, không phải hệ quả của bằng chứng đã có.

**Cảnh báo đồng thời.** DOC-004/005 là file chưa commit ở worktree riêng và **đang được
sửa trong lúc viết tài liệu này**; các câu trích ở trên chỉ đúng ở bản đọc ngày 2026-09-21.
Khi DOC-004/005 đổi (việc `real_engine_evidence` chuyển từ "chưa có" sang `present` là ca
vừa xảy ra), phải đọc lại theo tên section thay vì số dòng và cập nhật trong cùng PR.

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

`proposed` — chưa có hiệu lực. Chưa sửa ADR 0018, chưa thêm luật vào `CLAUDE.md`,
chưa được cấp số ADR và chưa vào **bảng chỉ mục chính thức** ở `docs/adr/README.md`.
Bước DOC-001a chỉ **thêm một dòng trỏ tới bản nháp** ở mục "Hiện có một bản nháp" của
README; việc **cấp số, chuyển `accepted` và thêm vào bảng** thuộc bước 1b.1 sau khi
DOC-003/004 có bằng chứng và người có thẩm quyền quyết định.
