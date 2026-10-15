# UniWork Office G8 — Hợp đồng cộng tác (G8-01)

> **Trạng thái:** in-progress — G8-01 đã ký 2026-10-13 (Advisor theo ủy quyền của người dùng; người dùng xác nhận điểm hitl): OQ-C1..C12 theo khuyến nghị mục 13; OQ-C7 (Product), OQ-C10 (UX) và chữ OQ-C11 (UX) là giá trị tạm tới khi chủ sở hữu xác nhận

**Issue:** UNI-1396 (G8-01), cha UNI-1331 (Comment, Mention, Inbox) và UNI-1328 (liên kết sau đăng nhập); phase UNI-923.
**Nguồn ràng buộc:** [phụ lục G8 v0.3](../../superpowers/specs/2026-10-13-office-g8-collab-addendum.md) (§2 quyết định, §3
bất biến 1–8, §4.1–§4.7), [plan §5.7](../../superpowers/plans/2026-10-12-office-g5-g6-g7.md) thẻ G8-01..G8-20 và bảng AC
G8-A01..A10, plan §6.3 (seam migration, catalogue, protocol), [contract-p0](./contract-p0.md) (X-02 protocol, X-03 registry mã
lỗi, mục 10 ma trận), [EXPERIENCE-G8](./ux/EXPERIENCE-G8.md) (spine S12–S18), ADR 0007/0008/0010/0015.
**Người soạn:** worker `worker-g8-01_contract (UNI-1396)` cho `lead-g8-collab` (Run con `run_812a38d21915`), 2026-10-13.
**Cách đọc:** dữ kiện code ghi `file:line` tại D `ad52a00fd` (nhánh `feature/UNI-1396-g8-01-contract`), F = fork
`uniwork-office` (tiền tố `F:`). Ô ghi **(đề xuất, OQ-Cn)** là chỗ phụ lục im lặng: giá trị đó là khuyến nghị có hiệu lực tạm
cho lane (như "theo draft contract-p0"), chờ ký ở mục 13. Phụ lục và spec chính thắng khi lệch với tài liệu này.
**Chính tả (finding FE-7):** mọi chữ UI mới viết "xóa" theo `docs/conventions.md:219` ("Lưu / Hủy / Xóa"; `vi.json` đa số dùng
"Xóa"); trích dẫn từ phụ lục/EXPERIENCE-G8 viết "xoá" được chuẩn hóa ở đây, khóa i18n mới dùng "xóa".

## 1. Quyết định

### 1.1 Đã ký (chép phụ lục §2, ký 2026-10-13 bởi Advisor `run_a635eef8717c` theo ủy quyền "tự duyệt theo gợi ý")

| ID | Quyết định | Hệ quả cho hợp đồng này |
| --- | --- | --- |
| G8-D1 (Q1) | Kho duy nhất là server UniWork (`document_comments` của G1-07); editor đọc/ghi qua host. Bình luận gốc có sẵn trong tệp hiện ở "Bình luận trong tệp" chỉ đọc, byte giữ nguyên khi Lưu, không nhập vào server ở v1 | Mục 2 (route), mục 10 (protocol); không đổi đường commit |
| G8-D2 (Q2) | Neo lưu ở server dạng JSON theo định dạng + `anchor_version_id` + `anchor_state` (`exact`/`stale`/`lost`); editor gửi bản đồ neo sau mỗi receipt Lưu | Mục 4, `PUT .../comments/anchors` |
| G8-D4 (Q4) | Người nhận theo bảng UNI-1337; bỏ `document_commented`; một thông báo mỗi người mỗi sự kiện, ưu tiên mention > reply > resolve; push bật cho mention, tắt cho reply/resolve | Mục 8 |
| G8-D5 (Q6) | Dòng `document_comments` hiện có (không neo) thành Discussion | Mục 5.1 migration A |
| G8-D6 (Q3) | v1 bình luận cần online; Markdown/HTML chỉ Discussion; neo PPTX là slide (+ id đối tượng khi editor cấp); quan hệ Task/Project/Meeting ↔ Document hoãn | Mục 4, mục 10 |
| Q7 | Epic E5 riêng, lane L21–L24 | Mục 12 (owner theo lane) |
| Q8 | Xóa thật nội dung và lịch sử sửa; khung "Nội dung đã bị xóa" giữ cấu trúc chuỗi; audit chỉ ghi hành động | Mục 2.4, 5 |
| Q9 | Tác giả khi chưa đăng nhập/tệp cục bộ: nhãn trung tính, không bao giờ tên tài khoản máy; giá trị ghi vào tệp là hằng `"User"` (phụ lục §4.4) | G8-02; không route nào ở đây |
| Q10 | Tài khoản nhiều tổ chức: bắt chọn lần đầu, nhớ lựa chọn, đổi trong Cài đặt › Tài khoản | G8-16, spine S16 |

### 1.2 Còn mở — G8-D3 (Q5, chờ nghiệp vụ phân quyền UNI-1336)

**Giá trị tạm có hiệu lực** (phụ lục §2), mọi route ở mục 2 dùng đúng các giá trị này tới khi G8-18 đổi:

| Hành động | Mức quyền tài liệu tạm | Hiện trạng code |
| --- | --- | --- |
| Đọc comment, discussion, lịch sử sửa, ứng viên mention | `view` | `DocumentComments` → `authorizeDocument(..., DocumentLevelView)` (`server/internal/service/document_comments.go:142`) |
| Tạo, trả lời | `edit` | `withDocumentMutation(..., DocumentLevelEdit, ...)` (`document_comments.go:180`) |
| Sửa, xóa bình luận của mình | `edit` + là tác giả; người `manage` sửa/xóa được của người khác | `canModerate` (`document_comments.go:96-102`) trong mutation mức `edit` (`:225,238`) |
| Resolve, mở lại | `edit` | `document_comments.go:259` |
| Mention người không đọc được tài liệu | Lưu `state = no_access`, không thông báo, không báo lỗi | Mục 8.1 |
| Người chỉ `view` | Panel ở chế độ "Chỉ xem" (không composer) | spine S12/S13 |

G8-D3 chỉ chặn G8-18 (hàng G8-A10 `BLOCKED(G8-D3)`); không thẻ nào khác chờ nó.

## 2. Route HTTP

Mọi route dưới `/api/v1`, đăng ký qua wrapper `api` + `apiOp{sdi, sdo, …}` trong `server/internal/handler/router/documents.go`
(route bình luận hiện có ở `:284-337`); body JSON qua `decode(w, r, &in, maxJSONBody)` (`server/internal/handler/json.go:15`,
1 MiB). SDI ở `server/internal/handler/dto/sdi/document.go`, SDO ở `server/internal/handler/dto/sdo/document.go`, mỗi trường có
`description` + `example` (`docs/api-sdi-sdo.md`). Handler chỉ chuyển path param cho service (CLAUDE.md › Backend ID Rules).

**`pathParamSDI`:** mọi route mới chỉ dùng `{documentID}` và `{documentID}/{commentID}`; hai case đã có
(`server/internal/handler/router/openapi.go:421` `documentID`, `:440` `documentID,commentID`). **Không cần case mới.**
Route `PUT .../comments/anchors` là path tĩnh cạnh `.../comments/{commentID}`; Chi ưu tiên đoạn tĩnh và `{commentID}` không có
`PUT`, nên không xung đột — G8-04 vẫn thêm test router khẳng định `PUT /comments/anchors` không rơi vào handler `{commentID}`.

**Tương thích:** client cũ (web trước G8-10, frame không khai `comments`) gọi các route sẵn có không đổi: list không `kind` trả cả
hai loại, tạo không `kind` vẫn thành công (mục 2.2), SDO chỉ thêm trường. Client mới chỉ đọc trường mới qua `parseWithFallback`
(`packages/core/api/endpoints/document-comments.ts`), schema lenient (`z.string()` cho enum) và mỗi endpoint có ca malformed.

### 2.1 Liệt kê — `GET /documents/{documentID}/comments`

Quyền `view`. Query (SDI mới `ListDocumentCommentsSDI`, tag `query:`):

| Trường | Kiểu | Bắt buộc | Ví dụ | Nghĩa |
| --- | --- | --- | --- | --- |
| `kind` | `comment` \| `discussion` | không | `discussion` | Lọc theo `comment_type`; bỏ trống = cả hai (client cũ giữ nguyên). Giá trị khác → 400 `invalid_request` |
| `since_token` | string | không | `lt1:9f2c…` | `list_token` của lần tải trước (mục 6). Trùng token hiện tại → trả `unchanged` |

SDO `DocumentCommentListSDO` (mở rộng `sdo/document.go:357-359`):

| Trường | Kiểu | Luôn có | Ví dụ | Nghĩa |
| --- | --- | --- | --- | --- |
| `comments` | `DocumentCommentDTO[]` | có | `[…]` | Cũ nhất trước. Khi `unchanged = true` là mảng rỗng (một hình dạng SDO duy nhất) |
| `mentions` | `DocumentCommentMentionDTO[]` | có (mới) | `[{"user_id":"01J8…","display_name":"An","state":"ok"}]` | Bảng tên của mọi id trong token mention của các `comments` trả về (khử trùng); rỗng khi `unchanged = true` |
| `list_token` | string | có (mới) | `lt1:9f2c…` | Token hiện tại của **toàn tài liệu** (không phụ thuộc `kind`), mục 6 |
| `unchanged` | bool | có (mới) | `false` | `true` chỉ khi `since_token` bằng token hiện tại; client giữ danh sách cũ |

`DocumentCommentMentionDTO` (mới, nguồn tên của mention chip mục 3 — finding FE-1):

| Trường | Kiểu | Luôn có | Ví dụ | Nghĩa |
| --- | --- | --- | --- | --- |
| `user_id` | string | có | `01J8X4USR0…` | Id trong token (`TokenIDs`, mục 3) |
| `display_name` | string | khi `state = ok` | `Nguyễn An` | Tên hiển thị hiện tại |
| `avatar_url` | string | không | `https://…` | Như `avatar_url` của tác giả |
| `state` | `ok` \| `unavailable` | có | `ok` | `unavailable` khi tài khoản không còn hoặc không còn là thành viên hiệu lực (chưa vô hiệu) của tổ chức sở hữu tài liệu; khi đó không có `display_name`, chip hiện nhãn trong token, không link |

