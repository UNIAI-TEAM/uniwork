# Hợp đồng API giữa app UniWork Office và UniWork

**Revision:** 1.1 (2026-10-09, mục 3 viết lại thành hợp đồng AI thật, GO-A7)
**Issue:** GO-C3 (UNI-1020), thuộc UNI-1001
**Trạng thái:** hợp đồng bên server `dev-uniwork`. Phần đã có route được đánh dấu "có sẵn"; phần chưa xây được đánh dấu theo lane (GO-A6, GO-A7, GO-B2/B3).

Tài liệu này ghi các điểm nối giữa app desktop UniWork Office (repo fork
`UNIAI-TEAM/uniwork-office`, nền genoffice) và API của UniWork. Hướng đi nằm trong
plan genoffice `docs/superpowers/plans/2026-10-08-uniwork-office-genoffice.md`
(vào develop cùng UNI-1001; Q1: hai repo riêng, nối bằng API). Tài liệu chỉ trỏ tới
hợp đồng đã có và không chép lại; mọi đường dẫn bên dưới đã đối chiếu với
`server/internal/handler/router/`. Đường dẫn tương đối với `/api/v1`.

Nguyên tắc chung:

- App là public client, không giữ bí mật của UniWork và không giữ key nhà cung cấp AI của UniWork (khóa BYOK của người dùng trên web nằm phía server, mục 3).
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

`client_id` là `uniwork-office`, `deployment_id` là `default` và callback là
`uniwork-office://auth/callback` (allowlist trong `desktop-auth-contract.md`).
Fork (`appId` `com.uniwork.office`) đăng ký, từ GO-A5 (UNI-1006), hai scheme đăng nhập bên
cạnh `uniwork://` (vẫn dùng cho `uniwork://office/app` và `uniwork://agent/intent`):
`uniwork-office://auth/callback` (`client_id` `uniwork-office`, kênh stable/beta) và
`uniwork-office-dev://auth/callback` (`client_id` `uniwork-office-dev`, kênh dev). App chỉ đăng
ký scheme của kênh đang chạy; cả hai được khai báo trong `protocols` của electron-builder.
Đăng nhập dùng đúng allowlist hiện có, server không đổi (`DESKTOP_AUTH_REDIRECT_URIS` giữ
nguyên). Callback đến qua argv khi khởi động, lần mở thứ hai trên Windows hoặc `open-url`
trên macOS (kể cả trước khi app sẵn sàng) và được chuyển cho phần đăng nhập trước bộ định
tuyến office. Địa chỉ server lấy từ `deployment-profile.json` (thư mục resources, rồi
userData; bộ cài NSIS chép file này cạnh bộ cài vào resources), sau đó mới tới
`UNIWORK_API_ORIGIN` / `uniworkApiOrigin`.

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

Quyết định nằm ở [ADR 0028](../../adr/0028-ai-phia-client-cua-uniwork-office.md) (ranh
giới client) và [ADR 0029](../../adr/0029-ai-cua-office-tren-web-qua-ai-gateway.md) (web, khóa
phía server, proxy). Hợp đồng đầy đủ của lane GO-A7 (UNI-1008); trạng thái route ghi ở
cuối mục.

- **Desktop, BYO key** (key của người dùng, Codex CLI, v.v. theo cấu hình AI của genoffice):
  **không đổi**. App gọi thẳng nhà cung cấp; lưu lượng này không đi qua UniWork, UniWork
  không thấy key, prompt hay kết quả, và không tính tín dụng.
- **Web, BYO key**: khóa lưu mã hóa phía server, trình duyệt không bao giờ giữ khóa và không
  gọi thẳng nhà cung cấp. Lệnh gọi đi qua proxy pass-through của UniWork (mục 3.2).
- **Đám mây UniWork** (tìm web, tạo ảnh, phân tích media, phiên âm, tín dụng): client chỉ gọi
  API UniWork bằng phiên đăng nhập ở mục 1 (hoặc phiên web). Server đi qua `ai.Gateway`
  (`server/internal/ai/`) và kiểm entitlement của tổ chức; app không bao giờ giữ key nhà cung
  cấp của UniWork.

Mọi route dưới `/api/v1/orgs/{orgID}/ai/...`, nằm trong nhóm `authed` (bearer web **hoặc**
bearer thiết bị desktop), đi qua `OrganizationService.RequireMember` trước (người không phải
thành viên nhận 403/404 theo `mapServiceError`, app không suy ra id có tồn tại). Lỗi theo
dạng `{ "code": ..., "message": ... }`.

