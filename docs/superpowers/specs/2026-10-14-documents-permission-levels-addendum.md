# Documents — Phụ lục: Bộ mức quyền View / Comment / Edit, mention người chưa có quyền (G8-18) và quyền admin (DOC-05)

> **Trạng thái:** in-progress — v1.0, soạn 2026-10-14 (UNI-1413 G8-18, UNI-1628 DOC-05). Chỉ là hợp đồng và luật; chưa có dòng code nào. Giá trị đã ký: G8-D3 (Q5) ký 2026-10-14 15:45 UTC+7 (ba luật), DOC-01..07 ký 2026-10-14 14:30 UTC+7 (`USER-DECISIONS.md` của Run). Mọi chỗ "chọn" bên dưới là quyết định nằm **trong** các luật đã ký và có lý do đi kèm.

**Vì sao một file:** bộ mức quyền dùng chung cho G8-18 (cộng tác, lane collab) và DOC-05 (tài liệu, lane documents); hai bản sẽ lệch nhau, nên cả hai thẻ code đọc đúng một bảng luật ở đây.
**Quan hệ:** [Documents C-01 §4](2026-09-08-documents-design.md) (bảng quyền cũ; mục 1 dưới đây thay các dòng nêu ở đó), [phụ lục G8 §2, §4.2, §4.5](2026-10-13-office-g8-collab-addendum.md) (trỏ về đây cho luật quyền), [EXPERIENCE-G8 S14](../../office/g5g6g7/ux/EXPERIENCE-G8.md). Khi lệch `CLAUDE.md` hoặc ADR, `CLAUDE.md`/ADR thắng.
**Hiện trạng:** mọi `file:line` dưới đây đọc ở root `9d987d353`; thẻ code phải đọc lại dòng trước khi sửa.

## 0. Hiện trạng cần đổi (ở 9d987d353)

| Dữ kiện | Nguồn |
| --- | --- |
| Thang quyền chỉ có `view` < `edit` < `manage` (rank 1..3) | `server/internal/service/document_types.go:52-80` |
| `document_shares.level` CHECK `('view','edit','manage')` | `server/migrations/990_document_shares.up.sql:23-24` |
| API cấp quyền chỉ nhận ba giá trị đó (cả SDI lẫn service) | `dto/sdi/document.go:241-245`, `service/document_shares.go:54-58`, route `router/documents.go:511-519` |
| **Viết bình luận, sửa/xóa, resolve/reopen, reaction đều cần `edit`**; sửa/xóa còn phải là tác giả hoặc `manage` | `service/document_comments.go:377, 452, 472, 612, 626, 639`, `canModerate` `:176-182`, từ chối `:489-494` |
| Đọc bình luận, lịch sử sửa, picker mention cần `view` | `document_comments.go:248, 305, 337, 352`; `document_mentions.go:96` |
| Mention người không đọc được: lưu `no_access`, không thông báo, không lỗi (giá trị tạm G8-D3) | `document_mentions.go:253-300` (`state := "no_access"` ở `:298`) |
| Mặc định workspace-visible: thành viên hiệu lực nhận `edit`; `restricted` bỏ dòng này | `document_permissions.go:142-143`, `:123-125` (agent) |
| **Workspace owner/admin (org owner/admin implicit) luôn là `manage` trên mọi tài liệu, kể cả `restricted`** | `document_permissions.go:134-135` |
| ACL owner (`acl_owner_id`) là `manage`; share sống chọn mức cao nhất | `document_permissions.go:136-141, 155-176` |
| Agent tối đa `view`, không thấy tài liệu `restricted`; tài liệu thuộc Work Product theo resolver (agent cap `view`) | `document_permissions.go:105-127` |
| Chia sẻ/thu hồi/liên kết/nhật ký truy cập chỉ `manage`; tài liệu thuộc Work Product → 409 `document_owned_by_work_product` | `document_shares.go:27-46`; `document_access.go:137-141` |
| Người chưa đọc được → 404 (không lộ tồn tại) | `document_permissions.go:290-301` |
| Liên kết công khai chỉ xem, không có cột mức | `document_links.go:25`; spec C-01 §3.5 |
| Access log `via` CHECK `member/share/link/owner/ai_context` | `migrations/996_document_access_logs.up.sql:23-24` |
| Frame protocol `CommentsLevel` = `view/edit/manage`; mức lạ coi như "thiếu" | `packages/core/office/docs-frame-protocol.ts:416-422, 824-826, 1097-1101, 1121-1150` |
| Web mirror: `DocumentLevel` và `documentLevelRank` (mức lạ → rank 0 → "không tìm thấy") | `packages/core/documents/schema.ts:48`, `packages/core/permissions/rules.ts:466-476, 497-500` |
| Plan §G8-18 ghi `router/documents.go:424-440` cho route chia sẻ; ở 9d987d353 route đó ở `:504-545` (dòng plan lỗi thời) | `router/documents.go:504-545` |

