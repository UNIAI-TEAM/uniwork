# DOC-004 — Hợp đồng engine, editor và storage

> **Trạng thái:** in-progress (G0, chưa shipped) · **Issue:** UNI-668 · **Parent:** UNI-656 ·
> **Roadmap:** C-01 · **Ngày:** 2026-09-17.
> **Spec:** [Documents + UniWork Office G0](../../superpowers/specs/2026-09-16-documents-office-g0-design.md) §8;
> **Plan:** [G0 task 4](../../superpowers/plans/2026-09-16-documents-office-g0.md).
> **Bản đồ runtime:** [`module-runtime-map.json`](module-runtime-map.json).
> **Harness:** `scripts/office-g0/engine-contract.mjs` + `engine-contract.test.mjs`.
> **Adapter thật (task 4.4):** `scripts/office-g0/engine-contract-adapter.mjs` (§12.3).
> **Brand:** [`uniwork-office-integration-brand.md`](uniwork-office-integration-brand.md) (BRAND-01).

Tài liệu này chốt hợp đồng giữa **Go service** (auth, ACL, quota, version, audit, outbox)
và **Office Engine Service nội bộ** (parse, serialize, render, convert), cùng contract
commit/cleanup, quyền của job, đóng gói và nâng phiên bản. Nó **không** triển khai
service sản phẩm và **không** chứng nhận tenant isolation hay packaging — các phần đó
thuộc G1/G2/G4/G7. Harness adapter thật ở `scripts/office-g0/engine-contract-adapter.mjs`
(§12.3) là **con trỏ loopback** tới host DOC-003 cho task 4.4, **không** phải wiring sản phẩm.

---

## 1. Ranh giới và mức bằng chứng

| Hạng mục | Trong G0 (tài liệu này) | Thuộc giai đoạn sau |
| --- | --- | --- |
| Capability/open/edit/serialize/convert/export/cancel | Chốt wire, state machine, oracle từng ca | G2 (UNI-658) nối engine thật, G3 nối editor |
| Commit/version/audit/outbox | Chốt thứ tự và chủ sở hữu; Go giữ toàn quyền quyết | G1 (UNI-657) kho Documents thật |
| Object tạm, object mồ côi, retry cleanup | Chốt ledger, TTL, chủ sở hữu, `Storage.DeleteObject` | G1/G2 triển khai reconciler |
| Job grant có phạm vi và hạn | Chốt hình dạng grant và kiểm tra | G2 phát hành grant thật từ Go |
| Đóng gói service, native sidecar, packaging desktop | Chốt quyết định và owner | G2/G4/G7 dựng thật, có bằng chứng |
| Runtime theo định dạng | Ma trận có mức bằng chứng từng thao tác | G2/G3 khi có proof adapter thật |

### 1.1 Mức bằng chứng (đọc trước khi trích dẫn)

`engine-contract.mjs` là **model tham chiếu của ranh giới**, không phải engine: nó
chạy trên Node, kiểm wire/state/ledger bằng fake được khai báo, và **không** chạy
engine GenOffice nào. `EVIDENCE_REGISTRY` trong script tách hai loại bằng chứng:

| Loại | Nghĩa | Ví dụ trong G0 |
| --- | --- | --- |
| `reference_test` | Model chạy được, kiểm hợp đồng; **không** chứng minh engine thật | Toàn bộ bảng ca của `engine-contract.mjs` |
| `real_engine_evidence` | Có lần chạy engine/adapter thật, lệnh và artifact ghi lại | `engine-contract-adapter.mjs` chạy 11 ca trên **host DOC-003 thật** qua loopback (task 4.4) — xem §12.3 |

`EVIDENCE_REGISTRY.real_engine_evidence.status` nay là `present`, nhưng đó là một **con trỏ**,
không phải một "pass": nó trỏ tới lần chạy adapter thật, và nó **không** nâng bất kỳ ca model
nào trong `engine-contract.mjs`. Vì vậy: **không** được nói model đã kiểm adapter thật; không
nói sáu luồng browser DOC-003 đã được nghiệm thu trọn vẹn (chúng vẫn `pending` và do UNI-667 sở hữu). Các chu kỳ editor phạm vi hẹp nằm ở `scoped_editor_cycles` trong `module-runtime-map.json`; chúng không chọn runtime
(`runtime_chosen: false`; một hàng `proven` — hiện là `pdf/edit_text` — **không** phải
một runtime đã chọn — xem `module-runtime-map.json`). Bằng chứng adapter chỉ chứng minh transport loopback và các thao tác
docx/pdf/pptx thật nêu ở §12.3 và fault canonical ở §12.4, **không** chứng minh Go service, ACL/tenancy, object storage,
packaging hay sáu luồng browser.

Sáu ca fault canonical của task 4.4 (type/version, checksum, timeout, cancel/complete,
crash/restart, metadata khi engine chết) đã được nghiệm thu **ở ranh giới tham chiếu**
— xem §12.4. Điều đó bác câu “mọi bằng chứng adapter đều còn thiếu”. Nó **không** chọn
runtime, **không** thêm hàng `proven` thứ hai, và **không** biến các ca model thành bằng
chứng engine.

### 1.2 Điều đã kiểm bằng cách đọc source ở commit pin

| Điều | Nguồn | Mức |
| --- | --- | --- |
| `parseDocx`, `saveDocx` | `packages/docx-engine/src/index.ts` | `source_read` |
| `openPptx`, `savePptx` | `packages/pptx-engine/src/index.ts:632,674` | `source_read` |
| `runTxn(opened, req)`, payload `op: 'setText'` | `packages/pptx-ops/src/ops/executor.ts:160`, `ops/text-ops.ts:138` | `source_read` |
| `applyCellEditsToXlsx`, `writeXlsxAtomically` | `packages/xlsx-gateway/src/gateway/xlsx-gateway.ts:579,1766` | `source_read` |
| `XlsxSidecarClient`, `recalcCells`, `PROTOCOL_VERSION = 1` | `apps/sheets/src/main/xlsx-sidecar-client.ts:34,126,4` | `source_read` |
| `applyTextEdits`, `verifyTextEdits`, `validateTextEdits` | `apps/pdf/src/main/text-edit.ts:2017,2438,2173` | `source_read` |
| `savePdfToPath`, `applySaveRequest`, `writePdfAtomically` | `apps/pdf/src/main/save-pdf.ts:839,863`, `atomic-write.ts:7` | `source_read` |
| `image-edit.ts` imports Electron `nativeImage` at module scope | `apps/pdf/src/main/image-edit.ts:1` | `source_read` |
| `getPreviewInfo() → { url: html-preview://… }` | `apps/html/src/main/preview-document.ts:37` | `source_read` |
| `Storage.DeleteObject(ctx, key) error` (lỗi được nêu, không bị che) | `server/internal/storage/storage.go:14-16` | `source_read` |

Các dòng trên chứng minh **symbol tồn tại**, không chứng minh hành vi. Không có dòng
nào là `proven`.

---

## 2. Chủ sở hữu dữ liệu (không thương lượng)

| Chủ sở hữu | Giữ | Tuyệt đối không giữ |
| --- | --- | --- |
| **Go service** | auth, ACL, quota, đơn vị version, commit đầu mối `documents.current_version_id`, audit, outbox | — |
| **Documents (kho duy nhất)** | định danh, byte đã commit, lịch sử, quyền, nhật ký | — |
| **Office Engine Service** | input được cấp phạm vi, output byte, cảnh báo fidelity, lỗi có kiểu | tài khoản riêng, ACL riêng, kho phiên bản riêng, bảng nghiệp vụ, feed chia sẻ riêng |
| **Browser/desktop client** | bản nháp, chrome, trạng thái editor | token service, khoá storage riêng, credential engine |

Ba bất biến:

1. **Engine không ghi bảng nghiệp vụ.** Engine trả byte + metadata; chỉ Go ghi
   `documents`, `document_versions`, `audit_events`, `outbox_events`. Bất biến này
   song song với ADR 0010 (agent runtime không ghi bảng nghiệp vụ).
2. **Engine không quyết người dùng xem được gì.** Engine nhận byte đã được Go cho
   phép đọc; nó không biết tài khoản/quyền ngoài phạm vi job.
