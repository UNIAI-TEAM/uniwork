# DOC-005 — Hợp đồng đăng nhập, phiên bản, đồng bộ và phục hồi nháp

> **Trạng thái:** in-progress (G0, chưa shipped) · **Issue:** UNI-669 · **Parent:** UNI-656 ·
> **Roadmap:** C-01 (liên quan C-15/C-16) · **Ngày:** 2026-09-16.
> **Nguồn:** spec [Documents + UniWork Office G0](../../superpowers/specs/2026-09-16-documents-office-g0-design.md) §9;
> plan [G0](../../superpowers/plans/2026-09-16-documents-office-g0.md) Task 5;
> C-01 §2/§3/§5/§13; Q5-A, Q7-B, Q8-A.
> **Bằng chứng chạy:** `scripts/office-g0/run-contracts.mjs` — 25/25 ca khớp oracle,
> xuất `.go-tmp/office-g0/run-contracts.json`. Đây là **model tham chiếu**, không phải
> E2E sản phẩm. Xem §8 để biết chính xác mức bằng chứng.

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

Harness chạy trên Node, không HTTP server, không middleware auth sản phẩm, không
document service, không engine, không browser. **Authorization là ACL trong bộ nhớ
("modeled authorization")** — mọi báo cáo đều ghi rõ. Phần **thật**: nháp ghi xuống
đĩa (một file mỗi tài khoản), nên "restart" nghĩa là model mới đọc lại byte từ đĩa.

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

Quy tắc bắt buộc, đã có ca kiểm trong harness:

| Quy tắc | Ca |
| --- | --- |
| Mã authorization dùng một lần | `auth-code-expired-or-reused` |
| Mã hết hạn theo TTL thì bị từ chối | `auth-code-expired-or-reused` |
| `code_verifier` sai nghĩa là không đổi được phiên (mã lộ trong log vô dụng) | `auth-code-expired-or-reused` |
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
đâu cả. Đây là khoảng trống phải đóng, và harness chứng minh nó là sự thật:

```text
contract: {"outcome":"error","code":"idempotency_payload_mismatch","versions":2}
legacy  : {"outcome":"replayed","code":null,"versions":2}
```

Yêu cầu: `idempotency_keys` thêm cột `payload_fingerprint` (checksum của
`doc_id + base_revision + checksum byte`), và `BeginIdempotent` trả
`idempotency_payload_mismatch` (409) khi key đã tồn tại với fingerprint khác. Không
suy ra "đã bị chặn" chỉ vì có helper idempotency.

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
| `document_deleted` | 410 | `gone` | dừng retry, ẩn khỏi danh sách |
| `change_cursor_expired` | 410 | `gone` | full resync từ cursor 0 |
| `forbidden` | 403 | `permission` | khoá trong app, giữ nháp |
| `quota_exceeded` | 413 | `quota` | giữ nháp `dirty`, báo người dùng |
| `engine_incompatible` | 409 | `incompatible` | chặn mở/sửa, yêu cầu cập nhật |
| `upload_already_committed` | 409 | `conflict` | upload đã tiêu; retry bằng cùng key hoặc upload mới |
| `token_expired` | 401 | `session` | refresh; thất bại thì giữ nháp |
| `not_found` | 404 | `missing` | tài nguyên không tồn tại; rời màn hình, không retry mù |
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
| `blocked` | chỉ đọc; **không** xuất nơi khác | `forbidden` (403) | mất `edit` | M1/G4 |
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

- Định danh theo `account / organization / workspace / document`; cursor là số tăng.
- Realtime chỉ **báo có thay đổi**; cursor là đường **bù** phần đã bỏ lỡ sau disconnect.
- Retention có hạn; cursor cũ hơn mốc giữ nghĩa là `change_cursor_expired`, client full resync.
- **Tombstone** ngăn file đã xóa sống lại từ hàng đợi cũ: retry save vào document đã
  xóa trả `document_deleted`; resync thấy sự kiện `deleted`, **không** thấy `created`
  trở lại (ca `tombstone-and-expired-cursor`).
- Sự kiện lọc theo quyền **lúc đọc**: cursor không replay tài liệu của tài khoản khác.
- Đổi tên/di chuyển/archive/restore/quyền đi cùng change feed; identity **không** phụ
  thuộc tên hay path.
## 6. Nháp bền và phục hồi (5.4, Q8-A)

Quy tắc chốt:

1. **Nháp thuộc tài khoản, ở tầng lưu trữ.** Một file/namespace mỗi tài khoản — "B
   không đọc được nháp A" là tính chất của nơi byte nằm. Nhưng **đường đọc vẫn phải
   qua phiên**: `saveDraft`/`listDrafts`/`discardDraft` nhận `sessionId` và từ
   chối khi người gọi nêu `accountId` không phải tài khoản của phiên (`forbidden`).
   Nếu chỉ dựa vào nơi byte nằm, việc "B không đọc được nháp A" thành quy ước chứ
   không phải kiểm tra.
