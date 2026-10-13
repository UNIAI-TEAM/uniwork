# UniWork — Connector MCP cho Claude, ChatGPT, Gemini (v1 chỉ đọc)

> **Trạng thái:** in-progress — triển khai xong trên nhánh, chờ thử thật trên ba client và review PR (UNI-1308).

**Ngày:** 2026-10-12
**Issue:** UNI-1308 (parent UNI-417 · Giai đoạn A)
**Roadmap ID:** A-13 · P1
**ADR mới:** 0031 — viết trong PR đầu tiên của spec này (§11).
**Liên quan:** ADR 0007 (actor), ADR 0008 (tenant), ADR 0010 (AI không ghi trực tiếp),
ADR 0025 (một process), spec G4 desktop §4 (luồng PKCE đã có),
spec Ask UNI / F-09 (`server/internal/ai/tools.go`).

## 1. Mục tiêu

Người dùng UniWork thêm UniWork làm connector trong Claude, ChatGPT, Gemini CLI (và mọi
client MCP khác) rồi hỏi về công việc của mình ngay trong client đó. UniWork là **remote
MCP server** có OAuth riêng; không viết adapter riêng cho từng nền tảng.

**Tiêu chí thành công**

1. Người dùng dán `${API_PUBLIC_URL}/mcp` vào Claude (custom connector), đăng nhập
   UniWork, chọn tổ chức, đồng ý, hỏi "tuần này tôi có việc gì" và nhận đúng task, cuộc
   họp của mình, mỗi mục có link mở thẳng UniWork.
2. Cùng kịch bản chạy được ở ChatGPT (developer mode) và Gemini CLI.
3. Người dùng thu hồi ứng dụng ở Cài đặt; lần gọi tool kế tiếp nhận 401.
4. Admin tổ chức tắt connector; mọi lần gọi kế tiếp của tổ chức đó bị từ chối.
5. Không client nào đọc được dữ liệu của tổ chức ngoài grant, kể cả khi người dùng là
   thành viên của cả hai tổ chức (§12, `TestIsolationMCP`).

## 2. Quyết định đã chốt (brainstorm 2026-10-12)

| Chủ đề | Quyết định |
| --- | --- |
| Hướng | Client AI bên ngoài gọi vào UniWork. UniWork dùng nhiều LLM (BYO key) là spec khác |
| Phạm vi v1 | Chỉ đọc. Tool ghi là spec sau, đi qua `action_proposals` của ADR 0010 |
| Kiến trúc | MCP endpoint và OAuth server nằm trong server Go hiện có (ADR 0025) |
| Transport | Streamable HTTP, stateless — không `Mcp-Session-Id`, không sticky session |
| SDK | `github.com/modelcontextprotocol/go-sdk` (SDK Go chính thức) |
| Token | Opaque, tiền tố `uwm_`, DB chỉ lưu SHA-256. Không dùng JWT để `RequireAuth` của REST không thể nhận token MCP |
| Grant | Một grant cho mỗi bộ (user, organization, client). Người dùng chọn tổ chức khi đồng ý |
| Đăng ký client | Client ID Metadata Document (CIMD) và Dynamic Client Registration (DCR) |
| Dữ liệu ra ngoài | Task, cuộc họp (kèm tóm tắt), workspace. Không chat, không Email Hub, không transcript |
| Bật/tắt | Flag `mcp_connector` (rollout) **và** công tắc của admin tổ chức, mặc định tắt |
| Actor | Mọi tool chạy bằng `service.Human(userID)` qua `RequireMember`, như người dùng tự mở màn hình |

Lý do loại chat và email: đó là lời của người khác trong tổ chức, họ chưa đồng ý cho
nội dung đi tới nhà cung cấp AI bên thứ ba. Task và cuộc họp là dữ liệu công việc mà
admin tổ chức đã chủ động cho phép khi bật connector.

## 3. Phạm vi

### 3.1 Trong phạm vi

- OAuth 2.1 authorization server: discovery, authorize, token, refresh, revoke,
  DCR, CIMD.
- `POST /mcp` với 5 tool đọc (§7).
- Màn consent trên web.
- Cài đặt cá nhân: "Ứng dụng đã kết nối" (xem, thu hồi).
- Cài đặt tổ chức: bật/tắt connector, xem và thu hồi mọi grant của tổ chức.
- Flag `mcp_connector`, audit, rate limit, metric.
- ADR 0031.

### 3.2 Ngoài phạm vi

