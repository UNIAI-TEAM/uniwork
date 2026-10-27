# UniWork — Gỡ BYOK khỏi cả sản phẩm: mọi AI chỉ chạy bằng UniWork AI

> **Trạng thái:** in-progress — bản thiết kế v2 (2026-10-27): **chuyển thẳng**, một lần, không cờ cuốn chiếu, không
> thông báo khách, không giai đoạn giữ khóa; gỡ cả khóa trên máy của app desktop (Q-B1 = (a)); chưa có issue UniAI;
> chưa có mã. Không còn câu chờ chủ sản phẩm.

**Nguồn quyết định:**

- Chủ sản phẩm ngày 2026-10-27, câu Q6 và Q10 trong `docs/superpowers/specs/2026-10-27-ask-uni-office-design.md` §5
  (spec đó đang ở worktree `ask-uni-docs-assessment`, chưa vào `develop`): "Mọi AI chạy bằng UniWork AI, không khóa
  ngoài" và "Q6 áp cho cả sản phẩm: gỡ BYOK khỏi trình soạn web (ADR 0029) và app desktop (ADR 0034), làm thành dự án
  riêng sau tính năng này, và chỉ gỡ sau khi G6-D2 đóng."
- Chủ sản phẩm, cùng ngày, sau khi đọc bản v1 của spec này: "Vì ứng dụng của tôi vẫn chỉ đang phát triển nên không cần
  khắt khe lắm, cứ chuyển đổi thẳng thôi." Bản v1 (6 pha, cờ theo từng tổ chức, thông báo khách, giữ khóa 14 ngày) bị
  thay bằng kế hoạch chuyển thẳng ở §5.
- Chủ sản phẩm, cùng ngày, trả lời Q-B1: "Gỡ cả khóa lưu trên máy và CLI cục bộ của app desktop (Q-B1 = a)."

**Số dòng:** repo này theo `develop` tại `0a454a4d9`. Fork `UNIAI-TEAM/uniwork-office` theo `main` tại `62c3a29`
(2026-10-27); web đang pin `59defc1` (`apps/web/platform/office-frame/*.pin.json`). Các file BYOK của fork giống hệt
nhau ở hai commit, nên số dòng đúng cho cả hai.

---

## 0. Tóm tắt (đọc trong một phút)

- **BYOK** = "dùng khóa AI của riêng mình": người dùng tự trả tiền cho nhà cung cấp (OpenAI, Anthropic, Gemini…).
  Hôm nay BYOK chỉ có trong **trình soạn Office**, theo ba đường (§2). Hỏi UNI và agent họp đã chạy bằng UniWork AI.
- Sau dự án này: Office trên web và app desktop **chỉ còn UniWork AI**, tính vào credit `ai.tokens` của gói tổ chức.
  Kho khóa trên máy chủ bị xóa, khóa chủ `AI_CREDENTIAL_KEY` bị hủy.
- **Chuyển thẳng.** App còn đang phát triển, chưa có khách dùng thật, nên gỡ hết trong **hai PR** (fork rồi repo này),
  lên cùng một lần deploy: không cờ cuốn chiếu, không thông báo khách, không giai đoạn giữ khóa (§5).
- **G6-D2 không còn chặn việc gỡ BYOK**: nó chỉ chặn dữ liệu thật, mà chưa có dữ liệu thật. G6-D2 vẫn phải đóng trước khi
  có người dùng thật, vì lúc đó UniWork AI là đường AI duy nhất (§4).
- Vẫn làm **sau** dự án "Hỏi UNI soạn tệp Office" như Q10, vì dự án đó đưa `write_document`, `generate_deck`,
  `regenerate_slide` lên UniWork AI; gỡ sớm hơn thì các thao tác đó tạm không chạy (§4).
- Có một bẫy kỹ thuật: hôm nay máy chủ chỉ cấp **công cụ đám mây** cho khung web (tìm web, tìm ảnh, sinh ảnh) khi BYOK
  bật (`server/internal/handler/office_frame_ai.go:60-72`). Sửa ngay trong PR gỡ, nếu không mất luôn các công cụ đó.
- Gỡ cả **khóa trên máy và CLI cục bộ** của app desktop (đường không đi qua UniWork, ADR 0028 QĐ2): chủ sản phẩm chọn
  Q-B1 = (a). App desktop chỉ còn UniWork AI và công cụ đám mây của UniWork.

## 1. Ý định, mục tiêu, không làm, chống mục tiêu

**Ý định.** Một đường AI duy nhất cho cả sản phẩm: UniWork chọn và chịu trách nhiệm về model, vùng dữ liệu, thời gian
giữ log (G6-D2), đo đếm và tính tiền theo gói. Không còn bí mật nhà cung cấp của khách nằm trên máy chủ UniWork.

**Mục tiêu**

1. Không còn route, service, bảng hay UI nào nhận, lưu, giải mã hoặc dùng khóa nhà cung cấp của người dùng.
2. Mọi lượt AI trong trình soạn (web và desktop) đi qua UniWork AI (`ai.Gateway`, façade
   `server/internal/ai/openai_facade.go`), dưới cổng `office.ai_cloud` + `ai.tokens`.
3. Một lần chuyển: không cờ tắt/bật BYOK, không mã chuyển tiếp nằm lại sau dự án.
4. Dữ liệu khóa đã lưu bị xóa hẳn (bảng và khóa chủ) trong cùng lần deploy.

**Không làm trong dự án này**

- Thay đổi Hỏi UNI, agent họp, hay façade UniWork AI ngoài những gì cần để thay chỗ BYOK.
- Chọn nhà cung cấp production cho UniWork AI. Đó là G6-D2, thuộc chủ sản phẩm.
- Bộ chọn model cho người dùng UniWork AI (hôm nay không có; spec quản lý gói AI 2026-10-18 dòng 23).
- Khóa dùng chung toàn tổ chức do quản trị đặt (hướng mở rộng (b) của ADR 0034): bỏ hẳn, không làm.

**Chống mục tiêu** — xảy ra là hỏng, dù chạy được:

- Gỡ BYOK khi đã có tổ chức thật dùng khóa riêng trên production (kiểm ở §4, C2).
- Trình soạn không còn AI nào ở môi trường dev/staging vì cờ `office_ai_uniwork` hay cờ định dạng còn tắt ở đó.
- Công cụ đám mây biến mất cùng BYOK.
- Khóa đã lưu còn đọc được ở đâu đó (bảng, bản sao lưu còn khóa chủ, log) sau khi deploy.
- Mã BYOK chết nằm lại (route, bảng, hook không ai gọi, nửa `byok` của harness).

## 2. Hiện trạng: ba đường khóa riêng

| Đường | Quyết định | Khóa nằm ở đâu | Đi qua máy chủ UniWork? | UniWork biết ai dùng? |
| --- | --- | --- | --- | --- |
| A. Office trên web (khung genoffice) | ADR 0029 | Bảng `ai_provider_credentials`, mã hóa bằng `AI_CREDENTIAL_KEY` | Có: proxy pass-through `ai.Gateway.Proxy` | Có: dòng khóa + dòng `ai_usage_events` capability `office.byok` |
| B. App desktop đã đăng nhập, dùng khóa lưu trên UniWork | ADR 0034 | Cùng bảng trên; app không bao giờ nhận khóa | Có: cùng route proxy, token phiên thiết bị | Có: `ai_usage_events` capability `office.byok_desktop` |
| C. App desktop, khóa trên máy hoặc CLI cục bộ | ADR 0028 QĐ2 | `ai-settings.json` trên máy người dùng | **Không**: app gọi thẳng nhà cung cấp | **Không**: UniWork không thấy, không đo |