Tra một lần mỗi trang list (một query theo tập id, ràng buộc `organization_id` của tài liệu), không bao giờ trả tên của người
ngoài tổ chức. Đổi tên hiển thị không đổi `list_token` (mục 6): bảng tên làm mới ở mỗi lần list đầy đủ (OQ-C10).

**Tính đúng của token và danh sách (finding R1-3):** service đọc **mọi** dòng của tài liệu (cả hai loại, cả tombstone) bằng **một
câu SQL** (`ListDocumentComments` mở rộng), tính `list_token` từ chính tập dòng đó (mục 6), rồi mới lọc `kind` trong bộ nhớ. Không
có query token riêng, nên token không bao giờ đi trước dòng trả về. Client chỉ lưu `list_token` cùng với danh sách nó đi kèm.

**Client D (finding FE-5):** hàm endpoint trả kết quả phân biệt `{unchanged: true, list_token}` | `{unchanged: false, comments,
mentions, list_token}`; hook React Query **không bao giờ** ghi `comments: []` của câu trả lời `unchanged` vào
`documentKeys.comments`. Câu trả lời thiếu `unchanged` (fallback của `parseWithFallback`) chỉ được coi là danh sách đầy đủ khi
`comments` parse được; không thì giữ cache cũ. Query web D **không gửi** `since_token` (React Query đã dedup và realtime
invalidate); `since_token` dành cho frame desktop và poll. Ca malformed `document-comments.test.ts` gồm `unchanged: true` thiếu
`comments` và câu trả lời thiếu `unchanged`.

`DocumentCommentDTO` (mở rộng `sdo/document.go:332-348`; trường cũ giữ nguyên tên và nghĩa):

| Trường | Kiểu | Mới | Ví dụ | Nghĩa |
| --- | --- | --- | --- | --- |
| `id`, `document_id`, `author_id`, `author_kind`, `author`, `parent_id`, `revision`, `resolved_at`, `created_at`, `updated_at`, `display_name`, `avatar_url`, `reactions` | như hiện tại | — | — | Không đổi |
| `body` | string | — | `""` | Rỗng khi `deleted_at` có giá trị (tombstone) |
| `type` | string | — | `discussion` | Giữ để client cũ đọc; bằng `comment_type` (sau migration dòng cũ là `discussion`). Xem "Client cũ gặp `discussion`" bên dưới |
| `kind` | `comment` \| `discussion` | có | `comment` | = `comment_type`; client mới chỉ đọc trường này |
| `anchor` | object \| null | có | `{"format":"xlsx","v":1,"sheet":"S1","range":"B7"}` | Chỉ comment gốc `kind=comment`; mục 4 |
| `anchor_version_id` | string \| null | có | `01J8X4VER0…` | Version neo đang lưu |
| `anchor_state` | `exact` \| `stale` \| `lost` \| null | có | `stale` | null khi không neo |
| `deleted_at` | string \| null | có | `2026-10-13T09:00:00Z` | Có giá trị = khung "Nội dung đã bị xóa" |
| `deleted_by_id`, `deleted_by_kind` | string \| null | có | `01J…`, `human` | Ai xóa (ADR 0007) |

Lỗi: 400 `invalid_request` (`kind` sai), 401, 403/404 theo `authorizeDocument` (không lộ tài liệu tồn tại). Danh sách chứa cả
tombstone (để giữ chuỗi), không chứa dòng đã bỏ cứng.

**Client cũ gặp `discussion` (finding FE-6):** sau migration A mọi dòng cũ có `type = "discussion"`. Schema client là lenient nên
không vỡ khi chạy, nhưng chú thích `packages/core/api/endpoints/document-comments.ts:14-16` ("allowlist is "comment" only") và mọi
chỗ lọc/so `type === "comment"` sẽ bỏ sót dòng. Brief G8-10: grep và cập nhật mọi chỗ đọc `type` của bình luận tài liệu (endpoint,
`DocumentCommentsPanel`, fixture `document-comments-panel.test.tsx`) và thêm test "panel D cũ hiện dòng `type: "discussion"` không
đổi" (đi trong lệnh `pnpm vitest run packages/views/documents` của G8-A03).

### 2.2 Tạo — `POST /documents/{documentID}/comments` (+ header `Idempotency-Key`)

Quyền `edit`. SDI `CreateDocumentCommentSDI` (mở rộng `sdi/document.go:113-117`):

| Trường | Kiểu | Bắt buộc | Ví dụ | Nghĩa |
| --- | --- | --- | --- | --- |
| `body` | string | có | `Xem lại [@An](mention://member/01J8…)` | Mục 3; trim, không rỗng (`normalizeCommentBody`, `service/comments.go:51-57`) |
| `parent_id` | string \| null | không | `01J8X4CMTN…` | ULID comment cùng tài liệu (`checkCommentParent`, `comments.go:175-192`) |
| `type` | string | không | `comment` | Trường cũ, allowlist cũ (`"comment"` hoặc rỗng); **không** quyết định loại luồng |
| `kind` | `comment` \| `discussion` | không | `comment` | Loại luồng = `comment_type`. Bỏ trống: trả lời → loại của cha; gốc → `discussion` **(đề xuất, OQ-C2)** |
| `anchor` | object | khi gốc `kind=comment` **(đề xuất, OQ-C2)** | `{"format":"docx","v":1,…}` | Mục 4; cấm ở `discussion` và ở trả lời |
| `base_version_id` | string | khi có `anchor` | `01J8X4VER0…` | Version editor đang mở hoặc vừa Lưu (phụ lục §4.3) |

Luật (phụ lục §4.1, §4.3; plan G8-03, G8-04):

- `base_version_id` qua luật 1 của mục 4.3 (tra theo `organization_id`, `workspace_id`, `document_id`, `version_id`); không thấy →
  400 `anchor_version_invalid`, không ghi gì. Lưu `anchor_version_id = base_version_id`; `anchor_state = exact` chỉ khi đó là head
  (`documents.current_version`), ngược lại `stale` tới `PUT anchors` đầu tiên.
- Fingerprint idempotency: `IdempotencyFingerprint("document_comment_create", doc.ID, parent, comment_type, body, anchorHash,
  base_version_id)` (hàm `server/internal/service/idempotency.go:63`, chỗ gọi hiện tại `document_comments.go:191`).
  `anchorHash` = SHA-256 hex của JSON chuẩn tắc của `anchor` (khóa sắp theo thứ tự byte UTF-8, không khoảng trắng, số theo
  dạng ngắn nhất của JSON) hoặc `""` khi không neo. Cùng key + payload khác (kể cả khác neo) → 409 `idempotency_payload_mismatch`
  (mã có sẵn, `sdo/error_class.go:16`).
- Trả lời vào comment đã tombstone → 409 `comment_deleted`; trả lời vào một phản hồi còn sống trong thread có gốc đã tombstone thì
  được (plan G8-03).
- `kind` của trả lời khác loại của cha → 400 `invalid_request`.
- Hai người gửi đồng thời → hai dòng (mỗi lần gửi là một ULID).
- Ghi trong cùng tx: dòng comment, các dòng `document_comment_mentions` (mục 8.1), audit `document.comment_added` + outbox
  (`recordCommentAudit`, `comments.go:220-236`).

SDO `DocumentCommentSDO {comment}` (201 như hiện tại). Lỗi: 400 `invalid_request` (body rỗng, `kind`/`anchor` sai schema, neo
vượt trần), 400 `anchor_version_invalid`, 403/404, 409 `comment_deleted`, 409 `idempotency_*`, 413 `payload_too_large` (thân
request > 1 MiB; mã do `decode` ghi, `server/internal/handler/json.go:44`).

### 2.3 Sửa — `PATCH /documents/{documentID}/comments/{commentID}`

SDI `UpdateDocumentCommentSDI {body}` không đổi (`sdi/document.go:122-124`). Quyền theo mục 1.2. Trong một tx: ghi một dòng
`document_comment_revisions` (mục 5.2), cập nhật `body`, `revision + 1`, `updated_at = now()`, đồng bộ mention (mục 8.1), audit
`document.comment_updated`. Comment đã tombstone → 409 `comment_deleted`. Không cho đổi `kind`, `anchor`, `parent_id` qua route
này (neo chỉ đổi qua `PUT anchors`).

### 2.4 Xóa — `DELETE /documents/{documentID}/comments/{commentID}`

Quyền theo mục 1.2. Phụ lục bất biến 4, Q8:

| Trường hợp | Hành vi trong một tx | Kết quả |
| --- | --- | --- |
| Comment có ít nhất một dòng con (`parent_comment_id = id`, kể cả con đã tombstone) | **Tombstone:** `body = ''`, `deleted_at = now()`, `deleted_by_id/kind` = actor, `updated_at = now()`; xóa thật các dòng `document_comment_revisions` và `comment_reactions` của chính comment; mention của nó → `removed` | `outcome = "tombstoned"` |
| Không có dòng con | **Bỏ cứng:** xóa reactions, mentions, revisions của nó rồi xóa dòng (như `beforeDelete` hiện có, `document_comments.go:106-110`) | `outcome = "removed"` |
| Đã tombstone | Không làm gì, không audit, không sự kiện | 200, `outcome = "tombstoned"` |

Sau khi bỏ cứng, nếu cha là tombstone và không còn dòng con nào thì cha cũng bỏ cứng, lặp lên gốc **(đề xuất, OQ-C4)**.
Tombstone giữ `author_id`/`author_kind` (khung hiện "đã bị xóa", không phải rò rỉ). Audit `document.comment_deleted` chỉ ghi hành
động + id, không ghi nội dung (Q8). SDO: `DocumentCommentDeleteSDO {status: "ok", outcome: "tombstoned" | "removed"}` (SDO mới
thay `sdo.StatusSDO{}` ở `router/documents.go:312`; `StatusSDO` dùng chung không đổi). `status` giữ nguyên tên và giá trị nên client
cũ đọc `status` không đổi (finding R1-5); test handler khẳng định câu trả lời có cả `status` và `outcome`.

### 2.5 Resolve / mở lại — `POST|DELETE /documents/{documentID}/comments/{commentID}/resolve`

Route sẵn có (`router/documents.go:315,322`), idempotent như hiện tại (`setCommentResolvedOn`, `comments.go:314-345`). Thêm: đổi
trạng thái đặt `updated_at = now()` cùng tx (mục 6); comment đã tombstone → 409 `comment_deleted`. Quyền `edit` (G8-D3 tạm).

