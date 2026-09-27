# 0022 — FileService sở hữu byte, ý định upload và dọn rác của Documents; Documents chỉ giữ `file_id`

**Trạng thái:** accepted (2026-09-27, người dùng chấp nhận U-2 trong plan G1-G2) — thay phần "Go sở hữu … sổ object
mồ côi" trong Quyết định 3 của [0021](0021-runtime-engine-office-da-dinh-dang.md); phần còn lại của 0021 giữ nguyên.
**Issue:** UNI-657 (G1) · **Liên quan:** UNI-658 (G2), UNI-726/UNI-739 (FileService, FS-C1), UNI-748 (G0 chuyển sang
FileService), UNI-668 (DOC-004).
**Nguồn:** [hợp đồng FS-C1](../superpowers/specs/2026-09-24-file-service-contract.md) §4-§7;
[spec FileService](../superpowers/specs/2026-09-22-shared-file-service-design.md) §12-§14;
[plan G1-G2](../superpowers/plans/2026-09-18-documents-office-g1-g2.md) §3.1, G1-03, G1-04.

---

## Bối cảnh

ADR 0021 (accepted 2026-09-25) chốt runtime cho UniWork Office. Quyết định 3 của nó viết: engine không có tài khoản,
ACL hay kho phiên bản và không ghi bảng nghiệp vụ; **Go sở hữu** auth, ACL, quota, idempotency, commit phiên bản–audit–
outbox **và sổ object mồ côi**. Câu cuối đến từ DOC-004 (`docs/office/g0/engine-contract.md` §8.3): một ledger trong DB
do Go giữ, ghi ý định trước khi object tồn tại, có trạng thái `intended/stored/committed/orphaned/deleted` và một
reconciler gọi `Storage.DeleteObject` để dọn.

Ngày 2026-09-24, trước khi G0 kết thúc, người dùng chốt FileService (UNI-726) là pipeline file chung cho mọi module, và
chốt quy tắc "hợp đồng trước, implement sau". Hợp đồng FS-C1 cho module tiêu thụ nói ngược với câu trên:

- §5.7: module không xóa bytes, không gọi `internal/storage` cho file mới, **không tự dựng cleanup worker hay ledger
  cho object**.
- §4: FileService có `Upload`, `ClaimInTx`/`ReleaseInTx` (chạy trong transaction của module), `Open` cho route proxy,
  `RegisterProviderOutput`/`CompleteProviderOutput` cho writer ngoài như Office engine.
- §6: mỗi bảng giữ `file_id` có `ReferenceProvider`; GC FileService hỏi mọi provider trước khi xóa, và provider lỗi
  thì GC dừng batch.
- §3: policy purpose `document_file`/`document_asset` (50 MiB, 10 MiB, checksum bắt buộc, đọc bằng proxy).

Spec FileService §12 mục 1 hứa một ADR "FileService là hạ tầng metadata/bytes" cho toàn repo; ADR đó chưa có. Trong lúc
đó, tài liệu G0 đã merge vẫn giao "orphan ledger + reconciler" cho G1 ở nhiều chỗ (engine-contract §1/§8.3/§11/§13,
`module-runtime-map.json`, handoff-map, m1-m2-estimate) và ADR 0021 là tài liệu có hiệu lực. Người nhận G1 đọc hai
nguồn nói hai điều khác nhau về cùng một bảng.

Hai lựa chọn khác đã cân nhắc và bỏ:

1. **Giữ ledger của Documents cạnh FileService.** Hai hệ cùng quyết định xóa một object — đúng điều spec FileService
   §13 cấm ("không hai worker cùng giữ quyền quyết định xóa một object") và là nguồn của lỗi xóa sớm byte đã commit.
2. **Sửa thẳng ADR 0021.** ADR đã accepted không sửa (README ADR); đổi ý thì viết ADR mới.

## Quyết định

**1. Byte, ý định upload và dọn rác của Documents/Office thuộc FileService.** Documents không có bảng ledger object,
không có reconciler, không gọi `internal/storage` và không xóa byte. Phần "sổ object mồ côi" trong Quyết định 3 của
ADR 0021 được thay bằng quyết định này; phần còn lại của Quyết định 3 giữ nguyên (engine nhận grant có phạm vi và hạn,
không có tài khoản/ACL/kho phiên bản, không ghi bảng nghiệp vụ; Go giữ auth, ACL, quota, idempotency, commit
phiên bản–audit–outbox).

**2. Documents giữ `file_id`, không giữ vị trí lưu.** `document_versions` và `document_assets` lưu `file_id` (TEXT,
không FK, theo ADR 0001/0002). Không có `object_key`, bucket, URL ký hay URL blob trong bảng hoặc trong nội dung trang
(`asset://{id}` trỏ tới asset, asset trỏ tới `file_id`).

**3. Gắn và gỡ tham chiếu chạy trong transaction nghiệp vụ của Documents.** Commit phiên bản gọi `ClaimInTx` cùng
transaction với insert version, đổi con trỏ, audit, outbox và phản hồi idempotency (ADR 0009). Purge, compaction và
asset hết hạn giữ gọi `ReleaseInTx` trong transaction gỡ tham chiếu. Thứ tự khóa theo FS-C1 §5.4.

**4. Documents quyết thời hạn giữ; FileService quyết lúc xóa.** Documents đăng ký `ReferenceProvider` (tên dạng
`documents.versions`, `documents.assets`) trả hold cho phiên bản hiện hành và cũ, tài liệu archive/soft delete chưa
purge, asset còn trong nội dung hoặc còn trong 7 ngày giữ. Purge 30 ngày và giữ asset 7 ngày là policy của Documents,
thể hiện qua việc provider còn trả `retention` hay không (FS-C1 §6). Registry FileService chỉ bật purpose Documents khi
provider này qua test ở G1-03.