2. **Logout thu hồi phiên nhưng KHÔNG xóa nháp.** Sau logout, đường đọc qua phiên
   trả `token_expired`; byte vẫn còn trên đĩa và chỉ đọc lại được sau khi đăng nhập
   đúng tài khoản. Restart nạp lại theo tài khoản.
3. **Đăng nhập lại kiểm lại**: tài khoản, quyền hiện tại, document, base version.
   - Cùng tài khoản + còn quyền + base khớp thì `recovered`.
   - Mất quyền thì `blocked`, **giữ byte**, khoá trong app, **không** xuất nơi khác.
   - Base đã đổi thì `conflict`, giữ cả hai, không tự merge nhị phân. **"Base khớp"
     nghĩa là khớp cả `baseRevision` và `baseVersion`**: revision khớp mà blob version
     đã đổi là mô tả một tài liệu khác, và áp nháp vào đó chính là kiểu "mất chữ" mà
     Q8 tồn tại để ngăn.
4. **Chỉ xóa nháp sau commit được xác nhận hoặc hành động bỏ rõ ràng.** Lỗi lưu/quota/
   mất mạng đều giữ nháp `dirty`.

### 6.1 Trạng thái và điểm kiểm của harness

| Tình huống | Ca | Kỳ vọng |
| --- | --- | --- |
| B đọc nháp A bằng accountId của A | `draft-apis-require-matching-session` | `forbidden` |
| Logout rồi đọc nháp qua phiên cũ | `draft-apis-require-matching-session` | `token_expired`, byte còn 1 |
| Nháp lệch `baseVersion` | `recovery-checks-base-version` | `conflict`, giữ nháp |
| Người chưa từng có quyền với document đã xoá | `tombstone-not-leaked-to-non-reader` | không thấy tombstone |
| Cursor gặp sự kiện không đọc được | `feed-cursor-advances-past-unreadable` | cursor tiến, không lặp |
| Bản sao chuyển đổi của Document thường | `copy-keeps-creator-access` | người tạo `manage`, người ngoài `forbidden` |

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

Ca `copy-from-work-product` khẳng định: bản sao cùng `owner_kind`/`owner_id`, liên kết
nguồn, số version nguồn không đổi, chế độ `overwrite` bị từ chối `owner_requires_copy`,
và tài khoản ngoài Work Product đọc bản sao nhận `forbidden`.

## 8. Bằng chứng chạy

```sh
node scripts/office-g0/run-contracts.mjs                    # 25/25, ghi JSON
node scripts/office-g0/run-contracts.mjs --legacy-idempotency --out <path>
node --test scripts/office-g0/run-contracts.test.mjs
```

Kết quả thật (chạy tại `feature/UNI-669-office-sync-contracts`; JSON ghi `gitHead` để
đối chiếu): **25/25 ca khớp oracle**. Ca bắt buộc của plan so với id ca:

| Ca trong plan | id | Kết quả |
| --- | --- | --- |
| Hai save cùng base | `two-saves-same-base` | revision_conflict, giữ cả hai bản |
| Retry cùng payload | `retry-same-payload` | replay, không thêm version |
| Cùng key khác payload | `same-key-different-payload` | từ chối; legacy replay (khoảng trống §3.1) |
| Mất phản hồi sau commit | `lost-response-after-commit` | retry hội tụ về cùng version |
| Commit lỗi giữ bản hiện hành | `failed-commit-keeps-current` | version không đổi, object mồ côi |
| Logout/restart với nháp | `logout-restart-with-draft` | phiên thu hồi, nháp còn, phục hồi được |
| B không đọc/gửi nháp A | `account-b-cannot-reach-a-draft` | tách theo tài khoản |
| A mất quyền | `A-loses-permission` | blocked, giữ byte |
| A còn quyền, base đổi | `A-has-permission-base-changed` | conflict, hai bản còn |
| Quota hết | `quota-exhausted` | 413, giữ nháp dirty |
| Thu quyền giữa upload/commit | `revoke-between-upload-and-commit` | 403, bản hiện hành không đổi |
| Bản sao từ Work Product | `copy-from-work-product` | Document mới, giữ quyền/nguồn |
| Tombstone và cursor hết hạn | `tombstone-and-expired-cursor` | 410, full resync, không hồi sinh |
| Client/engine không tương thích | `client-engine-incompatible` | từ chối trước khi ghi |
| Token/code hết hạn/dùng lại | `auth-code-expired-or-reused` | PKCE + dùng một lần |
| Cùng key khi request đang chạy | `idempotency-in-flight` | 409, không chạy lệnh hai lần |
| Cursor tiến qua sự kiện không đọc được | `feed-cursor-advances-past-unreadable` | cursor nhảy qua sự kiện bị lọc, không lặp vô hạn |
| Tombstone không rò rỉ cho người ngoài | `tombstone-not-leaked-to-non-reader` | người chưa từng có quyền không thấy `deleted` |
| Bản sao giữ quyền người tạo | `copy-keeps-creator-access` | người tạo vẫn `manage`; người ngoài `forbidden` |
| Phục hồi kiểm cả base version | `recovery-checks-base-version` | lệch version → `conflict`, giữ nháp |
| Đọc nháp phải qua phiên | `draft-apis-require-matching-session` | đổi accountId → `forbidden`; logout → `token_expired`, byte còn |
| Upload thuộc người tạo, commit một lần | `upload-owner-and-single-commit` | người khác commit → `forbidden`; tái dùng upload đã commit → `upload_already_committed`; retry cùng key → replay |
| Ledger idempotency theo scope và kiểm lại quyền | `ledger-scoped-and-rechecked` | cùng key ở workspace khác không xung đột; replay sau khi thu quyền → `forbidden` |
| Bản sao chuyển đổi tiêu quota | `conversion-respects-quota` | quota đầy → `quota_exceeded`, nguồn không đổi |
| Tài nguyên không tồn tại trả lỗi có kiểu | `unknown-resource-is-typed` | doc/upload lạ → `not_found` 404, `missing`, `unknown_resource` |

