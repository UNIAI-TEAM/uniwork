# 0021 — Runtime đa định dạng cho engine UniWork Office: editor tại host, service nội bộ, engine native riêng

**Trạng thái:** accepted (2026-09-25) — thay thế [0018](0018-engine-office-chay-o-sidecar-node.md); phần lịch sử của 0018 giữ nguyên.
**Issue:** UNI-665 (DOC-001, bước 1b.1) · **Parent:** UNI-656 · **Liên quan:** UNI-666/667/668/669/670; roadmap C-01/C-15/C-16.
**Nguồn quyết định:** phạm vi sáu định dạng lõi (2026-09-16); Q1-B…Q9-A; BRAND-01; G0 = GO (2026-09-25).
**Bằng chứng:** `docs/office/g0/evidence-register.json` — register GO (verifier GO 8/8, 2026-09-25); sáu hàng `E-DOCX-CYCLE`,
`E-XLSX-CYCLE`, `E-PPTX-CYCLE`, `E-PDF-TEXT-CYCLE`, `E-MD-CYCLE`, `E-HTML-CYCLE` chạy trong trình duyệt nhúng Orca
(Windows, Orca 1.4.209, Chromium 150.0.7871.250) trên bridge `uniwork-office-lab-bridge@1`. Bảng runtime theo từng
thao tác: `docs/office/g0/module-runtime-map.json` (candidate DOC-004 / UNI-668, Advisor g119 nghiệm thu) và bản tóm tắt
`RUNTIME-CONCLUSION.md` của slice doc004-runtime.

---

## Bối cảnh

[0018](0018-engine-office-chay-o-sidecar-node.md) chốt một quyết định đúng cho thời điểm của nó: engine Office chạy ở
sidecar Node dùng chung với ứng dụng desktop, và **phạm vi chỉ DOCX**. Quyết định đó được giữ nguyên trong lịch sử; tài
liệu này không viết đè nó.

Phạm vi đã đổi (2026-09-16): sáu nhóm định dạng DOCX/XLSX/PPTX/PDF/Markdown/HTML nằm trong phạm vi, có editor trực tiếp
trên **web** và trên **UniWork Office** desktop, dùng cùng danh tính, quyền, phiên bản và audit. Ba câu hỏi mở của 0018
vì thế không còn đủ:

1. **Một runtime hay nhiều?** 0018 giả định mọi engine đi qua một sidecar Node. Khảo sát cho thấy Sheets có engine
   **Rust native** (`apps/sheets/native/xlsx-engine`), PDF có thao tác content-stream, và sáu app có cấu trúc không
   hoàn toàn giống nhau.
2. **Web hay chỉ desktop?** 0018 kết luận trình duyệt không sửa DOCX giữ nguyên định dạng. Yêu cầu mới là web sửa
   được, ở mức ma trận Q1-B.
3. **Xử lý nội dung ở đâu?** Q4-A: browser/worker hoặc hạ tầng nội bộ UniWork; **không** gửi file sang nhà cung cấp
   Office/OCR bên ngoài; bộ on-premise phải chứa runtime được chọn.

Ba câu hỏi đó nay có câu trả lời có bằng chứng (xem "Lựa chọn kỹ thuật có bằng chứng"); phần chưa chứng minh có tên
riêng trong bảng runtime: `proven`, `candidate` (có bằng chứng hỗ trợ) hoặc `blocked` kèm runtime candidate, hành vi
G0 từ chối và tên test sẽ chứng minh.

**Mức bằng chứng hôm nay là gì.** Sáu chu trình open–edit–serialize–reopen đã đạt trong trình duyệt nhúng Orca trên
Windows. Ngoài sáu chu trình đó, phần lớn thao tác (convert, export, OCR, preview PPTX, parse DOCX qua engine…) **chưa**
có hàng được nghiệm thu: chúng ở trạng thái `blocked`, không phải "đã chọn". Các hàng scoped (`E-DOCX-TABLE-SCOPED-*`,
`E-PDF-TEXT-SCOPED-CHROMIUM`, `E-PPTX-IMAGE-SCOPED-*`) là bằng chứng có biên, không đóng cổng nào. Tài liệu này không
tuyên bố G1–G4 đã xong.