- Tool ghi (tạo/sửa task, comment) — spec sau, phụ thuộc `action_proposals`.
- Tài liệu (ADR 0016) — v1.1, cùng tầng tool, thêm một tool `search` mở rộng.
- Chat, Email Hub, transcript cuộc họp.
- MCP `resources`, `prompts`, `sampling`, `elicitation`; MCP Apps / Apps SDK UI.
- Nộp Connectors Directory của Anthropic và Apps của OpenAI (§14 ghi điều kiện).
- UniWork làm MCP client gọi ra app khác; BYO key LLM.
- Server-initiated stream (`GET /mcp`) và thông báo `listChanged`.

## 4. Kiến trúc

```text
Claude / ChatGPT / Gemini CLI
   │  1. POST /mcp (không token) → 401 + WWW-Authenticate: resource_metadata
   │  2. GET /.well-known/oauth-protected-resource/mcp
   │  3. GET /.well-known/oauth-authorization-server
   │  4. CIMD (client_id là URL) hoặc POST /oauth/register
   │  5. Trình duyệt → GET /oauth/authorize ──302──▶ web /auth/connect/authorize
   │                                               │ đăng nhập (phiên web hiện có)
   │                                               │ chọn tổ chức, đồng ý (POST + CSRF)
   │  ◀──────────── redirect_uri?code&state&iss ────┘
   │  6. POST /oauth/token (code + verifier) → access + refresh
   │  7. POST /mcp (Bearer uwm_…) → tool
   ▼
server (một process)
   handler/mcp       RequireMCPToken → kiểm grant/tổ chức → go-sdk → tool
   handler/oauth     discovery, authorize, token, register, revoke
   service/mcp_*     McpAuthService (client, attempt, grant, token)
                     McpToolService (gọi AskUNIService, HomeService)
   pkg/db            mcp_clients, mcp_auth_attempts, mcp_grants, mcp_tokens
```

**Package map**

```text
server/internal/handler/mcp_oauth.go     # endpoint OAuth chuẩn (form/JSON theo RFC) + discovery
server/internal/handler/mcp_transport.go # /mcp: xác thực token + go-sdk (package handler như mọi handler)
server/internal/handler/mcp_connect.go   # REST cho consent + quản lý grant
server/internal/handler/router/mcp.go    # đăng ký route ngoài wrapper `api` (§5.1)
server/internal/handler/router/connect.go  # REST cho web (wrapper `api`)
server/internal/service/mcp_*.go         # client, attempt, token, grant, principal, tool
server/pkg/db/queries/mcp.sql
packages/core/connect/                  # endpoints, hooks, keys
packages/views/connect/                 # màn consent
packages/views/settings/components/connected-apps-*.tsx
apps/web/app/(auth)/auth/connect/authorize/page.tsx
```

`handler/mcp` chỉ gọi service; không truy vấn DB (`server/internal/arch_test.go`
không đổi luật). Tool không nằm trong `internal/ai` vì `internal/ai` không được
import `internal/service`.

## 5. OAuth

### 5.1 Endpoint

Issuer là `API_PUBLIC_URL`. Resource duy nhất là `${API_PUBLIC_URL}/mcp`.

| Endpoint | Ghi chú |
| --- | --- |
| `GET /.well-known/oauth-protected-resource/mcp` và `/.well-known/oauth-protected-resource` | RFC 9728: `resource`, `authorization_servers: [issuer]`, `scopes_supported: ["read"]`, `bearer_methods_supported: ["header"]` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: endpoint bên dưới, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none","client_secret_post","client_secret_basic"]`, `client_id_metadata_document_supported: true` |
| `GET /oauth/authorize` | Kiểm tham số, tạo attempt, 302 sang web consent |
| `POST /oauth/token` | `application/x-www-form-urlencoded`, `Cache-Control: no-store` |
| `POST /oauth/register` | RFC 7591, JSON |
| `POST /oauth/revoke` | RFC 7009, luôn 200 |

Các route này và `/mcp` đăng ký ngoài wrapper `api` và không vào OpenAPI, giống
`GET /api/v1/ws`, vì body theo RFC chứ không theo SDI/SDO. Mỗi route tự đặt giới hạn
body bằng `http.MaxBytesReader` (token/revoke 16 KiB, register 16 KiB, `/mcp` 1 MiB)
thay cho `decode`. `router_test.go` ghim danh sách route ngoài wrapper. ADR 0031 ghi
ngoại lệ này.

REST cho web (qua wrapper `api`, có SDI/SDO, `pathParamSDI` cho `attemptID`, `grantID`):

