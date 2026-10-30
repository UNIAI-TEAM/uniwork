# Hợp đồng API giữa app UniWork Office và UniWork

**Revision:** 1.2 (2026-10-29, mục 3 bỏ kho khóa và proxy BYOK theo [ADR 0051](../../adr/0051-ai-chi-chay-bang-uniwork-ai-go-byok.md), UNI-2289); 1.1 (2026-10-09, mục 3 viết lại thành hợp đồng AI thật, GO-A7)
**Issue:** GO-C3 (UNI-1020), thuộc UNI-1001
**Trạng thái:** hợp đồng bên server `dev-uniwork`. Phần đã có route được đánh dấu "có sẵn"; phần chưa xây được đánh dấu theo lane (GO-A6, GO-A7, GO-B2/B3).

Tài liệu này ghi các điểm nối giữa app desktop UniWork Office (repo fork
`UNIAI-TEAM/uniwork-office`, nền genoffice) và API của UniWork. Hướng đi nằm trong
plan genoffice `docs/superpowers/plans/2026-10-08-uniwork-office-genoffice.md`
(vào develop cùng UNI-1001; Q1: hai repo riêng, nối bằng API). Tài liệu chỉ trỏ tới
hợp đồng đã có và không chép lại; mọi đường dẫn bên dưới đã đối chiếu với
`server/internal/handler/router/`. Đường dẫn tương đối với `/api/v1`.

Nguyên tắc chung:

- App là public client, không giữ bí mật của UniWork và không giữ key nhà cung cấp AI của UniWork. UniWork không nhận, không lưu và không chuyển tiếp khóa AI của người dùng (mục 3, ADR 0051).
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