Ghi chú: task gốc chỉ nêu ADR 0029 và 0034 (đường A, B). Đường C cũng là "khóa ngoài": Q6 nói "không khóa ngoài" và
Q10 nói "cả sản phẩm". Chủ sản phẩm chọn gỡ cả đường C (Q-B1 = (a), §12).

Nơi người dùng **nhập khóa** chỉ nằm trong khung genoffice (fork) và trong app desktop. Trang host web của repo này không
có màn nhập khóa: các hook `useAiCredentials` / `useSaveAiCredential` / `useDeleteAiCredential` không có nơi nào dùng
(§3.4).

Tổ chức có `office.ai_byok` thì cũng có `office.ai_cloud`: cả hai được seed cùng lúc cho mọi gói có `ai.tokens`
(`server/migrations/9991791524388002_office_ai_features.up.sql:11-16`). Nghĩa là về gói, khách BYOK đã có quyền dùng
UniWork AI; cái thiếu là cờ `office_ai_uniwork` (G6-D2) và credit.

## 3. Mọi bề mặt BYOK

Ký hiệu cột "Xử lý": **Xóa** = gỡ hẳn; **Sửa** = bỏ phần BYOK, giữ phần còn lại; **Giữ** = dùng chung với UniWork AI
hoặc là lịch sử, không được xóa.

### 3.1 Server — route

| Route | Đăng ký | Handler |
| --- | --- | --- |
| `GET /api/v1/orgs/{orgID}/ai/credentials` | `server/internal/handler/router/ai_credentials.go:20` | `server/internal/handler/ai_credentials.go:41` (`listAICredentials`) |
| `PUT /api/v1/orgs/{orgID}/ai/credentials/{aiProvider}` | `server/internal/handler/router/ai_credentials.go:27` | `server/internal/handler/ai_credentials.go:87` |
| `DELETE /api/v1/orgs/{orgID}/ai/credentials/{aiProvider}` | `server/internal/handler/router/ai_credentials.go:35` | `server/internal/handler/ai_credentials.go:116` |
| `POST /api/v1/orgs/{orgID}/ai/byok/{aiProvider}/chat/completions` · `/messages` · `/generate` | `server/internal/handler/router/ai_byok.go:22,30,38` | `server/internal/handler/ai_byok.go:23` (`byokProxy`) |
| `GET /api/v1/orgs/{orgID}/ai/byok/{aiProvider}/models` | `server/internal/handler/router/ai_byok.go:46` | như trên |
| `GET` · `PUT` · `DELETE /api/v1/office-frame/documents/{documentID}/ai/credentials[/{aiProvider}]` | `server/internal/handler/router/office_frame_ai.go:57,62,67` | mount qua `frameAIActor` (`server/internal/handler/office_frame_ai.go:26`) |
| `POST /api/v1/office-frame/documents/{documentID}/ai/byok/{aiProvider}/chat/completions` · `/messages` · `/generate`, `GET .../models` | `server/internal/handler/router/office_frame_ai.go:74,79,84,89` | như trên |

Nối route: `registerAICredentials` (`server/internal/handler/router/router.go:349`), `registerAIBYOK`
(`router.go:270`), bucket frame `credentials`/`byok` (`router.go:245-246`), struct `officeFrameAILimits`
(`server/internal/handler/router/office_frame_ai.go:15-17`), hằng chuỗi lỗi `credErrs`/`byokErrs`
(`office_frame_ai.go:49-50`), comment mô tả route (`office_frame_ai.go:19-43`). Bảng handler: `Routes`
(`server/internal/handler/router/routes.go:354-357, 691-697, 727-730`), ánh xạ (`server/internal/handler/router.go:602-605,
924-930, 955-957`).

Hệ quả rate limit: hai bucket `ai-credentials` (30/phút) và `ai-byok` (60/phút) biến mất; `ai-cloud` và `ai-uniwork` giữ.

### 3.2 Server — service, gateway, provider, DTO, wiring

| Bề mặt | Vị trí | Xử lý |
| --- | --- | --- |
| `AIBYOKService` (`Proxy`, `Status`, `Enabled`, `allowlistedBYOKReason`) | `server/internal/service/ai_byok.go:28-120` | Xóa |
| `AICredentialService` (lưu, liệt kê, xóa, `Resolve`, rào base URL, bảng nhà cung cấp) | `server/internal/service/ai_credentials.go:43-470` | Xóa |
| Hằng `FeatureOfficeAIBYOK = "office.ai_byok"` | `server/internal/service/ai_credentials.go:44` | Xóa; `FeatureOfficeAICloud` cùng khối **giữ** (chuyển sang file khác) |
| `wiredFeatures` có `FeatureOfficeAIBYOK` | `server/internal/service/entitlement.go:48` | Sửa |
| `Gateway.Proxy`, `ProxyRequest`, `ProxySurface`, `CapOfficeBYOK`, `CapOfficeBYOKDesktop`, `RedactKey`, bảng header/MIME proxy | `server/internal/ai/proxy.go:35-300` | Xóa (`actorKind` tại `proxy.go:290` chỉ dùng ở `proxy.go:151`; xóa cùng) |
| `BYOKCredential` | `server/internal/ai/byok_credential.go:9` | Xóa |
| Trường `byok` của `Gateway` + khởi tạo | `server/internal/ai/gateway.go:165-166, 180` | Sửa |
| Mã lỗi proxy `provider_not_supported`, `base_url_refused`, `invalid_request`, `provider_auth_failed` | `server/internal/ai/errors.go:86-90` | Xóa; `ErrProviderUnreachable` (`errors.go:91`) **giữ**: `server/internal/service/meeting_summarize.go:190` dùng |
| Bảng nhà cung cấp BYOK | `server/internal/ai/provider/byok.go:11-77` | Xóa |
| `BYOKClient` (rào SSRF, chặn rebinding, timeout) | `server/internal/ai/provider/byok_client.go:22-435` | Xóa; riêng `transportReason` (`byok_client.go:223`) **giữ**, chuyển file: `provider/cloud.go:99`, `provider/file_transcribe.go:247,252` dùng |
| Handler proxy + `serveProxyStream` + `byokWriteIdle` | `server/internal/handler/ai_byok.go:18-99` | Xóa; `byokWriteIdle` **giữ** dưới tên mới: SSE của UniWork AI dùng (`server/internal/handler/sse.go:87`) |
| Chọn bề mặt desktop (`middleware.DeviceSession` → `ProxySurfaceDesktop`) | `server/internal/handler/ai_byok.go:37-40` | Xóa |
| Handler khóa | `server/internal/handler/ai_credentials.go:20-131` | Xóa |
| `AIMountable` phần khóa/proxy | `server/internal/handler/ai_mount.go:40-46, 68-74` | Sửa (giữ phần cloud) |
| SDI/SDO | `server/internal/handler/dto/sdi/ai_byok.go`, `sdi/ai_credentials.go`, `sdo/ai_byok.go`, `sdo/ai_credentials.go` | Xóa |
| **Cấp quyền khung**: `officeFrameAIGrant` bật `ai` khi BYOK dùng được, và **chỉ khi `ai` bật** mới cấp `web_search` / `image_search` / `image_generation` | `server/internal/handler/office_frame_ai.go:37-72` (điểm mấu chốt `:60-72`), gọi ở `server/internal/handler/office_frame.go:236` | **Sửa** (PR 2, bước 2): công cụ đám mây đi theo `uniwork_ai` + trạng thái cloud |
| Trường `ai` của grant | `server/internal/handler/dto/sdo/office_frame.go:104`, mô tả ba trường cloud `:105-107`, comment `:108-109` | Sửa: xóa trường `ai`, sửa mô tả ba trường cloud |
| Mô tả `ai_uniwork` "BYOK không đổi" | `server/internal/handler/dto/sdo/office_capabilities.go:18` | Sửa chữ |
| Mô tả cờ `office_ai_uniwork` "BYOK is unaffected" | `server/internal/featureflags/keys.go:71` | Sửa chữ (không đổi `review_at`) |
| Nối service | `server/cmd/server/main.go:778-792, 878, 892`; field `Deps` `server/internal/handler/router.go:64-65, 99-101` | Xóa |
| Header vendor trong CORS (`Anthropic-Beta`, `Openai-Organization`, `Openai-Project`, `Http-Referer`, `X-Title`) | `server/internal/handler/router/router.go:158-164` | Xóa |
| Comment loadshed nhắc BYOK | `server/internal/middleware/loadshed.go:21` | Sửa chữ |
| Hành động audit `ai.credential.saved`, `ai.credential.deleted` | `server/internal/audit/actions.go:309-310` | Xóa hằng; dòng audit cũ **giữ** (bảng bất biến, ADR 0012) |
| Phân loại xuất tenant | `server/internal/service/tenant_export_tables.go:18` | Xóa cùng migration bỏ bảng |
| Biến `AI_CREDENTIAL_KEY` | `.env.example:232-235`; nhắc ở `.env.example:239` | Xóa dòng biến; sửa câu ở `:239` (khóa hội thoại UniWork AI giữ) |