## Quyết định

**1. Editor ở lại trang host; mọi năng lực host đi qua adapter tiêm (injected).** UniWork Office giữ editor trong trang
host cho cả sáu định dạng; module engine nào phải chạy ngoài trang thì chạy ở **tiến trình service riêng**, không nằm
trong bundle client. Entry point browser tách khỏi Node/Electron/native.

**2. XLSX recalculation là tiến trình native trong service nội bộ**, không bao giờ được trình bày như năng lực
browser/WASM (INT-01 luật 4).

**3. Engine nhận grant có phạm vi và hết hạn; engine không có tài khoản, ACL hay kho phiên bản riêng và không ghi bảng
nghiệp vụ.** Go sở hữu auth, ACL, quota, idempotency, commit phiên bản–audit–outbox và sổ object mồ côi. Documents vẫn
là kho duy nhất (ADR 0016).

**4. Runtime theo từng capability/thao tác là dữ liệu, không phải văn xuôi.** Bảng dưới đây là bản rút gọn; bản máy
đọc được là `docs/office/g0/module-runtime-map.json` (87 hàng capability; `runtime_selection_verdict` chỉ
`chosen: true` cho sáu chu trình đã nghiệm thu).

### Bảng runtime theo thao tác (từ DOC-004)

| Định dạng | Thao tác | Runtime | Trạng thái và bằng chứng |
| --- | --- | --- | --- |
| docx | mở + sửa chữ + renderer ghi + mở lại | trang host (renderer thật) + adapter tiêm | **proven** `E-DOCX-CYCLE` |
| docx | parse byte qua engine | worker (candidate) | blocked; bằng chứng engine có biên nằm trong `E-DOCX-CYCLE`; tên test ở map |
| docx | sửa bảng và ảnh | trang host (candidate) | blocked: chu trình đã nghiệm thu chỉ sửa đoạn văn; `E-DOCX-TABLE-SCOPED-CHROME/EDGE` chỉ là bằng chứng có biên; hàng của slice doc003-evidence (`F-DOCX-TABLE-IMG`, `F-DOCX-WATERMARK`) là hàng mở khoá |
| docx | convert / export | service nội bộ (candidate) | blocked; hành vi G0 là `unsupported_operation` (501) |
| xlsx | mở + sửa ô + tính lại + ghi + mở lại | trang host + **sidecar native trong service nội bộ** | **proven** `E-XLSX-CYCLE` (assertion `formula-recalculated-numeric` đạt trên host sidecar thật) |
| xlsx | convert external/CSV, export PDF | service nội bộ (candidate) | blocked; G0 trả 501 |
| pptx | mở + sửa chữ/ảnh/shape + ghi + mở lại | trang host + service engine riêng | **proven** `E-PPTX-CYCLE` (gesture shape cần channel đã khai `host:slides-edit-transform`) |
| pptx | render preview độc lập | trang host (candidate) | blocked: shaping font web chưa đo |
| pptx | export PDF | service nội bộ (candidate) | blocked; G0 trả 501 |
| pdf | thay chữ và ảnh có sẵn + ghi + mở lại | trang host + channel adapter tiêm | **proven** `E-PDF-TEXT-CYCLE` (thay text run, đổi ảnh trang 2, 8/8 assertion) |
| pdf | apply/verify chữ trong service | service nội bộ | **candidate có bằng chứng hỗ trợ** (không proven): probe in-memory trước register `main-pdf-text-probe.json` (E = D:/.Vietants_Project/uniwork-workspace/.uniwork-dev, tức `E/office-g0/main-pdf-text-probe.json`); **không có hàng register**; owner UNI-667 |
| pdf | serialize trong service | service nội bộ (candidate) | blocked: chưa có đường save sản phẩm |
| pdf | convert, OCR | service nội bộ | blocked; OCR ngoài phạm vi M1 theo Q2-A |
| md | mở + sửa + ghi + mở lại | trang host + host adapter, **không engine** | **proven** `E-MD-CYCLE` |
| md | export docx / pdf | service nội bộ | blocked; G0 trả 501 |
| html | mở + sửa + ghi + mở lại + preview cách ly | trang host + host adapter, preview ở origin cách ly | **proven** `E-HTML-CYCLE` (các assertion cách ly đạt) |
| html | convert sang docx, export PDF | service nội bộ | blocked; G0 trả 501 |