### 3.1 Khóa nhà cung cấp

| Việc | Route | Ghi chú |
| --- | --- | --- |
| Liệt kê khóa + bảng nhà cung cấp | `GET /orgs/{orgID}/ai/credentials` | `{ items: [Credential], providers: [{ id, protocol, requires_base_url, default_base_url }] }` |
| Tạo / cập nhật | `PUT /orgs/{orgID}/ai/credentials/{aiProvider}` | body `{ api_key?, base_url?, label? }`; `api_key` bắt buộc khi tạo, ≤ 4096; `label` ≤ 80; **201** khi tạo, **200** khi cập nhật |
| Xóa | `DELETE /orgs/{orgID}/ai/credentials/{aiProvider}` | **204**; **404** nếu chưa có |

`PUT` giữ nguyên `base_url` / `label` đã lưu khi body **bỏ qua** trường đó; chỉ chuỗi rỗng
tường minh mới xóa (`base_url` rỗng = về endpoint mặc định). Bỏ qua `api_key` trên dòng đã có
thì giữ khóa cũ.

`Credential` = `{ provider, label, base_url, key_hint, created_at, updated_at }`. API **không
bao giờ** trả khóa; `key_hint` là "…" + 4 ký tự cuối. Chỉ `PUT` cần entitlement
`office.ai_byok`; `GET` và `DELETE` **không** bị chặn bởi entitlement (người dùng hạ plan vẫn xem và gỡ được khóa của mình). Cả `PUT` và `DELETE` ghi audit `ai.credential.saved` / `ai.credential.deleted` (payload chỉ có id +
provider) cùng transaction. Nhà cung cấp có sẵn: anthropic, openai, gemini, openrouter,
deepseek, xai, mistral, qwen, kimi, glm, doubao, hunyuan, minimax, custom; UI lấy danh sách từ
`providers`, không chép lại.

### 3.2 Proxy BYOK

Pass-through: client giữ nguyên wire format gốc của nhà cung cấp, chỉ đổi base URL sang
route dưới đây và bỏ khóa. Server chọn endpoint từ bảng cố định, gắn khóa của người dùng
(`Resolve`) và chuyển byte phản hồi nguyên vẹn (SSE vẫn là SSE).

| Giao thức | Route |
| --- | --- |
| openai-compatible | `POST /orgs/{orgID}/ai/byok/{aiProvider}/chat/completions` |
| anthropic | `POST /orgs/{orgID}/ai/byok/{aiProvider}/messages` |
| gemini | `POST /orgs/{orgID}/ai/byok/{aiProvider}/generate`, body `{ model, stream, request: <body Gemini gốc> }` |
| Danh sách model | `GET /orgs/{orgID}/ai/byok/{aiProvider}/models` (JSON của nhà cung cấp, chuyển tiếp) |

Giới hạn: body ≤ 16 MiB, phải là JSON; timeout phía server 15 s tới header (chỉ cho lệnh gọi
streaming và `GET` model), 10 phút tổng, nghỉ 60 s giữa hai chunk; ghi xuống client có hạn chót
60 s mỗi chunk. Người không phải thành viên tổ chức nhận **404**.

- **Header request chuyển tiếp (allowlist theo giao thức)**: anthropic → `anthropic-beta`;
  openai-compatible → `openai-organization`, `openai-project`, và với `openrouter` thêm
  `http-referer`, `x-title`; gemini → không. Giá trị có ký tự điều khiển hoặc > 512 byte bị
  bỏ; `authorization`, `x-api-key`, `x-goog-api-key`, `cookie` không bao giờ được chuyển, khóa
  đã lưu luôn được gắn sau cùng.
- **Phản hồi**: header chuyển tiếp chỉ `content-type`, `retry-after`. Luôn có
  `X-Content-Type-Options: nosniff` và `Content-Security-Policy: default-src 'none'; sandbox`;
  `content-type` chỉ giữ khi là `application/json`, `text/event-stream`, `text/plain`, còn lại
  thành `application/octet-stream`. Body lỗi của nhà cung cấp được thay mọi chỗ lặp lại khóa
  bằng `[redacted]`; body 2xx không bị lọc.