| Route | Mục đích |
| --- | --- |
| `GET /api/v1/auth/connect/attempts/{attemptID}` | Dữ liệu màn consent + CSRF token |
| `POST /api/v1/auth/connect/attempts/{attemptID}` | `approve` (kèm `organization_id`) hoặc `cancel`; trả `redirect_to` |
| `GET /api/v1/me/connected-apps` | Grant của chính người dùng |
| `DELETE /api/v1/me/connected-apps/{grantID}` | Thu hồi grant của chính mình |
| `GET /api/v1/orgs/{org}/connected-apps` | Owner/admin: mọi grant của tổ chức |
| `DELETE /api/v1/orgs/{org}/connected-apps/{grantID}` | Owner/admin thu hồi một grant |
| `PUT /api/v1/orgs/{org}/mcp-policy` | Owner/admin bật/tắt connector |

### 5.2 Authorize và consent

1. `GET /oauth/authorize` nhận `response_type=code`, `client_id`, `redirect_uri`,
   `code_challenge`, `code_challenge_method=S256`, `state`, `scope`, `resource`.
2. Client không xác định được, hoặc `redirect_uri` không khớp **chính xác** một URI đã
   đăng ký: trả trang lỗi trên web, **không** redirect về URI đó. Ngoại lệ duy nhất là
   `http` trên host loopback (`127.0.0.1`, `::1`, `localhost`): cổng nào cũng được
   (RFC 8252 §7.3, Claude Code nghe trên cổng tạm), scheme, host, path và query vẫn phải
   khớp. Lượt authorize lưu URI kèm cổng; trao code so **chính xác** với URI đó.
3. Lỗi khác (thiếu PKCE, `scope` lạ, `resource` sai): redirect về `redirect_uri` với
   `error` theo RFC 6749 §4.1.2.1.
4. `resource` vắng mặt được hiểu là `/mcp` (chỉ có một resource). `resource` khác →
   `invalid_target`.
5. Hợp lệ: tạo `mcp_auth_attempts` (sống 10 phút), 302 sang
   `${FRONTEND_ORIGIN}/auth/connect/authorize?attempt=<id>`.
6. Trang web dùng phiên đăng nhập hiện có (chưa đăng nhập thì qua luồng login rồi quay
   lại). `GET` attempt gắn attempt vào người dùng ở lần đọc đầu; người khác đọc hay
   duyệt attempt đó nhận 404, như `desktop_auth_ownership_test`.
7. Màn consent hiện: tên client, nhãn "Đã xác minh" / "Chưa xác minh", host của
   `redirect_uri` (luôn hiện), danh sách tổ chức người dùng là thành viên active, dữ
   liệu sẽ chia sẻ (§7) bằng tiếng Việt. Tổ chức chưa bật connector hiện mờ kèm lý do.
8. `POST` approve (CSRF same-site như desktop): tạo hoặc dùng lại grant của bộ (user,
   organization, client), phát code (dùng một lần, sống 120 giây, lưu digest, gắn
   challenge, redirect URI, resource), trả
   `redirect_to = redirect_uri?code=…&state=…&iss=<issuer>`. Web gọi
   `window.location.assign(redirect_to)`.
9. `cancel` trả `redirect_to` với `error=access_denied`.

`GET` không bao giờ phát code; chỉ `POST` có CSRF mới phát.

### 5.3 Token

- `authorization_code`: kiểm code (digest, chưa dùng, chưa hết hạn), `client_id`,
  `redirect_uri`, `code_verifier` (S256), `resource`. Đổi code nguyên tử; code dùng lại
  thì thu hồi mọi token phát từ code đó.
- Trả `access_token` (`uwm_at_…`, sống 1 giờ), `refresh_token` (`uwm_rt_…`), `token_type:
  Bearer`, `expires_in`, `scope`.
- `refresh_token`: xoay vòng mỗi lần dùng. Mỗi refresh token sống 30 ngày kể từ khi phát.
  Refresh token đã dùng bị dùng lại **sau 10 giây** → thu hồi cả family (cùng mô hình
  `revokeDesktopFamily`). Dùng lại **trong 10 giây** → chỉ trả `invalid_grant`, không thu
  hồi: đó là client gửi hai refresh song song, request kia đã nhận cặp token mới.
- Client confidential (đăng ký với secret) phải xác thực; client public chỉ dựa vào PKCE.
- Lỗi theo RFC 6749 §5.2: `invalid_grant`, `invalid_client` (401), `invalid_request`,
  `unsupported_grant_type`, `invalid_target`.
- Token sinh bằng `crypto/rand` 32 byte, base64url. Không token, code, verifier hay
  secret nào vào log, span hay lỗi trả về.

### 5.4 Đăng ký client

