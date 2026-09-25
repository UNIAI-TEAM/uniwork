# UniWork - Hợp đồng FileService FS-C1 cho module tiêu thụ

> **Trạng thái:** in-progress - bản hợp đồng v1 viết ngày 2026-09-24 để module tiêu thụ (task, chat, avatar, recording, audit export, Documents/Office G1-G2) code trước theo contract; chưa có implementation.

**Ngày:** 2026-09-24

**Issue:** UNI-726 (tài liệu); code của hợp đồng là T1a thuộc UNI-739.

**Nguồn:** [Spec FileService](2026-09-22-shared-file-service-design.md) và [plan](../plans/2026-09-22-shared-file-service.md). Tài liệu này rút các quyết định đã chốt ở spec thành chữ ký, trạng thái và mã lỗi mà module gọi vào. Chỗ nào khác spec thì spec thắng và hợp đồng phải sửa kèm tăng version.

## 1. Vì sao có hợp đồng tách riêng

Quy tắc làm việc người dùng chốt ngày 2026-09-24: khi task A cần service của task B, B giao hợp đồng trước, phần implement làm sau, để A không phải ngồi chờ. FileService có nhiều bên tiêu thụ (T6/T7/T8/T10 trong plan FileService, G1-03/G1-04/G2-02 trong plan Documents + Office), nên hợp đồng này là đầu ra đầu tiên của FileService (Gate A0) và là thứ duy nhất các bên đó cần để bắt đầu code.

Gate A0 đạt khi các mục ở §8 đã merge vào develop: type, interface, fake và bộ contract test. Module tiêu thụ code và test bằng fake; nghiệm thu với storage thật chờ FileService Gate C, không chờ gì khác.

## 2. Vị trí code và layering

| Thành phần | Vị trí | Được import bởi |
| --- | --- | --- |
| Type, enum, mã lỗi, interface `files.Service`, `files.ReferenceProvider` | `server/internal/files` (chỉ type/interface; import `pkg/db` và `internal/audit` cho `Actor`, không import `internal/service`) | `internal/service` (FileService thật và các module), fake |
| Fake trong bộ nhớ | `server/internal/files/filesfake` | Test của module tiêu thụ |
| Bộ contract test dùng chung | `server/internal/files/filescontract` (`Run(t, factory)`) | Test của fake và của FileService thật |
| FileService thật | `server/internal/service/file_*.go` (T3/T4/T5) | Composition root |

Module trong `internal/service` giữ field kiểu `files.Service`, không giữ struct cụ thể, để test cắm được fake. Handler không gọi `files.Service`: handler parse request, service của module kiểm quyền rồi mới gọi. `server/internal/arch_test.go` thêm luật ở T1a: `internal/files` không import `internal/service` hay `internal/handler`; chỉ `internal/service` gọi `files.Service`.

## 3. Type cốt lõi

Code minh họa đúng hình dạng hợp đồng; tên field có thể đổi chính tả khi viết T1a nhưng không đổi ngữ nghĩa nếu không tăng version.