Không hỗ trợ `codex`, `genspark`. Nhà cung cấp `custom` cần `base_url` `https://` công khai (rào SSRF,
kiểm lại lúc dial, không theo redirect). Lệnh gọi ghi một sự kiện sử dụng (`office.byok`,
`credits=0`); proxy **không** tiêu credit UniWork. Với openai-compatible ở chế độ stream, token
chỉ được ghi khi client đặt `stream_options.include_usage` (body không bị viết lại), nếu không
dòng sử dụng ghi 0 token.

### 3.3 Công cụ đám mây UniWork

Khóa nhà cung cấp nằm ở env của server; công cụ chưa cấu hình báo `available:false` và route
trả 503.

| Việc | Route | Body → kết quả |
| --- | --- | --- |
| Trạng thái + credit | `GET /orgs/{orgID}/ai/cloud` | `{ enabled, reason?, tools: { web_search, image_search, image_generate, media_analyze, transcribe }, credits: { unit: "ai.tokens", used, limit\|null, remaining\|null, period_end\|null } }`; **không bao giờ 403**: thiếu entitlement → `enabled:false` + `reason: "entitlement_required"` |
| Tìm kiếm | `POST /orgs/{orgID}/ai/cloud/search` | `{ query ≤ 400, kind: "web"\|"image", max_results 1..10 (mặc định 6) }` → `{ results: [{ title, url, snippet, image_url?, thumbnail_url? }], answer? }` |
| Sinh ảnh | `POST /orgs/{orgID}/ai/cloud/images` | `{ prompt ≤ 4000, aspect_ratio?, image_size?, reference_images?: [{ mime, data_base64 }] (≤ 4, mỗi ảnh ≤ 8 MiB; png/jpeg/webp) }` → `{ images: [{ mime, data_base64 }], model }`; body ≤ **44 MiB** |
| Phân tích media | `POST /orgs/{orgID}/ai/cloud/media/analyze` | `{ requirements ≤ 4000, locale?, media: [{ mime, data_base64 }] (≤ 4, tổng ≤ 25 MiB) }` → `{ text }`; body ≤ 36 MiB |
| Phiên âm | `POST /orgs/{orgID}/ai/cloud/transcribe` | `{ prompt?, audio: { mime, data_base64 } (≤ 25 MiB) }` → `{ text }`; body ≤ 36 MiB |

Client gửi **byte**; server không bao giờ tự tải URL media (không có mặt SSRF). Sinh slide vẫn
ẩn, ngoài phạm vi. Tìm kiếm: body ≤ 1 MiB.