### 3.3 Server — dữ liệu và migration

| Bề mặt | Vị trí | Xử lý |
| --- | --- | --- |
| Bảng `ai_provider_credentials` | `server/migrations/9991791524388000_ai_provider_credentials.up.sql:9-25`, index `9991791524388001_*`, cột model `9991791705198089_*` | Migration mới ở PR 2 bỏ bảng (chưa có tiền lệ bỏ bảng trong repo; lint migration không cấm) |
| Query | `server/pkg/db/queries/ai_credentials.sql:7-72` (6 query), sinh ra `server/pkg/db/generated/ai_credentials.sql.go` | Xóa, chạy `make sqlc` |
| Tính năng gói `office.ai_byok` (bảng `features`, `plan_features`) | seed ở `server/migrations/9991791524388002_office_ai_features.up.sql:6-16` | Migration mới ở PR 2 xóa các dòng `office.ai_byok`; `office.ai_cloud` giữ |
| Dòng `ai_usage_events` capability `office.byok` / `office.byok_desktop` | ghi ở `server/internal/ai/proxy.go:147-153` | **Giữ** làm lịch sử sử dụng; không ghi thêm |
| Dòng `audit_events` `ai.credential.*` | bảng bất biến | **Giữ** |

### 3.4 Web client trong repo này

Không có màn host nào cho người dùng nhập, xem hay xóa khóa. Phần BYOK ở client là một lớp API/hook không ai dùng,
trường grant `ai`, nhãn i18n, câu chữ landing và harness G7.

| Bề mặt | Vị trí | Xử lý |
| --- | --- | --- |
| Schema nhà cung cấp, khóa, input lưu khóa | `packages/core/types/ai-office.ts:8-48` | Xóa; schema cloud `:50-168` **giữ** |
| Endpoint khóa + `byokProxyBaseUrl` + `EMPTY_CREDENTIALS` | `packages/core/api/endpoints/ai-office.ts:24-30, 49-58, 66-91` | Xóa; endpoint cloud `:94-127` **giữ** |
| Test endpoint khóa (gồm ca malformed-response) | `packages/core/api/endpoints/ai-office.test.ts:33-100` | Xóa |
| Hook khóa (`useAiCredentials`, `useSaveAiCredential`, `useDeleteAiCredential`), key `aiOfficeKeys.credentials`, re-export `byokProxyBaseUrl` | `packages/core/ai/office-hooks.ts:6, 11, 15-43` (không nơi nào dùng) | Xóa; hook cloud `:45-80` **giữ** |
| Test hook khóa | `packages/core/ai/office-hooks.test.tsx:10-12, 43-48, 57-76`; dòng `:39` cũng kiểm key cloud | Xóa phần khóa, sửa `:39` |
| Trường grant `ai` | `packages/core/api/endpoints/office-frame.ts:22` (comment `:26`) | Sửa (PR 2, cùng lúc máy chủ bỏ trường) |
| Test parse grant có `ai` | `packages/core/api/endpoints/office-frame.test.ts:68-90` | Sửa |
| Năng lực `ai` trong giao thức khung (vendor từ fork) | `packages/core/office/docs-frame-protocol.ts:265-270, 333`, gửi ở `:400, :421`, ack `:559`; comment cũ "cloud cần `ai`" `:271-276`; comment `AiRunPayload` `:836` | Sửa khi vendor lại giao thức từ fork (PR 2, bước 1); `uniworkAi` `:293, :339` **giữ** |
| Tính năng lực khung: `ai = spec.ai && grant.ai`, `cloud = ai \|\| uniworkAi` | `packages/views/office/frame/docs-frame-session-model.ts:296-311` | Sửa: `cloud = uniworkAi`; client chỉ bật công cụ khi grant của server bật (`:319-320`), nên sửa máy chủ (PR 2, bước 2) là chính |
| Truyền `minted.ai` vào năng lực | `packages/views/office/frame/docs-frame-init.ts:63` | Sửa |
| Test năng lực khung | `packages/views/office/frame/office-module-frame.test.tsx:402-405, 437-442, 467-470` (ca `ai: true`); `docs-frame-session-model.test.ts:18-31` | Sửa; ca chỉ `uniwork_ai` (`office-module-frame.test.tsx:423-429`) **giữ** |
| Rewrite `/ai/:aiPath*` của khung (comment nhắc credentials, byok) | `apps/web/platform/office-frame/frame-asset-rewrites.mjs:48-50`; test `frame-asset-rewrites.test.ts:60-63` | Sửa comment; xóa assertion đường byok |
| Nhãn tính năng gói `office_ai_byok` | `packages/core/i18n/locales/vi.json:1103`, `en.json:1104` | Xóa (cùng migration bỏ dòng `features`) |
| Nhãn capability `office_byok`, `office_byok_desktop` (bảng sử dụng) | `vi.json:1491-1492`, `en.json:1492-1493`; test `packages/views/settings/components/ai-tab.test.tsx:88-89, 105-109` | **Giữ**: bảng sử dụng các tháng cũ vẫn có dòng này |
| Câu chữ landing hứa "khóa riêng" | `trustAi` `vi.json:11291`/`en.json:11353`; `ai.account.description` `vi.json:11385`/`en.json:11447` (test `apps/web/features/landing/office-page.test.tsx:155`); `connection.ai.description` `vi.json:11402`/`en.json:11464`; FAQ `a4` `vi.json:11431`/`en.json:11493` | Sửa (PR 2) |
| Trang hướng dẫn "Dùng khóa AI riêng trên web có bỏ qua UniWork không?" | `apps/web/features/landing/guide-content.ts:31, 41, 79, 85` | Xóa mục (PR 2) |
| Trụ cột landing "…on-premise và BYOK" | `landing.why.pillar4Desc` `vi.json:10730`/`en.json:10792` | Bỏ chữ "BYOK" (§12) |
| Changelog đang chờ | `packages/core/changelog/pending/1.6.0.json:3683, 9128, 9308, 9323, 9338, 9533, 9608, 9623, 13388` | Giữ (lịch sử); bản changelog của dự án này ghi việc gỡ |
| Harness G7-08: ma trận nhà cung cấp `['uniwork','byok']` | `scripts/office/g5g6g7/g7-08/rows.mjs:20`; `rows.test.mjs:135, 140`; `run-g7-08.mjs:41`; `preconditions.mjs:298, 339, 401, 408, 444`; `web-driver.mjs:392-399`; `wire-observe.mjs:108-127` (test `wire-observe.test.mjs:52-133, 280-295`, `run-g7-08-wire.test.mjs:185-189`) | Xóa nửa `byok` |
| Harness chung đặt `AI_CREDENTIAL_KEY` giả để token web có `ai` | `scripts/office/g5g6g7/harness/lib.mjs:82-88, 135-137`; `harness/README.md:94-101` (test `readme-blocks.test.mjs:99-102`) | Xóa |
| Harness G7-06 chấp nhận `ai \|\| uniworkAi`; devset gửi `ai: true` | `scripts/office/g5g6g7/g7-06/capture/web.mjs:30-32`, `g7-06/job-lib.mjs:148-161`; `devset-run.mjs:1418, 1423, 1441` | Sửa |
| Bản vendor desktop (`packages/office-upstream/upstream/`): rơi về `genspark` khi không có nhà cung cấp lưu trên máy | `apps/docs/src/main/docs-main.ts:2854, 2860`; `apps/sheets/src/main/sheets-main.ts:3234`; `apps/slides/src/main/ai-ipc.ts:113`; `apps/slides/src/main/slides-main.ts:1682` | Xóa khi vendor lại từ fork sau PR 1b (đường C); không chạm kho khóa của UniWork |
| E2E | `e2e/` không có test BYOK; `e2e/office-ux-floor-fixtures.ts:402-411` chỉ kiểm `uniwork_ai` | Không đổi |