3. **Client không bao giờ thấy đường dẫn, khoá storage riêng hay credential service.**
   API browser chỉ có id và byte/JSON; desktop path và file handle ở lại host.

---

## 3. Job grant: quyền có phạm vi và hết hạn

Go phát hành cho mỗi job một **grant** ngắn hạn thay vì để engine đọc kho trực tiếp.

```text
grant {
  grant_id            ULID
  actor_id            ULID        # người khởi tạo, không phải engine
  workspace_id        ULID
  document_id         ULID
  organization_id     ULID
  operation           capability | open | edit | serialize | convert | export
  scope               đọc | ghi-nhánh-mới   # không bao giờ là ghi-đè-bản-đã-commit
  base_revision       số nguyên      # nền mà job này thao tác lên
  base_version_id     ULID          # blob version nền
  input_object_key    khoá storage riêng, engine đọc trực tiếp từ kho nội bộ
  expires_at          mốc ISO-8601, TTL ngắn (mặc định 5 phút, tối đa theo deadline)
  single_use          true
  max_output_bytes    trần byte engine được phép sinh
}
```

Quy tắc được model kiểm qua `run()`, không qua helper rời (`grant-*` ca nay chạy trên đường
`run` thật):

- **Mọi `run` đi tới engine (`open`/`edit`/`serialize`) đều bắt buộc có grant.** Thiếu grant
  → từ chối có kiểu, `commits` vẫn 0. Một caller công khai không thể hoàn tất ghi mà không có
  grant Go phát hành. `convert`/`export` là ngoại lệ **có tên**: G0 settle
  `unsupported_operation` (501) **trước** mọi kiểm tra grant (§4.5, ca
  `convert-export-unsupported-at-g0`), nên chúng không bao giờ tới nhánh authorize.
- Grant quá `expires_at` → `grant_expired` (401). Không gia hạn ngầm.
- Grant `single_use` đã tiêu → `grant_consumed` (409). Grant được **tiêu tại một điểm cố
  định**: ngay khi đã authorize và **trước** `commitVersion`. Retry cùng key + fingerprint
  trả replay job gốc, nên không sinh version thứ hai và không nới cửa sổ grant.
- `actor_id` khác người gọi → `grant_actor_mismatch` (403).
- Grant phát cho `document_id`, `operation` hoặc base identity khác job → `grant_scope` (403).
  Grant đọc dùng cho `serialize` (ghi) cũng là `grant_scope`.
- Grant phát cho `organization_id` / `workspace_id` khác job → `grant_scope` (403), grant **chưa**
  tiêu (kiểm **trước** `consumeGrant`).
- Byte engine sinh vượt `max_output_bytes` của grant → `upload_bounds`, **sau** khi tiêu grant và
  **trước** `store.put`/`commitVersion`: không object, không commit (ngữ nghĩa **một-lần-thử**).
- **Engine không có credential dài hạn.** Nó không có khoá storage vạn năng, không
  có DB connection tới cơ sở dữ liệu nghiệp vụ, không có token API UniWork.

TTL grant ngắn hơn hoặc bằng deadline của job; job không sống lâu hơn grant. Deadline của
job được chốt **một lần** tại `submit` là `accepted_at + deadline_ms` và thực thi từ đồng hồ
tin cậy **trước** mọi việc engine, ghi object, commit hay tiêu grant. Vì replay trả job gốc,
cửa sổ không bao giờ trượt về sau: một retry dời `deadline_ms` không kéo dài job đã nhận.

---

## 4. Wire contract — input, result, error

Mọi trường JSON là **snake_case** (khớp `docs/conventions.md` § TypeScript: API JSON
là snake_case trên wire **và** trong type). Mọi request/response đi qua validator
nghiêm trong `engine-contract.mjs`; sai schema là `ContractViolation`, không phải
một `BoundaryError`.

### 4.1 Đơn vị version và checksum

| Đơn vị | Nghĩa | Ghi chú |
| --- | --- | --- |
| `working_revision` | bộ đếm lạc quan của Documents | tăng mỗi lần commit; phát hiện nền cũ |
| `base_version_id` | ULID của blob version bất biến trong `document_versions` | nền job thao tác lên |
| `engine_version` | chuỗi build engine (upstream commit + patch + adapter) | lưu cùng version row |
| `contract_version` | phiên bản hợp đồng này (`uniwork-office-engine-contract/1`) | client và server thoả thuận |
| `protocol_version` | phiên bản wire/protocol engine (`1`) | khác contract_version |
| `input_checksum` | SHA-256 của byte đầu vào | tính trên byte thực, không trên mô tả |
| `output_checksum` | SHA-256 của byte đầu ra | engine tính; Go **tính lại độc lập** trước commit |

Checksum được tính trên **byte**, không trên JSON mô tả byte. Go và engine cùng
thuật toán SHA-256; Go không tin `output_checksum` do engine khai mà tính lại.

### 4.2 Capability

```json
{
  "request_id": "01J8Z0…",
  "contract_version": "uniwork-office-engine-contract/1",
  "protocol_version": 1,
  "operation": "capability",
  "format": "xlsx",
  "client_engine_version": "genoffice@09485f88+uniwork-office.0",
  "payload": { "max_input_bytes": 67108864 }
}
```

Result:

```json
{
  "request_id": "01J8Z0…",
  "state": "completed",
  "operation": "capability",
  "engine_version": "genoffice@09485f88+uniwork-office.0",
  "contract_version": "uniwork-office-engine-contract/1",
  "protocol_version": 1,
  "capabilities": [
    { "operation": "open", "supported": true, "runtime": "worker", "evidence_level": "pending" },
    { "operation": "recalculate", "supported": false, "runtime": "internal_service",
      "evidence_level": "pending", "reason": "native sidecar not built" }
  ],
  "limits": { "max_input_bytes": 67108864, "max_edit_ops": 20000 },
  "warnings": []
}
```

`capabilities[].evidence_level` tái dùng từ vựng của `module-runtime-map.json`. Một
capability `supported: true` vẫn có thể `evidence_level: pending`; client hiển thị nó
theo trạng thái chưa chứng minh, không theo `supported`. JSON ví dụ ở trên là hình dạng
wire, không phải ledger hiện tại: một chu kỳ Orca native đã tính lại một ô nhỏ, còn
service nội bộ vẫn `pending`.

### 4.3 Open / parse

Open nhận **byte** (hoặc grant trỏ tới object nội bộ), trả mô hình editor và cảnh
báo fidelity. Open **không** tạo version.

```json
{
  "request_id": "01J8Z1…",
  "operation": "open",
  "grant_id": "01J8Z1G…",
  "format": "docx",
  "payload": {
    "input_bytes": "<base64>",
    "input_checksum": "<sha256 hex>",
    "input_length": 6379,
    "base_revision": 12,
    "base_version_id": "01J8Z0V…",
    "locale": "vi"
  }
}
```

Result:

```json
{
  "request_id": "01J8Z1…",
  "state": "completed",
  "operation": "open",
  "input_checksum": "<sha256 hex>",
  "input_length": 6379,
  "document_model_ref": "engine-session:01J8Z1S…",
  "document_model_kind": "docx-blocks",
  "warnings": [ { "code": "fonts_substituted", "detail": "Liberation Serif → system serif" } ],
  "engine_version": "genoffice@09485f88+uniwork-office.0"
}
```

`document_model_ref` là tham chiếu **trong phạm vi grant**, không phải đường dẫn và
không phải khoá storage. Nó không dùng được ở job khác, workspace khác hay sau khi
grant hết hạn. **Không** trả path, không trả `file://`, không trả handle của desktop.

### 4.4 Edit / serialize

`edit` áp thay đổi lên model trong session; `serialize` biến model thành byte. Tách
hai bước vì edit có thể được gọi nhiều lần trước một serialize, và vì serialize mới
là nơi output được sinh.

```json
{
  "request_id": "01J8Z2…",
  "operation": "edit",
  "grant_id": "01J8Z1G…",
  "format": "docx",
  "payload": {
    "document_model_ref": "engine-session:01J8Z1S…",
    "base_revision": 12,
    "edits": [ { "op": "set_text", "target": { "block_index": 3 }, "text": "UniWork Office" } ]
  }
}
```

