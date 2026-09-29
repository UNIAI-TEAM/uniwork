# UniWork Office G3 - Editor sáu định dạng trên web

> **Trạng thái:** in-progress - spec v1.3 để duyệt, cập nhật 2026-09-29; đã reconcile baseline G1/G2 đã merge và handoff evidence, giữ quyết định bỏ autosave của người dùng; chưa triển khai hoặc nghiệm thu sản phẩm.

**Issue tài liệu:** UNI-819, parent UNI-437. **Issue triển khai:** G3 UNI-659.
**Roadmap:** C-01, liên quan C-15/C-16. **Spec đồng hành:** [G4 desktop](2026-09-27-office-g4-desktop-design.md).

## 1. Mục tiêu và nguồn quyết định

Người dùng mở một tài liệu trong Documents, sửa bằng editor đúng định dạng, lưu thành
phiên bản trong cùng Document và mở lại được nội dung đã lưu. Web và UniWork Office
desktop dùng cùng hợp đồng engine, quyền, phiên bản và lỗi. G3 triển khai UI và host
web; Documents tiếp tục là kho nghiệp vụ duy nhất.

Người dùng yêu cầu viết spec G3/G4 trong khi G1/G2 đang triển khai. Spec này cho phép
chia việc theo đầu vào để bốn nhóm tiến hành song song; không coi yêu cầu viết spec
là lệnh khởi chạy implementation. Các mục ghi **đề xuất** chưa phải quyết định đã duyệt.

### 1.1 Baseline và thứ tự ưu tiên

| Nguồn | Cách dùng |
| --- | --- |
| `develop` tại `c6b567f0` | Baseline checkout tài liệu; G0 đã merge, không có UI Office sản phẩm |
| [Spec G0](2026-09-16-documents-office-g0-design.md), [yêu cầu FE](2026-09-16-documents-office-fe-design.md) | Q1-B, Q2-A, Q3-B, Q4-A, Q5-A, Q7-B, Q8-A, Q9-A; screen/state map. Từ quyết định 27/09/2026, yêu cầu autosave ở FE §4.2 (`dirty --> saving: autosave`) và §5.4 (autosave đã debounce) được thay bằng lưu thủ công + checkpoint nháp cục bộ theo G3 §4.3 cho file Office trên web/desktop; autosave page JSON của G1 giữ nguyên |
| [ADR 0021](../../adr/0021-runtime-engine-office-da-dinh-dang.md), [runtime map](../../office/g0/module-runtime-map.json) | Runtime theo thao tác, không suy từ phần mở rộng file |
| [C-01 Documents](2026-09-08-documents-design.md), [DOC-005](../../office/g0/login-sync-contract.md) | Quyền, ownership, phiên bản, lỗi, nháp, bản sao |
| [FS-C1 v1](2026-09-24-file-service-contract.md) | FileService sở hữu byte, upload intent, GC; Documents giữ `file_id` |
| G1/G2 đã merge vào checkout này tại `469607fcd610498f7f7c93f56a9ca81cfbb0923f` | Plan ngày 18/09, ADR 0024, C-01 §14, FileService alignment và handoff G2-07; code/schema/API đã có trong baseline hiện tại, nhưng H4 vẫn chỉ được nhận khi có acceptance packet cuối |
| [Handoff G0](../../office/g0/handoff-map.md), [pilot assertions](../../office/g0/pilot-handoff.md), [ngưỡng đo](../../office/g0/acceptance-thresholds.md) | Phân biệt bằng chứng lab, giới hạn còn mở và nghiệm thu sản phẩm |

Đường dẫn G1/G2 ở revision trên: `docs/superpowers/plans/2026-09-18-documents-office-g1-g2.md`,
`docs/adr/0024-fileservice-so-huu-blob-intent-gc.md`, `docs/office/g1g2/fs-c1-alignment.md`,
`docs/office/g1g2/packaging-and-handoff.md` và `docs/office/g1-g2-evidence.md`. Các file
đã có trong checkout hiện tại là contract/handoff và bằng chứng provider, không phải
bằng chứng G3 đã triển khai. Handoff hiện tại cho phép consumer dùng API/core/engine
seam đã giao; H4/full six-format acceptance vẫn phải lấy từ acceptance packet cuối,
không suy ra từ việc task G1/G2 đã merge.

Các quyết định U-1..U-4 đã được người dùng duyệt ngày 27/09: giữ layout G1/G2,
FileService giữ byte/intent/GC, C-01 §14 có hiệu lực, PDF web dùng codec ảnh Node
ở G2-05. Những quyết định này không được mở lại chỉ vì checkout spec còn cũ.
Nội dung hợp đồng được nhắc lại ở §4 để spec tự đọc được. Nếu phát hiện khác biệt
với contract provider mới hơn, giải quyết và tăng revision contract trước khi code.

### 1.2 Kết quả mong đợi

- Cả DOCX, XLSX, PPTX, PDF, Markdown và HTML có điểm vào trong cùng khung Documents.
- Mỗi thao tác phản ánh capability đã kiểm chứng của đúng engine/host/build.
- Lưu thành công có version/revision từ server; lỗi lưu giữ bản sửa và chỉ dẫn xử lý.
- UI tuân quyền hiện tại, Work Product ownership, vi/en, keyboard và hai theme.
- G3/G4 tái sử dụng editor, state machine và contract; khác ở adapter host.

## Điểm cần người dùng quyết

**Đã chốt ngày 27/09: bỏ autosave file Office.** Cloud chỉ tạo version khi người
dùng bấm Lưu, Ctrl/Cmd+S hoặc chọn Lưu trong dialog. Không commit theo timer/idle,
đóng tab, rời trang hay reconnect. Nháp bền cục bộ vẫn checkpoint để chống mất chữ,
không upload, không thêm `document_versions`/`file_id` và không tính vào quota cloud.
Đây là thay đổi hành vi G3/G4 file Office; autosave page JSON của G1 giữ nguyên.