### 3.5 Fork `UNIAI-TEAM/uniwork-office` — khung web

Fork đã tách BYOK khá gọn. Công cụ đám mây trong khung **không** cần grant `ai`: fork chỉ đòi `ai || uniworkAi` cộng
grant riêng của từng công cụ (`web/modules/shared/ai/web-ai.ts:83-85`). Vì vậy việc cấp công cụ đám mây chỉ cần sửa máy chủ (PR 2, bước 2).

| Bề mặt | Vị trí (fork) | Xử lý |
| --- | --- | --- |
| `aiHostGrants`: `ai` = grant `ai` OR `uniworkAi`; `aiCredentials` chỉ từ grant BYOK | `web/modules/shared/ai/web-ai.ts:75-87` (phần BYOK ở `:76`, `:81`) | Sửa |
| Bật AI theo grant; chỉ grant BYOK đọc trạng thái cloud vô điều kiện và làm mới khóa khi tab có lại focus | `web-ai.ts:326-375` (`:343`, `:375`) | Sửa |
| `listCredentials()` khi có grant BYOK | `web-ai.ts:388` | Xóa |
| Liệt kê model nền qua `byok/{p}/models` | `web-ai.ts:454-500` (`:483`) | Xóa |
| `turnUniworkOff`: không có BYOK thì ẩn panel khi máy chủ trả 403 | `web-ai.ts:600-608` | Giữ (thành hành vi duy nhất) |
| `settings()`: ô khóa che `key_hint`, nhà cung cấp mặc định cho BYOK; `uniwork` nhận `{apiKey:'…', model:''}` (`:676`); `credentialsUnavailable` (`:694`); lựa chọn BYOK đã lưu rơi về `uniwork` (`:643-647`) | `web-ai.ts:613-695` | Sửa |
| `WEB_PROVIDER_IDS`, `openSettings`, `openAiSettings`, `openAiModelSettings` | `web-ai.ts:100-102, 794-814, 1094, 1096` | Xóa |
| Client route khóa và proxy | `web/modules/shared/ai/client.ts:9-14, 278-289` | Xóa; `cloud*` và `uniwork/chat/completions` (`:15-20, 270, 291-311`) **giữ** |
| Hộp thoại nhập khóa trong khung (ô mật khẩu `:293`, lưu `:374`, xóa `:390`) | `web/modules/shared/ai/ui.ts:196-458` | Xóa; khối credit cloud `:401-420` nằm trong hộp này — **chuyển ra** trước khi xóa |
| `proxyConfig` (base `…/byok/{p}`), `setPrimaryFetch(createProxyFetch)` | `web/modules/shared/ai/stream.ts:111-122, 152` | Xóa; lượt `uniwork` (`:200-280`) **giữ** |
| `toProxyRequest`, `createProxyFetch` | `web/modules/shared/ai/transport.ts:37-56` | Xóa |
| Viết lại URL nhà cung cấp sang proxy | `packages/ai-provider/src/proxy-url.ts:69-110` | Xóa; `isInsideAiMount` (`:54`), đọc body lỗi (`:116`), `proxyAnswered` (`:183`) **giữ** — chặn cả route `uniwork` và cloud (`client.ts:240`, `errors.ts:147`) |
| Đường ống năng lực `aiCredentials` | `web/docs/bridge/hide.ts:59, 81`; `module-bridge.ts:130-132, 200`; `install.ts:90`; `web/modules/sheets/capabilities.ts:77-84` | Xóa |
| Nút cài đặt khóa trong panel (web) | `apps/docs/src/renderer/ai/AiPanel.tsx:1835`; `apps/markdown/src/renderer/ai/AiPanel.tsx:1359`; `apps/sheets/src/renderer/ai/AiChatPanel.tsx:813`; `apps/sheets/src/renderer/App.tsx:1724` | Xóa (trên web) |
| `credentialsUnavailable` trong bộ chọn model | `packages/ui/src/AiModelPicker.tsx:336` | Xóa |
| Test web | `web/modules/shared/ai/ai.test.ts` (khối ở `:152, 322, 957, 1165, 1309, 1615, 1747`, "Grant formula" `:2310`); `web/modules/sheets/ai.test.ts:107`; `web/e2e/ai-web.spec.ts`; `web/e2e/sheets-ai.spec.ts`; `web/docs/bridge/hide.test.ts:14`; `web/docs/bridge/frame-capabilities.test.ts:92`; `packages/ai-provider/tests/proxy-url.test.ts:22` | Sửa/xóa theo phần trên |

Nếu máy chủ thôi gửi grant `ai`: tổ chức có UniWork AI giữ panel, chỉ còn nhà cung cấp UniWork AI, không gửi request
`credentials` hay `/byok`. Tổ chức **chỉ** có BYOK mất panel và mất công cụ đám mây. Nếu gỡ route **trước** khi thôi
gửi grant, khung gặp 404, hiện `credentialsUnavailable` và liệt kê model hỏng — nên PR 2 pin fork mới trong
cùng PR với việc gỡ route (§5): khung và máy chủ đổi cùng một lần deploy.

### 3.6 Fork — app desktop

**Đường B — "Khóa trên UniWork" (ADR 0034):**