```go
package files

// FileID is an opaque ULID. Business tables store it; nothing parses it.
type FileID string

// UploadPurpose selects key prefix, policy and required scope. Unknown,
// empty or disabled purposes are rejected before any byte is read.
type UploadPurpose string

const (
    UserAvatar            UploadPurpose = "user_avatar"
    TaskAttachment        UploadPurpose = "task_attachment"
    TaskDescriptionImage  UploadPurpose = "task_description_image"
    TaskCommentAttachment UploadPurpose = "task_comment_attachment"
    ChatAttachment        UploadPurpose = "chat_attachment"
    ChatVoice             UploadPurpose = "chat_voice"
    ChatCallRecording     UploadPurpose = "chat_call_recording"
    MeetingRecording      UploadPurpose = "meeting_recording"
    AuditExport           UploadPurpose = "audit_export"
    DocumentFile          UploadPurpose = "document_file"
    DocumentAsset         UploadPurpose = "document_asset"
)

// Scope is built by the calling module from an already authorized context,
// never from request bodies. OrganizationID is empty only for UserAvatar.
type Scope struct {
    OrganizationID string
    WorkspaceID    string // required when the purpose's scope includes workspace
    UserID         string // required for UserAvatar
}

type Status string // pending, processing, ready, failed, deleting, deleted

// File is the technical view a module may show. It never carries the
// storage locator, credentials or session scope.
type File struct {
    ID             FileID
    OrganizationID string // "" only for account avatars
    Filename       string // sanitized at upload; the one shared name (T1-Q4)
    ContentType    string // verified from content
    SizeBytes      int64
    ChecksumSHA256 string // "" unless the purpose policy requires it (T1-Q2)
    Status         Status
    Metadata       map[string]any // versioned technical attributes (T1-Q1)
    ReadyAt        time.Time
}
```

Policy (byte cap, MIME allowlist, có bắt checksum hay không, chế độ đọc) thuộc registry theo purpose, không do module truyền vào từng lần gọi. Policy ban đầu của Documents: `DocumentFile` 50 MiB, `DocumentAsset` 10 MiB, bắt buộc checksum, đọc bằng proxy (DOC-004 không cho client thấy đường dẫn hay khóa storage).

## 4. Interface module gọi

```go
package files

type Service interface {
    // Upload streams one logical upload. Same IdempotencyKey + same command
    // returns the earlier result; same key + different command -> conflict.
    Upload(ctx context.Context, in UploadInput) (Upload, error)

    // CancelUpload revokes an unclaimed staged upload. Claimed -> already_claimed.
    CancelUpload(ctx context.Context, in CancelInput) error

    // ClaimInTx attaches staged or reusable files inside the module's own
    // transaction. q is the module's q.WithTx(tx); rollback leaves files staged.
    ClaimInTx(ctx context.Context, q *db.Queries, in ClaimInput) ([]File, error)

    // ReleaseInTx tells FileService the module removed references, in the same
    // transaction as the removal. Bytes go only after GC re-checks every provider.
    ReleaseInTx(ctx context.Context, q *db.Queries, ids []FileID) error

    // ResolveMany returns views for files the module already authorized.
    // Presign mode fills URL/URLExpiresAt; proxy mode leaves URL empty and the
    // module serves its own authorized route through Open.
    ResolveMany(ctx context.Context, in ResolveInput) ([]Resolved, error)

    // Open streams bytes for a module proxy route (HEAD/Range supported).
    Open(ctx context.Context, in OpenInput) (Reader, error)

    // RegisterProviderOutput records intent + file_id before an external writer
    // (LiveKit egress, Office engine) is started, and returns a write target
    // scoped to exactly that object and deadline.
    RegisterProviderOutput(ctx context.Context, in ProviderOutputInput) (ProviderOutput, error)

    // CompleteProviderOutput verifies the object (Stat, size, MIME, checksum when
    // the policy requires it) and marks it ready + staged for ClaimInTx.
    CompleteProviderOutput(ctx context.Context, in CompleteOutputInput) (File, error)
}
```

| Input chính | Trường bắt buộc |
| --- | --- |
| `UploadInput` | `Actor` (`audit.Actor`), `Purpose`, `Scope`, `IdempotencyKey`, `Filename`, `Body io.Reader`; không có trường content type/size tin được từ client |
| `Upload` (kết quả) | `File`, `UploadSessionID`, `ClaimExpiresAt` (ready + 24 giờ, T1-Q5) |
| `ClaimInput` | `Actor`, `Scope` của đích, `Purpose` của đích, danh sách `FileID`; tùy chọn `Replaces []FileID` để khóa luôn file cũ khi thay thế |
| `ResolveInput` | `Scope`, `Mode` (`presign` hoặc `proxy`, phải khớp policy), `Disposition` (`inline` hoặc `attachment`), danh sách `FileID` |
| `Resolved` | `File`, `URL`, `URLExpiresAt` (tối đa 12 giờ, T1-Q7), hoặc `Err` riêng cho từng ID |
| `ProviderOutputInput` | `Actor`, `Purpose`, `Scope`, `OperationID` (egress ID hoặc office job ID), `Deadline` |
| `ProviderOutput` | `FileID`, `WriteTarget` (PUT URL ký đúng object, hết hạn ở `Deadline`); không trả key hay credential |