Chín ca cuối được thêm ở các vòng sửa sau review: chúng đóng khoảng trống mà bộ 16 ca
ban đầu còn để lọt (§8.2-§8.5).

### 8.1 Giới hạn — đọc trước khi trích dẫn bằng chứng

- Đây là **model tham chiếu**: không HTTP, không auth middleware sản phẩm, không
  document service, không engine, không browser.
- **Authorization là mô hình hoá** (ACL trong bộ nhớ). Nó **không** phải tenant
  isolation sản phẩm và **không** thay test service G1/G4/G5.
- Engine parse/serialize/convert **ngoài phạm vi**: DOC-004 sở hữu contract engine và
  mở rộng bảng ca này (giữ một sổ bằng chứng).
- Nháp là ghi đĩa thật; phục hồi kiểm bằng model mới đọc lại byte.
- E2E web–server–desktop vẫn thuộc G5/G7.
- QA-01: macOS/Safari thật chờ UNI-671; kết quả ở đây là dev, không phải nghiệm thu Mac.

### 8.2 Vòng sửa sau review

Bộ 16 ca đầu tiên không chứng minh được năm tính chất dưới đây: chúng đã xanh vì
implementation làm sai theo cách oracle không hỏi tới. Một probe độc lập của main
trên chính worktree này phát hiện, rồi cả implementation và bộ ca được sửa cùng lúc:

| Lỗi đã xác nhận | Bằng chứng trước khi sửa | Đã sửa |
| --- | --- | --- |
| Cursor kẹt khi trang đầu toàn sự kiện không đọc được | `{ events: 0, nextCursor: "0" }` → lặp vô hạn | `nextCursor` đi theo vị trí đã quét |
| Bản sao Document thường mất quyền người tạo | `openDocument(copy)` → `forbidden` cho chính người tạo | bản sao cấp `manage` cho người tạo |
| Tombstone rò rỉ sang người không có quyền | B thấy `deleted:doc-a` dù chưa từng có quyền | tombstone qua kiểm quyền lúc đọc |
| Phục hồi bỏ qua `baseVersion` | nháp `baseVersion: 99` → `recovered` | lệch version → `conflict` |
| Đường đọc nháp không qua phiên | `listDrafts("account-a")` đọc được ngay cả sau logout | API nháp nhận `sessionId`, `forbidden` khi lệch |

Việc này là vòng sửa 1 sau review của DOC-005, được main thực hiện khi các agent
implement/review không còn khe chạy; nội dung hợp đồng không đổi, chỉ các bảo đảm
được siết lại và có ca chứng minh.

**Kiểm chứng các ca mới bằng mutation.** Năm bản sao của harness được tạo trong
`../.uniwork-dev/office-g0/mutants/` (ngoài repo, không commit), mỗi bản hoàn lại
đúng một fix. Kết quả chạy `node run-contracts.mjs` trên từng bản:

| Bản hoàn lại fix | Exit | Ca thất bại |
| --- | --- | --- |
| Cursor quét theo vị trí | 1 | `feed-cursor-advances-past-unreadable` (20/21) |
| Tombstone qua kiểm quyền | 1 | `tombstone-not-leaked-to-non-reader` (20/21) |
| Bản sao cấp quyền người tạo | 1 | `copy-keeps-creator-access` (20/21) |
| Phục hồi kiểm `baseVersion` | 1 | `recovery-checks-base-version` (20/21) |
| API nháp qua phiên | 1 | 8 ca, gồm `draft-apis-require-matching-session` (13/21) |