| Bề mặt | Vị trí (fork) | Xử lý |
| --- | --- | --- |
| `createUniworkKeysHost`: R1 `GET /api/v1/orgs/{id}/ai/credentials` (`:191, 325`), 404 coi là rỗng (`:350`), base proxy (`:406-418`), `fetchFor` + `toProxyRequest` (`:424-520`), R5 `/models` (`:529-560`), `sources()` `origin:'org'` (`:724-740`) | `apps/shell/src/main/uniwork-auth/keys.ts:135-740` | Xóa |
| Bảng nhà cung cấp khóa tổ chức, parser R1, mã lỗi | `apps/shell/src/main/uniwork-auth/keys-credentials.ts:6-95`; `keys-errors.ts` | Xóa |
| `uniworkAiModelPicks` trong `app-settings.json` (tên dễ nhầm: là lựa chọn model cho khóa tổ chức, **không** phải UniWork AI) | `apps/shell/src/main/uniwork-auth/keys-wiring.ts:5, 16-34` | Xóa |
| Khởi động nguồn khóa (`uniworkKeys`, `startUniworkKeys`, gọi ở `:435, 460`) | `apps/shell/src/main/uniwork-auth/index.ts:391-425` | Xóa |
| Bộ điều phối `installOrgFetchDispatcher` / `setPrimaryFetch`; ưu tiên nguồn `localSlotClaimed` (`:115-129`), `resolveAiRoute` (`:142-164`) | `apps/docs/src/main/ai-org-route.ts:86-164` | Xóa |
| Chọn đường trong main của Docs: `modelSourcesOf`, `aiRouteOf`, `keepOrgServedSlots`, `runOnRoute`, `insideOrgFetch` | `apps/docs/src/main/docs-main.ts:4030-4041, 4049, 4155, 4224, 4266, 4456, 4499, 4519, 4860` | Xóa |
| `origin==='org'`, `isOrgServedReady` | `packages/ai-provider/src/providers.ts:463-467, 486-488`; `types.ts:162-163` | Xóa |
| Chữ "Key on UniWork" / "Khóa trên UniWork" / "Dùng khóa trên máy này" | `packages/ui/src/strings-ai-model-picker.ts:62, 406, 412`; bộ chọn `AiModelPicker.tsx:139, 290, 299, 451, 676-691, 785`; Cài đặt `apps/shell/src/renderer/src/SettingsModal.tsx:621-678, 848, 906-965` | Xóa |
| Test | `apps/shell/tests/uniwork-keys.test.ts:221`; `apps/shell/tests/settings-ai-model-list.test.ts`; `apps/docs/tests/uniwork-ai-choice.test.ts:139, 149`; `e2e/uniwork-org-keys.spec.ts:164`; `packages/ui/tests/ai-model-picker-org-note.test.ts`; `packages/ui/tests/ai-model-picker-data.test.ts` | Xóa/sửa |

Máy chủ gỡ route thì app cũ nhận 404 ở R1, coi là "không có khóa tổ chức" (`keys.ts:350`), các dòng "Khóa trên UniWork"
biến mất; khóa trên máy, Codex CLI, UniWork AI và công cụ đám mây của desktop (`/orgs/{id}/ai/cloud*`) vẫn chạy.

**Đường C — khóa trên máy và CLI cục bộ (ADR 0028 QĐ2), gỡ hết (Q-B1 = (a)):**

| Bề mặt | Vị trí (fork) |
| --- | --- |
| Khóa lưu ở `userData/ai-settings.json` | `apps/docs/src/main/docs-main.ts:3889`; `apps/sheets/src/main/sheets-main.ts:2121`; `apps/markdown/src/main/markdown-main.ts:1015`; `apps/pdf/src/main/pdf-main.ts:1894`; `apps/html/src/main/html-main.ts:1641`; `apps/slides/src/main/ai-ipc.ts` |
| Danh mục nhà cung cấp (~26 mục): `genspark` "UniAI" (khóa OpenRouter `sk-or-`, `:529-560`), `codex` CLI (`needsCliPath`), anthropic, gemini, openai, openrouter, custom… | `packages/ai-provider/src/providers.ts:30-363` |
| Danh mục khóa media và tìm kiếm | `packages/ai-provider/src/media.ts:29-200`; `search-settings.ts:8-17` |
| UI nhập khóa: `AiModelPane` (ô khóa `:979-984`, đường dẫn Codex CLI `:893-900`, nút Thử `:741`), `AiMediaPane` (`:1121`, ô khóa `:1435, 1553, 1612`) | `apps/shell/src/renderer/src/SettingsModal.tsx:417-1612` |
| Bản vendor trong repo này (rơi về `genspark`) | `packages/office-upstream/upstream/...` (§3.4) |
| Test | `apps/shell/tests/settings-ai-uniwork.test.ts`; `apps/sheets/tests/agent-configured.test.ts` |

**Giữ:** UniWork AI trên desktop là một mục trong danh mục (`UNIWORK_PROVIDER_META`, `providers.ts:373-409`, chèn bởi
`setUniworkAiAvailable`), lựa chọn lưu theo tài khoản (`apps/shell/src/main/uniwork-ai-choice.ts:11`,
`apps/shell/src/main/index.ts:7196`), gọi `/ai/uniwork/chat/completions` bằng bearer thiết bị
(`apps/shell/src/main/uniwork-auth/ai-chat.ts:41-65`). `streamUniwork`
(`packages/ai-provider/src/uniwork/protocol.ts:175-315`) không đọc khóa nào. Đường "AI preset"
(`apps/shell/src/main/index.ts:5321-5346`, `tab-manager.ts:489-513`) chỉ đẩy câu hỏi từ Home vào panel AI của một tab,
không liên quan tới khóa.

### 3.7 Test đang ghim BYOK

Server (số test theo `grep '^func Test'`):

| File | Nội dung | Xử lý |
| --- | --- | --- |
| `server/internal/ai/provider/byok_test.go` (10 test, ví dụ `TestBYOKProviderTableMatchesFork` `:25`, `TestBYOKBlockedAddresses` `:60`, `TestBYOKClientRefusesRebindingAtDial` `:230`), `byok_idle_test.go` | Bảng nhà cung cấp khớp fork, rào SSRF, timeout | Xóa |
| `server/internal/ai/proxy_test.go` (11 test, trong đó `TestProxySurfaceCapability` `:285`) | Proxy, đo đếm, lọc khóa, capability web/desktop | Xóa |
| `server/internal/handler/ai_byok_test.go`: `TestAIBYOKDeviceSessionStreamsAndMetersDesktopCapability` `:59`, `TestAIBYOKWebAndDeviceSessionsShareRateLimitBudget` `:163` | Đường desktop ADR 0034 | Xóa; **chú ý** helper `byokHandlerRedis` ở file này được `server/internal/handler/document_access_requests_test.go:268` dùng — chuyển helper sang file test chung trước |
| `server/internal/handler/ai_byok_stream_test.go` | `serveProxyStream` | Xóa |
| `server/internal/handler/ai_credentials_test.go` (6 test) · `server/internal/service/ai_credentials_test.go` (13 test) · `server/internal/service/ai_byok_test.go` (2 test) | Kho khóa, trạng thái BYOK | Xóa |
| `server/internal/handler/router/ai_byok_ratelimit_test.go:11` · `ai_credentials_ratelimit_test.go:12` | Bucket `ai-byok`, `ai-credentials` | Xóa |
| `server/internal/handler/router/ai_uniwork_ratelimit_test.go:41` | Dùng route BYOK để chứng minh bucket `ai-uniwork` tách riêng | Sửa: đổi sang một route cloud |
| `server/internal/handler/router/router_test.go:283-290` | Preflight CORS cho header vendor | Xóa ca |
| `server/internal/handler/router/office_frame_ai_test.go:49-53` | Bảng route frame | Sửa |
| `server/internal/handler/ai_mount_test.go:27-33, 46-52, 123-126` | Mount khóa/proxy | Sửa (giữ ca cloud) |
| `server/internal/handler/office_frame_ai_test.go`: `TestOfficeFrameAIHappyPath` `:134`, `TestOfficeFrameAIEntitlementRequired` `:294`, `TestOfficeFrameTokenCarriesTheAIGrant` `:334`, world dựng BYOK `:43-89`, bảng route `:119-122` | Khung + BYOK | Sửa: viết lại quanh UniWork AI + cloud; `TestOfficeFrameGrantsUniworkAIWithoutBYOK` `:366` thành test chính của grant |
| `server/internal/handler/isolation_routes_test.go:408` (`reasonBYOKVendor`), `:673-676`, `:740`, `:826-830` · `server/internal/handler/isolation_office_test.go:59-60, 271-276` | Ma trận cô lập | Sửa: xóa dòng route cùng commit gỡ route (dòng `isoRoutes` thừa làm test đỏ) |
| `server/internal/service/audit_coverage_test.go:1913-1930, 2578-2579` | Hai hành động `ai.credential.*` | Sửa: xóa cùng hằng audit (test hỏng theo hai chiều) |
| `server/internal/middleware/ratelimit_degraded_test.go:190-196` · `loadshed_test.go:116-118` | Dùng đường dẫn `/ai/byok/` làm mẫu | Sửa: đổi sang đường dẫn khác cùng hình |
| `server/internal/handler/auth_test.go:141, 177-179` | Dựng `Deps` có BYOK | Sửa |