**CIMD** — `client_id` là URL `https`:

- Fetch khi gặp lần đầu và khi cache quá 24 giờ. Chỉ cổng 443, timeout 5 giây, không
  theo redirect, body tối đa 16 KiB.
- Dialer chặn địa chỉ nội bộ bằng `netguard.AllowedIP`
  (`server/internal/emailhub/netguard`), kiểm trên IP thật lúc dial để chặn DNS
  rebinding. Port kiểm riêng (443), không dùng `AllowedPort` vì hàm đó chỉ cho cổng mail.
- Document phải có `client_id` bằng đúng URL đã fetch, `client_name`, `redirect_uris`.
- Client CIMD luôn là client public (`none`, PKCE): document phải khai `none` ở
  `token_endpoint_auth_method` hoặc trong `token_endpoint_auth_methods_supported`
  (ChatGPT khai `private_key_jwt` kèm danh sách có `none`), hoặc không khai method nào.
  Document không cho `none` bị từ chối; `jwks_uri` và trường của method khác bị bỏ qua.
- Request fetch gửi `User-Agent: UniWork-MCP-CIMD/1 (+<FRONTEND_ORIGIN>)`. Document quá
  16 KiB là câu trả lời dứt khoát như 4xx: không dùng hàng cache cũ thay.
- Hàng CIMD chỉ là cache: không có grant, không có lượt authorize còn sống, không dùng,
  fetch hay tạo trong một ngày thì job dọn xóa; lần sau client quay lại thì fetch lại.

**DCR** — `POST /oauth/register`:

- Nhận `client_name`, `redirect_uris`, `grant_types`, `response_types`,
  `token_endpoint_auth_method`, `logo_uri` (tùy chọn, chỉ để hiển thị).
- `redirect_uris`: chỉ `https`, trừ `http://127.0.0.1`, `http://[::1]`,
  `http://localhost` cho client chạy local (Gemini CLI, Claude Code). Không fragment,
  không wildcard.
- `none` → client public. `client_secret_*` → phát secret một lần, lưu digest.
- Rate limit theo IP (§10). Client DCR chưa từng có grant và không dùng trong 30 ngày
  thì job dọn xóa.

**Nhãn "Đã xác minh"**: danh sách host redirect đã xác minh là hằng số trong mã
(`verifiedRedirectHosts`), không cấu hình từ UI. Plan lấy giá trị từ tài liệu chính
thức của Anthropic, OpenAI, Google tại thời điểm triển khai. Client chỉ được nhãn khi
**mọi** `redirect_uris` thuộc danh sách đó. Tên client tự khai không bao giờ đủ để được
nhãn.

## 6. Dữ liệu

Mọi id là ULID trong `TEXT`; không FK; index `CONCURRENTLY`, mỗi index một file.

**`mcp_clients`** — bảng định danh, thêm vào `tenantExemptTables` với lý do "client OAuth
dùng chung mọi tổ chức".
`id`, `client_id` (URL CIMD hoặc id sinh ra, unique), `kind` (`cimd` | `dcr`),
`client_name`, `logo_uri`, `redirect_uris` (JSON), `token_endpoint_auth_method`,
`secret_digest`, `metadata_fetched_at`, `last_used_at`, `created_at`.

**`mcp_auth_attempts`** — bảng định danh (chưa có tổ chức trước khi duyệt), miễn với
lý do tương tự `desktop_auth_attempts`. **Không có cột `organization_id`**: thêm bảng
vào `nullableTenantTables` cần ADR riêng, nên tổ chức của attempt đã duyệt đọc qua
`grant_id`.
`id`, `client_id`, `redirect_uri`, `code_challenge`, `scope`, `resource`, `state`,
`user_id`, `csrf_digest`, `grant_id` (NULL đến khi duyệt), `code_digest`,
`code_expires_at`, `expires_at`, `approved_at`, `used_at`, `cancelled_at`,
`created_at`.

**`mcp_grants`** — bảng nghiệp vụ, `organization_id NOT NULL`.
`id`, `organization_id`, `user_id`, `client_id`, `scope`, `created_by`,
`created_by_kind`, `created_at`, `last_used_at`, `revoked_at`, `revoked_by`,
`revoked_by_kind`. Unique một grant chưa thu hồi cho mỗi (`organization_id`,
`user_id`, `client_id`).

**`mcp_tokens`** — bảng nghiệp vụ, `organization_id NOT NULL`.
`id`, `organization_id`, `grant_id`, `family_id`, `kind` (`access` | `refresh`),
`digest` (unique), `expires_at`, `used_at`, `revoked_at`, `created_at`.

