# 0037 — Thư mục ngoài My Folder hiện cho cả workspace; tài liệu vẫn riêng tư mặc định

**Trạng thái:** accepted (2026-10-21) — người dùng chốt trong UNI-2055 (FOLDER-WS-PUBLIC), 15:35–16:00 (UTC+7):
"folder và child cần public toàn ws dù do ai tạo, trừ my folder và child my folder thôi. file bên trong mới mặc
định là private khi tạo, và có thể modify access"; "5 - cho xóa, đẩy các tài liệu đó về gốc của chủ; còn lại thì
theo đề xuất". Câu hỏi Q1–Q8 của hợp đồng server được ký theo đề xuất lúc 16:40. Thay
[0036](0036-thu-muc-khong-bao-gio-duoc-chia-se.md).
**Issue:** UNI-2055 (con của UNI-923) · **Liên quan:** UNI-2056 (thông báo thay đổi tài liệu), UNI-2052 (tải thư mục).

## Bối cảnh

ADR 0036 (2026-10-19) cấm mọi thư mục ở trạng thái `visibility='workspace'`: thư mục chỉ là của người tạo, và tài
liệu được chia sẻ không gắn vào thư mục của chủ ở phía người nhận. Cái giá 0036 đã ghi — người nhận không thấy cấu
trúc thư mục — hoá ra là điều nhóm không muốn: cây thư mục phải là cấu trúc chung của workspace. Ngày 2026-10-21 người
dùng đổi mô hình: thư mục là chung, quyền vẫn chỉ nằm trên tài liệu.

## Quyết định

1. **Thư mục chung.** Mọi thư mục (`kind='folder'`) không nằm trong cây My Folder được mọi thành viên workspace đọc
   (tên, vị trí, cây), bất kể ai tạo. Lưu bằng cột sẵn có: `visibility='workspace'`, `workspace_level='view'`; thư
   mục trong cây My Folder luôn `restricted`. Visibility của thư mục do VỊ TRÍ quyết định: server đặt khi tạo, di
   chuyển và trong lệnh admin; không route nào cho đặt tay (`PATCH visibility`, `PUT /access` trên thư mục vẫn 422).
2. **Không chia sẻ thư mục.** Thư mục không có `document_shares`, không có link, không có UI quyền riêng. Mã 422
   `folder_not_shareable` giữ cho share, share batch, link, `PATCH visibility` và `PUT /access` có cấp quyền.
3. **Tài liệu không kế thừa.** Mọi tài liệu mới (tạo, tải lên, tải thư mục, lưu bản sao) bắt đầu `restricted` ở
   bất kỳ đâu; người tạo có thể gửi `visibility: "workspace"` khi tạo trang/tệp (giữ hành vi hiện có), mặc định là
   `restricted`. Di chuyển thư mục hay tài liệu không bao giờ đổi quyền của một tài liệu, thấy hay không thấy.
4. **Quyền thao tác trên thư mục chung.** Tạo bên trong (thư mục con, trang, tệp, tải thư mục): mọi thành viên
   người của workspace có quyền sửa trong workspace; thành viên chỉ xem, khách và agent chỉ đọc cây. Đổi tên / di
   chuyển / bỏ vào Thùng rác / khôi phục / xoá hẳn: người tạo (`acl_owner_id`) và admin/owner của workspace hoặc tổ
   chức. Người tạo bị vô hiệu hoá: thư mục vẫn còn, admin quản lý. Mức `view` của thư mục không cho sửa tài liệu
   nào bên trong.
5. **Bỏ thư mục chứa tài liệu người thao tác không quản lý được: được phép.** Tài liệu người thao tác không có
   `manage` (không thấy, hoặc thấy mà không quản lý) cùng cây con của nó về gốc workspace (`parent_id` rỗng), giữ
   nguyên quyền, không đổi tên. Mỗi tài liệu chuyển một dòng audit `document.moved` (`metadata.reason =
   "folder_trashed"`, `from_folder_id`, `batch_id`) cùng transaction với sự kiện outbox `document.moved`; chủ nhận
   thông báo (UNI-2056). Phần còn lại vào Thùng rác cùng lô như hôm nay; khôi phục thư mục không kéo tài liệu đã
   chuyển trở lại.

   **Sửa đổi 2026-10-22 (UNI-2074, D1-4 của UNI-2055):** luật này áp dụng cho mọi gốc bị bỏ vào Thùng rác có cây con
   sống — trang, tệp, thư mục riêng cũ (ngoài My Folder) và thư mục con của My Folder — không chỉ thư mục chung, và
   cho mọi người qua được cổng `manage` của gốc (thành viên lẫn admin; agent vẫn bị cổng gốc chặn vì chỉ có mức
   xem). Trang/tệp bên dưới người thao tác không `manage` được (không thấy, hoặc thấy mà không quản lý; quyền admin
   không đọc được không tính là thấy) về gốc workspace (`parent_id` rỗng) cùng cây con, kể cả khi gốc nằm trong My
   Folder — không bao giờ vào My Folder nào. Thư mục chung bên dưới luôn vào Thùng rác; thư mục khác bên dưới người
   thao tác không đọc hoặc không `manage` được thì cả lệnh bị từ chối (403, không ghi gì), vì thư mục không bao giờ
   được chuyển (điểm 2, tên thư mục là duy nhất). Dòng audit giữ `reason = "folder_trashed"` và `from_folder_id` =
   id gốc bất kể loại, thêm `metadata.from_kind` = loại gốc (`folder` | `page` | `file`); thông báo cho chủ dùng câu
   "trang chứa…" khi `from_kind` là `page`/`file`, câu "thư mục chứa…" cho thư mục và cho dòng cũ không có
   `from_kind`. Xem trước (`relocated_count`) tính cho mọi gốc, đúng tập lệnh sẽ ghi. Sửa đổi này đóng sự bất đối
   xứng của D1-4: trước đó admin bỏ một trang chứa trang con hạn chế họ không đọc được thì trang con vào Thùng rác,
   còn thành viên bỏ trang của mình chứa trang con hạn chế của người khác thì bị 403 cả lệnh; nay cả hai đều chuyển
   trang con đó về gốc workspace.
