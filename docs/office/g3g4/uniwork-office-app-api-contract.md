# Hợp đồng API giữa app UniWork Office và UniWork

**Revision:** 1.0 (2026-10-09)
**Issue:** GO-C3 (UNI-1020), thuộc UNI-1001
**Trạng thái:** hợp đồng bên server `dev-uniwork`. Phần đã có route được đánh dấu "có sẵn"; phần chưa xây được đánh dấu theo lane (GO-A6, GO-A7, GO-B2/B3).

Tài liệu này ghi các điểm nối giữa app desktop UniWork Office (repo fork
`UNIAI-TEAM/uniwork-office`, nền genoffice) và API của UniWork. Hướng đi nằm trong
plan genoffice `docs/superpowers/plans/2026-10-08-uniwork-office-genoffice.md`
(vào develop cùng UNI-1001; Q1: hai repo riêng, nối bằng API). Tài liệu chỉ trỏ tới
hợp đồng đã có và không chép lại; mọi đường dẫn bên dưới đã đối chiếu với
`server/internal/handler/router/`. Đường dẫn tương đối với `/api/v1`.

Nguyên tắc chung:

- App là public client, không giữ bí mật của UniWork và không giữ key nhà cung cấp AI của UniWork.
- Quyền luôn do server quyết (`RequireMember`, ACL của Document); app không tự suy ra.
- Tài liệu cục bộ của người dùng không đi qua UniWork trừ khi người dùng chủ động lưu lên.

## 1. Đăng nhập (GO-A5, UNI-1006)

Dùng lại nguyên luồng UNI-966, không có route mới. Hợp đồng đầy đủ (PKCE, state,
consent, mã một lần, thu hồi thiết bị) ở [desktop-auth-contract.md](desktop-auth-contract.md).

| Bước | Route (có sẵn, `router/auth.go`) |
| --- | --- |
| Bắt đầu, nhận `authorization_url` | `GET /auth/desktop/start` |
| Hiển thị / phê duyệt trong trình duyệt hệ thống | `GET /auth/desktop/authorize`, `POST /auth/desktop/authorize` |
| Đổi mã lấy phiên | `POST /auth/desktop/exchange` |
| Làm mới | `POST /auth/desktop/refresh` |
| Đăng xuất / thiết bị | `POST /auth/desktop/logout`, `GET /auth/desktop/devices`, `DELETE /auth/desktop/devices/{deviceSessionID}` |

Hồ sơ triển khai (origin API) do app chọn theo origin; `client_id` là `uniwork-office`
và callback là `uniwork-office://auth/callback` như hợp đồng nêu. Fork phải đổi
protocol và `appId` về giá trị này khi rebrand (GO-A1); nếu fork dùng giá trị khác,
server phải thêm vào allowlist trước.

## 2. Mở và lưu tài liệu UniWork (GO-A6, UNI-1007)

Dùng FileService và Documents hiện có (C-01, FS-C1). Mô hình lưu và Save một lần
(`upload` chưa phải `saved`, `Idempotency-Key`, `base_revision`, 409 giữ bản cục bộ)
ở [host-contract.md](host-contract.md); app không được tự động lưu theo timer.

Route có sẵn (`router/documents.go`, `router/files.go`, `router/office_launch.go`):

| Việc | Route |
| --- | --- |
| Liệt kê / mở metadata | `GET /workspaces/{workspaceID}/documents`, `GET /documents/{documentID}` |
| Tải nội dung bản hiện tại | `GET /documents/{documentID}/download` |
| Tạo ticket mở từ web sang app (launch bridge) | `POST /documents/{documentID}/office/sessions` |
| Đổi ticket (chỉ main process của app) | `POST /office/sessions/exchange` |
| Huỷ ticket chưa dùng | `DELETE /office/sessions/{launchSessionID}` |
| Tải byte lên (phiên tải lên) | `POST /documents/{documentID}/uploads` |
| Lưu thành phiên bản mới | `POST /documents/{documentID}/versions/commit` với `{upload_id, base_revision}` + `Idempotency-Key` |
| Lịch sử / một phiên bản / khôi phục | `GET /documents/{documentID}/versions`, `GET /documents/{documentID}/versions/{versionNo}`, `POST /documents/{documentID}/versions/{versionNo}/restore` |
| Tài liệu mới | `POST /workspaces/{workspaceID}/documents/files`, `POST /workspaces/{workspaceID}/documents/files/blank` |
| Byte qua proxy FileService | `POST /workspaces/{workspaceID}/files/resolve` rồi `GET /files/{fileID}/content` (URL kèm ticket) |