**5. Luật bao phủ: mỗi thao tác phải có runtime + hành vi khi chưa chứng minh.** Một thao tác chỉ được coi là "proven"
khi có hàng `E-*` được nghiệm thu; nếu không, nó phải có (a) runtime candidate cụ thể, (b) hành vi G0 từ chối tường
minh (`unsupported_operation` 501 hoặc refusal), và (c) tên test sẽ chứng minh. **Không** gọi candidate là "đã chọn", và
không suy runtime từ việc engine "có thể chạy" ở đâu đó.

**6. Sai khác so với mô hình ưu tiên INT-01 phải nêu, không che:**

1. XLSX recalculation là tiến trình native trong service nội bộ, không phải engine browser — luật 4 của INT-01 cấm suy
   diễn WASM; chu trình đã nghiệm thu tính lại qua host sidecar native.
2. Sửa ảnh có sẵn trong PDF bị ràng buộc Electron trong module upstream (`image-edit.ts` import `electron` ở module
   scope). Chu trình đã nghiệm thu chứng minh thao tác qua channel lab cộng thêm; sản phẩm cần adapter decode an toàn
   cho Node (G2) hoặc host desktop (G4).
3. PPTX chạy engine trên host service riêng (`runtime: engine-host-http`), và gesture shape cần một channel đã khai mà
   bridge đóng băng chưa implement; sản phẩm phải implement channel đó hoặc từ chối gesture tường minh.
4. Cách ly preview HTML là việc thật, không phải đổi tên: chu trình đã nghiệm thu cách ly trên origin không phải origin
   app (iframe sandbox không có `allow-same-origin`); việc re-home scheme cho desktop thuộc G4.
5. Markdown và HTML **không có engine**: editor giữ source, adapter chỉ làm I/O file.

**7. Phiên bản và fidelity đo riêng từng nơi chạy.** Mọi lần chạy ghi engine/adapter/protocol version; theme chrome
không đổi byte nội dung; nâng cấp upstream chạy lại fixture theo version và rollback không mất nháp.

### Quyết định của người dùng (không suy diễn)

| Mã | Nội dung | Nguồn |
| --- | --- | --- |
| Phạm vi 2026-09-16 | Sáu định dạng lõi DOCX/XLSX/PPTX/PDF/Markdown/HTML trong phạm vi, editor trên web và desktop, cùng danh tính/quyền/phiên bản/audit | spec G0 §1; plan G0 §1 |
| Q1-B | Pilot phải có toàn bộ năng lực upstream được kiểm kê/xác minh trên web và desktop; sáu chu trình cơ bản chỉ là mức tối thiểu | Q1-B |
| Q2-A | PDF sửa được nội dung có lớp chữ; OCR scan ở mốc sau | Q2-A |
| Q3-B (+ g115) | Windows/macOS; Chrome/Edge/Safari. Cổng G0 chỉ cần hàng trong trình duyệt nhúng Orca trên Windows; Mac/Safari hoãn sang UNI-671 | Q3-B; quyết định 2026-09-25 |
| Q4-A | Engine ở browser/worker hoặc hạ tầng nội bộ; không gửi file cho nhà cung cấp Office/OCR ngoài | Q4-A |
| Q5-A | Pilot sync online; thư viện offline và hàng đợi đầy đủ ở G5 trước M2 | Q5-A |
| Q6 | Nhóm triển khai tự xây bộ mẫu theo ma trận; mẫu doanh nghiệp là bổ sung | Q6 |
| Q7-B | Chuyển đổi mất mát phải cảnh báo và tạo Document bản sao theo lựa chọn chủ động; giữ bản gốc, lịch sử, quyền, nguồn gốc | Q7-B |
| Q8-A | Giữ nháp chưa sync theo tài khoản sau logout; khôi phục cần đúng tài khoản/quyền/base | Q8-A |
| Q9-A | Dải đo ban đầu chủ yếu dưới 50 MiB/file; không tự đổi trần/quota | Q9-A |
| BRAND-01 | Bề mặt sản phẩm là `UniWork Office` / `uniwork-office`; GenOffice chỉ còn là tên nguồn upstream | BRAND-01 |
| G0 = GO | Người dùng ghi nhận G0 đạt (2026-09-25) sau register GO và verifier GO 8/8 | `docs/office/g0/evidence-register.json`, `docs/office/g0/pilot-handoff.md` |