`deployment_id` là `default`. Server nhận nhiều client desktop cùng lúc (UNI-1006, PR #214):
biến `DESKTOP_AUTH_CLIENTS` (`client_id=redirect[|redirect...]`, cách nhau bởi dấu phẩy) là toàn
bộ allowlist, và một redirect chỉ hợp lệ cho đúng client khai báo nó. `deploy/app/env/uniwork-be.env`
khai báo cả `uniwork-office` (`uniwork-office://auth/callback`) và `uniwork-office-dev`
(`uniwork-office-dev://auth/callback`). Khi biến này không đặt, cặp `DESKTOP_AUTH_CLIENT_ID` +
`DESKTOP_AUTH_REDIRECT_URIS` chạy như trước (một client). Mã đổi phiên chỉ dùng được với đúng
client và redirect đã bắt đầu nó; mở app từ web nhận mọi client đã cấu hình, còn hồ sơ tải bộ
cài yêu cầu client của kênh tương ứng phải có trong allowlist. Chi tiết ở `desktop-auth-contract.md`.
Fork (`appId` `com.uniwork.office`) đăng ký, từ GO-A5 (UNI-1006), hai scheme đăng nhập bên
cạnh `uniwork://` (vẫn dùng cho `uniwork://office/app` và `uniwork://agent/intent`):
`uniwork-office://auth/callback` (`client_id` `uniwork-office`, kênh stable/beta) và
`uniwork-office-dev://auth/callback` (`client_id` `uniwork-office-dev`, kênh dev). App chỉ đăng
ký scheme của kênh đang chạy; cả hai được khai báo trong `protocols` của electron-builder.
Cả hai client phải có trong `DESKTOP_AUTH_CLIENTS` của server (xem trên). Callback đến qua argv khi khởi động, lần mở thứ hai trên Windows hoặc `open-url`
trên macOS (kể cả trước khi app sẵn sàng) và được chuyển cho phần đăng nhập trước bộ định
tuyến office. Địa chỉ server lấy từ hồ sơ triển khai trong userData. Hồ sơ đến qua liên kết mở từ web
(`<scheme>://open?ticket=…&deploymentId=…&apiOrigin=…&clientId=…&channel=…` cho tài liệu,
`<scheme>://home?deploymentId=…` không có ticket cho màn hình chính; đủ bốn giá trị hoặc không có), qua mặc định đóng gói theo kênh lúc build, hoặc do người dùng nhập ở màn hình
Kết nối UniWork / Cài đặt. Cùng `deploymentId` thì cập nhật địa chỉ không hỏi (phiên đăng nhập cũ bị bỏ, không mang sang địa chỉ mới); `deploymentId`
mới hoặc chưa có hồ sơ thì hỏi xác nhận một lần; khác kênh thì từ chối. Không còn ZIP kèm
`deployment-profile.json`.

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

Quyết định nằm ở [ADR 0051](../../adr/0051-ai-chi-chay-bang-uniwork-ai-go-byok.md) (mọi AI chỉ
chạy bằng UniWork AI), cùng phần còn đúng của [ADR 0028](../../adr/0028-ai-phia-client-cua-uniwork-office.md)
(ranh giới client) và [ADR 0029](../../adr/0029-ai-cua-office-tren-web-qua-ai-gateway.md) (công cụ
đám mây, credit). Hợp đồng đầy đủ của lane GO-A7 (UNI-1008); trạng thái route ghi ở cuối mục.

- **Desktop, khóa trên máy** (key của người dùng, Codex CLI, v.v. theo cấu hình AI của genoffice):
  còn chạy tới kế hoạch 2 của ADR 0051, rồi gỡ. App gọi thẳng nhà cung cấp; lưu lượng này không đi
  qua UniWork, UniWork không thấy key, prompt hay kết quả, và không tính tín dụng.
- **Web**: chỉ UniWork AI (mục 3.6) và công cụ đám mây (mục 3.3). Kho khóa trên UniWork và proxy
  BYOK đã gỡ (mục 3.1, 3.2).
- **Đám mây UniWork** (tìm web, tạo ảnh, phân tích media, phiên âm, tín dụng): client chỉ gọi
  API UniWork bằng phiên đăng nhập ở mục 1 (hoặc phiên web). Server đi qua `ai.Gateway`
  (`server/internal/ai/`) và kiểm entitlement của tổ chức; app không bao giờ giữ key nhà cung
  cấp của UniWork.

Mọi route dưới `/api/v1/orgs/{orgID}/ai/...`, nằm trong nhóm `authed` (bearer web **hoặc**
bearer thiết bị desktop), đi qua `OrganizationService.RequireMember` trước (người không phải
thành viên nhận 403/404 theo `mapServiceError`, app không suy ra id có tồn tại). Lỗi theo
dạng `{ "code": ..., "message": ... }`.

### 3.1 Khóa nhà cung cấp — đã gỡ

Đã gỡ ngày 2026-10-29 (ADR 0051, UNI-2289): ba route `GET /orgs/{orgID}/ai/credentials`,
`PUT` / `DELETE /orgs/{orgID}/ai/credentials/{aiProvider}`, bản mount của chúng trên token khung,
bảng `ai_provider_credentials` và entitlement `office.ai_byok`. Route trả **404** như mọi route
không tồn tại; app desktop bản cũ coi 404 ở danh sách khóa là "không có khóa tổ chức" (ADR 0034
Quyết định 7), nên nguồn "Khóa trên UniWork" biến mất mà UniWork AI và công cụ đám mây vẫn chạy.
Hợp đồng cũ: [`docs/office/g5g6g7/contracts/g6-05k-org-keys-api.md`](../g5g6g7/contracts/g6-05k-org-keys-api.md)
và lịch sử của tài liệu này.

### 3.2 Proxy BYOK — đã gỡ

Đã gỡ cùng lúc (ADR 0051): bốn route `/orgs/{orgID}/ai/byok/{aiProvider}/…` (`chat/completions`,
`messages`, `generate`, `models`) và bản mount trên token khung, nhóm rate limit `ai-credentials`
và `ai-byok`. Không có proxy pass-through nào tới nhà cung cấp do người dùng chọn. Dòng
`ai_usage_events` cũ với capability `office.byok` / `office.byok_desktop` giữ nguyên.

### 3.3 Công cụ đám mây UniWork

Khóa nhà cung cấp nằm ở env của server; công cụ chưa cấu hình báo `available:false` và route
trả 503.

| Việc | Route | Body → kết quả |
| --- | --- | --- |
| Trạng thái + credit | `GET /orgs/{orgID}/ai/cloud` | `{ enabled, reason?, tools: { web_search, image_search, image_generate, media_analyze, transcribe, chat }, credits: { unit: "ai.tokens", used, limit\|null, remaining\|null, period_end\|null }, uniwork_model }`; **không bao giờ 403**: thiếu entitlement → `enabled:false` + `reason: "entitlement_required"` |
| Tìm kiếm | `POST /orgs/{orgID}/ai/cloud/search` | `{ query ≤ 400, kind: "web"\|"image", max_results 1..10 (mặc định 6) }` → `{ results: [{ title, url, snippet, image_url?, thumbnail_url? }], answer? }` |
| Sinh ảnh | `POST /orgs/{orgID}/ai/cloud/images` | `{ prompt ≤ 4000, aspect_ratio?, image_size?, reference_images?: [{ mime, data_base64 }] (≤ 4, mỗi ảnh ≤ 8 MiB; png/jpeg/webp) }` → `{ images: [{ mime, data_base64 }], model }`; body ≤ **44 MiB** |
| Phân tích media | `POST /orgs/{orgID}/ai/cloud/media/analyze` | `{ requirements ≤ 4000, locale?, media: [{ mime, data_base64 }] (≤ 4, tổng ≤ 25 MiB) }` → `{ text }`; body ≤ 36 MiB |
| Phiên âm | `POST /orgs/{orgID}/ai/cloud/transcribe` | `{ prompt?, audio: { mime, data_base64 } (≤ 25 MiB) }` → `{ text }`; body ≤ 36 MiB |

**`uniwork_model`** (G6-05m, UNI-1632): mô hình Gateway phục vụ cho UniWork AI trong Office —
`ResolveModel(office_uniwork_ai, <nhà cung cấp của Gateway>, env, allowlist)`, một override
`AI_MODEL_OFFICE_UNIWORK_AI` nằm trong allowlist thắng mặc định của policy, ngoài allowlist thì giữ
mặc định. `""` khi máy chủ chưa cấu hình nhà cung cấp AI hoặc UniWork AI đang tắt cho người gọi
(cùng điều kiện với `tools.chat`). Client đọc hàng UniWork AI: có giá trị → hiện tên "UniWork AI" +
tên mô hình; `""` hoặc máy chủ cũ không gửi trường → chỉ hiện nhãn "UniWork AI". Cùng trường này có ở
`GET /office-frame/documents/{documentID}/ai/cloud` (cùng SDO).

Client gửi **byte**; server không bao giờ tự tải URL media (không có mặt SSRF). Sinh slide vẫn
ẩn, ngoài phạm vi. Tìm kiếm: body ≤ 1 MiB.

**MIME của phân tích media** (bỏ tham số như `;codecs=opus`, hạ chữ thường): `image/png`,
`image/jpeg`, `image/webp`, `image/gif`, `audio/mpeg`, `audio/wav`, `audio/mp4`, `audio/webm`,
`video/mp4`, `video/webm`, `application/pdf`. Loại khác → **422 `media_unsupported`**; loại trong
danh sách nhưng mô hình chính không đọc được cũng 422. Chuỗi MIME của client không bao giờ vào
prompt. MIME của phiên âm phải là token `type/subtype` (audio/*, video/mp4, video/webm), sai thì 400.

**Biến môi trường server**: `AI_CLOUD_SEARCH_PROVIDER` (`tavily`\|`brave`\|`fake`) + `AI_CLOUD_SEARCH_API_KEY`,
`AI_CLOUD_IMAGE_PROVIDER` (`openai`\|`fake`) + `_API_KEY`, `_MODEL` (mặc định `gpt-image-1`),
`_BASE_URL`, `AI_CLOUD_TRANSCRIBE_PROVIDER` (`openai`\|`fake`) + `_API_KEY`, `_MODEL` (mặc định
`whisper-1`), `_BASE_URL`. Phân tích media dùng nhà cung cấp chính của Gateway.

### 3.4 Entitlement, tín dụng, lỗi, giới hạn tốc độ

- **Entitlement** (bảng `features`, fail-closed): `office.ai_cloud` (mọi công cụ đám mây và UniWork
  AI), bật ở các plan đã bật `ai.tokens`. `office.ai_byok` đã gỡ (ADR 0051).
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
| 402 | `credits_exhausted` | Hết token của kỳ (client hiện "hết credit") |
| 403 | `entitlement_required` | Plan thiếu `office.ai_cloud` (không phải thành viên: 403/404 theo `mapServiceError`) |
| 422 | `media_unsupported` | Loại tệp ngoài danh sách phân tích media hoặc mô hình không đọc được |
| 429 | — | Giới hạn tốc độ của UniWork hoặc 429 của nhà cung cấp (chuyển tiếp, kèm `retry-after`) |
| 502 | `provider_unreachable` | Mạng/timeout tới nhà cung cấp |
| 503 | `cloud_unavailable` | Công cụ đám mây chưa cấu hình ở server |

- **Giới hạn tốc độ** (theo bearer user và **theo nhóm route**, không theo URL; cần Redis,
  fail-open): nhóm đám mây (4 route công cụ; `GET .../ai/cloud` không tính) 20/phút. Vượt thì 429.
  Hai nhóm khóa và proxy đã gỡ cùng route của chúng (ADR 0051).
- **Không bao giờ lộ khóa** nhà cung cấp của UniWork: không có trong phản hồi, log, audit, lỗi, trace.

### 3.5 Frame web và trạng thái triển khai

Handler của công cụ đám mây là **mountable**: `handler.AIMountable` / `handler.NewAIMountable(deps, resolve)`
(`server/internal/handler/ai_mount.go`) trả về bộ handler cho một `AIActorResolver`
(`func(*http.Request) (userID, orgID string, err error)`), không đọc gì khác ngoài tác nhân từ
request. Route session ở trên dùng resolver mặc định (user
trong context + `{orgID}` trên path). Việc mount dưới `/office-frame/documents/{documentID}/ai/...`
(chỉ bearer frame-token; user/org lấy từ claim và tài liệu) **do lane web modules (B4/5/6,
UNI-1014) thực hiện** sau khi merge lane này, bằng resolver đọc claim frame-token; lane GO-A7
không phụ thuộc middleware frame của GO-B2/B3. Rate limit và xác thực nằm ở nhóm route mount.
**Đã mount (UNI-1014, 2026-10-09):** năm route đám mây dưới `/office-frame/documents/{documentID}/ai/...`
(ba route khóa và bốn route BYOK mount cùng đợt đã gỡ theo ADR 0051); quyền xem tài liệu kiểm lại
mỗi request, cùng bucket rate limit với route session, token frame mang grant AI cho host
(`uniwork_ai` và ba công cụ đám mây, không còn trường `ai`). Chi tiết: `docs/office/office-web-modules.md`
mục "AI in the frame".
Trang host web dùng được các route session ở trên ngay. Desktop: khóa trên máy tới kế hoạch 2 của
ADR 0051, mục 3.3 cho công cụ đám mây, mục 3.6 cho UniWork AI.

**Giới hạn đã biết** (chi tiết ở ADR 0029, phần công cụ đám mây): phiên âm không có thời lượng được
ước lượng từ dung lượng; route frame đã mount bởi lane web modules (mục này). Các giới hạn của kho
khóa và proxy hết đối tượng cùng chúng (ADR 0051).

Trạng thái: các route Ask UNI cũ (`router/ai.go`: `GET /workspaces/{workspaceID}/ai/capabilities`,
`.../ai/usage`, `GET /orgs/{orgID}/ai/usage`) phục vụ web và không đổi. Các route 3.3 (3.1 và 3.2 đã gỡ) là
hợp đồng của lane GO-A7 (UNI-1008); phần còn lại (mục 3.3) được xây ở `server/internal/service/ai_cloud.go`, `server/internal/ai/` + `server/internal/ai/provider` (công cụ đám mây) và `server/internal/handler/router/` (đăng ký route); phía client
TypeScript là `packages/core/api/endpoints/ai-office.ts`. Nếu một route đổi trong lúc
xây, sửa tại đây cùng thay đổi.

### 3.6 UniWork AI (G6-03a, UNI-1367)

Façade openai-compatible của UniWork AI: một lượt agent mỗi request, hội thoại do **server** giữ
(client chỉ gửi câu hỏi mới, hoặc kết quả công cụ của tool call server vừa phát; không bao giờ gửi
lịch sử hay lượt assistant của mình).

| Việc | Route | Danh tính | Ghi chú |
| --- | --- | --- | --- |
| Chat, tổ chức | `POST /orgs/{orgID}/ai/uniwork/chat/completions` | bearer phiên (web hoặc thiết bị desktop) | Tệp cục bộ (S10): `module` đi trong body; hội thoại buộc (user, org, module) |
| Chat, tài liệu (desktop) | `POST /documents/{documentID}/ai/uniwork/chat/completions` | bearer thiết bị desktop | Tổ chức, workspace và module suy từ **tài liệu**; `module` trong body bị bỏ qua; quyền đọc kiểm lại mỗi request (mất quyền → dọn hội thoại của người đó cho tài liệu) |
| Chat, tài liệu (frame web) | `POST /office-frame/documents/{documentID}/ai/uniwork/chat/completions` | bearer frame-token | Module lấy từ **claim của token**; `module` trong body bị bỏ qua |

Body (openai-compatible): `{ model?, messages, tools?, stream?, module? }` — `model`, `temperature`,
`max_tokens`, `tool_choice` bị bỏ qua (policy của server quyết; mô hình Gateway thật đang phục vụ
là `uniwork_model` của `GET /orgs/{orgID}/ai/cloud`, §3.3, G6-05m). `messages` là **một lượt**: câu hỏi
mới (role `user`, đúng 1, message cuối) hoặc kết quả công cụ (role `tool` + `tool_call_id` do server
cấp); lượt `assistant` của client bị bỏ qua, role `system`/`developer` → 400. Body ≤ **1 MiB**.

Kết quả: `stream:false` → `chat.completion`; `stream:true` → `text/event-stream` gồm **một**
`chat.completion.chunk` rồi `data: [DONE]`. Header 200 chỉ gửi sau khi Gateway đã có câu trả lời
upstream; mọi lỗi là HTTP status thật + `{code, message}` (không bao giờ 200 rỗng). Header
`X-UniWork-AI-Conversation` có ở mọi câu trả lời (kể cả lỗi, khi server biết id) và client gửi lại để
tiếp tục; `X-UniWork-AI-Run` là G6-03b. `x_uniwork = { dropped_tool_calls: [{index, name, reason:
view_only|not_allowlisted}], step, limit }`; call bị bỏ **không bao giờ** có trong `tool_calls` và
`finish_reason` giữ chuẩn (`tool_calls` khi còn call hợp lệ, ngược lại `stop`).

- **Hội thoại**: transcript lưu ở Postgres, mã hóa AES-256-GCM, TTL nhàn rỗi 30 phút / tuyệt đối 24 h
  / ≤ 20 lượt người dùng. Không gửi header = **bắt đầu hội thoại mới** cho cùng khóa (hội thoại sống
  cũ bị thay trong cùng transaction); id đã dọn, hết hạn hoặc khác scope → 409
  `conversation_expired` (client bắt đầu hội thoại mới). Khóa hội thoại gồm **module**, nên trên route
  tổ chức client phải gửi `module` ở **mọi** lượt của cùng hội thoại.
- **Cổng**: `RequireMember` → `office.ai_cloud` (403 `entitlement_required`) → kill switch
  `office_ai_uniwork` và cờ định dạng `office_ai_uniwork_<token>` (403 `office_capability_off`,
  `fields.capability = "ai_uniwork"` hoặc `"ai_uniwork_<token>"`, token ∈
  `{docx,xlsx,pptx,pdf,markdown,html}`; không suy được định dạng thì chỉ kiểm kill switch) →
  `CheckQuota` (`ai.tokens`) → trần đồng thời. Thiếu `AI_CONVERSATION_KEY` hoặc Gateway tắt → 503
  `ai_disabled` (fail closed).
- **Trần đồng thời** (G7-D1 giữ số cuối): 8 lượt mỗi tổ chức và 64 toàn hệ thống khi có Redis (lease
  có hạn ≈ 65 s, fail-open khi Redis lỗi), 32 lượt mỗi pod luôn áp; vượt → 429 `ai_uniwork_busy` +
  `Retry-After: 5`. Ba route **miễn `LoadShed` theo mẫu route** (một lượt có thể chờ model tới 55 s;
  một tiền tố sẽ miễn luôn các route cloud), nhánh miễn vẫn đặt body deadline.
- **Hạn và trần dữ liệu**: hạn **55 s** tính từ lúc request tới, phủ cả phần trước upstream → quá hạn
  504 `ai_provider_timeout` (không tự chạy lại). Tool result > 64 KiB/lần hoặc > 256 KiB/request → 413
  `ai_tool_result_too_large`; body > 1 MiB → 413 `payload_too_large`.
- **Upstream 429**: 429 `ai_rate_limited` + `Retry-After` (giá trị nhà cung cấp, kẹp 300; thiếu → 30).

Trạng thái: G6-03a (UNI-1367) — code ở `server/internal/ai/openai_facade.go` (dịch wire + allowlist),
`server/internal/service/ai_uniwork.go` (cổng + hội thoại + trần đồng thời),
`server/internal/handler/ai_uniwork.go` + `server/internal/handler/router/ai_uniwork.go` (route). Lượt
chạy/usage (run id, trần lượt, nhóm rate limit `ai-uniwork`, 402 `credits_exhausted`) là **G6-03b**
(§3.7); grant/trạng thái theo định dạng ở `GET /orgs/{orgID}/ai/cloud` và
`GET /orgs/{orgID}/office/capabilities` là **G6-03c**/**X-03**; adapter fork là **G6-05**.

### 3.7 Lượt chạy: run id, trần lượt, rate limit (G6-03b, UNI-1370)

Một **run** là một chuỗi lượt liên tiếp của cùng một câu hỏi: lượt câu hỏi mở run, mỗi vòng
tool-result tiếp nối nó. Run do **server** cấp và đếm; client chỉ chuyển tiếp id.

| Chiều | Giá trị | Ai đọc |
| --- | --- | --- |
| Response | `X-UniWork-AI-Run: <ULID>` trên **mọi** câu trả lời của run, kể cả câu trả lời lỗi khi run đã tồn tại | Client (G6-05) |
| Request | header `X-UniWork-AI-Run` trên mọi lượt tiếp theo của run (tool-result, retry sau 429, câu hỏi tiếp) | Service |

- **Mở run**: client **không** gửi header run ⇒ server tạo run mới sau khi qua hết cổng cục bộ, ngay
  trước lượt gọi model (run mở ra là đã tiêu 1 lượt). **Tiếp run**: client gửi header và run còn sống,
  thuộc đúng hội thoại ⇒ run tiếp tục (câu hỏi hay tool-result đều được). "Hỏi tiếp" thành run mới là do
  client **bỏ header** khi mở lượt agent mới — ranh giới run do client quyết, transcript vẫn của hội thoại
  nên run sau thấy lượt trước.
- **Không có lượt tool-result thiếu header run**: lượt đó là 400 `invalid_request` (nhận nó như run mới
  sẽ mở đường lách trần 8 vòng). Run id không thuộc — lạ, đã hết hạn, của hội thoại khác, của tổ chức
  khác — là 409 `run_expired`: client bỏ id và hỏi lại như run mới, hội thoại vẫn sống (khác
  `conversation_expired`). Mã này đã có hàng ở contract-p0 §4 (G6-D1 lô #2 đã ký 2026-10-13).
- **Trần 8 vòng / 10 lượt** (attempt-based: chỉ lượt đã tới Gateway mới đếm; lượt bị limiter, trần đồng
  thời, 402 credits, 400/403/404/409 từ chối trước đó không đếm): vượt → **409 `run_limit_reached` +
  `fields.limit = "model_calls" | "tool_rounds"`** (không `Retry-After`). Trần áp trước lượt gọi model
  và sau limiter, nên lượt bị trần không giữ slot đồng thời và không ghi usage. `run_limit_reached` kết
  thúc run về phía client; lượt kế của người dùng mở run mới (bỏ header) trong cùng hội thoại.
- **Hết tín dụng**: `CheckQuota` (`ai.tokens`) chạy trước hội thoại và trước trần ⇒ **402
  `credits_exhausted`** (`fields.meter = "ai.tokens"`), **không** gọi model, **không** có dòng usage,
  **không** tiêu lượt (cùng hình dạng với route cloud §3.3).
- **Rate limit**: ba route UniWork AI dùng **một** nhóm `ai-uniwork`, **60 lượt/phút mỗi người** (không
  theo id tổ chức/tài liệu), trả 429 **`ai_rate_limited`** + `Retry-After: 60` — khác `rate_limited` của
  mọi nhóm khác. Một run đủ trần là tối đa 11 request (1 câu hỏi + 8 vòng + retry) nên **không bao giờ**
  chạm nhóm. Limiter toàn cục 300/phút nay khóa theo **danh tính frame token** `(người dùng, tài liệu)`
  thay vì địa chỉ IP: một tòa nhà sau NAT không còn chia chung ngân sách của mọi frame.
- **`x_uniwork.step/limit`** (BE3A-11): `step` = `tool_rounds` của run **sau** lượt này (0 ở lượt câu hỏi
  đầu), `limit` = 8; hai trường **luôn có mặt** (giá trị 0 vẫn phát) trong cả `chat.completion` lẫn chunk
  SSE. Lượt lỗi không có `x_uniwork`; client đọc `step` từ lượt thành công gần nhất.
- **Header run trên lượt bị từ chối trước khi run tồn tại** (402/403/404, 409 `conversation_expired`, 429
  của limiter — limiter chạy trước handler): **không** có header run; client giữ id đang có (Q6).
- **TTL của run** bằng vòng sống của hội thoại (30 phút nhàn rỗi / 24 h tuyệt đối; `expires_at` của run
  ≤ của hội thoại), dọn trong cùng vòng quét của hội thoại (run hết hạn, run mồ côi). Mỗi lượt gọi model
  có khoá meter riêng theo `(run id, seq)` nên retry không bị tính hai lần; provider không trả usage ⇒
  dòng usage `usage_unknown` + metric, được đối soát (ước lượng từ transcript) đúng một lần.

### 3.8 Route viết một lần (UNI-2276, ADR 0050)

Lời gọi "viết một lần" của trình soạn (Word, Markdown, HTML, slide) dưới UniWork AI, **chỉ trên frame web**:

| Việc | Route | Danh tính |
| --- | --- | --- |
| Viết một lần, tài liệu (frame web) | `POST /office-frame/documents/{documentID}/ai/uniwork/write` | bearer frame-token; module lấy từ **claim của token** |

Không có bản desktop (desktop vẫn từ chối mọi `purpose`, spec Office §7.1) và không có bản theo tổ chức.

Body: `{ kind, lang?, input }`, tối đa 1 MiB. Client **không** gửi system prompt; prompt do server giữ và mọi chữ trong
`input` vào model dưới dạng không tin cậy.

- `kind` (đóng): `docs.write_document`, `markdown.write_document`, `html.page`, `html.brief`, `slides.deck_style`,
  `slides.deck_outline`, `slides.page`. Kind của module khác với module của token → 400.
- `lang`: `vi` (mặc định) hoặc `en`.
- `input`: các trường của kind (bảng và trần theo trường ở `server/internal/ai/prompts_office_writer.go`, `writerFields`):
  trường lạ, thiếu trường bắt buộc hoặc sai kiểu → 400 `invalid_request`; trường vượt trần → 413 `payload_too_large`,
  không gọi model.

Header: client **phải** gửi `X-UniWork-AI-Conversation` và `X-UniWork-AI-Run` của lượt đang chạy (§3.6, §3.7). Lời gọi viết không bao
giờ mở run: thiếu một trong hai → 400 `invalid_request`; run lạ, hết hạn hoặc của hội thoại khác → 409 `run_expired`;
hội thoại hết hạn → 409 `conversation_expired`. Lời gọi tính **một lượt model** của run và luôn chừa lượt cuối cho vòng công cụ:
run đã dùng 9 lượt → 409 `run_limit_reached` (`fields.limit = "model_calls"`), trước byte đầu, không ghi usage. Không ghi
vào transcript; hạn một lời gọi 300 giây.

Kết quả: `text/event-stream`, một `chat.completion.chunk` cho mỗi đoạn chữ (cùng một `id` cho cả luồng), chunk cuối có
`finish_reason` (`length` khi chạm trần token của kind, ngược lại `stop`) và `usage`, rồi `data: [DONE]`. Mỗi lần ghi có hạn 60
giây; response gửi `X-Accel-Buffering: no`. Header 200 chỉ gửi cùng đoạn đầu: **lỗi trước đoạn đầu** là HTTP status thật + `{code, message}` như §3.6:
400 `invalid_request`, 402 `credits_exhausted`, 403 `forbidden` (khung chỉ xem) / `entitlement_required` / `office_capability_off`,
404, 409 `conversation_expired` / `run_expired` / `run_limit_reached`, 413 `payload_too_large`, 422 `ai_refused`, 429 `ai_uniwork_busy` /
`ai_rate_limited`, 502 `ai_provider_error`, 503 `ai_disabled`, 504 `ai_provider_timeout`, 408 `ai_cancelled`. **Lỗi sau khi đã có chữ** kết thúc luồng bằng
một chunk `{"x_uniwork":{"terminal":{"code":"<code>"}}}` (không có `step`/`limit`, `choices` rỗng) rồi `[DONE]`, với `code` ∈
`ai_provider_error`, `ai_provider_timeout`, `ai_cancelled`, `ai_refused` (model từ chối sau khi đã viết); client coi lần viết đó là **dở dang**.

Cổng và đếm như route chat (§3.6): quyền sửa tài liệu, `RequireMember`, gói `office.ai_cloud`, cờ `office_ai_uniwork`
và cờ định dạng, `CheckQuota` (`ai.tokens`), trần đồng thời riêng của route viết, nhóm rate limit `ai-uniwork` dùng chung; miễn
`LoadShed` theo mẫu route. Usage ghi dưới capability `office_uniwork_writer` với `prompt_id` nêu kind. Lỗi nhà cung cấp giữa
stream không tính phí; hết hạn hoặc hủy sau khi đã có chữ thì Gateway tính phần đã nhận một lần và credit của run tăng bằng số đó;
model từ chối sau khi đã viết thì Gateway tính đủ phí, credit của run không tăng.

## 4. Bản cài (GO-A8, UNI-1009)

Server chỉ phát link, không lưu bản cài. Biến môi trường (đều có trong
`.env.example` và `server/internal/config/config.go`; rỗng nghĩa là kênh không có, không
thay bằng kênh khác):

| Biến | Vai trò |
| --- | --- |
| `OFFICE_INSTALLER_DEV_URL`, `OFFICE_INSTALLER_BETA_URL`, `OFFICE_INSTALLER_STABLE_URL` | Một link mỗi kênh; chỉ còn để tương thích, ánh xạ sang `win32-x64`, bỏ sau 2026-11-02 |
| `OFFICE_INSTALLER_DEV_URLS`, `OFFICE_INSTALLER_BETA_URLS`, `OFFICE_INSTALLER_STABLE_URLS` | JSON `{platform: url}` theo kênh; chỉ nhận HTTPS (hoặc HTTP loopback khi dev) và đuôi file đúng nền tảng |

Endpoint phục vụ: `GET /office/desktop/download` (`router/config.go`), yêu cầu thành
viên tổ chức, trả `installers` và `supported_platforms` đúng kênh; `platform=<key>` (lượt bấm tải, có
audit) chỉ trả bộ cài đó, rồi trình duyệt tự tải tệp từ máy chủ phát hành, không qua UniWork. CI của fork đăng bản lên các URL đó (GO-A8). Ký số
nằm trong backlog chứng chỉ, không chặn.

## 5. Khung Docs trên web (GO-B2, GO-B3)

Chỉ là con trỏ: hợp đồng nạp bundle renderer genoffice (version, CSP, cầu nối chỉ
chạm file qua token FileService đúng workspace) là **GO-B2 (UNI-1012)**, và trang mở
tài liệu docx dùng renderer đó là **GO-B3 (UNI-1013)**. Trên develop hiện chưa có
route hay trang web nào cho khung này: chỉ có component `OfficeFrame` trong
`packages/views/office/frame/` (editor G3 cũ). Các route/đường dẫn mới sẽ được
ghi vào mục này khi hai lane đó đăng ký chúng.

## 6. Capability theo tổ chức (X-03, UNI-1340)

App desktop đọc danh sách tính năng Office đang bật cho một tổ chức trước khi dùng
feed, Lưu, thư viện offline hay UniWork AI. Đây là route **chỉ app**; web không dùng
(web đọc `office_sync_feed` qua `GET /api/v1/config`, xem EXPERIENCE › Foundation ›
Grant và flag). Không nhầm với `GET /documents/{documentID}/office/capabilities`
(`OfficeCapabilitySDO`), route theo **một tài liệu** trả định dạng/thao tác của engine.

| Việc | Route |
| --- | --- |
| Capability theo tổ chức | `GET /orgs/{orgID}/office/capabilities` |

- **Auth:** phiên thiết bị bearer (`RequireAuthWithDevice`, cùng nhóm `authed` như mục 3);
  không có nhóm route riêng cho app. `orgID` là ULID tổ chức.
- **Quyền:** chỉ `OrganizationService.RequireMember`; người không phải thành viên nhận
  **403/404** theo `mapServiceError`, tài khoản bị vô hiệu hóa / tổ chức bị đình chỉ theo
  cổng sẵn có. Handler không tự quyết quyền. Đây là **read**: không ghi audit.
- **Đánh giá flag:** cùng bộ đánh giá và thứ tự override **user > organization > global**
  mà `GET /api/v1/config` dùng. Flag chỉ **ẩn năng lực**, không cấp quyền.
- **Hình dạng:**
  `{sync_feed, sync_write, offline_library, ai_uniwork, ai_uniwork_formats[], ttl_seconds}`.
  `ai_uniwork_formats` liệt kê các định dạng có `office_ai_uniwork_<format>` bật **và**
  `office_ai_uniwork` bật (tắt kill switch thì danh sách rỗng).
- **`ttl_seconds`:** hằng số **300**. Cách app lưu và dùng bản này (TTL, lỗi, "chưa từng
  đọc được") là luật của [EXPERIENCE › State Patterns › Capability tắt](../g5g6g7/ux/EXPERIENCE.md)
  (nguồn duy nhất; không chép lại ở đây).
- **Mã lỗi:** route feed/intent/lease/AI về sau **tự từ chối bằng `office_capability_off`
  (403, `fields.capability`)** khi flag tắt — server là nguồn thật, client cũ vẫn bị chặn.
  Bốn mã mới của phase đăng ký **không lớp** `error_class` (contract-p0 §4):
  `change_cursor_expired` (410), `change_cursor_invalid` (400), `run_limit_reached` (409),
  `office_capability_off` (403). Tên `commit_intent_unknown` (410) **mới chỉ được giữ chỗ
  trong tài liệu, chưa phát** cho tới khi G5-D2 chốt retention intent.