`serialize`:

```json
{
  "request_id": "01J8Z3…",
  "operation": "serialize",
  "grant_id": "01J8Z1G…",
  "format": "docx",
  "payload": { "document_model_ref": "engine-session:01J8Z1S…", "base_revision": 12 }
}
```

Result:

```json
{
  "request_id": "01J8Z3…",
  "state": "completed",
  "operation": "serialize",
  "output_bytes": "<base64>",
  "output_length": 6412,
  "output_checksum": "<sha256 hex>",
  "output_object_key": "office/jobs/01J8Z3…/output.docx",
  "base_revision": 12,
  "base_version_id": "01J8Z0V…",
  "engine_version": "genoffice@09485f88+uniwork-office.0",
  "warnings": []
}
```

Nếu `edits[].op` không nhận ra → `engine_result_invalid` (502), không phải silent
no-op. Nếu model đã bị đóng/không tồn tại → `not_found` (404).

### 4.5 Convert / export

Convert sinh **Document mới** (Q7-B) và không bao giờ ghi đè nguồn. Export sinh
artifact phái sinh (PDF/HTML/ảnh) gắn với một version, cũng không đổi nguồn.

```json
{
  "request_id": "01J8Z4…",
  "operation": "convert",
  "grant_id": "01J8Z4G…",
  "format": "docx",
  "payload": {
    "source_version_id": "01J8Z0V…",
    "target_format": "pdf",
    "overwrite_source": false,
    "options": { "embed_fonts": true }
  }
}
```

`overwrite_source: true` là **lỗi hợp đồng** với nguồn đã commit: validation từ chối ở lớp
schema (`ContractViolation`, `overwrite_source must_be_false`) trước khi job tồn tại, vì
Q7-B bắt buộc tạo bản sao. Export dùng cùng hình dạng với `target_format` là định dạng artifact.

**Trạng thái runtime của convert/export ở G0 là `unsupported_operation` (501).** Model tham
chiếu cố ý **không** route hai thao tác này qua đường commit của serialize — làm vậy chính là
lỗi trước đây. `run()` settle `failed` với `error.code = "unsupported_operation"`,
`retryable: false`. Đây là lựa chọn runtime **còn để ngỏ**: khi G2 có adapter thật, convert/export
hoặc được cài đặt đầy đủ hoặc tiếp tục từ chối tường minh bằng đúng mã này — không có trạng thái
trung gian "im lặng".

JSON dưới đây là **hình dạng wire tương lai** (G2), **không** phải runtime G0 — ở G0 `run()`
settle `unsupported_operation` (501) như trên. Result mang thêm nhãn fidelity:

```json
{
  "request_id": "01J8Z4…",
  "state": "completed",
  "operation": "convert",
  "output_object_key": "office/jobs/01J8Z4…/out.pdf",
  "output_checksum": "<sha256 hex>",
  "output_length": 88121,
  "fidelity": { "level": "limited", "lost": ["layout_approximate"], "warnings": [ { "code": "layout_approximate" } ] },
  "source_version_id": "01J8Z0V…"
}
```

`fidelity.level` là `exact` | `limited` | `unsupported`. `limited` phải kèm `lost`
liệt kê phần không bảo toàn; UI phải cảnh báo trước khi người dùng chọn tạo bản sao.

### 4.6 Cancel

```json
{ "request_id": "01J8Z5…", "operation": "cancel", "job_id": "01J8Z3J…", "reason": "user_closed" }
}
```

Result: `{ "job_id", "previous_state", "state": "cancelled", "linearized_at" }`. Cancel
là **best-effort nhưng kết quả xác định**: nếu job đã commit, cancel trả
`state: "completed"` (kèm version đã commit) chứ không giả vờ hủy được. Client không
được hiểu nhầm là đã hủy khi thực tế đã lưu — xem §6.

### 4.7 Error envelope

Mọi lỗi trả cùng shape, chuyển được bằng `code`:

```json
{
  "request_id": "01J8Z2…",
  "state": "failed",
  "operation": "edit",
  "error": {
    "code": "engine_checksum_mismatch",
    "status": 502,
    "error_class": "engine",
    "kind": "output_checksum",
    "retryable": true,
    "fidelity_preserved": true
  }
}
```

`retryable` là trường hợp lệ của bảng lỗi, không phải suy đoán của client. `fidelity_preserved`
nói lỗi này **không** làm hỏng bản đang có.

---

## 5. Validate input trước khi job tồn tại

Boundary từ chối **trước** khi cấp grant hoặc tạo job. `validateEnvelope` chạy theo thứ tự
cố định và chia hai lớp lỗi, vì hai lớp này khác nhau ở cách client xử lý:

**Lớp schema — `ContractViolation`** (request không hợp schema; không có mã lỗi ranh giới,
không retry, `job_count` không đổi):

```text
1. khoá envelope lạ, hoặc trường quyền của caller (actor_id, document_id, output_key, …)
2. request_id; contract_version và protocol_version phải bằng đúng giá trị đang chạy
3. operation và format phải nằm trong catalogue
4. deadline_ms bắt buộc (trừ cancel/capability) và nằm trong [min_deadline_ms, max_deadline_ms]
5. khoá payload lạ, hoặc trường quyền trong payload
6. bộ byte không đầy đủ: input_bytes, input_checksum, input_length phải cùng có
7. số edit ops <= max_edit_ops
8. base_revision / base_version_id sai kiểu
```

**Lớp ranh giới — `BoundaryError`** (lỗi có mã; client branch và retry được), vẫn trước
khi job tồn tại:

```text
- client_engine_version không nằm trong TRUSTED_ENGINE_VERSIONS   -> engine_incompatible (409)
- byte ĐÃ GIẢI MÃ vượt max_input_bytes                            -> upload_bounds (413)
- độ dài giải mã khác input_length khai, hoặc SHA-256 đo được
  khác input_checksum khai                                        -> upload_checksum_mismatch (409)
```

Thứ tự thực thi trong `validateEnvelope`: `client_engine_version` được kiểm **sau**
operation/format và **trước** deadline lẫn allowlist payload, nên một request vừa có khoá
payload lạ vừa có engine build không tin cậy trả `engine_incompatible`, **không** phải
`unknown_field`.

Hai câu trước đây doc nói sai và nay đã sửa: format/operation lạ là `ContractViolation`
chứ **không** phải `not_found`; deadline ngoài khoảng và `max_edit_ops` vượt trần là
`ContractViolation` chứ **không** phải `upload_bounds`. Chỉ byte thật (đã giải mã) mới sinh
`upload_*`. `base_revision` / `base_version_id` **không** được chốt ở đây: chúng được đối
chiếu ở điểm commit, nơi Go đọc revision hiện hành (lệch nền -> `base_version_mismatch` 409).

Các ca `malformed-*` trong bảng ca khẳng định: một request sai bị từ chối **trước**
khi job/grant tồn tại, `revision` hiện hành **không đổi**, và input byte gốc **không
bị chạm**. Đây là điều plan 4.2 yêu cầu: schema có ví dụ và ca malformed/error.

Trần là số hữu hạn, an toàn (bảng `LIMITS` trong script); test khẳng định chúng là
số nguyên hữu hạn an toàn (`Number.isSafeInteger`) thay vì tin vào comment.

---

## 6. Cancellation, complete và crash — tuyến tính hoá

### 6.1 State machine

```text
accepted ──▶ running ──┬──▶ completed
                       ├──▶ failed
                       ├──▶ timed_out
                       ├──▶ cancelled
                       └──▶ crashed
```

`completed | failed | timed_out | cancelled | crashed` là **trạng thái cuối**. Không
có chuyển ra khỏi trạng thái cuối; cố tình chuyển → `invalid_transition` (409).

### 6.2 Complete thắng cancel (hoặc ngược lại) — có luật, không có race im lặng

Mỗi job có **một điểm tuyến tính hoá**: một cờ `settled` bảo vệ bởi khoá đơn luồng
trong model (trong sản phẩm là transaction/`SELECT … FOR UPDATE` của Go).

```text
settle(job, candidate):
  if job.settled: return job.state          # đã có người thắng, không đổi
  job.state = candidate; job.settled = true
  return job.state
```