### 2.6 Cập nhật neo — `PUT /documents/{documentID}/comments/anchors`

Quyền `edit` **(đề xuất, OQ-C5;** phụ lục không nói mức quyền; Lưu cần `edit` nên người gửi bản đồ neo sau receipt Lưu luôn có
`edit`). SDI `PutDocumentCommentAnchorsSDI`:

| Trường | Kiểu | Bắt buộc | Ví dụ | Nghĩa |
| --- | --- | --- | --- | --- |
| `version_id` | string | có | `01J8X4VER0…` | Version vừa Lưu (receipt) |
| `anchors` | array (≤ 500 phần tử **(đề xuất, OQ-C5)**) | có | `[…]` | |
| `anchors[]` | `DocumentCommentAnchorItemSDI` | có | | Kiểu **có tên** trong `dto/sdi` (không struct ẩn danh), xem mục 2.10 |
| `anchors[].comment_id` | string | có | `01J8X4CMTN…` | Comment gốc `kind=comment` |
| `anchors[].anchor` | object | có | mục 4 | Neo mới (giữ neo cũ khi `state=lost`) |
| `anchors[].state` | `exact` \| `lost` | có | `exact` | Editor chỉ báo tìm thấy / không tìm thấy; server tự hạ `exact` → `stale` theo luật 3 |

Năm luật (phụ lục §4.3, nguyên văn ý):

1. Tra `document_versions` theo (`organization_id`, `workspace_id`, `document_id`, `version_id`) (bảng `server/migrations/984_document_versions.up.sql:10`).
   Không thấy (tài liệu khác, đã dọn, không tồn tại) → 400 `anchor_version_invalid`, không ghi gì; thân lỗi giống nhau mọi trường hợp.
2. So bằng số `document_versions.version` (`INTEGER`, `984_document_versions.up.sql:15`), không so chuỗi ULID. Với từng comment:
   nhận khi số của `version_id` ≥ số của `anchor_version_id` đang lưu (bằng = ghi lại, idempotent); version đang lưu không còn tồn
   tại coi như cũ hơn; nhỏ hơn → bỏ qua (vào `skipped`), không lùi neo.
3. `anchor_state` lưu `exact` khi `version_id` là head lúc ghi, ngược lại `stale`; `lost` khi editor báo. Comment không thuộc tài
   liệu (hoặc tenant khác), comment là `discussion`, trả lời hoặc tombstone → bỏ qua, không lộ (cùng `skipped`, cùng lý do chung).
4. Idempotent tự thân, không dùng ledger `Idempotency-Key`; lặp cùng payload không đổi dòng nào, không phát sự kiện. Có ít nhất
   một dòng đổi → các dòng đổi đặt `updated_at = now()`, một audit `document.comment_anchors_updated` + một outbox cùng tx.
5. Không bao giờ lưu `anchor_version_id` trỏ tới version không thuộc tài liệu.

SDO `DocumentCommentAnchorsSDO`:

| Trường | Kiểu | Ví dụ | Nghĩa |
| --- | --- | --- | --- |
| `updated` | string[] | `["01J…"]` | `comment_id` đã đổi |
| `skipped` | `{comment_id, reason}`[] | `[{"comment_id":"01J…","reason":"older_version"}]` | `reason` ∈ `older_version` \| `not_applicable` (gộp mọi trường hợp không thuộc/không neo được, để không lộ) |
| `list_token` | string | `lt1:…` | Token sau khi ghi, tính trong tx của lệnh từ mọi dòng của tài liệu |

Client **không** dùng `list_token` của `PUT` làm `since_token` (danh sách nó đang giữ chưa có các dòng vừa đổi, và có thể thiếu
thay đổi của người khác); sau `PUT` có `updated` khác rỗng, client tải lại list đầy đủ.

Lỗi: 400 `anchor_version_invalid`, 400 `invalid_request` (schema/trần neo), 403/404, 413 `payload_too_large`.

### 2.7 Lịch sử sửa — `GET /documents/{documentID}/comments/{commentID}/revisions`

Quyền `view`. SDO `DocumentCommentRevisionListSDO {revisions: [{id, revision, body, created_by_id, created_by_kind, created_at}]}`,
mới nhất trước. Comment tombstone → 409 `comment_deleted` (lịch sử đã xóa thật, Q8). Comment không thuộc tài liệu → 404.

### 2.8 Ứng viên mention — `GET /documents/{documentID}/mention-candidates`

Quyền `view` (plan G8-06). Query `ListMentionCandidatesSDI`:

| Trường | Kiểu | Bắt buộc | Ví dụ | Nghĩa |
| --- | --- | --- | --- | --- |
| `q` | string | không | `nguyen` | Gấp dấu `uw_fold_search`, khớp tên hiển thị và email; rỗng = theo tên |
| `limit` | int | không | `20` | Mặc định 20, tối đa 50; ngoài khoảng bị kẹp về [1, 50] (tiền lệ `maxLimit`, `server/internal/notification/service.go:41`) |

Tập ứng viên: người có ít nhất `view` trên tài liệu (thành viên workspace hiệu lực + người được chia sẻ trực tiếp), loại thành
viên bị vô hiệu (`member_deactivated`) và tổ chức bị tạm dừng. SDO `MentionCandidateListSDO {candidates: [{user_id, display_name,
avatar_url?, email?}]}`. `email` chỉ có khi người gọi được xem danh sách thành viên của workspace của tài liệu (qua
`WorkspaceService.RequireMember` — cổng của `GET /workspaces/{ws}/members`, `router/workspaces.go:49`); người đọc qua chia sẻ
trực tiếp không thấy email. Người ngoài tổ chức → 404.

### 2.9 Vé launch desktop — `POST /documents/{documentID}/office/sessions` (sẵn có)