### Lựa chọn kỹ thuật có bằng chứng

| Lựa chọn | Bằng chứng |
| --- | --- |
| Editor ở trang host + adapter tiêm cho cả sáu định dạng | sáu hàng `E-*-CYCLE` đều chạy renderer/editor thật trong trang; adapter là đường duy nhất ra host |
| Markdown và HTML không có engine; chỉ host adapter I/O file | receipt `E-HTML-CYCLE` có `engine.operations: []`, `engine.host: null`; `E-MD-CYCLE` tương tự |
| XLSX recalc bằng tiến trình native trong service nội bộ | `E-XLSX-CYCLE`, assertion `formula-recalculated-numeric` |
| PPTX engine ở host service riêng + channel `host:slides-edit-transform` | `E-PPTX-CYCLE` (engine `runtime: engine-host-http`) |
| PDF text/ảnh qua adapter tiêm; ảnh phụ thuộc Electron ở upstream | `E-PDF-TEXT-CYCLE` 8/8 assertion; module `image-edit.ts` import `electron` |
| HTML preview trong iframe sandbox không `allow-same-origin` trên origin không phải origin app | `E-HTML-CYCLE`: `contentDocument` null, preview không đọc được localStorage của app, fetch tới API app bị từ chối, probe `F-HTML-SCRIPT` chạy trong sandbox |
| Cách ly cookie đòi **host** khác, không chỉ cổng khác | ghi chú đo được của `E-HTML-CYCLE`: cookie theo host, nên hai cổng trên cùng host **không** phải cách ly; bảo vệ thật là sandbox origin mờ |
| Grant engine có phạm vi/hết hạn; Go sở hữu commit, audit/outbox và sổ object mồ côi | DOC-004 §3/§8 (Advisor g119 nghiệm thu 4.3/4.4) |
| Thao tác chưa implement trả `unsupported_operation` (501)/refusal tường minh | `docs/office/g0/engine-contract.md` §4.5 + sáu hàng `E-DOC004-*` |

### Câu hỏi còn chặn

| # | Câu hỏi | Trạng thái sau DOC-004 | Owner |
| --- | --- | --- | --- |
| O-01 | Runtime cuối cùng cho từng định dạng/thao tác | **đã trả lời cho sáu chu trình editor** (bảng trên); mọi thao tác khác có runtime candidate + blocker + test | G1/G2/G3 |
| O-02 | Cách chạy engine Rust native ở phía server | **đã trả lời về hướng**: tiến trình/container native riêng cạnh service, chỉ Go gọi tới; triển khai sản phẩm là việc G2 | G2 UNI-658 |
| O-03 | PDF: engine nào sửa lớp chữ, giới hạn đã kiểm | **đã trả lời cho phạm vi đã nghiệm thu**: engine PDF pin qua adapter tiêm; giới hạn nằm trong hàng `E-PDF-TEXT-CYCLE`. Phần apply/verify trong service chỉ là candidate có bằng chứng hỗ trợ (probe trước register, không có hàng) | UNI-667 |
| O-04 | Hợp đồng login desktop và đơn vị version/xung đột | **đã có hợp đồng nghiệm thu ở mức G0** (`docs/office/g0/login-sync-contract.md` §2–§4.1); auth/device thật là việc G4 | G4 UNI-636 |
| O-05 | Giá trị app id / scheme / user-data namespace / update feed / keychain | **vẫn mở**: mọi giá trị chỉ là đề xuất trong `module-runtime-map.json` → `packaging_and_namespace`; không có giá trị ở commit pin | G4 UNI-636, G7 UNI-661 |
| O-06 | Đường asset tương đối cho HTML/Markdown trong sản phẩm | **vẫn mở**: chu trình đã nghiệm thu sao asset cạnh tài liệu đã lưu (lab); sản phẩm cần chính sách asset của Document | G3 UNI-659 |
| O-07 | Ngưỡng nghiệm thu đo được và ước lượng M1/M2 | **vẫn mở**: thuộc DOC-006 6.2/6.3 | DOC-006 UNI-670 |

