# Gỡ BYOK — kế hoạch 1: khung web, "Khóa trên UniWork" và máy chủ Implementation Plan

> **Trạng thái:** in-progress — đã triển khai trên nhánh, chờ PR; kế hoạch 1 của spec gỡ BYOK, issue UNI-2289.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sau kế hoạch này UniWork không còn nhận, lưu, giải mã hay chuyển tiếp khóa AI của người dùng. Office trên web chỉ còn UniWork AI. App desktop mất đường "Khóa trên UniWork".

**Architecture:**
- **Fork `UNIAI-TEAM/uniwork-office` (PR 1).**
  - Gỡ đường A (khung web gọi `/ai/credentials` và proxy `/ai/byok`) và đường B (app desktop dùng khóa lưu trên UniWork).
  - Khung web chỉ còn nhà cung cấp `uniwork`. Credit hiện ở chip model như trên desktop.
  - Giao thức khung bỏ năng lực `ai`. Dữ liệu của frame cũ và host cũ không vỡ, vì khóa lạ bị bỏ qua.
  - Phát hành bản web mới.
- **UniWork (PR 2).**
  - Cấp quyền khung: công cụ đám mây đi theo `uniwork_ai`, không theo BYOK.
  - Gỡ route, service, proxy và provider BYOK.
  - Một migration bỏ bảng `ai_provider_credentials` và dòng gói `office.ai_byok`.
  - Gỡ lớp client không ai dùng, câu chữ landing và nửa `byok` của harness.
  - Viết ADR 0051. Pin lại bundle, vendor lại giao thức, chụp lại ảnh mẫu G7-06.
  - Hai PR lên cùng một lần deploy.
- **Ngoài kế hoạch này: đường C** (khóa trên máy và CLI cục bộ của app desktop, Q-B1 = a). Khảo sát cho thấy đường C còn các việc spec chưa quyết, nên nó thành kế hoạch 2 (xem cuối tài liệu). Máy chủ không phụ thuộc đường C. App desktop cũ và mới vẫn chạy với máy chủ sau kế hoạch này (spec R6).