Nghĩa là mỗi tính chất mới có ít nhất một ca thật sự phụ thuộc vào fix tương ứng,
không phải ca trang trí luôn xanh.

### 8.3 Vòng sửa 2

Probe thứ hai của main trên cùng worktree tìm thêm hai lỗi trong save protocol:

| Lỗi đã xác nhận | Bằng chứng trước khi sửa | Đã sửa |
| --- | --- | --- |
| Người sửa khác commit được upload của người khác | tài khoản B `edit` cùng tài liệu commit upload của A → `committed`, version 2 | `commitSave` từ chối khi `upload.accountId` không phải người gọi (`forbidden`) |
| Upload đã commit bị tái dùng với key mới | cùng upload, key mới → `committed`, version 3 | upload đã commit trả `upload_already_committed` (409); retry cùng key vẫn replay |

Hai lỗi này không hiện trong bộ 16 ca đầu vì các ca cũ chỉ đổi key/payload trên
upload mới, và chỉ một tài khoản thao tác. Ca `upload-owner-and-single-commit`
khẳng định cả ba vế: người khác `forbidden`, tái dùng bị chặn, retry cùng key replay.

Kiểm chứng bằng mutation cho hai fix này (bản sao trong
`../.uniwork-dev/office-g0/mutants-r2/`):

| Bản hoàn lại fix | Exit | Kết quả |
| --- | --- | --- |
| Bỏ kiểm `upload.accountId` | 1 | ca crash bằng `ProtocolError: upload_already_committed` ngay khi A commit chính upload của mình sau khi B đã commit hộ |
| Bỏ kiểm `upload.committed` | 1 | `upload-owner-and-single-commit` FAIL (21/22) |

### 8.4 Vòng sửa 3

Probe thứ ba của main tìm thêm ba lỗi, đều nằm ngoài tập tình huống bộ 16 ca đầu
mô tả:

| Lỗi đã xác nhận | Bằng chứng trước khi sửa | Đã sửa |
| --- | --- | --- |
| Replay trả metadata phiên bản sau khi quyền đã bị thu | nhánh replay trả về trước khi kiểm quyền → `replayed`, version 2 | replay kiểm lại `edit/manage`; thu quyền → `forbidden` |
| Ledger idempotency không có scope tài liệu | cùng key ở hai workspace khác nhau → `idempotency_payload_mismatch` dù không hề trùng | ledger key gồm org/ws/doc |
| Bản sao chuyển đổi không tiêu quota | quota = 0 vẫn tạo được bản sao, `usedBytes` vượt `limitBytes` | kiểm quota trước khi tạo bản sao và trừ `usedBytes` |

Ca `ledger-scoped-and-rechecked` và `conversion-respects-quota` khẳng định hai vế
đầu và cuối; vế replay sau thu quyền nằm trong chính ca ledger.

Kiểm chứng bằng mutation (bản sao trong `../.uniwork-dev/office-g0/mutants-r3/`):

| Bản hoàn lại fix | Exit | Ca thất bại |
| --- | --- | --- |
| Bỏ kiểm quyền ở nhánh replay | 1 | `ledger-scoped-and-rechecked` (23/24) |
| Ledger key bỏ scope tài liệu | 1 | `idempotency-in-flight` và `ledger-scoped-and-rechecked` (22/24) |
| Bỏ kiểm quota khi tạo bản sao | 1 | `conversion-respects-quota` (23/24) |

### 8.5 Vòng sửa 4

`not_found` đã được khai trong `ERROR_CODES` từ trước nhưng **không ca nào phụ thuộc
vào nó**: xoá dòng khai báo vẫn để 24/24 ca (lúc đó) và 12/12 self-test xanh. Một khai báo
không có ca chứng minh thì không phải bằng chứng, nên ca `unknown-resource-is-typed`
được thêm: mở một document không tồn tại và commit một `uploadId` không tồn tại đều
phải trả `not_found` kèm status/errorClass/kind, không phải `Error` trần.

| Bản hoàn lại fix | Exit | Ca thất bại |
| --- | --- | --- |
| Bỏ khai báo `not_found` trong `ERROR_CODES` | 1 | `unknown-resource-is-typed` (24/25) |

Bản sao mutation tái lập bằng `node ../.uniwork-dev/office-g0/mutate-doc005-round4.cjs <worktree> <mutants-r4>`
(ngoài repo, không commit). Cùng bản đó làm `run-contracts.test.mjs` đỏ 2 test:
`every fault case passes against its literal oracle` và
`the evidence records the modeled-authorization limits` — tức self-test bắt được chứ
không chỉ harness.

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
