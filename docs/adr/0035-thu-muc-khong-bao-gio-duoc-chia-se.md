# 0035 — Thư mục không bao giờ được chia sẻ; chỉ tài liệu được chia sẻ

**Trạng thái:** accepted (2026-10-19) — người dùng chốt trong UNI-1974 (FOLDER-SHARE-OFF): "tắt share
folder đi, tạm thời chỉ share doc thôi; doc share từ My Folder thì cũng không gắn vào folder nào ở phía
người được share". Hợp đồng đã duyệt 2026-10-19 16:20 (UTC+7).

## Bối cảnh

Menu thư mục không có mục Chia sẻ, nhưng đường tạo vẫn cho phép: công tắc "Chia sẻ với workspace" gửi
`visibility: "workspace"` khi tạo thư mục, và `createHomeRow` sao chép visibility + mức của cha xuống mọi
con lúc tạo. Kết quả: một thư mục cấp workspace, và người nhận thấy tài liệu được chia sẻ nằm "trong" thư
mục của chủ (nhóm theo thư mục, `parent_id`, đường dẫn). Quyền chia sẻ không kế thừa (C-01 §4) và di
chuyển không đổi visibility, nên việc chia sẻ thư mục chỉ tác động lên chính dòng thư mục.

## Quyết định

1. Thư mục (`kind = 'folder'`) không bao giờ `visibility = 'workspace'`, không có dòng `document_shares`
   sống, không có link công khai. Mọi lệnh sẽ tạo ra điều đó trả 422 `folder_not_shareable` (tạo, PATCH
   visibility, share, share batch, `PUT /access` có cấp quyền; `writeDocumentHomeRow` chặn thêm lớp trong).
   Dọn dẹp vẫn được phép: đóng thư mục cũ về `restricted`, thu hồi share, mục `level: null`.
2. Con của một thư mục luôn bắt đầu `restricted` trừ khi lời tạo yêu cầu `workspace`. Chỉ trang cha mới
   truyền visibility xuống con.
3. Tài liệu được chia sẻ không gắn vào thư mục của chủ ở phía người nhận. Server là nguồn quyết định:
   `parent_id` vắng mặt khi người gọi không đọc được thư mục cha (danh sách, tìm kiếm, gần đây, được chia
   sẻ với tôi, yêu thích, chi tiết); gốc của danh sách và cây đưa tài liệu người gọi đọc được lên gốc;
   "Được chia sẻ bởi tôi" không liệt kê thư mục.
4. Thư mục đang chia sẻ từ trước được đưa về riêng tư bằng lệnh có audit `uniwork-admin folders-unshare`
   (không phải migration: migration không gọi được `audit.Recorder`). Tài liệu bên trong không đổi quyền.
5. Báo cáo truy cập chỉ đọc theo thư mục (`?folder_id=`) giữ nguyên: nó không chia sẻ gì.

## Hệ quả

- Web bỏ công tắc chia sẻ khi tạo thư mục, bỏ mục Chia sẻ và huy hiệu phạm vi của thư mục; công tắc vẫn
  có cho tài liệu.
- Nếu sau này cần chia sẻ thư mục, phải có ADR thay thế ADR này và chọn lại ngữ nghĩa kế thừa; không
  thêm ngoại lệ lặng lẽ trong service.
- Cái giá: tài liệu nằm trong thư mục riêng và được chia sẻ hiện ở gốc của người nhận, nên người nhận
  không thấy cấu trúc thư mục của chủ.

## Test giữ luật

- `TestFolderCannotBeSharedOrOpened`, `TestChildOfFolderNeverInheritsItsVisibility`,
  `TestSharedDocumentIsNotAttachedToTheOwnersFolder`, `TestSharedByMeNeverListsFolders`,
  `TestMoveNeverChangesSharing`, `TestUnshareFoldersCleansLegacyAndKeepsDocuments`
  (`server/internal/service/document_folder_share_off_test.go`);
- `TestDocumentFolderIsNeverShared`, `TestFolderNotShareableIsInTheSpec`
  (`server/internal/handler/documents_folders_test.go`).