C-01 §14 không có working copy cho file: mỗi commit thành công tạo immutable version
và giữ byte tương ứng. Quyết định trên bỏ nhịp commit 2 giây của v1; không thay nó
bằng idle 30-60 giây, working-file-version hay squash. §4.3 và G3-A02 là hợp đồng mới.

Các điểm **còn mở** để duyệt, tách khỏi quyết định lưu đã chốt:

| Mã | Đề xuất để duyệt / lý do | Chặn phần nào |
| --- | --- | --- |
| G3-D1 | IndexedDB giữ ciphertext; khóa theo account/deployment, unlock sau login và live ACL. Khuyến nghị wrapping/unlock gắn phiên backend; chốt threat model, rotation/recovery và chủ endpoint auth. Không giữ khóa raw cạnh ciphertext | Durable browser draft; shell/state tests vẫn làm được |
| G3-D2 | Preview HTML trên host/origin riêng, sandbox opaque, asset broker giới hạn manifest; chốt hostname/on-premise routing, CSP và tài nguyên được phép với G2/OPS | Preview production và asset acceptance |
| G3-D3 | G3 đo render diff, người review có tên ký theo từng format; không đặt một tỷ lệ pixel chung chưa đo | Tuyên bố fidelity/pilot, không chặn viết shell |

## 2. Phạm vi và ranh giới

| Thuộc G3 | Chủ phối hợp / giới hạn |
| --- | --- |
| Editor shell, toolbar từng format, chế độ toàn màn hình, tab, trạng thái lưu | G1 giữ route/detail shell; G3 cung cấp vùng editor và action contract để owner gắn vào |
| Tạo/mở/sửa/lưu/undo/redo, export theo capability, UI chuyển đổi có đồng ý | G2 giữ engine, adapter, serialize và conversion; G1 giữ mutation nghiệp vụ |
| Browser draft adapter, cảnh báo rời trang, recovery UI | Dùng hợp đồng nháp chung; lựa chọn khóa web ở G3-D1 |
| Hiển thị lỗi, fidelity warning, read-only/unavailable, quyền bị thu | G1 giữ quyền thật; G2 cung cấp typed error và fidelity report |
| HTML preview cách ly, ánh xạ asset vào Document | G2-06 giữ thao tác/manifest asset; G1 giữ file/asset và quyền đọc |
| Responsive, accessibility, i18n, brand và bằng chứng trình duyệt thật | G7 gom evidence; UNI-671 giữ Mac/Safari thật |

G1 tiếp tục sở hữu thư viện/cây, page JSON editor, tìm kiếm, chia sẻ, bình luận,
lịch sử và access log. G3 dùng các panel đó; không dựng bộ panel hay cache thứ hai.
Page TipTap và file Office là hai loại editor, không biến Markdown của task/chat
thành schema tài liệu Office.

G4 giữ desktop login, OS filesystem, keychain và installer. G5 giữ change feed,
tombstone sync, thư viện offline, hàng đợi bền và hai chiều giữa thiết bị. G6 giữ AI
proposal/confirm/execute. Office coauthoring là UNI-662, không suy ra từ lưu phiên bản.
OCR PDF scan thuộc mốc sau theo Q2-A. Linux/Firefox chưa thuộc cam kết Q3-B.
Các chức năng này không được tính là G3 đã làm chỉ vì có nút hoặc adapter giả.

## 3. Làm song song với G1/G2/G4

### 3.1 Điều kiện bắt đầu khác điều kiện nghiệm thu

| Mốc | Đầu vào cần có | G3 có thể làm / kết luận |
| --- | --- | --- |
| W0 - Contract | Schema có revision, fixtures/fake do provider duy trì, owner từng seam | Shell, trạng thái, UI lỗi/quyền, draft adapter và format UI theo contract |
| W1 - Từng format | API G1 tương ứng, adapter G2 của format, host contract thực tế | Ghép mở/sửa/lưu thật cho format đó; không chờ mọi format |
| H1 của G1/G2 | API nền với DB + FileService thật, quyền/commit/version/upload/download/assets | Dùng làm nền kiểm đường lưu; fake không thay được H1 |
| H3/H4 của G1/G2 | Sáu adapter đạt ma trận; Go + DB + FileService + engine thật qua suite | H4 là bàn giao nền hoàn chỉnh; không tự đổi định nghĩa gate |
| W2 - G3 đủ điều kiện bàn giao | H4 + acceptance G3 và bằng chứng giới hạn platform | Bàn giao web cho G7; không đồng nghĩa pilot đã đạt |

G3 có thể ghép thử trước H4, nhưng không nghiệm thu nền G1/G2 hộ nhóm sở hữu.
Capability còn thiếu theo Q1-B là việc còn phải làm, không biến thành ngoài phạm vi
bằng cách ẩn nút. Khi chưa đủ runtime, shell phải hiển thị trạng thái trung thực.

### 3.2 Ownership khi chạy đồng thời

| Bề mặt | Chủ ghi | Bên tiêu thụ |
| --- | --- | --- |
| Documents API, schema, query keys, save mutation | G1-05 / UNI-679 | G3 và G4 |
| Route/detail, nav, panel Documents | G1-06/08 / UNI-680/682 | G3 giao editor slot/actions; G4 dùng view không phụ thuộc Next |
| Engine facade, capability registry, protocol, upstream patches | G2-01 / UNI-684; adapter theo G2-03..06 | G3/G4 gửi yêu cầu thay đổi, không fork registry |
| UI Office chung, trạng thái mở/lưu/phục hồi | G3 / UNI-659 | G4 tái sử dụng; chủ shared contract duyệt thay đổi |
| Browser worker/transport bindings | G2 giao seam ban đầu; G3 nhận ownership sau bàn giao có revision | G4 không sửa browser implementation |
| Desktop main/preload, auth, local I/O, packaging | G4 / UNI-636 | G3 chỉ gọi host interface |