Resolve theo lô trả lỗi riêng cho từng ID. File bị thu quyền, đang `deleting` hoặc đã `deleted` nhận lỗi trong `Err` của ID đó, không có URL cũ, và các ID còn lại vẫn trả bình thường.

## 5. Bất biến mà module phải giữ

1. Kiểm quyền trước khi gọi. FileService không có membership; nó chỉ kiểm purpose, scope, tenant và session. `Scope.OrganizationID` phải khớp `files.organization_id`, nếu không thì trả `file_not_found`, không tiết lộ file tồn tại.
2. Chỉ lưu `file_id`. Không lưu URL ký, key, bucket hay blob URL trong bảng hoặc nội dung (rich text, page JSON, `asset://` đều trỏ về ID).
3. Claim và release chạy trong transaction nghiệp vụ, cùng audit/outbox của module. Không có HTTP call riêng để "đánh dấu đã dùng".
4. Thứ tự khóa: `ClaimInTx`/`ReleaseInTx` khóa hàng `files` theo ID tăng dần trước. Module khóa bảng của mình sau lời gọi này, không khóa trước rồi mới gọi.
5. Không giữ transaction mở khi đang stream. `Upload`, `Open` và `CompleteProviderOutput` chạy ngoài transaction.
6. Mọi cột hoặc bảng nghiệp vụ giữ `file_id` phải có `ReferenceProvider` (§6) trước khi purpose được bật ở registry thật. Registry thật từ chối bật purpose chưa có provider; fake thì luôn bật.
7. Module không xóa bytes, không gọi `internal/storage` cho file mới, không tự dựng cleanup worker hay ledger cho object.

## 6. ReferenceProvider

```go
package files

type HoldReason string // active, version_history, soft_deleted, retention, legal_hold

type ReferenceProvider interface {
    Name() string                 // stable, e.g. "documents.versions"
    Purposes() []UploadPurpose    // purposes whose files this provider can hold
    // HeldBy returns every requested ID still held, with the strongest reason.
    // It must see soft-deleted rows, old versions and retention holds.
    HeldBy(ctx context.Context, q *db.Queries, ids []FileID) (map[FileID]HoldReason, error)
}
```

Provider trả lỗi thì GC dừng batch đó. Provider phải tính cả hàng bị ẩn trên UI như version cũ, soft delete và asset đã gỡ khỏi nội dung nhưng còn trong thời gian giữ. Thời hạn giữ (ví dụ asset mồ côi của Documents giữ 7 ngày, purge sau 30 ngày) là policy của module, thể hiện qua việc provider còn trả `retention` hay không, không phải tham số của FileService.

## 7. Mã lỗi

`internal/files` không import `internal/service`, nên cả FileService thật lẫn fake trả `*files.Error{Code, Status}`. Một helper duy nhất trong `internal/service` đổi nó sang `service.CodedError` (đã có sẵn `Code` và `Status`), bọc sentinel `ErrNotFound`/`ErrConflict` ở những dòng ghi sentinel để `errors.Is` vẫn khớp; `mapServiceError` không cần nhánh mới.