**`organizations`** thêm `mcp_enabled_at TIMESTAMPTZ`, `mcp_enabled_by TEXT`. NULL =
tắt.

Query mới khai báo tenant: query theo grant/token dùng `-- tenant: token`; query liệt
kê của tổ chức dùng `organization_id = $n` (`TestEveryQueryNamesItsTenant`).

Job dọn (trong worker hiện có, ADR 0025): xóa attempt hết hạn, token hết hạn quá 7
ngày, client DCR bỏ hoang (30 ngày) và hàng CIMD không ai dùng (một ngày), không xóa
client đang có grant hay lượt authorize còn sống. Không xóa grant đã thu hồi (lịch sử
cho trang cài đặt).

## 7. MCP endpoint và tool

### 7.1 Transport

- `POST /mcp`: JSON-RPC qua go-sdk ở chế độ stateless, `JSONResponse: true`,
  `MaxRequestBodyBytes` 1 MiB. Phiên bản giao thức do SDK thương lượng, tối thiểu
  `2025-06-18`.
- `DisableLocalhostProtection: true`: lớp chống DNS rebinding của SDK từ chối request đến
  từ localhost mang `Host` khác localhost, tức mọi request qua reverse proxy cùng máy.
  Server này luôn đòi bearer token nên lớp đó không cần.
- `GET /mcp`, `DELETE /mcp`: 405.
- Không CORS: client gọi từ server của họ. MCP Inspector dùng qua proxy của nó.

### 7.2 `RequireMCPToken`

Thứ tự kiểm, dừng ở lỗi đầu tiên:

| Bước | Lỗi |
| --- | --- |
| Header `Bearer uwm_at_…`, digest tồn tại, chưa hết hạn, chưa thu hồi | 401 `invalid_token` + `WWW-Authenticate: Bearer resource_metadata="${API_PUBLIC_URL}/.well-known/oauth-protected-resource/mcp"` |
| Grant chưa thu hồi | 401 `invalid_token` |
| Flag `mcp_connector` bật cho tổ chức | 403 `connector_disabled` |
| `organizations.mcp_enabled_at` khác NULL | 403 `connector_disabled` |
| `OrganizationService.RequireMember` (tổ chức bị suspend, thành viên bị deactivate) | 403 `organization_suspended` / `member_deactivated` |
| Rate limit theo access token (router không đọc DB, nên khóa là SHA-256 của bearer) | 429 |

401 chỉ dùng cho lỗi token, để client tự đăng nhập lại. 403 là tình huống đăng nhập lại
không giải quyết được.

Context mang `userID`, `organizationID`, `grantID`, `clientID`. `last_used_at` của grant
và client cập nhật tối đa một lần mỗi 5 phút.

### 7.3 Phạm vi tổ chức của grant

Người dùng có thể là thành viên của nhiều tổ chức. `RequireMember` chỉ hỏi "người này
có phải thành viên không", nên **trước mọi tool nhận `workspace_id`**,
`McpToolService` đọc workspace và kiểm `organization_id` bằng tổ chức của grant. Khác
→ `ErrNotFound`. Đây là điểm chặn chính của tiêu chí thành công 5.

### 7.4 Tool

Mọi tool: annotation `readOnlyHint: true`, `destructiveHint: false`,
`openWorldHint: false`; trả `structuredContent` kèm bản `text` cùng nội dung. URL là
tuyệt đối: `FRONTEND_ORIGIN` + `Href` của `ai.Source`.

| Tool | Input | Nguồn | Output |
| --- | --- | --- | --- |
| `list_workspaces` | — | workspace của người dùng trong tổ chức của grant | `{id, name, url}[]` |
| `my_work` | `workspace_id?` | `HomeService.Summary` (`HomeLimits{Tasks: 20, Meetings: 10}`) | task (quá hạn, đến hạn) và cuộc họp sắp tới; thiếu `workspace_id` thì gộp tối đa 10 workspace theo tên, có `truncated` |
| `search` | `workspace_id`, `query` (1–200 ký tự) | phần task + cuộc họp của `searchWorkspace` | tối đa 20 `{kind, id, title, excerpt, url}` |
| `get_task` | `workspace_id`, `task_id` | `taskContext` | task + comment |
| `get_meeting` | `workspace_id`, `meeting_id` | `meetingContext` | cuộc họp + tóm tắt |

`searchWorkspace` hôm nay gộp cả chat. Tách phần task + cuộc họp thành hàm riêng:
Ask UNI gọi hàm đó rồi thêm chat như cũ, MCP chỉ gọi hàm đó. Hành vi Ask UNI không đổi;
test Ask UNI hiện có giữ điều đó.