Đổi chữ ký hoặc hành vi contract phải có version, sửa schema/fake/contract tests cùng
lượt và thông báo bên tiêu thụ qua workflow điều phối. Không chỉnh fake để che lệch
backend. Không hai nhánh cùng nhận quyền sửa lockfile, registry hoặc detail shell.

## 4. Hợp đồng dùng chung G3/G4

Mục này là hợp đồng hành vi `Office Editor Host v1` đề xuất trong spec; không khai
báo một protocol engine mới. G2 tiếp tục sở hữu `contract_version`, `protocol_version`
và `engine_version` đã có trong `@uniwork/office-contracts`/`@uniwork/office-engine`.
Các TypeScript names dưới đây là tên trách nhiệm của G3/G4; symbol product-level còn
phải được tạo hoặc map qua handoff, không được nhân đôi engine host-port/registry.
Wire JSON dùng snake_case theo `docs/conventions.md`.

### 4.1 Identity, capability và host

| Hợp đồng | Dữ liệu / hành vi bắt buộc |
| --- | --- |
| Document identity | Account/session generation, organization, workspace, document; tên/path không phải identity. Version id là ULID; revision wire là chuỗi thập phân, không ép sang `Number` |
| Open descriptor | Identity, `kind`, format/content type đã xác thực, current version/revision, checksum/size, quyền hiện tại, metadata engine, read handle đã authorize |
| Capability entry | Format + operation + host + engine build + contract revision; trạng thái available/read-only/unavailable/unknown, lý do và fidelity warnings. `unknown` không mở quyền sửa |
| Editor handle | Open/dispose, dirty generation, serialize snapshot, undo/redo, export/print nếu có, nhận lỗi có cấu trúc; callback cũ không cập nhật editor mới |
| Host adapter | Read/write qua Documents, job progress/cancel, asset resolve, draft checkpoint/recover/discard, external-open khi host hỗ trợ; không có generic IPC, arbitrary URL hoặc filesystem path trên web |
| Save intent | Identity + base revision/version + checksum/length + operation/options + idempotency key + snapshot generation; bất biến trong suốt retry cùng thao tác |
| Save receipt | Document/version/revision được commit, checksum/size và metadata engine được server xác nhận; chỉ receipt khớp intent mới đổi base |
| Draft identity | Account + org + ws + doc + base revision + base version; tách thêm deployment origin ở host để on-premise không trộn với cloud |

Client dùng MIME/content type đã xác thực và registry, không tin extension hay
content type người upload tự khai. Capability engine và quyền nghiệp vụ là hai
điều kiện độc lập: có edit capability không đồng nghĩa actor có `edit`.

### 4.2 Một đường lưu vào Documents

Các path bên dưới được ghi tương đối với `/api/v1`; SDI/SDO thật do G1-05 phát hành.

| Thao tác | Contract đã duyệt ở C-01 §14 |
| --- | --- |
| Upload byte cho Document đã có | `POST /documents/{documentID}/uploads`, multipart `file`; trả `upload_id`, `checksum_sha256`, `size_bytes`, `claim_expires_at` |
| Commit version | `POST /documents/{documentID}/versions/commit`, body `{upload_id, base_revision}`, header `Idempotency-Key` |
| Tạo Document file | `POST /workspaces/{workspaceID}/documents/files`, multipart; không dùng commit vào một id chưa tồn tại |
| Tạo bản sao chuyển đổi | `POST /documents/{documentID}/copies`, bắt buộc `consent: "copy"`; shape còn lại theo SDI G1/G2 |
| Đọc file/version/asset | Proxy Go có kiểm quyền, access log và Range/HEAD theo contract; không trả key, bucket hoặc presigned storage URL |

`upload_id` là `file_id` của FileService. Engine output dùng provider-output flow
G2 rồi đi cùng commit này. Go kiểm checksum/size thực, engine compatibility, quyền
lúc commit, base và quota; transaction chứa version/current pointer, `ClaimInTx`,
audit/outbox và idempotency result. UI không tự cấp quyền hoặc tự ghi version.

Không thêm `/versions/file`, Office object ledger, storage URL hay cơ chế GC riêng.
Trần `document_file` 50 MiB, `document_asset` 10 MiB theo FS-C1; quota tổ chức là
`storage.bytes`, không phải 50 MiB cho cả tổ chức. Engine có giới hạn thấp hơn phải
công bố theo capability, không đổi trần storage một cách ngầm định.

### 4.3 Lưu thủ công, checkpoint nháp, race và hủy

1. **Chỉ chủ động lưu mới tạo cloud save intent.** Nút Lưu, Ctrl/Cmd+S và lựa chọn
   “Lưu rồi đóng/rời trang” dùng cùng coordinator, sau khi open thành công, actor
   còn `edit` và capability ghi hợp lệ. Không autosave theo timer, idle hoặc blur;
   navigation, đóng tab, logout hay reconnect không tự tạo intent mới.
2. **Nhịp 2 giây chỉ dành cho checkpoint nháp cục bộ** qua protected draft adapter
   (IndexedDB/OS store), không gọi upload/commit hay tạo output FileService để lưu.
   Chụp snapshot ổn định, không giữa IME composition hoặc gesture chưa kết thúc.
   Ghi nháp thành công chỉ được báo “Đã giữ nháp trên thiết bị”, không phải “Đã lưu
   lên UniWork”. Lỗi ghi phải hiển thị; không hứa bảo vệ byte chưa được xác nhận.