Vì vậy `cancel-vs-complete` là **xác định**: ai settle trước thắng, và cả hai bên đọc
lại cùng kết luận. Nếu `complete` thắng, cancel trả `state: completed` (đã lưu thật);
nếu `cancel` thắng, kết quả engine đến sau **bị bỏ**, output không được commit, và
recorder cleanup dọn object mồ côi.

### 6.3 Crash và restart

- **Crash giữa chừng**: job `crashed` (502 `engine_crashed`). Không commit; bản hiện
  hành không đổi; object tạm vào ledger mồ côi để retry cleanup.
- **Restart**: state được nạp lại từ ledger. Job ở `running` khi process chết được
  coi là `crashed` (không tự chạy lại). Một `retry` phải dùng **cùng idempotency
  key** và **cùng payload fingerprint**, nếu không → `payload_fingerprint_mismatch`.
- **Job đã `completed` nhưng restart**: kết quả đọc lại được từ ledger; retry cùng
  key trả replay, không chạy lần hai.

Bất biến: **cancelled/crashed job không thể commit**. Chỉ `completed` mới đi tiếp
vào đường commit của Go.

---

## 7. Payload fingerprint, idempotency và retry

### 7.1 Fingerprint

Một **payload fingerprint** là SHA-256 của chuỗi JSON canonical hoá của bộ trường
quyết định kết quả:

```text
fingerprint = sha256(json_canonical({
  contract_version, protocol_version, operation, format,
  input_checksum, input_length,          # ĐO ĐƯỢC từ byte, không phải khai báo
  base_revision, base_version_id,
  document_model_ref, source_version_id,
  engine_version,                        # envelope.client_engine_version
  target_format, edits | export_options  # phần payload theo operation
}))
```

`input_checksum` và `input_length` ở đây là giá trị **đo được** (`validateEnvelope` giải
mã byte và tính lại), **không** phải cặp khai báo trên wire. Vì boundary luôn đo trước, một
digest nói dối không bao giờ tới ledger, và một retry chỉ đổi byte (giữ nguyên digest khai)
bị từ chối là `payload_fingerprint_mismatch` chứ không replay nhầm. `document_model_ref`
và `source_version_id` **có** trong fingerprint: hai retry trỏ hai model khác nhau là hai
công việc khác nhau.

`deadline_ms` **không** nằm trong fingerprint. Deadline thuộc số học TTL của grant/job, không
thuộc "đây có phải cùng một việc không". Một retry trung thực chỉ dời deadline là replay, và
vì replay trả **job gốc**, deadline đã nhận được giữ nguyên và **không** bị nới. Bỏ nó là
quyết định hợp đồng, không phải mặc định.

Fingerprint **bỏ** `request_id` (khác nhau mỗi lần thử) và bỏ mọi trường trình bày
không đổi kết quả. Canonical hoá sắp khoá theo alphabet để cùng nội dung cho cùng
fingerprint bất kể thứ tự viết.

### 7.2 Luật idempotency

| Tình huống | Kết quả |
| --- | --- |
| Key mới | Tạo job, `accepted` |
| Cùng key, cùng fingerprint, job đang chạy | `in_flight` (409) — client backoff, **không đổi key** |
| Cùng key, cùng fingerprint, job đã xong | Replay kết quả cũ; **không** chạy lần hai, không sinh version thứ hai |
| Cùng key, fingerprint khác | `payload_fingerprint_mismatch` (409) — lỗi client |
| Key của actor khác | `job_conflict` (409) |

> **Khác DOC-005 có chủ đích.** DOC-005 §3.1 đã ghi `BeginIdempotent` hiện khoá theo
> `(organization_id, workspace_id, scope, key)` và **không** so payload, nên cùng key
> khác payload **phát lại phản hồi cũ**. Đó là một khoảng trống của helper hiện tại.
> Hợp đồng engine yêu cầu cột `payload_fingerprint`; tên mã lỗi ở đây
> (`payload_fingerprint_mismatch`) khác tên bên DOC-005 (`idempotency_payload_mismatch`)
> vì hai tầng khác nhau. G1 hợp nhất khi viết migration, và khi đó phải sửa cả hai tài
> liệu trong cùng PR — không được để hai tên sống song song ngoài ý muốn.

### 7.3 Retry

- Lỗi `retryable: true` (`engine_timeout`, `engine_overloaded`, `engine_crashed`,
  `in_flight`, `engine_checksum_mismatch`) được retry với **cùng key + cùng fingerprint**.
- Lỗi `retryable: false` (`payload_fingerprint_mismatch`, `grant_*`, `not_found`,
  `base_version_mismatch`) **không** tự retry; cần hành động người dùng.
- Retry **không** được tạo version thứ hai: replay trả cùng `output_object_key` và
  cùng `output_checksum`.
- Retry sau `engine_checksum_mismatch` phải sinh output mới; object của lần hỏng vào
  ledger mồ côi và bị dọn theo §8.4, **không** được commit.

---

## 8. Commit, object và cleanup

### 8.1 Thứ tự bắt buộc

```text
engine serialize (byte đã đủ)
   └─▶ engine ghi object nội bộ (temp object key)
         └─▶ Go: tiền kiểm (byte dài đúng? checksum tính lại khớp?)
               └─▶ Go: một transaction ghi
                     document_versions (bất biến, checksum, engine_*)
                     documents.current_version_id, working_revision +1
                     audit_events + outbox_events
                     upload/ledger row -> committed
               └─▶ sau commit: phát outbox, dọn object tạm nếu còn
```

Go **không** tin checksum engine khai. Nó đọc object, đếm byte, tính lại SHA-256, và
chỉ commit khi mọi thứ khớp. `output_length` sai một byte cũng là
`engine_result_invalid`.

### 8.2 Object vs DB — nói đúng sự thật về atomicity

Object store và Postgres là **hai hệ thống lưu trữ khác nhau**. Không có transaction
chung giữa chúng. Vì vậy hợp đồng này **không** hứa "atomic xuyên hai kho"; nó hứa
một thứ yếu hơn nhưng đúng và kiểm được:

1. **Object ghi TRƯỚC, DB commit SAU.** Byte của một version bất biến tồn tại trong
   object store trước khi có bất kỳ hàng `document_versions` nào trỏ tới nó.
2. **Chiều hỏng an toàn là object mồ côi, không phải tham chiếu hỏng.** Nếu tiến
   trình chết giữa object-put và DB-commit, kết quả là một object không ai trỏ tới
   (rác, dọn được) — **không** là một `document_versions` trỏ tới byte không tồn tại
   (mất dữ liệu không dọn được).
3. **Chỉ transaction DB mới là điểm chuyển trạng thái.** Version row, con trỏ hiện
   hành, revision, audit và outbox commit cùng nhau trong **một** transaction DB.
   Nếu transaction rollback, không version nào tồn tại và bản hiện hành không đổi.
4. **Object không thể rollback.** Vì vậy nó luôn đi trước và luôn ghi vào khoá mới
   (ULID), không ghi đè khoá của version đã commit. Một khoá version đã commit là bất
   biến và không bao giờ bị ghi đè bởi engine hay cleanup.

Nói cách khác: bất biến của *byte* nằm ở object store (khoá bất biến + không ghi đè);
bất biến của *tham chiếu và lịch sử* nằm ở transaction DB. Sự phối hợp giữa hai bên
là **write-ahead + reconcile**, không phải two-phase commit.

### 8.3 Orphan ledger

Ledger là hàng trong DB (do Go sở hữu) ghi ý định trước khi object tồn tại, đúng mẫu
`ObjectURL(key)` của `server/internal/storage/storage.go`: URL của một object **là
hàm thuần của cấu hình**, nên ledger ghi được URL **trước** khi upload, rồi upload,
rồi mới commit. Các trạng thái ledger:

| Trạng thái | Nghĩa | Bước tiếp |
| --- | --- | --- |
| `intended` | Đã ghi URL/expected key, chưa upload | Upload; quá TTL → dọn, xóa hàng |
| `stored` | Object tồn tại, chưa có version trỏ tới | Chờ commit; quá TTL → `orphaned` |
| `committed` | Version trỏ tới object | Giữ; không dọn |
| `orphaned` | Object không có version trỏ tới | Retry cleanup định kỳ |
| `deleted` | Đã gọi `DeleteObject` thành công | Giữ một thời gian cho audit rồi bỏ |