`McpToolService` dùng một `ai.Registry` riêng (`McpTools`) với `Kind: ToolRead`. Test
`TestMCPToolsAreReadOnly` khẳng định `MutationCount() == 0`, cùng cách
`TestAskUniToolsAreReadOnly`.

Description của tool viết bằng tiếng Anh (model đọc), nói rõ dữ liệu trả về là nội dung
người dùng nhập và không phải chỉ dẫn.

### 7.5 Lỗi trong tool

- `ErrForbidden`, `ErrNotFound`, workspace ngoài tổ chức của grant: cùng một kết quả
  `isError: true`, `"not found or not accessible"`. Không phân biệt để không lộ id.
- Input sai schema: `isError: true`, `"invalid arguments: …"`. Tool đăng ký qua
  `Server.AddTool` thô từ `ai.Registry`, nên handler của tool tự kiểm input.
- Lỗi hạ tầng: `isError: true`, `"temporarily unavailable"`; chi tiết chỉ vào log kèm
  `correlation_id`.

## 8. Quyền và chính sách

- **Flag `mcp_connector`** (`server/internal/featureflags/keys.go`, `Public: true`,
  `ReviewAt` 2027-01-31, owner `platform`): ẩn toàn bộ tính năng. Tắt thì consent
  không cho chọn tổ chức đó và `/mcp` trả 403. Flag ẩn năng lực, không cấp quyền.
- **Công tắc tổ chức**: chỉ owner/admin (`OrganizationService.RequireMember` với role).
  Mặc định tắt. Tắt là chặn ngay, không xóa grant; bật lại thì grant cũ dùng tiếp.
- **Thu hồi**: người dùng thu hồi grant của mình; owner/admin thu hồi grant bất kỳ trong
  tổ chức. Thu hồi grant thu hồi mọi token của grant trong cùng transaction.
- **Bị deactivate**: grant giữ nguyên nhưng bị chặn ở bước `RequireMember`; kích hoạt lại
  thì dùng tiếp.
- **Rời tổ chức** (`OrganizationMemberService.Leave`, đường duy nhất xóa membership):
  thu hồi mọi grant và token của người đó trong tổ chức, cùng transaction.
- **Xóa tài khoản** (`AuthService.DeleteAccount`): thu hồi mọi grant và token của
  người đó, cùng transaction với `revokeAllUserSessions`.
- **Đặt lại mật khẩu** (`PasswordResetService.Reset`, Ruling 49): thu hồi mọi grant và
  token của người đó ở mọi tổ chức, cùng transaction với `revokeAllUserSessions`; số
  grant bị thu hồi ghi ở `mcp_grants_revoked` trên dòng `auth.session_revoked`
  (`reason: password_reset`). Mã đã duyệt trước khi đặt lại mà đổi sau đó nhận
  `invalid_grant`. "Đăng xuất mọi nơi" trên desktop **không** thu hồi grant (quyết định
  của người dùng): đó là công cụ phiên, không phải đặt lại thông tin đăng nhập.

## 9. Giao diện

- **Consent** `apps/web/app/(auth)/auth/connect/authorize/page.tsx`, view ở
  `packages/views/connect/`. Thêm `paths.connectAuthorize()` cạnh
  `desktopAuthorize` (`auth` đã là slug dành riêng, không cần thêm slug mới).
- **Cài đặt cá nhân**: tab `connected-apps` trong nhóm "Tài khoản" — tên client, nhãn
  xác minh, tổ chức, ngày kết nối, lần dùng cuối, nút "Thu hồi" có xác nhận. Tab hiện khi
  flag `mcp_connector` bật **hoặc** người dùng đang có grant (Ruling 50: tổ chức thử
  nghiệm riêng bật connector mà flag của người đó tắt); khi flag tắt, tab ẩn cho tới khi
  biết danh sách grant.
- **Cài đặt tổ chức**: tab `ai-access` trong nhóm "Tổ chức", gate `org_admin`: công tắc
  "Cho phép trợ lý AI bên ngoài truy cập", câu giải thích dữ liệu nào được chia sẻ, địa
  chỉ `/mcp` có nút sao chép (khi nền tảng đã mở tính năng, để admin gửi cho thành viên),
  danh sách grant của tổ chức, thu hồi từng grant.
- **Hướng dẫn**: trong cài đặt cá nhân hiện URL `/mcp` có nút sao chép và các bước ngắn
  cho Claude, ChatGPT, Gemini CLI.