3. Mỗi Document/editor session chỉ một commit đang chạy. Snapshot N đang lưu không
   khóa gõ; N+1 vẫn dirty và checkpoint cục bộ, không tự nối thêm một lần cloud save.
   Chặn lệnh Lưu mới từ nút, menu, Ctrl/Cmd+S và dialog trong suốt lần lưu N;
   không xếp hàng hoặc giữ lệnh chờ cho N+1. Control Lưu thể hiện trạng thái không
   khả dụng; shortcut không khởi tạo intent. Khi N đã có kết quả xác định, nếu còn
   dirty và đủ điều kiện lưu thì bật lại; người dùng phải bấm Lưu mới cho N+1.
   Không serialize lại rồi dùng key N; retry/đối chiếu intent N theo mục 4 và 6.
4. Retry có giới hạn chỉ hoàn tất intent mà người dùng đã yêu cầu, giữ cùng snapshot
   và key; `idempotency_in_flight` dùng backoff. Chỉ receipt N hợp lệ mới đổi base cho
   lần lưu kế tiếp. Receipt N không xóa nháp N+1 hoặc báo toàn bộ tài liệu đã lưu.
   Reconnect không quét dirty store để tạo save mới.
5. Hai tab/thiết bị giữ base riêng; server phát hiện conflict. Không đổi base và tự
   gửi byte cũ để giả lập merge. Undo/redo là local history, không xóa version server.
6. Hủy upload/job chỉ dừng phần chưa commit. Hủy request không chứng minh server
   chưa commit; đối chiếu cùng intent/key trước khi cho tạo thao tác mới. Race
   cancel/complete phải có đúng một kết quả logic, giữ nháp khi chưa xác định được.
7. Mỗi **lần lưu thủ công có thay đổi** được commit tạo một immutable file version.
   Dirty generation không đổi từ receipt gần nhất thì nút Lưu không upload/commit
   thêm. Double-click/retry cùng intent không sinh phiên bản thừa. Mốc có nhãn theo
   policy G1 là thao tác riêng; không tạo thêm mốc chỉ vì file vừa commit. Không áp
   working-copy/auto-version 10 phút của page JSON sang file; C-01 §14 không đổi.
8. Khi rời/đóng editor còn dirty, cho chọn Lưu, giữ nháp trên thiết bị rồi rời, bỏ
   thay đổi có xác nhận, hoặc ở lại. Chỉ lựa chọn Lưu mới gọi cloud save; nếu lưu lỗi
   hoặc còn N+1 chưa lưu thì không tự đóng. `beforeunload` không gửi upload/commit.
   Account switch/dispose tăng generation, hủy callback cũ; response A không cập
   nhật cache/editor B. Chỉ snapshot được checkpoint mới có bảo đảm phục hồi.

### 4.4 Error dispatch và trạng thái

Dispatch theo `error.code` và `error.error_class`, không parse message hoặc chỉ dùng
HTTP status. Class định tuyến nhóm UI; code quyết định retry, conflict hay recovery.

| Code / tình huống | Nguồn / ai phát hành | Trạng thái và hành động |
| --- | --- | --- |
| Open đang chạy / thành công | State client, G3/G4; không là mã HTTP | `loading` -> `ready`; không dựng file rỗng trong lúc chờ |
| Có edit / đang gửi / có receipt | State client theo §4.3, G3/G4 | `dirty` -> `saving` -> `saved`; nếu có sửa mới thì vẫn `dirty` |
| `revision_conflict` 422, `document_version_conflict` 409 | Contract C-01 §5.5/§14.5; G1-05 phát hành HTTP/schema, G1 commit quyết lỗi | `conflict`; giữ bản sửa và bản server, không tự overwrite |
| `idempotency_in_flight` | C-01 §14.5; G1-03/05 | Vẫn `saving`, retry intent cũ cùng key/backoff; không bật dialog hai bản |
| `idempotency_payload_mismatch`, `idempotency_key_reuse` | C-01 §14.5; G1-03/05 | Dừng tự retry, giữ nháp, báo lỗi thao tác; không coi là lưu thành công |
| `document_upload_invalid`, upload hết hạn | C-01 §14.5 bọc lỗi FS-C1; G1-03/05 | Giữ intent/nháp; đối chiếu kết quả cũ rồi yêu cầu người dùng lưu lại để upload mới |
| `quota_exceeded` **403**, class `quota` | Entitlement repo + C-01 §14.5/FS-C1; G1-05 giữ HTTP 403, bổ sung class | `quota-blocked`, giữ nháp; không nhầm với thu quyền |
| `file_too_large` 413 | FS-C1 và C-01 §5.5/§14.5; provider evidence và mapping Documents ở [G1-G2 evidence](../../office/g1-g2-evidence.md) | Báo vượt trần file, giữ nháp; không retry cùng file tự động |
| `unauthorized` 401; `token_expired` 401 chỉ khi auth contract phát hành | `unauthorized` có ở middleware auth baseline; `token_expired` mới ở model DOC-005, chưa có ở server baseline. Chủ auth/G4 + G1-05 chốt mapping | Refresh theo auth transport hiện có có giới hạn; thất bại khóa editor/login lại, giữ nháp; không chờ mã lab mới xử lý 401 |
| Mất `edit`, còn `view` | Quyền G1; state client G3/G4 | `readonly` cho byte đã commit; draft riêng `blocked`, không export/copy/clipboard payload nháp |
| `forbidden` hoặc mất `view` | Repo/C-01, membership + Document ACL G1; G1-05 giữ envelope | `blocked`, ẩn nội dung/preview đã tải khỏi UI, dừng mutation, giữ nháp được bảo vệ |
| `not_found` 404 / `document_deleted` 410 | `not_found` theo repo; `document_deleted` theo C-01 §14.5; G1-05 phát hành | 404 không xác nhận tồn tại; `deleted` dừng retry. Cả hai không tự xóa nháp |
| `engine_incompatible` | C-01 §14.5 + DOC-004; G2 kiểm compatibility, G1-05/G2-07 phát hành public error | `incompatible`; chỉ đọc nếu đường đọc tương thích đã chứng minh |
| `storage_unavailable` | Mã đã có trong repo; Documents dùng 503 theo C-01 §14.5/FS-C1, G1-05 giữ mapping; không sao chép 501 của handler legacy | `save_error`, giữ nháp, retry intent đã yêu cầu sau kiểm session/quyền; không báo đã lưu |
| Network, timeout, engine crash | Transport/host G3/G4 hoặc typed engine errors G2, không mặc định là HTTP code | `save_error`, giữ nháp, không tự tạo save intent mới |
| `draft_recovery_locked`, ciphertext hỏng/mất khóa | Mã model DOC-005; host draft adapter G3/G4 phải phát hành typed result, chưa là lỗi HTTP server. G1-05 chỉ thêm wire mapping nếu contract đó được duyệt | `recovery-locked`, giữ byte gốc, không tạo store rỗng ghi đè |
| Open corrupt/unsupported/password cancel | G2 typed open result + state G3/G4 | `open-error` có lý do; không Save hoặc grid/page rỗng |

