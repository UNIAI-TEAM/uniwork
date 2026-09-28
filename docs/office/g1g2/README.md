# Đầu vào G1-G2 lấy từ G0

> **Trạng thái:** tài liệu tham chiếu cho G1 (UNI-657) và G2 (UNI-658), 2026-09-26. Không phải bằng chứng
> nghiệm thu mới; register G0 (`docs/office/g0/evidence-register.json`) vẫn là nguồn của quyết định G0 = GO.

`docs/office/g0/handoff-map.md` §2 và ADR 0021 trỏ tới một số file chỉ có trong thư mục chạy G0
(`.uniwork-dev/orca-recovery-g119/…`, ngoài git). Thư mục này giữ bản sao của những file G1/G2 cần để
nhận việc, cộng một ghi chú đối chiếu FS-C1. Mỗi bản sao có dòng đầu ghi đường nguồn và sha256; phần còn
lại giữ nguyên văn, kể cả câu đã lỗi thời (bảng dưới nói câu nào).

## Tệp trong thư mục

| Tệp | Nguồn ngoài git | Dùng cho |
| --- | --- | --- |
| [runtime-conclusion.md](runtime-conclusion.md) | `doc004-runtime/RUNTIME-CONCLUSION.md` | G2: runtime theo thao tác, năm sai khác INT-01 |
| [packaging-and-handoff.md](packaging-and-handoff.md) | `doc004-runtime/PACKAGING-AND-HANDOFF.md` | G2: ma trận đóng gói, version negotiation, identity đề xuất, clean-checkout §5b |
| [q7-blocker.md](q7-blocker.md) | `doc003-evidence/r2/Q7-BLOCKER.md` | G2-02/G2-07: engine chuyển đổi chưa có, closing test |
| [port-items.md](port-items.md) | `doc003-evidence/r2/PORT-ITEMS.md` | G2-03 (P3 nửa adapter, P5); G3 (P1-P4); DOC-002 (F1) |
| [root-cause.md](root-cause.md) | `doc003-evidence/r2/ROOT-CAUSE.md` | Nguyên nhân D1-D6 mà q7-blocker và port-items trích |
| [fs-c1-alignment.md](fs-c1-alignment.md) | viết mới | Đối chiếu tài liệu G0 với FS-C1 (phần tài liệu của UNI-748) |

## Tên cũ → tên trong repo

| Tên trong bản sao / handoff-map | Trong repo |
| --- | --- |
| `r2/THRESHOLDS.md` (DOC-006 6.2) | [`docs/office/g0/acceptance-thresholds.md`](../g0/acceptance-thresholds.md) |
| `r2/HANDOFF-MAP.md` | [`docs/office/g0/handoff-map.md`](../g0/handoff-map.md) |
| `ESTIMATE-M1-M2` r2 | [`docs/office/g0/m1-m2-estimate.md`](../g0/m1-m2-estimate.md) |
| `CANDIDATE-module-runtime-map.g119.json` | [`docs/office/g0/module-runtime-map.json`](../g0/module-runtime-map.json) |
| `docs/adr/drafts/documents-office-runtime.md` | [ADR 0021](../../adr/0021-runtime-engine-office-da-dinh-dang.md) (accepted 2026-09-25) |
| `RUNTIME-CONCLUSION.md`, `PACKAGING-AND-HANDOFF.md`, `Q7-BLOCKER.md`, `PORT-ITEMS.md` | các tệp cùng tên chữ thường ở thư mục này |

## Câu đã lỗi thời trong các bản sao

- "Candidate for M; canonical files stay read-only": các file G0 đã tích hợp vào develop ở `c6b567f0` (PR #130).
- "Go owns … the orphan-object ledger", "G1 (store, … orphan ledger and reconciler)", "store and ledger exist
  before the engine writes": theo FS-C1 §5.7 và ADR 0024 (accepted 2026-09-27), blob, intent upload và
  GC thuộc FileService. Documents chỉ giữ `file_id`, gọi `ClaimInTx`/`ReleaseInTx` và cung cấp
  `ReferenceProvider`. Chi tiết: [fs-c1-alignment.md](fs-c1-alignment.md).
- "Proposed layout (owner G2 UNI-658)": layout là quyết định U-1 của người dùng
  (plan G1-G2 §1.3, §3.2).
- `runtime-conclusion.md` §4 "O-05 ADR number": ADR đã mang số 0021.

## Dòng trạng thái cũ trong file G0 bị pin

`docs/office/g0/engine-contract.md` vẫn ghi "in-progress (G0, chưa shipped) · Ngày 2026-09-17", và §14 ghi "All
`runtime_chosen` fields remain false". Cả hai đúng ở thời điểm viết, nay đã cũ: G0 kết thúc với G0 = GO và
`module-runtime-map.json` có `runtime_selection_verdict.chosen: true` cho sáu chu trình lõi (xem `status_note`
trong file đó). File bị pin sha256 nên không sửa; đọc kèm ghi chú này và [fs-c1-alignment.md](fs-c1-alignment.md).

## Còn ngoài git, cố ý

Receipt, cây lab (`lab/labroot-*`), ảnh chụp và báo cáo Tester của các slice g119 vẫn ở thư mục chạy
G0; register và các file RT02 đã pin bằng sha256 những gì cần kiểm lại. `candidates/browser-proof.md`
(DOC-003 r1) không chép: các hàng FAIL của nó đã được r2 giải thích trong `root-cause.md`, và hàng được
nghiệm thu nằm trong register. `doc001-adr/COORDINATOR-SYNC.md` không chép: dòng G1-G7 đã được ghi vào
UNI-635/636/657/658/659/660/661 ngày 2026-09-26.