**Tech Stack:**
- UniWork: Go (Chi, pgx/sqlc, migrations), TypeScript (`packages/core`, `packages/views`, `apps/web`), `node --test`.
- Fork: TypeScript (`web/modules/shared/ai`, `web/docs`, `packages/ai-provider`, `packages/ui`, `apps/*`), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-remove-byok-design.md` (v2): §2, §3.1–§3.8, §4, §5 (PR 1 và PR 2), §6, §7, §8, §9, §11.

**Khảo sát dùng cho kế hoạch** (2026-10-29, develop `87737a461`, fork `main` `d9a3c2b75`): số dòng bên dưới lấy từ hai lần khảo sát đó. Spec ghi số dòng cũ hơn; khi lệch, kế hoạch này đúng.

## Global Constraints

**Phạm vi và quyết định**
- Chỉ UniWork AI (ADR 0010; spec §1). Không thêm cờ, không thêm mã chuyển tiếp, không giữ route nào trả "đã gỡ".
- ADR mới là **0051** (`docs/adr/0051-ai-chi-chay-bang-uniwork-ai-go-byok.md`). 0048–0050 đã có chủ, nên mọi chỗ spec viết "0048" cho dự án này đọc là 0051.
- **Giữ, không xóa** (spec R7, đã kiểm người gọi):
  - `byokWriteIdle`: đổi tên thành `sseWriteIdle`, chuyển vào `server/internal/handler/sse.go` (người gọi `sse.go:87`).
  - `transportReason`: chuyển sang `server/internal/ai/provider/cloud.go` (người gọi `cloud.go:99,104`, `file_transcribe.go:247,252`).
  - `ai.ErrProviderUnreachable` (`errors.go:95`; người gọi `meeting_summarize.go:190`), `ErrCloudUnavailable`, `ErrMediaUnsupported`.
  - Nửa cloud của `AIMountable`: `Cloud*`, `UniworkChatCompletions`, `UniworkWrite`.
  - `FeatureOfficeAICloud`: chuyển sang `server/internal/service/ai_cloud.go`.
  - Helper test `byokHandlerRedis` (Redis DB 9) và `rawCall`: chuyển sang `server/internal/handler/ai_test_helpers_test.go`.
  - Schema, endpoint và hook cloud trong `packages/core`.
  - Dòng `ai_usage_events` cũ và nhãn `office_byok`, `office_byok_desktop` (`vi.json:1820-1821`, `en.json:1821-1822`): bảng sử dụng các tháng cũ còn đọc.
  - Dòng `audit_events` cũ; `.gitleaksignore`; nội dung ADR đã accepted (chỉ sửa dòng trạng thái).
  - `packages/office-upstream/` (bản Genspark gốc, không vào build sản phẩm): không đụng; ADR 0051 ghi lý do.
  - `packages/core/changelog/pending/*`: changelog do agent sinh lúc phát hành.
  - Ở fork: `isInsideAiMount` và `proxyErrorBodyFields` (`packages/ai-provider/src/proxy-url.ts:54,116`); `proxyAnswered` thì xóa (chỉ BYOK gọi).
- Dòng `isoRoutes` và mục `audit_coverage_test` xóa **cùng commit** với route và hằng audit (spec R8).
- Không đổi `review_at` của cờ nào. Bảy cờ `office_ai_uniwork*` vẫn mặc định tắt; bật ở môi trường dùng là điều kiện C3.

**Luật repo**
- Spec và kế hoạch bằng tiếng Việt; code comment tiếng Anh. Chữ giao diện qua i18n vi/en, sửa cả hai cùng lúc.
- Ở fork, mỗi khóa chữ bỏ đi phải rời mọi shard ngôn ngữ cùng lúc (`satisfies Record<keyof typeof zh, string>`).
- Không nhắc tên ClickUp ở bất cứ đâu.
- Chỉ chạy test hẹp (`-run`, `vitest run <path>`) trong khi làm. Không `make check`, không `go test ./...` toàn bộ trước khi xong mọi task; CI chạy toàn bộ.
- Go coverage floor là 74 (`server/coverage.floor`) và không bao giờ hạ. Nếu CI báo dưới sàn, thêm test cho mã mới (grant, helper đã chuyển), không hạ số.
- DB test: dùng DB mới `uniwork_askdocs_test`; `uniwork_test` dùng chung đang hỏng migrate.
- Commit theo `commit-msg` hook (`feat(scope)`, `fix(scope)`, `refactor(scope)`, `test(scope)`, `docs`, `chore(scope)`). Cuối thân commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Đẩy nhánh, mở PR, merge và phát hành là việc ra ngoài. Controller hỏi chủ sản phẩm trước từng bước.

## Review Focus

1. **Tổ chức có `office.ai_cloud` nhưng cờ `office_ai_uniwork` tắt.** Khung không có panel AI, không có công cụ đám mây, không gọi route nào đã gỡ. Trình soạn và Lưu vẫn chạy. Test ở Task 4 (grant) và Task 2 (khung ẩn AI khi thiếu `uniworkAi`).
2. **UniWork AI trả 403 hoặc 402 `credits_exhausted` giữa phiên trên web.** Panel ẩn (403) hoặc hiện ghi chú hết credit (402). Không bao giờ hiện gợi ý "thêm khóa". Test ở Task 1.
3. **App desktop bản cũ (còn đường B) gọi máy chủ mới.** `GET /api/v1/orgs/{id}/ai/credentials` với bearer thiết bị hợp lệ trả 404, không 401, 405 hay 500. App coi là "không có khóa tổ chức"; UniWork AI và công cụ đám mây vẫn chạy. Test ở Task 5.
4. **Môi trường đã có dòng khóa** (dev, staging). Migration up bỏ bảng sạch. Down dựng lại đúng lược đồ, để chuỗi down cũ vẫn chạy về tới 004. Test ở Task 6.
5. **Người dùng web xem credit sau khi hộp thoại khóa biến mất.** Chip model hiện số credit còn lại như desktop; dòng "quản lý" của chip không còn trên web. Test ở Task 2.

---

## Phần A — Fork `UNIAI-TEAM/uniwork-office` (PR 1)

Làm trong clone fork của controller, nhánh `feature/UNI-2289-remove-byok` tách từ `origin/main` mới nhất. Lệnh fork chạy ở gốc clone. Nhánh ODF `feature/UNI-2279-genoffice-odf` chưa merge và có thể đụng chữ ở `apps/docs/src/main/docs-main.ts` và `apps/shell/src/main/index.ts`. Rebase lên `main` ngay trước khi mở PR.

### Task 1: Lõi AI của khung web chỉ còn `uniwork`

**Files:**
- Modify: `web/modules/shared/ai/web-ai.ts`, `client.ts`, `stream.ts`, `errors.ts`, `ui.ts`
- Delete: `web/modules/shared/ai/transport.ts`
- Modify: `packages/ai-provider/src/proxy-url.ts`, `packages/ai-provider/src/index.ts:50-56` (exports)
- Modify: `web/modules/shared/i18n/ai-web/*.ts` (20 shard + aggregator)
- Test: `web/modules/shared/ai/ai.test.ts`, `packages/ai-provider/tests/proxy-url.test.ts`, `web/modules/shared/i18n/strings-ai-web.test.ts`

**Interfaces:**
- Produces: `aiHostGrants(grants)` trả `ai = uniworkAi` và không còn khóa `aiCredentials`. `settings()` trả đúng một provider `uniwork`, slot `{ apiKey: '…', model: '' }` và `uniworkModel` đọc từ `GET …/ai/cloud`. `choose()` và `setAiSettings()` thành no-op trên web. `turnUniworkOff()` đặt `caps.ai = false` vô điều kiện.
- Produces: `client.ts` còn `cloudStatus`, `search`, `generateImage`, `analyzeMedia`, `transcribe`, `uniworkChat`, `uniworkWrite`.
- Produces: `proxy-url.ts` còn `isInsideAiMount` và `proxyErrorBodyFields`.

Xóa, theo khảo sát:
- `web-ai.ts`:
  - nửa BYOK của `aiHostGrants` (`:74-95`) và của activation (`byokGranted` `:341`, `cloudWanted` `:357-361`);
  - `watchForeground` (`:522-530`);
  - `listCredentials` trong `load()` (`:403`);
  - liệt kê model nền (`:448-519`, state `:309-318`, `modelIdsOf` `:179-188`, TTL `:237-243`);
  - nửa BYOK của `settings()`, `serverDefaultProvider`, `saveModel` (`:625-795`);
  - `WEB_PROVIDER_IDS` (`:108-110`), `openSettings`, `openAiSettings`, `openAiModelSettings` (`:809-831`, `:1156-1158`).
  - `aiGskLogin` (`:1068`) thành no-op, vì web luôn đã đăng nhập.
- `client.ts`: kiểu, bộ đọc và method của khóa và proxy (`:29-61`, `:210-240`, `:290-302`) cùng comment `:9-14`, `:23-24`.
- `stream.ts`:
  - `proxyConfig`, `installProxyTransport`, `resolveWebEndpoint`, `missing`, `modelRequired`, `errorCodeOf` (`:126-185`);
  - nhánh không-`uniwork` của `aiStream`, `aiChat`, `runTurn` (`:384-453`, `:470-510`, `:528-560`);
  - import vendor (`:17-38`).
  - Lượt `uniwork` (`:215-378`) giữ nguyên.
- `errors.ts`: mã `credential_missing`, `provider_auth_failed`, `provider_not_supported`, `base_url_refused`, `model_required` (`:36-52`); `rawFailureAsTyped` (`:183-190`); `isContractFailure` (`:196`, không ai gọi).
- `ui.ts`: hộp thoại khóa (`:141-458`), các dòng `settings: true` của `STATES` (`:38-62`) và nút "AI settings" trong `showAiState` (`:126-137`). Khối credit `renderCloud` (`:399-420`) không chuyển sang đây; Task 2 hiện credit ở chip.
- `proxy-url.ts`: `toProxyRequest`, `ProxyUrlError`, `isProxy404`, `proxyAnswered`, `isProxyContractStatus`, `PROXY_402_503_CODES`, phần viết lại URL (`:69-111`).
- `transport.ts`: cả tệp.
- i18n `ai-web`: các khóa chỉ hộp thoại, trạng thái khóa và chọn nhà cung cấp dùng (khoảng 24/48 khóa), ở mọi shard.

- [ ] **Step 1: Viết lại test cho trạng thái mới (fail trước khi sửa).** Trong `ai.test.ts`:
  - "Grant formula": `aiHostGrants({ ai: true, uniworkAi: false })` → `ai === false`; `aiHostGrants({ uniworkAi: true })` → `ai === true`, và kết quả không có khóa `aiCredentials`.
  - Activation có `uniworkAi` → `fetch` chỉ chạm `…/ai/cloud` và `…/ai/uniwork/*`; không request nào có `/ai/credentials` hay `/ai/byok/`.
  - `settings()` → `Object.keys(s.providers)` là `['uniwork']`, `s.provider === 'uniwork'`.
  - Lượt chat gặp 403 trước khi chạy → panel tắt (`caps.ai === false`), không gọi route nào khác.
  - 402 `credits_exhausted` → trạng thái `credits-exhausted`, không có dòng `STATES` nào mở cài đặt.
  - Bỏ các khối test proxy, khóa, liệt kê model, hộp thoại và stream BYOK (khoảng 75 test). Chuyển `aiRun` (`:516`, `:539`) sang `uniwork`.
  - `proxy-url.test.ts`: còn đúng hai test `isInsideAiMount` và `proxyErrorBodyFields`.
- [ ] **Step 2: Chạy, xác nhận fail** — `npx vitest run --root web/modules shared/ai` và `npm run test -w @genoffice/ai-provider -- proxy-url`.
- [ ] **Step 3: Sửa** theo danh sách xóa ở trên. `grep -rn "byok\|/credentials\|createProxyFetch\|toProxyRequest" web/modules/shared packages/ai-provider/src` chỉ còn các dòng cloud và comment lịch sử đã sửa chữ.
- [ ] **Step 4: Chạy lại** Step 2, cùng với:
  - `npm run test -w @genoffice/ai-provider`;
  - `npx vitest run web/modules/shared/i18n`;
  - `npm run typecheck:web`.

  Tất cả PASS.
- [ ] **Step 5: Commit** — `refactor(web-ai): the web frame runs UniWork AI only; drop the key store and the BYOK proxy (UNI-2289)`.

### Task 2: Năng lực khung, panel, giao thức và e2e web

**Files:**
- Modify: `web/docs/protocol/types.ts` (bỏ `'ai'` khỏi union `Capability` và `CAPABILITY_KEYS`; chữ ở `:259-270`, `:852`), `web/docs/protocol/README.md:101-102,354-370`
- Modify: `web/modules/shared/ai/web-ai.ts:65-72` (`AI_FRAME_CAPABILITIES` không còn claim `ai`)
- Modify: `web/docs/bridge/hide.ts:63,86`, `module-bridge.ts:132-133,204`, `web/modules/sheets/capabilities.ts:19,80-88`, `web/modules/README.md:27,52`
- Modify: `apps/docs/src/shared/ipc.ts:357`, `apps/markdown/src/renderer/capabilities.ts:8,26`, `apps/sheets/src/renderer/capabilities.ts:13,38`
- Modify: `apps/docs/src/renderer/ai/AiPanel.tsx:1877`, `apps/markdown/src/renderer/ai/AiPanel.tsx:289-291,1508`, `apps/html/.../AiPanel.tsx:361`, `apps/pdf/.../AiPanel.tsx:172`, `apps/slides/src/renderer/ai/AiPanel.tsx:459`, `apps/sheets/src/renderer/ai/AiChatPanel.tsx:302,816`, `apps/sheets/src/renderer/App.tsx:1845-1847`
- Modify: `apps/sheets/src/renderer/ai/agent-configured.ts`
- Modify: `packages/ui/src/AiModelPicker.tsx:336`, `packages/ai-provider/src/types.ts:212`
- Modify: `web/server/fake-ai.mjs` (bỏ route `byok`, `credentials`), `web/server/test-host/host.js:298-306` (`ai=1` thành bí danh của `uniwork=1`)
- Test: `web/docs/bridge/hide.test.ts`, `frame-capabilities.test.ts`, `web/docs/protocol/test/types.test.ts:36`, `protocol.test.ts:35,110`, `web/modules/sheets/ai.test.ts`, `apps/sheets/tests/agent-configured.test.ts`, `packages/ui/tests/*`, `web/e2e/{ai-web,sheets-ai,ai-save-confirm,pdf-web,ai-composer-390,ai-panel-phone,docs-readonly-narrow}.spec.ts`

**Interfaces:**
- Consumes: Task 1 `aiHostGrants` (không còn `aiCredentials`), `client.cloudStatus`.
- Produces: năng lực khung `uniworkAi`, `aiStart`, `webSearch`, `imageSearch`, `imageGeneration`; không còn `ai` ở giao thức. Bên trong renderer, `caps.ai` (panel bật) vẫn là cờ nội bộ, bằng `uniworkAi`.
- Produces: `agentConfigured(settings: AiSettings | null | undefined): boolean`. Bỏ tham số `webCredentials` và nhánh `isOrgServedReady`.
- Produces: protocol mới đổi `protocolSha256.protocol`, nên Task 9 vendor lại.

Quyết định:
- **Credit trên web:** panel web thôi đặt `requireModel` (chỉ là gợi ý "cần khóa"). Chip đọc trạng thái cloud qua cầu trạng thái cloud của cửa sổ, do `publishCloudStatus` (`web-ai.ts:550-572`) cấp. Nếu cầu đó chưa nối trên web thì nối trong task này.
- **Dòng "quản lý" của chip:** ẩn trên web, vì `openModelSettings` không còn đích.
- **Nút cài đặt khóa trong panel:** xóa. Nút đang gác bởi `cap('aiCredentials')` nên desktop không đổi.

- [ ] **Step 1: Viết test fail.**
  - `frame-capabilities.test.ts`: frame `ready` không claim `ai`; host chỉ cấp `uniworkAi` → panel mở, ba công cụ cloud theo grant riêng; host không cấp `uniworkAi` → không panel, không công cụ cloud, kể cả khi host gửi `ai: true` (khóa lạ bị bỏ qua).
  - `agent-configured.test.ts`: `agentConfigured({ provider: 'uniwork', providers: {...} })` → `true`; mọi provider khác → `false` trên web.
  - Test `packages/ui`: chip web nhận trạng thái cloud `{ credits: { remaining: 380000, limit: 500000 } }` → hiện chữ `cloudCreditsLeft` với hai số đó; trên web không có dòng "quản lý".
  - e2e (chạy ở Step 4):
    - đổi seed `ai=1` sang `uniwork=1`;
    - xóa `ai-composer-390.spec.ts` (nó kiểm gợi ý cần khóa) cùng hai test cài đặt khóa (`ai-web.spec.ts:247`, `sheets-ai.spec.ts:370`);
    - `ai-save-confirm.spec.ts` seed bằng `uniwork=1` thay cho `credentials: OPENAI_KEY`;
    - thêm vào `ai-web.spec.ts` một test: mở panel và gửi một lượt, không request nào khớp `/ai/credentials` hay `/ai/byok/`.
- [ ] **Step 2: Chạy, xác nhận fail** — `npm run test:web` và `npx vitest run apps/sheets/tests/agent-configured.test.ts`.
- [ ] **Step 3: Sửa** theo Files và Quyết định.
- [ ] **Step 4: Chạy lại**:
  - `npm run test:web`, `npm run typecheck`, `npm run typecheck:web`, `npm run lint`, `npm run test -w @genoffice/ui`;
  - `npm run build:web -- --all`;
  - `WEB_E2E_REQUIRE_BUILD=1 npx playwright test -c web/e2e ai-web sheets-ai ai-save-confirm pdf-web ai-panel-phone docs-readonly-narrow modules-smoke`.

  Tất cả PASS.
- [ ] **Step 5: Commit** — `refactor(web): drop the ai capability and the key settings from the web frame; credits show in the model chip (UNI-2289)`.

### Task 3: App desktop bỏ "Khóa trên UniWork" (đường B)

**Files:**
- Delete:
  - `apps/shell/src/main/uniwork-auth/keys.ts`, `keys-credentials.ts`, `keys-errors.ts`, `keys-wiring.ts`;
  - `apps/docs/src/main/ai-org-route.ts`;
  - `apps/shell/tests/uniwork-keys.test.ts`, `uniwork-keys-wiring.test.ts`;
  - `packages/ui/tests/ai-model-picker-org-note.test.ts`, `e2e/uniwork-org-keys.spec.ts`.
- Modify:
  - `apps/shell/src/main/uniwork-auth/index.ts` (`:59`, `:85`, `:386-426`, `:435`, `:460`, `:543`, `:617`);
  - `apps/docs/src/main/docs-main.ts`: import `:16-25`, `:3962`, `:4077-4088`, `:4096-4141`, `:4200-4210`, `:4271-4323`, `:4502-4552`, `:4566-4572`, `:4905-4910`;
  - `packages/ai-provider/src/providers.ts:463-467,486-488`, `types.ts:162-163`, `index.ts:37`, `browser.ts:21`;
  - `apps/shell/src/renderer/src/my-ai-activation.ts:13,22`;
  - `packages/ui/src/strings-ai-model-picker.ts` (khóa `orgKey*`, mọi locale), `AiModelPicker.tsx:139,290-310,451-460,661-691,785`;
  - `apps/shell/src/renderer/src/SettingsModal.tsx:638-695,864-865,921-980`.
- Test (viết lại phần khóa tổ chức): `apps/shell/tests/settings-ai-model-list.test.ts`, `packages/ui/tests/ai-model-picker-data.test.ts`, `apps/docs/tests/uniwork-ai-choice.test.ts:139,149`, `apps/shell/tests/my-ai-activation.test.ts`, `packages/ai-provider/tests/providers.test.ts`, `effective-model.test.ts`.

**Interfaces:**
- Consumes: không có gì từ Task 1–2.
- Produces: không còn `origin: 'org'`, `isOrgServedReady`, `installOrgFetchDispatcher`, `resolveAiRoute`. Lượt AI desktop chỉ đi một trong hai đường: provider trên máy (đường C, kế hoạch 2 gỡ), hoặc `uniwork` qua `setUniworkAiHost` (`docs-main.ts:4247-4268`).

- [ ] **Step 1: Viết test fail.**
  - `providers.test.ts`: danh sách provider không còn mục `origin: 'org'` dù có nguồn khóa tổ chức.
  - `settings-ai-model-list.test.ts`: Cài đặt AI không có nhóm "Khóa trên UniWork".
  - `uniwork-ai-choice.test.ts`: lựa chọn đã lưu trỏ vào một slot khóa tổ chức rơi về lựa chọn mặc định, không gọi `/api/v1/orgs/{id}/ai/credentials`.
- [ ] **Step 2: Chạy, xác nhận fail** — `npm run test -w @genoffice/ai-provider`, `npm run test -w @genoffice/shell`, `npm run test -w @genoffice/docs`.
- [ ] **Step 3: Sửa** theo Files. `grep -rn "ai/credentials\|origin === 'org'\|orgKey\|isOrgServedReady" apps packages` → rỗng.
- [ ] **Step 4: Chạy lại** Step 2, cùng với:
  - `npm run test -w @genoffice/ui`, `npm run typecheck`, `npm run lint`;
  - `npm run check:egress && npm run check:brand && npm run test:rebrand && npm run legal:check`.

  Tất cả PASS.
- [ ] **Step 5: Commit** — `refactor(shell): remove the "Key on UniWork" route from the desktop app (UNI-2289)`.
- [ ] **Step 6: Việc ra ngoài, controller hỏi chủ sản phẩm trước:**
  1. rebase lên `origin/main`, chạy lại Step 4 của Task 2 và Task 3;
  2. đẩy nhánh và mở PR vào `main`, tiêu đề `UNI-2289: gỡ BYOK khỏi khung web và "Khóa trên UniWork" của app desktop`;
  3. thân PR nêu: hành vi mới, giao thức bỏ `ai` (host vendor lại), credit lên chip, việc chưa làm (đường C, kế hoạch 2), test đã chạy;
  4. ghi chú phát hành app desktop: "Bỏ mục Khóa trên UniWork; AI dùng UniWork AI hoặc khóa trên máy".

### Bước của chủ sản phẩm (sau Task 3)

1. Review và merge PR fork.
2. Build tại commit đã merge như lần `web-0.1.0-8d73c6b`:
   - Docker `linux/arm64`, `npm ci && npm run build:web -- --all`, gồm Sheets wasm;
   - đóng gói `dist-web-0.1.0-<sha>.tar.gz`, tạo pre-release `web-0.1.0-<sha>` trên fork.
   Chủ sản phẩm có thể giao việc build cho phiên này.
3. Đưa URL tarball và `sha256` cho phiên này.

Task 4–8 không cần bản phát hành nên làm trong lúc chờ. Task 9 cần.

---

## Phần B — UniWork (PR 2)

Nhánh `feature/UNI-2289-…` do `make issue-start KEY=UNI-2289` tạo từ `develop`.

### Task 4: Cấp quyền khung — công cụ đám mây đi theo UniWork AI

**Files:**
- Modify: `server/internal/handler/office_frame_ai.go:11-25,37-75`
- Modify: `server/internal/handler/dto/sdo/office_frame.go:99-111` (bỏ `AI bool json:"ai"`; sửa mô tả ba trường cloud và `UniworkAI`)
- Modify: `packages/core/api/endpoints/office-frame.ts:19-28`
- Modify: `packages/views/office/frame/docs-frame-session-model.ts:286-323` (bỏ `ai`; `cloud = uniworkAi`; sửa doc comment). `docs-frame-init.ts:63` giữ nguyên: `minted.ai` là cả object grant, không phải cờ BYOK.
- Modify (harness đọc grant của token): `scripts/office/g5g6g7/g7-06/capture/web.mjs:29-32,45`, `g7-06/job-lib.mjs:148-161`, `scripts/office/devset-run.mjs:1418,1423,1441`
- Test:
  - `server/internal/handler/office_frame_ai_test.go`, `packages/core/api/endpoints/office-frame.test.ts:66-90`;
  - `packages/views/office/frame/docs-frame-session-model.test.ts:18-44`, `office-module-frame.test.tsx:402-470`;
  - `scripts/office/g5g6g7/g7-06/capture.test.mjs:696-735`, `test-cases/golden.cases.mjs:489-513`, `test-fixtures/fake-capture.mjs:67`.

**Interfaces:**
- Produces: `func (h *handlers) officeFrameAIGrant(ctx context.Context, claims service.OfficeFrameClaims) sdo.OfficeFrameAIGrantSDO`. Kiểu trả về chỉ còn `WebSearch`, `ImageSearch`, `ImageGeneration`, `UniworkAI`. Ba trường cloud chỉ bật khi đủ cả ba điều kiện:
  - `UniworkAI == true`;
  - `AICloud.Status` không lỗi;
  - `status.Enabled`.
  Khi đó lấy từ `status.Tools.{WebSearch, ImageSearch, ImageGenerate}`. Hàm không đọc gì của BYOK.
- Produces: `officeFrameAIGrantSchema` (zod) không còn `ai`. Kiểu `OfficeFrameAIGrant` theo schema.
- Produces: `officeModuleCapabilities(...)` trả `uniworkAi`, `aiStart`, `webSearch`, `imageSearch`, `imageGeneration` và không trả `ai`. Công cụ cloud chỉ bật khi có `uniworkAi`. Giao thức vendor hiện tại vẫn có khóa `ai` (tùy chọn); Task 9 vendor lại bản đã bỏ nó.
- Produces: harness G7-06 đọc `uniworkAi` thay cho `ai || uniworkAi`.

- [ ] **Step 1: Viết test fail.**
  - `TestOfficeFrameCloudToolsFollowUniworkAI` (`office_frame_ai_test.go`): tổ chức có `office.ai_cloud`, gateway có model và tất cả công cụ, cờ `office_ai_uniwork` cùng cờ định dạng bật, không cấu hình BYOK → token có `uniwork_ai`, `web_search`, `image_search`, `image_generation` đều `true` và không có khóa `ai` trong JSON. Tắt `office_ai_uniwork` → bốn trường `false`. Bỏ `office.ai_cloud` → bốn trường `false`.
  - Viết lại `TestOfficeFrameTokenCarriesTheAIGrant` và `TestOfficeFrameGrantsUniworkAIWithoutBYOK` theo kiểu mới.
  - `office-frame.test.ts`: payload có `ai: true` vẫn parse được, kết quả không có `ai`; thiếu trường cloud thì `false`.
  - `docs-frame-session-model.test.ts`: grant `{ uniwork_ai: false, web_search: true }` → không `uniworkAi`, không `webSearch`. Grant `{ uniwork_ai: true, web_search: true }` → cả hai `true`. Kết quả không có khóa `ai`.
  - `office-module-frame.test.tsx`: ca `ai: true` đổi thành `uniwork_ai: true`; giữ ca chỉ `uniwork_ai` (`:425-429`).
  - `capture.test.mjs`: token không có `uniwork_ai` → `capture_ai_off`.
- [ ] **Step 2: Chạy, xác nhận fail**:
  - `cd server && go test ./internal/handler -run 'OfficeFrame'`;
  - `pnpm --filter @uniwork/core exec vitest run api/endpoints/office-frame`;
  - `pnpm --filter @uniwork/views exec vitest run office/frame`;
  - `node --test scripts/office/g5g6g7/g7-06/*.test.mjs`.
- [ ] **Step 3: Sửa.** Bỏ nhánh `h.AIBYOK`/`h.AICredentials` (`:60-67`). Sửa comment `:11-25` và `:37-45` thành mô tả mới. Sửa session model, harness G7-06 và `devset-run.mjs` (bỏ `ai: true`).
- [ ] **Step 4: Chạy lại** Step 2 → PASS. Chạy thêm `pnpm --filter @uniwork/core typecheck` và `pnpm --filter @uniwork/views typecheck` → PASS.
- [ ] **Step 5: Commit** — `fix(office): grant the frame's cloud tools with UniWork AI, not with BYOK`.

### Task 5: Gỡ BYOK ở máy chủ

**Files:**
- Delete:
  - `server/internal/service/ai_byok.go`, `ai_credentials.go`;
  - `server/internal/ai/proxy.go` (cả tệp), `byok_credential.go`;
  - `server/internal/ai/provider/byok.go`, `byok_client.go` (sau khi chuyển `transportReason`);
  - `server/internal/handler/ai_byok.go` (sau khi chuyển `byokWriteIdle`), `ai_credentials.go`;
  - `server/internal/handler/router/ai_byok.go`, `ai_credentials.go`;
  - `server/internal/handler/dto/sdi/ai_byok.go`, `sdi/ai_credentials.go`, `sdo/ai_byok.go`, `sdo/ai_credentials.go`.
- Delete (test): `ai/provider/byok_test.go`, `byok_idle_test.go`, `ai/proxy_test.go`, `handler/ai_byok_test.go`, `ai_byok_stream_test.go`, `ai_credentials_test.go`, `service/ai_credentials_test.go`, `ai_byok_test.go`, `router/ai_byok_ratelimit_test.go`, `ai_credentials_ratelimit_test.go`
- Create: `server/internal/handler/ai_test_helpers_test.go` (`byokHandlerRedis` đổi tên `aiHandlerRedis`, DB 9; `rawCall`), `server/internal/handler/router/provider_keys_gone_test.go`
- Modify:
  - `server/internal/ai/gateway.go:165-166,180`; `ai/errors.go:90-94` (bỏ bốn mã proxy; sửa comment L90);
  - `handler/sse.go`;
  - `handler/ai_mount.go:15-19,35-58,70-76,87`;
  - `handler/router/router.go`:
    - CORS `:170-176`;
    - bucket `:264-265`;
    - `registerAIBYOK` `:289`, `registerAICredentials` `:370`;
    - comment `:201`;
  - `handler/router/office_frame_ai.go:14-17,19-43,49-50,56-89`;
  - `handler/router/routes.go:415-418,756-762,792-795`; `handler/router.go:84-85,119-121,690-693,1015-1021,1046-1048`;
  - `handler/router/openapi.go:381-384,579-582`;
  - `service/entitlement.go:48`, `service/ai_cloud.go` (nhận `FeatureOfficeAICloud`);
  - `audit/actions.go:337-341`;
  - `cmd/server/main.go:857-870,994,1008`;
  - `middleware/loadshed.go:21`;
  - `featureflags/keys.go:71` (bỏ "(BYOK is unaffected)"); `dto/sdo/office_capabilities.go:18` (bỏ "(BYOK không đổi)");
  - comment nhắc BYOK: `handler/ai_uniwork.go:113`, `ai/openai_facade_writer.go:23`, `ai/cloud.go:18,267`, `ai/cloud_audio.go:10`, `service/ai_cloud.go:20`, `service/meeting_transcriptions.go:390`, `handler/router/ai_cloud.go:10`, `ai/conversation_store.go:31`;
  - `.env.example:237-245` (bỏ `AI_CREDENTIAL_KEY` và câu nhắc nó; giữ khóa hội thoại UniWork AI).
- Modify (test):
  - `handler/office_frame_ai_test.go`: world không còn `NewBYOKClient`, `NewAIBYOKService` (`:43-89`); bảng route `:119-122`;
  - `handler/isolation_routes_test.go`: `reasonBYOKVendor` `:408`; dòng route `:716-719`, `:783`, `:878-882` và các dòng GET/DELETE kề;
  - `handler/isolation_office_test.go`: `:29-37`, seed `:59-60`, `isoAICredentialPut` `:271-276`; `isolation_matrix_test.go:796-798`;
  - `service/audit_coverage_test.go:2016-2030,3179-3180`;
  - `router/ai_uniwork_ratelimit_test.go:16,46` (đổi route BYOK sang một route cloud);
  - `router/router_test.go:283-300` (xóa `TestCORSPreflightAllowsTheForwardedVendorHeaders`);
  - `router/office_frame_ai_test.go:46-55,88,100-126`: viết lại test ngân sách quanh `cloud` (20/phút) và `uniwork` (60/phút);
  - `handler/ai_mount_test.go:3-4,27-33,46-52,123-126`; `middleware/ratelimit_degraded_test.go:190-196`; `middleware/loadshed_test.go:118-120`;
  - `handler/auth_test.go:141,188,190`; `handler/document_access_requests_test.go:268`.

**Interfaces:**
- Consumes: Task 4 (`officeFrameAIGrant` không còn đọc `h.AIBYOK`).
- Produces: `Deps` không còn `AIBYOK`, `AICredentials`. `AIMountable` chỉ còn phần cloud và `uniwork`. `ai.Gateway` không còn `Proxy`, `SetBYOKClient`, `ValidateBYOKBaseURL`. Không còn bucket `ai-credentials`, `ai-byok`. `AI_CREDENTIAL_KEY` không còn được đọc.

- [ ] **Step 1: Viết test fail.**
  - `TestNoProviderKeyRoutes` (`router/provider_keys_gone_test.go`, theo mẫu `TestTimelineRouteIsGone`): `chi.Walk` trên `New(Deps{...}, stubRoutes())`; route nào chứa `/ai/credentials` hay `/ai/byok/` (mount phiên lẫn mount khung) làm test fail.
  - `TestOldDesktopKeyListIsNotFound` (`handler/office_frame_ai_test.go` hoặc một tệp handler mới): bearer phiên thiết bị hợp lệ gọi `GET /api/v1/orgs/{orgID}/ai/credentials` → 404; `POST /api/v1/orgs/{orgID}/ai/byok/openai/chat/completions` → 404. Không request nào tới nhà cung cấp.
- [ ] **Step 2: Chạy, xác nhận fail** — `cd server && go test ./internal/handler/router -run 'NoProviderKeyRoutes'` và `go test ./internal/handler -run 'OldDesktopKeyList'`.
- [ ] **Step 3: Gỡ** theo Files. Chuyển `transportReason`, `byokWriteIdle` (thành `sseWriteIdle`), `FeatureOfficeAICloud` và hai helper test **trước** khi xóa tệp chứa chúng. Cùng commit: dòng `isoRoutes`, seed của world cách ly, mục `audit_coverage_test`. `grep -rn "byok\|BYOK\|AICredential\|AI_CREDENTIAL_KEY\|ProxySurface" server --include=*.go` chỉ còn tên nhãn capability lịch sử nếu có.
- [ ] **Step 4: Chạy lại**:
  - `cd server && gofmt -l . && go vet ./... && go tool staticcheck ./... && go build ./...`;
  - `go test -count=1 ./internal/ai/... ./internal/handler/router/... ./internal/middleware/...`;
  - `go test -count=1 ./internal/handler -run 'OfficeFrame|AIMount|MountedAI|AICloud|AIUniwork|OldDesktopKeyList|Isolation|DocumentAccessRequest|Auth'`;
  - `go test -count=1 ./internal/service -run 'AICloud|AIUniwork|AuditCoverage|Entitlement'`;
  - `go test -count=1 ./internal -run 'Arch|Provider|AIPackage'`;
  - `node --test scripts/env-example.test.mjs`.

  Tất cả PASS.
- [ ] **Step 5: Commit** — `refactor(ai): remove the BYOK key store, proxy routes and vendor client from the server`.

### Task 6: Migration bỏ bảng khóa và dòng gói `office.ai_byok`

**Files:**
- Create: `server/migrations/999<unix-ms>_drop_ai_provider_credentials.up.sql` và `.down.sql` (tiền tố lớn hơn `9991793208463660`)
- Delete: `server/pkg/db/queries/ai_credentials.sql`; `make sqlc` xóa `server/pkg/db/generated/ai_credentials.sql.go` và struct `AiProviderCredential` (`models.go:209`)
- Modify: `server/internal/service/tenant_export_tables.go:18`
- Modify: `apps/web/features/landing/pricing-catalog.ts:10`, `pricing-catalog.test.ts:4`, `e2e/landing-pricing-catalog.spec.ts:17`
- Modify: `packages/core/i18n/locales/vi.json:1419,11501`, `en.json:1420,11563` (xóa hai bản nhãn `office_ai_byok`)
- Create (test): `server/migrations/provider_credentials_gone_test.go`

**Interfaces:**
- Produces: DB đã migrate không có bảng `ai_provider_credentials`, không có dòng `features.key = 'office.ai_byok'`, không có `plan_features.feature_key = 'office.ai_byok'`.

Nội dung migration:
- Up:
  ```sql
  DELETE FROM plan_features WHERE feature_key = 'office.ai_byok';
  DELETE FROM features WHERE key = 'office.ai_byok';
  DROP TABLE IF EXISTS ai_provider_credentials;
  ```
- Down: `CREATE TABLE IF NOT EXISTS ai_provider_credentials (…)`.
  - Lược đồ là bản ghép của `9991791524388000_….up.sql:9-25` (gồm CHECK `created_by_kind`) và hai cột của `9991791705198089_….up.sql`.
  - Không dựng lại unique index: luật `CONCURRENTLY` cấm làm việc đó trong tệp này, và down của index dùng `IF EXISTS`.
  - Chèn lại dòng `features` và `plan_features` như `9991791524388002_office_ai_features.up.sql:6-16`, có `ON CONFLICT DO NOTHING`.
  - Down không khôi phục được khóa đã xóa (spec §10).

- [ ] **Step 1: Viết test fail** — `TestNoProviderCredentialTable` (DB đã migrate):
  - `to_regclass('public.ai_provider_credentials') IS NULL`;
  - đếm `features` có `key = 'office.ai_byok'` bằng 0;
  - đếm `plan_features` có `feature_key = 'office.ai_byok'` bằng 0.
- [ ] **Step 2: Chạy, xác nhận fail** — `cd server && go test -count=1 ./migrations -run 'NoProviderCredentialTable'`.
- [ ] **Step 3: Viết migration**, xóa tệp query, chạy `make sqlc`, xóa dòng `tenant_export_tables.go:18`. Bỏ `office.ai_byok` khỏi danh sách so sánh landing và hai bản nhãn i18n. Còn 4 khóa, nên luật `rows.length >= 3` vẫn đúng.
- [ ] **Step 4: Chạy lại**:
  - `go test -count=1 ./migrations/...` (gồm chuỗi down/up của `migrate_test.go` và lint migration);
  - `go test -count=1 ./internal/service -run 'TenantExport'`;
  - `go build ./...`;
  - `pnpm --filter @uniwork/web exec vitest run features/landing`;
  - `node --test scripts/i18n-landing-keys.test.mjs`.

  Tất cả PASS. Trước khi chạy, chèn một dòng khóa giả vào DB test (Review Focus 4): up vẫn chạy sạch.
- [ ] **Step 5: Commit** — `feat(db): drop ai_provider_credentials and the office.ai_byok plan feature`.

### Task 7: Client, câu chữ và harness

**Files:**
- Modify:
  - `packages/core/types/ai-office.ts:8-48`;
  - `packages/core/api/endpoints/ai-office.ts` (`EMPTY_CREDENTIALS` L30, `byokProxyBaseUrl` L49, list/save/delete L53-91);
  - `packages/core/ai/office-hooks.ts:6,11,15-43`;
  - test `ai-office.test.ts:33-100`, `office-hooks.test.tsx:38-41,57-76`.
- Modify: `apps/web/platform/office-frame/frame-asset-rewrites.mjs:48-50`, `frame-asset-rewrites.test.ts:60-63`
- Modify (câu chữ, vi và en cùng lúc):
  - `trustAi` `vi.json:12174`/`en.json:12236`;
  - `ai.account.description` `vi.json:12268`/`en.json:12330`;
  - `connection.ai.description` `vi.json:12285`/`en.json:12347`;
  - FAQ `a4` `vi.json:12314`/`en.json:12376`;
  - `landing.why.pillar4Desc` `vi.json:11613`/`en.json:11675` (bỏ chữ "BYOK");
  - `apps/web/features/landing/guide-content.ts:31,41,79,85` (xóa mục khóa riêng);
  - `apps/web/features/landing/privacy-content.ts:59,94,153,188`.
- Modify (harness):
  - `scripts/office/g5g6g7/harness/lib.mjs:82-88,135-137`, `lib.test.mjs:16,108-117`;
  - `harness/README.md:94-101`, `readme-blocks.test.mjs:99-102`;
  - G7-08: `g7-08/rows.mjs:20`, `rows.test.mjs:135,140`, `run-g7-08.mjs:41`, `preconditions.mjs:205,228,339,401,408,444`, `web-driver.mjs:1,392-399`, `wire-observe.mjs:108-127,178,242`, `wire-observe.test.mjs:52-133,280-295`, `run-g7-08-wire.test.mjs:185-189`, `g7-08/README.md:14,46`.

**Interfaces:**
- Consumes: Task 5 (route khóa đã mất).
- Produces: `@uniwork/core` không còn export `AiOfficeProvider*`, `AiCredential*`, `SaveAiCredentialInput`, `byokProxyBaseUrl`, `useAiCredentials`, `useSaveAiCredential`, `useDeleteAiCredential`, `aiOfficeKeys.credentials`. Ma trận G7-08 chỉ còn nhà cung cấp `uniwork`.

Câu chữ mới theo `docs/conventions.md`: AI trong Office chạy bằng UniWork AI và tính vào credit của gói; không nhắc khóa riêng. Câu ở `privacy-content.ts` bỏ hẳn ý "khóa API AI riêng, mã hóa khi lưu".

- [ ] **Step 1: Viết test fail.**
  - `ai-office.test.ts` chỉ còn các ca cloud; thêm assertion: module `api/endpoints/ai-office` không export `byokProxyBaseUrl`.
  - `rows.test.mjs`: `PROVIDERS` là `['uniwork']`.
  - `lib.test.mjs`: `buildServerEnv` không đặt `AI_CREDENTIAL_KEY`. Giữ assertion không lộ giá trị thật từ `serverDotEnv`.
  - `wire-observe.test.mjs`: không còn `MODEL_CALL_ROUTES` của BYOK.
- [ ] **Step 2: Chạy, xác nhận fail** — `pnpm --filter @uniwork/core exec vitest run ai api/endpoints/ai-office` và `node --test scripts/office/g5g6g7/harness/*.test.mjs scripts/office/g5g6g7/g7-08/*.test.mjs`.
- [ ] **Step 3: Sửa** theo Files.
- [ ] **Step 4: Chạy lại**:
  - Step 2;
  - `pnpm --filter @uniwork/web exec vitest run features/landing platform/office-frame`;
  - `pnpm --filter @uniwork/core typecheck`;
  - `pnpm knip`;
  - `node --test scripts/i18n-landing-keys.test.mjs`.

  Tất cả PASS.
- [ ] **Step 5: Commit** — `refactor(web): drop the unused key-store client, the own-key copy and the byok half of the G7 harness`.

### Task 8: ADR 0051, `CLAUDE.md` và tài liệu

**Files:**
- Create: `docs/adr/0051-ai-chi-chay-bang-uniwork-ai-go-byok.md`
- Modify: dòng 3 của `docs/adr/0028-…`, `0029-…`, `0034-…`
- Modify: `docs/adr/README.md:42,43,48` (thêm dòng 0051 sau L62; sửa đoạn bản nháp L77-80)
- Delete: `docs/adr/drafts/0034-desktop-dung-khoa-luu-tren-uniwork-qua-proxy-byok.md`
- Modify: `CLAUDE.md:376-381`
- Modify (tài liệu, theo spec §3.8 và khảo sát):
  - `docs/office/g5g6g7/contracts/g6-05k-org-keys-api.md` (dòng "superseded" ở đầu);
  - `docs/office/g3g4/uniwork-office-app-api-contract.md:16,112-147,165-166,201,209,224-231,244-253,308`;
  - `docs/office/office-web-modules.md:333-414`;
  - `docs/office/g5g6g7/acceptance-rows.json:704,725,733,745`, `acceptance.md:78-79`;
  - `docs/office/g5g6g7/contract-p0.md:118`, `genoffice-tools.md:88,470,512,531`, `ux/EXPERIENCE.md` (một dòng superseded);
  - `docs/runbooks/UniworkAiModelErrors.md:8,22` (giữ bốn mục), `docs/ops/RUNBOOK_OFFICE_SYNC.md:125`, `deploy/alerts.yml:266`, `docs/ops/RUNBOOK_AI.md:101`;
  - `docs/superpowers/specs/2026-10-18-ai-plan-management-uniwork.md:28,309-316,567,627-633,723` (ghi chú "bị thay bởi spec gỡ BYOK");
  - `docs/superpowers/specs/2026-09-09-landing-work-products-positioning-design.md:156`;
  - `docs/seo-legal-request.json:10,25,37`, `docs/seo.md:182`.

**Interfaces:**
- Consumes: Task 4–7 (tên test mới).

Nội dung:
- ADR 0051 theo spec §6, với các điểm sau:
  - Ghi rõ: đường C của app desktop gỡ ở kế hoạch 2. Cho tới khi đó, app desktop còn khóa trên máy.
  - Ghi lý do không đụng `packages/office-upstream`.
  - Nhắc lại các phần còn đúng: phần cloud và bảng tính credit của 0029; QĐ1, QĐ3, QĐ4, QĐ5 của 0028.
- Dòng 3 của 0028, 0029, 0034: `**Trạng thái:** superseded by 0051 (2026-10-xx) — …`.
- Gạch mới trong `CLAUDE.md` thay `:376-381`:

  > - UniWork never stores, receives or forwards a person's own AI provider key (ADR 0051, superseding 0028, 0029 and
  >   0034): every Office AI call from the web frame and every server-side AI call goes through UniWork AI behind
  >   `office.ai_cloud`, and the frame's cloud tools follow the `uniwork_ai` grant. There is no
  >   `ai_provider_credentials` table and no proxy route. `TestNoProviderKeyRoutes`, `TestNoProviderCredentialTable` and
  >   `TestOfficeFrameCloudToolsFollowUniworkAI` hold it.

  Câu về app desktop không gọi thẳng nhà cung cấp chỉ vào `CLAUDE.md` khi kế hoạch 2 xong.
- Alert `UniworkAiModelErrors`: sửa câu "BYOK vẫn chạy" thành "trình soạn không còn AI dự phòng". Giữ `severity` (spec R3: xem lại trước khi có người dùng thật).

- [ ] **Step 1: Viết** ADR, dòng trạng thái, README, `CLAUDE.md` và các tài liệu.
- [ ] **Step 2: Chạy** `node --test scripts/governance.test.mjs scripts/alerts-runbooks.test.mjs` → PASS (ADR đánh số một lần, có dòng trạng thái, có dòng README; mọi đường dẫn `CLAUDE.md` nêu đều tồn tại; runbook đủ bốn mục).
- [ ] **Step 3: Commit** — `docs: ADR 0051, UniWork AI only; BYOK leaves the web frame, the org key store and the server`.

### Task 9: Pin bundle mới, vendor lại giao thức, ảnh mẫu G7-06 và PR

**Files:**
- Modify: `apps/web/platform/office-frame/source.json` và sáu `*.pin.json` (`node apps/web/scripts/office-frame-sync.mjs --all --pin --from <tarball>`)
- Modify: `packages/core/office/docs-frame-protocol.ts` (chép `web/docs/protocol/types.ts` của commit fork đã merge; header ghi SHA mới); `docs-frame-endpoint.ts`, `docs-frame-host.ts` chỉ khi fork đổi
- Modify: `docs/office/g5g6g7/genoffice-tools.md` (khối §3), `genoffice-tool-schemas.json`, `scripts/office/g5g6g7/genoffice-tool-schemas.test.mjs` (hash nếu đổi), `genoffice-tool-schemas.README.md`: sinh lại ở rev pin bằng `scripts/genoffice-tools-extract.mjs` của chính rev đó
- Modify: `docs/office/office-web-modules.md` (dòng ghi lần pin lại)
- Modify: `scripts/office/g5g6g7/g7-06/goldens/**` (commit của agent Cursor Cloud, không sửa tay)
- Modify: kế hoạch này, spec gỡ BYOK (dòng trạng thái)

**Interfaces:**
- Consumes: bản phát hành fork; Task 2 (giao thức bỏ `ai`); Task 4 (năng lực host đã thôi gửi `ai`).
- Produces: giao thức vendor không còn khóa `ai`; `protocolSha256` của sáu pin khớp tệp vendor.

- [ ] **Step 1: Kiểm hiện trạng** — `node --test scripts/office/frame-protocol-vendor.test.mjs` PASS ở pin cũ (mốc so sánh).
- [ ] **Step 2: Pin lại** bằng tarball chủ sản phẩm đưa và vendor lại giao thức. Sinh lại khối trích xuất công cụ theo `genoffice-tool-schemas.README.md`, kể cả khi không công cụ nào đổi schema (rev của khối phải là rev pin).
- [ ] **Step 3: Chạy**:
  - `node --test scripts/office/frame-protocol-vendor.test.mjs scripts/office-frame-build-wiring.test.mjs scripts/office-modules.test.mjs scripts/office/g5g6g7/genoffice-tool-schemas.test.mjs scripts/office/g5g6g7/g7-06/*.test.mjs`;
  - `pnpm --filter @uniwork/views exec vitest run office/frame`;
  - `pnpm --filter @uniwork/core exec vitest run office`;
  - `pnpm --filter @uniwork/web exec vitest run platform/office-frame`;
  - `pnpm typecheck && pnpm lint`.

  Tất cả PASS.
- [ ] **Step 4: Commit** — `chore(office): re-pin the web modules at <sha> without BYOK and re-vendor the frame protocol`.
- [ ] **Step 5: Đóng vòng tài liệu.**
  - Kế hoạch này: "in-progress — đã triển khai trên nhánh, chờ PR".
  - Spec gỡ BYOK: "in-progress — kế hoạch 1 đã triển khai, chờ PR; kế hoạch 2 (đường C) chưa viết".
- [ ] **Step 6: Việc ra ngoài, controller hỏi chủ sản phẩm trước:**
  1. đẩy nhánh;
  2. `make issue-pr KEY=UNI-2289`. Thân PR theo khuôn PR #516: UniAI; Thay đổi gì; Đã cố ý bỏ ra ngoài (đường C, `packages/office-upstream`, changelog); Kiểm chứng; Definition of Done; điều kiện C2, C3 trước khi merge.
- [ ] **Step 7: Ảnh mẫu G7-06.**
  - Controller soạn hướng dẫn cho agent Cursor Cloud theo bộ nhớ `g7-06-golden-rebless`, với `OFFICE_FORK_SHA=<sha>`.
  - Chủ sản phẩm chạy agent trên nhánh PR. Controller kiểm commit agent đẩy lên:
    - chỉ đổi `goldens/`;
    - manifest đúng pin mới;
    - `node --test scripts/office/g5g6g7/g7-06/job.test.mjs` PASS.
- [ ] **Step 8: Kiểm toàn bộ trên CI** (lần đầu chạy cả bộ, đúng luật "test toàn bộ ở cuối"). CI đỏ vì coverage floor thì thêm test cho mã mới, không hạ sàn.

### Trước khi merge PR UniWork — điều kiện của chủ sản phẩm (spec §4)

1. **C1** — đã đạt: Phần 5 Hỏi UNI soạn tệp Office ship ngày 2026-10-29 (PR #516).
2. **C2** — chạy hai truy vấn chỉ đọc ở spec §8 trên production.
   - Chỉ ra tổ chức nội bộ hoặc thử nghiệm: merge.
   - Ra tổ chức thật: dừng và hỏi chủ sản phẩm. Bỏ bảng là việc không đảo được.
3. **C3** — ở mọi môi trường đang dùng: bật `office_ai_uniwork` và 6 cờ định dạng; UniWork AI đã cấu hình. Kiểm bằng `GET /api/v1/config` của một thành viên.

### Sau khi deploy

- Xóa `AI_CREDENTIAL_KEY` khỏi secret manager ở mọi môi trường (spec §5, §9).
- Báo pháp chế: câu PC15 "trách nhiệm khi dùng khóa riêng" hết đối tượng; câu F03 đổi (spec §3.8).
- `make issue-done KEY=UNI-2289` do người làm, sau merge.

---

## Kế hoạch 2 (chưa viết): đường C — khóa trên máy và CLI cục bộ của app desktop

Chủ sản phẩm đã chọn gỡ (Q-B1 = a). Khảo sát fork thấy các việc spec chưa quyết. Mỗi việc làm mất một tính năng desktop đang chạy:

1. **Bộ viết trên desktop.**
   - Ba bộ viết hôm nay chỉ chạy bằng khóa trên máy: `write_document` (Docs, Markdown), bộ viết trang và brief HTML, `generate_deck`/`regenerate_slide` (Slides đang ẩn).
   - Runner UniWork AI của desktop từ chối mọi request có `purpose` (`apps/shell/src/main/uniwork-auth/ai-chat.ts:372-377`). Route viết ở máy chủ chỉ nhận frame token.
   - Hai lựa chọn: thêm route viết cho bearer thiết bị ở cả hai repo, hoặc ẩn các công cụ đó trên desktop.
2. **"My AI" ở màn Home và ví credit OpenRouter.** Hai thứ này chạy bằng khóa trên máy (`NewChatPane.tsx:595-660`, `CreditWallet.tsx:59-80`). Lựa chọn: đưa sang UniWork AI hoặc bỏ.
3. **Lệnh `image`/`media`/`search` của CLI genoffice.** CLI không có phiên UniWork, nên lệnh bỏ hẳn hoặc ghi là không dùng được.
4. **Chuỗi tìm kiếm miễn phí** (DuckDuckGo, Parallel). Không phải khóa của người dùng, nhưng là đường ra ngoài UniWork. Lựa chọn: xóa theo luật "chỉ công cụ đám mây UniWork", hoặc giữ.
5. **Tính năng media mất khi chỉ còn công cụ đám mây.** Ảnh nền trong suốt và video trên 25 MiB. Lựa chọn: chấp nhận mất, hoặc làm thêm ở máy chủ.

Kế hoạch 2 còn phải ghi các phần xóa vào công cụ đồng bộ upstream của fork (`WATCH`, `--exclude`, `DROPPED_SHELL_STRING_KEYS`, `PORTED.md`), để các đợt upstream sau không đưa chúng trở lại.