## Hệ quả

- Sơ đồ triển khai vẫn nhiều hơn một runtime so với app thuần Go; đây là cái giá đã cân nhắc và chỉ được chấp nhận vì
  DOC-003/004 chứng minh cần thiết cho phần đã nghiệm thu.
- Bộ on-premise **phải** chứa runtime đã chọn (service nội bộ + các sidecar native), không chỉ một sidecar Node; thiếu
  runtime là lỗi phát hành, không phải giới hạn đã biết.
- Mệnh đề của 0018 "trình duyệt không đua sửa DOCX giữ nguyên định dạng" bị thay: web sửa được cả sáu định dạng ở mức
  ma trận Q1-B, và ràng buộc mới là **bằng chứng theo từng thao tác**, không phải định dạng nào được mở.
- Mỗi thao tác có hành vi G0 tường minh: từ chối rõ ràng thay vì giảm cấp im lặng.
- Nâng cấp upstream là quy trình có kiểm: chạy lại fixture theo engine/adapter/protocol version; rollback không mất nháp.
- Bản máy đọc được `docs/office/g0/module-runtime-map.json` là phần của cùng quyết định này: bản cập nhật theo DOC-004 **phải được tích hợp cùng ADR 0021** (Advisor, `INTEGRATION-TODO-g119.md` mục 3-4). Ở HEAD trước bước tích hợp, bản canonical của map vẫn giữ `runtime_selection_verdict.chosen: false` (bản trước g119); bản `chosen: true` của DOC-004 (sáu hàng `E-*-CYCLE`, xlsx recalc ở sidecar native) chưa được tích hợp.
- Nhóm G1–G4 nhận editor theo runtime trong bảng này; `docs/office/g0/engine-contract.md` §9–§11 là hợp đồng bàn giao và
  `docs/office/g0/login-sync-contract.md` là hợp đồng login/sync/phiên bản. Tài liệu này không hứa tích hợp sản phẩm.

## Test giữ luật (đề xuất; số/đường dẫn chốt khi G1/G2 land)

- Arch test: chỉ adapter Office gọi tới engine service; engine service không import gói nghiệp vụ và không đọc bảng
  nghiệp vụ.
- Test: credential engine không xuất hiện trong bundle client.
- CI bộ cài E-01: runtime được chọn có mặt trong compose và Helm.
- CI bản fork: không tồn tại đường dẫn `/ee`; `LICENSE`/`NOTICE` khớp upstream pin.
- Fixture: chạy lại theo engine/adapter/protocol version khi nâng upstream.

Các guard này **chưa tồn tại**; chúng land cùng G1/G2. Cho đến đó, ADR này không thêm luật vào `CLAUDE.md` (chưa có tên
test để trỏ tới) — cùng cách xử lý với ADR 0008/0010 đang chờ guard.

## Trạng thái

`accepted` (2026-09-25). Thay thế 0018: 0018 đã chuyển sang `superseded by 0021` và nội dung lịch sử của nó giữ nguyên.
`docs/adr/README.md` đã có dòng chỉ mục 0021; bản nháp `drafts/documents-office-runtime.md` đã được chuyển thành tài liệu
này nên `drafts/` không còn bản nháp nào.

Runtime candidate **không** được gọi là "đã chọn"; mọi thao tác chưa chứng minh vẫn giữ blocker + tên test trong
`docs/office/g0/module-runtime-map.json`. Phần tích hợp sản phẩm (G1–G7) không thuộc tài liệu này.