### 8.4 Retry cleanup dùng `DeleteObject` và **nêu lỗi**
Object store exposes exactly one removal verb: **DELETE** on the object key. Go wraps it
twice - `Storage.Delete` swallows the error, `Storage.DeleteObject` surfaces it. Office
cleanup may only call `DeleteObject`, because a failed DELETE treated as success leaves an
object behind that the ledger has already marked deleted.

`Storage.Delete` **không trả lỗi**; `Storage.DeleteObject` trả `error` (xem chú thích
tại `storage.go:13-16`: DeleteObject là `Delete` có lỗi được nêu, để reconciler của
media sắp retry thay vì giả định thành công). Cleanup của Office **chỉ** dùng
`DeleteObject`, và:

- Nếu `DeleteObject` trả `nil` → ledger chuyển `deleted`.
- Nếu trả lỗi → ledger **giữ** `orphaned` (hoặc chuyển `orphaned` nếu chưa), ghi
  `attempts +1`, `last_error`, `next_attempt_at` theo backoff, và **phát metric**
  (`office_orphan_delete_failures_total`).
- Reconciler **không** được coi lỗi là thành công, không được xóa hàng ledger để
  "cho sạch", và không được đánh dấu `deleted` khi object còn.
- Vì object mồ côi không được ai trỏ tới, việc dọn nó **không bao giờ** ảnh hưởng
  bản gốc: object của version đã commit là khoá khác, không nằm trong tập orphan.

### 8.5 Bản gốc luôn truy cập được khi engine chết

Danh sách tài liệu, metadata, tải bản gốc và xem version đã commit **không** đi qua
engine. Engine chết, hết quota hay bị thu hồi grant chỉ làm các thao tác *cần engine*
(mở bằng editor, sửa, chuyển đổi) nhận lỗi có kiểu; nó không làm hỏng kho, không làm
mất nháp và không làm mất quyền tải bản gốc. Đây là điều plan 4.3/4.4 yêu cầu và là
điều ca `engine-down-original-still-available` khẳng định.

---

## 9. INT-01 — module, entry point, runtime

Chi tiết từng thao tác nằm ở [`module-runtime-map.json`](module-runtime-map.json). Nguyên tắc:

1. **Nguồn upstream pin trong monorepo UniWork.** Sau khi port, build từ checkout sạch
   **không** cần `../genoffice`, không symlink tới checkout người dùng, không private
   registry. Vị trí package cuối cùng theo inventory dependency của DOC-002; E0 ở đây
   chỉ chốt **hướng**.
2. **Entry point browser tách khỏi Node/Electron/native.** Editor web nhận **host
   adapter được inject**; bundle client không được kéo Node, Electron hay module native.
   Bridge kiểu `window.desktop`/`window.pdfApi` toàn cục là thứ DOC-003 đã bác; nó
   không được tái xuất hiện trong tích hợp sản phẩm.
3. **Module engine không chứa auth/ACL nghiệp vụ.** Logic quyền ở Go; engine chỉ nhận
   input trong phạm vi grant.
4. **Native là process riêng, không phải WASM suy đoán.** Sidecar Rust XLSX (crate
   `xlsx-sidecar`, `PROTOCOL_VERSION = 1`) **phải tính lại công thức** trong service
   nội bộ; không được suy ra rằng Rust chạy được bằng WASM trong browser.
5. **PDF sửa ảnh có sẵn cần adapter.** `image-edit.ts` import `electron` ở cấp module;
   hoặc viết adapter decode ảnh thuần Node, hoặc giữ thao tác này ở host desktop. Nó
   **không** chạy được trong engine-host Node như hiện tại.

### 9.1 Sai khác so với mô hình ưu tiên (phải giải thích, không được bỏ qua)

| Thao tác | Mô hình ưu tiên | Thực tế G0 | Xử lý |
| --- | --- | --- | --- |
| XLSX recalc | engine trong worker nếu hợp | cần process native | Đặt ở service nội bộ; đây là **sai khác có chủ đích**, không phải WASM hoá. Một chu kỳ Orca native đã tính lại B3=9; service nội bộ vẫn chưa chứng minh |
| PDF sửa ảnh có sẵn | browser/worker | phụ thuộc Electron `nativeImage` | Adapter Node hoặc host desktop; ghi blocker, **không** giả vờ. Chu kỳ F1 không phải sửa ảnh |
| PDF sửa chữ | browser/worker | đã qua in-memory service | Probe in-memory + trích xuất độc lập vẫn là hàng `proven` duy nhất và không có save của chính probe đó. Save editor phạm vi hẹp là việc khác và không nâng hàng này |
| PPTX edit | worker | `setText` không phải export | Text vẫn phải đi `runTxn`. Chu kỳ Replace Picture/Save/reopen trên Chrome và Edge Windows đã được nghiệm thu ở phạm vi ảnh, không phải worker và không phải `setText` |
| HTML preview | browser cách ly | phụ thuộc scheme Electron | Re-home sang origin tách biệt; việc thật, không phải đổi tên |

### 9.2 Xung đột catalog (chưa chứng minh, không miễn trừ)

| Gói | UniWork | Upstream | Trạng thái |
| --- | --- | --- | --- |
| React | `19.2.3` | docs khai `19.2.4` | `pending` — port phải build với catalog hiện tại; **không** nâng catalog toàn sản phẩm để làm spike chạy |
| TipTap | override `3.30.6` | docs khai `3.31.0` | `pending` — engine docx/markdown phải được kiểm lại trên `3.30.6` trong browser thật |

Hai dòng này **không** được miễn trừ ở G0. Chúng là điều kiện G2/G3 phải chứng minh.

---

## 10. Đóng gói, identity và nâng phiên bản

### 10.1 Service nội bộ và on-premise

- Engine chạy như **process/container riêng**, có thể cùng máy với UniWork, có trong bộ
  on-premise. Không cần máy chủ vật lý riêng.
- Client **không** gọi thẳng endpoint engine và **không** giữ credential engine. Chỉ Go
  gọi engine, qua transport riêng, bằng grant hết hạn.
- **Không** có dịch vụ Office/OCR bên thứ ba: file không được gửi ra ngoài (Q4-A).
- **Không** có store user/document riêng: engine không sở hữu tài khoản, ACL hay kho
  phiên bản (ADR 0016).
- Health (`/healthz` kiểu liveness) và metric (số job, thời lượng theo operation,
  orphan delete failures, backpressure) là bắt buộc trước khi vào G7. Giới hạn tài
  nguyên: trần byte input/output, số worker, deadline, hàng đợi có backpressure
  (`engine_overloaded` 503).

### 10.2 Identity và namespace desktop (đầu ra MỚI của G0)

Mọi giá trị dưới đây là **đề xuất G0**, **không** phải tài nguyên đã tồn tại. Chi tiết
và owner ở `module-runtime-map.json` → `packaging_and_namespace`.

| Bề mặt | Đề xuất | Bề mặt GenOffice hiện tại |
| --- | --- | --- |
| App/bundle id | `com.uniwork.office` | `com.genoffice.app` |
| Tên hiển thị | `UniWork Office` | `GenOffice` |
| Tên kỹ thuật/slug | `uniwork-office` | `genoffice` |
| Executable | `uniwork-office` | `genoffice` |
| Scheme người dùng | `uniwork-office` (+ callback `uniwork-office://auth/callback`) | chưa có scheme người dùng ở commit pin |
| Scheme nội bộ | `uniwork-office-app`, `uniwork-office-preview`, `uniwork-office-asset` | `genoffice-app`, `html-preview`, `html-asset` |
| User-data / cache / keychain | namespace `uniwork-office` | namespace GenOffice |
| Update feed | kênh riêng do UniWork sở hữu | `GENOFFICE_UPDATE_URL`, `publish.url` upstream |
| Installer metadata | deb/rpm/nsis/dmg theo `uniwork-office`, giữ cặp StartupWMClass↔desktop-name | `genoffice` |