`CreateOfficeLaunchSessionSDI` (`sdi/office_launch.go:6-12`) thêm `comment_id` tùy chọn (ULID). Server chỉ giữ giá trị khi comment
thuộc đúng tài liệu và tenant; không thì bỏ im lặng, không lỗi **(đề xuất, OQ-C6)**. Chủ: G8-07 (plan G8-07 "D service vé launch
(`comment_id` tùy chọn)"; seam L2, plan §6.3).

- **Lưu (finding R1-2):** bảng `office_launch_sessions` (`server/migrations/9991790722053469_office_launch_sessions.up.sql`) chưa có
  cột này. G8-07 thêm migration D `999<ms>_office_launch_sessions_comment_id`: `ALTER TABLE office_launch_sessions ADD COLUMN
  comment_id TEXT` (NULL được, không FK, không index — chỉ đọc theo dòng phiên đã tra). Query tạo phiên ghi cột; query đổi vé đọc
  lại cột cùng dòng.
- **Trả về:** `OfficeLaunchSessionSDO` (tạo) không đổi. `OfficeLaunchExchangeSDO` (`sdo/office_launch.go:32-36`) thêm trường cấp
  trên `comment_id` (`string`, `omitempty`, ví dụ `01J8X4CMTN…`) cạnh `receipt_id`, **không** đặt trong `OfficeLaunchDocumentDTO`
  (DTO đó mô tả tài liệu). Lúc đổi vé, server kiểm lại comment còn thuộc tài liệu và chưa bị bỏ cứng; không thì bỏ trường.
- Client: `packages/core/office/desktop-handoff.ts` thêm trường tùy chọn; app mở tài liệu rồi gửi `comments.reveal` theo thứ tự ở
  mục 10.
- Thứ tự migration: hàng G8-07 nối sau G8-03 (mục 5); plan §6.3 chưa có hàng này — finding cho Advisor (báo cáo r2).

### 2.10 Isolation (G8-A08)

`TestIsolationMatrix` phủ mọi route mới theo path ngay khi đăng ký. Trường body có đuôi `_id` cần ca `isoReferences`
(`server/internal/handler/isolation_references_test.go:100`; ca `parent_id` hiện có `:179-180`): `PutDocumentCommentAnchorsSDI.version_id`,
`DocumentCommentAnchorItemSDI.comment_id`, `CreateDocumentCommentSDI.base_version_id`,
`CreateOfficeLaunchSessionSDI.comment_id`. World seed thêm một dòng mỗi bảng mới (`isolation_world_test.go`).

Cách gate thấy trường lồng (finding R1-9): `TestEveryBodyIDFieldHasAReferenceCase` (`isolation_references_test.go:338`) duyệt
mọi **kiểu struct có tên** khai ở cấp gói trong `dto/sdi/*.go` và khóa theo `<TênKiểu>.<json>`; nó không đi vào kiểu phần tử của
mảng, cũng không thấy struct ẩn danh. Vì vậy phần tử `anchors[]` phải là kiểu có tên `DocumentCommentAnchorItemSDI` trong
`dto/sdi`: khi đó gate tự bắt `DocumentCommentAnchorItemSDI.comment_id` và ca `isoReferences` (covers đúng khóa đó, tấn công bằng
comment của A trong body của B) là bắt buộc chứ không thừa. Một struct ẩn danh sẽ lọt gate — cấm.

## 3. Nội dung bình luận và token mention

**Định dạng một nguồn** (phụ lục §4.2): `body` là Markdown con — đoạn, xuống dòng, `**đậm**`, `*nghiêng*`, `` `code` `` dòng, liên
kết `http(s)` — cộng token mention. Không HTML thô (hiển thị nguyên văn).

**Token mention — chọn: đúng ngữ pháp của chat, không phải superset (finding L-5).** Mọi client chỉ **viết** token đủ
`[@Nhãn](mention://member/<ULID>)` như `server/internal/mentions/mentions.go:1-2`. Parser hiện tại `MemberIDs` khớp
`mention://member/<id>` ở bất cứ đâu (regex `mentions.go:18`), nên một URL trần hoặc trong code span tạo mention + thông báo mà
không có chip. Hợp đồng:

- Gói `mentions` thêm hàm `TokenIDs(body)` chỉ nhận token đủ dạng ngoài code span dòng: regex
  `\[@((?:[^\[\]\\]|\\.)*)\]\(mention://member/([0-9A-Za-z]{26})\)`, id chuẩn hóa chữ hoa, khử trùng, sắp xếp. Bình luận tài liệu
  (service ghi mention, mục 8.1) dùng `TokenIDs`.
- `MemberIDs` giữ nguyên cho chat (cùng gói; không đổi hành vi chat trong G8).
- Lý do: phụ lục §4.2 nói "`@Tên` gõ tay không qua picker là văn bản thường" và renderer hiện code span nguyên văn; token phải là
  thứ người dùng thấy thành chip. Đổi chung regex sẽ đổi chat ngoài phạm vi.

**Escape:** trong nhãn, `\`, `[`, `]`, `(`, `)` được escape bằng `\` theo Markdown. Server chỉ tin id trong token; nhãn là dự phòng
hiển thị.

**Trần độ dài — dữ kiện:** route hiện có **không có trần riêng cho `body`**: SDI chỉ `minLength:"1"` (`sdi/document.go:114`,
`:123`), giới hạn duy nhất là thân request 1 MiB (`maxJSONBody`, `server/internal/handler/json.go:15`; mô tả SDO
"request bị chặn ở 1 MiB", `sdo/document.go:338`). Hợp đồng giữ đúng con số đó (phụ lục §4.2: "giữ con số của route hiện có");
trần ký tự riêng là OQ-C1.

**Hiển thị tối thiểu mọi host:** văn bản, xuống dòng, liên kết (mở ngoài), mention chip. Chip lấy **tên hiện tại** theo id từ bảng
`mentions` của câu trả lời list (mục 2.1, `DocumentCommentMentionDTO`; frame nhận cùng bảng trong kết quả `comments.list`, mục 10);
nhãn trong token chỉ dùng khi `state = unavailable` hoặc id không có trong bảng (khi đó không link). Không host nào tự tra tên theo
cách khác. Cú pháp Markdown khác hiện nguyên văn.
Soạn: `@` mở picker (`mentions.search` → route 2.8); dán văn bản có token hợp lệ giữ token. Fixture chung (G8-08, G8-20): body có
mention + mọi phần Markdown con, đi web → desktop → web không đổi byte.

## 4. Neo

### 4.1 Schema JSON theo định dạng

Mọi neo có `format` và `v` (hiện `v = 1`); trần 4 KiB trên JSON chuẩn tắc (mục 2.2) mỗi neo; mọi trường trích dẫn ≤ 500 ký tự
(Unicode code point). Trường lạ → 400 `invalid_request` (schema đóng, để hash chuẩn tắc ổn định).

**Nơi thực thi schema đóng (finding R1-4):** `decode` dùng chung **không** chặn trường lạ (`json.NewDecoder(r.Body).Decode(dst)`, không
`DisallowUnknownFields`, `server/internal/handler/json.go:33-34`), nên schema đóng không tự có. SDI giữ `anchor` dạng
`json.RawMessage`; service (G8-04, file mới `server/internal/service/document_comment_anchor.go`, hàm `validateAnchor(format,
raw)`) đọc `format` + `v`, chọn struct theo `format` khớp định dạng tài liệu, giải mã bằng `json.Decoder` có
`DisallowUnknownFields()`, kiểm kiểu/miền/trần, rồi trả JSON chuẩn tắc dùng cho cả lưu và `anchorHash`. Mọi lỗi → 400
`invalid_request`. Dùng chung cho `POST` tạo và từng phần tử `PUT anchors`. Test G8-04: neo có khóa lạ → 400 `invalid_request`.

| `format` | Trường | Kiểu | Bắt buộc | Ví dụ |
| --- | --- | --- | --- | --- |
| `docx` | `para_id` | string | không | `"1A2B3C4D"` (`w14:paraId`) |
|  | `path` | int[] | có | `[3, 0]` (đường dẫn khối trong model) |
|  | `start`, `end` | int ≥ 0, `start ≤ end` | có | `12`, `40` |
|  | `quote` | string ≤ 500 | có | `"doanh thu quý 3"` |
|  | `prefix`, `suffix` | string ≤ 500 | có (có thể rỗng) | `"Theo "`, `" tăng"` |
| `xlsx` | `sheet` | string | có | id ổn định của sheet khi workbook có, không thì tên |
|  | `range` | string A1 | có | `"B7"`, `"B7:D9"` |
| `pptx` | `slide_id` | string | có | `"257"` |
|  | `slide_index` | int ≥ 0 | có | `4` |
|  | `object_id` | string | không | `"8"` (khi editor cấp, G8-D6) |
| `pdf` | `page` | int ≥ 1 | có | `2` |
|  | `rect` | number[4] `[x0,y0,x1,y1]` | có | `[72, 540, 300, 560]` (điểm PDF) |

Markdown/HTML không có neo (G8-D6): `kind=comment` trên định dạng đó → 400 `invalid_request`.

### 4.2 Trạng thái và so phiên bản

| `anchor_state` | Khi nào | UI |
| --- | --- | --- |
| `exact` | Neo ghi trên version là head lúc ghi | Hiện vị trí |
| `stale` | Neo ghi trên version cũ hơn head (tạo trên `base_version_id` không phải head, hoặc `PUT` từ version không phải head) | Hiện vị trí kèm nhãn chữ khóa `collabAnchorStale`: vi "Vị trí có thể đã thay đổi" (EXPERIENCE-G8:73) |
| `lost` | Editor báo không tìm thấy | Comment **còn sống**, thread đọc/trả lời được; nhãn neo khóa `collabAnchorLost` (EXPERIENCE-G8:74), **khác** khóa tombstone `collabDeleted`; reveal chỉ mở thread, không mở comment khác |

Chữ của `collabAnchorLost` (finding FE-4): EXPERIENCE-G8:74 hiện dùng cùng chữ với khung tombstone ("Nội dung đã bị xóa",
`collabDeleted`, :75) dù comment vẫn sống, nên người đọc hiểu nhầm là đã xóa. Hợp đồng giữ hai khóa riêng; chữ đề xuất cho
`collabAnchorLost`: vi "Không còn tìm thấy vị trí được bình luận" / en "The commented location can no longer be found" — chờ UX ký ở OQ-C11
(không sửa spine UX ở đây).

So sánh chỉ theo số `document_versions.version`; luật đầy đủ ở mục 2.6. Neo không phải quyền (bất biến 3).

## 5. Mô hình dữ liệu và migration

Quy tắc chung (CLAUDE.md › Database): không `FOREIGN KEY`/`REFERENCES`; id ULID `TEXT` (`util.NewID()`); tên
`999<unix-ms>_<name>.{up,down}.sql` với `unix-ms = max(Date.now() lúc viết, tiền tố lớn nhất trên root + 1)` (tiền tố lớn nhất hôm
nay `9991791800000006`); mỗi index `CREATE [UNIQUE] INDEX CONCURRENTLY` một mình một file. Thứ tự: nối **sau** hàng G6-03c của
plan §6.3 (G5-01a → G5-07 → G5-08s → G6-03a → G6-03b → G6-03c → **G8-03**); merge lệch thứ tự thì đổi tên khi rebase
(`TestMigrationPrefixesSortTheSameAsStringsAndNumbers`). Hàng G8-03 ở bảng contract-p0 §5 (hàng 7) khớp thứ tự này.
Migration thứ tư (D, `office_launch_sessions.comment_id`, mục 2.9) thuộc G8-07 và nối sau G8-03.

### 5.1 Migration A — `999<ms>_document_comments_collab`

Trên bảng `document_comments` (`server/migrations/9991790532871902_document_comments.up.sql:8-37`; đã có `organization_id`, dùng
`author_id`/`author_kind`):

1. `DROP CONSTRAINT document_comments_comment_type_check` (CHECK cũ `comment_type IN ('comment')`, `:27-28`).
2. `UPDATE document_comments SET comment_type = 'discussion'` (mọi dòng cũ không neo, G8-D5; không đổi `updated_at`).
3. `ADD CONSTRAINT document_comments_comment_type_check CHECK (comment_type IN ('comment','discussion'))`;
   `ALTER COLUMN comment_type SET DEFAULT 'discussion'`. Không thêm cột `thread_kind`.
4. Cột mới (đều NULL được): `anchor JSONB`, `anchor_version_id TEXT`, `anchor_state TEXT`, `deleted_at TIMESTAMPTZ`,
   `deleted_by_id TEXT`, `deleted_by_kind TEXT`.
5. CHECK mới:
   - `anchor_state IS NULL OR anchor_state IN ('exact','stale','lost')`;
   - `deleted_by_kind IS NULL OR deleted_by_kind IN ('human','agent','system')` (ADR 0007);
   - ba cột neo cùng NULL hoặc cùng có: `(anchor IS NULL) = (anchor_version_id IS NULL) AND (anchor IS NULL) = (anchor_state IS NULL)`;
   - neo chỉ ở gốc loại comment: `anchor IS NULL OR (comment_type = 'comment' AND parent_comment_id IS NULL)`;
   - ba cột xóa cùng NULL hoặc cùng có: `(deleted_at IS NULL) = (deleted_by_id IS NULL) AND (deleted_at IS NULL) = (deleted_by_kind IS NULL)`.

Down: bỏ CHECK/cột mới, `UPDATE … SET comment_type = 'comment'`, khôi phục CHECK cũ. Index: index hiện có
(`9991790532871903_document_comments_document_idx`) đủ cho list theo tài liệu; G8-03 chỉ thêm index nếu EXPLAIN cần, mỗi index một file.

### 5.2 Migration B — `999<ms>_document_comment_revisions`

| Cột | Kiểu | Ràng buộc |
| --- | --- | --- |
| `id` | TEXT | PK (ULID) |
| `organization_id` | TEXT | NOT NULL (ADR 0008) |
| `workspace_id`, `document_id`, `comment_id` | TEXT | NOT NULL, không FK |
| `body` | TEXT | NOT NULL — nội dung **bị thay** (trước lần sửa) **(đề xuất, OQ-C3)** |
| `revision` | BIGINT | NOT NULL — số `revision` của nội dung đó |
| `created_by`, `created_by_kind` | TEXT | NOT NULL; CHECK `created_by_kind IN ('human','agent','system')` — actor của lần sửa |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT `now()` |

Index file riêng: `999<ms>_document_comment_revisions_comment_uidx` — `CREATE UNIQUE INDEX CONCURRENTLY … (comment_id, revision)`;
`999<ms>_document_comment_revisions_document_idx` — `(document_id)` cho purge.

### 5.3 Migration C — `999<ms>_document_comment_mentions`

| Cột | Kiểu | Ràng buộc |
| --- | --- | --- |
| `id` | TEXT | PK |
| `organization_id` | TEXT | NOT NULL |
| `workspace_id`, `document_id`, `comment_id`, `user_id` | TEXT | NOT NULL, không FK |
| `state` | TEXT | NOT NULL; CHECK `state IN ('active','removed','no_access')` |
| `notified_at` | TIMESTAMPTZ | NULL tới khi đã giao/giành (mục 8.2) |
| `created_by`, `created_by_kind` | TEXT | NOT NULL; CHECK kind như trên |
| `created_at`, `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT `now()` |

Index file riêng: `999<ms>_document_comment_mentions_comment_user_uidx` — `CREATE UNIQUE INDEX CONCURRENTLY … (comment_id, user_id)`;
`999<ms>_document_comment_mentions_document_idx` — `(document_id)` cho purge.

`comment_reactions` không đổi cột.

### 5.4 Query, purge, bản sao

- Mọi query sqlc mới mang `organization_id = $n` hoặc `workspace_id = $n` (cộng `document_id` khi đọc theo tài liệu) hoặc một dòng
  `-- tenant:` đúng nghĩa; không query nào lọc chỉ theo `comment_id` (`TestEveryQueryNamesItsTenant`). File: `document_comments.sql`
  (mở rộng), `document_comment_mentions.sql` (mới, gồm `ClaimDocumentCommentMention :execrows`), revisions trong
  `document_comments.sql` hoặc file riêng.
- Purge tài liệu (`DeleteDocumentComments`, `server/pkg/db/queries/document_gc.sql:70-74`, `server/internal/service/document_lifecycle.go:757-838`) dọn **bốn**
  bảng trong cùng tx theo thứ tự **reactions → mentions → revisions → comments**: `comment_reactions` không có `document_id`, join
  qua `document_comments` (`document_comments.sql:85-93`) nên phải chạy trước (`DeleteDocumentCommentReactionsByDocument` mới).
- Bản sao (`POST /documents/{id}/copies`) không chép bình luận, mention, revision.
- Lưu trữ tài liệu giữ mọi dòng.

## 6. `list_token`

- Định nghĩa: `"lt1:" + hex(SHA-256(dãy (id, updated_at, anchor_state) của mọi dòng còn lại của tài liệu, cả hai loại, kể cả
  tombstone, sắp theo id)))`; `updated_at` viết UTC độ chính xác micro giây, `anchor_state` NULL viết rỗng; các phần tách bằng byte
  0 như `IdempotencyFingerprint`. Token đục với client; tiền tố `lt1:` cho phép đổi công thức sau này.
- Một token cho cả tài liệu, không theo `kind`: `?kind=…&since_token=…` so với token toàn tài liệu.
- Mọi mutation đổi một dòng đặt `updated_at = now()` cùng tx: tạo, sửa, tombstone, resolve, mở lại, `PUT anchors` có đổi. Bỏ cứng
  làm tập dòng đổi nên token đổi dù không dòng nào mới hơn; client **không bao giờ suy xóa từ "không thấy dòng"**, chỉ thay cả danh
  sách khi token khác.
- Reaction không vào token (editor fork chưa vẽ reaction, phụ lục §4.7); đổi tên hiển thị không đổi token (tên chip đến từ bảng `mentions` của mỗi lần list đầy đủ, mục 2.1; OQ-C10).
- **Cách tính (finding R1-3, chuẩn tắc):** list (mục 2.1) đọc mọi dòng của tài liệu bằng **một câu SQL** (theo `organization_id`,
  `workspace_id`, `document_id`; cả hai loại, cả tombstone) và tính token từ chính các dòng đó trước khi lọc `kind`; một câu SQL
  là một snapshot, không cần tx REPEATABLE READ. **Cấm** query token riêng ngoài câu list (hai câu = hai snapshot: một ghi chen
  giữa làm token đi trước dòng, client lưu token mới rồi mọi lần poll sau trả `unchanged` và không bao giờ thấy dòng thiếu — desktop
  chỉ làm mới bằng token nên không tự lành). `PUT anchors` tính token trong tx của chính lệnh (sau khi ghi).
- Test G8-03 (`DocumentCommentListToken`, đi trong G8-A03): chèn một lệnh tạo giữa lúc service đọc dòng và lúc trả (hook test
  trong service) → client dùng token trả về vẫn thấy dòng mới ở lần poll kế; token không bao giờ đi trước danh sách.

## 7. Sự kiện và realtime

| Topic | Phiên bản | Payload (chỉ id) | Scope | Giao | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| `document.comment_added`, `_updated`, `_deleted`, `_resolved`, `_unresolved`, `_reaction_added`, `_reaction_removed` | 1 | `document_id`, `comment_id`, `workspace_id` | workspace | outbox | Có sẵn (`docs/events/CATALOGUE.md:151-157`, `server/internal/outbox/catalogue.go:274-280`, `packages/core/types/events.ts:56-62`) |
| `document.comment_anchors_updated` | 1 | `document_id`, `workspace_id`, `version_id` | workspace | outbox | **Mới (G8-04)**; một sự kiện mỗi `PUT` có đổi |

- Ba bản catalogue thêm cùng commit; `scripts/events-catalogue.test.mjs` giữ khớp và giữ khóa chỉ là id. Không `Patch` (chỉ
  `task.updated` có, ADR 0015).
- Audit action mới `ActionDocumentCommentAnchorsUpdated = "document.comment_anchors_updated"` cạnh `server/internal/audit/actions.go:151-157`;
  `audit_coverage_test.go` thêm hàng hai chiều.
- Client: `packages/core/realtime/use-realtime-sync.ts:284-296` thêm `case "document.comment_anchors_updated":` vào **cùng nhóm**
  `document.comment_*` (guard `workspace_id === wsId`, invalidate `documentKeys.comments(wsId, document_id)`,
  `packages/core/documents/keys.ts:58-59`); test ở `use-realtime-sync.test.tsx`.
- Host web chuyển mọi frame trên thành `comments.changed {document_id}` cho frame (mục 10). Desktop không có realtime: tải lại khi
  tab hiển thị được focus và mỗi 30 s **chỉ khi** panel mở và tab hiển thị, gửi `since_token`.
- Người đọc qua chia sẻ trực tiếp ở workspace khác không nhận frame (scope workspace); panel của họ tải lại khi focus (phụ lục §6).

## 8. Mention bền và thông báo

### 8.1 Ghi mention (service, cùng tx với tạo/sửa — G8-05)

So tập `TokenIDs(body)` mới với dòng hiện có của comment:

| Trường hợp | Dòng `document_comment_mentions` |
| --- | --- |
| id mới, người đó đọc được tài liệu | Thêm `active`, `notified_at` NULL |
| id mới, người đó không đọc được | Thêm `no_access` (giá trị tạm G8-D3), không lỗi |
| id không còn trong body | `removed` (thông báo cũ giữ nguyên) |
| id `removed` được thêm lại | `active`, **giữ** `notified_at` cũ (không thông báo lại) |
| Sửa thành rỗng nội dung / tombstone | Mọi dòng → `removed` |
| Tự mention | Lưu như thường; luật thông báo bỏ actor |

"Đọc được" = `FilterDocumentReaders(ctx, documentID, userIDs)` (`server/internal/service/document_access.go:299`), loại người bị vô
hiệu. Mention không cấp quyền (bất biến 6).

### 8.2 Giành dòng (`notified_at`) trong tx của consumer

- Rule (`server/internal/notification/rules.go`) **chỉ đọc**: với sự kiện tạo/sửa, xét dòng `active` + `notified_at IS NULL` và gắn
  vào `Draft` (`rules.go:46-57`) một `Claim{MentionID}`.
- `write()` của `server/internal/notification/consumer.go:120` chạy, sau `InsertNotificationDelivery` và trước `UpsertNotification`,
  `UPDATE document_comment_mentions SET notified_at = now(), updated_at = now() WHERE id = $1 AND organization_id = $2 AND notified_at IS NULL`
  (`ClaimDocumentCommentMention :execrows`) trong **cùng tx** với dòng thông báo và outbox của nó. 0 dòng → bỏ draft.
- `deliver()` (`consumer.go:93-118`): người nhận tắt `InApp` (`:110`) → tx chỉ-claim (cùng câu `UPDATE`, không ghi thông báo).
- Kết quả: hai lần sửa trước khi consumer chạy, replay outbox, sửa giữ A, hai consumer đồng thời → đúng một thông báo cho A.

### 8.3 Người nhận (bảng UNI-1337, G8-D4)

| Sự kiện nguồn | Người nhận | Kind |
| --- | --- | --- |
| Tạo comment/thread mới không mention | Không ai | — (ngừng phát `document_commented`; kind giữ cho dòng cũ) |
| Mention trong `kind=comment` (tạo hoặc sửa) | Người có dòng vừa giành | `document_mentioned` (giữ kind cũ) |
| Mention trong `kind=discussion` | như trên | `document_discussion_mentioned` (mới) |
| Trả lời trong `kind=comment` | Tác giả comment cha (≠ actor) | `document_comment_replied` (mới) |
| Trả lời trong `kind=discussion` | Tác giả comment cha (≠ actor) | `document_discussion_replied` (mới) |
| Resolve `kind=comment` | Tác giả comment được resolve (≠ actor) **(đề xuất, OQ-C7)** | `document_comment_resolved` (mới) |

**Test hiện có phải lật (finding R1-6):** rule hiện vẫn phát `KindDocumentCommented` (`server/internal/notification/rules.go:429`)
và `TestDocumentCommentCommentedNotification` (`server/internal/notification/document_comments_test.go:109-117`) khẳng định
`owner[0].Kind == KindDocumentCommented`. G8-05 **viết lại** test đó theo bảng trên (tạo thread không mention → không thông báo
nào; mention/reply/resolve → đúng kind), không nới lỏng assertion. Test viết lại phải đỏ trên code trước G8-05 và xanh sau; nó chạy
trong lệnh G8-A06 (mục 12).

**Sổ đăng ký kind phải sửa cùng thay đổi (finding BE-11):** ngừng phát `document_commented` nhưng **giữ** kind đó ở mọi sổ đăng ký
(dòng cũ vẫn render), và thêm bốn kind mới vào cùng một thay đổi G8-05 ở đủ bảy chỗ: `server/internal/notification/kinds.go`
(`:31,45`), `server/internal/notification/titles.go` (`:25,45`), `packages/core/i18n/locales/{vi,en}.json` (nhãn danh mục
`vi.json:381`/`en.json:382` và tiêu đề `vi.json:4524`/`en.json:4528`), `packages/core/types/notification.ts` (`:18`),
`packages/views/notifications/kind-tone.ts` (`:26`), `packages/views/notifications/kind-icon.tsx` (`:32`),
`packages/views/notifications/notification-category.ts` (`:19`); `TestTitlesMatchClientLocales`
(`server/internal/notification/titles_test.go`) và `packages/views/notifications/kind-tone.test.ts` phải xanh.

Một thông báo mỗi người mỗi sự kiện, ưu tiên mention > reply > resolve; không gửi actor; người bị vô hiệu/không đọc được → không
gửi. Push mặc định: bật cho `document_mentioned`, `document_discussion_mentioned`; tắt cho reply/resolve (`notification/prefs.go:19-20`).
`params`: `actor`, `document`, `snippet` (ngắn, như `rules.go:409`), `comment_id`, `kind`; không nội dung tài liệu. `GroupKey` theo
mẫu `document:<doc>:<loại>:<comment>` như `document:…:mention:…` hiện có. Mirror client: `packages/core/types/notification.ts`,
`kind-icon.tsx`, `kind-tone.ts`, `notification-category.ts`, i18n `packages/core/i18n/locales/{en,vi}.json` (parity
`NOTIFICATION_KINDS` ↔ `kinds.go Kinds`, `titles_test.go`).

### 8.4 Năm mẫu vi/en (UNI-1337 › Bảng nội dung thông báo)

| # | Kind | Tiêu đề vi | Nội dung vi | Tiêu đề en | Nội dung en |
| --- | --- | --- | --- | --- | --- |
| 1 | `document_mentioned` | Bạn được nhắc tên trong bình luận | {{actor}} đã nhắc đến bạn trong bình luận tại tài liệu “{{document}}”. | You were mentioned in a comment | {{actor}} mentioned you in a comment on “{{document}}”. |
| 2 | `document_discussion_mentioned` | Bạn được nhắc tên trong thảo luận | {{actor}} đã nhắc đến bạn trong thảo luận của tài liệu “{{document}}”. | You were mentioned in a discussion | {{actor}} mentioned you in a discussion on “{{document}}”. |
| 3 | `document_comment_replied` | Có phản hồi bình luận mới | {{actor}} đã phản hồi bình luận của bạn trong tài liệu “{{document}}”. | New reply to your comment | {{actor}} replied to your comment in “{{document}}”. |
| 4 | `document_discussion_replied` | Có phản hồi thảo luận mới | {{actor}} đã phản hồi nội dung thảo luận của bạn trong tài liệu “{{document}}”. | New reply in a discussion | {{actor}} replied to your discussion post in “{{document}}”. |
| 5 | `document_comment_resolved` | Bình luận đã được giải quyết | {{actor}} đã đánh dấu bình luận của bạn trong tài liệu “{{document}}” là đã giải quyết. | Comment resolved | {{actor}} marked your comment in “{{document}}” as resolved. |

Cột vi là nguyên văn UNI-1337 (thay `[Tên người thực hiện]`/`[Tên tài liệu]` bằng placeholder); cột en do hợp đồng này dịch
(mẫu 2 sửa theo finding FE-8: "in a discussion on"). Chỗ đặt hai dòng trong `titles.go` (hiện một chuỗi mỗi kind,
`notification/titles.go:10-46`) là OQ-C8.

**Escape (finding FE-8):** `{{actor}}`, `{{document}}` là văn bản thuần. Dấu ngoặc kép cong “ ” nằm trong mẫu, không trong giá trị.
Tiêu đề/nội dung push và email là text thuần: nội suy **không** HTML-escape (client đã đặt `interpolation: { escapeValue: false }`, `packages/core/i18n/create-i18n.ts:18`; một tên tài liệu có `"` hay `&` hiện nguyên văn, không
thành `&quot;`/`&amp;`); Inbox web vẽ bằng nút văn bản React (React tự escape), không `dangerouslySetInnerHTML`. Test i18n G8-05: tên
tài liệu chứa `"`, `&`, `<` hiện nguyên văn ở cả push title và Inbox.

### 8.5 Inbox: snippet, cờ và deep link (phụ lục §4.6, G8-07)

- `Service.List` (`server/internal/notification/service.go:78-129`) gom `document_id` của trang (≤ 100) và gọi cổng batch mới
  `FilterReadableDocuments(ctx, userID, documentIDs) (map[string]DocumentReadState, error)` trên `DocumentService`
  (`readable` | `access_lost` | `gone`): khử trùng id, một `ListExistingDocumentIDs` (`-- tenant: by-id`), cổng tổ chức một lần mỗi
  tổ chức, `resolveLevel` một lần mỗi tài liệu còn lại; chi phí có chặn trên theo số tài liệu của trang, chỉ cho hàng
  `resource_type=document`. Cổng khai trong gói `notification` (`DocumentPageChecker`, cạnh `DocumentReadChecker`), nối ở
  `server/cmd/server/main.go`. `access_lost` → bỏ `snippet` khỏi `params` + cờ `resource_access_lost`; `gone` → `resource_deleted`.
- Thông báo mang `resource_type=document`, `resource_id` = document id, `params.comment_id`, `params.kind`; SDO thông báo chỉ thêm cờ
  `resource_access_lost`.
- Link: `paths.workspace(org, ws).document(id)` + `?comment=<id>`. Nguồn slug: web tra `n.workspace_id` trong `useWorkspaces()`
  (`workspaceKeys.list()`); không có → workspace đang mở. Push `ResourceURL` (`push_consumer.go:116-155`) cùng luật qua
  `ListWorkspacesForUser(n.UserID)` → workspace của thông báo nếu người nhận ở trong, không thì workspace đầu tiên cùng tổ chức, không
  thì `/workspaces`.
- Màn hình S15: năm ngoại lệ UNI-1389 (tài liệu không còn; bình luận đã xóa; thread đã xóa; mất quyền; phiên hết hạn → đăng nhập lại);
  không mở comment khác khi neo mất; mở thông báo không đổi Open/Resolved.

## 9. Mã lỗi mới

Đăng ký qua owner registry X-03 (Lead D; `server/internal/handler/dto/sdo/error_class.go:9-58`, contract-p0 §4), HTTP đặt ở chỗ phát:

| Mã | HTTP | `error_class` | Lý do | Ai thêm |
| --- | --- | --- | --- | --- |
| `comment_deleted` | 409 | không lớp | Comment đích đã tombstone; composer phân biệt "Bình luận này đã bị xóa." với xung đột thường. Không xếp `error_class = conflict` ở registry server để client HTTP không chạy đường "tải lại rồi thử" | G8-03 |
| `anchor_version_invalid` | 400 | không lớp | Version không thuộc tài liệu/tenant hoặc không còn; một thân lỗi cho mọi trường hợp (không lộ) | G8-04 |

Ánh xạ sang `PROTOCOL_ERROR_CODES` (`packages/core/office/docs-frame-protocol.ts:99-116`, vendored từ `F:web/docs/protocol/types.ts`;
G8-08 không thêm mã protocol mới, `PROTOCOL_VERSION` giữ 1):

| Server | Protocol `code` | `details` | `retryable` |
| --- | --- | --- | --- |
| 409 `comment_deleted` | `conflict` | `{code: "comment_deleted"}` | false |
| 400 `anchor_version_invalid` | `malformed` | `{code: "anchor_version_invalid"}` | false (thử lại ở receipt Lưu sau) |
| 400 `invalid_request` | `malformed` | `{code: "invalid_request"}` | false |
| 409 `idempotency_*` | `conflict` | `{code}` | false |
| 401 | `unauthorized` | — | false |
| 403 | `forbidden` | — | false |
| 404 | `not_found` | — | false |
| 413 `payload_too_large` (`handler/json.go:44`) | `too_large` | `{code: "payload_too_large"}` | false |
| 429 | `rate_limited` | — | true |
| Mất mạng / không tới được server (fetch lỗi, offline, timeout kết nối) | `network` | — | true |
| 5xx | `internal` | — (có `status`) | true |

`status` của `ProtocolErrorShape` (`docs-frame-protocol.ts:119-129`) mang HTTP gốc. Mất mạng dùng `network` vì protocol đã định
nghĩa nó cho "fetch failed / offline" (`docs-frame-protocol.ts:90-91`, `:112`); `internal` chỉ cho 5xx và ngoại lệ ném (chú thích ở
`docs-frame-protocol.ts:96`). Cả hai reviewer đồng ý; plan G8-08 đã sửa cùng giá trị trên root (`50fc0f174`), OQ-C9 đóng.

**`comment_deleted` ở frame — một luật duy nhất (finding R1-7 = FE-2):** protocol `code` là `conflict` + `details.code =
"comment_deleted"`, `retryable: false`. Lý do giữ `conflict`: plan G8-08 ghi đúng ánh xạ này ("`comment_deleted` → `conflict` +
`details.code`"), HTTP gốc là 409, G8-08 không thêm mã protocol mới (`PROTOCOL_VERSION` giữ 1), và `not_found` tệ hơn vì trùng S15
"tài liệu không còn". Vì `conflict` trong fork cũng là mã xung đột lưu/version (đường tải lại), luật chuẩn tắc cho mọi frame và host:

1. Bộ xử lý lỗi `comments.*` đọc `details.code` **trước** `code`. Có `details.code` → xử lý theo nó; chỉ khi không có mới rơi về
   nhánh theo `code`.
2. `details.code = "comment_deleted"`: **không** vào đường tải lại/thử lại, **không** reload tài liệu, giữ nguyên nháp composer, hiện
   "Bình luận này đã bị xóa." + "Sao chép nội dung" (`collabTargetDeleted`, `collabCopyDraft`, EXPERIENCE-G8:78), đánh dấu thread là
   đã xóa và tải lại **danh sách bình luận** (không phải tài liệu).
3. `details.code` bắt đầu `idempotency_` (`conflict`): không reload, giữ nháp, báo lỗi gửi chung; người dùng gửi lại tạo key mới.
4. Bộ xử lý xung đột lưu/version của editor không bao giờ nhận lỗi của `comments.*` (lỗi trả về chính request đó, không phát qua sự
   kiện `error` chung).

Test G8-08 (đi trong G8-A04): lỗi `conflict` + `comment_deleted` không gọi đường reload và giữ nháp; tương tự `idempotency_payload_mismatch`.

## 10. Frame protocol `comments.*` (G8-08)

Thay đổi hai repo, chủ seam Lead F: sửa fork `web/docs/protocol/{types,endpoint,host,client}.ts` trước, vendor ba file vào D
`packages/core/office/docs-frame-{protocol,endpoint,host}.ts` (cập nhật SHA ở header, `docs-frame-protocol.ts:1-6`), re-pin bằng
`office-frame-sync.mjs --pin`, `scripts/office/frame-protocol-vendor.test.mjs` giữ hash. Mọi thay đổi là **thêm tùy chọn**.

- Capability mới `comments` trong `CAPABILITY_KEYS` (`docs-frame-protocol.ts:289-306`); host chỉ quảng bá khi tài liệu bind UniWork
  và người dùng có ít nhất `view`. Frame chỉ gửi `comments.*`/`mentions.search` khi capability hiệu lực có `comments`.
- `InitUser` (`:417-419`) thêm `id?: string` — chỉ để biết "bình luận của tôi", không dùng cấp quyền (bất biến 2).
- `InitPayload` (`:373`) thêm `commentsLevel?: "view" | "edit" | "manage"` **(đề xuất, OQ-C12;** finding FE-9, BE-10, FE-r2-1):
  mức quyền tài liệu hiệu lực của người gọi (cùng giá trị `my_level`, `sdo/document.go:29`). Luật frame theo từng giá trị
  (G8-D3 tạm, mục 1.2):
  - `view` → không ghi gì: không composer, không sửa/xóa/resolve/mở lại (S12 "Chỉ xem").
  - `edit` → composer, trả lời, sửa/xóa bình luận **của mình** (`author_id = InitUser.id`), resolve/mở lại.
  - `manage` → như `edit`, thêm sửa/xóa bình luận của **người khác** (khớp `canModerate`, `document_comments.go:96-102`).
  - Host quảng bá capability `comments` thì **phải** gửi `commentsLevel`; init có `comments` mà thiếu `commentsLevel` là lỗi host —
    test protocol G8-08 khẳng định điều này (mục 12, G8-A04).
  - Thiếu trường (lỗi host, hoặc OQ-C12 bị bác khi ký): frame hiện composer và thao tác trên bình luận của mình, **không bao giờ**
    hiện sửa/xóa bình luận của người khác; một lỗi 403 từ server đổi panel sang "Chỉ xem". Không gửi request ghi nào để dò quyền.
  Frame không suy affordance từ `InitUser.id` ngoài việc nhận ra "của mình". Đây là gợi ý hiển thị; server vẫn là cổng quyền duy nhất.

| Message | Hướng | Kiểu | Payload | Kết quả |
| --- | --- | --- | --- | --- |
| `comments.list` | frame → host | request | `{kind?, since_token?}` | `{comments, mentions, list_token, unchanged}` (SDO 2.1; `unchanged = true` → frame giữ `comments` và `mentions` cũ) |
| `comments.create` | frame → host | request | `{kind, parent_id?, body, anchor?, base_version_id?}` | `{comment}` |
| `comments.update` | frame → host | request | `{comment_id, body}` | `{comment}` |
| `comments.delete` | frame → host | request | `{comment_id}` | `{outcome}` |
| `comments.resolve` | frame → host | request | `{comment_id}` | `{comment}` |
| `comments.reopen` | frame → host | request | `{comment_id}` | `{comment}` |
| `comments.revisions` | frame → host | request | `{comment_id}` | `{revisions}` |
| `comments.anchors` | frame → host | request | `{version_id, anchors:[{comment_id, anchor, state}]}` | `{updated, skipped, list_token}` |
| `mentions.search` | frame → host | request | `{q, limit?}` | `{candidates}` |
| `comments.changed` | host → frame | event | `{document_id}` (chỉ id) | — |
| `comments.reveal` | host → frame | request | `{comment_id}` | `{revealed: boolean}` |

- Tên message theo plan G8-08 (`comments.update`, `comments.anchors`); brief gọi `edit`/`anchors.update` — cùng nghĩa.
- `comments.create` trên web: host D sinh `Idempotency-Key` mỗi lần bấm Gửi (giữ qua retry của cùng lần gửi).
- `comments.reveal`: frame cuộn panel tới thread, đưa neo vào khung nhìn; neo `lost`/`stale` → chỉ mở thread, không mở comment khác;
  comment không có trong danh sách → `revealed: false`, frame hiện trạng thái S15 tương ứng.
- **Thứ tự `comments.reveal` (finding FE-3):**
  1. Host chỉ gửi sau khi nhận init ack có capability hiệu lực chứa `comments` (`InitAck.capabilities`, `:421-425`). Init ack không
     có `comments` → host không gửi reveal; web rơi về panel D với `?comment=`, desktop không làm gì thêm.
  2. Frame nhận reveal trước khi `comments.list` đầu tiên thành công thì **giữ** request (không trả `revealed: false`) và trả lời ngay
     sau list đầu tiên thành công. List đầu tiên lỗi → trả lỗi `not_ready`, `retryable: true`.
     **Hạn chờ (finding FE-r2-3) — chọn: frame trả `not_ready` trước khi host hết hạn.** Frame giữ reveal tối đa 10 s kể từ lúc
     nhận; quá 10 s mà list đầu tiên chưa xong → trả `not_ready`, `retryable: true`. Host gửi reveal với timeout mặc định
     `DEFAULT_TIMEOUT_MS = 30_000` (`packages/core/office/docs-frame-endpoint.ts:84`) và không đặt `timeoutMs` riêng thấp hơn 15 s.
     Lý do: hạn chờ là của frame (frame biết list đầu tiên đang ở đâu), còn timeout là tùy chọn từng host (`timeoutMs` 0 = chờ mãi,
     `docs-frame-endpoint.ts:61`), nên frame không dựa vào nó được; host luôn nhận một lỗi có kiểu (`not_ready`) thay vì `timeout`
     của transport, và list chậm không tốn thêm một lần thử lại vì timeout.
  3. Host thử lại **một lần** khi gặp `not_ready` hoặc `timeout`, sau 2 s hoặc ngay khi nhận `comments.changed` (cái nào đến trước);
     lần hai lỗi → host bỏ, không báo gì (panel frame tự hiện trạng thái lỗi tải).
  4. `revealed: false` chỉ mang nghĩa "danh sách đã tải và không có comment này": frame đã hiện S15, host **không** toast/hiện thêm.
  5. Mỗi `?comment=` / `comment_id` của vé launch gửi reveal một lần mỗi lần mở tài liệu; đổi query trên cùng trang gửi reveal mới.
- Desktop: preload sáu app mở `uniworkComments.*` → IPC `uniwork:comments:*` → main gọi D qua `authorizedRequest` cho tài liệu bind;
  tài liệu không bind → không request nào. Server không khả dụng → lỗi theo mục 9, panel chỉ đọc, nháp giữ trong renderer.
- **Một panel mỗi host (bất biến 8):** web: frame mở + capability hiệu lực có `comments` → panel của frame là panel duy nhất; host D
  không render `DocumentCommentsPanel` và chuyển `?comment=` thành `comments.reveal`; không frame / định dạng không có module / frame cũ
  không khai `comments` → panel D. Desktop: panel của editor (S12) + panel Discussion của shell (S13).
- Tương thích: frame mới ↔ host cũ không `comments` → editor ẩn chế độ server; host mới ↔ frame cũ → không đổi, `?comment=` rơi về
  panel D. Hook D riêng `packages/views/office/frame/use-frame-comments.ts` (không sửa `use-docs-frame-session.ts`).

## 11. Luật AI (bất biến 7, ADR 0010)

- Công cụ AI của editor (ví dụ `F:apps/docs/src/renderer/ai/comment-ops.ts`) trên tài liệu bind **không** gửi `comments.create`,
  `update`, `delete`, `resolve`, `reopen`, `anchors`. Nó chỉ đặt **bản nháp** vào composer (hoặc thẻ đề xuất trong panel).
- **Nháp AI không phải dòng `action_proposals`** (finding L-9 d). Nháp sống ở state composer của renderer (component G8-20, cùng
  kho nháp giữ qua reload của composer), không rời máy khách, không có bản ghi server nào. Lý do: ADR 0010 §2
  (`docs/adr/0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md:24`) điều phối **hành động ghi nghiệp vụ do agent đề xuất rồi
  được thực thi**; ở đây không có lệnh ghi nào của agent để thực thi — người dùng đọc, sửa tùy ý rồi tự bấm Gửi, và lệnh duy nhất là
  lệnh tạo của chính họ (`service.Human`, `created_by_kind`/`author_kind = human`). Vì vậy không có attribution hai phía để ghi, và
  không có bình luận `author_kind = agent` nào từ editor ở v1.
- Test (G8-12..15): AI tool trên tài liệu bind → không request `comments.create` nào trước khi người bấm Gửi. Tệp cục bộ giữ hành vi AI
  hiện có của fork.

## 12. Truy vết AC → task → lệnh → artifact

Lệnh là dòng spec của cloud runner (`node <RUNNER> test --spec reports/<lane>/cloud-spec-<seq>.txt --lane <lane> --out
reports/<lane>/cloud-test-<seq>.md`, contract-p0 §10); `go test` chạy trong `server/`. Artifact nằm dưới
`.uniwork-dev/office-g5g6g7/reports/` của Run; bằng chứng hàng ghi qua `scripts/office/g5g6g7/evidence.mjs` vào sổ
`test-results/office-g5g6g7-evidence/evidence.jsonl`. Tên lane báo cáo: `g8-collab` (lead), `g8-server` (L21), `g8-web` (L22),
`g8-fork_host` (L23), `g8-fork_editors` (L24), `g7-qa` (G8-19). Hai cột cuối được chép nguyên văn (bỏ escape `\|` của Markdown trong JSON) vào `acceptance-rows.json`, vào contract-p0 mục 10
(`command`, `artifact`) và bảng "Lệnh và artifact G8" của `acceptance.md`.

| AC | Task | Lệnh | Artifact |
| --- | --- | --- | --- |
| G8-A01 | G8-02, G8-12..15, G8-19 (góp G8-08, G8-20) | F vitest tác giả G8-02 (grep-test `userInfo(`/`USERNAME`/`LOGNAME` + đọc lại phần bình luận tệp) · F vitest adapter G8-12..15 (AI tool không gọi `comments.create` trước Gửi) · harness G8-19 bốn fixture | `reports/g8-fork_host/cloud-test-*.md`, `reports/g8-fork_editors/cloud-test-*.md`, `reports/g7-qa/g8-a01/` (dòng server + phần tệp đọc lại + log request) |
| G8-A02 | G8-04, G8-12..15, G8-19 | `go test ./internal/service ./internal/handler -run 'DocumentCommentAnchors\|IsolationMatrix'` · F vitest neo G8-12..15 (Lưu → neo mới, xóa → `lost`, reveal) · harness G8-19 | `reports/g8-server/cloud-test-*.md`, `reports/g8-fork_editors/cloud-test-*.md`, `reports/g7-qa/g8-a02/` (receipt neo + ba thân 400) |
| G8-A03 | G8-03, G8-10, G8-11 (góp G8-20) | `go test ./internal/service ./internal/handler -run 'DocumentComment(Kind\|CollabTombstoneHTTP\|Revision\|RevisionsTombstoneRefused\|ListToken)\|DocumentPurgeDropsTheCommentOrbit\|DocumentCopyCarriesNoComments'` · `go test ./migrations` (lint migration, `TestNewTablesCarryOrganizationID`, `TestEveryQueryNamesItsTenant`, `TestActorKindOnEveryCreatedBy`) · `pnpm vitest run packages/views/documents packages/core/api/endpoints/document-comments.test.ts` (gồm ca `unchanged`, dòng `discussion` ở client cũ) · F vitest panel G8-11 | `reports/g8-server/cloud-test-*.md`, `reports/g8-web/cloud-test-*.md` + ảnh S13 light/dark vi/en, `reports/g8-fork_editors/cloud-test-*.md` |
| G8-A04 | G8-08, G8-10, G8-11, G8-19 (góp G8-04, G8-20) | `pnpm vitest run packages/core/office packages/views/office/frame packages/core/realtime/use-realtime-sync.test.tsx` · `node --test scripts/office/frame-protocol-vendor.test.mjs` · F vitest protocol G8-08 (gồm `comment_deleted` không reload + giữ nháp, thứ tự + hạn chờ `comments.reveal`, `commentsLevel` view/edit/manage, init có `comments` thiếu `commentsLevel` = lỗi host) · harness G8-19 hai host | `reports/g8-fork_host/cloud-test-*.md`, `reports/g8-web/cloud-test-*.md`, `reports/g7-qa/g8-a04/` (ghi hình web ↔ desktop) |
| G8-A05 | G8-05, G8-06, G8-10 (góp G8-20) | `go test ./internal/notification ./internal/service ./internal/mentions -run 'DocumentMention\|MentionCandidates\|Claim\|TokenIDs'` · `pnpm vitest run packages/core/api/endpoints/document-comments.test.ts packages/views/documents` | `reports/g8-server/cloud-test-*.md`, `reports/g8-web/cloud-test-*.md` |
| G8-A06 | G8-05 | `go test ./internal/notification -run 'DocumentComment\|Titles\|Kinds'` (gồm `TestDocumentCommentCommentedNotification` viết lại theo G8-D4) · `pnpm vitest run packages/core/types packages/views/notifications packages/core/i18n` | `reports/g8-server/cloud-test-*.md` (bảng người nhận UNI-1337 từng hàng) |
| G8-A07 | G8-07, G8-19 (góp G8-08) | `go test ./internal/notification ./internal/service -run 'ResourceURL\|FilterReadableDocuments\|NotificationList\|OfficeLaunch'` · `pnpm vitest run packages/views/notifications/resource-href.test.ts packages/views/documents packages/core/api/endpoints/notifications.test.ts` · harness G8-19 deep link web + desktop | `reports/g8-web/cloud-test-*.md`, `reports/g8-server/cloud-test-*.md`, `reports/g7-qa/g8-a07/` (ảnh S15 năm ngoại lệ) |
| G8-A08 | G8-03, G8-04, G8-06, G8-08 | `go test ./internal/handler -run 'IsolationMatrix\|IsolationRealtime\|EveryBodyIDFieldHasAReferenceCase'` · `go test ./internal/service -run 'EveryAuditedCommandWritesItsRow\|ReusedAuditActionCommandsWriteTheirOwnRows'` · `node --test scripts/events-catalogue.test.mjs scripts/no-pii-log.test.mjs` | `reports/g8-server/cloud-test-*.md` |
| G8-A09 | G8-16, G8-17, G8-19 | F vitest `uniwork-auth`/`uniwork-docs` G8-16/G8-17 · harness G8-19 đăng nhập nhiều tổ chức + tạo/đổi tên/lưu trữ | `reports/g8-fork_host/cloud-test-*.md`, `reports/g7-qa/g8-a09/` + ảnh S16–S18 |
| G8-A10 | G8-18 | BLOCKED(G8-D3): lệnh do G8-18 đặt khi luật ký; dự kiến `go test ./internal/service -run 'DocumentMention.*NoAccess'` + F vitest composer | `reports/g8-server/…`, `reports/g8-fork_editors/…` khi gỡ chặn |

## 13. Câu hỏi mở (không gate nào đóng mặc định)

| ID | Câu hỏi | Khuyến nghị (giá trị tạm trong tài liệu) | Ai ký |
| --- | --- | --- | --- |
| OQ-C1 | Thêm trần ký tự riêng cho `body`? Hôm nay chỉ có trần request 1 MiB | Giữ 1 MiB ở v1 (đúng phụ lục); đề xuất trần 20 000 ký tự ở một thay đổi riêng cho cả task + tài liệu (lõi chung `comments.go`), mã `invalid_request` | Lead D + Advisor |
| OQ-C2 | `kind` bỏ trống khi tạo gốc, và comment gốc không neo | Bỏ trống: trả lời theo cha, gốc → `discussion` (giữ nghĩa dòng client cũ theo G8-D5). Gốc `kind=comment` bắt buộc `anchor` + `base_version_id`; trả lời không mang neo | Lead D + Lead F |
| OQ-C3 | Ngữ nghĩa dòng revisions | Ghi nội dung **bị thay** + số revision của nó, `created_by` = actor của lần sửa; bản hiện hành nằm ở `document_comments`; test "sửa → một dòng" khớp | Lead D |
| OQ-C4 | Bỏ cứng cuối cùng làm cha tombstone không còn con | Bỏ cứng dây chuyền lên gốc trong cùng tx (khung rỗng không con vô nghĩa, Q8) | Lead D + UX |
| OQ-C5 | Quyền và trần của `PUT anchors` | `edit`; ≤ 500 phần tử mỗi request (body vẫn ≤ 1 MiB); vượt → 400 `invalid_request` | Lead D |
| OQ-C6 | `comment_id` lạ trong vé launch | Bỏ im lặng, không lỗi (chỉ là gợi ý reveal; app tự hiện S15) | Lead D |
| OQ-C7 | "Người liên quan đến comment" khi resolve | v1 chỉ tác giả comment được resolve (mẫu 5 nói "bình luận của bạn"); người tham gia khác chờ Product | Product (UNI-1337) |
| OQ-C8 | Hai dòng (tiêu đề + nội dung) trong `titles.go` đang một chuỗi mỗi kind | `titles.go` + `notifications.kind.*` giữ câu **nội dung** (có actor + tài liệu, kênh push/email cần); tiêu đề ngắn thành khóa mới `notifications.kindTitle.*` cho Inbox/push title | Lead D (G8-05) |
| OQ-C9 | Plan G8-08 ánh xạ mất mạng → `internal`, trong khi protocol có `network` ("fetch failed / offline") | **Đã chốt r2** (hai reviewer đồng ý, lead giao): mất mạng → `network`, 5xx → `internal` (mục 9); plan G8-08 đã khớp trên root `50fc0f174` | Đóng |
| OQ-C10 | Đổi tên hiển thị không đổi `list_token` → client dùng `since_token` giữ tên chip cũ tới lần list đầy đủ kế | Chấp nhận v1: tên chip đến từ bảng `mentions` (mục 2.1), làm mới ở mỗi list đầy đủ (web mỗi lần invalidate; desktop khi token đổi) | UX |
| OQ-C11 | Chữ nhãn neo `lost` (`collabAnchorLost`) trùng chữ khung tombstone "Nội dung đã bị xóa" (EXPERIENCE-G8:74-75) dù comment còn sống | Chữ riêng: vi "Không còn tìm thấy vị trí được bình luận" / en "The commented location can no longer be found"; sửa EXPERIENCE-G8:74 và câu AC G8-A02 của plan ("cha hiện 'Nội dung đã bị xoá'") cùng lúc | UX + Advisor |
| OQ-C12 | Frame biết mức quyền bình luận để ẩn composer mà không phải thử request | Khuyến nghị (quyết định lead, chờ Advisor ký): `InitPayload.commentsLevel?: "view" \| "edit" \| "manage"` = mức quyền tài liệu hiệu lực (mục 10); `view` → không ghi; `edit` → composer + sửa/xóa của mình + resolve/mở lại (G8-D3 tạm); `manage` → thêm sửa/xóa của người khác; host quảng bá `comments` phải gửi trường này (test protocol G8-08). Thiếu trường → hiện composer và thao tác của mình, không bao giờ của người khác; 403 → "Chỉ xem"; server là cổng duy nhất. **Nếu OQ-C12 bị bác khi ký, luật "thiếu trường" này là toàn bộ luật** (không có `commentsLevel`) | Advisor (ký) + Lead F |

Không câu nào ở đây chặn G8-03/04/05/06/08: lane dùng giá trị tạm, ghi "theo draft contract-collab" trong packet.

Finding cho Advisor (thẻ G8-05 của plan, finding BE-11): thẻ G8-05 phải ghi rằng khi ngừng phát `document_commented` (kind giữ cho
dòng cũ), cùng thay đổi đó thêm các kind mới vào `kinds.go`, `titles.go`, `packages/core/i18n/locales/{vi,en}.json`,
`packages/core/types/notification.ts`, `kind-tone.ts`, `kind-icon.tsx`, `notification-category.ts`, với `titles_test.go` và
`kind-tone.test.ts` xanh (chi tiết mục 8.3).