“Contract C-01” là yêu cầu phải ship, không chứng minh endpoint đã triển khai. G1-05
phát hành bảng code/class/HTTP cùng schema/fake/contract tests, kiểm mã nào đã có,
mã nào bổ sung. Mã chỉ có trong model không được mô tả thành API server đã tồn tại;
đổi auth code phải giữ tương thích `unauthorized` và sửa tài liệu DOC-005 cùng lượt.

Code/class mới chưa hiểu chuyển thành lỗi an toàn, có correlation id, không bật edit
hay retry vô hạn. `resyncing` chỉ xuất hiện khi G5 cung cấp change-feed adapter thật.

### 4.5 Nháp và quyền phục hồi

- Save failure, logout, token hết hạn, đóng tab/restart phải bảo toàn nháp đã ghi bền.
  Không hứa bảo toàn các phím gõ chưa được checkpoint; UI hiển thị lỗi ghi nháp và
  không báo đã bảo vệ khi store chưa xác nhận.
- Draft list chỉ trả metadata. Recovery là đường duy nhất trả payload, sau kiểm đúng
  account/deployment/scope, quyền `edit` hiện tại và cả base revision + base version.
  Base khác chuyển conflict; không tự merge binary hay tự nâng base.
- Nháp ở base khác nhau không ghi đè nhau. Chỉ xóa đúng snapshot đã commit hoặc khi
  chủ nháp xác nhận bỏ. Sai khóa/parse/IO error không có nghĩa “không có nháp”.
- Nháp không vào FileService, không chịu staged TTL/GC; account switch xóa plaintext
  trong bộ nhớ và thu hồi object URL, không xóa ciphertext của tài khoản trước.
- Không đăng ký Office draft vào đường cleanup hiện có vốn xóa global storage khi
  logout. `cleanup-registry.ts` là điểm cần tích hợp có kiểm chứng, không tái sử dụng
  trực tiếp policy xóa của task/chat. Adapter browser và desktop dùng cùng suite hành vi.
- Browser không có OS keychain: lựa chọn khóa và unlock là quyết định G3-D1, phải
  được giải quyết trước khi nhận durable recovery. Không coi localStorage plaintext,
  khóa cố định trong bundle hoặc tên key có account id là bảo vệ nháp.
- Sau mất quyền, không có nút tải/copy nháp để đi vòng ACL. Bản server đã commit vẫn
  có thể tải khi còn `view` và policy cho phép; đó không phải đường xuất nháp.

## 5. Trải nghiệm web

### 5.1 Khung và điều hướng

G1 sẽ giao route/detail Documents; chưa coi đó là UI đã ship. Tái dùng pattern
`BreadcrumbHeader` và `PAGE_TOOLBAR` hiện có trong `packages/views/layout/`;
`PAGE_TOOLBAR` được định nghĩa tại `packages/views/layout/page-header.tsx`, đang dùng
ở admin và projects, không phải primitive do G1 tạo. Header có tiêu đề,
trạng thái lưu, quyền, actions và một panel phải đổi giữa phiên bản/bình luận/nhật ký.
Toolbar đổi theo editor đang hoạt động; capability không có thì không hiện nút có vẻ
sử dụng được. Fullscreen chỉ đổi bố cục, không đổi document/session hoặc dựng editor thứ hai.