Điều kiện cùng tồn tại: cài cạnh GenOffice **không** ghi đè app kia, **không** chia sẻ
app id, scheme, thư mục dữ liệu, control channel hay update feed; **không** nhận binary
qua feed upstream. LICENSE/NOTICE/attribution được giữ trong bản fork; mọi bản phát hành
phải sinh và đóng gói third-party notices.

### 10.3 Theme không đổi byte nội dung

Rebrand chỉ đổi **chrome của ứng dụng** (thanh, menu, màu UI, logo app). Nó **không**
đổi màu, font, logo hay nội dung bên trong file người dùng. Điều này được kiểm bằng so
byte trước/sau khi đổi theme rồi save, trên fixture có theme (`F-DOCX-THEME`), không
bằng đọc token.

### 10.4 Version negotiation, rolling update, rollback

- **Negotiation:** client gửi `contract_version` + `protocol_version` + engine build;
  Go so với `document_versions.engine_*` trước khi tạo job. Lệch **schema** `contract_version`
  / `protocol_version` → `ContractViolation` tại đúng trường (không tạo job). Lệch **engine
  build** → `engine_incompatible` (409), một `BoundaryError`. `contract_mismatch` và
  `protocol_mismatch` vẫn nằm trong bảng mã lỗi cho tầng Go, nhưng đường ranh giới tham chiếu
  từ chối hai trường version ở **lớp schema** trước, nên hai mã đó không được phát ra ở đây.
  Không downgrade ngầm.
- **Shadow `engine_version` trên version row** để biết version nào tạo ra byte nào; nâng
  engine phải chạy lại **fixture replay** trước rollout.
- **Rolling:** engine cũ vẫn phục vụ tài liệu nó đọc được; engine mới vào sau flag.
- **Rollback:** quay về build trước **vẫn phải đọc được nháp và version đã commit**.
  Nháp nằm ở kho nháp theo tài khoản, độc lập engine build, nên rollback không mất nháp.
  Lệch base version khi phục hồi là `conflict` (DOC-005), **không** ghi đè ngầm.
- **Rule:** bump version **không** phải cổng; chạy lại fixture + harness lỗi **là** cổng.

---

## 11. Ownership G1/G2/G3/G4/G7 và thứ tự migration

| Nhóm | Issue | Phạm vi từ hợp đồng này | Thứ tự |
| --- | --- | --- | --- |
| G1 | UNI-657 | Kho Documents, transaction commit, audit/outbox, ledger mồ côi + reconciler | 1 |
| G2 | UNI-658 | Port module engine, layout source, service engine nội bộ, sidecar native, adapter Go | 2 |
| G3 | UNI-659 | Tích hợp editor, host adapter, chrome/theme editor | 3 |
| G4 | UNI-636 | Host desktop, login, packaging, namespace, update feed | 4 |
| G7 | UNI-661 | Release, brand scan trên binary thật, fixture replay | 5 |
| G5 | UNI-660 | Sync/offline/nháp đầy đủ chạy trên protocol DOC-005, dùng ranh giới này | sau G1-G3 |

Thứ tự là thứ tự **phụ thuộc**: store + ledger có trước khi engine ghi vào; adapter có
trước khi editor tiêu thụ; desktop host có trước packaging; release cuối. DOC-005 đã
chốt xong một phần (protocol + harness nháp) nhưng **không** chốt trước khi biết cách
lưu và đơn vị version của DOC-004 — vì vậy nó bám theo hợp đồng này.

---

## 12. Bằng chứng chạy được

```sh
node scripts/office-g0/engine-contract.mjs                 # in bảng ca, ghi JSON bằng chứng
node scripts/office-g0/engine-contract.mjs --print --out <path>
node --test scripts/office-g0/engine-contract.test.mjs     # kiểm harness + hợp đồng
```

Harness model chạy trên **Node 22 built-ins**, không HTTP, không engine, không object store,
không browser. Storage/engine/ACL đều là fake được khai báo trong báo cáo bằng chứng. Từ task
4.4 còn có `engine-contract-adapter.mjs`: cùng Node 22 built-ins nhưng **lái host engine thật**
qua loopback — xem §12.3.

### 12.1 Bảng ca bắt buộc (oracle viết thẳng trong script)

33 ca bên dưới là **oracle viết thẳng trong script**: mỗi dòng ở đây phải khớp `expect` trong
`FAULT_CASES`, và test khẳng định danh sách ca **không co lại, không trùng**. Các dòng đánh dấu
**(sửa r2a)** là những dòng mà bản trước của tài liệu mô tả sai hành vi thật.

| Nhóm | Ca | Kỳ vọng (theo `expect`) |
| --- | --- | --- |
| Malformed | `malformed-missing-format` | `ContractViolation` tại `envelope.format`, 0 job |
| Malformed | `malformed-unknown-operation` | `ContractViolation` tại `envelope.operation`, 0 job |
| Malformed | `malformed-float-length` | `ContractViolation` tại `envelope.payload.input_length`, 0 job |
| Malformed | `malformed-negative-deadline` | `ContractViolation` tại `envelope.deadline_ms`, 0 job |
| Malformed | `malformed-oversize-input` | **(sửa r2a)** `ContractViolation` tại `envelope.payload.input_length` — **không** phải `upload_bounds`, vì đây là trần *khai báo*; byte thật vượt trần mới là `upload_bounds` |
| Malformed | `malformed-bad-checksum-hex` | `ContractViolation` tại `envelope.payload.input_checksum` |
| Version | `contract-version-mismatch` | **(sửa r2a)** `ContractViolation` tại `envelope.contract_version` — **không** phải `contract_mismatch` |
| Version | `protocol-version-mismatch` | **(sửa r2a)** `ContractViolation` tại `envelope.protocol_version` — **không** phải `protocol_mismatch` |
| Version | `engine-version-incompatible-is-typed` | `engine_incompatible` 409, `error_class: incompatible`, không retryable, chạy qua `submit`, 0 job |
| Checksum | `input-checksum-mismatch` | **(sửa r2a)** `upload_checksum_mismatch` 409 chạy qua `submit`, 0 object, 0 job; digest nói dối và độ dài giải mã lệch cùng bị bắt ở đây |
| Checksum | `output-checksum-recomputed` | `completed`, checksum commit bằng SHA-256 độc lập của byte đã lưu, 1 commit |
| Checksum | `output-length-off-by-one` | `failed` / `engine_result_invalid`, revision +0, version +0, ledger `orphaned` |
| State | `timeout-before-settle` | `timed_out` / `engine_timeout`, revision +0, version +0 |
| State | `cancel-vs-complete-cancel-first` | **(sửa r2a)** actor ngoài bị `grant_actor_mismatch`; owner cancel thắng (`linearized: true`, `already_committed: false`), kết quả đến sau bị bỏ, revision/version +0 |
| State | `cancel-vs-complete-complete-first` | `completed`, cancel đến sau **không** linearize, `already_committed: true`, 1 commit |
| State | `crash-mid-run` | `crashed` / `engine_crashed`, revision +0, version +0 |
| State | `restart-running-becomes-crashed` | `running` → `crashed` khi nạp lại, version +0 |
| State | `restart-completed-replays` | `completed`, replay `true`, 1 commit, version +1 |
| Idempotency | `same-key-same-payload-replay` | lần đầu không replay, lần hai replay, 1 commit, version +1 |
| Idempotency | `same-key-different-payload` | `payload_fingerprint_mismatch` 409, version +0, đúng 1 job |
| Idempotency | `same-key-in-flight` | `in_flight` 409, `retryable: true`, 0 commit |
| Grant | `grant-expired` | `grant_expired` 401, job `failed`, 0 commit, version +0 |
| Grant | `grant-reused` | **(sửa r2a)** job thứ hai `failed` / `grant_consumed` 409 qua `run`; job thứ nhất đã commit (1 commit, version +1) |
| Grant | `grant-scope-exceeded` | `grant_scope` 403 qua `run` (grant đọc dùng cho serialize), job `failed`, 0 commit |
| Grant | `grant-actor-mismatch` | `grant_actor_mismatch` 403, job vẫn `accepted`, 0 commit |
| Object | `object-written-before-db-commit` | object tồn tại trước version row, `completed`, 1 commit |
| Object | `db-rollback-leaves-orphan` | `failed`, revision +0, version +0, ledger `orphaned`, object còn nguyên |
| Object | `cleanup-delete-error-surfaced` | `deleted: 0`, `failed: 1`, ledger `orphaned`, `attempts: 1`, `last_error: object_missing` |
| Object | `cleanup-never-deletes-committed` | `deleted: 1`, object đã commit không bị xoá và còn hiện diện |
| Availability | `engine-down-original-still-available` | list + original OK khi engine chết, thao tác cần engine → `engine_crashed`, revision/version +0, 0 commit |
| Path | `no-path-in-browser-result` | projection sạch (0 leak), model ref lạ → `not_found` / `failed`, 1 commit |
| Transition | `terminal-state-immutable` | chuyển khỏi trạng thái cuối → `invalid_transition` |
| Runtime | `convert-export-unsupported-at-g0` | convert/export từ chối **có tên** `unsupported_operation` 501 **trước** mọi grant, job `failed`, 0 commit, 2 job |

