# 0031 — UniWork là OAuth authorization server cho client AI bên ngoài; token MCP tách khỏi token phiên

**Trạng thái:** accepted (2026-10-12) — chấp nhận bởi bavinh2803 khi duyệt spec
`2026-10-12-mcp-connector-design.md` (UNI-1308). Mục 3 (tool ghi theo ADR 0010) bị thay bởi
[0033](0033-tool-ghi-qua-mcp-chay-truc-tiep-bang-actor-human.md) ngày 2026-10-14; các mục còn lại vẫn giữ.

## Bối cảnh

Người dùng muốn hỏi về công việc trong UniWork ngay trong Claude, ChatGPT, Gemini.
Các client này nói MCP và tự đăng nhập qua OAuth 2.1 (PKCE, đăng ký client động hoặc
Client ID Metadata Document). Token phiên hôm nay là JWT mà mọi route `/api/v1` chấp
nhận; trao nó cho bên thứ ba là trao toàn quyền tài khoản.

## Quyết định

1. Client bên thứ ba nhận token **opaque** (`uwm_at_`, `uwm_rt_`), chỉ `/mcp` chấp nhận.
   `RequireAuth` không bao giờ nhận chúng vì chúng không phải JWT; test hai chiều giữ điều
   đó.
2. Route OAuth (`/oauth/*`, `/.well-known/oauth-*`) và `/mcp` đăng ký **ngoài** wrapper
   `api` và ngoài OpenAPI: body theo RFC (form, JSON-RPC), không theo SDI/SDO. Mỗi route
   tự giới hạn body. `router_test.go` và `swagger_test.go` ghim danh sách.
3. Tool qua MCP chạy bằng actor `human` của người đã đồng ý, đi qua `RequireMember` như
   màn hình. Tool ghi chưa tồn tại; khi có, nó theo ADR 0010 (đề xuất → xác nhận).
4. Admin tổ chức bật connector, mặc định tắt. Chat và Email Hub không thuộc phạm vi
   connector cho tới khi có ADR khác, vì đó là lời của người chưa đồng ý chia sẻ.

## Hệ quả

- Thêm bốn bảng (`mcp_clients`, `mcp_auth_attempts` miễn tenant; `mcp_grants`,
  `mcp_tokens` có `organization_id`) và hai cột ở `organizations`.
- Danh sách ngoại lệ của `TestSwaggerSpecFollowsChiRoutesAndSDI` dài thêm ba tiền tố.
- Cái giá: thêm một bề mặt xác thực phải bảo trì (DCR, CIMD, xoay refresh). Bù lại token
  của client ngoài bị giới hạn ở một resource, một scope đọc, thu hồi được từng cái.
- Thu hồi hàng loạt (rời tổ chức, xóa tài khoản, đặt lại mật khẩu) ghi sự kiện trên dòng
  audit của chính lệnh đó (`member.left`, `user.deleted`, dòng `auth.session_revoked`
  của lần đặt lại mật khẩu với `mcp_grants_revoked`), không ghi một dòng
  `mcp_grant.revoked` cho từng grant.

## Test giữ luật

- `TestMcpTokenRejectedByREST`, `TestSessionTokenRejectedByMCP` (Task 8 của plan).
- `TestIsolationMCP` (Task 10).
- `TestMCPToolsAreReadOnly` (Task 6).
