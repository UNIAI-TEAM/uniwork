# DOC-005 — Hợp đồng đăng nhập, phiên bản, đồng bộ và phục hồi nháp

> **Trạng thái:** accepted G0 — model tham chiếu, chưa shipped (Advisor g118, 2026-09-25; xem §8.6) · **Issue:** UNI-669 · **Parent:** UNI-656 ·
> **Roadmap:** C-01 (liên quan C-15/C-16) · **Ngày:** 2026-09-16.
> **Nguồn:** spec [Documents + UniWork Office G0](../../superpowers/specs/2026-09-16-documents-office-g0-design.md) §9;
> plan [G0](../../superpowers/plans/2026-09-16-documents-office-g0.md) Task 5;
> C-01 §2/§3/§5/§13; Q5-A, Q7-B, Q8-A.
> **Bằng chứng chạy:** `scripts/office-g0/run-contracts.mjs` — 41/41 ca khớp oracle,
> model version `uniwork-office-g0-protocol/2`, xuất `.go-tmp/office-g0/run-contracts.json`.
> Đây là **model tham chiếu**, **KHÔNG** phải chứng minh bảo mật sản phẩm, không phải
> E2E, và các con số ở đây là **kỳ vọng khi main chạy**, không phải kết quả đã chạy thay
> cho main. Xem §8 để biết chính xác mức bằng chứng và các giới hạn.

Tài liệu này chốt hợp đồng login/sync/phiên bản/xung đột/nháp cho Documents và
UniWork Office, kèm harness chạy được cho các ca lỗi bắt buộc. Nó **không** triển
khai service sản phẩm và **không** chứng nhận auth/tenant isolation cho mã sản phẩm
chưa viết (điều kiện "Đạt" của Task 5).

## 1. Ranh giới và mức bằng chứng

| Hạng mục | Trong G0 (tài liệu này) | Thuộc giai đoạn sau |
| --- | --- | --- |
| Luồng login desktop | Chốt luồng + bổ sung backend cần có; model hoá TTL/PKCE/dùng lại mã | G4 UNI-636 nối auth thật |
| Save/version/commit | Chốt protocol hai pha, phân loại lỗi, oracle từng ca | G2 UNI-658 adapter, G1 UNI-657 kho và commit thật |
| Change feed / sync | Chốt scope cursor, retention, tombstone, full resync | G5 UNI-660 sync đầy đủ, offline desktop |
| Nháp Q8 | Chốt quy tắc bền theo tài khoản + phục hồi sau logout/restart | G4/G5 nối draft store thật |
| Chuyển đổi Q7-B | Chốt "tạo Document mới, giữ nguồn/quyền" | G3/G4 theo engine DOC-004 |
| Engine parse/serialize | **Ngoài phạm vi** — thuộc DOC-004 | DOC-004 mở rộng bảng ca này |