Web client và harness: xem §3.4. Fork: xem §3.5–§3.6.

Hai test mà `CLAUDE.md` nêu tên cho luật desktop (`TestAIBYOKDeviceSessionStreamsAndMetersDesktopCapability`,
`TestProxySurfaceCapability`) bị xóa cùng luật; thay bằng test mới ở §7.

### 3.8 Tài liệu, ADR, quy tắc

| Tài liệu | Vị trí | Xử lý |
| --- | --- | --- |
| `CLAUDE.md` mục Audit and Events, gạch về desktop BYOK | `CLAUDE.md:376-381` | Thay bằng luật mới (§7) |
| ADR 0029 | `docs/adr/0029-ai-cua-office-tren-web-qua-ai-gateway.md` | `superseded by 0048` (§6). Không sửa nội dung |
| ADR 0034 | `docs/adr/0034-desktop-dung-khoa-luu-tren-uniwork-qua-proxy-byok.md` | `superseded by 0048` |
| Bản nháp cũ của 0034 còn sót | `docs/adr/drafts/0034-desktop-dung-khoa-luu-tren-uniwork-qua-proxy-byok.md` (khác bản accepted) | Xóa |
| ADR 0028 QĐ2 (khóa trên máy, CLI) | `docs/adr/0028-ai-phia-client-cua-uniwork-office.md:29-32` | `superseded by 0048`; 0048 nhắc lại QĐ1, QĐ3, QĐ4, QĐ5 của 0028 vì chúng vẫn đúng |
| Bảng ADR | `docs/adr/README.md:43, 48` | Sửa mô tả, thêm dòng 0048 |
| ADR 0035 nhắc rào SSRF của proxy BYOK | `docs/adr/0035-xem-truoc-lien-ket-server-tai-trang-va-anh.md:4, 125` | Giữ (ADR accepted không sửa); xem trước liên kết dùng `netguard`, không phụ thuộc BYOK (`server/internal/linkpreview/linkpreview.go:29`) |
| Hợp đồng API desktop G6-05k | `docs/office/g5g6g7/contracts/g6-05k-org-keys-api.md` (59 chỗ nhắc BYOK) | Thêm dòng "superseded" ở đầu |
| Hợp đồng app Office, trang web modules | `docs/office/g3g4/uniwork-office-app-api-contract.md:16, 112-126`; `docs/office/office-web-modules.md:333-359` | Sửa |
| Nghiệm thu G7, dòng `G6-A08` "BYOK vẫn chạy" và "A UniWork AI failure must not disable a BYOK provider" | `docs/office/g5g6g7/acceptance-rows.json:724-745` | Viết lại: lỗi UniWork AI giữ editor và Lưu, báo lỗi rõ |
| Runbook và alert nói "BYOK vẫn chạy" | `docs/runbooks/UniworkAiModelErrors.md:8, 21`; `docs/ops/RUNBOOK_OFFICE_SYNC.md:125`; `deploy/alerts.yml:266` | Sửa; xem lại mức nghiêm trọng (§11, R3) |
| Spec quản lý gói AI (BYOK cùng tồn tại §5.7, bảng f, D-6, Q-AIP-5) | `docs/superpowers/specs/2026-10-18-ai-plan-management-uniwork.md:28, 309-316, 567, 627-633, 723` và board `.../design/f-byok-vs-plan.html` | Ghi chú "bị thay bởi spec này" ở các mục đó |
| Pháp chế và SEO | `docs/seo-legal-request.json:10, 25, 37`; `docs/seo.md:182`; `output/pdf/uniwork-mau-phan-hoi-phap-che-2026-10-15.txt:92, 200` | Báo pháp chế: câu PC15 "trách nhiệm khi dùng khóa riêng" hết đối tượng; câu F03 đổi |
| Spec định vị landing ("Cloud / Private Cloud / On-prem / BYOK") | `docs/superpowers/specs/2026-09-09-landing-work-products-positioning-design.md:156` | Bỏ chữ "BYOK" (§12) |
| `.gitleaksignore` (literal test BYOK) | `.gitleaksignore:10-23` | Giữ: trỏ vào commit cũ |

## 4. Điều kiện trước khi gộp

Chỉ ba điều kiện, kiểm ngay trước khi merge PR của repo này:

| # | Điều kiện | Cách kiểm |
| --- | --- | --- |
| C1 | Dự án "Hỏi UNI soạn tệp Office" đã ship Phần 5 (route viết phía server; `write_document`, `generate_deck`, `regenerate_slide` chạy dưới UniWork AI), theo Q10 | Spec `2026-10-27-ask-uni-office-design.md` ở trạng thái shipped. Muốn gỡ sớm hơn thì chấp nhận ba thao tác đó tạm không chạy |
| C2 | **Production chưa có khóa của tổ chức thật**: truy vấn (1) ở §8 trả rỗng, hoặc chỉ có tổ chức nội bộ/thử nghiệm. Nếu có tổ chức thật thì dừng và hỏi chủ sản phẩm — bước xóa bảng không đảo được | Chạy truy vấn (1) và (2) ở §8 trên production |
| C3 | Ở mọi môi trường đang dùng (dev, staging, production nội bộ): cờ `office_ai_uniwork` và 6 cờ định dạng (`server/internal/featureflags/keys.go:71-77`) bật, UniWork AI đã cấu hình (dev dùng upstream Codex, spec Office §8.4) | `GET /api/v1/config` của một thành viên |

**G6-D2 không còn là điều kiện gỡ BYOK.** Q10 đặt G6-D2 làm điều kiện vì sợ khách thật mất AI; chưa có khách thật nên
điều kiện đó không áp. G6-D2 vẫn phải đóng **trước khi có người dùng thật với dữ liệu thật**, vì sau dự án này UniWork AI
là đường AI duy nhất của trình soạn (mô tả cờ `office_ai_uniwork`, `keys.go:71`).

**Chấp nhận mất** (theo hướng không khắt khe): ba công cụ vẫn bị chặn dưới UniWork AI sau dự án Hỏi UNI soạn tệp Office —
`insert_web_image`, `replace_image`, `save_style_template` (spec đó, Phần 5); việc người dùng tự chọn model/nhà cung
cấp; AI ngoại tuyến và CLI cục bộ (Codex CLI) trên app desktop.

## 5. Thứ tự gỡ: hai PR, một lần deploy