6. **My Folder vẫn riêng.** Thư mục chung → vào My Folder (hoặc con của nó): bị chặn, 422 `folder_into_my_folder`.
   Thư mục con của My Folder → ra workspace: được (client hỏi xác nhận trước), thư mục và mọi thư mục con của nó
   chuyển sang `workspace`/`view`; tài liệu trong cây giữ quyền.
7. **Tên trùng.** Tạo thư mục trùng tên trong cùng cha (so với mọi thư mục sống của cha đó, của mọi người) nhận hậu
   tố " (1)", " (2)"… như tải thư mục. Đổi tên vào một tên đã có vẫn 409 `folder_name_taken`.
8. **Dữ liệu cũ.** Mọi thư mục ngoài My Folder hiện có (đều riêng theo 0036) được lệnh admin có audit `uniwork-admin
   folders-into-my-folder` chuyển vào My Folder của chủ — không phải migration (migration không gọi được
   `audit.Recorder`), cùng mẫu với `folders-unshare`. Cây cũ trộn nhiều chủ được tách: thư mục của mỗi chủ vào My
   Folder của chính họ, tài liệu của chủ khác về gốc workspace của chủ đó. Thư mục của người đã bị vô hiệu hoá
   cũng vào My Folder của họ.
9. **Người nhận thấy đúng đường dẫn.** Quy tắc 3 của 0036 (không gắn tài liệu được chia sẻ vào thư mục của chủ) chỉ
   còn áp dụng khi cha nằm trong My Folder của người khác; với thư mục chung, người nhận thấy tài liệu ở đúng đường
   dẫn.

## Hệ quả

- Danh sách, tìm kiếm, recent, cây, realtime, báo cáo truy cập, Work Graph và MCP đọc thư mục qua cùng cổng ACL; vì
  thư mục chung là `workspace/view`, các đường này đúng mà không cần nhánh riêng cho thư mục. `uw_my_folder_foreign_ids`
  tiếp tục giấu cây My Folder của người khác.
- Số mục, trạng thái "trống", dung lượng của thư mục được tính theo người xem; một thư mục chung không chứa gì người
  xem đọc được vẫn hiện (cấu trúc chung). Không trường nào lộ "N mục bạn không xem được"; xem trước Thùng rác chỉ trả
  con số tài liệu sẽ về gốc.
- Thành viên mới vào workspace thấy toàn bộ cây thư mục chung ngay.
- Cái giá: tên thư mục hiện cho cả workspace (hộp thoại tạo nói rõ); ai cũng có thể tạo trong thư mục người khác,
  chỉ người tạo và admin dọn được.
- Các test giữ 0036 được viết lại theo 0037 (danh sách trong hợp đồng UNI-2055 §9), không xoá im lặng.
- Chia sẻ thư mục trong tương lai vẫn cần một ADR mới chọn lại ngữ nghĩa kế thừa.

## Test giữ luật

Tên test chốt trong hợp đồng server UNI-2055 v1.0 §9 và được ghi lại ở đây khi lane land (service
`document_folder_ws_public*_test.go`, handler `documents_folders_test.go`, isolation matrix, `audit_coverage_test.go`).

Sửa đổi điểm 5 (UNI-2074), service `document_trash_relocate_any_root_test.go`:
`TestPageRootTrashRelocatesWhatAnAdminCannotRead`, `TestPageRootTrashByAMemberRelocatesInsteadOfRefusing`,
`TestPageRootTrashRelocatesADeepHiddenPageWithItsSubtree`, `TestLegacyPrivateFolderRootTrashRelocatesAHiddenPage`,
`TestLegacyPrivateFolderRootTrashRefusesAForeignSubFolder`, `TestMyFolderSubFolderTrashRelocatesToTheWorkspaceRoot`,
`TestPageRootTrashByAnAgentIsRefusedAtTheRoot`; notification
`TestDocumentChangedRelocationWordingFollowsTheRootKind`; handler `TestDocumentArchiveImpactHTTP`; dòng
`document.moved` (gốc là trang, `from_kind`) trong `TestEveryAuditedCommandWritesItsRow`.