- i18n: khóa `connect.*` và `settings.connectedApps.*`, viết tiếng Việt trước theo
  `docs/conventions.md`; mọi literal qua `t()`.
- `packages/core/connect/`: endpoints với `parseWithFallback`, hooks, `connectKeys`;
  mỗi endpoint có malformed-response test.

## 10. Audit, giới hạn, quan sát

**Audit** (`audit.Recorder.Record`, cùng transaction, không emit outbox vì không client
nào cần realtime cho các việc này):

- `mcp_grant.created` — người dùng duyệt consent.
- `mcp_grant.revoked` — người dùng hoặc admin thu hồi; ghi ai thu hồi.
- `organization.mcp_policy_changed` — bật/tắt, ghi giá trị mới.
- `mcp_token.family_revoked` — phát hiện refresh token dùng lại (actor `system`).

Tên action là hằng số mới trong `server/internal/audit/actions.go`, cùng kiểu
`ActionDesktopDeviceRevoked`. Bốn action vào `auditActions()` và
`actionsWithoutCommands` của `audit_coverage_test.go` với lý do "covered by
mcp_*_test.go", như các action desktop; test của `McpAuthService` khẳng định từng dòng
audit. Lệnh đọc qua tool không audit.

**Rate limit** (Redis, fail open sau 100 ms như mọi limiter):

- `/mcp`: 120 lần/phút cho mỗi access token (`RateLimitByIdentityBucket`, khóa
  `mcp:<sha256 của bearer>`; không bearer thì theo IP).
- `/oauth/token`, `/oauth/authorize`: `credentialLimit` hiện có (60/phút theo IP).
- `/oauth/register`: 10/giờ theo IP.

**Quan sát**:

- Metric `uniwork_mcp_tool_calls_total{tool,outcome}`,
  `uniwork_mcp_tool_duration_seconds{tool}`, `uniwork_mcp_oauth_events_total{event}`.
- Span gắn `mcp.client_id`, `mcp.grant_id`, `mcp.tool`.
- Không log input/output của tool: câu hỏi có thể chứa dữ liệu cá nhân. Log người dùng
  bằng id (`scripts/no-pii-log.test.mjs`).
- Biến môi trường mới (nếu có) vào `.env.example`.

## 11. ADR 0031

Tiêu đề: "UniWork là OAuth authorization server cho client AI bên ngoài; token MCP tách
khỏi token phiên". Ghi:

1. Client bên thứ ba nhận token opaque chỉ dùng được ở `/mcp`, không bao giờ là JWT phiên.
2. Route OAuth và `/mcp` đăng ký ngoài wrapper `api` và ngoài OpenAPI.
3. Tool qua MCP chạy bằng actor `human` của người đã duyệt; tool ghi chưa tồn tại và khi
   có phải theo ADR 0010.
4. Dữ liệu được chia sẻ do admin tổ chức bật, mặc định tắt; chat và email không thuộc
   phạm vi connector cho tới khi có ADR khác.

## 12. Bảo mật

| Mối đe dọa | Chặn bằng |
| --- | --- |
| Token MCP dùng cho REST và ngược lại | Token opaque; test hai chiều (§13) |
| Đọc chéo tổ chức qua người dùng là thành viên nhiều tổ chức | Kiểm tổ chức của workspace trước mọi tool (§7.3); `TestIsolationMCP` |
| Client giả mạo tên "Claude" | Nhãn xác minh chỉ theo host redirect trong mã; consent luôn hiện host redirect |
| Open redirect qua `redirect_uri` | Khớp chính xác (trừ cổng của `http` loopback, RFC 8252 §7.3); URI sai không bao giờ được redirect tới |
| SSRF khi fetch CIMD | `netguard.AllowedIP` lúc dial, chỉ cổng 443, không theo redirect, giới hạn kích thước |
| Code hoặc refresh token bị đánh cắp | PKCE S256 bắt buộc, code 120 giây dùng một lần, xoay refresh + thu hồi family |
| Phát code qua link GET (CSRF, prefetch) | Chỉ `POST` có CSRF phát code |
| Prompt injection từ nội dung task | Chỉ có tool đọc; description nói rõ nội dung là dữ liệu; không có tool gửi ra ngoài |
| Spam DCR, CIMD | Rate limit theo IP, job dọn client bỏ hoang (DCR 30 ngày, CIMD một ngày) |
| Dữ liệu tới nhà cung cấp AI ngoài Việt Nam | Admin chủ động bật; consent nói rõ dữ liệu nào ra ngoài; loại chat/email |

## 13. Kiểm thử và DoD