| Code | HTTP | Sentinel | Khi nào |
| --- | --- | --- | --- |
| `file_purpose_unknown` | 400 | - | Purpose rỗng, ngoài enum |
| `file_purpose_disabled` | 400 | - | Purpose có trong enum nhưng chưa bật (thiếu provider/policy) |
| `file_scope_invalid` | 400 | - | Scope thiếu trường purpose đòi hỏi |
| `file_too_large` | 413 | - | Vượt cap của policy, đo trên stream |
| `file_type_rejected` | 415 | - | MIME xác minh từ nội dung không nằm trong allowlist |
| `file_not_found` | 404 | `ErrNotFound` | ID không có, khác tenant hoặc không thuộc scope |
| `file_not_ready` | 409 | `ErrConflict` | Claim hoặc resolve file chưa `ready` |
| `file_claim_expired` | 409 | `ErrConflict` | Quá hạn claim 24 giờ |
| `file_already_claimed` | 409 | `ErrConflict` | Cancel một file đã được claim |
| `file_upload_canceled` | 409 | `ErrConflict` | Claim một phiên đã hủy |
| `file_deleting` | 409 | `ErrConflict` | File đã qua hàng rào GC |
| `idempotency_conflict` | 409 | `ErrConflict` | Cùng key, khác command |
| `storage_unavailable` | 503 | - | Adapter lỗi; job giữ lại để retry |

Module được bọc lại lỗi bằng code của mình (ví dụ Documents đổi `file_not_ready` thành lỗi lưu phiên bản), nhưng không đổi mã hiện có của repo (`quota_exceeded` vẫn 403).

## 8. Giao phẩm của Gate A0 (T1a)

- [ ] `internal/files`: type, enum, registry khai báo purpose/prefix/scope/policy (Document purposes ở trạng thái disabled trong registry thật), mã lỗi, interface `Service` và `ReferenceProvider`.
- [ ] `internal/files/filesfake`: fake giữ state trong bộ nhớ, đúng đủ state machine của file và session, idempotency, hạn claim theo clock điều khiển được, lỗi theo §7; fake không giả hàng rào GC mà cung cấp `SimulateGC` để test module thấy `file_deleting`.
- [ ] `internal/files/filescontract`: bộ test chạy được với mọi `factory`; fake phải qua ở A0, FileService thật phải qua ở Gate B/C. Mọi hành vi module dựa vào đều có ca ở đây; hành vi không có ca thì module không được dựa vào.
- [ ] Luật arch test ở §2 và constructor lỗi ở §7 có test mapping HTTP.
- [ ] Không migration, không nối `cmd/server/main.go`, không đổi consumer hiện tại ở T1a.

## 8.1 Test bắt buộc của bên tiêu thụ

Code theo fake không miễn test tích hợp. Mỗi module tiêu thụ giao đủ ba lớp theo [plan FileService §6.1](../plans/2026-09-22-shared-file-service.md):

1. **Unit** trên `filesfake`: claim trong transaction nghiệp vụ và rollback, release khi gỡ, ReferenceProvider trả đúng hold (kể cả version cũ và soft delete), mọi mã lỗi §7 mà module xử lý.
2. **Smoke** `@files-smoke` trên FileService thật + MinIO local sau Gate C: upload, hiển thị, tải đúng bytes.
3. **E2E** Playwright cho luồng người dùng của module, gồm ca hai tổ chức và ca lỗi chính.

Trước khi module đang chạy chuyển sang FileService, test hồi quy của hành vi hiện tại phải có và xanh (plan §6.1, bước 0); cùng bộ đó phải xanh sau khi chuyển.

## 9. Đổi hợp đồng

Version hiện tại: **FS-C1 v1**. Sau Gate A0, mọi thay đổi chữ ký, trạng thái hay mã lỗi phải tăng version, cập nhật fake và contract test trong cùng PR, rồi báo các bên đang tiêu thụ (plan FileService T3-T10, plan Documents + Office G1-03/G1-04/G2-02). Bên tiêu thụ không tự vá fake cho khớp code của mình; sai lệch thì sửa hợp đồng.