Ngoài 33 ca model, có **bộ ca adapter thật** (task 4.4) trong
`scripts/office-g0/engine-contract-adapter.mjs` — xem §12.3.

### 12.2 Giới hạn của bảng ca model — đọc trước khi trích dẫn bằng chứng

- Đây là **model tham chiếu**, không phải engine. Nó chứng minh hợp đồng **nhất quán**,
  không chứng minh engine **đúng**.
- **Authorization mô hình hoá** (map ACL trong bộ nhớ), **không** phải tenant isolation
  sản phẩm, **không** thay test service G1/G4/G5.
- **Không** có nghiệm thu trọn sáu luồng browser DOC-003; chúng vẫn `pending` và thuộc
  UNI-667. Các chu kỳ phạm vi hẹp (DOCX Chrome/Edge, PPTX Chrome/Edge, PDF Orca, XLSX Orca
  native) là bằng chứng thật và không chọn runtime.
- **Không** tự nhận đã chứng minh Go service, object store hay packaging: các phần đó vẫn
  là fake khai báo. Bằng chứng adapter thật ở §12.3 chỉ phủ transport loopback + thao tác
  docx/pdf/pptx, không phủ các phần còn lại.
- PDF existing-image và HTML preview isolation vẫn `pending`. XLSX recalc trong service
  nội bộ và PPTX text edit qua `setText` vẫn `pending`; các chu kỳ phạm vi hẹp không lấp
  hai lỗ đó.
- QA-01: macOS/Safari thật chờ UNI-671.

### 12.3 Cạnh adapter thật (task 4.4) — `engine-contract-adapter.mjs`

`engine-contract.mjs` là model với fake. `engine-contract-adapter.mjs` là đối tác task 4.4:
nó **lái host engine DOC-003 thật** (UNI-667, `e2e/office-g0/engine-host.mts`) qua transport
loopback HTTP và ghi lại **đúng những gì transport trả**.

Chuẩn bị và chạy (Node 22 built-ins, không thư viện bên thứ ba):

```sh
node scripts/office-g0/engine-contract-adapter.mjs --prepare \
     --lab <work>/.office-g0-adapter-lab --fixtures <spike>/lab/fixtures
# boot host thật (operator) rồi:
node scripts/office-g0/engine-contract-adapter.mjs \
     --base-url http://127.0.0.1:5392 --lab <work>/.office-g0-adapter-lab --print
```

Kết quả đã chạy: **11/11 ca khớp oracle**, exit 0, trên host thật cổng 5392; artifact
`.office-g0-adapter-lab/adapter-evidence.json`. Neo bền vững là **digest oracle của bộ ca**
(không phải digest file — file đổi theo `generated_at` và đường dẫn lab):
`bae36e364475441967d8bf092e1c34b43d11a14c5239745be6bc08b8de0f5cad`.

| Nhóm | Ca adapter | Bằng chứng thật quan sát được |
| --- | --- | --- |
| Transport | `adapter-unreachable-host-maps-to-engine-crashed` | host không lắng nghe → `engine_crashed`, `retryable: true` — không "thành công im lặng" |
| Transport | `adapter-method-not-allowed-is-a-caller-fault` | GET vào route POST → 405 `method_not_allowed`, lớp contract_violation |
| Transport | `adapter-bad-json-is-a-caller-fault` | body không phải JSON → 400 `bad_json`, từ chối trước khi route chạy |
| Transport | `adapter-unknown-route-is-a-typed-refusal` | route lạ → `no_route` map `unsupported_operation` (501) |
| Containment | `adapter-view-traversal-refused-before-work` | `viewId: ../…` → `bad_view_id`, **không** tạo thư mục thoát lab |
| Containment | `adapter-outside-lab-path-refused` | path ngoài lab → `outside_lab` map `not_found`, không đọc file |
| Engine | `adapter-malformed-engine-input-is-typed` | byte engine không parse được → `engine_error` map `engine_result_invalid` |
| Route | `adapter-missing-required-input-is-refused` | thiếu trường bắt buộc → `bad_input` |
| Thật | `adapter-real-docx-edit-roundtrip-persists` | sửa docx thật: text thay được, **mọi block gốc còn nguyên**, hash trên đĩa khớp hash báo cáo |
| Thật | `adapter-real-pdf-text-read-returns-fixture-text` | đọc PDF thật: 2 trang, chứa dòng text của fixture |
| Thật | `adapter-real-pptx-open-and-close-cycle` | mở deck thật (2 slide) rồi đóng session |

`ADAPTER_ERROR_MAP` trong script ánh xạ mã transport riêng của host sang từ vựng hợp đồng;
một mã không có ánh xạ **không** được cho qua — `classify()` báo nó là lỗi caller chưa map
(`transport.unmapped_code`) để ca fail thay vì giả vờ hợp đồng đã phủ.

**Điều §12.3 KHÔNG chứng minh:** render browser, Go service, auth/ACL/tenant isolation sản
phẩm, object storage, packaging, hay sáu luồng browser DOC-003 (UNI-667 sở hữu). Một ca
`unavailable` (host chưa boot / fixture thiếu) làm run fail trừ khi truyền
`--allow-unavailable`, và bằng chứng thiếu được **nêu**, không thay thế.

---

## 12.4 Sáu ca fault adapter thật (task 4.4) — nghiệm thu ở ranh giới tham chiếu

Đây là phần còn lại của task 4.4 sau §12.3. Nguồn trích dẫn là
`acceptance-g48-scheduled9.md`: ZIP `adapter-package-intake-g48-scheduled9`,
SHA256 `5dc00bd39d1cc5def590ad8e919b2b1e769631f8a3164dfb331e36da1bcd8271`,
895978 byte. Bản đóng này **không chạy lại** sáu ca đó, không chạy lại bảng
malformed của §12.1, và không chạy lại lần zero-put đã ghi trong
`engine-contract-adapter-checksum.md`. Hash trên được trích từ biên bản nghiệm thu,
không được đo lại ở pass này.

| Ca | Đã nghiệm thu ở ranh giới tham chiếu | Chưa chứng minh |
| --- | --- | --- |
| `type-version-mismatch` | contract/protocol/engine build sai bị từ chối trước job; byte không phải DOCX trả `engine_result_invalid`; 0 put, 0 commit | Go sản phẩm |
| `checksum-mismatch` | checksum khai báo bị sửa sau output thật trả `engine_checksum_mismatch` 502; 0 put, 0 commit. Đây là bản zero-put hiện tại; lần một-put cũ không được đổi tên | object store sản phẩm |
| `timeout` | deadline thắng khi kết quả thật đang bị giữ; kết quả đến muộn bị bỏ; 0 put, 0 commit | việc engine không còn ghi byte staging |
| `cancel-complete-race` | cancel trước thì `cancelled` và 0 commit; complete trước thì `completed`, cancel sau không tuyến tính hoá | transaction DB sản phẩm |
| `crash-restart` | process engine thật chết thì job cũ `crashed` và 0 commit; process mới hoàn tất một job mới | restart bền của service; Job Object |
| `metadata-access-engine-down` | list, metadata và bản gốc vẫn đọc được khi ping engine thất bại; 0 commit | ACL và database sản phẩm |