**PR 1 — fork `UNIAI-TEAM/uniwork-office`.** Xóa mọi thứ đánh dấu Xóa/Sửa ở §3.5 (khung web) và đường B ở §3.6 (app
desktop "Khóa trên UniWork"), cùng test của chúng. Xóa luôn đường C ở §3.6 (khóa trên máy, CLI, danh mục khóa media và
tìm kiếm) — có thể tách thành PR 1b vì lớn. Sau PR 1b, ảnh, phiên âm và tìm kiếm trên desktop chỉ đi qua công cụ đám mây
của UniWork (`/orgs/{id}/ai/cloud*`). Trong PR này: kiểm Sheets dưới UniWork AI (R12) và sửa nếu cần. Merge, ghi SHA mới.

**PR 2 — repo này, một PR, một issue UniAI.** Trong cùng PR, theo thứ tự commit:

1. Pin fork mới (`apps/web/platform/office-frame/*.pin.json`) và vendor lại giao thức
   (`packages/core/office/docs-frame-protocol.ts`): khung web không còn gọi route khóa hay proxy.
2. Sửa cấp quyền khung: `officeFrameAIGrant` cấp `web_search` / `image_search` / `image_generation` theo trạng thái
   cloud và `uniwork_ai`, bỏ trường `ai` (§3.2). Thêm `TestOfficeFrameCloudToolsFollowUniworkAI` (§7).
3. Gỡ máy chủ: mọi dòng Xóa/Sửa ở §3.1–§3.2, cùng test ở §3.7 (dòng `isoRoutes` và `audit_coverage_test` xóa cùng
   commit với route và hằng audit, kẻo CI đỏ). Giữ đúng các mục "Giữ" (R7).
4. Migration (§3.3): bỏ bảng `ai_provider_credentials`; xóa các dòng `office.ai_byok` khỏi `plan_features` và
   `features`. Xóa query `ai_credentials.sql`, chạy `make sqlc`. Xóa dòng ở `tenant_export_tables.go:18`.
5. Gỡ client và harness: mọi dòng Xóa/Sửa ở §3.4. Sửa câu chữ landing và trang hướng dẫn nhắc "khóa riêng".
6. Xóa `AI_CREDENTIAL_KEY` khỏi `.env.example` và `server/cmd/server/main.go`.
7. Tài liệu: ADR 0048 (accepted luôn, §6), đổi trạng thái 0029 và 0034, sửa `CLAUDE.md` (§7), tài liệu ở §3.8.

Sau khi deploy PR 2: xóa `AI_CREDENTIAL_KEY` khỏi secret manager mọi môi trường. Hủy khóa chủ làm ciphertext còn trong
bản sao lưu thành không đọc được.

**Vì sao không vỡ giữa chừng.** Repo này pin fork, nên khung web đổi cùng lúc với máy chủ: không có lúc nào khung gọi
route đã mất. App desktop bản cũ gặp 404 ở `GET /orgs/{id}/ai/credentials` thì coi là "không có khóa tổ chức"
(`apps/shell/src/main/uniwork-auth/keys.ts:350` ở fork; ADR 0034 QĐ7), các dòng "Khóa trên UniWork" biến mất; UniWork AI
và công cụ đám mây của desktop vẫn chạy.

## 6. ADR thay thế

ADR mới, đề xuất số **0048** (0047 đã được nhánh UNI-2179 dùng cho Google Drive; lấy số trống kế tiếp khi merge, như
các tiền lệ trong `docs/adr/README.md`). Tên gợi ý: `0048-ai-chi-chay-bang-uniwork-ai-go-byok.md`. Viết thẳng ở thư
mục gốc, `accepted`, trong PR 2 (không qua `drafts/`, vì quyết định đã có từ chủ sản phẩm).

Nội dung chính:

- **Quyết định.** Mọi AI của UniWork — Hỏi UNI, agent họp, trình soạn Office web và desktop — chạy bằng UniWork AI qua
  `ai.Gateway`. UniWork không nhận, không lưu, không chuyển tiếp khóa nhà cung cấp của người dùng. Không có proxy
  pass-through tới nhà cung cấp do người dùng chọn. App desktop không gọi thẳng nhà cung cấp bằng khóa trên máy hay CLI
  cục bộ.
- **Thay thế:** ADR 0029 phần kho khóa, proxy, `office.ai_byok`, header vendor, rào `custom`; phần công cụ đám mây,
  `office.ai_cloud` và bảng tính credit của 0029 vẫn đúng và được nhắc lại trong 0048 để không mất lý do. ADR 0034 toàn
  bộ. ADR 0028 QĐ2 (đường C).
- **Giữ nguyên (nhắc lại trong 0048):** ADR 0010; ADR 0028 QĐ1, QĐ3, QĐ4, QĐ5; luật `TestProviderSDKOnlyInAIProvider`,
  `TestAIPackageOnlyCallsAiQueries`.
- **Hệ quả.** Không còn bí mật của khách trên máy chủ; người dùng mất lựa chọn model và nhà cung cấp; mọi lượt AI tiêu
  `ai.tokens`; khi UniWork AI hỏng thì trình soạn không còn AI dự phòng (R3).
- ADR 0028, 0029, 0034 đổi dòng trạng thái thành `**Trạng thái:** superseded by 0048`: sửa duy nhất được
  phép trên ADR đã accepted (`docs/adr/README.md` dòng 8-10); `scripts/governance.test.mjs:255` kiểm định dạng.

## 7. Luật mới trong `CLAUDE.md` và test giữ luật

Thay gạch `CLAUDE.md:376-381` bằng:

> - UniWork never stores, receives or forwards a person's own AI provider key, and the Office apps never call an AI
>   vendor with a key of their own (ADR 0048, superseding 0028, 0029 and 0034): every Office AI call, web or desktop,
>   goes through UniWork AI behind `office.ai_cloud`. There is no `ai_provider_credentials` table and no proxy route.
>   `TestNoProviderKeyRoutes` and `TestNoProviderCredentialTable` hold it here; the fork's own tests hold the desktop.

Test mới (tên gợi ý, người xây dựng chốt):

- `TestNoProviderKeyRoutes` (`server/internal/handler/router/`): không route nào khớp `/ai/credentials` hay `/ai/byok/`
  trong catalog `api`, cả mount phiên lẫn mount khung.
- `TestNoProviderCredentialTable` (`server/migrations/`, DB đã migrate): bảng `ai_provider_credentials` không tồn tại và
  `features` không có `office.ai_byok`.
- `TestOfficeFrameCloudToolsFollowUniworkAI` (`server/internal/handler/`): tổ chức có cloud + UniWork AI được cấp ba
  công cụ đám mây mà không cần BYOK; tắt `office_ai_uniwork` thì không có. Viết trong PR 2, bước 2.
- Fork: test `aiHostGrants` đổi theo (dòng nghiệm thu đã nhắc `'uniworkAi alone opens the panel'`,
  `docs/office/g5g6g7/acceptance-rows.json:704`).

## 8. Người đang dùng khóa riêng

App còn đang phát triển, nên **không** có kế hoạch thông báo khách, không ưu đãi chuyển đổi, không giai đoạn giữ khóa.
Chỉ còn một bước kiểm an toàn trước khi merge (điều kiện C2 ở §4), vì xóa bảng khóa không đảo được.

Hai truy vấn chỉ đọc, chạy trên production:

```sql
-- (1) Ai đang có khóa lưu trên UniWork (đường A và B)
SELECT organization_id,
       count(*)                AS keys,
       count(DISTINCT user_id) AS people,
       array_agg(DISTINCT provider ORDER BY provider) AS providers,
       max(updated_at)         AS last_changed
FROM ai_provider_credentials
GROUP BY organization_id
ORDER BY people DESC;

-- (2) Ai đã dùng proxy trong 90 ngày (đường A: office.byok, đường B: office.byok_desktop)
SELECT organization_id, capability,
       count(*)                 AS calls,
       count(DISTINCT actor_id) AS people,
       max(created_at)          AS last_call
FROM ai_usage_events
WHERE capability IN ('office.byok', 'office.byok_desktop')
  AND created_at > now() - interval '90 days'
GROUP BY organization_id, capability;
```

- Chỉ ra tổ chức nội bộ/thử nghiệm: merge bình thường. Người trong nhóm phát triển tự thu hồi khóa ở trang nhà cung cấp
  nếu muốn.
- Ra tổ chức thật: dừng, hỏi chủ sản phẩm trước khi merge.
- Đường C (khóa trên máy) không tìm được từ máy chủ; ghi vào ghi chú phát hành của app desktop là đủ.

Changelog của PR 2 ghi một dòng: "AI trong trình soạn Office chỉ chạy bằng UniWork AI; bỏ khóa AI riêng."

Về gói: tổ chức có `office.ai_byok` thì đã có `office.ai_cloud` (§2), nên không phải đổi gói. Lượt AI từ nay tiêu
`ai.tokens`; hết hạn mức thì UniWork AI trả 402 `credits_exhausted` (`server/internal/service/ai_uniwork.go:115, 279`).

## 9. Quyền riêng tư và dữ liệu

- Migration ở PR 2 bỏ bảng khóa ngay khi deploy; sau đó hủy `AI_CREDENTIAL_KEY` trong secret manager. Ciphertext còn
  trong bản sao lưu cũ thành không giải mã được (ADR 0029, Hệ quả). Khóa hội thoại UniWork AI là biến riêng, không bị ảnh
  hưởng (`.env.example:237-242`).
- Dòng `ai_usage_events` cũ giữ nguyên (số đo, không nội dung). Nhãn `office_byok`, `office_byok_desktop` ở client giữ để
  bảng sử dụng của các tháng cũ vẫn đọc được.
- Trang pháp chế và chính sách dữ liệu bỏ đoạn về khóa riêng (§3.8); nội dung AI từ nay đi tới nhà cung cấp UniWork chọn
  ở G6-D2.

## 10. Bật lại (rollback)

- Trước khi migration chạy trên một môi trường: revert PR 2 (và pin lại fork cũ) là xong.
- Sau khi migration chạy: code revert được, **khóa đã lưu thì mất hẳn**; ai cần BYOK lại phải nhập lại khóa. Chấp nhận
  được vì app còn đang phát triển và C2 đã xác nhận không có khóa của tổ chức thật.

## 11. Rủi ro

| # | Rủi ro | Giảm thiểu |
| --- | --- | --- |
| R1 | Có tổ chức thật dùng khóa riêng mà không ai biết | Điều kiện C2: chạy truy vấn §8 trước khi merge |
| R2 | Công cụ đám mây biến mất cùng grant `ai` | Sửa grant trong PR 2, bước 2, có test riêng |
| R3 | Không còn đường dự phòng: UniWork AI hỏng là trình soạn không có AI. Alert `UniworkAiModelErrors` đang `severity: "2"` và ghi "BYOK vẫn chạy" (`deploy/alerts.yml:255-268`) | Sửa chữ alert/runbook trong PR 2; xem lại mức alert trước khi có người dùng thật |
| R4 | Mất tính năng: tự chọn model, ba công cụ còn chặn dưới UniWork AI, AI ngoại tuyến và Codex CLI trên desktop | Đã chấp nhận (§4) |
| R6 | App desktop cũ còn khóa trên máy (đường C) vẫn gọi thẳng nhà cung cấp; máy chủ không có cổng phiên bản tối thiểu cho app Office (chỉ có cho mobile, `server/internal/config/config.go:228`) | Chấp nhận bản cũ còn chạy tới khi người dùng cập nhật (app đang phát triển); không thêm cổng phiên bản tối thiểu. Thêm cổng khi có người dùng thật |
| R7 | Xóa nhầm mã dùng chung (`byokWriteIdle`, `transportReason`, `ErrProviderUnreachable`, phần cloud của `AIMountable`, helper test `byokHandlerRedis`, schema/hook cloud ở client, `proxy-url.ts` mount/error ở fork) | Danh sách "Giữ" ở §3.2, §3.4, §3.5, §3.7; build và test theo gói trước khi merge |
| R8 | Quên dòng `isoRoutes` hay `audit_coverage_test` → CI đỏ | Xóa cùng commit với route và hằng audit |
| R11 | Máy chủ gỡ route trong khi khung web vẫn là bản fork cũ → khung gặp 404, hiện `credentialsUnavailable` | PR 2 pin fork mới trong cùng PR (bước 1) |
| R12 | Sheets dưới UniWork AI có thể không chạy agent: `agentConfigured` trả `false` khi model rỗng (`apps/sheets/src/renderer/ai/agent-configured.ts:7-18` ở fork), mà ô `uniwork` luôn có `model:''` (`web-ai.ts:676`), nên lượt có thể rơi về bộ lập kế hoạch cố định. Chưa kiểm chạy thật | Kiểm và sửa trong PR 1 |

## 12. Quyết định của chủ sản phẩm

Theo hướng "không khắt khe", các câu Q-B2 → Q-B7 của bản v1 đã chốt như sau (chủ sản phẩm có thể bác):

| Câu v1 | Chốt ở v2 |
| --- | --- |
| Q-B2 — ba công cụ còn chặn dưới UniWork AI | Chấp nhận mất |
| Q-B3 — báo trước bao lâu | Không báo trước; chỉ changelog |
| Q-B4 — ưu đãi chuyển đổi | Không |
| Q-B5 — dòng "Khóa AI riêng cho Office" trên trang gói | Xóa, không thay, không đổi giá |
| Q-B6 — giữ khóa bao lâu | Không giữ; xóa trong cùng lần deploy |
| Q-B7 — chữ "BYOK" trên trụ cột landing (`vi.json:10730`, `en.json:10792`) | Bỏ |

Q-B1 đã có trả lời (2026-10-27):

- **Q-B1 — Có gỡ cả khóa trên máy và CLI của app desktop (đường C, ADR 0028 QĐ2) không?** Chủ sản phẩm chọn **(a) Gỡ**.
  App desktop mất AI ngoại tuyến và CLI cục bộ (Codex CLI); làm ở PR 1 hoặc PR 1b của fork (§5).

**Không còn câu nào chờ chủ sản phẩm.**

## 13. Để người xây dựng quyết

- Tên test mới.
- PR 1 và PR 1b (đường C) gộp hay tách.
- Câu chữ mới cho landing, trang hướng dẫn, pháp chế, theo `docs/conventions.md`.

## 14. Tham chiếu

- ADR 0028, 0029, 0034 (`docs/adr/`); ADR 0010, 0012.
- Spec Office G5/G6/G7 `docs/superpowers/specs/2026-10-02-office-g5-g6-g7-design.md` §8, §13.1 (G6-D2).
- Spec Hỏi UNI soạn tệp Office `2026-10-27-ask-uni-office-design.md` (worktree `ask-uni-docs-assessment`) §3, §5, Phần 5.
- Spec quản lý gói AI `docs/superpowers/specs/2026-10-18-ai-plan-management-uniwork.md` §5.7, §16.
- Hợp đồng G6-05k `docs/office/g5g6g7/contracts/g6-05k-org-keys-api.md`.
