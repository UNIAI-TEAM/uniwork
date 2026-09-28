# Đối chiếu tài liệu G0 với hợp đồng FileService FS-C1

> **Trạng thái:** ghi chú bổ sung, 2026-09-26 (UNI-657; phần tài liệu của UNI-748); có hiệu lực cùng ADR 0024
> (accepted 2026-09-27). Không sửa bằng chứng G0.
> **Cập nhật 2026-09-27:** UNI-748 (PR #133, merge vào nhánh G1-G2 ở `0fba24a0`) đã sửa trực tiếp
> `engine-contract.md` §1/§8.3/§8.4/§11/§13 (kèm cập nhật pin) và `login-sync-contract.md` §6. Các hàng
> `engine-contract.md` trong bảng dưới nay là lịch sử; `module-runtime-map.json` (`g1_g2_handoff`,
> `ownership_map`) và oracle §12 vẫn đọc theo bảng này.

## Vì sao là ghi chú riêng

Tài liệu G0 viết trước FS-C1 nên giao cho G1 một "orphan-object ledger" và một reconciler của riêng
Documents. [FS-C1](../../superpowers/specs/2026-09-24-file-service-contract.md) §5.7 cấm đúng việc đó:
module không xóa bytes, không gọi `internal/storage` cho file mới, không tự dựng cleanup worker hay
ledger cho object. [ADR 0024](../../adr/0024-fileservice-so-huu-blob-intent-gc.md) (accepted 2026-09-27) ghi
quyết định ở tầng kiến trúc; ghi chú này chỉ ra từng câu G0 bị thay.

`docs/office/g0/engine-contract.md`, `engine-contract-lab-runtime.md`, `engine-contract-adapter-checksum.md`
và các `RT02-*.json` được pin sha256 trong `evidence-register.json`/`module-runtime-map.json`. Sửa chúng sẽ
đổi pin của bằng chứng đã nghiệm thu, nên ghi chú này đứng cạnh thay vì sửa. Những file G0 không bị pin
(`handoff-map.md`, `m1-m2-estimate.md`, `login-sync-contract.md`) được sửa tại chỗ và trỏ về đây.

## Ai giữ việc gì sau FS-C1

| Việc | Trước (G0) | Sau (FS-C1 + ADR 0024) |
| --- | --- | --- |
| Ghi ý định trước khi object tồn tại | Ledger của Go/Documents, trạng thái `intended/stored/committed/orphaned/deleted` | FileService: hàng `files` + upload session, trạng thái `pending/processing/ready/failed/deleting/deleted` |
| Byte của upload người dùng | Documents dựng key, ghi object trước rồi ghi row | `files.Service.Upload` (stream, đo byte thật, checksum bắt buộc với purpose Documents) |
| Byte do engine sinh ra | Engine ghi object tạm, Go kiểm rồi ghi object bất biến | `RegisterProviderOutput` cấp `file_id` + write target trước khi job chạy; `CompleteProviderOutput` kiểm Stat/size/MIME/checksum |
| Gắn byte vào version | Commit đổi con trỏ sang `object_key` | `ClaimInTx` trong transaction commit của Documents, cùng audit/outbox/idempotency |
| Gỡ tham chiếu (purge, asset hết giữ) | Purger xóa row rồi `DeleteKeys`, lỗi → outbox `storage.delete_requested` | `ReleaseInTx` trong cùng transaction gỡ tham chiếu; không xóa byte |
| Quyết định xóa byte | Reconciler của Documents, `Storage.DeleteObject` | GC FileService, sau khi mọi `ReferenceProvider` (có `documents.*`) trả không còn giữ |
| Thời hạn giữ (asset mồ côi 7 ngày, purge 30 ngày) | Tham số của reconciler | Policy của Documents, thể hiện qua `HeldBy` còn trả `retention` hay không (FS-C1 §6) |
| Metric xóa lỗi | `office_orphan_delete_failures_total` | Metric của FileService; Documents không đếm lại |
| Dọn temp tree/process của engine sau cancel/timeout | G2 | G2 (không đổi): đây là tài nguyên của process, không phải object storage |

## Câu bị thay, theo vị trí

| Vị trí (revision `c6b567f0`) | Câu G0 | Đọc thành |
| --- | --- | --- |
| `engine-contract.md` §1, hàng "Object tạm, object mồ côi, retry cleanup" | "Chốt ledger, TTL, chủ sở hữu, `Storage.DeleteObject`; G1/G2 triển khai reconciler" | FileService giữ intent, TTL claim 24 giờ và GC; G1 giao `ReferenceProvider` + `ReleaseInTx`; G2 dùng provider output |
| `engine-contract.md` §7 (restart, job completed) và §8.1 | "object tạm vào ledger mồ côi", "state được nạp lại từ ledger" | Trạng thái job nạp lại từ `office_jobs` (Go, G2-02); trạng thái byte từ FileService (`file_id` của provider output) |
| `engine-contract.md` §8.2-§8.4 (write-ahead + reconcile, orphan ledger, `DeleteObject`) | Ledger do Go sở hữu, reconciler retry xóa | Mẫu write-ahead giữ nguyên ý nhưng nằm trong FileService (intent trước put); Documents không có bảng ledger, không có worker xóa |
| `engine-contract.md` §11, hàng G1 và câu "store + ledger có trước khi engine ghi vào" | "Kho Documents, transaction commit, audit/outbox, ledger mồ côi + reconciler" | "Kho Documents, transaction commit, audit/outbox, `ReferenceProvider`"; thứ tự: FS-C1 T1a (code) và FileService Gate C (nghiệm thu) có trước khi engine ghi vào |
| `engine-contract.md` §12, oracle `db-rollback-leaves-orphan`, `cleanup-delete-error-surfaced`, `output-length-off-by-one` | "ledger `orphaned`", `attempts`, `last_error` | Bằng chứng model G0 giữ nguyên (bị pin). Ở sản phẩm: file ở trạng thái staged/chưa claim, GC FileService dọn sau hạn; test tương ứng là `TestDocumentCommit`/`TestDocumentReferences` của G1-03 |
| `engine-contract.md` §13 bước 2 | "G1 viết migration `payload_fingerprint` + ledger mồ côi; hợp nhất tên mã lỗi" | "G1 viết migration `payload_fingerprint`; hợp nhất tên mã lỗi thành `idempotency_payload_mismatch`" |
| `engine-contract.md` §15 | "let Go write the immutable object before a database transaction"; `server/internal/service/documents/` giữ "orphan cleanup authority" | FileService ghi object (upload hoặc provider output) ngoài transaction; Documents `ClaimInTx` trong transaction. Không ai trong Documents giữ quyền xóa byte. Layout là quyết định U-1 |
| `module-runtime-map.json` `g1_g2_handoff`/`ownership_map` (dòng 1144, 1333, 1343) | "orphan ledger and cleanup reconciler", "G1 reconciles service-owned staged objects/orphan ledger" | Như hàng §11 ở trên. File không bị pin sha256; giữ nguyên để tránh đổi bản máy đọc được mà ADR 0021 trích, sửa cùng lượt dọn trạng thái G0 |
| `handoff-map.md` §2 G1 (Receives, Acceptance criteria) | "the orphan-object ledger has a reconciler" | Đã sửa tại chỗ, trỏ về đây |
| `m1-m2-estimate.md` R5, §3, §5, §6 | "orphan ledger + reconciler" | Đã sửa tại chỗ, trỏ về đây |
| `runtime-conclusion.md`, `packaging-and-handoff.md` (bản sao ở thư mục này) | "Go owns … the orphan-object ledger" | Xem README của thư mục |
| ADR 0021 QĐ3 và bảng "Lựa chọn kỹ thuật" | "Go sở hữu … sổ object mồ côi" | ADR 0024 (accepted 2026-09-27) thay phần này |
| Spec G0 §9.2 bước 4 | "xử lý object mồ côi riêng" | Vẫn đúng: "riêng" nghĩa là ngoài transaction commit, do FileService |

## Mã lỗi `quota_exceeded`

DOC-005 (`login-sync-contract.md` §3, §4, §4.1) ghi `quota_exceeded` là 413, theo model JS
`scripts/office-g0/run-contracts.mjs`. Code sản phẩm trả 403 (`server/internal/service/entitlement.go`),
FS-C1 §7 giữ 403, và plan G1-G2 §3.3 không đổi mã hiện có. Sản phẩm dùng 403; con số 413 chỉ là giá trị của
model G0. `login-sync-contract.md` ghi đính chính tại §8.3. Harness G0 không sửa (bị pin qua register).

## Phạm vi bàn giao trong handoff-map

- Change feed, cursor ký, retention và tombstone là của G5 (DOC-005 §9, bước 4 của §9.1), không phải G1.
  G1 chỉ nhận bước 1-3 (error class, cột fingerprint, bật mismatch). `handoff-map.md` §2 G1 đã sửa.
- "Open decisions: none" cho G1 không còn đúng: U-2 (ADR 0024), U-3 (C-01 §14) và hình dạng API save
  (chốt trong C-01 §14) phải có câu trả lời trước G1-01/G1-03.