## 1. Bộ mức quyền

Thang mới (rank): `view` 1 < **`comment` 2** < `edit` 3 < `manage` 4. `comment` là giá trị lưu và giá trị wire mới; mức lưu `edit`/`manage` không đổi nghĩa.

| Hành động | view | comment | edit | manage |
| --- | :-: | :-: | :-: | :-: |
| Đọc tài liệu, bình luận, lịch sử sửa bình luận, picker mention | ✓ | ✓ | ✓ | ✓ |
| Viết bình luận / trả lời (gồm token mention) | | ✓ | ✓ | ✓ |
| Sửa, xóa bình luận **của mình** | | ✓ | ✓ | ✓ |
| Sửa, xóa bình luận của người khác | | | | ✓ |
| Reaction (thêm/gỡ của mình) — chọn: mức Comment (reaction là trả lời nhẹ; để Edit thì người Comment trả lời được nhưng không "thích" được) | | ✓ | ✓ | ✓ |
| Resolve / reopen: **tác giả luồng** (bình luận gốc) còn giữ ≥ Comment, hoặc bất kỳ ai ≥ Edit (G8-D3 #3 đã ký) | | chỉ luồng của mình | ✓ | ✓ |
| Sửa nội dung, tạo phiên bản, khôi phục, tải bản mới | | | ✓ | ✓ |
| Chia sẻ, thu hồi, đổi visibility, liên kết, nhật ký truy cập, archive | | | | ✓ |

Quy tắc: viết bình luận chỉ cần Comment **hoặc** Edit (G8-D3 #2 đã ký) — vì rank, Edit ⊃ Comment nên người đang viết được hôm nay (Edit/manage) giữ nguyên. Quyền được tính lại **trong transaction** của lệnh như `withDocumentMutation` (`document_permissions.go:474-480`); tác giả luồng bị hạ xuống View thì mất quyền resolve luồng cũ (mutation cần quyền hiện tại, không cần lịch sử).

| Nguồn quyền | Ánh xạ vào bộ mới |
| --- | --- |
| Visibility `workspace` (mặc định) | thành viên hiệu lực = `edit` như `:142-143` (DOC-01/03/04 đã đúng, không đổi); `restricted` = không ai trừ share/ACL owner |
| Share user/workspace/organization | một trong `view/comment/edit/manage`, mức cao nhất thắng như `:163-175` |
| Liên kết công khai, người ẩn danh | `view` cố định; không bình luận được (bình luận cần phiên human + Comment) |
| Khách ngoài tổ chức | không tồn tại: principal phải là org member (`document_shares.go:135-162`); ngoài tổ chức → 422 `principal_not_in_organization` |
| Agent | tối đa `view`; không bình luận trực tiếp (ADR 0010, bất biến 7 của phụ lục G8); đề xuất qua proposal |
| Tài liệu thuộc Work Product (§13.4) | resolver có thể trả `comment` (giá trị hợp lệ của `DocumentLevel`); resolver hiện có không trả nên không đổi; chia sẻ vẫn 409 |
| Office offline lease (`level IN ('view','edit')`, `migrations/9991791865920564_office_offline_leases.up.sql:36-37`) | Comment → lease `view` (bình luận cần online, G8-D6); job Office: Open/Export cần View → Comment được, còn lại Edit (`document_office.go:209-214`) |

## 2. Ánh xạ giá trị và migration

| Nơi | Giá trị hiện có | Sau phụ lục |
| --- | --- | --- |
| `document_shares.level` (lưu) | `view`, `edit`, `manage` | **giữ nguyên mọi dòng**; CHECK mở rộng thêm `comment` |
| `POST /documents/{id}/shares` `level` (SDI) | `view/edit/manage` | thêm `comment`; mô tả SDI cập nhật |
| `my_level`, `shares[].level`, `effective_level` (SDO `DocumentAccessSDO`, `dto/sdo/document.go:287-296`) | `view/edit/manage` | thêm giá trị `comment` — **enum cộng thêm, không đổi tên giá trị cũ** |
| Mặc định workspace / `restricted` | `edit` / không | không đổi |
| Liên kết công khai | `view` (không cột) | không đổi |
| Office lease `level` | `view/edit` | không đổi; Comment ánh xạ `view` |
| Frame `commentsLevel` | `view/edit/manage` | thêm `comment` |
| `document_access_logs.via` | `member/share/link/owner/ai_context` | thêm `break_glass` (mục 4) |

**Rights-neutral:** hôm nay người bình luận được = người có `edit` hoặc `manage` (`document_comments.go:377`); không có dòng nào ở mức `comment`. Migration chỉ **mở rộng CHECK**, không đụng dòng dữ liệu, nên mỗi `effectiveLevel` của mọi người trên mọi tài liệu y nguyên: không ai mất quyền (Edit ⊃ Comment), không ai được thêm (không dòng nào đổi thành `comment`). Mức `comment` chỉ có từ lần cấp mới sau khi thẻ server vào. Hai thay đổi hành vi duy nhất, đều hẹp lại hoặc chỉ áp cho mức mới: (1) resolve của tác giả luồng ở mức Comment (không ai có mức đó hôm nay); (2) admin trên tài liệu `restricted` (mục 4, **cố ý thu hẹp**, ký bởi DOC-05).

**Client cũ thấy `comment`:** web cùng release với server (lockstep) nên thẻ web cập nhật `documentLevelRank`; một tab cũ chưa tải lại đọc mức lạ là rank 0 → "không tìm thấy" (`rules.ts:474, 498`) — **chỉ từ chối thêm, không cấp thêm**, chấp nhận. Editor desktop cũ: mức lạ vào nhánh `comments_level_invalid` → coi như thiếu = composer và hành động trên bình luận của mình (`docs-frame-protocol.ts:1097-1101, 1121-1150`), đúng hành vi mong muốn cho Comment trừ resolve; không có bản vá phía server.

## 3. G8-18 — mention người không xem được tài liệu

Luật đã ký (G8-D3 #1): cảnh báo lúc gửi; người được phép chia sẻ thấy "chia sẻ quyền Xem rồi gửi"; bỏ qua thì mention lưu **không thông báo**; mention không bao giờ cấp quyền. Thay giá trị tạm "lưu im lặng" (`phụ lục G8 §2`, `document_mentions.go:249`).

**Picker.** `GET /documents/{id}/mention-candidates` mặc định vẫn chỉ người đọc được (`document_mentions.go:96-149`; client cũ không đổi). Thêm tham số `include=no_access` (mặc định tắt): trả thêm thành viên hiệu lực của workspace chứa tài liệu (cùng nguồn `ownedMentionCandidates`, `:160-203`), mỗi dòng có `can_view: bool` (cộng thêm vào SDO). Chỉ người gọi qua cổng danh bạ workspace (`seeMembers`, `:100-111`) mới được `include=no_access`; người khác nhận danh sách thường. Chip người `can_view=false` mang dấu chữ cạnh tên (phác S14).

**Chọn: 201 + `mentions_without_access`, không dùng 409.** `POST/PATCH .../comments` vẫn thành công như hôm nay và thêm một trường cộng thêm trong SDO `comment`:

```json
"mentions_without_access": [{"user_id": "<ULID>", "display_name": "Nguyễn An", "can_share": true}]
```

Lý do: client cũ (không gửi cờ nào) hôm nay nhận 201 khi mention người không đọc được (`:253-300`); 409 làm vỡ chúng và buộc thêm cờ xác nhận. Trường rỗng/vắng khi mọi người được nhắc đều đọc được. Server là nguồn đúng: danh sách = các dòng `no_access` vừa ghi trong tx (`:283-300`, cùng cổng `FilterDocumentReadersQ`). Composer cảnh báo **trước khi gửi** từ cờ `can_view` của picker/token đang chèn; 201 đối chiếu lại (người mất quyền giữa chừng) và hiện lại cùng câu. `display_name` chỉ có với thành viên tổ chức; id ngoài tổ chức → bỏ `display_name`, `can_share=false`. `can_share` = người gọi ≥ `manage`, tài liệu không thuộc Work Product (`requireDocumentACLChange`, `document_shares.go:38-46`) **và** người được nhắc là org member chưa vô hiệu (`:135-162`).

| Bước | Ai | Hành vi |
| --- | --- | --- |
| Cảnh báo lúc gửi | mọi người ≥ Comment | hộp xác nhận liệt kê người chưa xem được; nút "Gửi, không thông báo" / "Hủy" |
| Chia sẻ rồi gửi | `can_share=true` | nút thêm "Chia sẻ quyền Xem rồi gửi": gọi `POST /documents/{id}/shares` `{principal_type:"user", principal_id, level:"view"}` (route có sẵn, `router/documents.go:511`) **luôn mức `view`, không bao giờ cao hơn dù người chia sẻ là manage**, xong mới gửi bình luận → mention vào `active` và thông báo như thường |
| Người không chia sẻ được | `can_share=false` | câu "Hãy nhờ người quản lý tài liệu chia sẻ quyền Xem cho {name}"; vẫn có "Gửi, không thông báo" |
| Bỏ qua | — | mention lưu `no_access`, **không** thông báo (`notified_at` NULL, không bị tính là bên giành §4.5), không lỗi |

Hai lệnh chia sẻ và gửi là hai request (không một transaction): chia sẻ có audit/outbox riêng (`document_shares.go:106-125`), nếu gửi lỗi thì quyền Xem vẫn đã cấp và hộp báo rõ; chấp nhận vì View là mức thấp nhất và thu hồi được.

**Quyền đến sau → không thông báo hồi tố (chọn).** Mention `no_access` giữ nguyên dù người đó sau này được cấp quyền (kể cả khi chính người gửi chia sẻ ngay sau đó). Lý do: tránh một thông báo trễ ngày về bình luận cũ; không thêm đường giành `notified_at` thứ hai vào §4.5; muốn báo thì nhắc lại trong bình luận mới (một dòng mention mới → thông báo bình thường). Luồng chính "chia sẻ rồi gửi" đã giữ thứ tự đúng nên không cần hồi tố. Mention vẫn không bao giờ cấp quyền: không có đường mention → share (`TestMentionNoAccessNeverNotifiesOrGrants`, mục 5).

**Lỗi và old client:** không mã lỗi mới ở luồng này; lỗi chia sẻ giữ mã có sẵn (`principal_not_in_organization` 422, `document_owned_by_work_product` 409, 403 `forbidden`; `mapServiceError`, `handler/auth.go:146-170`). Client cũ bỏ qua trường mới → hành vi y như giá trị tạm. **Fork:** host chuyển body API nguyên văn nên `mentions.search` mang `can_view` và `comments.create`/`update` mang `mentions_without_access` không cần thông điệp mới (`docs-frame-protocol.ts:817-818, 1020-1028`); chỉ thêm RPC **`comments.shareView {user_id}`** (host gọi share ở trên) và editor vẽ cùng cảnh báo — không đặc tả thiết kế UI ở đây.

## 4. DOC-05 — admin quản lý nhưng không đọc nội dung tài liệu hạn chế

Hôm nay workspace owner/admin là `manage` (đọc được) trên mọi tài liệu (`document_permissions.go:134-135`). DOC-05 (đã ký 14:30): admin **quản lý** nhưng **không đọc** nội dung tài liệu `restricted`, trừ khi mở truy cập khẩn cấp có ghi vết. Phạm vi: tài liệu có `visibility=restricted`, không thuộc Work Product (§13.4: resolver của sản phẩm quyết). Tài liệu `workspace` không đổi (mọi thành viên đã đọc được).

**Mô hình:** `DocumentAccess` thêm cờ `AdminScope`. Với workspace owner/admin (org owner/admin implicit) trên tài liệu `restricted` mà không phải ACL owner: `Level` tính từ share/break-glass (có thể `none`), `AdminScope=true`. "Quản trị" = `Level ≥ manage` **hoặc** `AdminScope`.

| Việc | Cần |
| --- | --- |
| Đọc nội dung, phiên bản, bình luận, file, tìm kiếm, AI context, xuất | `Level` (≥ view) — **không** qua AdminScope |
| Thấy siêu dữ liệu: id, tên, loại, visibility, chủ (ACL owner), ngày, dung lượng (chọn: tên và chủ cần để admin biết mình quản lý cái gì; nội dung thì không) | AdminScope (`GET /documents/{id}/admin-summary`, thẻ web chọn hình dạng SDO) |
| Xem/cấp/thu hồi share, liên kết, archive/khôi phục, nhật ký truy cập, hook chuyển chủ (DOC-06) | Quản trị |
| Cấp share **cho chính mình** (user = mình, workspace/organization chứa mình) bằng route share thường | **Từ chối** `403 break_glass_required` khi người gọi chỉ có AdminScope — nếu không, admin tự mở đường vòng không ghi vết |
| Đổi `restricted → workspace` (mở nội dung cho cả workspace, gồm admin) | chỉ `Level ≥ manage`; admin thuần chỉ được **thu hẹp** (`workspace → restricted`); lý do: mở rộng là tự cấp quyền đọc |

**Mở truy cập khẩn cấp (break-glass):** `POST /documents/{documentID}/break-glass` `{reason}`.

| Mục | Luật (chọn, lý do) |
| --- | --- |
| Ai | người có AdminScope trên tài liệu đó; không agent; không người đã `deactivated_at` (cổng thành viên); ACL owner không cần |
| `reason` | bắt buộc, 10–500 ký tự sau trim (cùng ngưỡng `reason` ≥ 10 của console admin, `CLAUDE.md` § Platform Admin); không vào log dòng lệnh, chỉ vào audit |
| Mức cấp | **`view` cố định** — mục đích là kiểm tra; sửa là việc của chủ tài liệu/người được chia sẻ; giảm phạm vi rủi ro |
| Hiệu lực | 24 giờ, không gia hạn (muốn tiếp = lần mới, lý do mới, audit mới, thông báo mới); lệnh lặp khi grant còn sống trả grant đó, không audit/thông báo thêm |
| Lưu | bảng mới `document_break_glass_grants` (id ULID, `organization_id NOT NULL`, `workspace_id`, `document_id`, `actor_id`, `actor_kind`, `level`, `reason`, `granted_at`, `expires_at`, `revoked_at`, `revoked_by`); đọc ở `resolveLevelInTenant` như nguồn thứ ba, `via=break_glass`, hết hạn kiểm lúc đọc; không FK, index `CONCURRENTLY` file riêng. Không tạo dòng `document_shares` (tránh hai nguồn sự thật) |
| Audit (cùng tx) | action `document.break_glass_granted`: `actor` (human), `ResourceType=document`, `ResourceID`, `Changes{level}`, `Metadata{grant_id, reason, expires_at}`; thời điểm = `created_at` dòng audit; outbox cùng tên topic `{document_id, workspace_id, grant_id}` (catalogue ba nơi) |
| Thông báo chủ | kind mới `document_break_glass` cho ACL owner (không có ACL owner → các workspace owner khác người gọi); **chỉ id** (`document_id`, `grant_id`), tiêu đề nêu admin và tên tài liệu, lý do xem trong khung truy cập của chủ; push mặc định **bật**; hạ tầng prefs hiện không có khái niệm kind bắt buộc (`notification/prefs.go:15-23`) nên chủ vẫn tắt được — vết audit + khung truy cập là bảo đảm, không phải thông báo |
| Thu hồi | `DELETE /documents/{id}/break-glass/{grantID}`: chủ tài liệu, người ≥ manage, hoặc chính người mở; audit `document.break_glass_revoked`; hiệu lực ngay (đọc theo luồng mỗi request) |
| Access log | mọi lần đọc trong grant ghi `view/download/export` với `via=break_glass` (CHECK mở rộng); hiện nhãn "Truy cập khẩn cấp" / "Emergency access"; chủ và admin (Quản trị) đọc được nhật ký |
| Thấy ở đâu | `GET /documents/{id}/shares` thêm mảng `break_glass` (cộng thêm) cho người Quản trị |

**Lỗi khi admin mở tài liệu hạn chế chưa có grant:** `403 document_restricted` với `fields.can_break_glass=true` (CodedError, `service/errors.go:221-223`; `respondErrorFields`), **không** 404: admin thấy tài liệu tồn tại qua siêu dữ liệu nên 404 là nói dối. Người không phải admin và không có quyền vẫn 404 như `:290-301` (không lộ tồn tại). Danh sách thư viện trả cho admin dòng chỉ có siêu dữ liệu, `my_level=""`, `admin_scope=true` (thẻ web vẽ thẻ khóa; DOC-07 sở hữu thẻ khóa/xin quyền của người thường).

**Liên kết, không thiết kế lại ở đây:** DOC-02 UNI-1629 — mặc định workspace + "Hạn chế" một chạm lúc tạo (e6-server/e6-web); DOC-06 UNI-1630 — chuyển chủ từng tài liệu và hàng loạt khi vô hiệu hóa thành viên (e6-server/e6-web); DOC-07 UNI-1631 — không tự cấp, thẻ khóa, xin quyền, quản lý duyệt (e6-server/e6-web). DOC-05 chỉ dành cho DOC-06 cổng "Quản trị".

**Chuỗi chữ (vi / en; khóa i18n do thẻ web đặt, không mã nội bộ):**

| Chỗ | vi | en |
| --- | --- | --- |
| Mức quyền | Bình luận | Comment |
| Cảnh báo mention | {name} chưa xem được tài liệu này nên sẽ không nhận thông báo. | {name} can't view this document, so they won't be notified. |
| Nút | Chia sẻ quyền Xem rồi gửi · Gửi, không thông báo | Share view access, then send · Send without notifying |
| Không chia sẻ được | Hãy nhờ người quản lý tài liệu chia sẻ quyền Xem cho {name}. | Ask someone who manages this document to share view access with {name}. |
| Admin chặn | Tài liệu này ở chế độ hạn chế. Quản trị viên quản lý được nhưng chỉ đọc được khi mở truy cập khẩn cấp. | This document is restricted. Admins can manage it but can read it only with emergency access. |
| Hộp lý do | Lý do (ít nhất 10 ký tự) · Chủ tài liệu sẽ được thông báo và hành động này được ghi lại. Quyền Xem hết hạn sau 24 giờ. | Reason (at least 10 characters) · The owner will be notified and this is recorded. View access expires after 24 hours. |

## 5. Tách thẻ code (không code ở vòng này)

**Thẻ (a) — D server** · owner e6-server, **sau FD-02 PR2** (cùng khu `document_shares`/tree) · issue: UNI-1413 (G8-18) + UNI-1628 (DOC-05).
Scope: migration `999<ms>_` (mở CHECK `document_shares.level` thêm `comment`, mở CHECK `document_access_logs.via` thêm `break_glass`, bảng `document_break_glass_grants`, index riêng); `DocumentLevelComment` + `rank()` + `AdminScope` trong `resolveLevelInTenant`; đổi gate comment (Comment cho viết/sửa-xóa của mình/reaction, resolve = tác giả hoặc Edit); `include=no_access` + `can_view`, `mentions_without_access`, `can_share`; break-glass (service, 2 route, audit, outbox, kind `document_break_glass` + rule thông báo, SDI/SDO, `pathParamSDI` cho `{grantID}`, `403 break_glass_required/document_restricted`); cập nhật `rules.ts` mirror trong thẻ (b); đăng ký catalogue ba nơi.

| AC | Nội dung |
| --- | --- |
| G8-A10 (sửa lời hàng ở `acceptance-rows.json` + `acceptance.md` cùng commit, sibling test) | Mention người không xem được: cảnh báo, mention `no_access` không thông báo, không cấp quyền; "chia sẻ View rồi gửi" cho người ≥ manage; hàng chuyển BLOCKED → NOT_RUN rồi PASS bằng bằng chứng |
| DOC5-A01 | Ma trận mức × hành động đúng bảng mục 1 (View/Comment/Edit/Manage) |
| DOC5-A02 | Migration rights-neutral: trước/sau `effectiveLevel` bằng nhau cho mọi người trên mọi tài liệu seed |
| DOC5-A03 | Admin trên tài liệu `restricted` không đọc được nội dung/bình luận/file; thấy siêu dữ liệu; `403 document_restricted` |
| DOC5-A04 | Admin quản trị được (share người khác, thu hồi, archive, nhật ký); tự share → `403 break_glass_required`; widen visibility bị chặn, thu hẹp được |
| DOC5-A05 | Break-glass: lý do < 10 ký tự bị từ chối; cấp `view` 24 giờ; lặp = idempotent; hết hạn/thu hồi mất quyền ngay |
| DOC5-A06 | Một dòng audit đủ `actor, document, reason, level, thời điểm` + một thông báo cho chủ (chỉ id); chủ thu hồi được |
| DOC5-A07 | Mọi lần đọc trong grant ghi access log `via=break_glass` |
| DOC5-A08 | Isolation: route mới có trong `isoRoutes`; tenant khác không chạm được grant |

Test (tối thiểu): `TestDocumentLevelMatrix` (Go table mức × hành động, `service/`); `TestMigrationCommentLevelIsRightsNeutral` (seed share view/edit/manage + bình luận, chạy migration, so `effectiveLevel` + `FilterDocumentReaders`); `TestMentionNoAccessNeverNotifiesOrGrants` + `TestMentionsWithoutAccessField` (handler); `TestAdminScopeCannotReadRestricted`, `TestAdminSelfShareRequiresBreakGlass`, `TestBreakGlassGrantAuditNotifyExpire`; mở rộng `TestIsolationMatrix`, `audit_coverage_test.go` (hai action mới), `scripts/events-catalogue.test.mjs` (topic mới), `migrations/lint_test.go`; `go test` nhóm trên cloud runner (luật team), cục bộ chỉ test file chạm.

**Thẻ (b) — D web + fork editor** · owner g5g8-web_ux (lane này), sau khi (a) có contract + fake (contract-first).
Scope: `DocumentLevel`/`documentLevelRank`/`canCommentDocument` trong `packages/core`; bộ chọn mức ở `share-dialog.tsx` (hiện `LEVELS` `:52`) thêm "Bình luận"; composer web (panel D) cảnh báo mention + "Chia sẻ quyền Xem rồi gửi"; `CommentsLevel` + `canActOnComment` (resolve chỉ luồng của mình ở Comment) + `comments.shareView` + cảnh báo cùng câu trong editor fork; thẻ khóa admin + hộp lý do break-glass + dòng "Truy cập khẩn cấp" ở access log + khung truy cập của chủ.

| AC | Nội dung |
| --- | --- |
| G8-A10 | Phía web và desktop: cảnh báo hiện đúng người, hai nút đúng, không thông báo khi bỏ qua |
| DOC5-W01 | Picker hiện Bình luận trong bộ chọn mức; người Comment thấy composer nhưng không thấy sửa nội dung |
| DOC5-W02 | Người Comment resolve được luồng của mình, không resolve luồng người khác; Edit resolve mọi luồng |
| DOC5-W03 | Admin mở tài liệu hạn chế thấy thẻ khóa + hộp lý do; gửi lý do ngắn bị chặn tại trường; sau grant đọc được và thấy nhãn hết hạn |
| DOC5-W04 | Tab cũ gặp `comment` không rò quyền (từ chối, không cấp) |

Test: `packages/core/permissions/rules.documents.test.ts` (rank Comment + `canCommentDocument`); `packages/core/api/endpoints/documents.test.ts` (case malformed cho `mentions_without_access`, `can_view`, `break_glass`); `packages/views/documents` composer test (cảnh báo + hai nút + gọi `POST shares` mức `view`); `packages/core/office/docs-frame-protocol` test (`commentsAccess`/`canActOnComment` mức `comment`, `comments.shareView`); visual: tester_visual 9 tiêu chí cho thẻ khóa, hộp lý do, cảnh báo composer; parity locale vi/en (và 21 locale theo glossary nếu thẻ chạm bộ chuỗi chung).

## 6. Câu hỏi mở

Không có câu hỏi chặn code. Hai giá trị mặc định đã chọn trong luật đã ký, reviewer BE/FE nên xác nhận thay vì đoán lại: **(1)** admin thấy tên + chủ + siêu dữ liệu của tài liệu hạn chế (khuyến nghị giữ; ẩn tên làm admin không biết mình quản lý gì); **(2)** break-glass cấp `view` 24 giờ không gia hạn (khuyến nghị giữ; nếu muốn sửa nội dung thì chủ chia sẻ Edit).