**MIME của phân tích media** (bỏ tham số như `;codecs=opus`, hạ chữ thường): `image/png`,
`image/jpeg`, `image/webp`, `image/gif`, `audio/mpeg`, `audio/wav`, `audio/mp4`, `audio/webm`,
`video/mp4`, `video/webm`, `application/pdf`. Loại khác → **422 `media_unsupported`**; loại trong
danh sách nhưng mô hình chính không đọc được cũng 422. Chuỗi MIME của client không bao giờ vào
prompt. MIME của phiên âm phải là token `type/subtype` (audio/*, video/mp4, video/webm), sai thì 400.

**Biến môi trường server**: `AI_CREDENTIAL_KEY` (base64 32 byte; trống → route khóa 503),
`AI_CLOUD_SEARCH_PROVIDER` (`tavily`\|`brave`\|`fake`) + `AI_CLOUD_SEARCH_API_KEY`,
`AI_CLOUD_IMAGE_PROVIDER` (`openai`\|`fake`) + `_API_KEY`, `_MODEL` (mặc định `gpt-image-1`),
`_BASE_URL`, `AI_CLOUD_TRANSCRIBE_PROVIDER` (`openai`\|`fake`) + `_API_KEY`, `_MODEL` (mặc định
`whisper-1`), `_BASE_URL`. Phân tích media dùng nhà cung cấp chính của Gateway.

### 3.4 Entitlement, tín dụng, lỗi, giới hạn tốc độ

- **Entitlement** (bảng `features`, fail-closed): `office.ai_byok` (`PUT` khóa + proxy; `GET`/`DELETE` khóa không bị chặn), `office.ai_cloud`
  (mọi công cụ đám mây). Cả hai bật ở các plan đã bật `ai.tokens`.
- **Tín dụng** = meter `ai.tokens`. Trước mỗi lệnh gọi đám mây: `Can(office.ai_cloud)`, rồi
  `CheckQuota`. Công cụ không có số token tính mức cố định (một bảng Go, `server/internal/ai/cloud.go`):
  tìm kiếm 500, ảnh 4000/ảnh, phiên âm 1000 mỗi phút bắt đầu (tối thiểu 1 phút); phân tích dùng
  token thật. Phiên âm tính theo thời lượng nhà cung cấp báo, nếu không báo thì ước lượng từ dung
  lượng tệp theo bitrate điển hình của định dạng (ADR 0029, Quyết định 5). Lệnh gọi lỗi không tính;
  lệnh gọi đã chạy được chốt (dòng sử dụng + meter) dù client ngắt kết nối. Số còn lại đọc từ
  `GET .../ai/cloud`.
- **Lỗi**:

| Mã HTTP | `code` | Khi |
| --- | --- | --- |
| 400 | `provider_not_supported`, `base_url_refused` | Nhà cung cấp ngoài danh sách / URL `custom` bị rào SSRF từ chối |
| 402 | `credits_exhausted` | Hết token của kỳ (client hiện "hết credit") |
| 403 | `entitlement_required` | Plan thiếu `office.ai_byok` hoặc `office.ai_cloud`; hoặc không phải thành viên |
| 404 | `credential_missing` | Chưa có khóa cho nhà cung cấp này (hoặc không thấy tổ chức; cũng khi `AI_CREDENTIAL_KEY` đã đổi và khóa cũ không giải mã được — lưu lại khóa) |
| 422 | `media_unsupported` | Loại tệp ngoài danh sách phân tích media hoặc mô hình không đọc được |
| 424 | `provider_auth_failed` | Nhà cung cấp trả 401/403 cho khóa của người dùng |
| 429 | — | Giới hạn tốc độ của UniWork hoặc 429 của nhà cung cấp (chuyển tiếp, kèm `retry-after`) |
| 502 | `provider_unreachable` | Mạng/timeout tới nhà cung cấp |
| 503 | `cloud_unavailable` | Công cụ đám mây chưa cấu hình ở server |

- **Giới hạn tốc độ** (theo bearer user và **theo nhóm route**, không theo URL; cần Redis,
  fail-open): nhóm khóa (3 route) 30/phút, nhóm proxy (4 route, mọi nhà cung cấp và tổ chức) 60/phút,
  nhóm đám mây (4 route công cụ; `GET .../ai/cloud` không tính) 20/phút. Vượt thì 429.
- **Không bao giờ lộ khóa**: không có trong phản hồi, log, audit, lỗi, trace; lỗi của nhà cung cấp được lọc
  mọi chỗ lặp lại khóa thành `[redacted]`.

### 3.5 Frame web và trạng thái triển khai

Proxy và công cụ đám mây được dựng thành tầng service để mount thêm dưới
`/office-frame/documents/{documentID}/ai/...` (chỉ bearer frame-token; tác nhân user/org lấy từ
claim). Route frame nằm trên nhánh GO-B2/B3, **chờ merge gốc GO-B2/B3**; trang host web dùng
được các route session ở trên ngay. Desktop **không đổi** ở v1: BYOK trực tiếp, chỉ dùng mục 3.3
cho công cụ đám mây.

**Giới hạn đã biết** (chi tiết ở ADR 0029): `GET`/`DELETE` khóa không bị chặn bởi entitlement;
thành viên bị gỡ/vô hiệu hóa để lại khóa trong bảng (không dùng được, chỉ `DELETE` xóa); không
xoay khóa chủ; stream openai-compatible chỉ ghi token khi có `include_usage`; body 2xx của nhà
cung cấp không lọc khóa; hạn chót header 15 s chỉ cho streaming/`GET`; phiên âm không có thời
lượng được ước lượng từ dung lượng; route frame chờ merge gốc GO-B2/B3.

Trạng thái: các route Ask UNI cũ (`router/ai.go`: `GET /workspaces/{workspaceID}/ai/capabilities`,
`.../ai/usage`, `GET /orgs/{orgID}/ai/usage`) phục vụ web và không đổi. Các route 3.1–3.3 là
hợp đồng của lane GO-A7 (UNI-1008), được xây ở `server/internal/service/ai_credentials.go` (khóa), `server/internal/ai/` + `server/internal/ai/provider` (proxy và công cụ đám mây) và `server/internal/handler/router/` (đăng ký route); phía client
TypeScript là `packages/core/api/endpoints/ai-office.ts`. Nếu một route đổi trong lúc
xây, sửa tại đây cùng thay đổi.

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