Trạng thái lưu dùng cùng bộ nhãn và i18n keys vi/en với [G4 §7.2](2026-09-27-office-g4-desktop-design.md#72-thư-viện-và-editor):
“Đã giữ nháp trên thiết bị”, “Đã lưu trên máy”, “Đã lưu lên UniWork”, “Chưa gửi”,
“Không có quyền sửa” và conflict. Copy thuộc shared Office UI, không định nghĩa
bản dịch riêng theo host. Web chỉ hiện nhãn đúng đích và trạng thái thực: checkpoint
không là “Đã lưu trên máy” hoặc “Đã lưu lên UniWork”; receipt N không che N+1 còn dirty.

Đổi tên gọi mutation metadata của G1 theo quyền hiện tại, không đổi document id hoặc
base byte âm thầm; title vừa đổi không làm mất dirty snapshot. Nút “Mở bằng UniWork
Office” dùng launch contract G4 §5.1 khi capability đó sẵn sàng. Khi có sửa chưa lưu,
cho chọn “Lưu rồi mở” (đợi receipt), “Mở bản đã lưu” hoặc Hủy; không tự commit do
người dùng chỉ bấm nút mở desktop. Chỉ handoff version tương ứng lựa chọn đã xác nhận;
không gửi nháp trong deep link hay tự claim desktop sẽ có các sửa chưa lưu. App chưa
cài/callback không thành công thì web vẫn giữ tài liệu, báo bước tiếp theo rõ ràng.

Đề xuất tab là state cục bộ của khung Office, không tab trình duyệt được mở ngầm.
Mỗi tab giữ identity/base/dirty riêng; đóng tab dirty yêu cầu lưu, giữ nháp đã checkpoint
hoặc bỏ có xác nhận. `beforeunload` chỉ là lớp cảnh báo bổ sung, không thay durable draft.
Tạo blank là hành động “Tạo mới” rõ ràng, không phải fallback của lỗi open.

Documents thuộc Work Product có breadcrumb theo owner, không xuất hiện trong cây,
recent/library chung, không có chia sẻ riêng; route trực tiếp vẫn dùng quyền delegated.
Khi C-14 chưa cung cấp resolver, fail closed; không tạo owner_id hoặc ACL thay thế từ UI.

### 5.2 Khả năng từng định dạng

Đây là yêu cầu nghiệm thu, không phải danh sách tính năng đã port. Mọi capability
Q1-B trong inventory phải được map tới owner/test; sáu chu trình tối thiểu không đủ
để tuyên bố toàn bộ Q1-B đạt. Theo ADR 0021, host/worker/service khác nhau từng thao tác.

| Định dạng | UI/chức năng phải có theo ma trận | Oracle tối thiểu và giới hạn cần giữ |
| --- | --- | --- |
| DOCX | Định dạng chữ/đoạn, bảng, ảnh, layout, header/footer theo capability; undo/redo, save/reopen | Text đổi đúng, bảng/ảnh và phần không sửa được bảo toàn. G0 mới chứng minh paragraph cycle; không tự nhận bảng/ảnh/header/footer đã đạt |
| XLSX | Nhiều sheet, ô/vùng, công thức, định dạng/chart theo matrix; trạng thái recalc | Formula ra số đúng sau sửa và reopen; sheet structure được giữ. Recalc native ở service G2, không giả là browser/WASM |
| PPTX | Slide/textbox/ảnh/shape/layout, presenter mode theo capability | Text/ảnh/shape đổi thật, object chưa sửa còn nguyên; gesture cần `host:slides-edit-transform` hoặc từ chối rõ |
| PDF | Xem, sửa chữ/ảnh hiện có, thao tác trang theo capability, save/export | Extraction và render độc lập trước/sau; annotation không thay cho sửa nội dung; OCR scan chưa thuộc mốc; ảnh dùng codec Node G2-05 |
| Markdown | Source + preview, giữ raw text/frontmatter/table chưa render, asset | Sau edit/save/reopen source và asset đúng, không âm thầm normalize làm mất nội dung |
| HTML | Source + preview cách ly, asset tương đối, save/reopen | Script tài liệu không đọc session/API của app; source/asset không biến mất sau round-trip |

Export/print chỉ được bật theo operation capability và quyền hiện tại. Khi export
khác format có thể mất nội dung, dùng Q7; không xem “download original” là chứng minh
serialize hay convert thành công. Chỉ export committed byte hoặc snapshot edit được
phép; không mở đường xuất nháp blocked. Password không xuất hiện trong log/audit/draft
plaintext; DOCX mã hóa không có re-encrypt capability phải từ chối save rõ ràng (G2 P5).

### 5.3 HTML/Markdown asset và preview

- Document giữ asset identity ổn định; manifest ánh xạ relative path chuẩn hóa sang
  asset id, không storage key/path. Cấm traversal, absolute OS path, symlink escape,
  import tài nguyên cloud ngoài scope và redirect qua host không cho phép.
- Đổi nguồn có asset mới phải upload/authorize asset qua contract G1/G2 và commit
  reference đúng snapshot; không công bố saved khi asset cần thiết chưa sẵn sàng.
- Preview HTML chạy ở origin cách ly với app, iframe sandbox không `allow-same-origin`,
  không cookie/token/API bridge của app. Chỉ đổi port trên cùng host không đủ cách ly.
- CSP, frame policy và proxy asset do host kiểm soát; sandbox script chỉ được chạy nếu
  runtime contract cho phép và vẫn bị chặn top-navigation, popups, downloads, fetch tới
  API app và mạng ngoài không được duyệt. Không tự tải tracking URL trong tài liệu.
- Asset delivery vào preview không đính Bearer/cookie app; bridge chỉ phục vụ asset
  đã authorize trong manifest, ràng buộc frame/session, không nhận URL tùy ý. HTML
  không đi qua `dangerouslySetInnerHTML` trong origin UniWork.
- Chính sách origin triển khai và limit asset manifest là G3-D2; phải nghiệm thu với
  header/proxy production thật, không chỉ sandbox lab.

### 5.4 Q7: chuyển đổi có cảnh báo và bản sao

G2 đưa ra phần sẽ thay đổi/mất cùng capability; UI hiển thị trước khi người dùng
chọn tạo bản sao. Cancel không tạo Document, version hoặc job ghi output nghiệp vụ.
Accept gửi `consent: "copy"`; server tạo Document mới, giữ nguồn nguyên checksum,
version/history/ACL, ghi provenance. Người tạo có `edit` không được nâng thành `manage`.
Nguồn thuộc Work Product thì bản sao thuộc cùng owner qua service hợp lệ; khi C-14
chưa có đường này, hiển thị unavailable, không tạo tài liệu tự do thay thế.
Q7 conversion engine còn là việc G2; UI warning không chứng minh chuyển đổi chạy được.

### 5.5 Accessibility, responsive, i18n và theme

Theo thiết kế UniWork hiện hữu: semantic tokens, module Documents orange, vi là nguồn
và en đủ parity. Theme chỉ đổi chrome; không sửa font/màu/page background tác giả đã
lưu trong file. Có fixture so nội dung/byte để chứng minh đổi theme không sửa tài liệu.

Kiểm 360/375/768/1280 px, hai theme, zoom và bàn phím; panel phải chuyển drawer/overlay
khi thiếu chỗ, canvas không được co về 0 px. Không đưa AI panel trống vào G3 khi G6
chưa có. Mobile phải xem/điều hướng/tải được; thao tác sửa chưa hỗ trợ phải báo rõ,
không coi responsive shell là nghiệm thu mọi gesture Office trên mobile.

Focus visible, dialog trả focus, control có accessible name, vùng lỗi dùng alert,
trạng thái lưu không đọc dồn mỗi phím, target chạm tối thiểu 44 px. Canvas dùng
accessibility support thực của engine và có keyboard flow được kiểm chứng; không
gắn `aria-label` rồi tuyên bố toàn editor đạt. Ctrl/Cmd+S theo host; `/` và `@` giữ
nguyên trong source/code/formula, không bị global shortcut nuốt.

## 6. Kiến trúc và dữ liệu

Giữ layout U-1: `packages/office-contracts`, `packages/office-engine` có exports
browser/node/desktop, `packages/office-upstream`, `apps/office-engine` và
`apps/web/platform/office`. G3 không nhân đôi engine package hoặc nâng catalog để
né lỗi port (baseline React 19.2.3, TipTap 3.30.6; version thực theo catalog đã duyệt).

Đề xuất UI chung ở `packages/views/office/`, logic editor/session/draft orchestration
ở `packages/core/office/`, browser bindings tại `apps/web/platform/office/` và
Documents slot tại `packages/views/documents/`. Các đường dẫn mới này là file map
thiết kế, không khẳng định đã có. G2 giữ payload schema, facade và registry; G1 giữ
`packages/core/documents` và endpoints. G3/G4 không gọi transport ngoài endpoint/auth seam.

Server data do Query quản lý; UI state do core store; không chép Document/version
sang Zustand làm nguồn dữ liệu thứ hai. Engine session chỉ giữ working snapshot và
dirty generation. Realtime ids-only invalidates đúng Query keys; không nhét content,
revision patch mới hoặc draft vào event. Khi server version đổi trong lúc dirty,
giữ working snapshot và thông báo; không refetch đè engine state.

Browser entry phải có import-graph gate chặn Node/Electron/native. Mọi network/file
operation ngoài editor đi qua adapter inject; engine không giữ ACL, tài khoản,
credential storage hoặc DB nghiệp vụ. Lazy load theo format; dispose editor hủy
worker/job/listener, thu hồi object URL và plaintext không còn được phép dùng.

Thumbnail/preview chỉ tải theo nhu cầu và qua ACL hiện tại, gắn document/version/build;
cache preview bị loại khi version/quyền/account thay đổi. File lớn dùng progress/cancel,
không mount sáu editor cùng lúc. Preview không có runtime là unavailable, không sinh
ảnh giả; public-link view tiếp tục dùng policy G1, không mở editor có quyền ghi.

## 7. Nghiệm thu và bằng chứng

Các mã dưới đây là requirement/test intent, chưa phải test đã tạo hoặc chạy.

| Mã | Ca bắt buộc | Điều kiện đạt |
| --- | --- | --- |
| G3-A01 | Mở/sửa/lưu/reopen sáu format với stack thật | Version/checksum từ server; fresh session thấy sửa; đúng assertions ở §5.2 |
| G3-A02 | Gõ/idle 10 phút không bấm Lưu; đóng/rời/reconnect; lưu N rồi sửa N+1 và gọi Lưu qua nút/menu/shortcut/dialog lúc N chạy; double-click, hai tab, mất response | Chỉ checkpoint local, không upload/commit hoặc tăng version/file/quota khi chưa chọn Lưu; lệnh Lưu mới bị chặn, không có lệnh chờ; N receipt không xóa N+1, N+1 chỉ gửi khi bấm Lưu mới sau kết quả N; retry cùng intent đúng một version, stale base conflict |
| G3-A03 | Thu edit/view giữa open-upload-commit | Commit bị từ chối, bản server không bị đổi, nháp giữ đúng account; blocked không export |
| G3-A04 | Logout/login B/restart/login A, quota, store hỏng | B không thấy payload A; A recovery theo live ACL/base; không xóa nháp hoặc báo saved giả |
| G3-A05 | P1 PDF lỗi parse; P2 embedded font | Lỗi PDF có phân loại vi/en và open tiếp được; adopted embedded face không bị báo thiếu giả |
| G3-A06 | P3 DOCX corrupt/password cancel; P4 XLSB parse failure | Lỗi gắn document, không blank/grid giả, không cho Lưu hoặc phát sinh cloud write; file hợp lệ kế tiếp mở được |
| G3-A07 | PDF sửa rồi lưu hai lần trong cùng session | Lần hai dùng nội dung sau lần một; không overwrite bằng state cũ; output qua Documents |
| G3-A08 | HTML script/session probe, asset traversal, đổi account | Không đọc session/API app, không asset ngoài manifest/scope, không host privilege |
| G3-A09 | Q7 cancel/accept và Work Product | Cancel không tạo gì; accept có consent/provenance, giữ nguồn/ACL; owner chưa sẵn thì fail closed |
| G3-A10 | Read-only, unknown capability, version mismatch | Không sửa/ghi vượt quyền, không downgrade âm thầm; lỗi có hành động tiếp theo |
| G3-A11 | Hai theme, layout nhỏ/panel, keyboard/IME/vi-en | Canvas không 0 px; theme không đổi nội dung; contrast/focus và i18n parity đạt; nhãn trạng thái lưu dùng chung keys vi/en với G4 §7.2, phân biệt checkpoint/đích lưu/dirty N+1 |
| G3-A12 | Fidelity và hiệu năng theo fixture/build | Object/part oracle, render diff, open/save/resource measurements; không gắn số đo lab thành SLA sản phẩm |

P1..P4 được ghi ở G0 port-items tại [handoff copy](../../office/g1g2/port-items.md). P2 cần fixture font nhúng không có
trong bundle/host (phối hợp DOC-002 UNI-666), để tránh test đạt nhờ fallback.
PDF F1 thuộc G3 nếu root cause nằm ở editor; F2/save routing và codec thuộc G2.

Truy vết checklist workspace `DOCUMENTS_OFFICE_CHECKLIST.md` (UNI-655):

| Requirement | Phần spec / acceptance |
| --- | --- |
| DOC-030 shell/tab/fullscreen/rename/desktop handoff | §5.1, §4.3; G3-A01/A02/A10/A11; handoff dirty và app chưa cài; yêu cầu autosave cũ được thay bằng manual save + local draft theo quyết định 27/09 |
| DOC-031..036 sáu editor | §5.2..5.4; G3-A01/A05..A09/A12, ma trận Q1-B đầy đủ |
| DOC-037 thao tác chung, mất mạng, rời/chuyển editor | §4.3..4.5, §5.1; G3-A02..A04/A10 |
| DOC-038 responsive/a11y/theme/vi-en/thumbnail/lazy/file lớn | §5.5, §6; G3-A11/A12 và kiểm cache preview sau revoke |

Tên requirement chỉ truy vết phạm vi; bảng này không tick checklist hoặc đổi trạng thái.

Unit/contract tests đặt ở core/views/office và host adapter; UI test dùng transport
fake đúng schema. E2E phải chạy trên API/DB/FileService/engine thật cho acceptance.
Kiểm tenant A/B, permission downgrade, duplicate/cancel/retry và engine crash có
bằng chứng, không dùng screenshot để suy ra commit hay fidelity.

Evidence ghi commit/build, contract/engine versions, fixture id/hash, OS/browser/CPU,
thao tác, oracle trước/sau, version receipt, timings, warnings và kết luận từng hàng.
Ngưỡng render: cố định viewport/DPR/font, mask vùng cố ý sửa, G3 đo từng format và
người review có tên ký nhận (DEC-RENDER-TOLERANCE). Chưa có chữ ký thì chỉ công bố phần
object/part oracle chứng minh. Open/save lớn, RAM và XLSX warm còn thiếu số đo phải
ghi `chưa đo`, không tự đặt ngưỡng bằng suy đoán.

Q3-B giữ Windows/macOS và Chrome/Edge/Safari. Bằng chứng Windows hiện có không thay
Safari thật; UNI-671 còn chờ thì bàn giao dev ghi giới hạn, pilot chưa đủ platform.
Khi triển khai chạy checks phù hợp từng package và `make check` theo CLAUDE.md;
spec này không báo bất kỳ runtime test nào đã đạt.

## 8. Rollout, vận hành và phục hồi

Gắn editor sau feature flag và capability matrix theo format/build. Documents vẫn
cho thao tác được phép khi engine unavailable; không bật editor chỉ vì flag đã bật.
Đề xuất mở nội bộ theo format sau khi ca acceptance tương ứng đạt, sau đó mở đủ Q1-B
đã xác minh. G7 quyết release/pilot; rollout một phần phải công bố thiếu sót còn lại.

Theo dõi open/save/job latency, lỗi theo class/format/engine version, conflict và
draft-write/recovery failures; dùng correlation id, không log text/byte tài liệu,
password, token hoặc storage locator. Không label metric theo document/user để
tránh cardinality và rò dữ liệu; audit nội dung nghiệp vụ vẫn do G1/G2 ghi.

Rollback tắt editor/write capability mới, giữ đọc các version và nháp hiện có theo
compatibility matrix. Không xóa nháp để rollback thành công; nếu build cũ không đọc
được bản mới, giữ đường đọc compatible hoặc chặn rollout. Không claim rollback an
toàn chỉ vì UI load được. Schema draft migration phải có replay/recovery test.

## 9. Nguyên tắc chốt thiết kế

Bảng G3-D1..D3 ở phần “Điểm cần người dùng quyết” ngay sau §1 là danh sách quyết định
còn mở duy nhất. Chính sách bỏ autosave đã chốt, không đưa trở lại thành lựa chọn.

Tab trong shell và file map §6 là lựa chọn thiết kế đề xuất của bản
spec này, có thể chỉnh khi duyệt mà không mở lại U-1..U-4. Auth/key decisions không
được giải quyết bằng fallback plaintext. Không có quyết định còn mở nào cho phép
thu hẹp sáu format, bỏ Q1-B hoặc đổi owner của G1/G2.

## 10. Điều kiện spec sẵn sàng chuyển thành plan

Người dùng duyệt scope/contract và các quyết định liên quan; G1/G2/G4 nhận rõ seam,
revision và ownership; mỗi capability bắt buộc có owner, oracle và dependency.
Plan triển khai sau đó mới tách task/sub-issue dưới UNI-659 qua coordinator. UNI-819
chỉ bàn giao tài liệu; không đổi UNI-659 thành đang triển khai hoặc `done` vì spec
đã viết xong.