Giới hạn giữ nguyên. Chúng không được viết thành kiến trúc đã chứng minh:

- Auth, kho và commit nghiệp vụ là **mô hình** trong `engine-contract.mjs`. Engine DOCX và transport loopback là thật.
- Job map sau restart engine **không bền**. Nó sống ở process cha, không phải một service restart bền.
- Cancel và deadline bỏ kết quả ở ranh giới adapter. Byte staging phía engine vẫn có thể đã được ghi.
- Không có build sản phẩm độc lập. Source đã chuẩn bị, `node_modules`, `tsx` và `esbuild` vẫn là đầu vào ngoài.
- Sáu luồng browser DOC-003 nguyên vẹn vẫn thuộc UNI-667. Các chu kỳ editor phạm vi hẹp không chọn runtime và không thêm hàng `proven`. `runtime_chosen` vẫn `false`. Đúng một hàng `proven` trong map: `pdf/edit_text`.
- Quan sát taskkill trên Windows không phải chứng minh cây process Unix và không có bảo đảm Job Object.

`run-engine-contract-lab.mjs` chạy 11 ca adapter đóng băng. Nó không phải runner của sáu ca này. Runner sáu ca là `scripts/office-g0/run-engine-contract-faults.mjs`.

---

## 13. Việc tiếp theo

1. **Task 4.4 có hai lớp bằng chứng adapter thật, cả hai đều là loopback.** §12.3 là 11/11 ca transport và round-trip. §12.4 là sáu ca fault canonical đã nghiệm thu ở ranh giới tham chiếu, với auth, kho và commit vẫn là mô hình. Việc còn lại của G1/G2: nối các lớp đó vào service Go và storage thật, rồi điền cột runtime từ một lần chạy đúng nơi đặt (browser, worker hoặc native), không chỉ loopback. Chưa có build sản phẩm độc lập.
2. G1 viết migration `payload_fingerprint` + ledger mồ côi; hợp nhất tên mã lỗi với
   DOC-005 trong cùng PR (xem §7.2).
3. G2 chốt layout package cuối cùng và dựng service engine nội bộ + sidecar native.
4. G3/G4 chứng minh catalog React/TipTap và packaging desktop, kèm namespace ở §10.2.
5. DOC-006 dùng tài liệu này cùng báo cáo DOC-003 để chốt G0.


## 14. RT-02 evidence reconciliation (UNI-668 candidate)

RT-02 no longer means that no adapter evidence exists. The pinned artifact
`docs/office/g0/RT02-adapter-evidence.json`
is SHA-256 `2a9a5830f3489aef1959c9c5551d205be2694c08ae7636b22f4d0bb4b92d4d05`, 9353 bytes. It records
`real_engine_evidence`, contract `uniwork-office-engine-contract/1`,
`loopback-http-post` to `http://127.0.0.1:5392`, Node v22.23.2,
Windows win32, 11/11 passed,
zero failed/unavailable, oracle digest
`bae36e364475441967d8bf092e1c34b43d11a14c5239745be6bc08b8de0f5cad`, generated 2026-09-20T20:02:09.963Z. The eleven
case ids are: `adapter-unreachable-host-maps-to-engine-crashed`, `adapter-method-not-allowed-is-a-caller-fault`, `adapter-bad-json-is-a-caller-fault`, `adapter-unknown-route-is-a-typed-refusal`, `adapter-view-traversal-refused-before-work`, `adapter-outside-lab-path-refused`, `adapter-malformed-engine-input-is-typed`, `adapter-missing-required-input-is-refused`, `adapter-real-docx-edit-roundtrip-persists`, `adapter-real-pdf-text-read-returns-fixture-text`, `adapter-real-pptx-open-and-close-cycle`.

This is real DOC-003 engine-host behavior over loopback: DOCX edit/persist,
PDF text read, PPTX open/close, plus transport, containment, and typed-input
cases. It is not a UniWork production service or a browser product flow. The
model table in section 12.1 remains a separate 33-case modeled contract; its
rows do not count as engine runs. The six canonical faults
(`type-version-mismatch`, `checksum-mismatch`, `timeout`,
`cancel-complete-race`, `crash-restart`, `metadata-access-engine-down`)
are a separate previously tested/reviewed run, retained as
`docs/office/g0/RT02-six-fault-evidence.json`, evidence SHA-256
`d237c15d54ccf95f11502e3f2b14a48b747efd80fe06c2aed84ef8eb7119ff8f`; their evidence is reused, not rerun in this pass.
That run uses real DOCX/HTTP and engine responses but models authorization,
storage, commit, and catalogue; parent job state is not durable and engine
staging bytes may remain after timeout/cancel.

**Decision:** criterion 4.4 has bounded evidence present, not whole-criterion
acceptance. All `runtime_chosen` fields remain false; `pdf/edit_text` remains
an in-memory probe, not persisted product behavior. The canonical map records
this split in `rt02_reconciliation`; the six fault cases are not rows in the
33-case model table and do not add a proven format operation.

## 15. G1/G2 handoff contract (G0 output only)

G1 owns document authority and persistence: validate identity, tenant/workspace
ACL, quota, idempotency, deadline, and current version before creating a job.
The engine receives only a scoped operation grant and bounded bytes; it cannot
select paths/object keys, access business tables, or decide whether a commit is
authorized. Persist job/idempotency state and use terminal transitions
`accepted -> running -> completed|failed|timed_out|cancelled`. Same-key/same-
payload retries replay; same-key/different-payload conflicts.

G2 owns a patchable pinned source area inside this monorepo, the versioned
contract package, browser-safe and Node/native entries, private engine service,
native sidecar, typed Go client, and clean-checkout build. Proposed layout:

- `packages/office-contracts/`: versioned wire schemas and shared types only.
- `packages/office-engine-upstream/<module>/`: pinned source, reviewed patch
  series, LICENSE and NOTICE; no sibling `genoffice`, symlink, or private registry.
- `packages/office-engine-browser/` and `packages/office-engine-node/`:
  explicit separate entry points; browser imports must not reach Node, Electron,
  canvas or native bindings.
- `services/office-engine/`: private service and sidecars;
  `server/internal/officeengine/` is its typed transport client;
  `server/internal/service/documents/` keeps authorization, version, quota,
  transaction, audit/outbox and orphan cleanup authority.
- `apps/web/platform/` injects host adapters; views keep the existing
  `views -> core + ui` dependency direction. The engine is not linked to Go.

Keep UniWork React 19.2.3 and TipTap 3.30.6 catalog versions unless G2/G3
prove the port against them with a clean install, typecheck, build, and browser
fixtures. Upstream docs currently name React 19.2.4 / TipTap 3.31.0; do not
silently add a second copy or bump the shared catalog to mask incompatibility.

Before commit, stage output privately, recompute bytes/length/SHA-256, then let
Go write the immutable object before a database transaction commits version,
audit/outbox and idempotency. Enforce input/output caps, allowlisted operations,
deadline, bounded concurrency, memory/temp quotas, and per-job staging. Current
evidence does not prove durable parent job state, engine-local cleanup after
cancel/deadline, production ACL/store, or a private deployed service. Those are
explicit G1/G2 tests, not G0 results.

Upgrade only behind a disabled-by-default flag and supported contract/protocol
range after replaying DOC-003 fixtures and DOC-005 failures. Keep old readers
for committed and draft versions. Rollback disables the new route and preserves
bytes/drafts; an unreadable version returns typed incompatibility, never
downgrade or overwrite. G1 is UNI-657; G2 UNI-658; G3 UNI-659 owns editor,
browser and React/TipTap integration; G4 UNI-636 owns desktop distribution;
G5 UNI-660 owns sync/recovery; G7 UNI-661 owns release/replay. The current
DOC-003 lead retains shared HTML/Markdown/PDF host/browser fixes.

These are implementable G1/G2 contracts, not implementation evidence. The
guarded replica test proves only document-payload application and hash/guard
behavior. No product engine was built; React/TipTap compatibility, clean
monorepo engine build, service deployment, upgrade, rollback, and browser proof
remain pending. Criterion 4.7 stays open until those prerequisites exist.