Harness chạy trên Node 22 (chỉ built-in), không HTTP server, không middleware auth sản
phẩm, không document service, không engine, không browser. **Đây là model tham chiếu,
KHÔNG phải chứng minh bảo mật sản phẩm** và **không** chứng nhận auth/tenant isolation
cho mã sản phẩm chưa viết. **Authorization là ACL trong bộ nhớ ("modeled
authorization")** — mọi báo cáo đều ghi rõ.

Pha 1 tách protocol thành các module có test riêng, harness import đúng những module
đó (không viết lại logic lần hai):

| Module | Vai trò |
| --- | --- |
| `pkce.mjs` | RFC 7636 S256 = **BASE64URL**(SHA256(verifier)), không phải hex |
| `redirect.mjs` | đúng một callback `uniwork-office://auth/callback`, chặn scheme GenOffice |
| `auth-model.mjs` | nửa server (authorize/redeem) + nửa client (verifier/state/pending attempt) |
| `change-feed.mjs` | cursor opaque có chữ ký, snapshot highwater + catchup incremental |
| `permission-model.mjs` | ACL mang nguyên trạng khi tạo bản sao, không nâng `edit` → `manage` |
| `draft-store.mjs` | tầng byte bền đã được review chấp nhận: AES-256-GCM theo tài khoản + AAD, tên file opaque (HMAC namespace), thay byte nguyên tử; **không** quyết ACL |

`test-draft-store.mjs` (fixture **TEST-ONLY** cũ) vẫn còn trong cây để giữ lịch sử
review, nhưng **không** còn được harness dùng: `run-contracts.mjs` import thẳng
`draft-store.mjs`.

**Nháp**: byte nằm sau một store tiêm vào theo đúng seam của store sản phẩm —
`createDraftStore({ dir, keyProvider, namespaceKey })` → `read(account)`/`write(account, rows)`,
khóa cấp ngoài store. Harness import thẳng store byte bền **đã review-chấp nhận**
(`draft-store.mjs`) qua cùng seam đó — **thực thi store byte có biên**, **không** phải
quản lý khoá sản phẩm, không phải bằng chứng chịu crash/power-loss. Store
chỉ giữ byte: **model** (không phải store) mới thi hành account/ACL/base. Phần **thật**
trong harness: byte nháp ghi xuống đĩa (một file mỗi tài khoản, khoá tiêm từ ngoài),
nên "restart" nghĩa là model mới đọc lại byte từ đĩa.

## 2. Đăng nhập desktop (5.1)

Ưu tiên browser hệ thống để giữ MFA và chính sách tổ chức. Chốt luồng **authorization
code + PKCE** với callback về custom scheme của UniWork Office; device authorization
là phương án dự phòng khi môi trường không mở được browser hệ thống.

```text
Desktop                     Browser hệ thống                    UniWork API
   |-- mở authorize URL ------->|                                  |
   |   (code_challenge, state)  |-- GET /auth/google/start?next --> |
   |                            |<-- consent + callback -----------|
   |<-- uniwork-office://auth/callback?code&state ------------------|
   |-- POST /auth/desktop/exchange {code, code_verifier} ---------->|
   |<-- {access_token} + refresh trong kho bảo mật host -----------|
```

Bổ sung backend cần có (G4):

- `GET /auth/desktop/start` — sinh `code_challenge`/`state`, allowlist redirect
  scheme `uniwork-office://auth/callback`; **chặn** scheme của GenOffice để bản
  GenOffice đang cài không mở nhầm ứng dụng (task 4.6).
- `POST /auth/desktop/exchange` — đổi `code` + `code_verifier` (PKCE), phát hành
  session thiết bị; trả access token trong body, refresh token vào kho bảo mật OS.
- Bảng `device_sessions` (G4) để **thu hồi theo thiết bị** tách khỏi logout web.

### 2.1 PKCE phải đúng RFC 7636 S256 (BASE64URL, không phải hex)

Bản harness trước mã hoá challenge bằng **hex** SHA-256. RFC 7636 §4.2 quy định
`code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))`, nên một client chuẩn và
một server hex **không bao giờ khớp**: luồng login hỏng ở mọi lần, không phải ở ca hiếm.
`pkce.mjs` sở hữu phép mã hoá này và harness ghim thẳng vector RFC 7636 Appendix B:

```text
verifier  = dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk   (43 ký tự, [A-Za-z0-9-._~])
challenge = E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM   (43 ký tự, base64url, không '=')
```

Ca `pkce-s256-is-base64url` so challenge với `BASE64URL`, và khẳng định nó **khác**
`digest("hex")` — tức ca bắt được đúng lỗi hex cũ.

### 2.2 Client sở hữu verifier/state/pending attempt; callback phải khớp

Bản harness trước **không có client**: không verifier, không state, không pending
attempt, nên callback không hề bị ràng buộc vào lần đăng nhập đã khởi tạo nó.
`createClient().begin()` sinh verifier + state + một pending attempt; `complete()`
chỉ nhận callback có `state` và `redirect` đúng attempt đó và còn trong TTL. Verifier
**không bao giờ** rời client (không có trong authorize URL). Phía server,
`authorize()` phát **code ngắn hạn, dùng một lần**, ràng buộc **account + challenge +
đúng redirect**; `redeem()` kiểm reuse trước TTL (để "gọi hai lần" khác "quá muộn"),
rồi TTL, redirect, hình dạng verifier và cuối cùng là PKCE.

Callback đăng ký là **đúng một chuỗi**: `uniwork-office://auth/callback`.
`redirect.mjs` từ chối mọi near-miss (thêm dấu `/`, `https://`, và scheme
`genoffice://auth/callback` của bản GenOffice đang cài) **trước khi** một code tồn tại.

Quy tắc bắt buộc, đã có ca kiểm trong harness:

| Quy tắc | Ca |
| --- | --- |
| Challenge là BASE64URL(SHA256(verifier)), không phải hex | `pkce-s256-is-base64url` |
| Ca dùng cả ba vế: PKCE + một lần + TTL | `auth-code-expired-or-reused` |
| Mã authorization dùng một lần | `auth-code-expired-or-reused` |
| Mã hết hạn theo TTL thì bị từ chối | `auth-code-expired-or-reused` |
| `code_verifier` sai nghĩa là không đổi được phiên (mã lộ trong log vô dụng) | `auth-code-expired-or-reused` |
| Callback sai `state`/sai redirect/ngoài TTL thì không có phiên | `auth-code-expired-or-reused` (`auth-model.test.mjs`) |
| Access token hết hạn thì thao tác bị từ chối `token_expired` | `auth-code-expired-or-reused` |
| Token không bao giờ nằm trong URL, deep link hay log | §2 và review G4 (không có ca cơ học) |

Cookie refresh web hiện có **chưa** chứng minh đúng cho desktop: `refresh` xoay cookie
trên `/api/v1/auth`, không có khái niệm thiết bị. Vì vậy `device_sessions` là bổ sung
bắt buộc, không phải tuỳ chọn.
## 3. Phiên bản và save protocol (5.2)

Ba đơn vị tách biệt — lẫn chúng là nguồn gốc của "mất chữ" và "bảng phình":

| Đơn vị | Nghĩa | Đặc tính |
| --- | --- | --- |
| `working revision` | bộ đếm lạc quan cho bản làm việc | tăng mỗi lần commit, dùng để phát hiện nền cũ |
| checkpoint | mốc đặt tên / tự động / khôi phục | lịch sử người dùng quay lại, không phải mỗi lần gõ |
| immutable blob version | byte đã commit trong `document_versions` | bất biến, có checksum, trỏ `file_version_id` |

Save là **hai pha**, vì payload Office lớn không đi trong body JSON 1 MiB
(CLAUDE.md § Backend HTTP Rules):

1. `POST /documents/{id}/uploads` — client gửi byte tới object tạm, nhận `upload_id`
   + `checksum`. Server kiểm quyền `edit` tại đây.
2. `POST /documents/{id}/versions/commit` — tham chiếu `upload_id` + `base_revision`
   + `Idempotency-Key`. **Mọi thứ có thể từ chối save được quyết ở đây**: quyền,
   quota, engine tương thích, base revision, idempotency.

Thứ tự kiểm ở commit (đúng thứ tự trong harness):

```text
1. session        -> token_expired (401)
2. tombstone      -> document_deleted (410)
3. idempotency    -> idempotency_in_flight | idempotency_payload_mismatch | idempotency_key_reuse
4. permission     -> forbidden (403)        <- kiểm LẠI, không tin lúc upload
5. engine         -> engine_incompatible (409)
6. base revision  -> revision_conflict (422) | document_version_conflict (409)
7. quota          -> quota_exceeded (413)
8. commit: version row + current pointer + revision + quota cùng một transaction
```

**Kiểm quyền lúc commit, không chỉ lúc bắt đầu upload.** Ca
`revoke-between-upload-and-commit`: byte đã lên object tạm, quyền bị thu, commit trả
`forbidden`, bản hiện hành không đổi, object tạm thành mồ côi cho job dọn.

### 3.1 Khoá idempotency phải gồm fingerprint payload

`service.BeginIdempotent` hiện khoá theo `(organization_id, workspace_id, scope, key)`
và **không** so payload (`server/internal/service/idempotency.go`,
`server/pkg/db/queries/idempotency.sql`). Với helper đó, cùng key khác payload **phát
lại phản hồi cũ** — client tưởng payload B đã lưu trong khi payload B không tồn tại ở
đâu cả. Đây là khoảng trống phải đóng.

**Mức bằng chứng phải nói đúng hai phần tách biệt:**

- **Phát hiện nguồn (documentary):** đọc `idempotency.go` / `idempotency.sql` cho thấy
  khoá ledger không gồm fingerprint payload. Đây là **đọc mã nguồn**, không phải chạy.
- **So sánh mô hình (modeled):** chế độ `--legacy-model` chạy **chính model JS này**
  với công tắc fingerprint tắt đi, đứng thay cho hành vi Go đã đọc ở trên:

  ```text
  contract: {"outcome":"error","code":"idempotency_payload_mismatch","versions":2}
  legacy  : {"outcome":"replayed","code":null,"versions":2}
  ```

  Đây **không** phải lần chạy thật của `BeginIdempotent` (Go); nó là so sánh giữa hai
  cấu hình của **cùng một model JS**. Không có kết quả runtime nào của mã Go ở đây, và
  không tài liệu nào được phép trích nó như thể đã chạy Go.

Yêu cầu: `idempotency_keys` thêm cột `payload_fingerprint` (checksum của
`doc_id + base_revision + checksum byte`), và `BeginIdempotent` trả
`idempotency_payload_mismatch` (409) khi key đã tồn tại với fingerprint khác. Không
suy ra "đã bị chặn" chỉ vì có helper idempotency; khoảng trống này chỉ đóng khi có ca
chạy trên mã Go thật ở G1/G2.

## 4. Phân loại lỗi — một bảng, một đường client (5.3)

C-01 ghi `revision_conflict` 422; C-16 roadmap ghi conflict 409. Giữ hai mã HTTP để
tương thích, nhưng client **không** được suy đoán từ mã hay từ text. Mọi lỗi mang
thêm `errorClass`:

| Code | HTTP | errorClass | Client làm gì |
| --- | --- | --- | --- |
| `revision_conflict` | 422 | `conflict` | giữ cả hai bản, mở đối chiếu |
| `document_version_conflict` | 409 | `conflict` | **cùng một đường** như trên |
| `idempotency_payload_mismatch` | 409 | `conflict` | lỗi client, không tự retry |
| `idempotency_key_reuse` | 409 | `conflict` | lỗi client (khác actor) |
| `idempotency_in_flight` | 409 | `conflict` | retry sau backoff, không đổi key |
| `owner_requires_copy` | 409 | `conflict` | chuyển sang luồng tạo bản sao |
| `copy_consent_required` | 409 | `conflict` | chưa có đồng ý rõ ràng cho bản sao mất mát; hỏi người dùng rồi gửi lại |
| `document_deleted` | 410 | `gone` | dừng retry, ẩn khỏi danh sách |
| `change_cursor_expired` | 410 | `gone` | full resync từ cursor 0 |
| `forbidden` | 403 | `permission` | khoá trong app, giữ nháp |
| `quota_exceeded` | 413 | `quota` | giữ nháp `dirty`, báo người dùng |
| `engine_incompatible` | 409 | `incompatible` | chặn mở/sửa, yêu cầu cập nhật |
| `upload_already_committed` | 409 | `conflict` | upload đã tiêu; retry bằng cùng key hoặc upload mới |
| `token_expired` | 401 | `session` | refresh; thất bại thì giữ nháp |
| `not_found` | 404 | `missing` | không tìm thấy hoặc không hiển thị với actor hiện tại; không xác nhận tài nguyên tồn tại; rời màn hình, không retry mù |
| `draft_recovery_locked` | 409 | `conflict` | store nháp không đọc/ghi được (khoá sai, byte hỏng); giữ nguyên byte cũ, không coi là "không có nháp" |
| `authorization_code_expired` | 400 | `session` | mở lại luồng login desktop từ đầu |
| `authorization_code_reused` | 400 | `session` | code dùng một lần; mở lại luồng login |

Bảng này là hằng số trong `run-contracts.mjs` (`ERROR_CODES`) và có test khẳng định
hai mã conflict chia **một** `errorClass`.

### 4.1 Bản đồ trạng thái cho FE (5.6)

Yêu cầu FE của task 1 (DOC-001) phải nói cùng ngôn ngữ này. Mỗi trạng thái editor
là một hàm của (đã lưu tới đâu, còn quyền không, base còn khớp không):

| Trạng thái | Hành động người dùng | Lỗi liên quan | Quyền cần | Giai đoạn |
| --- | --- | --- | --- | --- |
| `loading` | chờ, huỷ | `token_expired` (401) | `view` | M1/G3 |
| `ready` | sửa, đặt tên phiên bản | — | `view` đọc, `edit` sửa | M1/G3 |
| `dirty` | chờ autosave, bỏ thay đổi | — | `edit` | M1/G3 |
| `saving` | chờ, huỷ nếu quá hạn | `idempotency_in_flight` | `edit` | M1/G3 |
| `saved` | tiếp tục | — | `edit` | M1/G3 |
| `conflict` | xem đối chiếu, giữ bản tôi thành bản sao/mốc | `revision_conflict`, `document_version_conflict` | `edit` | M1/G3 |
| `blocked` | Bảo vệ nháp gắn với tài khoản; không xuất, sao chép hoặc đồng bộ payload sang tài khoản khác. Bản đã commit chỉ được hiển/tải khi còn `view`; không bao gồm byte nháp. | `forbidden` (403) | Mất quyền `edit` còn hiệu lực; nếu mất cả `view`, ẩn nội dung đã commit. | M1/G4 |
| `quota-blocked` | giải phóng dung lượng, giữ nháp | `quota_exceeded` (413) | `edit` | M1/G2 |
| `incompatible` | cập nhật ứng dụng, chỉ đọc | `engine_incompatible` | — | G3/G4 |
| `deleted` | rời màn hình, không retry | `document_deleted` (410) | — | M1/G5 |
| `resyncing` | chờ full resync | `change_cursor_expired` (410) | `view` | G5 |

Ba bất biến cho FE, không thương lượng:

1. **Không trạng thái nào tự xoá nội dung người dùng.** `conflict`, `blocked`,
   `quota-blocked` đều giữ byte; chỉ commit xác nhận hoặc hành động bỏ rõ ràng mới xoá.
2. **Không trạng thái nào báo "đã lưu" khi server chưa commit.** Hết phiên, thu quyền,
   quota đầy đều là `blocked`/`quota-blocked`, không phải `saved`.
3. **`blocked` không có đường xuất.** Mất quyền trong app thì khoá trong app; không
   mở đường tải/sync sang tài khoản khác để vòng qua quyền.

## 5. Change feed và reconnect (5.3)

- Định danh theo `account / organization / workspace / document`; realtime chỉ **báo
  có thay đổi**, cursor là đường **bù** phần đã bỏ lỡ sau disconnect.
- **Cursor là opaque và có xác thực.** Cursor là một envelope `body.signature` có HMAC;
  body nêu account/org/ws nó được phát cho. Cursor bị tài khoản khác phát lại, hoặc bị
  sửa để mở rộng scope, bị **từ chối** (`forbidden`), không được tôn trọng. So sánh chữ
  ký bằng `timingSafeEqual`. Ca `cursor-is-bound-to-account-and-scope`.
- **Cursor lạnh (rỗng/"0") mở một snapshot trạng thái hiện tại, đóng băng tại highwater.**
  Thành viên và giá trị của snapshot được server đóng băng, nên trang 2 không bị
  retention hay writer giữa các trang làm vô hiệu; sự kiện ghi trong lúc snapshot mở
  được **ghim** và giao khi snapshot kết thúc. Trang cuối trả cursor **incremental** —
  đó là điểm duy nhất replay bắt đầu. Ca `snapshot-survives-retention-and-writers`,
  `snapshot-catchup-carries-raced-writes`.
- **Retention ngắn + catchup**: cursor incremental cũ hơn cửa sổ giữ trả
  `change_cursor_expired` (410); server **không** replay lịch sử xa và **không** lặng lẽ
  khởi động lại ở số 0. Client phải xin snapshot mới (full resync). Cursor snapshot treo
  quá TTL cũng trả `change_cursor_expired`, không âm thầm restart. Ca
  `frozen-snapshot-cursor-expires-not-restarts`, `tombstone-and-expired-cursor`.
- **Sự kiện lọc theo quyền LÚC ĐỌC.** Sự kiện actor không được đọc vẫn **đẩy cursor
  tiến** (cursor kẹt ở sự kiện ẩn là sync treo vô hạn) và tài liệu actor **chưa từng**
  có quyền **không bao giờ** rò rỉ, kể cả khi đã xoá. Ngoại lệ duy nhất là **revoke**:
  nó được giao cho đúng reader vừa mất quyền, chỉ mang **document id và không gì khác**.
  Ca `feed-cursor-advances-past-unreadable`, `tombstone-not-leaked-to-non-reader`.
- **Grant/revoke có mục tiêu.** Grant là upsert **chỉ** cho tài khoản được cấp; revoke
  là **id-only removal** chỉ gửi cho người **từng có** quyền — revoke không được thành
  cách liệt kê tài liệu cho người lạ. Ca `grant-targeted-revoke-id-only`.
- **Work Product owner ACL (C-01 §13)**: một thay đổi mức của owner **fan-out** tới mọi
  tài liệu uỷ quyền cho owner đó, và **chỉ** tới tài khoản có mức vừa đổi; id không xác
  định không bao giờ được nêu tên. Ca `owner-acl-transition-fans-out`.
- **Tombstone** ngăn file đã xóa sống lại từ hàng đợi cũ: retry save vào document đã
  xóa trả `document_deleted`; resync thấy sự kiện `deleted`, **không** thấy `created`
  trở lại (ca `tombstone-and-expired-cursor`).
- **Đổi tên/di chuyển/archive/restore/quyền đi cùng change feed; identity không phụ
  thuộc tên hay path.** Sự kiện chỉ mang `documentId` + `revision` (và `kind`), **không**
  mang tên hiển thị hay đường dẫn: client giữ state theo id và đọc lại metadata qua API có
  kiểm quyền. Quy tắc từng loại (ca trong `scripts/office-g0/change-feed.test.mjs`):
  - `renamed`, `moved` trong cùng workspace: một sự kiện trên cùng `documentId`, không đổi
    identity; ca `rename and in-workspace move keep the document identity and carry no name or path`.
  - `archived`, `restored`: giao theo thứ tự, chỉ cho reader còn quyền đọc; người không có
    quyền không biết gì và cursor của họ vẫn tiến; ca `archive and restore are delivered in
    order to readers only, and a stranger's cursor still advances`. `restored` chỉ áp cho
    tài liệu đang archive; tài liệu đã `deleted` là tombstone và **không** được restore qua
    feed (quy tắc tombstone ở trên, ca `tombstone-and-expired-cursor`).
  - Di chuyển sang workspace khác: ở scope cũ là **removal id-only** cho reader cũ (không nêu
    workspace đích), ở scope mới là **grant có mục tiêu**; người lạ không biết gì; ca `a move
    to another workspace is an id-only removal in the old scope and a targeted grant in the
    new one`.
  - Đổi quyền: `granted`/`removed` có mục tiêu như trên (`grant-targeted-revoke-id-only`,
    `owner-acl-transition-fans-out`).
## 6. Nháp bền và phục hồi (5.4, Q8-A)

Quy tắc chốt:

1. **Nháp thuộc tài khoản, ở tầng lưu trữ, và store chỉ giữ byte.** Một file/namespace
   mỗi tài khoản, tên file **opaque** (HMAC từ khoá namespace, tách biệt với khoá mã
   hoá). "B không đọc được nháp A" là tính chất của nơi byte nằm, nhưng store **không**
   quyết ai được đọc: **model** mới thi hành account/ACL/base. Đường đọc luôn qua
   phiên: `saveDraft`/`listDrafts`/`recoverDraft`/`discardDraft` nhận `sessionId` và
   từ chối khi `accountId` nêu ra không phải tài khoản của phiên (`forbidden`). Nếu
   chỉ dựa vào nơi byte nằm, việc "B không đọc được nháp A" thành quy ước chứ không
   phải kiểm tra.

   Store chỉ **cung cấp byte**, đúng seam `createDraftStore({ dir, keyProvider,
   namespaceKey })` → `read(account)`/`write(account, rows)`; khoá do host cấp từ
   ngoài và **bền qua restart** trong suốt vòng đời nháp. **Mọi lỗi đọc/khoá/thư mục là
   lỗi phục hồi nháp được bảo vệ, KHÔNG phải "rỗng/mới":** chỉ `ENOENT` mới nghĩa "chưa
   từng có nháp", còn lại phải nổi lên như lỗi phục hồi (recovery-locked) và **không**
   xoá byte. Store từ chối ghi đè ciphertext hiện có không đọc được, **không có cửa ghi
   đè**; model giữ nguyên byte và khoá trong app.
2. **Logout thu hồi phiên nhưng KHÔNG xóa nháp.** Sau logout, đường đọc qua phiên
   trả `token_expired`; byte vẫn còn trên đĩa và chỉ đọc lại được sau khi đăng nhập
   đúng tài khoản. Restart nạp lại theo tài khoản.
3. **Danh sách nháp chỉ trả METADATA.** `listDrafts` trả định danh, scope, base,
   trạng thái, số byte và `hasPayload` — **không** trả `payload`. Không tồn tại đường
   công khai nào trả payload ngoài recovery (`storageOnlyDrafts` bị **bỏ hẳn**: API
   niêm yết mà trả payload sẽ giao việc chưa gửi cho bất kỳ ai gọi được tên tài liệu,
   kể cả sau khi quyền đã bị thu). Ca `draft-list-never-returns-payload`.
4. **Danh tính nháp đầy đủ: account + org + ws + doc + baseRevision + baseVersion.**
   `recoverDraft` so **scope** (org/ws) với phiên và **chỉ** nhận base khớp **cả hai
   nửa**. Hai bản gửi dở của cùng tài liệu trên hai base khác nhau là **hai nháp riêng**,
   không bản này ghi đè bản kia; thiếu base đầy đủ mà có nhiều candidate thì trả
   `ambiguous` kèm danh sách base và **không payload**. Ca `draft-distinct-bases-kept-apart`,
   `draft-scope-is-account-org-ws`.
5. **Đăng nhập lại kiểm lại**: tài khoản, **quyền sống hiện tại**, scope hiện tại,
   document, base version.
   - Cùng tài khoản + còn quyền đọc/sửa + base khớp thì `recovered`.
   - Mất quyền thì `blocked`, **giữ byte**, khoá trong app, **không** xuất nơi khác.
   - Base đã đổi thì `conflict`, giữ cả hai, không tự merge nhị phân. **"Base khớp"
     nghĩa là khớp cả `baseRevision` và `baseVersion`**: revision khớp mà blob version
     đã đổi là mô tả một tài liệu khác, và áp nháp vào đó chính là kiểu "mất chữ" mà
     Q8 tồn tại để ngăn.
6. **Chỉ xóa nháp sau commit được xác nhận hoặc hành động bỏ rõ ràng.** Lỗi lưu/quota/
   mất mạng đều giữ nháp `dirty`. Byte chỉ rời store khi commit xác nhận tiêu đúng
   nháp đã sinh nó, hoặc khi người dùng **chủ động bỏ** (`discardDraft`). Không xoá sau
   lỗi đọc/xác thực/thiết lập khoá.

### 6.1 Trạng thái và điểm kiểm của harness

| Tình huống | Ca | Kỳ vọng |
| --- | --- | --- |
| B đọc nháp A bằng accountId của A | `draft-apis-require-matching-session` | `forbidden` |
| Logout rồi đọc nháp qua phiên cũ | `draft-apis-require-matching-session` | `token_expired`, byte còn 1 |
| Danh sách nháp không bao giờ trả payload | `draft-list-never-returns-payload` | không có `payload`; `storageOnlyDrafts` không tồn tại |
| Nháp cùng doc khác base | `draft-distinct-bases-kept-apart` | hai nháp riêng; thiếu base → `ambiguous`, không payload |
| Nháp khác org/ws với phiên | `draft-scope-is-account-org-ws` | `missing`/từ chối, không thấy nháp scope khác |
| Nháp lệch `baseVersion` | `recovery-checks-base-version` | `conflict`, giữ nháp |
| Người chưa từng có quyền với document đã xoá | `tombstone-not-leaked-to-non-reader` | không thấy tombstone |
| Cursor gặp sự kiện không đọc được | `feed-cursor-advances-past-unreadable` | cursor tiến, không lặp |
| Cursor bị tài khoản khác phát lại / bị sửa scope | `cursor-is-bound-to-account-and-scope` | `forbidden`, không tôn trọng |
| Bản sao chuyển đổi của Document thường | `copy-keeps-creator-access` | người tạo giữ đúng mức nguồn (`edit` vẫn là `edit`); người ngoài `forbidden` |

Ánh xạ sang mã hiện có: `packages/core/drafts/cleanup-registry.ts` đã có mẫu
"người sở hữu ghi kèm dữ liệu" (`draftWriteOwner`) và `releaseDraftsNotOwnedBy`;
`packages/core/platform/workspace-storage.ts` cấp namespace theo workspace. DOC-005
yêu cầu mở rộng cùng mẫu đó cho nháp Office: **namespace theo tài khoản** (không chỉ
workspace), và thêm trạng thái `blocked`/`conflict` như trên.

## 7. Chuyển đổi và tạo bản sao (5.4, Q7-B)

Chuyển đổi có thể mất thành phần **không bao giờ ghi đè nguồn**. Luồng:

1. Ước lượng độ trung thực và **cảnh báo đúng phần sẽ đổi**.
2. Người dùng **chủ động chọn** tạo bản sao.
3. Sinh **Document mới** (không phải version mới của nguồn), liên kết `sourceDocumentId`
   + `sourceVersion`, giữ nguyên byte gốc, lịch sử, quyền và nguồn gốc.
4. Nguồn thuộc Work Product thì **bản sao thuộc cùng Work Product**; quyền tiếp tục đi
   qua uỷ quyền sở hữu của C-01 §13, **không** mở cửa thứ hai.

### 7.1 Đồng ý rõ ràng, ACL nguyên trạng, nguồn gốc đầy đủ

- **Đồng ý rõ ràng**: client phải gửi `consent:"copy"` mà nó đã thu khi cảnh báo mất
  mát; thiếu thì `copy_consent_required` (409). Tạo bản sao là quyết định của người
  dùng, không phải mặc định. Ca `copy-requires-explicit-consent`.
- **ACL nguyên trạng, không nâng quyền**: bản sao mang **đúng** tập quyền của nguồn,
  **không** thêm mức nào mà người chuyển đổi chưa có. Người tạo có `edit` thì bản sao
  cũng chỉ `edit` — **không** `edit` → `manage`. Nguồn thuộc Work Product thì bản sao
  **không** mang ACL tài liệu nào: quyền tiếp tục đi qua **một** uỷ quyền owner duy nhất
  (cùng `owner_kind`/`owner_id`). Ca `conversion-carries-full-acl`,
  `copy-keeps-creator-access`, `copy-from-work-product`.
- **Kiểm mô hình quyền riêng cho kết quả tạo bản sao**: quyền trên bản sao là **kiểm
  riêng**, không suy từ kết quả upload; tài khoản ngoài Work Product đọc bản sao nhận
  `forbidden`.
- **Nguồn gốc**: bản sao ghi `sourceDocumentId`, `sourceVersion`, `sourceRevision`,
  `sourceFormat`, `sourceEngine` và `targetFormat`; nguồn **không bị đụng**
  (`currentVersion`/`revision`/`format` của nguồn không đổi). Ca `copy-records-provenance`.
- **Quota**: bản sao là tài liệu mới thật nên **tiêu quota** như mọi lần ghi; quota đầy
  → `quota_exceeded`, nguồn không đổi. Ca `conversion-respects-quota`.
- Chế độ `overwrite` bị từ chối `owner_requires_copy` — chuyển đổi không bao giờ ghi đè nguồn.

## 8. Bằng chứng chạy

```sh
node scripts/office-g0/run-contracts.mjs                              # 41/41 ca khớp oracle, ghi JSON
node scripts/office-g0/run-contracts.mjs --print --out <path>         # in bảng ca + ghi JSON
node scripts/office-g0/run-contracts.mjs --legacy-model               # so sánh MODELED (không chạy Go)
node --test scripts/office-g0/run-contracts.test.mjs                  # 16 self-test của harness
node --test scripts/office-g0/*.test.mjs                              # 132 test trên 10 file
node --check scripts/office-g0/<từng module>.mjs                      # cú pháp Node 22
```

Model version `uniwork-office-g0-protocol/2`; harness ghi `gitHead` vào JSON để đối
chiếu đúng commit khi main chạy. **Đây là các giá trị kỳ vọng/oracle**, không phải log
đã chạy của worker này: main chạy lệnh và lưu JSON; Cursor review patch. Bộ ca gồm:

- **41 ca fault** trong `FAULT_CASES`, mỗi ca có oracle viết thẳng (literal), cộng một
  danh sách **16 id bắt buộc của plan** (Task 5, "Ca bắt buộc") được khẳng định riêng để
  một ca bị xoá là lộ ra ngay.
- **16 self-test** của harness (`run-contracts.test.mjs`): kiểm bộ ca, oracle, ranh giới
  modeled, store nháp thật, và các finding đã đóng.
- **116 test module** trên 9 file: `pkce.test.mjs` (6, vector RFC 7636 Appendix B),
  `redirect.test.mjs` (3, đúng một callback), `auth-model.test.mjs` (13,
  state/verifier/redirect/TTL/replay/expiry), `change-feed.test.mjs` (14, cursor
  scope/snapshot/catchup/retention/revoke/fan-out), `draft-store.test.mjs` (25, byte
  bền + lỗi đọc/ghi), `draft-binding.test.mjs` (10, cleanup/discard theo scope),
  `draft-write-report.test.mjs` (28, report ghi hỏng/thành công),
  `permission-model.test.mjs` (10, rankOf/không nâng quyền),
  `owner-acl-transition.test.mjs` (7, fan-out mọi lần đổi mức).

| Ca trong plan | id | Kỳ vọng |
| --- | --- | --- |
| Hai save cùng base | `two-saves-same-base` | revision_conflict, giữ cả hai bản |
| Retry cùng payload | `retry-same-payload` | replay, không thêm version |
| Cùng key khác payload | `same-key-different-payload` | từ chối; legacy replay (khoảng trống §3.1) |
| Mất phản hồi sau commit | `lost-response-after-commit` | retry trả cùng version, không version thứ hai |
| Commit lỗi giữ bản hiện hành | `failed-commit-keeps-current` | version không đổi, object mồ côi |
| Logout/restart với nháp | `logout-restart-with-draft` | phiên thu hồi, nháp còn, phục hồi được |
| B không đọc/gửi nháp A | `account-b-cannot-reach-a-draft` | tách theo tài khoản |
| A mất quyền | `a-loses-permission` | blocked, giữ byte |
| A còn quyền, base đổi | `a-has-permission-base-changed` | conflict, hai bản còn |
| Quota hết | `quota-exhausted` | 413, giữ nháp dirty |
| Thu quyền giữa upload/commit | `revoke-between-upload-and-commit` | 403, bản hiện hành không đổi |
| Bản sao từ Work Product | `copy-from-work-product` | Document mới, giữ quyền/nguồn |
| Tombstone và cursor hết hạn | `tombstone-and-expired-cursor` | 410, full resync, không hồi sinh |
| Client/engine không tương thích | `client-engine-incompatible` | từ chối trước khi ghi |
| Token/code hết hạn/dùng lại | `auth-code-expired-or-reused` | PKCE + dùng một lần |
| Cùng key khi request đang chạy | `idempotency-in-flight` | 409, không chạy lệnh hai lần |

Các ca bổ sung sau review (ngoài 16 ca plan):

| Chủ đề | id | Kỳ vọng |
| --- | --- | --- |
| PKCE đúng RFC (base64url) | `pkce-s256-is-base64url` | challenge khớp vector Appendix B, khác hex |
| Đo mồ côi TRƯỚC khi retry | `orphans-measured-before-retry` | version/mồ côi đọc giữa lỗi và retry, không literal sau retry |
| Cursor bind account/scope | `cursor-is-bound-to-account-and-scope` | cursor của A bị B dùng → `forbidden`; sửa scope → `forbidden` |
| Snapshot sống qua retention/writer | `snapshot-survives-retention-and-writers` | trang 2 không mất dòng do retention |
| Catchup mang write đã đua | `snapshot-catchup-carries-raced-writes` | write trong lúc snapshot được giao ở incremental |
| Snapshot treo quá TTL | `frozen-snapshot-cursor-expires-not-restarts` | `change_cursor_expired`, không restart âm thầm |
| Grant/revoke có mục tiêu | `grant-targeted-revoke-id-only` | grant chỉ tới người được cấp; revoke id-only tới người từng có |
| Owner ACL fan-out | `owner-acl-transition-fans-out` | chỉ tài liệu uỷ quyền + chỉ tài khoản vừa đổi |
| Danh sách nháp không payload | `draft-list-never-returns-payload` | metadata only; `storageOnlyDrafts` không tồn tại |
| Nháp khác base giữ riêng | `draft-distinct-bases-kept-apart` | hai nháp; thiếu base → `ambiguous`, không payload |
| Nháp scope account/org/ws | `draft-scope-is-account-org-ws` | scope khác → `missing`/từ chối |
| Phục hồi kiểm cả base version | `recovery-checks-base-version` | lệch version → `conflict`, giữ nháp |
| Đọc nháp phải qua phiên | `draft-apis-require-matching-session` | đổi accountId → `forbidden`; logout → `token_expired`, byte còn |
| Upload thuộc người tạo, commit một lần | `upload-owner-and-single-commit` | người khác → `forbidden`; tái dùng → `upload_already_committed`; retry cùng key → replay |
| Ledger theo scope + kiểm lại quyền | `ledger-scoped-and-rechecked` | cùng key ở ws khác không xung đột; replay sau thu quyền → `forbidden` |
| Bản sao chuyển đổi tiêu quota | `conversion-respects-quota` | quota đầy → `quota_exceeded`, nguồn không đổi |
| Bản sao giữ quyền người tạo | `copy-keeps-creator-access` | người tạo `edit` vẫn `edit` (không lên `manage`); người ngoài `forbidden` |
| Bản sao mang đủ ACL nguồn | `conversion-carries-full-acl` | tập quyền nguyên trạng, không nâng |
| Bản sao ghi nguồn gốc | `copy-records-provenance` | source doc/version/revision/format/engine + target format |
| Bản sao cần đồng ý rõ ràng | `copy-requires-explicit-consent` | thiếu consent → `copy_consent_required` |
| Cursor tiến qua sự kiện không đọc được | `feed-cursor-advances-past-unreadable` | cursor tiến, không lặp vô hạn |
| Cursor từ log của tiến trình trước | `cursor-from-previous-log-expires-not-empty` | `change_cursor_expired` + snapshot mới, không "đã bắt kịp" rỗng |
| Phục hồi nêu nửa base không khớp | `recovery-refuses-unmatched-base-half` | `ambiguous`, không byte; khớp `discardDraft` |
| Tombstone không rò rỉ | `tombstone-not-leaked-to-non-reader` | người chưa từng có quyền không thấy `deleted` |
| Tài nguyên không tồn tại có kiểu | `unknown-resource-is-typed` | doc/upload lạ → `not_found` 404, `missing`, `unknown_resource` |
### 8.2 Mức bằng chứng và giới hạn — đọc trước khi trích dẫn

- **Đây là model tham chiếu, KHÔNG phải chứng minh bảo mật sản phẩm.** Không HTTP
  server, không auth middleware sản phẩm, không document service, không engine, không
  browser.
- **Authorization là mô hình hoá** (ACL trong bộ nhớ). Nó **không** phải tenant
  isolation sản phẩm và **không** thay test service G1/G4/G5.
- **Tầng nháp trong harness chạy store byte bền đã review-chấp nhận** (`draft-store.mjs`,
  AES-256-GCM + AAD theo tài khoản, tên file opaque) qua đúng seam sản phẩm
  (`createDraftStore({dir,keyProvider,namespaceKey})`). Đây là **thực thi store byte có
  biên**, **không** phải quản lý khoá sản phẩm, không phải bằng chứng chịu crash hay
  power-loss (khoá do harness tiêm; không có test crash/power-loss nào). Store chỉ giữ
  byte; model thi hành account/ACL/base.
- **So sánh `--legacy-model` là modeled, không phải chạy Go.** Phát hiện về
  `BeginIdempotent` là **đọc nguồn** (documentary) cộng **so sánh mô hình**; nó **không**
  phải runtime proof của mã Go.
- Engine parse/serialize/convert **ngoài phạm vi**: DOC-004 sở hữu contract engine.
- **Bộ nhớ snapshot/carryover có biên**: `carryoverCap = max(64, retention*8)`; quá biên
  thì retention thắng và cursor hết hạn (đường full-resync đã tài liệu hoá). Đây là giới
  hạn của model, không phải thuộc tính sản phẩm.
- Chỉ dùng built-in Node 22; thư mục tạm nằm trong workspace qua `environment.ps1`; mỗi
  ca một thư mục riêng, khoá tiêm từ ngoài và sống qua restart cùng ca, không nháp nào
  đi xuyên ca.
- QA-01: macOS/Safari thật chờ UNI-671; kết quả ở đây là dev, không phải nghiệm thu Mac.

### 8.3 Ghi chú lịch sử (đính chính)

Các mục "Vòng sửa 1..4" ở bản trước **không** phải bốn vòng được review độc lập. Theo
đúng hồ sơ thực tế, chúng là **một submission gộp**, **chưa được review độc lập**; số
đếm khác nhau giữa các mục chỉ phản ánh các lần sửa của cùng một submission. Mọi con số
"25/25", "21/21", "24/25" ở bản trước **đã bị thay** bằng tập 41 ca hiện tại và không
được trích lại như bằng chứng độc lập.

### 8.4 Các finding review đã đóng (mapping)

| Finding phải đóng | Đóng bằng |
| --- | --- |
| `listDrafts` rò payload sau revoke; bỏ bypass `storageOnlyDrafts`; sửa oracle thiếu trung thực | metadata-only + ca `draft-list-never-returns-payload` |
| Danh tính nháp account/org/ws/doc/baseRevision/baseVersion; giữ base chưa phân giải khác nhau | ca `draft-distinct-bases-kept-apart`, `draft-scope-is-account-org-ws` |
| Phục hồi so scope + quyền sống + đúng base | `recovery-checks-base-version`, `draft-apis-require-matching-session` |
| PKCE S256 base64url; verifier/state/pending attempt + binding callback; code ngắn hạn một lần bind account/challenge/redirect; callback cố định | `pkce-s256-is-base64url`, `auth-code-expired-or-reused` + module tests |
| Feed scope account/org/ws; cursor opaque authenticated; snapshot highwater + catchup; grant/revoke/owner ACL | `cursor-is-bound-to-account-and-scope`, `snapshot-*`, `grant-targeted-revoke-id-only`, `owner-acl-transition-fans-out` |
| Chuyển đổi giữ nguyên ACL nguồn, không nâng `edit`→`manage`; Work Product delegation; kiểm quyền kết quả tạo; nguồn gốc; đồng ý; quota | `conversion-carries-full-acl`, `copy-keeps-creator-access`, `copy-records-provenance`, `copy-requires-explicit-consent`, `conversion-respects-quota` |
| Commit lỗi/mồ côi phải ĐO trước retry, không literal | `orphans-measured-before-retry` |
| Bỏ tuyên bố "mọi lỗi hội tụ" nếu thực tế blocked; legacy là so sánh model, không chạy Go | §3.1 + §8.2; oracle ca tự ghi kết cục blocked |

### 8.5 Kiểm chứng bằng mutation (scratch, không ship)

Mỗi finding ở §8.4 gắn với một mutation tái lập defect gốc, chạy trên bản sao scratch
(ngoài patch, không commit). Kỳ vọng: mutation phải **làm đỏ đúng ca** nó nhắm, chứng
tỏ fixture/ca thực sự bắt được defect chứ không luôn xanh:

| Mutation (tái lập defect gốc) | Ca phải FAIL |
| --- | --- |
| `payload-leaks-from-listDrafts` | `draft-list-never-returns-payload` |
| `pkce-challenge-is-hex` | `pkce-s256-is-base64url` (+ login fixture) |
| `cursor-signature-not-checked` / `cursor-scope-not-checked` | `cursor-is-bound-to-account-and-scope` |
| `conversion-elevates-converter-to-manage` | `copy-keeps-creator-access`, `conversion-carries-full-acl` |
| `conversion-without-consent` | `copy-requires-explicit-consent` |
| `orphan-deleted-on-refused-commit` | `failed-commit-keeps-current`, `orphans-measured-before-retry` |
| `revoke-fans-out-to-everyone` | `grant-targeted-revoke-id-only` |

## 9. Việc tiếp theo

| Việc | Giai đoạn | Ghi chú |
| --- | --- | --- |
| Thêm `payload_fingerprint` + `idempotency_payload_mismatch` | G1/G2 | §3.1, có test hồi quy trước |
| `device_sessions` + endpoint desktop exchange | G4 UNI-636 | §2 |
| Thêm `errorClass` vào `mapServiceError` + endpoint schema client | G1/G2 | §4, giữ 422/409 |
| Namespace nháp theo tài khoản + trạng thái blocked/conflict | G4/G5 | §6, theo mẫu `drafts/cleanup-registry.ts` |
| Change feed + cursor retention + tombstone ở service thật | G5 UNI-660 | §5 |
| Mở rộng bảng ca sang engine open/serialize | DOC-004 | §1, cùng harness |

Các ca E2E phải chạy lại ở G1/G4/G5: conflict hai client thật, logout/restart trên
binary desktop thật, thu quyền giữa upload/commit qua API thật, full resync sau
disconnect dài.

### 9.1 Thứ tự migration và rollout client (5.6)

Server luôn đi trước client; mỗi bước tương thích ngược với client đang chạy, và client
chỉ bật hành vi mới sau khi đọc được capability tương ứng từ server.

| Bước | Server (G1/G2) | Client (web G3, desktop G4) | Điều kiện sang bước sau |
| --- | --- | --- | --- |
| 1 | Thêm `errorClass` vào `mapServiceError`, giữ nguyên HTTP 422/409 | Client cũ bỏ qua trường lạ; client mới đọc `errorClass` nếu có, không thì suy từ status | Schema endpoint có malformed-response test (quy tắc API compatibility) |
| 2 | Migration thêm cột `payload_fingerprint` (nullable), ghi fingerprint cho mọi request mới; bản ghi cũ không có fingerprint được coi là "chưa biết", không phải "khớp" | Không đổi | Test hồi quy §3.1 xanh trên dữ liệu có và không có fingerprint |
| 3 | Bật `idempotency_payload_mismatch` cho cùng key khác payload | Client hiển thị lỗi xung đột thay vì retry mù | Không còn request nào ghi thiếu fingerprint trong cửa sổ giữ key |
| 4 | Change feed + cursor ký + retention + tombstone ở service thật (G5 UNI-660) | Client chuyển từ poll sang cursor, xử lý `change_cursor_expired` bằng full resync | E2E full resync sau disconnect dài |
| 5 | `device_sessions` + endpoint desktop exchange (G4 UNI-636) | Desktop login PKCE qua trình duyệt hệ thống; token vào kho bảo mật host | Kiểm khi GenOffice cùng cài (callback không mở nhầm app) |
| 6 | Namespace nháp theo tài khoản + trạng thái `blocked`/`conflict` (G4/G5) | Bật khôi phục nháp Q8 và bản sao Q7 | E2E logout/restart trên binary desktop thật |

Rollback: bước 1-2 là additive (bỏ qua được); bước 3 tắt được bằng feature flag mà không
mất dữ liệu; bước 4-6 giữ đường cũ song song cho tới khi E2E của bước đó xanh.