Quyền: mọi route trên đi qua `RequireMember` và ACL Document; người không có quyền
nhận 403/404 theo `mapServiceError`, app không suy ra việc id có tồn tại. Phiên bản
file không ghi đè: mỗi lần lưu thêm một phiên bản, bản cũ khôi phục được. Đặc tả
launch bridge ở [launch-bridge-contract.md](launch-bridge-contract.md).

**Chưa xây:** luồng "Mở từ UniWork" trong giao diện app genoffice (chọn workspace,
chọn tài liệu, nối nút Lưu với `versions/commit`, xử lý 409) là việc của **GO-A6
(UNI-1007) sẽ bổ sung**. Nếu lane đó cần route mới (ví dụ liệt kê gọn cho app), nó
phải bổ sung vào tài liệu này cùng bản đăng ký route và SDI/SDO.

## 3. AI đám mây (GO-A7, UNI-1008)

Quyết định nằm ở [ADR 0028](../../adr/0028-ai-phia-client-cua-uniwork-office.md):

- **BYO key** (key của người dùng, Codex CLI, v.v. theo cấu hình AI của genoffice):
  app gọi thẳng nhà cung cấp. Lưu lượng này không đi qua UniWork, UniWork không thấy
  key, prompt hay kết quả, và không tính tín dụng.
- **Đám mây UniWork** (tìm web, tạo ảnh, phân tích media, tín dụng): app chỉ gọi API
  UniWork bằng phiên đăng nhập ở mục 1. Server đi qua `ai.Gateway`
  (`server/internal/ai/`) và kiểm entitlement của tổ chức; app không bao giờ giữ key
  nhà cung cấp của UniWork.

Hiện trên develop chỉ có các route AI của Ask UNI (`router/ai.go`, ví dụ
`GET /workspaces/{workspaceID}/ai/capabilities`, `GET /workspaces/{workspaceID}/ai/usage`,
`GET /orgs/{orgID}/ai/usage`); chúng phục vụ web chứ chưa phải hợp đồng cho app.
**Các endpoint đám mây cho app là việc của GO-A7 (UNI-1008), chưa xây**; lane đó
sẽ bổ sung route, entitlement và cách báo hết tín dụng vào mục này.

## 4. Bản cài (GO-A8, UNI-1009)

Server chỉ phát link, không lưu bản cài. Biến môi trường (đều có trong
`.env.example` và `server/internal/config/config.go`; rỗng nghĩa là kênh không có, không
thay bằng kênh khác):

| Biến | Vai trò |
| --- | --- |
| `OFFICE_INSTALLER_DEV_URL`, `OFFICE_INSTALLER_BETA_URL`, `OFFICE_INSTALLER_STABLE_URL` | Một link mỗi kênh; chỉ còn để tương thích, ánh xạ sang `win32-x64`, bỏ sau 2026-11-02 |
| `OFFICE_INSTALLER_DEV_URLS`, `OFFICE_INSTALLER_BETA_URLS`, `OFFICE_INSTALLER_STABLE_URLS` | JSON `{platform: url}` theo kênh; chỉ nhận HTTPS (hoặc HTTP loopback khi dev) và đuôi file đúng nền tảng |

Endpoint phục vụ: `GET /office/desktop/download` (`router/config.go`), yêu cầu thành
viên tổ chức, trả `installers` và `supported_platforms` đúng kênh; `bundle=true&platform=<key>`
trả ZIP của nền tảng đã chọn. CI của fork đăng bản lên các URL đó (GO-A8). Ký số
nằm trong backlog chứng chỉ, không chặn.

## 5. Khung Docs trên web (GO-B2, GO-B3)

Chỉ là con trỏ: hợp đồng nạp bundle renderer genoffice (version, CSP, cầu nối chỉ
chạm file qua token FileService đúng workspace) là **GO-B2 (UNI-1012)**, và trang mở
tài liệu docx dùng renderer đó là **GO-B3 (UNI-1013)**. Trên develop hiện chưa có
route hay trang web nào cho khung này: chỉ có component `OfficeFrame` trong
`packages/views/office/frame/` (editor G3 cũ). Các route/đường dẫn mới sẽ được
ghi vào mục này khi hai lane đó đăng ký chúng.