**5. Output của engine đi qua FileService.** Go gọi `RegisterProviderOutput` trước khi dispatch job để có `file_id` và
write target đúng một object và hạn; engine ghi vào đó, không nhận key hay credential. `CompleteProviderOutput` kiểm
Stat/size/MIME/checksum rồi đưa file vào trạng thái sẵn sàng để commit bằng `ClaimInTx`. Job hủy hoặc hết hạn để lại
file chưa claim; GC FileService dọn theo lịch chung. Dọn temp tree và process của engine vẫn là việc G2.

**6. Documents đọc byte bằng proxy.** Download, version download, asset và public link stream qua route Go của
Documents gọi `files.Service.Open` sau khi kiểm quyền; không presign byte tài liệu. Thu quyền chặn ngay lần đọc kế tiếp.

### Đính chính cho 0021 (không sửa file 0021)

| Chỗ trong 0021 | Đọc thành |
| --- | --- |
| QĐ3 "… và sổ object mồ côi"; bảng "Lựa chọn kỹ thuật", hàng "Grant engine … Go sở hữu commit, audit/outbox và sổ object mồ côi" | Go sở hữu commit, audit/outbox; byte, intent và GC thuộc FileService (ADR này) |
| Dòng "Bằng chứng" và bảng "Lựa chọn kỹ thuật" nhắc `RUNTIME-CONCLUSION.md` của slice doc004-runtime | Bản trong git: `docs/office/g1g2/runtime-conclusion.md` |
| Bảng runtime, hàng `pdf` apply/verify: đường tuyệt đối `D:/…/.uniwork-dev` và `E/office-g0/main-pdf-text-probe.json` | Probe nằm trong thư mục bằng chứng G0 ngoài git; đường tuyệt đối không có nghĩa trên máy khác. Hàng vẫn là candidate, không có hàng register |
| "Câu hỏi còn chặn" O-07 "vẫn mở: thuộc DOC-006 6.2/6.3" | DOC-006 đã giao `docs/office/g0/acceptance-thresholds.md` và `docs/office/g0/m1-m2-estimate.md`; ngưỡng CPU/RAM, save và fixture lớn vẫn `chua do`, ước lượng vẫn là giả định có nhãn. G2-02 đo tài nguyên |
| "Hệ quả": map DOC-004 "chưa được tích hợp", canonical vẫn `chosen: false` | Đã tích hợp ở develop `c6b567f0`: `runtime_selection_verdict.chosen` là `true` cho sáu chu trình; `docs/office/g0/engine-contract.md` §14 còn câu "All `runtime_chosen` fields remain false" nói về hàng RT-02 trước đó |

## Hệ quả

- G1 không có bảng `document_objects`, không có worker dọn object; G1-03 giao `ReferenceProvider` và các test ba lớp
  của FS-C1 §8.1 thay vào đó. G1-03 phụ thuộc FS-C1 T1a (UNI-739) đã merge vào develop để code, và FileService Gate C
  để nghiệm thu.
- Có thêm một phụ thuộc giữa hai đội: đổi chữ ký, trạng thái hay mã lỗi của FS-C1 phải tăng version, cập nhật fake và
  contract test, rồi báo Documents (FS-C1 §9). Documents không tự vá fake.
- Quyền, phiên bản, lịch sử, nhật ký truy cập và quota nghiệp vụ vẫn ở Documents; FileService không có membership
  (FS-C1 §5.1). Document vẫn là kho duy nhất của Work Product (ADR 0016).
- Bằng chứng model G0 (ledger trong `scripts/office-g0/engine-contract*.mjs`, oracle "ledger `orphaned`") giữ nguyên
  vì đã pin; `docs/office/g1g2/fs-c1-alignment.md` ghi câu nào của G0 bị thay và test sản phẩm nào thay oracle nào.
- Quota: một `file_id` tính một lần trong tổ chức dù nhiều phiên bản trỏ tới (FileService T1-Q9); `quota_exceeded`
  giữ 403.
- Nếu ADR chung của FileService (spec FileService §12 mục 1) ra sau và bao trùm quyết định này, ADR này được đánh dấu
  `superseded by NNNN`, không viết lại.

## Test giữ luật

Đã có (land cùng FileService, PR #133):

- `TestFilesContractIsALeafCalledOnlyFromTheServiceTier` (`server/internal/arch_test.go`): chỉ `internal/service` gọi
  `files.Service`; `internal/files` là lá.
- `TestEveryFileIDColumnHasAReferenceSource` (`server/internal/service/file_references_test.go`): mọi cột `file_id` có
  nguồn tham chiếu và provider.

Đề xuất, tên chốt khi G1 land:
- Migration lint hoặc test schema: không bảng nghiệp vụ Documents nào có cột `object_key`/`bucket`/URL.
- Test G1-03: purpose Documents bị registry thật từ chối khi thiếu `ReferenceProvider`; GC không xóa byte của phiên bản
  cũ, tài liệu archive chưa purge và asset còn trong thời gian giữ.

Khi hai guard đề xuất có tên, thêm luật vào `CLAUDE.md` trỏ tới cả bốn test (cùng cách xử lý với 0008/0010/0021).

## Trạng thái

`accepted` (2026-09-27). Đề xuất ngày 2026-09-26 ở `docs/adr/drafts/`; người dùng chấp nhận U-2 ngày 2026-09-27. ADR chung
của FileService lấy số 0023 và giữ phạm vi riêng (tenant file, ngoại lệ avatar).