**Go**

- OAuth: PKCE sai/thiếu, `plain` bị từ chối, redirect gần đúng bị từ chối, code dùng lại
  (thu hồi token đã phát), code hết hạn, `resource` sai, refresh xoay vòng, refresh
  dùng lại (thu hồi family + audit), client confidential sai secret.
- CIMD: `client_id` trong document khác URL, host nội bộ, DNS trỏ IP riêng, cổng khác
  443, redirect, body quá lớn.
- Consent: attempt của người khác 404, `GET` không phát code, CSRF sai, tổ chức chưa bật
  không duyệt được.
- `TestMCPTokenRejectedByREST` và `TestSessionTokenRejectedByMCP`.
- `RequireMCPToken`: mỗi dòng của bảng §7.2.
- `TestIsolationMCP` (cạnh `TestIsolationMatrix`): hai tổ chức A, B. Token của B gọi mọi
  tool với id của A → lỗi không chứa text hay id của A. Người dùng là thành viên cả A và
  B, grant cho B, gọi tool với workspace của A → bị từ chối. Có control: grant của A đọc
  được dữ liệu A.
- `isoRoutes`: phân loại `/mcp`, `/oauth/*`, `/.well-known/*`,
  `/api/v1/auth/connect/*`, `/api/v1/me/connected-apps*` kèm lý do. Route
  `/api/v1/orgs/{org}/connected-apps/{grantID}` có tenant trong path nên matrix phủ;
  world seed một grant cho mỗi tenant (`tn.ids["mcpGrant"]`).
- `TestSwaggerSpecFollowsChiRoutesAndSDI`: thêm ngoại lệ `/oauth/`, `/.well-known/`,
  `/mcp`. `testutil.DB`: thêm bốn bảng mới vào danh sách TRUNCATE.
- `McpConsentSDI.organization_id` vào `isoRefFieldExempt` với lý do "covered by
  TestIsolationMCP".
- `TestMCPToolsAreReadOnly`; test Ask UNI hiện có vẫn xanh sau khi tách
  `searchWorkspace`.
- Migration lint: `tenantExemptTables` có hai bảng định danh kèm lý do; hai bảng
  nghiệp vụ có `organization_id NOT NULL`, `created_by_kind` khi có `created_by`.
- Audit coverage: bốn lệnh §10.

**TypeScript**

- `packages/core/connect`: malformed-response cho mọi endpoint.
- `packages/views/connect` và cài đặt: consent (đã/chưa xác minh, tổ chức bị tắt, lỗi),
  danh sách grant, thu hồi có xác nhận, công tắc chỉ hiện với owner/admin.
- `paths` consistency test xanh với trang mới.

**Thủ công trước khi bật flag cho tổ chức pilot**

- Claude: Settings → Connectors → Add custom connector → URL `/mcp`; hỏi
  "tuần này tôi có việc gì".
- ChatGPT: developer mode, thêm connector, cùng câu hỏi.
- Gemini CLI: khai báo server HTTP trong `settings.json`, đăng nhập qua OAuth.
- MCP Inspector: liệt kê tool, gọi từng tool.
- Thu hồi ở Cài đặt → lần gọi tiếp 401; admin tắt → 403.

`make check` xanh trước PR.

## 14. Rủi ro và việc sau

| Rủi ro | Giảm thiểu |
| --- | --- |
| Client hỗ trợ CIMD/DCR khác nhau, đổi theo thời gian | Hỗ trợ cả hai; checklist thủ công trên ba client trước mỗi lần nâng SDK |
| Spec MCP đổi phiên bản | Dùng SDK chính thức, ghim phiên bản trong `server/go.mod` |
| Tìm kiếm theo từ khóa trả kết quả kém | Cùng giới hạn với Ask UNI; thay khi có search index A-04 |
| Người dùng kỳ vọng ghi được | Consent và hướng dẫn nói rõ v1 chỉ đọc |

**Việc sau (spec riêng)**

1. v1.1: tài liệu trong `search` và `get_document`.
2. Tool ghi qua `action_proposals` (ADR 0010), scope `write`.
3. Nộp Directory: cần privacy policy, trang hỗ trợ, tài khoản demo, annotation đầy đủ.
4. MCP Apps / Apps SDK: thẻ task tương tác.

## 15. Bước tiếp theo

1. Người dùng duyệt spec này (đã duyệt trong phiên 2026-10-12).
2. `writing-plans` → `docs/superpowers/plans/2026-10-12-mcp-connector.md`; mỗi task lớn
   của plan là một sub-issue của UNI-1308 (`make issue-sub`).
