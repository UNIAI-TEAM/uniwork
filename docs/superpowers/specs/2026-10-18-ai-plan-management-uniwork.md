# Quản lý gói AI và hạn mức trên UniWork (qua UniAI Hub v0.2.0)

> **Trạng thái:** draft — v0.5.1 (2026-10-18, UNI-1910, lane ai-plan-uw vòng 2 billing; v0.5 sửa theo review BE billing vòng 1 (BE-B1…B16) và §11 g–j căn theo id khung đã vẽ; v0.4 + thêm §16 Thanh toán AI: đơn thanh toán → grant Hub, nạp credit, gia hạn theo kỳ, đổi gói, hoàn tiền → revoke, đối soát, audit/outbox, isolation, console `/admin`; cập nhật §1.4, §2, §4, §10, §11, §12, §13, §14, §15), chưa có dòng code nào. Người dùng đã chốt Q-AIP-1…10 và D-1…D-7 theo khuyến nghị (2026-10-18 22:00; Q-AIP-1 đổi thành "(c) một epic gồm cả billing", 22:05); chờ người dùng chọn Q-AIP-11…20 (§13; Q-AIP-17…20 theo "Shared billing terms baseline" của lead) và duyệt board g–j (§11). Triển khai thẻ AIP-00…15 và AIP-BILL-00…15: **chờ** (người dùng).

**Quan hệ:** [ADR 0010](../../adr/0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md) (mọi call qua `ai.Gateway`), [0029](../../adr/0029-ai-cua-office-tren-web-qua-ai-gateway.md) + [0034](../../adr/0034-desktop-dung-khoa-luu-tren-uniwork-qua-proxy-byok.md) (BYOK), [0008](../../adr/0008-cach-ly-tenant-o-tang-service.md), [0009](../../adr/0009-audit-va-outbox-cung-transaction.md), [0012](../../adr/0012-audit-bat-bien-bang-quyen-db-va-trigger.md), [0015](../../adr/0015-va-cache-tu-frame-realtime-theo-catalogue.md), [0031](../../adr/0031-uniwork-la-oauth-server-cho-client-ai-ben-ngoai.md), [0033](../../adr/0033-tool-ghi-qua-mcp-chay-truc-tiep-bang-actor-human.md).
**Nguồn phía Hub** (repo `llm-system`, đọc ở working tree 2026-10-18; trích dẫn dạng `hub:<đường dẫn>:<dòng>`): `docs/SPEC.md` (final, cập nhật S-P2), `docs/connect.md`, `docs/plans/2026-10-17-p2-plan.md` mục "Phía UniWork" (dòng 198–211), mã `internal/admin`, `internal/usage`, `internal/surface`, `internal/webhook`, `internal/admission`, `internal/auth`, `internal/httpx`.
**Nguồn phía Hub cho billing (§16)** (đọc ở working tree 2026-10-18): `internal/admin/{grants,plans,accounts,perm,audit}.go`, `internal/ledger/ledger.go`, `internal/meter/meter.go`, `internal/store/queries/{ledger,accounts}.sql`, `docs/SPEC.md` §8, §18, `docs/connect.md` §8.2–8.3, `scripts/provision-uniwork.sh`, test `internal/admin/ac2_plan_app_db_test.go`.
**Nguồn thiết kế:** card `briefs/card-AI-PLAN-UW.md` và `briefs/card-AI-PLAN-UW-BILL.md` (vòng 2); board HTML ở `reports/ai-plan-uw/design/` (§11).
**Quy ước đọc:** "đã kiểm" = đọc trong mã và có `file:dòng`; "giả định" = chưa kiểm được trong mã, nằm trong danh sách kiểm ở §13.3 hoặc thẻ kiểm tương ứng ở §14. Không có host, IP hay khóa nào trong tài liệu này.

---

## 1. Bối cảnh

### 1.1 UniWork hôm nay (đã kiểm ở root G5-G7 `d0c2084c8`)

| Chủ đề | Hiện trạng | Nguồn |
|---|---|---|
| Cửa duy nhất | Mọi lệnh gọi LLM đi qua `ai.Gateway.Complete`: policy → quota → dòng usage `pending` → provider → kiểm tool → dòng usage chốt → meter quota → `ai.usage.updated` | `server/internal/ai/gateway.go:1-6`, `:156-304` |
| Tầng provider | Chỉ `server/internal/ai/provider` mở kết nối tới host mô hình; adapter "không biết gì về tenant, actor, policy hay giá". `CompletionRequest` hiện **không** mang metadata tenant | `server/internal/ai/provider/provider.go:1-8`, `:124-136` |
| Quota hôm nay | Giao diện `ai.Quota{Check, Record}` nhận **chỉ `organizationID`**; adapter `aiQuota` = meter `ai.tokens` của entitlement (mặc định 500k token/tổ chức/tháng, theo comment OPEN_QUESTIONS G2). Không có hạn mức theo workspace/user, không có tiền, không có danh sách model theo tenant | `gateway.go:25-31`, `server/internal/service/ai_quota.go:14-54`, `entitlement.go:274-293` (`CheckQuota`), `:239-247` (`meterPeriodStart`: kỳ trả phí hoặc tháng lịch giờ Việt Nam) |
| Cảnh báo ngưỡng hôm nay | `notifyThreshold` bắn `quota.threshold` đúng một lần mỗi mức 80/100 mỗi kỳ tới mọi owner/admin tổ chức; client chỉ làm mới và hiện toast | `entitlement.go:508-543`, `server/internal/outbox/catalogue.go:316`, `packages/core/billing/use-quota-warnings.ts` |
| Chọn model | Hằng số trong mã theo capability (`policies`), override bằng env `AI_MODEL_<CAPABILITY>` phải nằm trong allowlist (+`AI_MODEL_ALLOW`). **Không có bộ chọn model** cho AI do UniWork phục vụ; chỉ có nhãn đọc-chỉ `uniwork_model` ở trạng thái cloud. Chip chọn model của desktop là cho khóa BYOK | `server/internal/ai/policy.go:51-65`, `:116-153`; `ai/cloud.go:118-130`; `docs/office/g5g6g7/contracts/g6-05k-org-keys-api.md:177` |
| Provider | `FromEnv` chọn anthropic/openai/ollama/fake; adapter `openai` nói wire chat-completions và chỉ đổi `OPENAI_BASE_URL` là đổi nhà cung cấp, nhưng không gắn header tùy ý. Công cụ cloud (ảnh, phiên âm, tìm kiếm) là adapter riêng qua `CloudFromEnv`, cấp **tổ chức**, không có workspace | `ai/config.go:27-65`, `ai/provider/openai.go:24-31`, `ai/cloud.go:53-100`, `:131-136`, `:181-249` |
| Sổ chi phí riêng | `ai_usage_events` (giá từ `ai_model_rates` của UniWork), đối soát usage không rõ bằng `usage_reconcile.go` | `server/migrations/092_ai_gateway.up.sql:24`, `ai/usage_reconcile.go:1-60` |
| Màn hình hiện có | Cài đặt → AI (`?tab=ai`, nhóm workspace, `gate: "workspace_admin"`): hàng "Hạn mức của tổ chức" (meter **Token AI** cấp **tổ chức**), khối "30 ngày qua" và bảng "Theo tính năng" (usage của **workspace**) — chi tiết ở §1.1a; Billing (nhóm tổ chức, có hàng `ai_tokens`); "Truy cập AI" (`?tab=ai-access`, MCP, không liên quan hạn mức). `?tab=` là khóa liên kết, không đổi | `packages/views/settings/components/settings-page.tsx:91-128` (`ai-access` ở `:114`, `ai` ở `:125`), `ai-tab.tsx`, `ai/ai-usage-section.tsx`, `billing-tab.tsx`, `quota-meter.tsx` |
| API usage hiện có | `GET /workspaces/{workspaceID}/ai/capabilities`, `…/ai/usage` (admin ws), `GET /orgs/{orgID}/ai/usage` (admin org), `GET /orgs/{orgID}/ai/cloud` | `server/internal/handler/router/ai.go:20-76`, `ai_cloud.go:23`, `service/askuni.go:126-147`, `:377-402` |
| BYOK | Khóa cá nhân lưu mã hóa theo `(organization_id, user_id, provider)`; proxy pass-through qua `ai.Gateway`; ghi `credits=0`; chỉ bị cổng entitlement `office.ai_byok` / `office.ai_cloud`, không bị meter `ai.tokens` | ADR 0029 QĐ2–QĐ5; `service/ai_credentials.go:44-45`, `ai_byok.go:56`, `ai_cloud.go:98` |
| Cờ tính năng | Danh mục `featureflags/keys.go`, override user > org > global; cờ chỉ **ẩn** capability, không cấp quyền; mỗi cờ có `ReviewAt` (`TestFlagsAreReviewed`). Tiền lệ cờ + công tắc theo tổ chức: `mcp_connector` + `McpAuthService.SetPolicy` | `server/internal/featureflags/keys.go:33-75`, `service/mcp_grants.go:162-205` |
| `/admin` và cài đặt tổ chức | `/admin` (F-11) là console của **nhân viên nền tảng** (`users.platform_role`), chỉ đọc metadata đa tenant, không bao giờ vào nội dung; trang `plans.tsx`, `quota.tsx` ở đó sửa **catalog gói của UniWork**, không phải hạn mức của từng tổ chức. Việc "org admin chia hạn mức" là màn **cài đặt tổ chức/workspace** | CLAUDE.md § Platform Admin; `packages/views/admin/plans.tsx`, `quota.tsx` |
| Hub trong UniWork | **Chưa có.** Tìm `X-Hub`, `llm-system`, `UNI_HUB` chỉ ra các tệp *Email Hub* (sản phẩm khác, không liên quan). P1 của Hub phía UniWork (tạo account, gọi AI qua Hub, grant khi mua gói, cutover `Quota`) **chưa làm** | `grep` toàn repo 2026-10-18; Hub `SPEC.md:608-642` nói rõ cần một ADR phía UniWork |

#### 1.1a Tab "AI" của workspace hôm nay (đã kiểm) và Gói AI mở rộng nó thế nào

Tab đã chạy, không phải màn mới. Dữ liệu đi qua hai endpoint đã có:

| Khối trên màn | Nguồn dữ liệu | Phạm vi | Nguồn |
|---|---|---|---|
| "Hạn mức của tổ chức" — meter **Token AI** (`used_tokens` / `limit_tokens`, 80% vàng, 100% đỏ) | `GET /workspaces/{workspaceID}/ai/capabilities` → `quota` = entitlement `ai.tokens` của **tổ chức** (`AskUNIService.Capabilities` đọc `FeatureAITokens` từ `Snapshot`) | **tổ chức** (workspace chỉ *thấy* meter chung) | `ai-tab.tsx:94-102`, `server/internal/service/askuni.go:126-147` |
| "30 ngày qua" (số tổng + đường theo ngày) và "Theo tính năng" (bảng theo capability) | `GET /workspaces/{workspaceID}/ai/usage?from&to` → `AIUsageSummary` (`WorkspaceUsage`, owner/admin workspace) từ `ai_usage_events` (token, `cost_micros` giá của UniWork) | **workspace** | `ai-usage-section.tsx:110`, `:186`, `packages/core/api/endpoints/ai.ts:97-102`, `askuni.go:377-390` |
| Trạng thái "tắt" / "không đủ quyền" | `capabilities.enabled` (gateway có provider); `useMyMembership` vai trò owner/admin | — | `ai-tab.tsx:57-90` |

**Gói AI mở rộng, không dựng song song** (Q-AIP-2 quyết đơn vị):

- Với tổ chức **chưa** bật `ai_hub_routing`, tab giữ nguyên (token, `ai.tokens`).
- Với tổ chức đã bật: hàng "Hạn mức của tổ chức" **đổi nguồn** — thay meter token `ai.tokens` (không còn bị kiểm, §5.9) bằng "đã dùng / hạn mức" theo US$ của policy cấp tổ chức (`spent_micro` / `limit_micro`, C4); `capabilities.quota` thêm khối `plan` (§9) trong khi giữ trường `quota` cũ cho client chưa cập nhật. Thêm một hàng chỉ đọc "Hạn mức của workspace" (policy `workspace`, nếu có) và một dòng "Liên hệ quản trị viên tổ chức để đổi" — owner/admin **workspace** không sửa (§2).
- "30 ngày qua" và "Theo tính năng" **giữ nguyên nguồn** (`ai_usage_events`, token); chỉ đổi đơn vị số tiền sang US$ từ `cost_micros` lấy từ `X-Hub-Cost` (§5.9). Không thêm khối usage thứ hai; usage theo người dùng của workspace là bảng "Dùng trong workspace" thêm vào tab, lấy từ `GET /workspaces/{workspaceID}/ai/quota` (§9, C5 `labels.workspace`).
- Tab tổ chức **Gói AI** (`?tab=ai-plan`) là chỗ **sửa**; tab AI workspace là chỗ **xem**. Hai tab không trùng meter nào ngoài hàng hạn mức chung.

### 1.2 Hub (đã kiểm trong mã)

P2 phía Hub đã có trong mã ở working tree: policy theo nhãn có `period_id` + `spent_micro` (`hub:internal/admin/policies.go:64-68`, `:281-340`), model list nhận nhãn (`hub:internal/surface/endpoints.go:392-434`), webhook endpoint + outbox + HMAC (`hub:internal/admin/webhooks.go`, `hub:internal/webhook/*`), X hiệu lực của plan (`hub:internal/admin/plans.go:64-79`). Plan P2 ghi các nhánh L1–L5 còn chờ merge (`hub:docs/plans/2026-10-17-p2-plan.md:3`): **mọi thẻ phía UniWork phụ thuộc bản tag v0.2.0**, và hợp đồng dưới đây là hợp đồng đọc được hôm nay.

### 1.3 Kiểm hai điều trong bộ nhớ của card

1. **"Office không có account riêng; UniWork SSO + entitlement gói do server cấp."** — **Đúng.** Một lượt UniWork AI trong Office đi qua `orgs.RequireMember` rồi `ents.Can(…FeatureOfficeAICloud)` (`service/ai_uniwork.go:238-251`); khóa tính năng `office.ai_byok`, `office.ai_cloud` là feature của gói UniWork (`service/ai_credentials.go:44-45`, ADR 0029 QĐ5); frame dùng token ngắn hạn theo một tài liệu (mô tả cờ `office_docs_web` ở `keys.go`). Không có bảng hay luồng đăng nhập riêng cho Office.
2. **"Office AI gọi upstream qua provider `openai` của `ai.Gateway`, không qua Hub."** — **Đúng.** `AIUniworkService.Chat` gọi `Gateway` với `CapOfficeUniworkAI` (`ai_uniwork.go:335`); provider lấy từ `FromEnv` (`ai/config.go:27-65`); `policies[CapOfficeUniworkAI]` chỉ có mặc định cho anthropic/openai/fake (`ai/policy.go:46-49`); không dòng nào trong `server/` nhắc tới Hub. Đổi sang Hub vì vậy là **thêm provider `hub`**, không chỉ đổi biến môi trường (xem §5).

### 1.4 Phạm vi của tài liệu này

Gồm: cấu hình hạn mức và model list theo tổ chức/workspace/người dùng; xem ví và mức dùng; chặn và cảnh báo; nối Office AI + Ask UNI + các capability khác qua Hub; webhook; cô lập tenant; cờ và rollout. Từ v0.5 **gồm cả billing** (người dùng chốt Q-AIP-1 = (c), 22:05): mua gói và nạp credit ngay trong UniWork (VNPay hiện có) → `grant`, hoàn tiền → `revoke`, đặt plan Hub — toàn bộ ở §16, các thẻ `AIP-BILL-00…15` ở §14. Quy tắc người dùng đặt (22:06): khách chỉ trả tiền **trong UniWork**; Hub không thu tiền và không có màn Hub/Console nào cho khách. **Không gồm** (§12): P3/P4 của Hub, tự gia hạn thu thẻ, chia tỉ lệ (proration) tiền VND, v.v.

---

## 2. Tác nhân và quyền

UniWork có hai tầng thành viên; mỗi quy tắc dưới đây nêu `PermissionContext{orgRole, wsRole}` (`packages/core/permissions/types.ts:10-25`) và cổng Go nó phản chiếu. Chỉ `OrganizationService.RequireMember` (`server/internal/service/organization.go:135-166`) và `WorkspaceService.RequireMember` (`service/workspace.go:243-277`, org owner/admin là admin ngầm của workspace) quyết định thành viên; `arch_test.go` cấm nơi khác gọi query thành viên. Người bị vô hiệu hóa (`member_deactivated`) và tổ chức bị khóa (`organization_suspended`) bị cả hai cổng từ chối trước mọi vai trò.

| Hành động | Ai | `PermissionContext` (quy tắc TS mới trong `rules.ts`) | Cổng Go |
|---|---|---|---|
| Xem "Gói AI": ví, kỳ, tổng dùng, bảng workspace/người dùng, cảnh báo | owner/admin **tổ chức** | `canViewAiPlan`: `orgRole ∈ {owner, admin}` (cùng khuôn `canViewBilling`, `rules.ts:126-131`) | `OrganizationService.RequireMember` + `adminLikeRole` (`workspace.go:717`) |
| Đặt, đổi, xóa hạn mức và model list của tổ chức / một workspace / một người dùng | owner/admin tổ chức | `canManageAiQuota`: cùng điều kiện `canViewAiPlan` | như trên; workspace đích đi qua `WorkspaceService.RequireMember(ws, actor)` (trả vai trò hiệu lực `admin` cho org owner/admin, và từ chối workspace của tổ chức khác); với **đặt/đổi** (PUT) người dùng đích đi qua `OrganizationService.RequireMember(org, target)` (người không còn hoạt động bị từ chối); với **xóa** (DELETE) **chỉ** kiểm actor (`RequireMember(org, actor)` + `adminLikeRole`) và tìm dòng theo `(organization_id, subject_kind, subject_id)` — không gọi cổng thành viên cho đích, để dọn được policy của người đã rời (§8.2) |
| Xem hạn mức và mức dùng của workspace mình | owner/admin **workspace** (gồm org owner/admin ngầm) | `canViewWorkspaceAiQuota`: `wsRole ∈ {owner, admin}` (khuôn `canUpdateWorkspaceSettings`, `rules.ts:97-102`) | `WorkspaceService.RequireMember` + `adminLikeRole(m.Role)` (khuôn `WorkspaceUsage`, `askuni.go:377-390`) |
| Xem trạng thái của chính mình (còn dùng được / sắp hết / hết hạn mức, model đang dùng) | mọi thành viên workspace | `wsRole !== null` | `WorkspaceService.RequireMember`; mở rộng `GET /workspaces/{workspaceID}/ai/capabilities` (`askuni.go:126`) |
| Mua/đổi gói, nạp credit (mua gói nạp), xem lịch sử đơn credit | owner tổ chức mua; owner/admin xem | mua: `canManageBilling` (`rules.ts:138-143`); xem: `canViewBilling` (`rules.ts:126-131`) | `BillingService.requireOwner` (`billing.go:112`) cho mua; `OrganizationService.RequireMember` + `adminLikeRole` cho xem — chi tiết §16.10 |
| Hoàn tiền hóa đơn (kéo theo thu hồi credit) | nhân viên nền tảng (như hôm nay; owner không tự hoàn) | — | `POST /admin/invoices/{invoiceID}/refund` (`handler/router/admin.go:60`), `middleware.RequirePlatformRole`; §16.8 |
| Cộng credit tay cho hỗ trợ | nhân viên nền tảng `admin` (ghi); `support` chỉ đọc | — | route `/admin/organizations/{orgID}/ai-credit`, `reason ≥ 10`, `admin_actions` — §16.11 |
| Bật/tắt cờ `ai_hub_routing`, `ai_plan_ui` theo tổ chức | nhân viên nền tảng | — | console `/admin` flags (`middleware.RequirePlatformRole`, ghi `admin_actions` + `audit_events`); không thêm route `/admin` mới |
| Agent | **không** cấu hình hạn mức (ADR 0010: agent không ghi bảng nghiệp vụ). Lệnh gọi AI do agent chạy vẫn bị đếm: nhãn `user` = `agent:<id>` (§5.3) | — | `RequireAgentMember` chỉ cho việc agent làm, không cho quản lý hạn mức |

**Ràng buộc do Hub quyết định, không phải do UniWork chọn:** policy theo nhãn `user` áp cho người đó ở **mọi** workspace (cặp `(workspace, user)` chưa có, `hub:docs/SPEC.md:785`). Vì vậy owner/admin **workspace** chỉ *xem* và không được đặt hạn mức người dùng: quyết định đó vượt khỏi workspace của họ. Mọi thao tác ghi thuộc owner/admin tổ chức, đúng như dòng 1 của "Phía UniWork" (`hub:docs/plans/2026-10-17-p2-plan.md:201-202`).

**Dữ liệu một người được thấy** (lọc ở server UniWork, theo `hub:docs/connect.md:694-709`): org admin thấy cả tổ chức (`account=<hub id>`), ws admin thấy `labels.workspace=<ws>`, thành viên chỉ thấy `labels.user=<id mình>`. Hub không biết ai là admin. Số tiền gốc `cost_micro` (giá vốn) **không bao giờ** rời server UniWork: DTO chỉ cho `charge_micro` và số token (§4, C5).

---

## 3. Dữ liệu UniWork giữ

**Nguyên tắc chia:** tiền, sổ cái, grant, số đã chi (`spent`), usage chi tiết, outbox webhook nằm ở Hub (`hub:docs/SPEC.md:112-127`, D10); UniWork giữ **cấu hình + liên kết + biên nhận + audit**. UniWork không lưu nội dung prompt/response ở bất kỳ bảng nào thêm (Hub §16 `SPEC.md:572-581` giữ nguyên cho phía Hub; payload webhook chỉ có id, số, mã: `hub:internal/webhook/enqueue.go:116-147`). Số dư và "đã dùng" luôn đọc trực tiếp từ Hub qua cache RAM ngắn (§8.4), không có bản sao bền.

Ba bảng mới, mọi bảng có `organization_id TEXT NOT NULL`, id ULID `TEXT` (`util.NewID()`), không `FOREIGN KEY`/`REFERENCES`, bảng có `created_by` thì có `created_by_kind` (`human|agent|system`, ADR 0007). Mỗi index là `CREATE [UNIQUE] INDEX CONCURRENTLY` trong một tệp migration một câu lệnh; tiền tố `999<unix-ms>_tên` (`server/migrations/lint_test.go`). Đây là phác thảo cột, không phải migration:

```sql
-- 1. Liên kết tổ chức ↔ account Hub (một dòng một tổ chức)
ai_hub_accounts(
  id TEXT PK, organization_id TEXT NOT NULL,
  hub_account_id TEXT NOT NULL,            -- id Hub; dùng cho body admin API và ?account= của Usage API
  state TEXT NOT NULL,                     -- active | disabled
  created_by TEXT NOT NULL, created_by_kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)
-- uidx(organization_id), uidx(hub_account_id)

-- 2. Cấu hình hạn mức theo chủ thể (nguồn sự thật của cấu hình; Hub là bản đồng bộ)
ai_quota_policies(
  id TEXT PK, organization_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL,              -- organization | workspace | user
  subject_id TEXT NOT NULL,                -- '' cho organization; workspace id; user id
  period TEXT NOT NULL,                    -- day | month | none (giá trị của Hub)
  kind TEXT NOT NULL,                      -- hard | soft
  limit_micro BIGINT,                      -- NULL = không giới hạn tiền (chỉ model list)
  thresholds INTEGER[] NOT NULL,           -- 1..100, mặc định {80,100}
  models TEXT[] NOT NULL DEFAULT '{}',     -- rỗng = không giới hạn tầng này
  revision BIGINT NOT NULL,                -- bộ đếm tăng của UniWork; gửi làm `version` của Hub
  hub_policy_id TEXT,                      -- id policy Hub, lấy từ response PUT
  synced_revision BIGINT NOT NULL DEFAULT 0,
  sync_state TEXT NOT NULL,                -- pending | synced | failed
  sync_error_code TEXT,
  removed_at TIMESTAMPTZ,                  -- "xóa" = đặt limit NULL + models [] (Hub chưa có DELETE)
  created_by TEXT NOT NULL, created_by_kind TEXT NOT NULL,
  updated_by TEXT NOT NULL, updated_by_kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)
-- uidx(organization_id, subject_kind, subject_id); idx(organization_id, sync_state)

-- 3. Biên nhận webhook (chống trùng theo id event; không lưu nội dung)
ai_hub_webhook_events(
  id TEXT PK, organization_id TEXT NOT NULL,
  hub_delivery_id TEXT NOT NULL,           -- X-Hub-Delivery = id outbox Hub = payload.id
  event_type TEXT NOT NULL,                -- policy.threshold | credit.low | credit.depleted
  hub_policy_id TEXT, policy_id TEXT,      -- policy_id = ai_quota_policies.id nếu khớp
  threshold INTEGER, spent_micro BIGINT, limit_micro BIGINT, balance_micro BIGINT,
  received_at TIMESTAMPTZ NOT NULL)
-- uidx(hub_delivery_id)
```

Ghi chú thiết kế:

- **Một bộ đếm phiên bản.** `revision` của UniWork được gửi làm `version` của Hub. Mỗi lần lưu tăng 1 trong cùng transaction với audit/outbox (tạo lần đầu gửi `revision=0`; xóa giữ dòng và tăng `revision`; tạo lại dùng lại dòng cũ — quy tắc đầy đủ ở §8.2). Hub chỉ nhận version lớn hơn bản đang giữ (`hub:internal/admin/policies.go:242-273`), nên consumer chạy chậm hay chạy lại không ghi đè cấu hình mới hơn.
- **Policy cấp tổ chức** dùng `subject_kind=organization`, `label_key=""` (policy cấp account, không nhãn: `policies.go:124-135`, `requireDeclaredLabel` cho phép nhãn rỗng `:90-93`). Policy `workspace` với `label_value=""` áp cho call không có nhãn `workspace` (call cấp tổ chức: ảnh, phiên âm; `hub:docs/SPEC.md:181-183`); UniWork **không** dùng công dụng này ở v1.
- **"Xóa" không xóa dòng** (cần `revision` tiếp tục tăng); đặt `removed_at`, đẩy `limit_micro=null, models=[]` (cách duy nhất Hub cho tới khi có DELETE, `SPEC.md:787`).
- **Không bảng ví/usage/plan.** Plan hiển thị (tên gói, giá) lấy từ catalog gói của chính UniWork (`GET /api/v1/plans`, `service/entitlement.go` `Snapshot`), vì `GET /admin/v1/plans*` và `GET /admin/v1/accounts/{id}/plan` chỉ cho `hub_admin` (app → 403: `hub:internal/admin/plans.go:137-160`, `:502-509`, `perm.go:22-27`).
- **Không bảng trạng thái cảnh báo.** Hub đã chống trùng theo `(policy, kỳ, ngưỡng)` (`hub:internal/webhook/enqueue.go:37-40`); UniWork chống trùng theo id event bằng bảng 3. Trạng thái "đang ở 80%" suy ra sống từ `spent_micro / limit_micro`.
- **Cấu hình mức hệ thống** (không theo tenant) đi bằng env, liệt kê trong `.env.example` (`scripts/env-example.test.mjs`): URL Hub, token app (**không bao giờ** vào DB hay log), danh sách secret webhook, danh sách model ưu tiên theo capability (§5.2).

**Backfill:** không có. Hạn mức không có mặc định (Q-AIP-3); liên kết account được tạo khi tổ chức được bật `ai_hub_routing` (§10). Dòng `ai.tokens` hiện có giữ nguyên.

---

## 4. Gọi Hub

Mọi lệnh gọi dưới đây do **server UniWork** thực hiện bằng **một app credential** (`Authorization: Bearer <APP_TOKEN>`, principal `app`, channel `uniwork`; `hub:docs/SPEC.md:133-143`, D8). Trình duyệt, desktop và frame **không** giữ credential (`SPEC.md:155-158`). Lỗi của management/usage API có dạng `{"error":{"code","message"}}` (`hub:internal/httpx/httpx.go:61-66`); lỗi của inference theo format OpenAI `{"error":{"message","type","code"}}` (`hub:internal/surface/surface.go:246-262`). `Retry-After` được đặt khi `RetryAfter > 0` (`httpx.go:69-73`).

Mọi lệnh ghi gửi thêm `X-Hub-Reason: <đã audit id UniWork>` — Hub ghi giá trị này vào `admin_actions` (`hub:internal/admin/audit.go:19`); chỉ chứa id, không tên/email.

### C1. Tạo account cho tổ chức

| | |
|---|---|
| Route | `POST /admin/v1/accounts` (`hub:internal/admin/accounts.go:23`, handler `:116-178`) |
| Principal | `app`; `external_id` bắt buộc với app (`accounts.go:59-61`) |
| Gửi | `name`, `external_id`, `timezone` (`accountWrite`, `:31-38`). UniWork gửi `name="uniwork:<organization_id>"`, `external_id=<organization_id>`, `timezone="Asia/Ho_Chi_Minh"` (mặc định của Hub cũng là giá trị này: `:17`; ví dụ `"UTC"` trong `connect.md:625` lệch mã — lấy mã làm chuẩn và vẫn gửi tường minh vì kỳ policy reset theo múi giờ account: `policies.go:106-112`, `:314`) |
| Nhận | `201` `{id, name, kind, timezone, models, status, created_at, updated_at}` (`hub:internal/store/db/models.go:12-21`); `id` là `hub_account_id`, lưu vào `ai_hub_accounts` |
| Idempotency | Không có khóa. Link `(app, external_id)` đã tồn tại → `409 conflict` "link already exists", và cả transaction (kể cả account) bị hủy (`accounts.go` khối `InsertAccountLink`) — không có account mồ côi. **Phục hồi** khi UniWork mất `id` (sập giữa Hub trả lời và lưu): `GET /admin/v1/accounts?limit=200&after=<id>` (app chỉ thấy account đã link: `accounts.go:180-201`; `maxListLimit` = 200, `:19`) và khớp `name == "uniwork:<organization_id>"`. **Lặp** với `after=<id cuối của trang trước>` cho tới khi trang rỗng (không dừng ở 200 account đầu); không có account nào khớp (ví dụ tên bị đổi trong Console) → lỗi vận hành `ai_hub_account_unrecoverable` + metric, không tạo account thứ hai. Đề nghị Hub thêm lọc `external_id` (H-2) |
| Lỗi | 409 → phục hồi như trên; 400 `invalid_request`; 401/403 → cấu hình sai (cảnh báo vận hành, không lộ cho người dùng) |

Account mới **chưa có plan** và gọi AI nhận `402 insufficient_credit` (`hub:docs/connect.md:627`). Việc đặt plan và nạp credit là billing: §16 (đặt plan Hub ngay sau khi liên kết, §16.4; credit từ đơn thanh toán, §16.6); khi cờ `ai_billing_sync` còn tắt (R2/R3) hub_admin nạp tay.

### C2. Đọc ví

| | |
|---|---|
| Route | `GET /admin/v1/wallets/{account}` (`hub:internal/admin/grants.go:21`, `:339-348`) |
| Principal | `app`, account phải link với app, nếu không `404 not_found` (`perm.go:31-40`, `auth.go:183-197`) |
| Nhận | `{account_id, balance_micro, debt_micro, updated_at, credit_limit_micro}` (`hub:internal/store/db/admin.sql.go:130-136`). Credit còn dùng được = `balance_micro + credit_limit_micro` (admission chặn khi ≤ 0: `hub:docs/SPEC.md:235-236`, `:318`) |
| Idempotency | GET; cache RAM 30 giây theo tổ chức (§8.4) |
| Ghi chú | Không có tên gói, giá hay `c_max`: UniWork dùng catalog gói của mình để hiển thị |

### C3. Ghi policy (hạn mức + model list)

| | |
|---|---|
| Route | `PUT /admin/v1/policies` (`hub:internal/admin/policies.go:19`, `:174-279`) |
| Principal | `app` hoặc `hub_admin` (`:176`); app bị buộc `app_id` = chính nó, body gửi app khác → 403 (`grants.go:66-84`) |
| Gửi (`policyWrite`, `:23-34`) | `account_id` = `hub_account_id` (**không** nhận id ngoài); `label_key` ∈ `""` (cấp tổ chức) \| `"workspace"` \| `"user"` — phải nằm trong bộ nhãn app đã khai báo, nếu không `400 invalid_request` (`:90-104`, `:203`); `label_value` = ws id / user id (cần `label_key`, `:124-126`); `period` ∈ `day|month|none` (mặc định `month`); `limit_micro` (số ≥ 0 hoặc `null`); `kind` ∈ `hard|soft` (mặc định `hard`); `thresholds` (mỗi số 1..100, mặc định `[80,100]`: `:154-167`); `models` (id model công khai, model lạ → `400 "unknown model"`: `hub:internal/admin/validate.go:76-88`); `version` = `revision` của UniWork (≥ 0) |
| Nhận | `200` `db.Policy` `{id, account_id, app_id, label_key, label_value, period, limit_micro, kind, thresholds, models, version, created_at, updated_at}` (`models.go:179-193`); lưu `id` → `hub_policy_id` |
| Idempotency và version | Chưa có policy → tạo. `version` < đang giữ → `409 conflict` "stale version"; **bằng** và body y hệt → `200` không đổi gì (retry an toàn); bằng và body khác → `409`; lớn hơn → cập nhật (`:242-273`, `hub:docs/SPEC.md:196-199`, S2). `connect.md:724` viết "cùng version bị từ chối" nhưng mã và SPEC cho `200` khi body trùng: **lấy mã làm chuẩn** |
| Xử lý 409 | §6.3 (consumer đồng bộ) |
| Lỗi khác | 404 (account chưa link); 400 (nhãn chưa khai báo, ngưỡng, model lạ); không có xóa (đặt `limit_micro=null` + `models=[]`) |

### C4. Đọc policy kèm số đã dùng

| | |
|---|---|
| Route | `GET /admin/v1/policies?account=<hub_account_id>` (`policies.go:281-340`) |
| Principal | `app` (chỉ policy của app mình: `ListPoliciesForApp`, `:299-301`), `hub_admin` |
| Nhận | `{items:[{…policy…, period_id, spent_micro}]}`; `period_id` tính theo múi giờ account, `spent_micro` đọc từ `policy_counters` (chưa có dòng → 0) (`:314-338`). **Không phân trang** |
| Dùng | thước đo "đã dùng / hạn mức" ở mọi màn hình; so khớp `revision`↔`version` để phát hiện lệch; tìm `hub_policy_id` khi phục hồi |

### C5. Usage tổng hợp

| | |
|---|---|
| Route | `GET /usage/v1/summary?account=<hub id>&group_by=workspace,user,model,day&from=&to=&labels.workspace=&labels.user=` (`hub:internal/usage/usage.go:41`, `summary.go:14-19`, `scope.go:34-59`) |
| Principal | `app`: tự lọc theo channel và account đã link; `account=` không link → `404` |
| Gửi | `from`, `to` RFC3339 (`scope.go:parseTime`); `group_by` ⊂ `{workspace,user,model,day}` (khóa lạ hoặc trùng → `400`); `labels.<key>=<value>` |
| Nhận | `{groups:[{<khóa group_by>, count, input_tokens, output_tokens, cached_input_tokens, cache_write_tokens, cost_micro, charge_micro}]}` (`summary.go:46`, `:87-93`) |
| Cắt | UniWork **bỏ `cost_micro`** (giá vốn/biên lợi nhuận, `hub:docs/SPEC.md:776`), chỉ chuyển `charge_micro` + token |
| Cẩn thận | Nhóm `day` cắt theo **UTC** (`summary.go:18`) còn kỳ policy cắt theo múi giờ account (UTC+7): **không** cộng summary để vẽ thước hạn mức; thước hạn mức dùng `spent_micro` (C4). Summary chỉ để chia nhỏ (theo workspace/người dùng/model). Không phân trang: mỗi màn hình chọn `group_by` hẹp (org: `workspace`; ws: `user` + `labels.workspace`; cá nhân: `day` + `labels.user`) |

### C6. Danh sách model cho một người gọi

| | |
|---|---|
| Route | `GET /v1/models` (`hub:internal/surface/surface.go:58`, `endpoints.go:392-434`) |
| Principal | `app` (credential khác → 403) |
| Gửi | `X-Hub-External-Account: <organization_id>` (hoặc `X-Hub-Account`, không cả hai: `hub:internal/auth/auth.go:160-173`), `X-Hub-Label-user` (bắt buộc), `X-Hub-Label-feature` (bắt buộc), `X-Hub-Label-workspace` (tùy chọn) — nhãn khai báo ở app; thiếu bắt buộc → `400 missing_label` (`auth.go:132-158`; `hub:docs/connect.md:449`). Không cần `X-Hub-Request-Id` |
| Nhận | `{object:"list", data:[{id, object:"model", created, owned_by:"uniai"}]}` — chỉ `id` có nghĩa; **không** có tên hiển thị hay capability. Kết quả = app ∩ plan ∩ account ∩ mọi policy khớp nhãn, chỉ model có giá và route cho endpoint app được mở (`endpoints.go:412-430`, `hub:docs/plans/2026-10-17-p2-plan.md:111-114`) |
| Cache | RAM 60 giây theo `(org, workspace, user, feature)`; node đã nhận sự kiện outbox cùng tổ chức xóa khóa của nó, các node khác chờ hết TTL (§5.5). Hub cũng cache policy 5 giây |
| Danh mục cho form sửa hạn mức | gọi với `user=_catalog`, `feature=settings` (giá trị tổng hợp không khớp policy nào) để thấy model mà **gói** cho phép. *Giả định* cần một test với Hub thật (H-6). Kết quả chỉ gồm model **được phép** (giao của plan/account/policy); Hub **không** trả model bị loại hay lý do, nên "model ngoài gói hiện mờ" cần H-7 (§13.2) |

### C7. Lệnh gọi suy luận (qua `ai.Gateway`, không qua service)

`POST /v1/chat/completions` (Complete), `POST /v1/embeddings` (Embed), `POST /v1/images/generations`, `POST /v1/audio/transcriptions` (`hub:internal/surface/surface.go:50-59`). Header: `X-Hub-External-Account`, các nhãn ở C6, `X-Hub-Request-Id` (bắt buộc, ≤ 200 ký tự: `surface.go:99-103`). Response (chỉ khi Hub đã nhận) có `X-Hub-Request-Id`, và không stream có `X-Hub-Cost`, `X-Hub-Usage-Source` (`hub:docs/SPEC.md:462-466`). Id: §5.4. Lỗi: §8.

### C8. Webhook endpoint (một lần, do vận hành)

`POST /admin/v1/webhooks` body `{app_id?, url, events[], allow_private_network}` → `201 {id, app_id, url, events, allow_private_network, status, created_at, updated_at, secret}`; `secret` (`whsec_…`) chỉ trả **một lần** (`hub:internal/admin/webhooks.go:28-52`, `:151-212`). `events` ⊂ `{policy.threshold, credit.low, credit.depleted}`, rỗng = cả ba (`hub:internal/webhook/events.go:6-41`). URL nội bộ cần `allow_private_network=true`, mà cờ này **chỉ `hub_admin`** đặt (app → 403: `webhooks.go:167-170`), và Hub không ở mạng công cộng (`hub:docs/connect.md:456`) → **hub_admin đăng ký**, đưa secret cho UniWork qua kênh bí mật (env, §7). UniWork không gọi route này lúc chạy; sức khỏe kiểm bằng `GET /admin/v1/webhooks/{id}/deliveries` → `{pending, delivered, failed, last_attempt_at, last_error_code, last_status_code}` (`webhooks.go:54-61`, `:306-334`) trong runbook, không thành màn hình người dùng.

### C9. Các lệnh gọi Hub **không** thuộc spec này (tham chiếu)

`POST /admin/v1/grants` (idempotent theo `idempotency_key`, body `grantWrite`: `hub:internal/admin/grants.go:27-36`), `GET /admin/v1/grants?account=` (`:263-293`), `POST /admin/v1/grants/{id}/revoke` (`:38-42`, `:295-337`), `PUT /admin/v1/accounts/{id}/plan` (app chỉ đặt plan có price book cho channel mình, nếu không 403: `plans.go:449-500`): từ v0.5 được đặc tả đầy đủ ở §16.3 (route, payload, idempotency, `file:dòng`), thuộc các thẻ `AIP-BILL-*`.

---

## 5. Định tuyến AI qua Hub

### 5.1 Đường đi

```
người dùng → handler → service (membership gate, quyền tính năng)
          → ai.Gateway.Complete (chính sách, chọn model, dòng usage pending)
          → provider "hub" (chỉ package này mở kết nối; ADR 0010 giữ nguyên)
          → Hub (admission: model list ∩ policy ∩ số dư ∩ đồng thời → provider thật)
```

`TestProviderSDKOnlyInAIProvider` và `TestAIPackageOnlyCallsAiQueries` (`server/internal/arch_test.go`) giữ nguyên: provider `hub` nằm trong `server/internal/ai/provider/`; gói gọi **admin/usage** của Hub (không phải host mô hình) nằm ở `server/internal/aihub/` và chỉ `internal/service` import nó (thêm một test arch cùng khuôn).

**`internal/ai` không import `internal/aihub` hay `internal/service`, và chỉ gọi query `Ai*`** (`server/internal/arch_test.go:282-284` cấm import, `:289-309` cấm query khác; `ai_hub_accounts` không phải bảng `Ai*`). Mọi thứ Gateway cần từ phía Hub đi qua **giao diện hẹp định nghĩa trong `internal/ai`**, đặt cạnh `Quota` trong `ai.Options` (`gateway.go:25-31`), và `internal/service` hiện thực chúng bằng `internal/aihub` + `ai_hub_accounts`:

| Giao diện (trong `internal/ai`) | Việc | Hiện thực (trong `internal/service`) |
|---|---|---|
| `HubAccounts.Resolve(ctx, organizationID) (externalAccount string, linked bool)` + `EnsureAsync(ctx, organizationID)` | cho Gateway biết account của tổ chức; kích tạo account khi `404` (§8.1) | `ai_hub_account.go` (`AIP-03`) |
| `HubCatalog.Models(ctx, CallMeta) ([]string, error)` | `/v1/models` của người gọi (C6), cache + `singleflight` (§5.5) | `ai_plan_read.go` (`AIP-07`) |
| `PolicyInspector.Exhausted(ctx, CallMeta) (subject, resetsAt, ok)` | suy ra chủ thể khi `429 policy_exceeded` (C4, §8.1) | `ai_plan_read.go` |
| `RoutingFlag.Enabled(ctx, organizationID) bool` | cờ `ai_hub_routing` theo tổ chức (§5.9) | `service` đọc `featureflags` |

Test arch `TestAIPackageHasNoHubOrServiceImport` (cùng khuôn `TestAIPackageOnlyCallsAiQueries`) giữ ranh giới này.

### 5.2 Thay đổi ở tầng provider

- **`CallMeta` đi theo mọi loại lệnh gọi**, không chỉ chat: một kiểu dữ liệu thuần `CallMeta{ExternalAccount, User, Workspace, Feature, RequestID}` thêm vào `provider.CompletionRequest` (`provider.go:124-136`), `provider.EmbedRequest` (`:150-153`) **và** request của `ImageGenerator`, `Transcriber` (`provider/`; `CloudTools` ở `ai/cloud.go:44-48`). `ai.Gateway` điền sau cổng quota từ `ai.Request` (`OrganizationID`, `WorkspaceID`, `Actor`, `Capability`). Adapter vẫn "không biết gì về policy hay giá"; các adapter hiện có bỏ qua `Meta`.
- **Chi phí trả về**: `provider.CompletionResponse` (`provider.go:137-148`) thêm `CostMicros *int64` và `UsageSource string` (và tương tự cho Embed/ảnh/phiên âm). `X-Hub-Cost` là chuỗi **credit 6 chữ số thập phân** (`formatCredits`, `hub:internal/surface/surface.go:180-182`, ví dụ `"0.003200"`) còn `ai_usage_events.cost_micros` là `BIGINT` micro-USD (`092_ai_gateway.up.sql:37`; 1 credit = US$1): provider `hub` đổi bằng `round(credit × 1e6)` thành `int64`, không dùng số thực trôi nổi ở tầng dưới.
- Provider mới `hub` (`ai/provider/hub.go`): chat-completions bọc lại phần wire của adapter `openai` (`openai.go:62-160`), thêm header ở C6/C7, đọc `X-Hub-Cost`/`X-Hub-Usage-Source`, đọc mã lỗi Hub (§8). Công cụ cloud (ảnh, phiên âm) thêm biến thể `hub` cùng khuôn (`ai/cloud.go:53-100`) với nhãn không có `workspace`.
- **Gateway giữ hai provider và chọn theo lệnh gọi.** Hôm nay `ai.Gateway` giữ **một** `provider.Provider` và một `CloudTools` cho cả tiến trình (`gateway.go:121-143`, `FromEnv` ở `ai/config.go:27-65`); như vậy một cờ theo tổ chức không có chỗ tác dụng. Thay đổi: `Gateway` giữ **cả** provider cũ **và** provider `hub` (và `CloudTools` có hai bộ), và mỗi lệnh gọi chọn bằng `RoutingFlag.Enabled(ctx, req.OrganizationID)` (§5.9). Provider `hub` chỉ dựng khi `AI_HUB_URL` có giá trị; thiếu thì cờ bật cho tổ chức nào cũng trả `ai_hub_unavailable` chứ không rơi về provider cũ (đúng Q-AIP-8 a).
- **Chọn model**: `ResolveModel` hôm nay trả mặc định theo `(capability, provider)` (`policy.go:127-153`). Với `hub`, id model là **tên công khai của Hub** do hub_admin đặt, không đặt cứng trong mã. Env `AI_HUB_MODELS_<CAPABILITY>` = danh sách ưu tiên, phân tách bằng dấu phẩy (`AI_HUB_MODELS_DEFAULT` làm dự phòng). Gateway chọn **model đầu tiên của danh sách có trong `/v1/models` của người gọi** (C6). **Danh sách rỗng giao nhau** (Hub trả `200` nhưng không model nào trong danh sách ưu tiên) → `ai_model_not_allowed` (§8), không bao giờ rơi về model ngoài danh sách. **Gọi `/v1/models` lỗi** (mạng, timeout, 5xx) mà chưa có giá trị cache → `ai_hub_unavailable` (503), **không** phải `ai_model_not_allowed` (403): hai nguyên nhân khác nhau, người dùng thử lại khác nhau. Nhờ vậy hạn chế model theo workspace/người dùng (policy `models`) tác động ngay: workspace bị giới hạn chỉ-model-rẻ tự dùng model rẻ.
- Danh sách `allowedModels` (`policy.go:116-124`) áp cho provider cũ; với `hub` danh sách tin cậy là `/v1/models`.

### 5.3 Nhãn gửi cho Hub

| Nhãn | Bắt buộc | Giá trị | Nguồn |
|---|---|---|---|
| `user` | có | người: `Actor.ID`; agent: `agent:<id>`; hệ thống: `system:<tên>` (không đụng ULID của người) | `ai.Request.Actor` (`gateway.go:54`) |
| `workspace` | không | `Request.WorkspaceID`; **vắng** ở call cấp tổ chức (phân tích media, ảnh, phiên âm, embedding không thuộc workspace) | `gateway.go:56`, `ai/cloud.go:131-136` |
| `feature` | có | bảng dưới | `Request.Capability` (`policy.go:19-36`) |

| `Capability` | `feature` | Nơi gọi |
|---|---|---|
| `copilot_answer` | `ask_uni` | `service/askuni.go:191` |
| `office_uniwork_ai` | `office_ai` | `service/ai_uniwork.go:335` |
| `meeting_summarization` | `meeting_summary` | `service/meeting_ai.go:322` |
| `chat_catchup`, `chat_call_summary` | `chat_summary` | `askuni_catchup.go:119`, `chat_voice_summary.go:165` |
| `email_thread_summary` | `email_summary` | `email_hub_ai.go:101` |
| `context_extraction`, `agent_planning|generation|evaluation` | `context` / `agent` | gateway |
| `embedding` | `embedding` | gateway |
| `media_analysis` | `media_analysis` | `ai_cloud.go:348` |
| `cloud_image_generate`, `cloud_transcribe` | `image`, `transcribe` | `ai/cloud.go:181-249` |
| `cloud_search` | — (giữ ở UniWork, Tavily/Brave không phải LLM) | `hub:docs/SPEC.md:626-631` |

### 5.4 `X-Hub-Request-Id` và thử lại

Hub trả `409 duplicate_request` nếu `(channel, account, request_id)` đã dùng, và **không replay** (`hub:internal/admission/admission.go:185-189`, `SPEC.md:241-243`). Quy tắc:

1. Id của một lượt logic = `MeterKey` nếu người gọi đặt tên được (ví dụ `uniwork-ai:<run>:<seq>`, `gateway.go:93-96`), nếu không = id dòng `ai_usage_events` (đã tạo trước khi gọi). Ổn định qua mọi lần thử lại.
2. `429 concurrency_limit` và `429 policy_exceeded` bị từ chối **trước** khi Hub ghi dòng request (`admission.go:170-174`, `:301`, dòng ghi ở `:176+`; slot được nhả `:186`), nên **thử lại với đúng id đó an toàn**.
3. Sau khi Hub đã nhận (có `X-Hub-Request-Id` trong response) hoặc kết nối đứt không rõ kết quả: **không thử lại tự động**. Cần thử lại do người dùng thì dùng id mới (`<id>:r<n>`); nếu cần biết chi phí lượt cũ thì `GET /usage/v1/requests/{id}` (`hub:docs/SPEC.md:466`, `:490-492`). Đây là điểm *giả định* cần kiểm bằng test với Hub thật (thẻ AIP-04): trạng thái dòng request của một lượt `provider_unavailable`.

### 5.5 Dùng `/v1/models` ở UniWork

(i) chọn model mỗi lượt (§5.2); (ii) hiển thị "Mô hình đang dùng" và trạng thái "bị giới hạn bởi gói/hạn mức" ở end-user (board d); (iii) form sửa hạn mức (C6, `user=_catalog`). Cache RAM 60 giây có `singleflight`, **khóa `(organization_id, workspace, user, feature)`** — `feature` nằm trong khóa vì `X-Hub-Label-feature` là nhãn bắt buộc của C6 và một policy cũng có thể khớp theo nhãn đó.

**Làm mất hiệu lực chỉ ở node đã nhận sự kiện; TTL 60 giây là chặn trên cho các node còn lại**: frame realtime đi tới trình duyệt, không tới các node server, nên không dùng được cho việc này. Đăng ký một consumer outbox trong tiến trình nghe `ai_quota.updated`, `ai_quota.threshold_reached`, `ai_credit.ran_low`, `ai_credit.depleted` và xóa mọi khóa của `organization_id` trong payload — cùng khuôn `featureflags.Invalidator` (`server/internal/featureflags/db_provider.go:123-134`, đăng ký ở `server/cmd/server/main.go:525`). **Nhưng mỗi dòng outbox chỉ được một dispatcher nhận** (`FOR UPDATE SKIP LOCKED`, `server/pkg/db/queries/outbox.sql:10-27`; nhận xong đánh dấu `DONE`, `outbox/lane.go:263-274`; `TestLanesDeliverEachRowOnceAcrossNodes`, `outbox/lane_test.go:123-184`, khẳng định giao đúng một lần trên cả cụm), nên consumer này **không** phát tới mọi node: chỉ node đang nhận dòng đó xóa cache; node khác giữ danh sách model cũ tới khi hết 60 giây. Chấp nhận: độ cũ tối đa 60 giây trên node ngang hàng chỉ làm danh sách model hiển thị/chọn cũ trong khoảng đó, còn Hub vẫn thi hành đúng (một model vừa bị loại bị Hub từ chối `403 model_not_allowed` rồi xóa cache của người gọi, §8.1). Nếu sau này cần xóa tức thời trên mọi node thì đó là thay đổi riêng (broadcast thật, ví dụ Redis pub/sub) và test phải nạp cache ở hai instance rồi kiểm cả hai, không chỉ đếm số consumer đã đăng ký.

### 5.6 Đường nào đi Hub

Theo bảng chuyển đổi P1 của Hub (`hub:docs/SPEC.md:624-631`, `connect.md:735-742`): Complete/Embed → Hub; ảnh, phiên âm cấp tổ chức → Hub (không `workspace`); tìm kiếm web → giữ; **BYOK → giữ ở UniWork** (`SPEC.md:31-32`).

### 5.7 BYOK cùng tồn tại

| Câu hỏi | Quy tắc |
|---|---|
| BYOK có vào Hub không? | **Không.** Proxy BYOK (ADR 0029/0034) gọi nhà cung cấp bằng khóa của người dùng; Hub không thấy, không đo, không chặn. UniWork ghi `credits=0` như hôm nay |
| Bị chặn bởi gì? | Chỉ entitlement `office.ai_byok` của gói (`ai_credentials.go:44`, `ai_byok.go:56`) — **không** bởi hạn mức Hub. Org admin không giới hạn được chi phí BYOK bằng màn hình này |
| Đường nào thắng? | **Lựa chọn tường minh của người dùng** (chip nguồn model: `AiModelSource.origin`, `g6-05k-org-keys-api.md:177`). UniWork **không** tự chuyển từ gói sang BYOK hay ngược lại, kể cả khi bị `ai_policy_exceeded` |
| Khi hết hạn mức gói | Trạng thái chặn (board d) nói rõ "hạn mức gói của workspace/bạn đã hết" và, nếu người dùng đã lưu khóa và gói cho phép `office.ai_byok`, gợi ý "Dùng khóa của bạn" — người dùng bấm mới đổi nguồn. Mọi lệnh gọi BYOK sau đó **không** tính vào hạn mức |
| Giải thích | Board f: hai bảng "gói UniWork (tính vào hạn mức, admin quản lý)" và "khóa của bạn (không tính vào hạn mức, bạn tự trả)" ở Cài đặt → AI và chip model |
| Công tắc "bắt buộc dùng gói" cho tổ chức | **Không ở v1** (Q-AIP-5) |

### 5.8 Cổng quyền tính năng giữ nguyên

`FeatureOfficeAICloud`, các cờ `office_ai_uniwork*`, entitlement meeting AI summary… vẫn do service kiểm trước khi vào Gateway (`ai_uniwork.go:249`, `askuni.go:136`). Hub chỉ thêm **một** cổng sau cùng (tiền + hạn mức + model); không thay cổng quyền.

### 5.9 `Quota` sau khi Hub nắm hạn mức

(Điểm ADR phải chốt, `hub:docs/SPEC.md:633-642`; khuyến nghị:) với tổ chức đã bật `ai_hub_routing` (**đánh giá cờ chỉ theo tổ chức**: `featureflag.WithEvalContext(ctx, EvalContext{OrganizationID: req.OrganizationID})` **không** có `UserID`, vì `DBProvider.Lookup` xếp override `user` trước `organization` (`db_provider.go:86-120`) và một override theo người sẽ tách một tổ chức sang hai đường, vi phạm "mỗi tổ chức đúng một đường" ở cuối mục này; override `user` của `ai_hub_routing` vì thế không có tác dụng và bị bỏ qua ở đường AI): `Quota.Check` **bỏ qua meter `ai.tokens`** (không còn kiểm token), `Quota.Record` thành no-op; dòng `ai_usage_events` vẫn ghi (ai/gì/model, không nội dung) với `cost_micros` lấy từ `X-Hub-Cost` để báo cáo UniWork và Hub khớp; `usage_reconcile.go` chỉ còn phục vụ tổ chức chưa bật. Tổ chức chưa bật chạy đường cũ nguyên vẹn (§10). Không có dòng nào tính hai lần: mỗi tổ chức ở đúng một đường tại một thời điểm, quyết bởi cờ theo tổ chức.

**Hai chốt token cũ nằm ở service, không chỉ ở `ai.Quota`.** `AIUniworkService.Chat` gọi `ents.CheckQuota(…, FeatureAITokens, 1)` **trước** Gateway (`service/ai_uniwork.go:279-280`) và `AICloudService.charge` gọi cùng meter trước khi làm việc ảnh/phiên âm/phân tích media (`service/ai_cloud.go:188-193`). Biến `Quota.Check` thành no-op không gỡ được hai chốt này: tổ chức đã bật Hub nhưng hết token cũ vẫn bị từ chối trước khi tới Hub dù còn credit. Vì vậy `AIP-04` thêm cho cả hai nơi một **nhánh bỏ qua theo tổ chức** (cùng `RoutingFlag.Enabled(ctx, orgID)`, đánh giá theo tổ chức): với tổ chức đi Hub thì **bỏ** `CheckQuota(FeatureAITokens)` và giữ nguyên các cổng còn lại (`orgs.RequireMember`, `ents.Can(…FeatureOfficeAICloud)` / quyền tính năng, §5.8); tổ chức chưa bật giữ hành vi cũ. Điều kiện nghiệm thu thêm: tổ chức đi Hub có meter `ai.tokens` đã cạn **và** credit Hub còn → Office chat và một lệnh cloud (ảnh hoặc phiên âm) vẫn chạy được; cùng điều kiện nhưng credit Hub hết → bị `ai_quota_exceeded` (402, §8.1) từ Hub, không phải từ meter cũ.

**Nguồn trạng thái/credit của Office cloud cũng phải theo tuyến (BE-27; `AIP-04` sở hữu, không phải `AIP-07`).** `AICloudService.Status` đọc `s.credits` rồi `cloudState` (`service/ai_cloud.go:125-142`), và `credits` đọc meter `FeatureAITokens` (`:147-175`); handler gắn nhãn đơn vị `FeatureAITokens` (`handler/ai_cloud.go:49-55`). Nếu không đổi, tổ chức đi Hub vẫn nhận `reason=credits_exhausted`, `remaining=0` từ meter cũ dù credit Hub còn, ngay trước khi gọi lệnh Office vừa được mở chốt. `AIP-04` làm nguồn này **nhận biết tuyến** theo cùng `RoutingFlag.Enabled(ctx, orgID)` (đánh giá theo tổ chức): tổ chức đi Hub lấy credit/trạng thái từ Hub (ví qua `HubAccounts`; kết quả cạn → `credits_exhausted`), tổ chức chưa bật giữ **nguyên phản hồi cũ** (`handler/ai_cloud_test.go:290-294` vẫn đúng). Cổng thành viên và entitlement tính năng giữ nguyên. Điều kiện nghiệm thu thêm một **lần đọc trạng thái** (`GET /orgs/{org}/ai/cloud`): meter `ai.tokens` cũ đã cạn **và** credit Hub còn → **không** báo `credits_exhausted`; credit Hub thật sự cạn → báo trạng thái cạn của Hub; tổ chức chưa bật → phản hồi cũ không đổi.

**Hoàn tác giữa kỳ (đã chấp nhận ở pilot R2/R3, quyết định cấp lane):** tắt `ai_hub_routing` khi kỳ đang chạy đưa tổ chức về meter `ai.tokens`, mà meter này **chỉ giữ số đã ghi trước lúc chuyển** (trong lúc đi đường Hub `Quota.Record` là no-op); tổ chức đó vì thế có thể dùng tiếp phần hạn mức token còn lại của cả tháng bên cạnh credit đã chi ở Hub. Sai lệch này nhỏ so với rủi ro của pilot (vài tổ chức nội bộ/thân thiết) nên không dựng cơ chế đối soát; trước R4 (mặc định bật) phải xem lại, hoặc bắt quản trị kiểm hạn mức khi hoàn tác.

---

## 6. Sự kiện

Tên `<thực thể>.<động từ quá khứ>`, payload chỉ id (CLAUDE.md "Audit and Events"; `docs/events/CATALOGUE.md:11-20`). Mỗi lệnh ghi audit + outbox trong **cùng transaction** qua `audit.Recorder.Record(ctx, q, Entry, emit…)`; không gọi `EventPublisher.Publish`.

### 6.1 Topic mới (catalogue + `scripts/events-catalogue.test.mjs`)

Ba nơi: `docs/events/CATALOGUE.md` (bảng dòng 197 là chỗ `quota.threshold`), `server/internal/outbox/catalogue.go` (cạnh `:316`), `packages/core/types/events.ts` (cạnh `:132`). **Bốn topic có khán giả realtime** (`ai_quota.updated`, `ai_quota.threshold_reached`, `ai_credit.ran_low`, `ai_credit.depleted`) vào cả ba nơi. **`ai_quota.sync_requested` có phạm vi `-` (hạ tầng, không client nào nghe) chỉ vào `CATALOGUE.md` và `catalogue.go`, KHÔNG vào `events.ts`**: `scripts/events-catalogue.test.mjs:109-122` đòi danh sách client bằng đúng các dòng có `scope !== "-"`, nên thêm nó vào `events.ts` làm test đỏ (cùng lý do `provider.*` và `webhook.deliver` không có ở client). Các dòng hạ tầng được miễn quy tắc "payload chỉ là id" (`:150`) nhưng spec này vẫn chỉ gửi id.

| Topic | v | Payload | Phạm vi | Giao | Phát bởi | Nghe bởi |
|---|---|---|---|---|---|---|
| `ai_quota.updated` | 1 | `organization_id`, `policy_id` | organization | outbox | `AIQuotaService` Save/Clear (cùng tx với audit) | realtime → làm mới `aiPlanKeys` |
| `ai_quota.sync_requested` | 1 | `organization_id`, `policy_id` | `-` | outbox | cùng tx | `HubPolicySyncConsumer` (**LaneSlow**) |
| `ai_quota.threshold_reached` | 1 | `organization_id`, `policy_id`, `webhook_event_id` | organization | outbox | bộ nhận webhook (§7) | quy tắc thông báo (lane notify) + realtime làm mới |
| `ai_credit.ran_low` | 1 | `organization_id`, `webhook_event_id` | organization | outbox | bộ nhận webhook | quy tắc thông báo |
| `ai_credit.depleted` | 1 | `organization_id`, `webhook_event_id` | organization | outbox | bộ nhận webhook | quy tắc thông báo (+ email, Q-AIP-7) |

Con số (ngưỡng, đã chi, hạn mức, số dư) **không** nằm trong payload: client đọc lại qua API; consumer thông báo đọc **dòng `ai_hub_webhook_events` bất biến** theo `webhook_event_id` (có `threshold`, `spent_micro`…; §3 bảng 3) nên biết đúng ngưỡng đã cắt mà payload vẫn chỉ có id (cùng khuôn `quota.threshold`, `entitlement.go:513-515`). `ai_quota.updated` tách riêng khỏi `ai_quota.sync_requested` vì một topic chạy trên lane **chậm nhất** của các consumer (`CLAUDE.md`, `server/internal/outbox/lane.go:21-24`): nếu gộp, khung realtime của giao diện bị xếp sau việc gọi Hub (LaneSlow, batch 2). Tiền lệ consumer gọi bên thứ ba ở LaneSlow: `outbox.WebhookConsumer` (`server/cmd/server/main.go:443`). Lane `provider` hiện chỉ dành cho LiveKit (`lane.go:31-32`), nên không dùng.

### 6.2 Audit (cập nhật `server/internal/audit/actions.go` + `service/audit_coverage_test.go`)

| Action | Khi nào | Actor | Cách phủ trong `audit_coverage_test.go` | Thẻ sở hữu việc phủ |
|---|---|---|---|---|
| `ai.quota.saved` | tạo/sửa hạn mức (Changes = `audit.Diff` trước/sau) | `audit.User` | mục `cases` chạy lệnh thật của `AIQuotaService` | `AIP-05` |
| `ai.quota.cleared` | xóa hạn mức | `audit.User` | mục `cases` chạy lệnh thật | `AIP-05` |
| `ai.hub.account_linked` | tạo/phục hồi liên kết account | `audit.User` hoặc `audit.System("ai.hub.bootstrap")` | mục `cases` chạy `EnsureAccount` thật (Hub giả) | `AIP-03` |
| `ai.quota.threshold_reached`, `ai.credit.ran_low`, `ai.credit.depleted` | nhận webhook | `audit.System("ai.hub.webhook")` | `actionsWithoutCommands` với lý do "covered by ai_hub_webhook_test.go" (khuôn `ActionMcp*`, `audit_coverage_test.go:36-60`) | `AIP-08` |
| `ai.quota.sync_overrode_hub` | consumer ghi đè phiên bản Hub cao hơn (§6.3) | `audit.System("ai.hub.sync")` | `actionsWithoutCommands` ("covered by ai_hub_sync_test.go") | `AIP-06` |

**Từ vựng đi trước, phần phủ đi cùng lệnh.** `TestEveryAuditedCommandWritesItsRow` duyệt `auditActions()` (danh sách viết tay, `audit_coverage_test.go:1649-1667`): mỗi action trong đó phải có một closure `cases` **chạy lệnh thật** rồi tìm dòng audit, hoặc một mục `actionsWithoutCommands` có lý do; closure rỗng hay symbol chưa tồn tại làm test đỏ hoặc không biên dịch. Vì vậy `AIP-10` chỉ thêm **hằng** vào `audit/actions.go` (không đụng `auditActions()` và không có closure), và **mỗi thẻ sở hữu lệnh** thêm action vào `auditActions()` cùng closure/lý do ở cột cuối, trong cùng PR với lệnh đó — không closure rỗng, không ghi audit giả. Không có test bắt hằng chưa dùng, nên hằng đứng trước lệnh không làm đỏ gì.

Bằng chứng audit không bao giờ chứa token Hub hay secret webhook (`scripts/no-pii-log.test.mjs` cho log; Changes chỉ có trường cấu hình).

### 6.3 Consumer đồng bộ sang Hub

`HubPolicySyncConsumer` (LaneSlow, khuôn `outbox.WebhookConsumer`): đọc dòng `ai_quota_policies` theo `policy_id`, bỏ qua nếu `revision == synced_revision`, `PUT /admin/v1/policies` (C3) với `version=revision`:

**Hai chốt chống đua** (một người lưu tiếp khi lệnh PUT đang bay): `revision` là bộ đếm của UniWork, nên mọi ghi lại dòng đều có điều kiện theo đúng `revision` đã gửi (`sent`).

- `200` → `UPDATE … SET hub_policy_id=$, synced_revision=$sent, sync_state='synced' WHERE id=$ AND revision=$sent`. Nếu dòng đã sang `revision > sent` (có lần lưu mới trong lúc bay) thì **không** đánh dấu `synced`: để `sync_state='pending'` — `ai_quota.sync_requested` của lần lưu mới đã nằm trong outbox và sẽ đẩy bản mới.
- `409 conflict` → (a) đọc lại dòng `FOR UPDATE`; nếu `row.revision != sent` thì **bỏ** (lần lưu mới có consumer riêng) — không ghi `revision` lùi hay đè cấu hình mới hơn; (b) `GET /admin/v1/policies?account=` (C4) tìm policy cùng chủ thể; nếu `hub.version ≥ sent` thì ai đó (hub_admin qua Console) đã sửa bên Hub: **UniWork thắng** — đặt `revision = hub.version + 1` trong cùng tx với audit `ai.quota.sync_overrode_hub`, rồi PUT lại bằng snapshot đọc `FOR UPDATE` đó; (c) nếu Hub đã đúng nội dung (retry của cùng body) thì coi là `synced` theo cùng điều kiện `revision = sent`.
- `401`/`403` (credential app sai, thu hồi, hoặc nhãn/app không được phép) → `sync_state='failed'` ngay + cảnh báo vận hành (`ai_hub_misconfigured`, §8.1), **không** thử lại (lặp lại chỉ chờ tới dead-letter).
- `429` → thử lại theo **backoff lũy thừa sẵn có của outbox** (`outbox.RetryAt`: trần 5 phút, jitter ±20%, `server/internal/outbox/outbox.go:337-351`; `Consumer` chỉ trả `error`, không có chỗ truyền thời gian chờ); **không** hứa tôn trọng `Retry-After` của Hub (`hub:internal/httpx/httpx.go:69-73`), vì dispatcher không đọc nó. Không tính là `failed`.
- Mạng/5xx → để dispatcher thử lại và chuyển dead-letter theo luật outbox (`docs/ops/RUNBOOK_OUTBOX.md`); dead-letter → `sync_state=failed` + chỉ báo trên màn hình Gói AI ("Chưa đồng bộ — đang thử lại") + metric.
- `404` (account chưa link) → chạy `EnsureAccount` (C1) rồi thử lại.
- `400` (nhãn chưa khai báo / model lạ) → `failed` với `sync_error_code`, không thử lại vô ích; cảnh báo vận hành (cấu hình app/catalog Hub chưa khớp).

**Ngữ nghĩa với người dùng:** lưu hạn mức trả về ngay khi UniWork commit; hạn mức có hiệu lực ở Hub sau khi đồng bộ (thường dưới vài giây). Màn hình hiện trạng thái `pending → synced` (thăm dò mỗi 3 giây tối đa 30 giây khi `pending`). Hub là nơi **thi hành**; cấu hình hiển thị luôn là của UniWork.

### 6.4 Thông báo cho người

Mỗi kind mới là một quy tắc trong `server/internal/notification/rules.go`, một tiêu đề trong `titles.go`, một hàng ma trận tùy chọn, và `NOTIFICATION_KINDS` ở `packages/core` (xem `kinds.go:1-12`). Người nhận được lọc qua cổng thành viên hiện tại (`rules.go:25-39`), người đã rời tổ chức không nhận gì:

| Kind | Người nhận | Kênh mặc định |
|---|---|---|
| `ai_quota_threshold` (policy workspace) | owner/admin workspace đó + owner/admin tổ chức | trong app; push tắt; **không** vào digest ngày |
| `ai_quota_threshold` (policy user) | chính người đó (mọi ngưỡng); owner/admin tổ chức chỉ khi `threshold ≥ 100` | như trên |
| `ai_quota_threshold` (policy tổ chức) | owner/admin tổ chức | như trên |
| `ai_credit_low` | owner/admin tổ chức | trong app; **không** vào digest ngày |
| `ai_credit_depleted` | owner/admin tổ chức | trong app + thư giao dịch `ai_quota_alert` (Q-AIP-7); **không** vào digest ngày |

**Kênh thư và digest là hai hợp đồng khác nhau (BE-26, lead đã quyết):** các kind AI (`ai_quota_threshold`, `ai_credit_low`, `ai_credit_depleted`) **không bao giờ** vào digest ngày; thư duy nhất là thư giao dịch `ai_quota_alert` (đoạn "Email" bên dưới) cho owner/admin tổ chức trong hai trường hợp của nó. Thành viên và admin workspace chỉ nhận trong app (khớp board e3b). Hiện thực: hôm nay `Prefs.Email` là cờ digest, mặc định `true` (`notification/prefs.go:16-29`) và `digest.go:105-119` đưa mọi dòng có `prefs.For(kind).Email` vào digest, nên chỉ ẩn công tắc theo vai trò là chưa đủ. `AIP-08` (a) thêm vào `digest.go` một danh sách kind **bị loại khỏi digest** gồm ba kind AI (loại cứng, không phụ thuộc `Prefs.Email`); (b) đổi nghĩa `Prefs.Email` của hai kind có thể gửi thư (`ai_quota_threshold`, `ai_credit_depleted`) thành "nhận thư giao dịch `ai_quota_alert`" — mặc định bật, chỉ owner/admin tổ chức thấy và đổi được (board e3), và là điều kiện bổ sung ngoài vai trò người nhận; (c) đặt `ai_credit_low` vào `NO_EMAIL` (không có thư). Thành viên và admin workspace không có công tắc Email và không bao giờ nhận thư AI (người nhận thư chỉ là owner/admin tổ chức) nên không còn đường nào đưa dòng AI của họ vào digest. Công tắc "bulk Email" của ma trận (`notifications-matrix.tsx:97-101`) chỉ đếm/ghi các kind đủ điều kiện gửi thư theo vai trò đang xem (như `NO_EMAIL` hôm nay), không ghi `Email` của kind người đó không thấy. Kiểm: thành viên có dòng AI trong Hộp việc nhưng digest ngày không chứa nó; owner/admin tổ chức nhận đúng một `ai_quota_alert` mỗi trường hợp, và tắt công tắc Email thì không nhận thư nhưng vẫn có dòng trong app.

**Hộp việc nào hiện dòng nào (FE-36, lead đã quyết; `notifications.workspace_id` nullable, `082_notifications.up.sql:9`, còn Hộp việc đọc `useNotificationPages({ workspaceId })`, `inbox-view.tsx:71`):**

- Dòng **cấp tổ chức** (`ai_quota_threshold` của policy tổ chức, `ai_credit_low`, `ai_credit_depleted`) **không có workspace id** (NULL) và hiện ở Hộp việc của owner/admin tổ chức trong **mọi** workspace của tổ chức đó: truy vấn Hộp việc của workspace lấy cả dòng `workspace_id = <đang mở>` lẫn dòng `workspace_id IS NULL` của đúng người nhận và đúng tổ chức. `AIP-08` sở hữu thay đổi truy vấn này (kèm `TestInboxIncludesOrganizationLevelRows` và ca "dòng NULL của tổ chức khác không bao giờ hiện": mọi truy vấn vẫn ràng `organization_id`).
- Dòng **cấp workspace** (policy workspace) mang `workspace_id` của workspace đó và **chỉ** hiện ở Hộp việc của workspace đó. Dòng của policy `user` áp ở mọi workspace (§2) nên không thuộc workspace nào: coi như cấp tổ chức về chỗ hiện (NULL, hiện ở mọi workspace của chính người nhận).

- **Đếm chưa đọc và "đánh dấu đã đọc hết" theo cùng quy tắc (BE-25):** `CountUnreadNotificationsByWorkspace` hôm nay nhóm NULL riêng (`notifications.sql:70-75`) và `Service.UnreadCount` bỏ nhóm đó khỏi `ByWorkspace` (`notification/service.go:280-285`); `MarkAllNotificationsRead` loại NULL khi có `workspace_id` (`notifications.sql:89-94`). Nếu chỉ danh sách được mở rộng, Hộp việc hiện cảnh báo AI chưa đọc trong khi chuông/sidebar báo 0 và nút "đánh dấu đã đọc hết" bị tắt hoặc để nguyên dòng NULL (`inbox-view.tsx:78,204-205`). **`AIP-08` mở rộng cùng một ràng buộc "dòng `workspace_id IS NULL` của đúng người nhận và đúng tổ chức"** cho: (1) danh sách, (2) số chưa đọc **theo workspace** (số hiển thị của workspace = dòng của workspace + dòng NULL của tổ chức chứa workspace đó), (3) "đánh dấu đã đọc hết" của workspace, và (4) cập nhật cache phía client (`packages/core/notifications/hooks.ts:169-180`: `markAllRead` trừ đúng số hiển thị, không để dòng NULL "sống lại"). **Tổng toàn tài khoản đếm mỗi dòng đúng một lần** (dòng NULL không cộng vào từng workspace rồi cộng lại vào tổng). Test (mở rộng `TestInboxIncludesOrganizationLevelRows`, nền `notification/service_test.go:15-57` chưa có dòng NULL) quan sát cả số đếm lẫn bulk-read: dòng NULL của tổ chức A hiện và được đếm ở mọi workspace của A, được đánh dấu đọc bởi "đọc hết" của workspace, tổng đếm một lần, và **dòng NULL của tổ chức khác không bị đổi** (không hiện, không đếm, `read_at` giữ nguyên).

**Công tắc Email trong nhóm "Gói AI" của ma trận thông báo (FE-38, lead đã quyết):** thư `ai_quota_alert` chỉ gửi cho owner/admin **tổ chức** (đoạn "Email" ngay dưới), nên công tắc **Email** (chỉ ở hai loại có thể gửi thư: hàng "Hạn mức AI sắp hết hoặc đã hết" và `ai_credit_depleted`) **chỉ có ở góc nhìn owner/admin tổ chức** (board e3). Thành viên và admin workspace thấy nhóm "Gói AI" chỉ với hàng "Hạn mức AI sắp hết hoặc đã hết", **chỉ cột Hộp việc**, không có Email và không có hai hàng credit (board e3b). `AIP-08` thể hiện bằng quy tắc quyền trong `packages/core/permissions/` (hàng/ô nào hiện theo `orgRole`), không bằng cờ riêng.

**Cách biết ngưỡng:** consumer thông báo nhận `webhook_event_id` từ `ai_quota.threshold_reached` (§6.1) và đọc `threshold` bất biến từ `ai_hub_webhook_events`; "mức 100" nghĩa là `threshold ≥ 100` và "dưới 100" là còn lại, nên ngưỡng tùy chỉnh (`{50,90}`, §3) vẫn có quy tắc người nhận rõ ràng; email chỉ khi `threshold ≥ 100` và policy là cấp tổ chức.

Email: thư giao dịch mới `ai_quota_alert` (`server/internal/mail/mail.go:13-23` là danh sách kind; `Enqueuer.Enqueue(ctx, q, msg)` cùng transaction, `mail/outbox.go:21-24`) chỉ cho `ai_credit_depleted` và ngưỡng 100% của policy tổ chức; nội dung chỉ có tên tổ chức, tên workspace, liên kết tới "Gói AI", không có số tiền chi tiết của người khác.

---

## 7. Bộ nhận webhook

**Route:** `POST /api/v1/integrations/uniai-hub/webhook`, đăng ký **trong** wrapper `api` với `auth: false`, giống hai tiền lệ cùng loại: `POST /integrations/livekit/webhook` và `/billing/webhooks/vnpay` (`server/internal/handler/router/meetings.go:265`, `billing_webhooks.go:4-14`; `isoRoutes` xếp chúng `isoPublic` với lý do `reasonProvider`: `handler/isolation_routes_test.go:243-245`). Lý do **không** đặt ngoài wrapper như `/mcp` và `/oauth/*`: ngoại lệ đó dành cho giao thức theo RFC; webhook Hub là hợp đồng riêng của UniWork nên phải có mặt trong OpenAPI (một SDO rỗng) và trong `TestSwaggerSpecFollowsChiRoutesAndSDI`.

**Xử lý (theo thứ tự, mọi nhánh lỗi đều không ghi gì):**

1. **Giới hạn thân**: đọc **byte thô** qua `http.MaxBytesReader(w, r.Body, 64<<10)` (khuôn `handler/document_sources.go:170`). Không dùng `decode()` vì HMAC phải tính trên đúng byte nhận (`decode` giải mã rồi mới ra struct, `handler/json.go:36-49`). Quá cỡ → `413`.
2. **Xác minh chữ ký**: `X-Hub-Signature: t=<unix giây>,v1=<hex>`; tính `hex(HMAC-SHA256(secret, "<t>.<thân thô>"))` (`hub:internal/webhook/sign.go:10-22`), so bằng `hmac.Equal` (thời gian không đổi) với **từng** secret trong `AI_HUB_WEBHOOK_SECRETS` (phân tách dấu phẩy; cho phép chồng hai secret khi xoay vì Hub chưa có API xoay secret: tạo endpoint mới rồi tắt endpoint cũ). Thiếu header hoặc sai → `401`.
3. **Chống phát lại**: `t` lệch quá ±5 phút → `401`. An toàn vì Hub ký lại mỗi lần gửi với giờ hiện tại (`hub:internal/webhook/deliver.go:361-374`), kể cả khi thử lại.
4. **Giải mã** thân đã xác thực: `{id, account_id, occurred_at, hub_request_id?, policy_id?, period_id?, threshold?, spent_micro?, limit_micro?, balance_micro?, credit_limit_micro?}` (`hub:internal/webhook/enqueue.go:116-147`). **Loại event nằm ở header `X-Hub-Event`, không có trong thân** — đọc từ header, giá trị ngoài `{policy.threshold, credit.low, credit.depleted}` → bỏ qua `200`. **`X-Hub-Event` và `X-Hub-Delivery` là header nằm NGOÀI chuỗi được ký** (`<t>.<thân thô>`, `sign.go:10-22`), nên không tin chúng trước khi đối chiếu với thân đã ký: bắt buộc `X-Hub-Delivery != ""` **và** `X-Hub-Delivery == payload.id`, nếu không → `401` (chặn kẻ phát lại một thân đã ký trong ±5 phút với `X-Hub-Delivery` đổi để vượt dedup); và **loại event cuối cùng được phân loại từ thân đã ký, không từ `X-Hub-Event` một mình** (header đó không được ký nên một thân hợp lệ có thể bị gắn nhãn khác trong cửa sổ ±5 phút, thắng lần nhận đầu và làm dedup nuốt lần giao thật). Thân có hai hình **loại trừ nhau** (`enqueue.go:116-147`, `settle.go:35-57`, `:62-80`): (a) *policy* — có `policy_id` và `threshold`, **không** có `balance_micro`/`credit_limit_micro`; (b) *credit* — có cả `balance_micro` và `credit_limit_micro`, **không** có `policy_id`/`threshold`. Thân không vào hình nào, hoặc vào cả hai → `400` + metric. Với hình (b), loại do **số đã ký** quyết định theo đúng ranh giới của Hub (`CrossedDepleted`, `enqueue.go:175-177`): `balance_micro + credit_limit_micro ≤ 0` ⇒ `credit.depleted`, ngược lại ⇒ `credit.low` (khi một lượt tính tiền cắt cả ngưỡng thấp lẫn ngưỡng cạn, Hub xếp **hai** delivery: một `credit.low`, một `credit.depleted` (`settle.go:35-57`); thân cùng số dư nhưng `id` khác nhau (`enqueue.go:62-72`) và header giữ nguyên nhãn gốc (`deliver.go:372-374`). Từ số đã ký cả hai đều là depleted: cạn bao hàm thấp). **Quy tắc header**: `X-Hub-Event` không quyết định loại, chỉ được đối chiếu với loại suy ra từ số đã ký, theo hai nhánh: (i) số đã ký nói *chưa cạn* (⇒ `credit.low`) mà header khác `credit.low`, hoặc thân hình (b) mang header `policy.threshold` (và ngược lại thân hình (a) mang header `credit.*`) → `400` + metric `ai_hub_webhook_rejected_total{reason="event_header_mismatch"}`, không ghi gì; (ii) số đã ký nói *đã cạn* thì **chấp nhận cả hai header credit hợp lệ** (`credit.low` lẫn `credit.depleted`): delivery `credit.low` thật của cặp trên nhận `200`, ghi biên nhận (`event_type` = loại suy ra từ thân, tức depleted), và **không emit lần thứ hai** — `ai_credit.depleted` chỉ phát một lần cho cặp, vì biên nhận depleted thứ hai trong cùng một lượt tính tiền (cùng `account_id`, cùng `hub_request_id` khi có, nếu không thì cùng `balance_micro`/`credit_limit_micro`) bị coi là trùng ngữ nghĩa: ghi biên nhận, đếm `ai_hub_webhook_ignored_total{reason="paired_credit_event"}`, không audit/emit. Loại để emit và để chống trùng vẫn lấy từ thân đã ký, không bao giờ từ header, nên kẻ phát lại một thân depleted với header `credit.low` không thắng được lần nhận thật. (Phía Hub nên ký luôn loại event vào payload — H-8, §13.2; khi H-8 có, UniWork đọc loại từ thân và bỏ suy luận.) Trường lạ được chấp nhận (tương thích tiến).
5. **Một transaction**: tra tổ chức qua `ai_hub_accounts.hub_account_id = account_id`; chèn `ai_hub_webhook_events` với `hub_delivery_id = X-Hub-Delivery` `ON CONFLICT DO NOTHING` — không chèn được (đã nhận) → commit rỗng, trả `200`. Chèn được → với `policy.threshold`, tìm `ai_quota_policies` theo `hub_policy_id` **trong tổ chức vừa tra**: **không khớp dòng nào** (policy tạo tay trong Console) → ghi biên nhận (`policy_id` NULL) như "bỏ qua", đếm `ai_hub_webhook_ignored_total{reason="unknown_policy"}`, **không** emit `ai_quota.threshold_reached`, không thông báo; khớp → ghi audit (§6.2) + emit topic kèm `webhook_event_id` của biên nhận (§6.1); commit.
6. **Trả `200 {}`** cho mọi trường hợp đã xử lý, trùng, hoặc **vĩnh viễn không xử lý được** (account/policy không thuộc UniWork, ví dụ policy tạo thủ công trong Console): Hub thử lại 1ph/5ph/30ph/2h/6h/12h rồi `failed` (`deliver.go:75-80`), nên `2xx` là cách duy nhất dừng thử lại vô ích; đếm bằng metric `ai_hub_webhook_ignored_total{reason}`. Lỗi DB tạm thời → `5xx` để Hub gửi lại (giao nhận ít nhất một lần, `deliver.go:294-297`; dedup ở bước 5 làm chúng vô hại).

**Hub không theo redirect** (`deliver.go:176-181`): URL đăng ký phải trả thẳng `2xx`. **Hạn ngạch gửi**: mỗi lần gửi ≤ 10 giây (`deliver.go:45-46`), nên bộ nhận chỉ ghi DB rồi trả lời; việc nặng (thông báo, email) đi qua outbox.

**Giới hạn tốc độ:** thêm đường dẫn vào `mw.ExceptPaths(global, …)` (`router.go:95`) như LiveKit/VNPay (nguồn gửi chỉ là một địa chỉ Hub), **kèm** một limiter riêng theo IP (600/phút, áp `TRUSTED_PROXIES`: `docs`/CLAUDE.md "Backend HTTP Rules") và chính sách mạng chỉ cho địa chỉ Hub vào route này. Test: `TestAIHubWebhookSkipsGlobalLimiterAndHasItsOwn` (khuôn `TestMCPBudgetsEach…`).

**Nhật ký không PII:** log chỉ có `delivery_id`, `event`, `hub_account_id`, `organization_id`, mã lỗi; không email/tên/thân (`scripts/no-pii-log.test.mjs`). **Biến môi trường mới** (đều có trong `.env.example`): `AI_HUB_URL`, `AI_HUB_APP_TOKEN`, `AI_HUB_WEBHOOK_SECRETS`, `AI_HUB_MODELS_*`, `AI_HUB_TIMEOUT_SECONDS`.

---

## 8. Lỗi và trường hợp biên

### 8.1 Ánh xạ lỗi Hub → lỗi UniWork

Mã lỗi UniWork là `ai.Error{Code, Status, Msg}` (`ai/errors.go:11-45`); web phân nhánh theo **`code`**, không theo status (`packages/views/ai/ask-uni-panel.tsx:37-38`, `use-chat-catch-up-ui.ts:12-13`, chuỗi vi ở `packages/core/i18n/locales/vi.json:5194-5195`).

| Hub (HTTP, mã) | Nghĩa | UniWork `code` (HTTP) | Thử lại | Lời nhắn vi (khóa `ai.errors.*`) |
|---|---|---|---|---|
| 402 `insufficient_credit` | số dư + giới hạn nợ ≤ 0, hoặc chưa có plan, hoặc ước tính vượt (`hub:docs/SPEC.md:530`) | `ai_quota_exceeded` (402, **giữ mã cũ** để client không đổi) | không | "Tổ chức đã hết credit AI. Liên hệ quản trị viên tổ chức để nạp thêm." |
| 429 `policy_exceeded` | policy `hard` đã `spent ≥ limit` (`admission.go:301`) | `ai_policy_exceeded` (429, **không** `Retry-After`) | **không** | Có kỳ (`day`/`month`): "Hạn mức AI của {workspace \| bạn \| tổ chức} đã hết cho kỳ này, đặt lại vào {ngày giờ}." — kỳ `none` (`period_id = "all"`, không bao giờ đặt lại: `hub:internal/admission/admission.go:315`) hoặc không suy ra được kỳ: "Hạn mức AI của {workspace \| bạn \| tổ chức} đã hết." (khóa `ai.errors.ai_policy_exceeded_no_reset`, không có ngày giờ) |
| 429 `concurrency_limit` | hết luồng, `Retry-After: 1` (`admission.go:170-174`) | Gateway tự thử lại tối đa 2 lần, 1–2 giây (đúng id, §5.4), hết lượt thì `ai_busy` (429, có `Retry-After`) | có | "AI đang bận, thử lại sau ít giây." |
| 429 `rate_limited` | quá rate limit | `ai_rate_limited` (429, giữ nguyên `Retry-After` đã kẹp 30–300 giây: `errors.go:80-89`) | sau chờ | mã cũ |
| 403 `model_not_allowed` | model ngoài danh sách hoặc không có route định giá | `ai_model_not_allowed` (403); xóa cache `/v1/models` của người gọi | không | "Gói hoặc hạn mức hiện tại không cho dùng mô hình này." |
| 404 `not_found` | account chưa link | `ai_hub_account_missing` (503) + kích `EnsureAccount` bất đồng bộ | sau | "AI chưa sẵn sàng cho tổ chức này." |
| 409 `duplicate_request` | id đã dùng | **lỗi lập trình** (§5.4): log `error`, `ai_provider_error` (502) | không | mã cũ |
| 400 `missing_label`/`invalid_request` | UniWork gửi sai nhãn | `ai_hub_misconfigured` (500, log, metric) | không | "Có lỗi cấu hình AI, đã báo đội vận hành." |
| 401 `invalid_credential` | token app sai/đã thu hồi | `ai_hub_misconfigured` (500) + cảnh báo vận hành | không | như trên |
| 502/503 `provider_unavailable` | mọi route của model lỗi | `ai_provider_error` (502) | người dùng | mã cũ |
| nối Hub thất bại/timeout/5xx | Hub sập | `ai_hub_unavailable` (503), **không gọi thẳng nhà cung cấp** (`hub:docs/connect.md:744-746`) | người dùng | "AI tạm thời không dùng được. Thử lại sau." |

`ai_policy_exceeded` **chủ thể nào hết** (workspace, người dùng hay tổ chức)? Body 429 của Hub chỉ nói "spending limit reached for this period", **không** nêu policy (`admission.go:301`). UniWork suy ra bằng C4: so từng policy khớp (`org`, `ws`, `user` của lượt gọi) có `spent_micro ≥ limit_micro` và `kind=hard`; chọn chủ thể **hẹp nhất** đã hết (user, rồi workspace, rồi tổ chức), kèm ngày đặt lại theo `period_id`. Đọc C4 qua cache 5 giây (khớp cache policy của Hub); thất bại thì rơi về lời nhắn chung "Hạn mức AI của bạn hoặc workspace đã hết". Đề nghị Hub nêu `policy_id` trong body 429 (H-1) để bỏ bước suy luận.

### 8.2 Trường hợp biên

- **Chặn mềm (`soft`)** không chặn; chỉ phát cảnh báo ngưỡng. UI gọi rõ "Cảnh báo" so với "Chặn".
- **Vượt nhẹ** do nhiều lệnh đồng thời cùng lọt kiểm tra (`hub:docs/SPEC.md:193-194`): hạn mức hiển thị có thể thấy `spent > limit` vài phần trăm; UI kẹp thanh ở 100% và ghi "đã vượt nhẹ".
- **Tổng hạn mức con được lớn hơn ví/pool** (oversubscription `SPEC.md:195`): UI không báo lỗi và không có hàng "tổng đã phân bổ" (quy tắc rút gọn §11); hạn mức tổ chức/ví vẫn chặn đúng ở Hub.
- **Credit hết** (`credit.depleted`) chặn *mọi* người dùng của tổ chức, kể cả khi hạn mức ws/user còn: thông báo và lời nhắn khác nhau (`ai_quota_exceeded` so với `ai_policy_exceeded`).
- **Kỳ**: `day`/`month` reset theo múi giờ account (UTC+7); `none` không reset. Màn hình hiển thị `period_id` đã chuyển thành "tháng 10/2026" hoặc ngày.
- **Hub sập**: `ai_hub_unavailable`; các màn hình Gói AI hiện "Không lấy được số liệu từ máy chủ AI" với dữ liệu cache cuối (ghi giờ) thay vì rỗng; cấu hình hạn mức vẫn lưu được (UniWork là nguồn cấu hình), trạng thái đồng bộ `pending` cho tới khi Hub lên lại. Mạch ngắt nhẹ (5 lỗi liên tiếp → mở 15 giây) để không treo luồng.
- **Cache cũ**: ví 30 giây, `/v1/models` 60 giây, C4 5 giây; mỗi payload thêm `as_of`. Sau khi người quản trị lưu, màn hình tự làm mới (`ai_quota.updated`).
- **Người dùng bị vô hiệu hóa/xóa khỏi tổ chức**: policy `user` của họ ở lại (không làm gì có hại); UI lọc theo thành viên hiện tại và **không** vẽ hàng cho policy mồ côi (ngoài phạm vi bản vẽ v1, §12); route xóa vẫn dọn được chúng. Để việc xóa làm được, `DELETE …/quotas/users/{userID}` chỉ đòi `OrganizationService.RequireMember(org, actor)` + `adminLikeRole` và tìm dòng theo `(organization_id=org, subject_kind='user', subject_id=userID)`; **không** gọi `RequireMember(org, target)` ở đường xóa (cổng đó trả `403 member_deactivated`/`forbidden` cho người đã bị vô hiệu hóa hay đã rời: `organization.go:141-165`). `PUT` (tạo/sửa) vẫn đòi `RequireMember(org, target)`: không đặt hạn mức mới cho người không còn hoạt động.
- **Xung đột hai admin** cùng sửa một hạn mức: UniWork dùng `revision` lạc quan (body `revision`); lệch → `409 quota_conflict` kèm bản hiện tại, UI báo "Người khác vừa sửa — tải lại" (board b). Đây **không** phải 409 của Hub (xem §6.3).
- **Tạo lần đầu và tạo lại sau khi xóa (`PUT` là upsert theo `(organization_id, subject_kind, subject_id)`):** tạo lần đầu gửi `revision = 0`; hai admin cùng tạo một chủ thể, người đến sau vi phạm `uidx(organization_id, subject_kind, subject_id)` — service bắt lỗi ràng buộc và trả `409 quota_conflict` (không để lọt `500`), UI tải lại như trên. `DELETE` **giữ dòng**: đặt `removed_at`, tăng `revision`, đẩy `limit_micro=null, models=[]` (§3). Tạo lại sau `DELETE` (hoặc sửa) **cùng một dòng**: gửi `revision` hiện có của dòng (đọc từ `GET …/quotas`, kể cả dòng đã gỡ), service xóa `removed_at` và tăng `revision` thêm 1; gửi `revision = 0` cho chủ thể đã có dòng (kể cả dòng đã gỡ) cũng là `409 quota_conflict`.
- **Hub trả `credit_limit_micro`** trong ví: `Còn dùng được = balance + credit_limit` (admission chặn khi ≤ 0, C2). **UI v1 không hiện** "hạn mức nợ cho phép" cũng như "còn dùng được" tính sẵn (người quản trị không hành động trên chúng, §11): chỉ một con số "Còn" cho thước tổng. Nếu sau này cần thì đó là một thay đổi riêng.

### 8.3 Phía client

Mọi endpoint mới của `packages/core/api/endpoints/` trả `unknown` và định hình bằng `parseWithFallback(raw, schema, fallback, { endpoint })`, schema khoan dung (enum của server là `z.string()`), kiểu export thu hẹp, mọi `switch` có `default`, UI dùng optional chaining (CLAUDE.md "API Compatibility"). **Mỗi endpoint có một ca "malformed response" trong `api/endpoints/ai-plan.test.ts`** chứng minh nó rơi về fallback chứ không ném. Các mã lỗi mới (`ai_policy_exceeded` kèm biến thể `ai_policy_exceeded_no_reset` cho kỳ `none`, `ai_busy`, `ai_hub_unavailable`, `ai_model_not_allowed`, `ai_hub_account_missing`, `quota_conflict`) vào `packages/views/api-error-copy.ts` và `locales/vi.json` + `en.json`, và trong `ask-uni-panel.tsx` / `use-chat-catch-up-ui.ts` (danh sách mã hiểu được).

### 8.4 Bộ nhớ đệm

Cache RAM theo tiến trình (không Redis, không bảng), khóa luôn có `organization_id`; có `singleflight`; giới hạn kích thước. Hub đã cache policy 5 giây (`hub:docs/plans/2026-10-17-p2-plan.md:114`) nên không có lợi gì khi UniWork cache dài hơn cho C4. Đọc lỗi → trả bản cũ kèm `stale=true`, không bao giờ cache lỗi.

---

## 9. Cô lập tenant

Quy tắc (CLAUDE.md "Database and Migration Rules", ADR 0008): mọi truy vấn sqlc chạm bảng tenant ràng buộc `organization_id = $n` hoặc `workspace_id = $n` lấy từ `RequireMember`, hoặc có dòng `-- tenant:` thuộc tập đóng `by-id | parent <cột> | self | token | system | platform` (`TestEveryQueryNamesItsTenant`); ngược lại, một dòng `-- tenant:` đặt lên truy vấn đã nêu tenant hay không chạm bảng tenant bị từ chối (`TestTenantReasonsSitOnTenantQueries`, `server/migrations/query_scope_test.go:67-82`). Mọi bảng mới có `organization_id NOT NULL` (`TestNewTablesCarryOrganizationID`, `TestEveryBusinessTableCarriesOrganizationID`, `TestTenantColumnIsNotNull`).

**Dấu `-- tenant:` của từng truy vấn mới** (`server/pkg/db/queries/ai_hub.sql`):

| Truy vấn | Dấu | Vì sao |
|---|---|---|
| mọi `SELECT`/`UPDATE` theo `organization_id = $n` (list, get theo chủ thể, ghi `revision`, đặt `removed_at`) | không cần | tự nêu tenant |
| `GetQuotaPolicyByID` (consumer đồng bộ đọc theo `policy_id` của dòng outbox) | `-- tenant: by-id` | tải theo id; consumer đã có `organization_id` từ payload và đối chiếu với dòng đọc được trước khi gọi Hub |
| `GetHubAccountByHubID` (webhook tra tổ chức theo `account_id` của thân đã ký) | `-- tenant: by-id` | kết quả *chính là* nguồn tenant; thân đã qua HMAC (§7) |
| `GetQuotaPolicyByHubPolicyID` | không cần: nhận **cả** `organization_id = $1` (đã tra từ account) và `hub_policy_id = $2` | policy của tổ chức khác không bao giờ khớp |
| `InsertAiHubWebhookEvent ... ON CONFLICT DO NOTHING` | **không có dấu** | `INSERT` thường (không phải upsert với khóa chứa tenant) không cần lý do, và thêm dòng `-- tenant: token` làm `TestTenantReasonsSitOnTenantQueries` đỏ |
| `GetAiHubWebhookEventByID` (consumer thông báo đọc theo `webhook_event_id` trong payload) | `-- tenant: by-id` | tải theo id; so `organization_id` với payload |

**Route mới** (đều nằm trong `api` wrapper, SDI/SDO có `description`+`example`). Mọi route AI cấp tổ chức hiện có dùng `{orgID}` (ULID): `/orgs/{orgID}/ai/usage`, `…/ai/credentials`, `…/ai/cloud` (`handler/router/ai*.go`), nên route mới **dùng lại case `orgID`** của `pathParamSDI` (`router/openapi.go:288`) và `workspaceID`; case `org,userID` (`:212`) là biến thể `{org}` (slug), **không** dùng lại được cho `{orgID}`. **Chỉ hai case thật sự mới**: `orgID,workspaceID` và `orgID,userID` — thêm vào `pathParamSDI` ngay cạnh `orgID,eventID`, mỗi case có `description`+`example` (thiếu case thì `mountSwagger` hỏng lúc khởi động).

| Route | Gate | Ghi chú isolation |
|---|---|---|
| `GET /orgs/{orgID}/ai/plan` | org admin | ví + tóm tắt kỳ + bảng ws/user; mang `available` (§10) |
| `GET /orgs/{orgID}/ai/quotas` | org admin | danh sách `ai_quota_policies` (kể cả dòng đã gỡ, để biết `revision`) + `spent_micro` |
| `PUT /orgs/{orgID}/ai/quotas/organization` | org admin | thân: `period, kind, limit_micro, thresholds, models, revision` — **không có trường `_id`** |
| `PUT /orgs/{orgID}/ai/quotas/workspaces/{workspaceID}` | org admin | `WorkspaceService.RequireMember(ws, actor)`: workspace phải thuộc `orgID` |
| `PUT /orgs/{orgID}/ai/quotas/users/{userID}` | org admin | `userID` phải là thành viên **đang hoạt động** của `orgID`: `OrganizationService.RequireMember(org, target)` |
| `DELETE /orgs/{orgID}/ai/quotas/organization`, `…/workspaces/{workspaceID}`, `…/users/{userID}` | org admin | đặt `removed_at`, tăng `revision`; đường `users` **chỉ** đòi `RequireMember(org, actor)` và tìm dòng theo `(organization_id, 'user', userID)` để dọn được policy của người đã rời (§8.2) |
| `GET /workspaces/{workspaceID}/ai/quota` | ws admin | hạn mức của workspace + bảng "Dùng trong workspace" |
| `GET /orgs/{orgID}/ai/models` | org admin | `_catalog` (C6) |
| `GET /workspaces/{workspaceID}/ai/capabilities` (mở rộng) | member | khối `plan{available,state,scope,resets_at,model}`; `available` = `ai_hub_routing && ai_plan_ui` đánh giá theo tổ chức (§10) |
| `POST /integrations/uniai-hub/webhook` | — | `isoPublic`, lý do `reasonProvider` |

**Ca test phải thêm:**

- `TestIsolationMatrix` (`handler/isolation_matrix_test.go`): owner của B gọi mọi route trên với id của A, với `orgID` của B nhưng `workspaceID`/`userID` của A, và không phiên; mong 403/404 (401 khi không phiên), không chữ nào/ id nào của A trong thân, hash mọi dòng `organization_id` của A không đổi, không dòng B trỏ sang A; **mỗi lời từ chối có đối chứng** (owner A đọc/ghi cùng route thành công). Cụ thể cần sửa ba chỗ của bộ test, nếu không CI đỏ:
  1. **Gieo dữ liệu**: `isolation_world_test.go` gieo một dòng `ai_hub_accounts` và một dòng `ai_quota_policies` cho A (`emptyTenantTables`, `isolation_matrix_test.go:50` đòi mọi bảng tenant có dòng của A); `ai_hub_webhook_events` vào `isoUnseeded` (`:1182`) với lý do "chỉ route webhook công khai ghi nó, thế giới isolation không gửi gì". **Việc này thuộc `AIP-02` (thẻ migration), không thuộc thẻ route:** `TestIsolationMatrix` gọi `emptyTenantTables` **trước** khi khám phá route (`isolation_matrix_test.go:43-54`) và hàm đó liệt kê bảng thật có `organization_id` trong schema (`:1144-1178`), nên ngay khi migration của `AIP-02` tạo ba bảng, ma trận đã đỏ nếu thiếu gieo/miễn — không cần đợi route nào đăng ký.
  2. **`isoRoutes`** (`isolation_routes_test.go`; ở thẻ sở hữu route, khi route đăng ký — không sớm hơn): `PUT …/quotas/*` có `body: isoJSON(...)` (thân hợp lệ đủ để đối chứng *ghi* thành công của owner A); `{userID}` không phải dòng tenant nên **phải** phân loại kèm lý do ("chủ thể phải là thành viên của `orgID`"), nếu không `TestIsolationMatrix` đỏ (CLAUDE.md: route có `{param}` không phải dòng tenant thất bại cho tới khi `isoRoutes` phân loại nó kèm lý do); route webhook là `isoPublic` + `reasonProvider` (cạnh LiveKit/VNPay, `:243-245`); `skipControl` chỉ khi có lý do thật (không dùng cho các route này vì Hub giả trả lời được).
  3. **`newIsolationServer`** (`isolation_world_test.go:118`) nối một Hub giả (`httptest`, §14 `AIP-01`) để các đường đọc ví/policy trả lời được cho đối chứng của owner A; ở thẻ sở hữu route đọc/ghi đầu tiên (`AIP-05`, `AIP-07`).
- `TestEveryBodyIDFieldHasAReferenceCase`: các thân không có trường `*_id`/`*_ids` (chủ thể đi bằng đường dẫn) nên không cần `isoReferences`; nếu sau này thêm trường id thì thêm ca (`isoReferences` ở `isolation_references_test.go:115`).
- **Hub không bao giờ trộn tenant:** `TestAIHubClientAlwaysScopesToLinkedAccount`: client `aihub` mọi hàm nhận `organization_id`, tra `hub_account_id` từ **chính** dòng của tổ chức đó, không nhận `hub_account_id` từ ngoài; test với hai tổ chức và Hub giả: lệnh gọi của A chỉ mang account của A; `labels.workspace` do A chỉ định thuộc A.
- **Webhook:** `TestAIHubWebhookRoutesToTheLinkedOrganizationOnly` (event của account A chỉ phát topic `organization_id=A`; account lạ → `200` + không dòng nào), `TestAIHubWebhookDedupByDeliveryID`, `TestAIHubWebhookRejectsBadSignatureAndStaleTimestamp`, `TestAIHubWebhookRejectsDeliveryIDThatDiffersFromBodyID`, `TestAIHubWebhookUnknownPolicyEmitsNothing`, `TestAIHubWebhookClassifiesCreditFromSignedBalances` (thân đã ký có số *chưa cạn* gửi với `X-Hub-Event: credit.depleted` hoặc `policy.threshold` → `400`, không ghi gì; thân có số *đã cạn* gửi với header `credit.low` do kẻ phát lại không được thắng lần nhận thật: loại để emit vẫn là depleted), `TestAIHubWebhookAcceptsGenuineDualCrossing` (ca **cắt cả hai ngưỡng thật**, đặt cạnh các ca header giả: hai delivery id khác nhau, cùng số dư đã cạn, một header `credit.low` và một `credit.depleted`, theo cả hai thứ tự đến → cả hai `200`, hai biên nhận, đúng **một** emit `ai_credit.depleted` và một thông báo, delivery `credit.low` thật không bao giờ bị `400`), `TestAIHubWebhookRejectsAmbiguousBodyShape` (thân policy mang trường credit và ngược lại → `400`) (§7).
- **Realtime:** `TestIsolationRealtime` thêm `ai_quota.updated`, `ai_quota.threshold_reached`, `ai_credit.ran_low`, `ai_credit.depleted`: socket của B không nhận khung của A (phạm vi `organization`, `server/internal/realtime/hub_*_test.go`).
- **Phía Hub:** channel `uniwork` chỉ thấy account của mình (`hub:docs/SPEC.md:601`) — kiểm trong `scripts/e2e` của Hub, tham chiếu không lặp lại.

---

## 10. Cờ và rollout

**Ba cờ** (v0.5 thêm `ai_billing_sync`) trong `server/internal/featureflags/keys.go`, mỗi cờ có `ReviewAt` (`TestFlagsAreReviewed`), override user > tổ chức > toàn cục; cờ chỉ **ẩn** capability, không cấp quyền (khuôn `office_ai_uniwork`, `keys.go:61`):

| Key | Mặc định | Public | Owner | `ReviewAt` | Tác dụng |
|---|---|---|---|---|---|
| `ai_hub_routing` | `false` | không | `ai` | 2027-03-31 | tổ chức này gọi AI qua provider `hub` (cổng quota cũ tắt, §5.9); nơi tạo account Hub |
| `ai_plan_ui` | `false` | không (hiệu lực đi qua API có phạm vi, xem dưới) | `ai` | 2027-03-31 | hiện tab "Gói AI", trình sửa hạn mức, trạng thái hạn mức ở end-user; chỉ có hiệu lực khi `ai_hub_routing && ai_plan_ui` (hai cờ cùng đánh giá **theo tổ chức**, không `UserID`; xem §5.9) |
| `ai_billing_sync` | `false` | không (hiệu lực đi qua `GET /orgs/{orgID}/billing/ai-credit`, §16.10) | `ai` | 2027-03-31 | đơn thanh toán/kỳ của tổ chức này tạo grant ở Hub, bán gói nạp, hiện khối credit ở tab Billing, thu hồi credit khi hoàn tiền (§16); chỉ có hiệu lực khi `ai_hub_routing && ai_billing_sync` (đánh giá **theo tổ chức**, không `UserID`, cùng lý do §5.9). Tách khỏi `ai_plan_ui` để pilot R2/R3 có hạn mức mà chưa tự cấp credit (hub_admin nạp tay) |

**Đưa cờ `ai_plan_ui` tới giao diện (BE-20).** `GET /api/v1/config` hiện đánh giá mọi cờ public **kèm `UserID`** (`handler/config.go:23-25,48`) và `usePublicConfig` gọi nó không có tổ chức rồi cache toàn cục (`packages/core/feature-flags/use-public-config.ts:4-17`); `ai_hub_routing` thì không public. Công bố nguyên trạng không cho ra "hiệu lực = `ai_hub_routing && ai_plan_ui` theo tổ chức": một override `user` của `ai_plan_ui` sẽ tách quyết định giao diện khỏi quyết định định tuyến. Vì vậy **trạng thái hiệu lực do server tính theo tổ chức** (`EvalContext{OrganizationID}`, không `UserID`, cùng cách §5.9) và **trả trong chính API Gói AI có phạm vi**: trường `available` (đã gộp cả hai cờ) trong `GET /workspaces/{workspaceID}/ai/capabilities` (khối `plan`, §9) và trong `GET /orgs/{orgID}/ai/plan`; giao diện chỉ hiện tab/trạng thái khi `available` đúng. Phương án tương đương (nếu cần biết trước khi gọi API có phạm vi, ví dụ để ẩn mục điều hướng): truy vấn cấu hình **khóa theo tổ chức** theo tiền lệ `packages/core/graph/use-graph-ui.ts:12-25` (`getPublicConfig(organizationId)`, khóa truy vấn có `organizationId`), nhưng khi đó `ai_plan_ui` vẫn chỉ là một nửa của điều kiện và nửa kia (`ai_hub_routing`) do API có phạm vi trả. Chủ sở hữu: `AIP-09` (cờ + phép tính hiệu lực phía server dùng chung với §5.9) và `AIP-11` (hook `useAiPlanAvailable(orgId)` trong `packages/core/ai/`, đọc `available`; không dùng `usePublicConfig` toàn cục cho cờ này).

**Hoàn tác** = tắt `ai_hub_routing` cho tổ chức; giữa kỳ, meter `ai.tokens` bắt đầu lại từ số đã ghi trước lúc chuyển (§5.9, chấp nhận ở pilot R2/R3). Cờ **không** cấp quyền: quyền vẫn do cổng ở §2. Cả ba cờ **không** đi qua `GET /api/v1/config` (đoạn trên). Tắt `ai_billing_sync` giữa chừng **không** hủy đơn credit đã ghi: đơn và thu hồi đã tạo vẫn được đẩy tiếp tới Hub (không có đường nào để một đơn đã thanh toán bị bỏ rơi), ngừng tạo đơn `plan_period` mới và ẩn nút nạp; IPN của gói nạp đã mở trước đó vẫn tạo đơn `topup` (§16.12).

**Giai đoạn:**

| Bước | Việc | Điều kiện qua |
|---|---|---|
| R0 | Migration + mã với hai cờ tắt; ADR `AIP-00` merge trước | CI xanh; tổ chức hiện tại không đổi hành vi |
| R1 | Vận hành Hub: provision channel `uniwork` bằng `scripts/provision-uniwork.sh` (nhãn `user`,`feature` bắt buộc, `workspace` tùy chọn; `hub:docs/connect.md:400-439`), đặt env, hub_admin đăng ký webhook (C8) | `GET /v1/models` và một lượt chat thử OK; webhook thử nhận 200 |
| R2 | Bật hai cờ cho **tổ chức nội bộ UniWork**; hub_admin nạp credit tay | kịch bản AC: org admin chia hạn mức ws/user và bị chặn đúng (`hub:docs/SPEC.md:759` mục (b)) |
| R2b | Bật `ai_billing_sync` cho tổ chức nội bộ, VNPay sandbox: mua gói nạp, gia hạn kỳ, hoàn tiền (§16) | mỗi đơn thành đúng một grant (không trùng), hoàn tiền thu hồi đúng phần chưa dùng, `ai_credit_orders` không kẹt `pending/failed` > 15 phút (§16.7) |
| R3 | Pilot vài tổ chức (override theo tổ chức) | không lỗi `ai_hub_*` kéo dài; số liệu ví khớp; thông báo đúng người; với tổ chức có `ai_billing_sync`: ví khớp tổng grant − đã dùng |
| R4 | Mặc định bật | `AIP-BILL-*` đã chạy ≥ 1 chu kỳ đầy đủ ở R3 (mua → dùng → kỳ mới → hoàn tiền thử) và 7 ngày liên tục không đơn kẹt (cảnh báo `AICreditOrderStuck` im lặng, §16.7) |
| R5 | Gỡ cờ + gỡ meter `ai.tokens`, `Quota.Record`, `usage_reconcile.go` | ADR cutover đóng; ghi một ADR gỡ |

**Thứ tự migration:** (1) bảng + index `CONCURRENTLY` (mỗi index một tệp) cho ba bảng, (2) không có migration dữ liệu. Billing (§16.5) thêm các migration riêng ở `AIP-BILL-02` sau `AIP-02`. `EnsureAccount` chạy theo yêu cầu khi tổ chức được bật cờ (và có thể gọi bằng lệnh vận hành `cmd/ai-hub-link --org`), nên **backfill = không có** cho cấu hình; tổ chức chưa bật không có dòng nào.

---

## 11. Màn hình

**Kiểu** (người dùng chốt 2026-10-18 17:35 và 17:50): mọi màn nhìn như **app UniWork đang chạy** — vỏ ứng dụng thật, trang Cài đặt thật (`SettingsTab/Section/Card/Row`, `QuotaMeterRow`), Inter + token ngữ nghĩa của `tokens.css` (cỡ chữ `--text-*`, không màu cứng), Ngăn Hỏi UNI; không dựng một ngôn ngữ thị giác mới và không theo canvas Documents. Mọi text trong `packages/views/` qua `t()` (`i18next/no-literal-string`); biểu tượng theo `docs/conventions.md` › Icons, module qua `MODULE_ICONS`, đang tải là `<Spinner />`. Giữ "workspace" nguyên tiếng Anh (glossary, `docs/conventions.md:169`, `:228-230`).

**Quy tắc rút gọn** (người dùng chốt, bắt buộc): một dòng chỉ ở lại nếu người dùng **làm gì đó trên nó hoặc cần nó để quyết**; một con số cho một ý; không dòng giải thích cho thứ người quản trị không đổi được. Vì vậy các hàng dưới đây **không** có: hạn mức nợ cho phép của ví, "còn dùng được" tính sẵn, số lượt chạy cùng lúc tối đa, "cảnh báo gần đây", "xem trước ảnh hưởng" của hạn mức, "người dùng nhiều nhất" và model đang dùng trên màn workspace, xuất CSV, số lượt/token của khóa riêng (UniWork không đo). Các số tương ứng vẫn nằm ở Hub/API (§4: `credit_limit_micro` ở C2…) nhưng **không có màn nào hiện chúng ở v1**; DTO không cần mang chúng. Mỗi board có sáng/tối, máy tính 1280 + di động 390, ở `reports/ai-plan-uw/design/<board>.html` (chỉ mục `index.html`, ghi chú `NOTES.md`; a–f đã qua hai vòng sửa; **g–j là của vòng 2 billing: 49 trạng thái (g 14, h 14, i 6, j 15), mỗi trạng thái 4 khung; cột "Màn hình" dưới đây dùng đúng id khung của board (`design/NOTES.md` › "Round 2 billing — fix 1"), chờ người dùng duyệt**).

| Board | Màn hình (trạng thái đã vẽ) | Route / path builder | View package |
|---|---|---|---|
| `a-org-plan.html` | **Gói AI** (tab tổ chức, owner/admin; a1–a6): thẻ "Kỳ này" = **một dòng** "đã dùng / hạn mức" kèm số còn lại, tên gói từ catalog UniWork, kỳ; nhóm "Chia hạn mức" hai tab **Workspace** / **Người dùng** (đã dùng / hạn mức, "chờ đồng bộ"), nút sửa và nút **"Đặt hạn mức"** cho workspace/người chưa có hạn mức riêng (a1b, FE-22); một dòng "Cảnh báo" gọn (ngưỡng; người nhận). Trạng thái: đang tải, máy chủ AI không phản hồi (số liệu cuối kèm "Số liệu cũ · giờ", a3), chưa chia hạn mức (a4), cờ tắt (a5), thành viên mở thẳng `?tab=ai-plan` bị từ chối (a6). *Mẫu số của dòng tổng chưa chốt trong Hub (policy cấp tổ chức, C4, hoặc ví, C2); đề nghị: policy tổ chức nếu có, không thì chỉ "Còn US$ x" từ ví; chốt ở `AIP-07`* | `paths.workspace(org, ws).settings()` + `?tab=ai-plan` (nhóm tổ chức, `gate: "org_admin"`, trước "Truy cập AI"; icon `Gauge`); `?tab=` hiện có không đổi | `packages/views/settings/components/ai-plan-tab.tsx` (+ tệp con theo giới hạn 500 dòng) |
| `b-quota-editor.html` | **Trình sửa hạn mức** (b1–b8): **ngăn bên phải (`Sheet`)** trên máy tính như Hỏi UNI, toàn màn hình trên di động (FE-15; không phải hộp thoại); chủ thể (tổ chức/workspace/người), "Khi hết" (**Chặn**/**Chỉ cảnh báo**), hạn mức, kỳ, ngưỡng, model được phép từ `_catalog`; **đích** của bản vẽ: model ngoài gói hiện mờ kèm lý do (D-4), cần Hub trả danh mục gói hoặc model bị loại (**H-7**, §13.2) — `/v1/models` chỉ trả model được phép (`hub:internal/surface/endpoints.go:412-431`) nên chưa đủ; **cho tới khi H-7 có, UniWork chỉ hiện model được phép** (phương án dự phòng, không có hàng mờ). Nút chữ **"Gỡ hạn mức"** ở chân ngăn khi đã có hạn mức (b1, b2) và trạng thái **b1c**: chân ngăn đổi thành một dòng xác nhận "Gỡ hạn mức của Sản phẩm? Workspace sẽ dùng chung hạn mức của tổ chức." + Hủy / Gỡ hạn mức (đường `DELETE`, `ai.quota.cleared`, §9). Lỗi nhập, đang lưu, hạn mức thấp hơn mức đã dùng (cảnh báo vàng, vẫn lưu được), **xung đột `409 quota_conflict`** ("Có người vừa sửa hạn mức này", So sánh trong `Dialog` / Tải bản mới), "Đang áp dụng…" (`pending`) và "Chưa áp dụng được" (`failed`); thêm người (b2b). Chỉ những trường v1 lưu | mở từ bảng ở (a); không có route riêng | `ai-quota-sheet.tsx`, `ai-quota-compare-dialog.tsx` |
| `c-workspace-quota.html` | **Tab AI của workspace, mở rộng** (c1–c5): giữ nguyên cấu trúc đã có (§1.1a) — "Hạn mức của tổ chức", "30 ngày qua", "Theo tính năng" — đổi đơn vị sang US$; thêm hàng chỉ đọc **"Hạn mức của workspace"** (đã dùng / hạn mức, "đặt lại 01/11"), dòng "Cần đổi hạn mức? Chỉ quản trị viên tổ chức đổi được" kèm tên người, và bảng **"Dùng trong workspace"** (một cột số). Workspace đã hết hạn mức (c2, cảnh báo đỏ + ngày đặt lại), chưa có hạn mức riêng (c3), thành viên thường bị từ chối (c5). Nút "Xin tăng hạn mức" chỉ ở c4, **phương án b chưa chọn** (Q-AIP-6). Thanh điều hướng chỉ liệt kê tab mà vai trò đó thấy (FE-20) | `?tab=ai` (nhóm workspace, `gate: "workspace_admin"`, mở rộng `ai-tab.tsx`) | `ai-tab.tsx` + `ai-workspace-quota.tsx` |
| `d-end-user-states.html` | **Trạng thái người dùng cuối** (d1–d6): dải vàng ≥ 80% trên ô nhập — thành viên chỉ thấy **trạng thái + ngày đặt lại**, số tiền chỉ cho hạn mức **cá nhân** của chính họ (d1, d1b); **hết hạn mức** nêu chủ thể (workspace/bạn/tổ chức) + ngày đặt lại + tên người liên hệ, không nút thử lại (d2–d2c); tổ chức hết credit 402 (d2d); Office AI cùng nội dung (d3); "AI đang bận" tự thử rồi nút Thử lại (d4, d4b); "AI tạm thời không dùng được" (d4c); nhãn chỉ đọc "Mô hình đang dùng" + "Bị giới hạn bởi gói" (d5a); bộ chọn model chỉ là **phương án b chưa chọn** (d5, Q-AIP-4); bảng câu chữ d6 = §8.1 nguyên văn | Ask UNI (`packages/views/ai/ask-uni-panel.tsx`), Office AI qua mã lỗi ở lớp host (`apps/web/platform/office-frame/`); frame genoffice ở fork cần map mã mới (`AIP-F`, rủi ro §14); **khung Office (d3, f1–f5) là sơ đồ dựng tay, không phải ảnh app thật** (FE-23, chưa có ảnh nguồn) | `ai-limit-notice.tsx` dùng chung |
| `e-notifications.html` | **Thông báo + email** (e1–e6): dòng Hộp việc cho `ai_quota_threshold`, `ai_credit_low`, `ai_credit_depleted` (board vẽ thêm một dòng "đã hết" như kind riêng `ai_quota_exhausted`; spec chưa tách: mức 100% là `threshold ≥ 100` của `ai_quota_threshold`, §6.4; `AIP-08` chốt có tách kind không) (dựng lại theo Hộp việc thật, có hàng chip loại; **dòng cấp tổ chức không có workspace và hiện ở mọi workspace của quản trị tổ chức, dòng cấp workspace chỉ ở workspace đó**, §6.4, FE-36); toast; nhóm **"Gói AI"** trong ma trận Thông báo — ma trận thật hai cột **Hộp việc | Email** bằng `Switch`, công tắc email chỉ ở hai loại có thể gửi thư (FE-19) và **chỉ trong góc nhìn owner/admin tổ chức (e3)**; thành viên / admin workspace thấy một hàng, chỉ Hộp việc (e3b, §6.4, FE-38); **hai** thư `ai_quota_alert` (tổ chức đạt 100%, tổ chức hết credit; chỉ tên + liên kết, không số tiền); bảng tham chiếu người nhận (§6.4) | Hộp thư thông báo (`packages/views/notifications`), `notifications-matrix.tsx` | + mẫu thư `server/internal/mail/templates` |
| `f-byok-vs-plan.html` | **BYOK so với gói** (f1–f5): chọn nguồn gói/khóa riêng (mặc định gói, D-5), chỉ có gói (f2), chỉ có khóa riêng khi tổ chức chưa mở Gói AI (f3), hết hạn mức gói nhưng có khóa riêng — gợi ý chuyển, người dùng tự bấm (f4, D-6), nhãn nguồn dưới câu trả lời (f5). Quản trị không thấy số của khóa riêng (UniWork không đo; đã bỏ khung f6) | Cài đặt → AI (`ai-tab.tsx`), nơi lưu khóa BYOK, chip Office | `ai-source-explainer.tsx` |
| `g-billing-plan.html` *(v0.5.1, billing)* | **Tab Billing có credit AI** (14 khung: g1–g12 + g4b, g10b), mở rộng tab đang chạy chứ không dựng mới (`billing-tab.tsx:105-204`, `plan-cards.tsx:20-71`). **g1** gói trả phí: thẻ gói ghi **giá VND mỗi kỳ** và **"Gồm US$ y credit AI"** (hai con số độc lập, không quy đổi, Q-AIP-2), hàng **"Credit AI"** một số "Còn US$ z" = credit kỳ + credit nạp (dòng phụ "Gồm US$ x credit nạp."; ví Hub, `as_of`; "Kỳ này cấp US$ y, hết hạn dd/mm") và nút **"Nạp thêm credit"** (chỉ owner); **g3** Starter: hàng Credit AI mỗi tháng (Q-AIP-11 (a)) và **không** nút nạp (Q-AIP-19); **g2** nâng Team → Business (ghi "Kỳ mới tính từ lúc thanh toán; credit còn lại của kỳ hiện tại vẫn dùng đến khi hết hạn", Q-AIP-14); **g4** hạ gói trong hạn mức (hộp xác nhận; theo **Q-AIP-20 (a)** là lên lịch: "Hạ xuống Team từ dd/mm; thanh toán gói Team khi hết kỳ", ghi "credit của kỳ hết hạn cùng kỳ; credit đã nạp thêm giữ nguyên", Q-AIP-13; hôm nay server trả `downgrade_not_allowed`); **g4b** hạ gói khi tổ chức vượt hạn mức của gói thấp (dải đỏ, nút `aria-disabled`; server chặn bằng `quota_exceeded` hiện có); **g5** đã hẹn hạ gói (nút "Hủy lịch hạ gói"); **g6** sắp hết kỳ: "Gia hạn" = owner trả lại qua VNPay, không tự thu tiền, không cộng dồn (Q-AIP-13); khung vẽ nút **trước hạn**, mà luật hôm nay chỉ cho "Thanh toán ngay" sau quá hạn — nút sớm là câu hỏi design B-2 của `index.html`, chưa quyết; **g7** quá hạn `past_due` (dải vàng hiện có kèm "Nếu bạn vừa thanh toán, hệ thống cần vài phút để xác nhận"); **g8** admin tổ chức không phải owner: chỉ đọc, không nút; **g9** cờ tắt (`available=false`): tab y như hôm nay (meter Token AI, không khối credit); **g10** credit đã hết (tổng credit kỳ + nạp = 0; một nút "Nạp thêm credit", ở dải đỏ); **g10b** credit kỳ đã hết nhưng còn credit nạp (không hiện "Đã hết"); **g11** đang tải (khung chờ, không số giả); **g12** Hub không phản hồi: số dư cũ kèm "Số liệu cũ · giờ", nút nạp vẫn dùng được (thanh toán không phụ thuộc Hub, §16.7). **Không có** bảng "lịch sử nạp" riêng (trùng Hóa đơn, quy tắc rút gọn): đơn nạp hiện trong Hóa đơn (i1, i2). Trạng thái "Đang cộng credit" của đơn `pending` nằm ở board h (h5, h6). Không có: tỉ giá, đơn vị token cho tổ chức đã qua Hub, nút nạp ở Starter | `paths.workspace(org, ws).settings()` + `?tab=billing` (không đổi) | `billing-tab.tsx` + `billing-ai-credit.tsx`, `plan-cards.tsx` |
| `h-topup-vnpay.html` *(v0.5.1)* | **Nạp credit qua VNPay** (14 khung: h1–h11 + h2b, h3b, h8b): **h1** chọn gói nạp (ngăn `Sheet` bên phải như b; ≤ 3 gói "US$ x — y ₫"; ghi "credit đã nạp dùng được tới dd/mm/yyyy" = 12 tháng, Q-AIP-17, và "được tiêu sau credit của kỳ", Q-AIP-18; Q-AIP-12); **h2**, **h2b** đang chuyển sang VNPay (nút xoay trong ngăn, rồi toast "Đang chuyển sang cổng VNPay…"); **h3** trở về `?checkout=success` đang xác nhận (app hỏi lại trạng thái đơn); **h3b** trở về nhưng hỏi lại hết thời gian mà đơn vẫn `pending` (chuỗi `checkout_confirming_timeout` hiện có + "Đừng thanh toán lại." + "Thử lại"); **h4** đã nạp (toast "Đã nạp US$ x", hạn 12 tháng; dòng Credit AI gộp); **h5** đã thanh toán, đang cộng credit (intent `completed`, đơn credit `pending`; dải thông tin, không nút trả tiền lại); **h6** cộng credit quá 10 phút (không báo lỗi thanh toán, không nút trả lại; hiện số hóa đơn); **h7** đã hủy (`checkout=cancel`, toast hiện có, không dải); **h8** thất bại do cổng từ chối rõ ("Bạn chưa bị trừ tiền", "Thử lại"); **h8b** phiên hết hạn (`expired`: câu trung tính, "đừng thanh toán lại" trước "Thử lại"); **h9** lỗi khi tạo đơn (`billing_provider_unavailable` hiện trong ngăn, ngăn không đóng); **h10** còn một đơn nạp đang chờ (gói của đơn là hàng chọn duy nhất, các gói khác `aria-disabled`; dùng lại link, không mở hai đơn); **h11** bảng câu chữ. Không phải owner / cờ tắt / gói miễn phí / `past_due` (Q-AIP-19): dùng **g8, g9, g3, g7** (nút ẩn hoặc mờ kèm lý do, "Nâng cấp gói để nạp thêm"), không có khung h riêng | cùng tab Billing; trở về qua `?checkout=success\|cancel&credit=1` | `ai-credit-pack-sheet.tsx`, `use-ai-credit-return.ts` |
| `i-refund-reversal.html` *(v0.5.1)* | **Hoàn tiền và thu hồi credit, phía owner** (6 khung i1–i6; trong Hóa đơn: `InvoicesPanel` + ngăn chi tiết `Sheet` chia Tiền / Credit AI / Gói): **i1** danh sách "Tất cả hóa đơn" (mới nhất trước) với các trạng thái hóa đơn hiện có (`paid` kèm `amount_refunded` > 0 là hoàn một phần, `refund_pending`, `partial_refund_pending`, `refunded`) và hóa đơn gói nạp; **i2** hoàn toàn bộ **gói nạp**, credit chưa dùng ("Đã hoàn tiền", "Credit đã thu hồi US$ a"; hóa đơn gói nạp không đổi gói đăng ký, §16.5); **i3** hoàn một phần hóa đơn gói (trạng thái hóa đơn vẫn `paid`; huy hiệu **"Đã hoàn một phần"** ở i1/i3 là **nhãn giao diện suy ra từ `amount_refunded > 0`**, không phải trạng thái máy chủ, và client hôm nay chưa có chuỗi này — admin chỉ có "Chờ hoàn một phần" — nên là chuỗi mới; phần đã hoàn ghi rõ; gói giữ nguyên, "Còn dùng được" = số dư hiện tại); **i4** hoàn toàn bộ hóa đơn gói sau khi đã dùng một phần credit (tổ chức về Starter, nhắc g3; chỉ phần chưa dùng bị thu hồi; nhãn "Đã dùng (không thu hồi)", "Credit đã dùng không thu hồi được."); **i5** `refund_pending` ("Đang chờ VNPay duyệt hoàn"; credit giữ nguyên tới khi hoàn xong, §16.8); **i6** đã hoàn tiền, thu hồi **đang xử lý** (nhãn "Đang thu hồi", "tự thử lại"; không thuật ngữ Hub, không nút). Trạng thái thu hồi `needs_support` (không tìm thấy grant, 4xx; §16.8 bước 2 và 7) là trạng thái **giữ nguyên trong spec**: cùng ngăn như i6 nhưng huy hiệu "Cần hỗ trợ" và câu "Đội hỗ trợ đang xử lý." thay cho dòng "tự thử lại" (nó sẽ không bao giờ tự thử lại), không thuật ngữ Hub, không nút; **khung riêng (đề nghị i6b) do thợ thiết kế vẽ thêm** (FE-B25), tới lúc đó chưa có khung. Owner **không** tự hoàn tiền (không nút), chỉ xem kết quả (Q-AIP-16) | tab Billing → Hóa đơn (`invoices-panel.tsx`) | `invoices-panel.tsx` (+ ngăn chi tiết hóa đơn) |
| `j-billing-notices.html` *(v0.5.1)* | **Trạng thái phụ billing** (15 khung j1–j15): **j1** Hộp việc bốn dòng `billing_credit_added` ("Đã nạp US$ x credit AI"), `billing_renewed` ("Đã thanh toán gói X, kỳ đến dd/mm"), `billing_payment_failed` ("Thanh toán chưa thành công"), `billing_refunded` ("Đã hoàn tiền hóa đơn #…") — **chỉ owner tổ chức**, cấp tổ chức, hiện ở mọi workspace của owner (§16.9, §6.4 FE-36), chip loại "Thanh toán" (nhóm mới của `notification-category.ts`, AIP-BILL-10); **j2** nhóm "Thanh toán" trong ma trận Thông báo (bốn hàng, Hộp việc \| Email bằng `Switch`, chỉ góc nhìn owner; ghi chú: Email = biên nhận gửi ngay, không gom digest); **j3–j6** bốn thư giao dịch: j3 `billing_credit_added`, j4 `billing_renewed`, j5 `billing_payment_failed` (thất bại rõ ràng nên nói "chưa bị trừ tiền"), j6 `billing_refunded` (dòng tiền ngay; credit chỉ "sẽ được điều chỉnh", không nêu US$); **j7–j9** người dùng cuối khi tổ chức hết credit: j7 thành viên (câu chỉ đích danh owner, không nút nạp), j8 admin tổ chức không phải owner (xem, không nạp), j9 owner (nút "Nạp thêm credit" → g10, h1); **j10** `/admin` chi tiết tổ chức: nút "Cấp credit" + khối **"Credit AI"** (ví, đơn kèm trạng thái, đơn `failed` nổi bật); **j11–j14** hộp cộng credit tay (`ReasonDialog` thêm số US$ và hạn dùng tùy chọn; lý do ≥ 10 ký tự): j11 lý do còn thiếu, j12 đang cấp, j13 đã cấp (toast, ví tải lại), j14 lỗi Hub (không ghi khoản nào, hộp giữ lý do); **j15** hộp hoàn tiền hóa đơn thêm khối "Credit liên quan: đã cấp US$ x · còn US$ y · đã dùng US$ z; sẽ thu hồi tối đa US$ y" (nhân viên quyết số tiền hoàn, Q-AIP-15). Toast khi trở về từ VNPay là h4 và h7, không phải khung j | Hộp thư thông báo; `/admin` chi tiết tổ chức; `invoice-refund-dialogs.tsx` | `packages/views/admin/admin-ai-credit-*.tsx` + `invoice-refund-dialogs.tsx` |

---

## 12. Ngoài phạm vi

- ~~**Billing**~~ — **đã vào phạm vi từ v0.5** (Q-AIP-1 = (c)): §16 và thẻ `AIP-BILL-00…15`. Phần billing **vẫn ngoài phạm vi**: (a) **tự gia hạn thu tiền định kỳ** — VNPay ở UniWork là thanh toán một lần mỗi đơn, không có token thẻ lưu sẵn (`server/internal/service/billing_checkout.go:126-143`, `billing_lapse.go:121-163`: hết kỳ → `past_due`, owner trả lại); (b) **chia tỉ lệ (proration) tiền VND** khi đổi gói giữa kỳ (hôm nay không có, §16.6.4); (c) **owner tự hoàn tiền** (hôm nay chỉ nhân viên nền tảng, `handler/router/admin.go:60`); (d) tỉ giá/đa tiền tệ (Q-AIP-2: không quy đổi); (e) hóa đơn điện tử/thuế VAT; (f) thanh toán `direct` ở Hub (P4); (g) màn `/admin` sửa catalog gói nạp (v1 gói nạp gieo bằng migration; sửa giá = migration có review) và thu hồi tay đơn `adjust` (hub_admin thu hồi ở Hub Console nếu cần); (h) **Hub plan riêng theo từng gói UniWork** (khác model/đồng thời theo hạng): v1 dùng một Hub plan chung, mở rộng ở thẻ `AIP-BILL-14` khi chủ sản phẩm yêu cầu (§16.4); (i) BYOK **không bao giờ** thu tiền hay cấp credit (§16.1).
- **P3 Hub**: status model realtime, đối soát provider, API key + khách mời, token ngắn hạn cho client, Gemini native, batch/video/realtime, `model.status_changed`.
- **P4 Hub**: Hub Console công khai, OIDC, thanh toán `direct`, **link ví có sẵn + consent**, app thứ hai (D14, `SPEC.md:761`).
- BYOK đi qua Hub (`SPEC.md:771`); web search qua Hub; rerank/image edits ở UniWork (item 6 "chưa có yêu cầu": `hub:docs/plans/2026-10-17-p2-plan.md:209`).
- Hạn mức theo cặp `(workspace, user)`, hạn mức mặc định cho mọi user, xóa policy thật, `grant.*` webhook, phát `credit.*` khi revoke/hết hạn grant, dọn `webhook_outbox` (`SPEC.md:785-790`).
- Màn hình `/admin` mới; xuất báo cáo CSV của usage (`GET /usage/v1/export` chưa dùng).
- Sửa fork genoffice để hiển thị mã lỗi mới trong frame (thẻ riêng ở repo office; rủi ro §14).
- **Hàng riêng cho người đã rời tổ chức mà còn policy `user` (policy mồ côi)** trong bảng "Người dùng" của Gói AI: ngoài phạm vi bản vẽ v1 (không board nào vẽ). Route `DELETE …/quotas/users/{userID}` vẫn dọn được chúng (§8.2, §2) cho vận hành/API; màn hình lọc theo thành viên hiện tại.

---

## 13. D3 — Quyết định cần người dùng

Chỉ những gì người dùng phải chọn. Khuyến nghị đứng đầu, kèm lý do. Mọi quyết định còn lại (tên bảng, tên route, thứ tự migration…) đã nằm trong §3–§10 và §16 theo khuôn của repo.

### 13.0 Trạng thái các câu hỏi (v0.5)

| Câu | Trạng thái | Chốt |
|---|---|---|
| Q-AIP-1 | **Đã quyết** — người dùng 2026-10-18 22:05 (đổi so với khuyến nghị của v0.4) | **(c)** một epic gồm cả billing (§16, thẻ `AIP-BILL-00…15`) |
| Q-AIP-2…10 | **Đã quyết** — người dùng 2026-10-18 22:00 | đúng khuyến nghị đứng đầu từng câu: 2 (a) hiển thị US$, 3 (a) không mặc định, 4 (a) UniWork chọn model, 5 (a) không công tắc cấm BYOK, 6 (a) chỉ thông báo, 7 (b) thư giao dịch `ai_quota_alert`, 8 (a) lỗi rõ ràng khi Hub sập, 9 (a) cutover theo tổ chức bằng cờ, 10 (a) làm vòng (mở rộng tới H-9, H-10 ở v0.5) |
| D-1…D-7 | **Đã quyết** — người dùng 2026-10-18 22:00 | đúng khuyến nghị của index (§13.4) |
| Q-AIP-11…20 | **Chờ người dùng** (v0.5, billing) | xem dưới; mỗi câu có khuyến nghị đứng đầu. Q-AIP-13 (không rollover) và Q-AIP-17…20 (hạn credit nạp, thứ tự tiêu, nạp chỉ cho gói trả phí, hạ gói lên lịch) lấy **"Shared billing terms baseline" của lead làm khuyến nghị** (board g–j đang được vẽ theo đó); chỗ mã/Hub không khớp baseline được ghi ngay trong câu |

**Q-AIP-1 — Phạm vi epic này.** *(Đã quyết: (c), 22:05; giữ nguyên nội dung v0.4 để lưu vết.)*
(a) Chỉ phần quản lý hạn mức, *giả sử* P1 đã tích hợp. — Không khả thi: UniWork **chưa có** tích hợp Hub (§1.1).
(b) **Nền + hạn mức** (tạo account, provider `hub`, cutover `Quota`, hạn mức, webhook, màn hình); **billing (grant khi mua gói) tách `AIP-BILL`**, pilot hub_admin nạp tay. *(khuyến nghị của v0.4)*
(c) Tất cả cùng một epic, gồm grant/revoke/đặt plan. **← người dùng chọn**
Lý do (v0.4): (b) đưa được tới R2 (kịch bản AC của §22 P2) mà không kéo luồng thanh toán VNPay (`billing_*.go`) vào; billing có lịch và rủi ro riêng. Hệ quả của (c): billing có spec riêng ở §16 cùng đợt, nhưng vẫn đi **sau** nền (cờ `ai_billing_sync` tách khỏi `ai_hub_routing`, R2 chạy trước R2b, §10) nên rủi ro billing không chặn pilot hạn mức.

**Q-AIP-2 — Đơn vị hiển thị hạn mức.** Hub tính bằng **credit (1 credit = US$1)**, không có tỉ giá (`hub:docs/SPEC.md:211-215`).
(a) **Hiển thị US$** với 2 chữ số (ví dụ "US$ 3,20 / 10,00"), không quy đổi. *(khuyến nghị)*
(b) Quy đổi VND bằng tỉ giá cấu hình của UniWork.
(c) Giữ "token ước tính" như hôm nay.
Lý do: (a) chính xác và không phải duy trì tỉ giá; (b) cần một con số tỉ giá do chủ sản phẩm sở hữu và dễ lệch với hóa đơn; (c) sai bản chất (Hub tính tiền, không tính token) và làm tổ chức chuyển từ token sang credit hiểu sai.

**Q-AIP-3 — Hạn mức mặc định khi chưa đặt.** Hub chưa có "mặc định cho mọi user" (`SPEC.md:786`, `connect.md:758-760`).
(a) **Không mặc định**: chưa đặt = chỉ bị chặn bởi ví tổ chức (và policy cấp tổ chức nếu có); đề nghị Hub thêm mặc định (H-3). *(khuyến nghị)*
(b) UniWork tạo một policy cho **từng thành viên/workspace** khi tạo và một job backfill (N policy, N lần gọi Hub, phải theo dõi thành viên ra/vào).
(c) Chờ Hub có mặc định rồi mới ra mắt.
Lý do: (a) nhỏ nhất, không chặn ra mắt, và hạn mức "tổng tổ chức + chặn từng nhóm nếu cần" là nhu cầu thật của bước pilot; (b) tạo cả nghìn policy và một job đồng bộ thành viên cho một tính năng chưa chứng minh nhu cầu.

**Q-AIP-4 — Ai tự chọn model dùng.**
(a) **UniWork chọn theo capability** từ danh sách ưu tiên ∩ `/v1/models`; người dùng thấy nhãn đọc-chỉ "Mô hình đang dùng" và trạng thái giới hạn. *(khuyến nghị)*
(b) Thêm bộ chọn model cho người dùng ở Ask UNI/Office AI.
Lý do: hôm nay không có bộ chọn cho AI do UniWork phục vụ (§1.1); (a) giữ trải nghiệm và cho admin giới hạn model thật sự có tác dụng; (b) là tính năng sản phẩm mới (cần tên hiển thị/capability mà `/v1/models` không trả).

**Q-AIP-5 — Công tắc "bắt buộc dùng gói, cấm BYOK" cho tổ chức.**
(a) **Không ở v1**; BYOK chỉ bị cổng entitlement `office.ai_byok` như hôm nay. *(khuyến nghị)*
(b) Thêm công tắc tổ chức (bảng/route/audit/cách ly: một card nữa).
Lý do: nhu cầu chưa được nêu; (b) cũng gợi nên hỏi ADR 0034 phương án (b) khóa dùng chung do admin đặt.

**Q-AIP-6 — Người dùng hết hạn mức làm gì.**
(a) **Chỉ thông báo** ("Liên hệ quản trị viên", kèm gợi ý BYOK nếu có). *(khuyến nghị)*
(b) Thêm nút "Xin tăng hạn mức" gửi thông báo cho admin.
Lý do: (a) đủ cho v1 và không thêm loại thông báo; (b) có thể vào sau nếu pilot cho thấy nhu cầu.

**Q-AIP-7 — Email cảnh báo.**
(a) Chỉ thông báo trong app (kênh sẵn có; kind AI không vào digest ngày, §6.4).
(b) **Thêm thư giao dịch `ai_quota_alert`** chỉ cho `credit.depleted` và ngưỡng 100% của policy tổ chức (đều làm ngưng AI cả công ty). *(khuyến nghị)*
Lý do: đây là hai sự kiện dừng dịch vụ; digest hằng ngày đến quá muộn.

**Q-AIP-8 — Hub sập thì sao.**
(a) **Lỗi rõ ràng "AI tạm thời không dùng được", không gọi thẳng nhà cung cấp** (đúng nguyên tắc Hub `connect.md:744-746`). *(khuyến nghị)*
(b) Trong pilot, tổ chức đã bật cờ tự rơi về đường cũ khi Hub sập.
Lý do: (b) tính tiền hai nơi và làm hạn mức mất ý nghĩa. Tổ chức chưa bật cờ vẫn chạy đường cũ nên pilot không làm hỏng ai.

**Q-AIP-9 — Cách cutover.**
(a) **Theo tổ chức bằng cờ `ai_hub_routing`** (mỗi tổ chức đúng một đường). *(khuyến nghị)*
(b) Đồng loạt một ngày.
Lý do: (a) không tính trùng, hoàn tác bằng cách tắt cờ, tương thích tiền lệ `mcp_connector`/`office_ai_uniwork`. Lưu ý hoàn tác giữa kỳ (§5.9): meter `ai.tokens` cũ chỉ giữ số đã ghi trước lúc chuyển, nên tổ chức hoàn tác có thể dùng thêm phần token còn lại của kỳ; đã chấp nhận cho pilot R2/R3 (quyết định cấp lane), xem lại trước R4.

**Q-AIP-10 — Phụ thuộc Hub: chờ hay làm vòng.**
(a) **Ra mắt bằng cách làm vòng** (§13.2); xin Hub bổ sung H-1…H-10 như cải tiến sau (H-7: tới khi có, bộ chọn model chỉ hiện model được phép, D-4; H-9…H-11 của billing: §16.3, H-11 thêm ở v0.5.1). *(khuyến nghị; đã chọn 22:00, áp cho H-1…H-8; H-9/H-10 thêm ở v0.5 theo cùng khuôn)*
(b) Chờ Hub thêm H-1 (chủ thể trong lỗi 429), H-2 (lọc `external_id`), H-5 (nhãn trong webhook) rồi mới ra mắt.
Lý do: mọi mục đều có cách làm vòng nhỏ, và chủ Hub đã nói phía UniWork không chặn v0.2.0.

---

#### Câu hỏi mới của billing (v0.5) — **chờ người dùng**

Chỉ những điều người dùng phải chọn: giá/kích thước là quyết định của chủ sản phẩm và không suy ra được từ mã. Mọi con số tiền dưới đây là **tham số do chủ sản phẩm đặt**, spec không bịa số.

**Q-AIP-11 — Credit AI mỗi kỳ của từng gói (và gói Starter miễn phí có credit không).** Hôm nay hạn mức AI của gói là token (`ai.tokens`: Starter 100.000, Team 2.000.000, Business 10.000.000 mỗi kỳ: `server/migrations/9991790921000000_billing_tiers_b1.up.sql:25-26,51,72`); sau cutover đơn vị là **US$ credit** (Q-AIP-2) và Hub không tự cấp credit theo plan (§16.3).
(a) **Chủ sản phẩm đặt `ai.credit_micro` cho từng gói trong ma trận gói hiện có** (`/admin` → Gói, route đã có `PUT /admin/plans/{code}/features/{key}`, `handler/router/admin.go:59`) **trước R3**; **Starter có credit nhỏ khác 0 mỗi tháng** để AI không biến mất ở gói miễn phí. *(khuyến nghị)*
(b) Như (a) nhưng Starter = 0 (AI chỉ cho gói trả phí hoặc có nạp thêm).
(c) Suy credit từ giá VND bằng một công thức — **không**: cần tỉ giá, trái Q-AIP-2.
Lý do: (a) dùng đúng bảng entitlement đã có, owner đổi số không cần deploy, và đổi theo từng tổ chức bằng `subscription.overrides` (đối tác/pilot); (b) làm tổ chức đang dùng AI ở Starter mất tính năng ngay ở R4 — nếu chọn (b), thêm ghi chú đối ngoại trước R4.

**Q-AIP-12 — Gói nạp credit (top-up): có bán không, kích thước, hạn dùng.** Hôm nay không có hàng hóa nào ngoài gói đăng ký (§16.2).
(a) **Bán 3 gói nạp cố định** (tên, giá VND, credit US$ do chủ sản phẩm chọn), gieo bằng migration; hạn dùng của credit nạp ở Q-AIP-17, thứ tự tiêu ở Q-AIP-18, điều kiện mua ở Q-AIP-19. *(khuyến nghị)*
(b) Cho nhập số tiền tùy ý (cần mức tối thiểu/tối đa, làm tròn VND, hóa đơn lẻ — nhiều rủi ro sai số hơn).
(c) Không bán nạp ở v1: chỉ credit theo kỳ; hub_admin/hỗ trợ cộng tay (§16.11).
Lý do: (a) nhỏ nhất mà tổ chức hết credit giữa kỳ vẫn có đường tự cứu; hạn dùng và thứ tự trừ của phần đã nạp nằm ở Q-AIP-17/18 (Hub trừ grant hết hạn sớm nhất trước: `hub:internal/store/queries/ledger.sql:17-22`, `SPEC.md:223-224`).

**Q-AIP-13 — Credit chưa dùng của kỳ có chuyển sang kỳ sau (rollover) không.**
(a) **Không**: credit theo kỳ hết hạn cuối kỳ (cộng thời gian ân hạn 7 ngày của gói trả phí, §16.6.5); credit nạp thêm giữ nguyên. *(khuyến nghị)*
(b) Có: cần thu hồi phần còn lại rồi cấp lại ở kỳ sau — Hub không cho gia hạn `expires_at` của grant cũ (grant bất biến, `hub:internal/admin/grants.go:27-36`), nên mỗi kỳ thêm hai lệnh Hub có thể lệch nhau.
Lý do: (a) là mặc định của chính Hub (`hub:docs/SPEC.md:222` "mặc định không rollover") và không cần luồng đối soát phụ; ai muốn dư thì mua gói nạp.

**Q-AIP-14 — Nâng gói giữa kỳ.** Hôm nay thanh toán nâng gói **mở kỳ mới từ lúc trả tiền** và không trừ tiền phần kỳ cũ còn lại (`billing_provider_event.go:188-189`).
(a) **Giữ nguyên hành vi billing hiện có**: kỳ mới + credit kỳ mới đầy đủ; credit còn lại của kỳ cũ vẫn dùng tới hạn của nó (Hub trừ grant hết hạn sớm nhất trước); **không** chia tỉ lệ tiền VND. *(khuyến nghị)*
(b) Chia tỉ lệ (trừ tiền kỳ cũ còn lại, cấp credit tương ứng) — cần đổi luật tính tiền của billing, ngoài epic này (§12).
Lý do: (a) không thay luật thu tiền đang chạy và không bao giờ làm mất credit đã trả.

**Q-AIP-15 — Hoàn tiền khi credit đã tiêu.** Hub chỉ thu hồi được **phần chưa tiêu** của grant, không bao giờ âm số dư (`hub:internal/ledger/ledger.go:101-134`).
(a) **Thu hồi phần chưa tiêu, tối đa bằng tỉ lệ số tiền được hoàn; phần đã tiêu không thu hồi**; hộp thoại hoàn tiền ở `/admin` hiện "đã cấp / còn / đã dùng" để nhân viên **tự chọn số tiền hoàn** (hoàn một phần theo phần chưa dùng); không chặn cứng. *(khuyến nghị)*
(b) **Chặn hoàn tiền** nếu đã dùng bất kỳ phần nào của đơn đó.
(c) Cho Hub ghi nợ (đặt `credit_limit_micro` > 0 cho plan UniWork, `hub:docs/SPEC.md:316-317`) để thu hồi đủ — **không**: làm số dư âm và nuốt đơn nạp sau (`ledger.go:88-96`: grant kế tiếp trả nợ trước), rối cho khách.
Lý do: (a) khớp đúng khả năng của Hub (`hub:docs/connect.md:670`: "phần đã tiêu không thu hồi; chuyện tiền với khách UniWork tự xử lý") và giữ quyền quyết cho nhân viên; (b) kẹt các ca hoàn tiền chính đáng (lỗi dịch vụ).

**Q-AIP-16 — Ai được yêu cầu hoàn tiền.**
(a) **Chỉ nhân viên nền tảng** như hôm nay (`POST /admin/invoices/{invoiceID}/refund`, `handler/router/admin.go:60`); owner chỉ xem kết quả. *(khuyến nghị)*
(b) Owner tự yêu cầu hoàn tiền trong N ngày đầu — thêm route, luật chính sách và màn hình; ngoài epic này.
Lý do: không đổi luật hoàn tiền đang chạy; (b) cần chủ sản phẩm quyết N và điều kiện.

**Q-AIP-17 — Hạn dùng của credit nạp.** *(khuyến nghị = baseline của lead; thay cho "không hết hạn" ở bản nháp đầu của v0.5)*
(a) **12 tháng kể từ lúc trả** (giờ Việt Nam), với `expires_at = max(trả + 12 tháng, hạn muộn nhất của mọi grant `plan_period` còn hiệu lực + 1 ngày)`. Vế `max` bảo đảm **tại lúc tạo đơn** credit nạp hết hạn **sau** credit kỳ còn hiệu lực kể cả khi một gói có kỳ dài (mã hỗ trợ `billing_period='year'`: `billing_provider_event.go:241-256`; hôm nay chỉ Team và Business, cả hai theo tháng: `9991790921000000_billing_tiers_b1.up.sql:5,9`). *(khuyến nghị)*
(b) Không hết hạn (`expires_at` rỗng): đơn giản nhất, nhưng mỗi lần nạp là một khoản credit tồn vô thời hạn.
(c) Hạn khác (3/6/24 tháng): chỉ đổi một hằng số.
Lý do: (a) khớp baseline, Hub nhận `expires_at` tùy ý cho grant `order` (`hub:internal/admin/grants.go:27-36`) và job `ExpireGrants` đưa phần còn lại về 0 (`hub:internal/meter/meter.go:312-345`). **Hệ quả cần chấp nhận:** credit nạp hết hạn mà chưa dùng thì mất, không hoàn tiền (luật hoàn tiền không đổi, Q-AIP-16); màn hình ghi hạn ở h1 và g1.

**Q-AIP-18 — Thứ tự tiêu credit.** *(baseline của lead)*
(a) **Credit kỳ trước, credit nạp sau.** Không cần việc nào ở Hub: Hub trừ grant hết hạn sớm nhất trước (`hub:internal/store/queries/ledger.sql:17-22`), và Q-AIP-17 (a) làm credit nạp hết hạn muộn hơn credit kỳ **tại lúc tạo** (khoản nạp 12 tháng mua ở tháng 1 hết hạn trước grant kỳ của tháng 12, nên cuối hạn nó bị trừ trước: vô hại cho khách). *(khuyến nghị)*
(b) Credit nạp trước: chỉ làm được nếu credit nạp hết hạn **sớm hơn** credit kỳ (Hub không có "ưu tiên theo loại": `priority` chỉ phá thế hòa khi cùng `expires_at`), mâu thuẫn với Q-AIP-17 (a).
Lý do: (a) giữ phần khách đã trả thêm tới cuối cùng, và là hành vi mặc định của Hub.

**Q-AIP-19 — Gói nạp có bán cho gói miễn phí không.** *(baseline của lead)*
(a) **Chỉ bán khi tổ chức đang ở gói trả phí và đang `active`**: `planIsPaid(plan)` của gói hiện tại (đã có ở `billing.go:128`); tổ chức Starter thấy "Nâng cấp gói để nạp thêm" (g3, g7), đã có credit nhỏ hằng tháng (Q-AIP-11); tổ chức `past_due` phải gia hạn trước. *(khuyến nghị)*
(b) Bán cho mọi gói, kể cả Starter.
Lý do: (a) không để gói nạp thay cho gói đăng ký và giữ giá trị của việc nâng cấp; chỉ là một điều kiện ở `AICreditService`/handler checkout, không thêm bảng.

**Q-AIP-20 — Hạ gói lên lịch từ kỳ sau.** *(baseline của lead; **là khả năng billing mới**, không phải thứ AI cần thiết phải có)* Hôm nay hạ gói trả phí bị từ chối ở cả đổi gói lẫn checkout (`downgrade_not_allowed`: `billing.go:203-207`, `billing_checkout.go:71-75`); đường duy nhất là `Cancel` về gói miễn phí. Không có hạ từ Business xuống Team. Và vì không có tự gia hạn, khi hết kỳ mà gói còn là `past_due` thì owner **cũng không mua được gói rẻ hơn** (checkout vẫn từ chối).
(a) **Cho hạ gói lên lịch**: thêm `subscriptions.scheduled_plan_id`; `PATCH /orgs/{orgID}/billing/plan` sang gói trả phí **rẻ hơn** ghi lịch thay vì trả `403`; quyền lợi và credit giữ nguyên tới `current_period_end` (cộng ân hạn như hôm nay); `Checkout` chỉ cho gói **đã lên lịch** và **chỉ khi kỳ đã hết** (mua sớm sẽ mất phần kỳ còn lại: luật không cộng dồn, `billing_provider_event.go:188-189`); owner hủy lịch được; credit kỳ mới tính theo gói mới lúc trả (§16.6.1). Vẫn không tự thu tiền. Thẻ riêng `AIP-BILL-15`. *(khuyến nghị)*
(b) Giữ hôm nay: hạ gói bị từ chối, đường hạ là hủy cuối kỳ; board g vẽ theo phương án này (g4 hôm nay bị từ chối; g5 chỉ hiện khi (a)).
Lý do: (a) khớp baseline và sửa lỗ hổng nêu trên, nhưng chạm lõi billing đang chạy tiền thật (migration cột, hai luật mới ở `changePlan`/`Checkout`, lapse đọc lịch) nên tách thẻ, sau chuỗi `AIP-BILL-03…09`, không chặn R2b.

### 13.2 Phụ thuộc Hub (nếu Hub thiếu thứ UniWork cần, ghi ở đây, không bịa)

| # | Thiếu gì | Hôm nay | Cách làm vòng | Đề nghị |
|---|---|---|---|---|
| H-1 | Lỗi `429 policy_exceeded` không nói policy/chủ thể nào (`admission.go:301`) | thông điệp chung | UniWork suy ra bằng C4 (§8.1) | thêm `policy_id`, `label_key`, `label_value` vào body |
| H-2 | Không tra `hub_account_id` theo `external_id` | `GET /accounts` + khớp `name` | đặt `name="uniwork:<org>"` (C1) | thêm `?external_id=` |
| H-3 | Không có hạn mức mặc định cho account/channel | không mặc định (Q-AIP-3) | một policy/ chủ thể | policy mặc định theo nhãn (SPEC §23) |
| H-4 | `GET /admin/v1/accounts/{id}/plan` và `plans` chỉ `hub_admin` | UniWork dùng catalog gói của mình | không cần đọc plan Hub | cho app đọc plan của account đã link |
| H-5 | Webhook `policy.threshold` chỉ có `policy_id`, không có `label_key/value` | UniWork tra `hub_policy_id` → dòng của mình | lưu `hub_policy_id` từ response PUT; khôi phục bằng PUT lặp (`200` cùng id) | thêm nhãn vào payload |
| H-6 | Không có "danh mục model của gói" cho form sửa | gọi `/v1/models` với `user=_catalog` | giá trị tổng hợp không khớp policy | endpoint danh mục theo account (guide theo plan, SPEC §23) |
| H-7 | `GET /v1/models` chỉ trả model **được phép** (giao plan ∩ account ∩ policy), không trả model bị loại hay lý do (`hub:internal/surface/endpoints.go:412-431`); nhãn tổng hợp không đổi điều đó | bản vẽ b2/b3 cần hàng "ngoài gói" mờ kèm lý do (D-4) nhưng không có nguồn dữ liệu | **UniWork chỉ hiện model được phép** (không hàng mờ) cho tới khi H-7 có | Hub trả danh mục gói (model + mô tả lý do loại) hoặc danh sách model bị loại theo account/policy |
| H-8 | Loại event webhook nằm ở header `X-Hub-Event`, **không được ký** (`hub:internal/webhook/sign.go:10-22`), và thân `credit.low`/`credit.depleted` có cùng trường | UniWork suy loại từ thân đã ký (`balance_micro + credit_limit_micro ≤ 0` ⇒ depleted) và đối chiếu header (§7) | đủ cho v1; lượt cắt cả hai ngưỡng cùng lúc bị xếp depleted, cả hai header credit hợp lệ được nhận và chỉ emit một lần (§7 bước 4) | ký luôn loại event: thêm `type` vào payload (hoặc đưa `X-Hub-Event` vào chuỗi ký) |
| H-9 *(billing, §16.3)* | `PUT /admin/v1/accounts/{id}/plan` **không idempotent và không có khóa**: mỗi lần gọi **thêm một dòng** `account_plans`, plan hiện hành = dòng có `id` mới nhất (`hub:internal/admin/plans.go:485-489`, `hub:internal/store/db/accounts.sql.go:173-182,268-281`; test khẳng định "append-only", `hub:internal/admin/ac2_plan_app_db_test.go:56-61`); app **không đọc được** plan hiện hành (`GET …/plan` chỉ `hub_admin`, = H-4) | UniWork lưu `hub_plan_id_synced` và **chỉ PUT khi plan mong muốn ≠ đã đồng bộ**; mỗi lần PUT đọc trạng thái mong muốn lúc chạy (không lấy từ payload sự kiện) nên PUT chạy lại hay chạy trễ hội tụ về đúng plan; lịch sử Hub dài hơn là vô hại | PUT là no-op (200, không thêm dòng) khi plan đã là hiện hành, hoặc nhận `Idempotency-Key`/`If-Match`; kèm H-4 (app đọc plan của account đã link) |
| H-10 *(billing, §16.3)* | Không có `GET /admin/v1/grants/{id}`; `GET /admin/v1/grants?account=` trả **50** grant mới nhất nếu không gửi `limit`, tối đa **200** với `limit=200`, **không phân trang** (`after` bị bỏ qua: `hub:internal/admin/grants.go:270`; `defaultListLimit` = 50, `maxListLimit` = 200: `hub:internal/admin/accounts.go:18-19,103-114`); `revoke` > phần chưa tiêu bị `409` mà không cho biết còn bao nhiêu (`hub:internal/ledger/ledger.go:117-119`, `grants.go:111-127`) | UniWork lưu `hub_grant_id` từ response grant; để thu hồi: đọc `GET grants?account=<id>&limit=200` lấy `remaining_micro` rồi `revoke` min(mục tiêu, còn lại); bị `409` thì đọc lại `remaining_micro`: nhỏ hơn số đã gửi (đua) thì thử với **khóa mới**, ngược lại `needs_support` (§16.8 bước 6); grant ngoài 200 mới nhất → đơn thu hồi `needs_support` | thêm `GET /admin/v1/grants/{id}` (app, chỉ grant của mình) và/hoặc `revoke` với `"mode":"unused"` (thu hồi tối đa phần chưa tiêu, trả số đã thu hồi) |
| H-11 *(billing, §16.8)* | Không có mã lỗi riêng cho các loại `409` của `POST /admin/v1/grants` (khóa dùng với thân khác) và của `revoke` (khóa dùng với thân khác, hoặc quá số chưa tiêu) | cùng `code:"conflict"`, chỉ khác `message` (`hub:internal/admin/grants.go:111-127`; `httpx.CodeConflict` = `"conflict"`, `hub:internal/httpx`; `hub:docs/connect.md:670` chỉ nói "`409 conflict`") | UniWork phân loại theo ngữ cảnh, không đọc `message`: với `grants` mọi `409` là khóa-khác-thân; với `revoke` đọc lại `remaining_micro` và so với số đã gửi (§16.8 bước 6) | mã riêng cho `idempotency_mismatch` và `revoke_exceeds_unused`, kèm `remaining_micro` trong body của cái sau (gộp với H-10) |

### 13.3 Điều *giả định* cần kiểm bằng test với Hub thật (đã đưa vào thẻ)

(1) `user=_catalog` trả đúng **tập model gói cho phép** (H-6; không trả model bị loại, H-7) và `label_key=""` cho policy cấp tổ chức; (2) trạng thái dòng request của lượt `provider_unavailable` (id có tái dùng được không, §5.4); (3) `PUT` lặp cùng version và cùng body trả cùng `id` (đã thấy trong mã `policies.go:246-249`; kiểm thêm bằng e2e); (4) thứ tự chữ ký khi retry (đã thấy trong mã `deliver.go:361-374`).

**Giả định của billing (§16) cần kiểm bằng test với Hub thật, đưa vào thẻ `AIP-BILL-01`/`-04`/`-07`:** (5) `POST /admin/v1/grants` gửi lại cùng khóa **sau khi** UniWork mất response trả `200` cùng `id` (đã thấy trong mã `ledger.go:62-73`, `grants.go:155-172`; kiểm bằng e2e có Hub thật); (6) hai `POST` song song cùng khóa chỉ tạo **một** grant (đã có test phía Hub `ac3_grants_db_test.go:13`; UniWork kiểm lại đầu-cuối); (7) `revoke` cùng khóa, cùng số, cùng lý do trả `200` y hệt, **khác lý do hoặc số** trả `409` (`grants.go:177-207`) — UniWork luôn gửi `reason` cố định theo bản ghi thu hồi; hai kiểu `409` của revoke mang cùng `code:"conflict"` (H-11), nên test luôn phân loại theo `remaining_micro`, không theo `message`; (8) grant hết hạn bị job Hub zero **trong vòng ~1 phút** sau `expires_at` (`hub:internal/meter/meter.go:312-345`, chu kỳ 1 phút) và số dư ví giảm theo — UniWork hiển thị ví qua cache 30 giây nên không hứa chính xác tới giây; (9) plan UniWork của Hub được hub_admin tạo với `credit_limit_micro = 0` (mặc định của `provision-uniwork.sh:164`; mặc định của chính Hub cho channel nội bộ là 5% giá gói: `hub:docs/SPEC.md:316-317`) — nếu khác 0, số dư có thể âm và đơn nạp kế tiếp bị trừ nợ trước (`ledger.go:88-96`); R1 kiểm giá trị này.

### 13.4 Câu hỏi design D-1…D-7 (từ `reports/ai-plan-uw/design/index.html`)

Mười câu Q-AIP ở trên là quyết định về **hành vi và phạm vi**; bảy câu D-n là quyết định về **bản vẽ** mà index đã liệt kê. **Cả bảy đã được người dùng chọn theo khuyến nghị (2026-10-18 22:00)**; bảng giữ nguyên để lưu vết. Khuyến nghị theo index; bản vẽ vẽ theo khuyến nghị trừ khi ghi khác.

| # | Câu hỏi | Khuyến nghị (index) | Ai quyết | Ghi chú đối chiếu spec |
|---|---|---|---|---|
| D-1 | Hạn mức theo người áp ở **mọi** workspace (Hub chưa có cặp workspace+người) — chấp nhận ở bản đầu? | Chấp nhận; ghi rõ trong ngăn sửa (b2) | **người dùng** | khớp §2 "Ràng buộc do Hub quyết định" và Q-AIP-3; không có cách làm vòng ở UniWork |
| D-2 | Hạn mức mới mặc định là "Chặn" hay "Chỉ cảnh báo"? | "Chỉ cảnh báo" lần đầu | **người dùng** | bản vẽ b1b/b2b nay **chọn sẵn "Chỉ cảnh báo"** (khớp khuyến nghị; Lưu bị khóa tới khi nhập số); `kind` mặc định của Hub là `hard` (C3) nên "Chỉ cảnh báo" là UniWork gửi `kind=soft` tường minh |
| D-3 | Chỉ owner/admin **tổ chức** sửa; admin workspace chỉ xem? | Đúng | **người dùng** xác nhận | đã là quy tắc trong §2 (Hub: policy `user` áp ở mọi workspace, nên admin workspace sửa là vượt quyền); đổi quyết định này kéo theo đổi §2/§9 |
| D-4 | Model ngoài gói: hiện mờ kèm lý do hay ẩn hẳn (ngăn sửa; cả bộ chọn nếu Q-AIP-4 b)? | Hiện mờ kèm lý do | **người dùng** | **chỉ làm được hàng mờ khi Hub có H-7** (§13.2); cho tới lúc đó UniWork chỉ hiện model được phép (từ `_catalog`, C6, giả định H-6) — chọn "hiện mờ" nghĩa là chấp nhận chờ H-7 hoặc ra mắt với phương án dự phòng |
| D-5 | Khi có cả gói và khóa riêng, mặc định dùng nguồn nào? | Gói (mức dùng nằm trong hạn mức) | **người dùng** | §5.7 "Đường nào thắng" (lựa chọn tường minh của người dùng) |
| D-6 | Cho chuyển sang khóa riêng một chạm khi gói hết (đi vòng qua hạn mức admin)? | Cho, chỉ khi tổ chức bật BYOK, nói rõ nhà cung cấp tính phí theo khóa của họ | **người dùng** | §5.7 "Khi hết hạn mức gói"; quan hệ Q-AIP-5 (không có công tắc cấm BYOK ở v1) |
| D-7 | Tab AI của workspace có giữ "30 ngày qua" và "Theo tính năng" (đang chạy ở app) hay rút gọn theo quy tắc của §11? | Giữ (index đã có D-7; c1–c4 vẽ đúng như app đang chạy, kể cả cột "Người gọi") | **người dùng** | là tính năng đã có, gỡ nó ngoài phạm vi epic (§1.1a) |

---

## 14. D4 — Chia thẻ triển khai

Kích thước S ≤ nửa ngày, M ≈ 1–2 ngày, L ≈ 3–5 ngày. Cột "Hub" là phụ thuộc vào đầu ra của Hub (v0.2.0 là L1 policy `spent_micro`, L2 `/v1/models` nhãn, L3 webhook). Mọi thẻ code theo CLAUDE.md: viết test lỗi trước, chạy test hẹp khi làm, cả bộ ở MR; không cờ nào bật mặc định.

| ID | Tiêu đề | Phạm vi đường dẫn | Cỡ | Phụ thuộc | Hub |
|---|---|---|---|---|---|
| **AIP-00** | ADR "AI qua Hub: cutover `Quota`, nhãn tenant, topic outbox, Hub sập" (viết trước khi đổi luật; xem `docs/adr/README.md`, `scripts/governance.test.mjs`) | `docs/adr/0035-*.md` | S | Q-AIP-1, 8, 9 | — |
| **AIP-01** | Gói client Hub: `server/internal/aihub` (account, ví, policy GET/PUT, usage summary, models; kiểu lỗi; mạch ngắt; hết thời gian 2s đọc/5s ghi; liệt kê account có phân trang cho phục hồi, C1); Hub giả `httptest` dùng chung; test arch "chỉ `internal/service` import `aihub`" | `server/internal/aihub/**`, `server/internal/arch_test.go` | M | AIP-00 | v0.2.0 |
| **AIP-02** | Migration + sqlc ba bảng (index `CONCURRENTLY` riêng), query có `-- tenant:`, lint; **cùng thẻ** sửa `isolation_world_test.go` để `TestIsolationMatrix` không đỏ ngay khi ba bảng tồn tại (§9, BE-19): gieo một dòng `ai_hub_accounts` và một dòng `ai_quota_policies` cho tổ chức A, và `ai_hub_webhook_events` vào `isoUnseeded` kèm lý do. Thân route, `isoRoutes` và Hub giả **ở lại thẻ route**; **cùng thẻ** phân loại ba bảng cho xuất/xóa tổ chức (§16.5, BE-B7) | `server/migrations/999*_ai_hub_*`, `server/pkg/db/queries/ai_hub.sql`, `server/internal/handler/isolation_world_test.go`, `isolation_matrix_test.go`, `server/internal/service/tenant_export_tables.go`, `tenant_delete_tables.go` | S | AIP-00 | — |
| **AIP-03** | `EnsureAccount`: tạo/phục hồi account Hub (lặp trang), ghi `ai_hub_accounts`; hiện thực giao diện `HubAccounts` (§5.1) cho Gateway; lệnh vận hành `cmd/ai-hub-link --org`. Audit `ai.hub.account_linked`: hằng đã ở `AIP-10`; **thẻ này** thêm action vào `auditActions()` và closure `cases` chạy `EnsureAccount` thật với Hub giả (§6.2) | `server/internal/service/ai_hub_account.go`, `server/cmd/ai-hub-link/` | M | AIP-01, 02, 10 | C1 |
| **AIP-04** | **Provider `hub` + định tuyến Gateway**: giao diện hẹp trong `internal/ai` (`HubAccounts`, `HubCatalog`, `PolicyInspector`, `RoutingFlag`, §5.1) + test arch `TestAIPackageHasNoHubOrServiceImport`; `CallMeta` trên Completion/Embed/ảnh/phiên âm, `CostMicros`/`UsageSource` trên response (§5.2); Gateway giữ hai provider, chọn theo cờ **chỉ theo tổ chức** (§5.9); nhãn (§5.3), chọn model ∩ `/v1/models` (§5.2), id yêu cầu (§5.4), ánh xạ lỗi (§8.1); **sở hữu** `service/ai_quota.go` (cổng cờ cho `Quota`) và ghi `cost_micros` từ `X-Hub-Cost`; **bỏ qua hai chốt token cũ theo tổ chức** cho tổ chức đi Hub — `ents.CheckQuota(FeatureAITokens)` trong `AIUniworkService.Chat` (`service/ai_uniwork.go:279-280`) và `AICloudService.charge` (`service/ai_cloud.go:188-193`) — giữ cổng thành viên và entitlement tính năng, tổ chức chưa bật giữ hành vi cũ (§5.9, BE-21); **làm `AICloudService.Status`/`credits` (`service/ai_cloud.go:125-175`) nhận biết tuyến** (tổ chức đi Hub lấy credit từ Hub, tổ chức chưa bật giữ phản hồi cũ, BE-27, §5.9); nghiệm thu thêm: meter `ai.tokens` cạn + credit Hub còn → Office chat và một lệnh cloud vẫn chạy **và lần đọc trạng thái `/orgs/{org}/ai/cloud` không báo `credits_exhausted`** (credit Hub cạn thật → báo trạng thái Hub); biến thể cloud ảnh/phiên âm; test với Hub giả + kiểm giả định (2) | `server/internal/ai/provider/hub.go`, `ai/gateway.go`, `ai/hub_ports.go`, `ai/cloud*.go`, `ai/errors.go`, `ai/policy.go`, `service/ai_quota.go`, `service/ai_uniwork.go`, `service/ai_cloud.go`, `server/internal/arch_test.go` | **L** | AIP-01, 03, 09 | C6, C7 |
| **AIP-05** | `AIQuotaService`: list/get/save/clear (org/ws/user), cổng §2 (xóa `users/{userID}` chỉ cần `RequireMember(org, actor)`), `revision` lạc quan + upsert/tạo lại (§8.2), audit + `ai_quota.updated` + `ai_quota.sync_requested` cùng transaction (topic/hằng audit đã ở `AIP-10`; **thẻ này** thêm `ai.quota.saved`/`ai.quota.cleared` vào `auditActions()` kèm hai closure `cases` chạy lệnh thật, §6.2); route SDI/SDO; hai case `pathParamSDI` mới `orgID,workspaceID` và `orgID,userID` (§9); **cùng thẻ** sửa `isoRoutes` + thân cho route mới và nối Hub giả vào `newIsolationServer` — ngay khi route đăng ký `TestIsolationMatrix` đòi những thứ này (gieo dữ liệu và `isoUnseeded` đã ở `AIP-02`) | `server/internal/service/ai_quota_policy.go`, `handler/ai_quota.go`, `handler/dto/{sdi,sdo}/`, `handler/router/ai_quota.go`, `router/openapi.go`, `handler/isolation_*_test.go` | M | AIP-02, 10 | — |
| **AIP-06** | `HubPolicySyncConsumer` (LaneSlow): PUT, ghi có điều kiện `revision = sent`, 409 theo §6.3 (đọc lại `FOR UPDATE`), phân loại 401/403/429 (429 theo backoff sẵn có của outbox, không `Retry-After`, §6.3), dead-letter, metric; action `ai.quota.sync_overrode_hub` vào `auditActions()` + `actionsWithoutCommands` ("covered by ai_hub_sync_test.go") | `server/internal/service/ai_hub_sync.go`, `server/cmd/server/main.go` | M | AIP-01, 05 | C3, C4 |
| **AIP-07** | API đọc: tóm tắt Gói AI (ví + kỳ + bảng), usage ws/user/cá nhân (bỏ `cost_micro`), `capabilities.plan`, danh mục model; hiện thực `HubCatalog`/`PolicyInspector` (§5.1); cache RAM `singleflight` khóa `(org, workspace, user, feature)` + **consumer outbox trong tiến trình** làm mất hiệu lực ở **node đã nhận sự kiện** (các node khác chờ TTL 60 giây, §5.5, khuôn `featureflags.Invalidator`); `plan.available` trong `capabilities` và `GET /orgs/{orgID}/ai/plan` (§10); isolation: `isoRoutes` + thân cho route đọc mới | `server/internal/service/ai_plan_read.go`, `handler/ai_plan.go`, router, `server/cmd/server/main.go`, `handler/isolation_*_test.go` | M | AIP-01, 05 | C2, C4, C5, C6 |
| **AIP-08** | Bộ nhận webhook: HMAC, `X-Hub-Delivery == payload.id`, chống phát lại, dedup, policy lạ không emit, **phân loại event từ thân đã ký (hình thân loại trừ nhau, `balance_micro + credit_limit_micro`); từ chối header sai nhãn khi số chưa cạn, nhưng khi số đã cạn nhận cả hai header credit (delivery `credit.low` thật của lượt cắt hai ngưỡng nhận `200`, ghi biên nhận, không emit lần hai)** (§7; test `TestAIHubWebhookClassifiesCreditFromSignedBalances`, `…RejectsAmbiguousBodyShape`, ca đổi header, **`TestAIHubWebhookAcceptsGenuineDualCrossing`**), giới hạn tốc độ riêng + `ExceptPaths`, audit, emit (topic/hằng audit đã ở `AIP-10`; **thẻ này** thêm ba action webhook vào `auditActions()` + `actionsWithoutCommands` "covered by ai_hub_webhook_test.go", §6.2); quy tắc thông báo (đọc `threshold` từ `ai_hub_webhook_events`) + kind + tiêu đề + ma trận (công tắc Email chỉ cho owner/admin tổ chức; thành viên/admin workspace chỉ Hộp việc, FE-38) + **truy vấn Hộp việc lấy cả dòng `workspace_id IS NULL` cấp tổ chức của đúng người nhận** (FE-36, §6.4) **và cùng quy tắc đó cho số chưa đọc theo workspace, "đánh dấu đã đọc hết" và cập nhật cache client; tổng tài khoản đếm mỗi dòng một lần; test có dòng NULL của tổ chức khác không bị đổi** (BE-25, §6.4: `notifications.sql`, `notification/service.go`, `core/notifications/hooks.ts`); **loại ba kind AI khỏi digest ngày, đổi nghĩa `Prefs.Email` của hai kind có thư thành "nhận `ai_quota_alert`", bulk Email của ma trận chỉ dùng kind đủ điều kiện** (BE-26, §6.4: `notification/{prefs,digest}.go`, `notifications-matrix.tsx`); thư `ai_quota_alert`; `isoRoutes` cho route webhook (`isoPublic`) | `server/internal/handler/ai_hub_webhook.go`, `router/ai_hub_webhook.go`, `server/internal/notification/{kinds,rules,titles,prefs,digest,service}.go`, `server/pkg/db/queries/notifications.sql`, `packages/core/notifications/hooks.ts`, `packages/views/settings/components/notifications-matrix.tsx`, `server/internal/mail/**`, `handler/isolation_routes_test.go` | L | AIP-02, 03, 10 | C8 (đăng ký bởi vận hành) |
| **AIP-09** | Cờ `ai_hub_routing`, `ai_plan_ui` (+ `ReviewAt`; `ai_plan_ui` không public), **phép tính `available = ai_hub_routing && ai_plan_ui` theo tổ chức (không `UserID`) dùng chung với §5.9** để API có phạm vi trả (§10, BE-20), env + `.env.example`, metric Prometheus, runbook + cảnh báo (mỗi cảnh báo một runbook 4 mục: `scripts/alerts-runbooks.test.mjs`) | `featureflags/keys.go`, `.env.example`, `deploy/alerts.yml`, `docs/runbooks/` | S | AIP-00 | — |
| **AIP-10** | **Sự kiện + audit (đi trước mọi thẻ phát chúng)**: bốn topic có khán giả vào đủ ba nơi catalogue, `ai_quota.sync_requested` (phạm vi `-`) chỉ vào `CATALOGUE.md` + `catalogue.go` (§6.1), hằng `audit/actions.go` (**chỉ hằng**: không đụng `auditActions()`, không closure — phần phủ `audit_coverage_test.go` nằm ở thẻ sở hữu lệnh `AIP-03`/`05`/`06`/`08`, §6.2, BE-18); `TestIsolationRealtime` cho bốn topic. Đứng trước `AIP-03`, `05`, `08` để các thẻ ấy không làm `events-catalogue.test.mjs` đỏ | `docs/events/CATALOGUE.md`, `outbox/catalogue.go`, `packages/core/types/events.ts`, `audit/actions.go`, `service/audit_coverage_test.go`, `realtime/` | S | AIP-00 | — |
| **AIP-11** | `packages/core`: endpoints + schema khoan dung + ca malformed, khóa truy vấn `aiPlanKeys` (có `wsId`), hook (gồm `useAiPlanAvailable(orgId)` đọc `available` từ API có phạm vi, không dùng `usePublicConfig` toàn cục cho cờ này, §10), làm mới realtime, quy tắc quyền §2, `paths` | `packages/core/api/endpoints/ai-plan.ts(+test)`, `core/ai/`, `core/permissions/`, `core/realtime/use-realtime-sync.ts` | M | AIP-05, 07 | — |
| **AIP-12** | Màn hình tổ chức/workspace: tab **Gói AI** (a), ngăn sửa hạn mức `ai-quota-sheet.tsx` (b) gồm hộp thoại so sánh 409, hạn mức workspace (c); nút "Gỡ hạn mức" + xác nhận b1c; bộ chọn model chỉ hiện model được phép — hàng "ngoài gói" mờ **chờ H-7** (§13.2); i18n vi/en; test view. **Cũng sửa `docs/conventions.md`**: › Icons thêm hàng `Ban` (chặn do hạn mức), `Gauge` (gói/hạn mức), `KeyRound` (khóa riêng) (FE-14); §2 glossary thêm `credit`, `hạn mức`, `gói AI`, `hạn mức cá nhân` (FE-17) | `packages/views/settings/components/ai-plan-*.tsx`, `ai-quota-sheet.tsx`, `ai-tab.tsx`, `settings-page.tsx`, `docs/conventions.md` | **L** | AIP-11; board a,b,c | H-7 (chỉ cho hàng mờ; có phương án dự phòng) |
| **AIP-13** | Người dùng cuối: `ai-limit-notice` (d), Ask UNI/catch-up map mã mới, giải thích BYOK (f), thông báo/mẫu (e) | `packages/views/ai/**`, `packages/views/chat/use-chat-catch-up-ui.ts`, `notifications*`, `locales/*.json` | M | AIP-11; board d,e,f | — |
| **AIP-14** | E2E Playwright + Hub giả: admin đặt hạn mức → người dùng bị chặn với đúng chủ thể; cảnh báo 80% tới đúng người; hai admin xung đột; Hub sập | `e2e/ai-plan.spec.ts` | M | AIP-12, 13 | v0.2.0 thật ở bước R2 |
| **AIP-15** | Hoàn tất cutover: ẩn hàng `ai.tokens` ở Billing cho tổ chức đã bật; `usage_reconcile.go` chỉ còn phục vụ tổ chức chưa bật; chốt đường cũ. **Không** đụng `service/ai_quota.go` và ghi `cost_micros` (của `AIP-04`) | `ai/usage_reconcile.go`, `packages/views/settings/components/{billing-tab,quota-meter}.tsx` | M | AIP-04 | — |
| **AIP-F** | (ngoài worktree) map mã lỗi mới trong frame genoffice | repo office | S | AIP-04 | — |
| **AIP-BILL-00** | ADR "Thanh toán AI: đơn thanh toán là nguồn duy nhất của credit; grant khóa theo id đơn; hoàn tiền → thu hồi phần chưa tiêu; Hub không thu tiền" (quy tắc mới phải có ADR trước, `docs/adr/README.md`, `scripts/governance.test.mjs`); chốt §16.1 | `docs/adr/0036-*.md` | S | AIP-00; Q-AIP-11, 13, 14, 15, 17, 18 | — |
| **AIP-BILL-01** | Mở rộng client Hub `server/internal/aihub`: `Grant` (idempotent theo khóa), `ListGrants`, `Revoke`, `PutAccountPlan`; kiểu lỗi `ErrConflict` **một loại** (Hub trả `409` `code:"conflict"` cho cả khóa-khác-thân lẫn revoke-quá-số, nên client phân loại theo ngữ cảnh, §16.8 bước 6, không đọc `message`; H-11); `ListGrants` gửi `limit=200` tường minh (mặc định của Hub là 50, H-10); **Hub giả có sổ grant** (khóa lặp → `200` cùng id; khác thân → `409`; `remaining_micro`; revoke ≤ chưa tiêu; plan append-only; hết hạn); mở rộng `TestAIHubClientAlwaysScopesToLinkedAccount` cho `Grant/Revoke/PutAccountPlan` (§16.10) | `server/internal/aihub/**`, `server/internal/arch_test.go` | M | AIP-01 | C9: grants, revoke, plan (§16.3) |
| **AIP-BILL-02** | **Dữ liệu + từ vựng (đi trước mọi thẻ dùng chúng)**: migration `ai_credit_orders`, `ai_credit_reversals`, `ai_credit_packs`, cột mới của `billing_payment_intents`/`invoices`/`ai_hub_accounts`, feature `ai.credit_micro` (§16.5); sqlc + `-- tenant:`; cờ `ai_billing_sync` (+ `ReviewAt`); bảy topic ở §16.9 vào catalogue (hai topic có khán giả vào đủ ba nơi, năm topic hạ tầng chỉ hai nơi, như §6.1); hằng audit; `tenantExemptTables` thêm `ai_credit_packs`; `tenantExportExcluded` + `tenantDeleteRetain` thêm `ai_credit_orders`, `ai_credit_reversals` (§16.5, BE-B7); **cùng thẻ** gieo dòng của tổ chức A cho hai bảng tenant mới trong `isolation_world_test.go` (như BE-19) | `server/migrations/999*_ai_credit_*`, `server/pkg/db/queries/ai_credit.sql`, `featureflags/keys.go`, `docs/events/CATALOGUE.md`, `outbox/catalogue.go`, `packages/core/types/events.ts`, `audit/actions.go`, `migrations/lint_test.go`, `handler/isolation_world_test.go`, `service/tenant_export_tables.go`, `service/tenant_delete_tables.go`, `.env.example` | M | AIP-02, 09, 10; BILL-00 | — |
| **AIP-BILL-03** | **Đơn credit từ thanh toán gói**: `billing_provider_event.go` tính `amount_micro`/`expires_at`/`source_ref` (quy tắc §16.6.1 bước 2: dòng `after`, `Limit` không nil và `> 0`, không bao giờ làm hỏng thanh toán) rồi gọi `AICreditService.createOrderTx(ctx, q, in)` **trong cùng transaction** (`billing_provider_event.go:205-238`) khi `ai_hub_routing && ai_billing_sync`; `ai_credit.go` chỉ gọi query `AiCredit*` (BE-B8); đơn chụp các số vào (không tính lại khi thử lại); audit `ai.credit.ordered` + outbox `ai_credit.sync_requested` cùng tx; ràng buộc duy nhất `payment_intent_id` và `(subscription_id, period_start)`, đơn IPN **luôn** mang cả `subscription_id` và `period_start` (BE-B5); test `audit_coverage` chạy `ApplyProviderEvent` thật; test ca biên (§15.2 1b, 1c) | `server/internal/service/ai_credit.go`, `billing_provider_event.go`, `audit_coverage_test.go` | L | BILL-02 | — |
| **AIP-BILL-04** | **Đẩy grant sang Hub + đối soát**: `AICreditSyncConsumer` (LaneSlow, khuôn `HubPolicySyncConsumer`); trạng thái đơn `pending → granted \| failed`; thử lại không bao giờ trùng (khóa `uw-ord-<order_id>`, thân bất biến, claim có lease; claim chỉ chọn `pending` hoặc `failed/config`, `conflict`/`expired` không claim, consumer trả `nil` sau khi ghi `next_attempt_at`: BE-B6); `ProcessAICreditReconcile` gắn vào `BillingService.RunWorkers` (khuôn `ProcessStalePaymentIntentReconcile`, `billing_intent_reconcile.go:17-52`), dùng **cùng predicate** với claim và là bộ thử lại duy nhất (BE-B6); `ai.credit.granted`/`ai.credit.grant_failed` + `ai_credit.granted`; metric, cảnh báo `AICreditOrderStuck`, runbook 4 mục; xóa cache ví của tổ chức (§5.5) | `server/internal/service/ai_credit_sync.go`, `ai_credit_reconcile.go`, `server/cmd/server/main.go`, `deploy/alerts.yml`, `docs/runbooks/` | L | BILL-01, 03; AIP-03 | grants (C9) |
| **AIP-BILL-05** | **Grant theo kỳ cho gói miễn phí/thủ công/bù** (`EnsurePeriodGrants`, §16.6.3) và **đặt plan Hub ngay khi liên kết** (mở rộng `EnsureAccount` của `AIP-03`, §16.4; **chỉ khi `ai_hub_routing && ai_billing_sync`**, BE-B12): bảo đảm mỗi tổ chức đi Hub có đúng một đơn `plan_period` cho mỗi `(subscription, kỳ)`; kỳ gói trả phí hết thì không cấp thêm; sweep kỳ đã trả gắn `payment_intent_id`/`invoice_id` của hóa đơn kỳ đó (BE-B11) | `server/internal/service/billing_ai_credit_period.go` (gọi query plan/subscription/hóa đơn nên nằm dưới tiền tố `billing_` của allowlist `arch_test.go:211-232`, BE-B8), `ai_hub_account.go` | M | BILL-04 | PUT plan, grants |
| **AIP-BILL-06** | **Bán gói nạp (top-up)**: `POST /orgs/{orgID}/billing/ai-credit/checkout` (SDI/SDO, `decode()`), intent loại `ai_credit_pack` dùng lại hạ tầng VNPay; `ExpirePendingBillingPaymentIntents` chỉ hết hạn cùng loại; chỉ bán khi gói hiện tại trả phí và `active` (Q-AIP-19; mã `ai_credit_pack_requires_paid_plan`); nhánh gói nạp trong `applyProviderEvent` (hóa đơn `kind='ai_credit_pack'`, đơn `topup` hết hạn sau 12 tháng theo Q-AIP-17; **đơn `topup` được tạo bất kể cờ** và reconcile bù intent `completed` thiếu đơn, `billing_ai_credit_pack.go`: BE-B3); **chặn** `revertSubscriptionAfterFullInvoiceRefund` cho hóa đơn không phải đăng ký (`billing_subscription_refund.go:17`); `isoRoutes` + thân; test IPN lặp không tạo hai đơn, IPN gói nạp khi cờ tắt vẫn đúng một đơn | `service/billing_checkout.go`, `billing_provider_event.go`, `billing_ai_credit_pack.go`, `billing_subscription_refund.go`, `handler/billing_ai_credit.go`, `router/billing.go`, `dto/{sdi,sdo}/billing.go`, `pkg/db/queries/billing.sql`, `arch_test.go` (regex query billing, `:212`; §16.10), `handler/isolation_routes_test.go` | M | BILL-03 | — |
| **AIP-BILL-07** | **Hoàn tiền → thu hồi credit**: tạo `ai_credit_reversals` **trong cùng tx** với ba chỗ hoàn tiền thành công (`admin_billing_refund.go:104`, `:163`, `billing_refund_reconcile.go:96`); consumer thu hồi theo §16.8 (**phát lại đúng khóa/số/lý do đã ghi, bỏ qua đọc/tính lại** — BE-B1; đọc `remaining_micro` qua `GET grants?account=<id>&limit=200`; `409` chỉ phân loại theo `remaining_micro` vì Hub dùng một mã `conflict`, BE-B2; chạy đua → khóa mới); trạng thái `needs_support`; số liệu "đã cấp/còn/đã dùng" cho hộp thoại hoàn tiền | `service/admin_billing_refund*.go`, `billing_refund_reconcile.go`, `ai_credit_reversal.go`, `ai_credit_sync.go` | L | BILL-04, 06 | revoke, list grants (H-10) |
| **AIP-BILL-08** | **Console `/admin`**: `GET`/`POST /admin/organizations/{orgID}/ai-credit` (đọc: `support`; ghi: `admin`, `reason ≥ 10`, `admin_actions` + `audit_events` cùng tx, khóa `client_ref` chống bấm đúp: cùng `client_ref` khác thân → `409`; `AI_CREDIT_ADMIN_GRANT_MAX_MICRO` chưa đặt = từ chối mọi ghi, BE-B15); thêm tệp vào danh sách cho phép của `TestAdminQueriesStayInAdminService` (`arch_test.go:325`); `isoRoutes` `isoPlatform` | `service/admin_ai_credit.go`, `handler/admin_ai_credit.go`, `router/admin.go`, `arch_test.go`, `handler/isolation_routes_test.go` | M | BILL-03 | — |
| **AIP-BILL-09** | **API đọc billing credit + core**: `GET /orgs/{orgID}/billing/ai-credit` (`available`, ví C2 cache 30 giây, gói nạp, đơn gần đây, giao dịch nạp đang chờ); `packages/core` endpoint + schema khoan dung + ca malformed (`billing.test.ts`), khóa truy vấn, hook `useAiCredit(orgId)`, `useAiCreditReturn`, làm mới realtime cho `ai_credit.granted/reversed`, quy tắc quyền | `service/ai_credit_read.go`, `handler/billing_ai_credit.go`, `packages/core/api/endpoints/billing.ts(+test)`, `packages/core/billing/`, `core/realtime/use-realtime-sync.ts` | M | BILL-02; AIP-07, 11 | C2 |
| **AIP-BILL-10** | **Thông báo + thư billing** (§16.9): kind `billing_credit_added`, `billing_renewed`, `billing_payment_failed`, `billing_refunded` (chỉ owner tổ chức, cấp tổ chức `workspace_id` NULL, Hộp việc + thư giao dịch, loại khỏi digest); **phát** ba topic `invoice.paid`, `payment_intent.failed`, `invoice.refunded` (catalogue đã ở BILL-02) tại `applyProviderEvent` và ba chỗ hoàn tiền, cùng tx; riêng `payment_intent.failed` đi qua `Recorder.Record` với action `billing.payment_intent_failed` (không `Emit`, BE-B9), chỉ khi UPDATE đổi một dòng, ở IPN thất bại và `reconcileOneStalePaymentIntent`, không ở lỗi tạo phiên của `Checkout`; quy tắc + tiêu đề; 4 mẫu thư × vi/en × html/txt; nhóm "Thanh toán" của ma trận (board j, khung j2) | `server/internal/notification/{kinds,rules,titles,prefs,digest,service}.go`, `server/internal/mail/templates/billing_*`, `service/billing_provider_event.go`, `service/admin_billing_refund.go`, `service/billing_refund_reconcile.go`, `packages/views/settings/components/notifications-matrix.tsx` | M | BILL-04, 07; AIP-08 | — |
| **AIP-BILL-11** | **Màn hình owner**: tab Billing có credit (g1–g12, g4b, g10b), chọn gói nạp + trở về VNPay (h1–h11, h2b, h3b, h8b), hóa đơn: hoàn tiền/thu hồi (i1–i6); i18n vi/en; test view; **`docs/conventions.md`** › glossary thêm `gói nạp`, `credit AI`, `thu hồi credit` | `packages/views/settings/components/{billing-tab,plan-cards,billing-ai-credit,ai-credit-pack-sheet,invoices-panel}.tsx` (ngăn chi tiết hóa đơn nằm trong `invoices-panel`), `packages/core/i18n/locales/*.json`, `docs/conventions.md` | L | BILL-06, 09; board g, h, i | — |
| **AIP-BILL-12** | **Màn hình phụ**: hộp thoại cộng credit tay + khối "Credit AI" ở `/admin` (j10–j14), dòng credit trong hộp thoại hoàn tiền (j15), thông báo và thư (j1–j6, j7–j9) | `packages/views/admin/admin-ai-credit-*.tsx`, `invoice-refund-dialogs.tsx`, `packages/core/api/endpoints/admin.ts(+test)`, `packages/views/notifications*` | M | BILL-08, 10; board j | — |
| **AIP-BILL-13** | **E2E + Hub giả**: mua gói VNPay giả → đúng một grant; gửi IPN hai lần → một grant; Hub sập lúc IPN → đơn `pending` rồi `granted` sau khi Hub lên; hoàn tiền một phần → thu hồi phần chưa dùng; hoàn tiền khi đã tiêu hết → không gọi Hub, đơn thu hồi `nothing_to_reverse` | `e2e/ai-credit.spec.ts` | M | BILL-11, 12 | Hub thật ở R2b |
| **AIP-BILL-14** | *(sau, chỉ khi chủ sản phẩm yêu cầu khác biệt model/đồng thời theo hạng)* **Hub plan riêng theo gói UniWork**: bảng ánh xạ, consumer `ai_plan.sync_requested`, đồng bộ theo trạng thái mong muốn (H-9), kiểm theo thời gian khi hết ân hạn `past_due` | `server/internal/service/ai_plan_sync.go`, `billing.go` (`recordChange`) | M | BILL-05 | PUT plan, H-9 |
| **AIP-BILL-15** | *(sau, chỉ khi Q-AIP-20 = (a))* **Hạ gói lên lịch từ kỳ sau**: migration `subscriptions.scheduled_plan_id` (cột có mặc định, không khóa bảng dài), `changePlan` ghi lịch thay vì `downgrade_not_allowed` cho gói trả phí rẻ hơn, `Checkout` chỉ cho gói đã lên lịch và chỉ khi kỳ đã hết, hủy lịch, lapse đọc lịch; board g (g4, g5) vẽ "Hạ xuống X từ dd/mm"; audit + `subscription.changed` cùng tx; test hạ → trả sau hết kỳ → credit của gói thấp hơn | `server/migrations/999*_subscription_scheduled_plan.*`, `service/billing.go`, `service/billing_checkout.go`, `service/billing_lapse.go`, `pkg/db/queries/billing.sql`, `packages/views/settings/components/{billing-tab,plan-cards}.tsx` | M | BILL-03, 11; Q-AIP-20 | — |

**Thứ tự:** `AIP-00` → (`AIP-01` ∥ `AIP-02` ∥ `AIP-09` ∥ `AIP-10`) → `AIP-03` → (`AIP-05` ∥ `AIP-04`) → (`AIP-06` ∥ `AIP-07` ∥ `AIP-08`) → `AIP-11` → (`AIP-12` ∥ `AIP-13`) → `AIP-14` → `AIP-15`. **Billing** (`AIP-BILL-*`, Q-AIP-1 = (c)) đi song song sau nền: `AIP-BILL-00` → (`AIP-BILL-01` ∥ `AIP-BILL-02`) → `AIP-BILL-03` → (`AIP-BILL-04` ∥ `AIP-BILL-06`) → (`AIP-BILL-05` ∥ `AIP-BILL-07` ∥ `AIP-BILL-08` ∥ `AIP-BILL-09`) → `AIP-BILL-10` → (`AIP-BILL-11` ∥ `AIP-BILL-12`) → `AIP-BILL-13`; điểm vào: `AIP-BILL-01` cần `AIP-01`, `AIP-BILL-02` cần `AIP-02/09/10`, `AIP-BILL-04` cần `AIP-03`, `AIP-BILL-09` cần `AIP-07/11`, `AIP-BILL-10` cần `AIP-08` và `AIP-BILL-07` (phát `invoice.refunded` ở ba chỗ hoàn tiền). Cả chuỗi `00…13` phải xong trước **R2b/R4** (§10); `AIP-BILL-14` (Hub plan theo gói) và `AIP-BILL-15` (hạ gói lên lịch, Q-AIP-20) là **sau** và không chặn R4.

**Rủi ro chính:** (1) `AIP-04` chạm lõi Gateway và mọi capability — chia nhỏ theo capability, giữ đường cũ bằng cờ tổ chức; (2) frame genoffice ở fork hiển thị lỗi theo `code`, không sửa được từ worktree này (`AIP-F`); (3) id yêu cầu thử lại — kiểm giả định (2) (429 của Hub được thử lại theo backoff outbox, không theo `Retry-After`); (3b) H-7 chưa có thì D-4 "hiện mờ" chưa làm được, dùng phương án dự phòng chỉ-model-được-phép; (4) lệch múi giờ giữa nhóm `day` của usage (UTC) và kỳ policy (UTC+7) — chỉ dùng `spent_micro` cho thước hạn mức (C5); (5) Hub chưa tag v0.2.0 — mọi thẻ code kiểm lại hợp đồng ở §4 và §16.3 khi có tag; (6) **billing là đường tiền thật**: lỗi trùng grant là mất tiền, lỗi thiếu grant là khách trả mà không có credit — `AIP-BILL-03/04` có test chạy lại/đua cho mọi đường (§16.7) và R2b chỉ qua khi không đơn kẹt; (7) `AIP-BILL-06` đổi `billing_payment_intents.plan_id` thành nullable và thêm `invoices.kind` trên bảng đang chạy thanh toán thật — migration thêm cột có mặc định, không khóa bảng dài, và mọi đường đọc `invoices` hiện có (`billing_subscription_refund.go:17`) phải xử lý loại mới trước khi bán gói nạp (§16.5); (8) H-9/H-10 chưa có ở Hub: cách làm vòng ở §13.2 đủ cho v1 nhưng thu hồi grant ngoài 200 grant mới nhất phải qua hỗ trợ. (9) baseline của lead kéo billing nói chung vào epic: ba topic `invoice.paid`/`payment_intent.failed`/`invoice.refunded`, bốn mẫu thư billing (hôm nay chưa có) ở `AIP-BILL-10`, và hạ gói lên lịch (Q-AIP-20) sửa luật `changePlan`/`Checkout` đang chạy tiền thật nên tách `AIP-BILL-15`, không chặn R4; nếu người dùng chọn (b) ở Q-AIP-20, board g (g4, g4b, g5) đổi theo luật hôm nay.

---

## 15. Bảng truy vết AC-1

### 15.1 Quản lý hạn mức (vòng 1)

Mỗi mục "Phía UniWork" 1–7 của `hub:docs/plans/2026-10-17-p2-plan.md:198-211` → mục của spec → thẻ.

| # | Mục Hub | Mục spec | Thẻ |
|---|---|---|---|
| 1 | Màn cấu hình hạn mức ws/user cho org admin → audit + outbox cùng transaction → `PUT /admin/v1/policies` có `version` (§18); xử lý 409 theo S2 | §2 (quyền), §3 (`ai_quota_policies`, `revision`), §4 C3, §6.1–6.3 (audit, topic, consumer, 409), §9, §11 (a, b) | AIP-02, 05, 06, 10, 12 |
| 2 | Hiển thị "đã dùng / hạn mức" từ `spent_micro` hoặc Usage summary | §4 C4 (spent_micro), C5 (summary; vì sao không cộng summary), C2 (ví), §8.4 (cache), §11 (a, c) | AIP-07, 11, 12 |
| 3 | Gọi `/v1/models` kèm nhãn `user`/`workspace` để chỉ hiện model được phép | §4 C6, §5.2 (chọn model), §5.3 (nhãn), §5.5, §11 (b, d) | AIP-04, 07, 13 |
| 4 | Endpoint nhận webhook: xác minh HMAC, chống trùng theo id event, gửi thông báo/email (§5); đăng ký endpoint qua Admin API | §4 C8 (đăng ký), §7 (nhận), §6.1 + §6.4 (topic, thông báo, email), §3 (`ai_hub_webhook_events`), §11 (e) | AIP-08, 09, 10, 13 |
| 5 | Xử lý 429 `policy_exceeded` ("hết hạn mức của workspace/user", không thử lại) khác `concurrency_limit` | §8.1 (bảng lỗi, suy ra chủ thể, thử lại có giới hạn), §5.4 (id), §8.3 (client), §11 (d) | AIP-04, 13 |
| 6 | Dùng rerank/image edits nếu UniWork cần (chưa có yêu cầu) | §12 (ngoài phạm vi, không có yêu cầu) | — (không thẻ; Hub item 6 ghi "chưa có yêu cầu") |
| 7 | Kiểm tiêu chí UniWork của §22 P2: org admin chia hạn mức trên UniWork, bị chặn đúng | §10 (R2), §14 `AIP-14` | AIP-14 (e2e + Hub thật ở R2) |


### 15.2 Thanh toán AI (vòng 2, billing)

Mỗi luồng billing → mục của spec → thẻ → ý tưởng test (test viết trước khi code, chạy hẹp khi làm, cả bộ ở MR; Hub giả là `aihub` có sổ grant ở `AIP-BILL-01`).

| # | Luồng | Mục spec | Thẻ | Ý tưởng test |
|---|---|---|---|---|
| 1 | Mua gói trả phí qua VNPay (IPN thành công) | §16.6.1, §16.5, §16.7 | AIP-BILL-03, 04 | chạy `ApplyProviderEvent` thật: đúng một `ai_credit_orders` (`plan_period`), consumer gọi Hub giả đúng một lần, ví tăng đúng `ai.credit_micro` |
| 1b | IPN rồi sweep cùng kỳ (BE-B5) | §16.6.1, §16.6.3 | AIP-BILL-03, 05 | IPN (cờ bật) rồi một lượt `EnsurePeriodGrants`: đúng một `ai_credit_orders` và một grant Hub cho kỳ; đơn IPN có `subscription_id` và `period_start` = `current_period_start` vừa ghi |
| 1c | `ai.credit_micro` ca biên (BE-B4) | §16.6.1 | AIP-BILL-03 | tổ chức `past_due` quá ân hạn trả trễ → đơn theo dòng `after` (không 0); feature NULL / tắt / `<= 0` / chưa khai báo → không đơn, IPN vẫn thành công; lỗi đọc feature hoặc đánh giá cờ không rollback thanh toán |
| 2 | Mua gói nạp (top-up) | §16.6.2, §16.5, §16.10 | AIP-BILL-06, 04 | checkout loại `ai_credit_pack` → IPN → hóa đơn `kind='ai_credit_pack'` + đơn `topup` + grant hết hạn sau 12 tháng (Q-AIP-17); gói Starter bị từ chối `ai_credit_pack_requires_paid_plan` (Q-AIP-19); gói đăng ký của tổ chức không đổi |
| 2b | Gói nạp khi cờ tắt giữa chừng (BE-B3) | §16.6.2, §16.7, §16.12 | AIP-BILL-06, 04 | mở checkout nạp, tắt `ai_billing_sync` hoặc `ai_hub_routing`, IPN tới → vẫn đúng một đơn `topup`; intent `completed` không có đơn (dựng tay) → reconcile bù đúng một đơn, chạy hai lần không thêm |
| 3 | Gia hạn kỳ (owner trả lại, không có tự gia hạn) | §16.6.1, §16.6.5 | AIP-BILL-03 | hai thanh toán hai kỳ → hai đơn, hai grant khác khóa; **IPN lặp** → không thêm đơn (`errIntentAlreadyCompleted`, `billing_provider_event.go:156-161`) |
| 3b | Gói miễn phí/thủ công hàng tháng, kỳ trả phí chưa có đơn (cờ bật muộn) | §16.6.3 | AIP-BILL-05 | `EnsurePeriodGrants` chạy hai lần cùng kỳ → một đơn (`ON CONFLICT DO NOTHING` trên `(subscription_id, period_start)`); đổi tháng → đơn mới |
| 3c | Sweep kỳ đã trả có hóa đơn (BE-B11) | §16.6.3, §16.8 | AIP-BILL-05, 07 | đơn do sweep cho kỳ đã trả mang `payment_intent_id`/`invoice_id`; hoàn hóa đơn đó → có `ai_credit_reversals` |
| 4 | Nâng gói giữa kỳ | §16.6.4 | AIP-BILL-03, 13 | Team → Business: kỳ mới + đơn mới đầy đủ; grant kỳ cũ còn dùng được tới hạn của nó (Hub giả trừ hết hạn sớm nhất trước) |
| 5 | Hạ gói / hủy cuối kỳ | §16.6.4, §16.6.5, Q-AIP-20 | AIP-BILL-05; AIP-BILL-15 nếu Q-AIP-20 (a) | hạ gói giữa kỳ không tạo đơn (hôm nay bị từ chối: `billing.go:203-207`; theo Q-AIP-20 (a): lịch được ghi, entitlement và credit không đổi, kỳ mới sau khi trả cấp credit của gói thấp hơn); `cancel_at` → lapse → gói mặc định → đơn tháng miễn phí; credit trả phí hết hạn đúng `expires_at` |
| 6 | Reset kỳ, không rollover | §16.6.5 | AIP-BILL-05; kiểm giả định (8) ở R2b | Hub giả hết hạn grant → ví giảm; credit nạp giữ tới hạn 12 tháng và được tiêu **sau** credit kỳ (Q-AIP-18); Hub thật ở R2b |
| 7 | Thanh toán OK nhưng Hub sập / grant lỗi | §16.7 | AIP-BILL-04, 13 | Hub giả trả 5xx/timeout → đơn `pending`, IPN vẫn thành công; Hub lên → reconcile → `granted`, một grant; test nhìn số đơn kẹt > 15 phút kích `AICreditOrderStuck` |
| 7b | Đơn không claim được; Hub sập dài hơn ngân sách outbox (BE-B6) | §16.7 | AIP-BILL-04 | `failed_kind='expired'` không gọi Hub và không claim lại (người xử lý cộng tay); claim không bao giờ chọn `conflict`/`expired`; 5xx dài hơn ngân sách thử lại của outbox (consumer bị dead-letter) → reconcile vẫn đẩy được, không đơn nào kẹt |
| 8 | Hub trả 409 / 403 / 400 / 404 | §16.7, §13.2 H-9…H-11 | AIP-BILL-01, 04 | `POST grants` trả 409 (`conflict`, nghĩa duy nhất: khóa khác thân) → `failed` loại `conflict`, không thử lại; 403/400 → `failed` loại `config`, thử lại chậm; 404 → `EnsureAccount` rồi thử lại |
| 9 | Hai worker / hai node đua một đơn; mất response sau khi Hub đã tạo | §16.7 | AIP-BILL-04 | hai consumer song song → claim lease chỉ cho một; response bị rớt → lần sau cùng khóa trả `200` cùng `id` (giả định (5), (6)) |
| 10 | Hoàn toàn bộ hóa đơn gói / gói nạp, credit chưa dùng | §16.8 | AIP-BILL-07 | cả ba chỗ hoàn thành công (`admin_billing_refund.go:104`, `:163`, `billing_refund_reconcile.go:96`) tạo đúng một `ai_credit_reversals`; Hub giả bị `revoke` đúng phần chưa tiêu |
| 10b | Hoàn chưa xác nhận hoặc bị từ chối (BE-B14) | §16.8 | AIP-BILL-07 | `refund_pending`, `partial_refund_pending` và `revertRejectedInvoiceRefund` không tạo `ai_credit_reversals` |
| 11 | Hoàn một phần | §16.8 | AIP-BILL-07 | hoàn 30% → mục tiêu = 30% credit đơn, `min(mục tiêu, còn lại)`; **phòng thủ** (API hôm nay chỉ cho một lần hoàn mỗi hóa đơn, BE-B13): gọi `requestReversalTx` với `refunded_minor` tăng → chỉ phần chênh; cùng một lần hoàn được `ConfirmInvoiceRefund` và đối soát xác nhận hai lần → một dòng thu hồi; không tràn `int64` với đơn rất lớn |
| 12 | Hoàn khi credit đã tiêu hết | §16.8 | AIP-BILL-07, 13 | `remaining = 0` → trạng thái `nothing_to_reverse`, **không gọi Hub**; không bao giờ ví âm |
| 13 | Hoàn khi grant chưa tạo xong / Hub sập / grant ngoài 200 mới nhất | §16.8, H-10 | AIP-BILL-07 | đơn `pending` → thu hồi chờ (`waiting_grant`); grant không có trong 200 mới nhất → `needs_support`; revoke `409` do đua (`remaining < revoke_micro`) → khóa mới, số mới; **Hub áp K1, response bị rớt, lần sau phát lại K1 và Hub giả chỉ ghi đúng một revocation** (BE-B1); phát lại K1 nhận `409` mà `remaining ≥ revoke_micro` → `needs_support` |
| 14 | Hoàn hóa đơn **gói nạp** không đưa tổ chức về Starter | §16.5, §16.8 | AIP-BILL-06 | `revertSubscriptionAfterFullInvoiceRefund` thoát sớm với hóa đơn không phải đăng ký (`billing_subscription_refund.go:17`) |
| 15 | Cộng credit tay (hỗ trợ) | §16.11 | AIP-BILL-08, 12 | `support` bị 403 ghi, `admin` cần `reason ≥ 10`; bấm đúp cùng `client_ref` → một đơn; cùng `client_ref` khác thân → `409`, đơn cũ không đổi; `AI_CREDIT_ADMIN_GRANT_MAX_MICRO` chưa đặt → mọi ghi bị từ chối (BE-B15); `admin_actions` + `audit_events` cùng tx |
| 16 | Cờ tắt giữa chừng / chưa bật | §16.12, §10 | AIP-BILL-02, 04, 09 | `ai_billing_sync` tắt: không đơn mới, đơn đã có vẫn được đẩy; `available=false` ở API đọc; tab Billing như hôm nay (g9) |
| 16b | `PUT plan` chỉ khi cờ billing bật (BE-B12) | §16.4, §16.12 | AIP-BILL-05 | tổ chức `ai_hub_routing` bật, `ai_billing_sync` tắt → `EnsureAccount` không PUT, plan của hub_admin giữ nguyên; cả hai bật → đúng một PUT khi `hub_plan_id_synced` khác mong muốn |
| 17 | Cô lập tenant | §16.10 | AIP-BILL-06, 08, 09 | `isoRoutes` cho bốn route mới; hàng A của `ai_credit_orders`/`ai_credit_reversals` hash không đổi khi B tấn công; `TestIsolationRealtime` cho hai topic cấp tổ chức; `TestTenantExportClassifiesEveryTenantTable` và test phân loại của lát xóa phủ hai bảng mới và ba bảng v0.4 (BE-B7) |
| 18 | Thông báo + thư: `billing_credit_added`, `billing_renewed`, `billing_payment_failed`, `billing_refunded` | §16.9 | AIP-BILL-10, 12 | chỉ owner tổ chức nhận (admin và thành viên thì không); dòng không có workspace hiện ở mọi workspace của owner (FE-36); Hộp việc + thư giao dịch, không vào digest; IPN thất bại → đúng một `billing_payment_failed`; hoàn tiền → `billing_refunded` không nêu số US$ |
| 18b | Điều kiện bán gói nạp và hạn dùng | §16.6.2, Q-AIP-17, 19 | AIP-BILL-06 | tổ chức Starter / `past_due` bị `ai_credit_pack_requires_paid_plan`; đơn `topup` có `expires_at` = trả + 12 tháng, **tại lúc tạo** muộn hơn mọi grant `plan_period` còn hiệu lực |
| 18c | Thông báo thanh toán thất bại chỉ một lần (BE-B9) | §16.9 | AIP-BILL-10 | IPN thất bại lặp → một dòng audit `billing.payment_intent_failed` và một thông báo; QueryDR báo chưa trả → một thông báo; lỗi tạo phiên của `Checkout` → không thông báo; intent hết hạn do `ExpirePending…` → không thông báo |
| 19 | Màn hình g, h, i, j | §11, §16.10 | AIP-BILL-11, 12, 13 | e2e trên Hub giả: g1/g10/g12, h3–h6, i1–i6, j10–j15 |

---

## 16. Thanh toán AI

> Từ v0.5 (Q-AIP-1 = (c)). Mọi dòng "đã kiểm" có `file:dòng` ở UniWork (không tiền tố) hoặc `hub:file:dòng` ở Hub (đọc working tree 2026-10-18); "giả định" nằm ở §16.13 và §13.3 (5)–(9). Không có host, IP, khóa nào trong mục này; credential app của Hub đi qua `AI_HUB_*` (§5, `AIP-01`, `.env.example`).

### 16.1 Nguyên tắc

1. **Khách chỉ trả tiền trong UniWork** (checkout VNPay hiện có). Hub không thu tiền, không có màn Hub/Console nào cho khách; UniWork biến *đơn đã thanh toán* thành lệnh gọi Hub (người dùng chốt 2026-10-18 22:06).
2. **Đơn credit (`ai_credit_orders`) là nguồn duy nhất của mọi grant do billing tạo.** Đơn được ghi **cùng transaction** với sự kiện gây ra nó (IPN đã thanh toán, thao tác hỗ trợ, sweep kỳ) kèm audit + outbox (ADR 0009); việc gọi Hub chạy sau, ở lane chậm. Không có lệnh gọi Hub nào nằm trong request của người dùng hay trong transaction thanh toán.
3. **Thanh toán không phụ thuộc Hub.** IPN vẫn thành công, hóa đơn vẫn xuất khi Hub sập; credit đến sau (§16.7). Thanh toán không bao giờ bị từ chối vì Hub.
4. **Không bao giờ cấp trùng.** Ba lớp: ràng buộc duy nhất ở DB (một đơn cho mỗi thanh toán / mỗi kỳ), khóa idempotency của Hub (`uw-ord-<order_id>`, thân bất biến chụp lúc tạo đơn), và claim có lease + ghi trạng thái có điều kiện.
5. **Không thu hồi dưới 0.** Hoàn tiền chỉ thu hồi **phần chưa tiêu** của grant (Hub không cho thu hồi hơn thế: `hub:internal/ledger/ledger.go:101-134`); phần đã tiêu không đòi lại (Q-AIP-15).
6. **VND và US$ là hai con số độc lập.** Giá niêm yết và hóa đơn là VND; credit là US$ (1 credit = US$1, Hub không có tỉ giá: `hub:docs/SPEC.md:211-215`). Không quy đổi ở bất kỳ đâu (Q-AIP-2, §16.6.6).
7. **BYOK không tạo đơn, không cấp credit.** Khóa riêng đi ngoài Hub (§5.7); billing không biết đến chúng.
8. **Cờ chỉ ẩn, không bỏ rơi tiền đã nhận.** Tắt `ai_billing_sync` ngừng *tạo* đơn `plan_period` mới và ngừng bán gói nạp (IPN của gói nạp đã mở trước đó vẫn tạo đơn); đơn và thu hồi đã ghi vẫn được đẩy tiếp (§16.12).
9. **Agent không mua, không hoàn, không cộng credit** (ADR 0010, 0007): mọi lệnh ở §16 là người (`service.Human`) hoặc hệ thống (`audit.System`).

### 16.2 Billing của UniWork hôm nay (đã kiểm)

| Chủ đề | Hiện trạng | Nguồn |
|---|---|---|
| Catalog | `plans` (mã, giá VND `price_amount`, chu kỳ `billing_period` month/year, `is_active`), `features`, `plan_features` (giá trị theo gói); `ai.tokens` là meter hôm nay (Starter 100.000, Team 2.000.000, Business 10.000.000/kỳ); ghi đè theo tổ chức bằng `subscriptions.overrides` | `server/migrations/069_billing_catalog.up.sql:4,19,29`; `9991790921000000_billing_tiers_b1.up.sql:25-26,51,72`; `entitlement.go:545` (`Snapshot`) |
| Thanh toán | Một lần mỗi đơn (không có thẻ lưu sẵn, không tự gia hạn): `Checkout` chỉ owner, tạo `billing_payment_intents`, gọi `provider.CreateCheckout` (VNPay) | `billing_checkout.go:33-60`, `:120-143`; `billing.go:112` (`requireOwner`); `migrations/9991790920000000_billing_payment_intents.up.sql:3` |
| IPN → trạng thái | webhook vào `webhook_inbox`, worker `ProcessBillingWebhookInbox` mỗi giây → `ApplyProviderEvent` → `applyProviderEvent`: khóa intent bằng `MarkBillingPaymentIntentCompleted`, `ApplyPaidSubscriptionFromProvider` (kỳ **mới tính từ lúc trả**, không cộng dồn thời gian còn lại), `InsertInvoice`, `recordChange`, **một transaction** | `billing_webhook.go:19-79`; `billing_provider_event.go:113-239` (`:188-189` kỳ, `:199-204` khóa intent, `:205-211` subscription, `:225-232` invoice, `:236-238` audit) |
| Lặp IPN | intent đã `completed` → `errIntentAlreadyCompleted` → commit rỗng; lệch số tiền/tiền tệ → intent `failed`, không áp | `billing_provider_event.go:156-161`, `:167-178` |
| Hết kỳ | không có tự gia hạn: quét hủy-lapse (`cancel_at` → gói mặc định) và `past_due` (hết kỳ → `past_due`, owner trả lại); `past_due` vẫn dùng được 7 ngày | `billing_lapse.go:21-34`, `:58-80`, `:121`; `entitlement.go:52-54`, `:125` |
| Kỳ của meter | `meterPeriodStart`: đầu kỳ đã trả nếu có, không thì tháng dương lịch giờ Việt Nam | `entitlement.go:239-246` |
| Đổi gói | owner chỉ đổi thẳng sang gói **không có giá** (gói có giá phải qua checkout: `checkout_required`); từ gói trả phí xuống gói rẻ hơn, kể cả gói miễn phí, bị từ chối (`downgrade_not_allowed`), ở cả `Checkout`; đường hạ là `Cancel` (hủy cuối kỳ). Đổi tay/miễn phí gọi `ChangeSubscriptionPlan`: `current_period_start = now()`, **`current_period_end = NULL`** (kỳ meter quay về tháng dương lịch) | `billing.go:143-155`, `:168-171`, `:203-207`, `:286-300`; `billing_checkout.go:71-75`; `billing.sql:83-97` |
| Hoàn tiền | chỉ nhân viên nền tảng: `POST /admin/invoices/{invoiceID}/refund`; VNPay hoàn qua API rồi `refund_pending`/`partial_refund_pending` chờ xác nhận, **một lần hoàn mỗi hóa đơn**; thủ công chỉ hoàn toàn bộ; hoàn toàn bộ đưa tổ chức về gói mặc định nếu hóa đơn là của kỳ hiện tại | `admin_billing_refund.go:17-60`, `:67-112`, `:114-170`; `admin_billing_refund_vnpay.go:29-70`; `billing_subscription_refund.go:12-63` (`:37-39` điều kiện cùng kỳ); `handler/router/admin.go:60` |
| Xác nhận hoàn tiền | ba nơi hoàn **thành công**, mỗi nơi gọi `revertSubscriptionAfterFullInvoiceRefund` trong cùng transaction: hoàn thủ công (`:104`), `ConfirmInvoiceRefund` (`:163`, gồm cả hoàn một phần: hóa đơn quay lại `paid`, `amount_refunded` tăng), đối soát VNPay (`:96`) | `admin_billing_refund.go:104`, `:163`; `billing_refund_reconcile.go:60-110` (`:96`); `pkg/db/queries/billing.sql:328-349`, `admin.sql:293-315` |
| Đối soát hiện có | `RunWorkers` chạy webhook inbox, lapse, refund-pending reconcile, stale-intent reconcile, backfill meta; khuôn cho `ProcessAICreditReconcile` | `billing_webhook.go:19-50`; `billing_intent_reconcile.go:17-52`; `billing_refund_reconcile.go:22-58` |
| Hàng hóa ngoài gói | **không có**: không có gói nạp, không có hóa đơn lẻ; `billing_payment_intents.plan_id` luôn có | `billing_provider_event.go:180`; `billing.sql` (intent) |

### 16.3 Hợp đồng Hub dùng cho billing (đã kiểm trong mã Hub)

Người gọi: **app UniWork** (principal `KindApp`, credential của channel `uniwork`), chỉ từ `internal/service` qua `server/internal/aihub` (§5.1, §16.10); không bao giờ từ client, không bao giờ bằng `hub_admin`. App chỉ chạm account/grant của chính mình (`hub:internal/admin/perm.go:31`, `hub:internal/admin/grants.go:131-143`).

| Lệnh | Route / payload | Idempotency, lỗi | Nguồn |
|---|---|---|---|
| Cấp credit | `POST /admin/v1/grants` `{account_id, amount_micro, source ∈ order\|subscription\|promo\|adjust, source_ref, expires_at?, priority, idempotency_key}` (app: `app_id` bị ép thành chính nó; khác thì 403) | **idempotent theo `(app, idempotency_key)`**: lặp cùng thân → `200` cùng `id`; lặp khác một trong `{account, amount, source, source_ref, expires_at, priority}` → `409`; lần đầu `201`. Grant **bất biến**, không có `valid_from` | `hub:internal/admin/grants.go:27-36`, `:44-50`, `:66-80`, `:155-172`, `:209-262`; `hub:internal/ledger/ledger.go:53-99` |
| Thu hồi | `POST /admin/v1/grants/{id}/revoke` `{amount_micro, idempotency_key, reason}` | tối đa **phần chưa tiêu**; vượt → `409`; lặp cùng `(grant, amount, reason)` → `200` y hệt, khác một trong ba → `409` | `hub:internal/admin/grants.go:38-42`, `:111-127`, `:177-207`, `:295-337`; `hub:internal/ledger/ledger.go:101-134` |
| Liệt kê grant | `GET /admin/v1/grants?account=<id>&limit=200` | **mặc định 50, tối đa 200 (phải gửi `limit=200` tường minh); grant mới nhất, `after` bị bỏ qua, không get-by-id** (H-10); mỗi dòng có `remaining_micro` | `hub:internal/admin/grants.go:263-293`; `hub:internal/admin/accounts.go:18-19`, `:103-114` |
| Đặt plan | `PUT /admin/v1/accounts/{id}/plan` `{plan_id}` | **không idempotent, append-only**: mỗi lần thêm một dòng `account_plans`, plan hiện hành = dòng mới nhất (H-9); app chỉ đặt được plan **có price book cho app mình**, nếu không `403` | `hub:internal/admin/plans.go:449-500` (`:485-489`); `hub:internal/store/db/accounts.sql.go:173-182,268-281`; `hub:internal/admin/ac2_plan_app_db_test.go:56-61` |
| Ví | `GET /admin/v1/wallets/{account}` (C2) | chỉ đọc | `hub:internal/admin/grants.go:339` |

Hành vi của sổ cái cần nhớ: (a) **thứ tự trừ**: grant hết hạn sớm nhất trước, grant không hạn trừ sau cùng, đồng hạng thì `priority` lớn trước (`hub:internal/store/queries/ledger.sql:17-22`); (b) grant theo kỳ mặc định không rollover và job `ExpireGrants` (~1 phút) đưa phần còn lại về 0 khi qua `expires_at` (`hub:docs/SPEC.md:222-224`, `hub:internal/meter/meter.go:312-345`); (c) ví cho phép âm tới `-credit_limit_micro`, mặc định provisioning là 0 (`hub:scripts/provision-uniwork.sh:164`, `hub:docs/SPEC.md:316-317`) và grant kế tiếp trả nợ trước (`hub:internal/ledger/ledger.go:88-96`); (d) `plan.credit_micro` của Hub **không tự cấp credit** — `putAccountPlan` chỉ chèn dòng plan và ghi audit (`hub:internal/admin/plans.go:485-489`) — nên mọi credit phải là một `grant` tường minh; (e) Hub **không có webhook** cho grant hết hạn hay bị thu hồi (§12), nên số dư hiển thị lấy qua ví (cache 30 giây, §5.5) chứ không nhờ sự kiện.

**Phụ thuộc Hub ghi ở §13.2: H-9** (PUT plan không idempotent, app không đọc được plan) và **H-10** (không get-by-id, danh sách mặc định 50 và tối đa 200, `revoke` quá số bị `409` không kèm số còn lại) và **H-11** (hai loại `409` cùng một mã `conflict`). Cả ba có cách làm vòng ở §16.4 và §16.8; không cái nào chặn v1.

### 16.4 Ánh xạ gói UniWork → Hub

**Quyết định v1: một Hub plan chung cho mọi tổ chức đi Hub; khác biệt giữa các gói UniWork nằm ở *lượng credit mỗi kỳ*, không ở model hay độ đồng thời.** Lý do: UniWork chưa có yêu cầu khác biệt model/đồng thời theo hạng (§12 (h)); một plan nghĩa là lệnh `PUT plan` chạy **đúng một lần cho mỗi account** (lúc liên kết), nên tính append-only và không idempotent của H-9 vô hại. Thẻ `AIP-BILL-14` mở rộng thành bảng ánh xạ khi chủ sản phẩm yêu cầu.

- **Hub plan**: id lấy từ env `AI_HUB_PLAN_ID` (thêm vào `.env.example`, `scripts/env-example.test.mjs`), do hub_admin tạo ở R1 với price book cho app `uniwork` và `credit_limit_micro = 0` (giả định (9)). R1 kiểm hai điều: `PUT` với app credential trả `200`, và `credit_limit_micro` đúng 0.
- **Khi nào PUT**: trong `EnsureAccount` (AIP-03, mở rộng ở `AIP-BILL-05`), ngay sau khi tạo/phục hồi account, **và chỉ khi `ai_hub_routing && ai_billing_sync` của tổ chức** (BE-B12): tổ chức chỉ ở R2 (`ai_billing_sync` tắt) không bị PUT, nên plan hub_admin đặt tay cho pilot không bị ghi đè (PUT append-only, dòng mới nhất thắng: `hub:internal/admin/plans.go:485-489`, H-9). UniWork lưu `ai_hub_accounts.hub_plan_id_synced`; **chỉ PUT khi giá trị mong muốn ≠ đã đồng bộ**. Mỗi lần PUT đọc trạng thái mong muốn **lúc chạy** (không lấy từ payload sự kiện), nên chạy lại hay chạy trễ đều hội tụ về cùng plan. Audit `ai.hub.plan_set`.
- **Credit mỗi kỳ** = giá trị feature `ai.credit_micro` của tổ chức tính bằng cùng hàm entitlement hiện có (`effective()` gộp plan features và `subscriptions.overrides`: `entitlement.go:545`); Q-AIP-11 (a): chủ sản phẩm đặt số cho từng gói qua `PUT /admin/plans/{code}/features/{key}` (`handler/router/admin.go:59`). Quy tắc đọc (dòng `after`, `Limit` không nil và `> 0`) ở §16.6.1 bước 2. Số này được **chụp vào đơn lúc tạo** và không bao giờ tính lại.
- **Không dùng `plan.credit_micro` của Hub** để cấp credit (§16.3 (d)).
- **Hạn dùng** của grant `plan_period`: gói trả phí = `current_period_end` + `pastDueGrace` (7 ngày, khớp thời gian `past_due` vẫn dùng được: `entitlement.go:52-54`); gói miễn phí/không có kỳ trả = đầu tháng sau giờ Việt Nam (khớp `meterPeriodStart`: `entitlement.go:239-246`). `topup` hết hạn theo Q-AIP-17 (a): `expires_at = max(trả + 12 tháng, hạn muộn nhất của mọi grant `plan_period` còn hiệu lực + 1 ngày)`, tính **lúc tạo đơn** rồi chụp (không tính lại khi thử lại). Vế `max` chỉ bảo đảm thứ tự **tại lúc tạo đơn**: credit nạp 12 tháng mua ở tháng 1 hết hạn trước grant kỳ của tháng 12, nên cuối hạn nó bị trừ trước credit kỳ mới — vô hại cho khách (BE-B16).

### 16.5 Dữ liệu

Mọi bảng mới theo luật migration của repo (`server/migrations/lint_test.go`): không `FOREIGN KEY`/`REFERENCES`, id ULID `TEXT` (`util.NewID()`), `organization_id TEXT NOT NULL` (ADR 0008), cặp `created_by` + `created_by_kind` (ADR 0007), mỗi index là `CREATE [UNIQUE] INDEX CONCURRENTLY` **một tệp riêng**, tiền tố `999<unix-ms>_*`. Thẻ sở hữu: `AIP-BILL-02` (sqlc `server/pkg/db/queries/ai_credit.sql`, query tên `AiCredit*`, mỗi query có điều kiện tenant hoặc dòng `-- tenant:` thuộc tập đóng; `TestEveryQueryNamesItsTenant`).

**`ai_credit_orders`** — một dòng cho mỗi lần UniWork phải cấp credit.

| Cột | Ghi chú |
|---|---|
| `id`, `organization_id`, `created_by`, `created_by_kind`, `created_at` | khuôn chung; người tạo là `system` (IPN, sweep), `human` (hỗ trợ) |
| `kind` | `plan_period` \| `topup` \| `admin_adjust` |
| `amount_micro`, `expires_at`, `source`, `source_ref`, `priority` | **chụp lúc tạo, bất biến** — là toàn bộ thân grant (§16.7) |
| `subscription_id`, `period_start` | cho `plan_period`; duy nhất `(subscription_id, period_start)` |
| `payment_intent_id`, `invoice_id`, `pack_code` | liên kết thanh toán (duy nhất `payment_intent_id` khi có) |
| `client_ref` | chống bấm đúp của `admin_adjust`; duy nhất `(organization_id, client_ref)` khi có |
| `status` | `pending` \| `granted` \| `failed` |
| `failed_kind` | `config` (400/401/403: sửa cấu hình rồi tự khỏi) \| `conflict` (`409 conflict` của `POST grants` = khóa dùng với thân khác: chỉ người xử lý) \| `expired` (tới lúc đẩy thì `expires_at` đã qua, ví dụ Hub sập quá lâu: chỉ người xử lý, §16.7) |
| `hub_account_id` | chụp lần đẩy đầu tiên, giữ nguyên cho mọi lần thử lại |
| `hub_grant_id`, `granted_at` | từ response Hub |
| `attempt_count`, `next_attempt_at`, `lease_until`, `last_error_code` | claim + backoff; `next_attempt_at` mặc định `now()` khi tạo đơn |

**`ai_credit_reversals`** — một dòng cho mỗi lần hoàn tiền xác nhận thành công của hóa đơn có đơn credit.

| Cột | Ghi chú |
|---|---|
| `id`, `organization_id`, `created_by`, `created_by_kind`, `created_at` | khuôn chung |
| `order_id`, `invoice_id` | duy nhất `(order_id, refunded_minor)` — khóa chống lặp |
| `refunded_minor` | `invoices.amount_refunded` **tích lũy** sau lần hoàn này (đơn vị nhỏ nhất của hóa đơn) |
| `cum_target_micro`, `target_micro` | mục tiêu tích lũy và phần của riêng lần này |
| `status` | `waiting_grant` \| `pending` \| `reversed` \| `nothing_to_reverse` \| `needs_support` |
| `revoke_key`, `revoke_micro`, `revoke_attempt`, `reason_ref` | **ghi trước khi gọi Hub** (§16.8) |
| `revoked_micro`, `reversed_at`, `attempt_count`, `next_attempt_at`, `lease_until`, `last_error_code` | kết quả + claim |

**`ai_credit_packs`** — catalog gói nạp: `code`, `name`, `price_amount` (VND), `credit_micro`, `is_active`, `sort`. **Không có `organization_id`**: catalog toàn cục như `plans`, nên vào `tenantExemptTables` kèm lý do (`migrations/lint_test.go`); gieo bằng migration (Q-AIP-12 (a), ≤ 3 gói; giá và số credit do chủ sản phẩm đặt, spec không bịa số). Sửa giá = migration có review (§12 (g)).

**Cột mới trên bảng đang chạy thanh toán thật** (rủi ro §14 (7); migration thêm cột có mặc định, không khóa bảng dài):

- `billing_payment_intents`: `kind` (`plan` mặc định \| `ai_credit_pack`), `pack_code`, `credit_micro` (chụp từ `ai_credit_packs` lúc tạo intent, như `Amount`; nếu không thì giá/credit của gói đổi giữa lúc mở checkout và lúc IPN tới sẽ lệch đơn), `plan_id` **thành nullable**.
- `invoices`: `kind` (`subscription` mặc định \| `ai_credit_pack`). **Mọi đường đọc hóa đơn hiện có phải xử lý loại mới trước khi bán gói nạp**: `revertSubscriptionAfterFullInvoiceRefund` thoát sớm khi `kind != 'subscription'` (`billing_subscription_refund.go:17`); nếu không, hóa đơn gói nạp có `period_end` trùng kỳ hiện tại sẽ **đưa tổ chức trả phí về Starter** khi hoàn (`:37-39`). Hóa đơn gói nạp ghi `period_start = period_end = thời điểm trả` như một lớp bảo vệ thứ hai.
- `ai_hub_accounts`: `hub_plan_id_synced` (§16.4).
- Feature `ai.credit_micro` trong `features` + `plan_features` (kiểu số nguyên như `ai.tokens`), gieo trong cùng thẻ; **giá trị theo gói là của chủ sản phẩm** (Q-AIP-11).

**Cô lập:** hai bảng có tenant (`ai_credit_orders`, `ai_credit_reversals`) được gieo một dòng của tổ chức A trong `isolation_world_test.go` ở chính thẻ `AIP-BILL-02` (như BE-19), nếu không `TestIsolationMatrix` đỏ ngay khi bảng tồn tại.

**Xuất và xóa tổ chức (BE-B7).** `TestTenantExportClassifiesEveryTenantTable` (`server/internal/service/tenant_export_tables_test.go:12`) đỏ ngay khi một migration thêm bảng có `organization_id` mà chưa ai phân loại (`tenant_export_tables.go:3-6`), và lát xóa tổ chức giữ những bảng trong `tenantDeleteRetain` (`tenant_delete_tables.go:9-28`: hóa đơn và intent là chứng từ kế toán) còn mọi bảng đã phân loại khác thì bị xóa. Vì vậy `AIP-BILL-02` thêm `ai_credit_orders` và `ai_credit_reversals` vào **cả hai** `tenantExportExcluded` (lý do: chứng từ thanh toán, giữ như hóa đơn) và `tenantDeleteRetain` (chúng trỏ tới hóa đơn được giữ; xóa chúng làm mất vết của khoản tiền đã nhận). Ba bảng của v0.4 (`ai_hub_accounts`, `ai_quota_policies`, `ai_hub_webhook_events`) có cùng khoảng trống từ vòng 1: thêm vào `tenantExportExcluded` (liên kết/cấu hình kỹ thuật và sổ chống phát lại, không phải nội dung) và để lát xóa **xóa** chúng (đề nghị; `AIP-00` chốt trong ADR, cùng việc account Hub của tổ chức đã xóa do vận hành đóng ở Hub, ngoài phạm vi); thẻ `AIP-02` làm ba bảng này, thẻ `AIP-BILL-02` làm hai bảng billing, mỗi thẻ chạy test phân loại.

### 16.6 Luồng

#### 16.6.1 Mua gói và gia hạn

Gia hạn **là mua lại**: không có tự gia hạn (§12 (a)); hết kỳ → `past_due` rồi lapse (§16.2); owner trả lại gói đó hoặc gói khác. Cả mua mới, nâng gói và gia hạn đi cùng một đường:

1. Owner chọn gói → `Checkout` hiện có (không đổi) → VNPay → IPN → `applyProviderEvent`.
2. **Trong cùng transaction** với `InsertInvoice` (`billing_provider_event.go:225-238`), khi `ai_hub_routing && ai_billing_sync` của tổ chức đúng: **`billing_provider_event.go` tự tính `in`** rồi gọi `AICreditService.createOrderTx(ctx, q, in)` (BE-B8: `ai_credit.go` chỉ gọi query `AiCredit*`, không gọi query plan/subscription bị khóa theo tệp, §16.10). `createOrderTx` chèn `ai_credit_orders`: `kind='plan_period'`, `source='subscription'`, `source_ref='uw-sub-<subscription_id>-<period_start_unix>'`, **`subscription_id = after.ID` và `period_start = start`** (BE-B5) — đúng giá trị ghi vào `current_period_start` (`billing_provider_event.go:188,208`) và là kỳ mà `meterPeriodStart` trả cho kỳ đã trả (`entitlement.go:239-246`); để NULL thì khóa duy nhất `(subscription_id, period_start)` không va chạm và sweep §16.6.3 sẽ cấp kỳ đó lần hai —, `amount_micro`, `expires_at` = `periodEnd` + 7 ngày, `payment_intent_id`, `invoice_id`; audit `ai.credit.ordered` và outbox `ai_credit.sync_requested`.
   **Quy tắc `amount_micro` (BE-B4):** `Limit` của feature `ai.credit_micro` trong `effective(after, rows, now)`, với `after` là dòng subscription mà `ApplyPaidSubscriptionFromProvider` **vừa trả về** — không phải `sub` khóa trước khi cập nhật (tổ chức `past_due` quá ân hạn trả tiền trễ có `sub` không còn `active`, `effective` ra `Limit = 0`: `entitlement.go:158-162`). Chỉ tạo đơn khi `Enabled` đúng, `Limit` **không nil** (nil là *không giới hạn*, không phải một số credit: `entitlement.go:141-144`, `:153-155`) và `> 0`. Feature không khai báo/tắt/NULL/`<= 0`, lỗi đọc feature và lỗi đánh giá cờ đều nghĩa là **không tạo đơn và không trả lỗi**: lỗi thoát ra khỏi `applyProviderEvent` sẽ rollback thanh toán rồi `DEAD_LETTER` sau `webhookMaxAttempts` (`billing_webhook.go:115-127`), nên chỉ lỗi DB mới được làm hỏng transaction. Kỳ đó sẽ được sweep bù (§16.6.3). `ai.credit_micro` **không** thêm vào `wiredFeatures` (`entitlement.go:41-46`): hàng quota của nó bị client ẩn như mọi feature chưa nối, giao diện credit là khối Credit AI (g1).
3. IPN lặp không thể tạo đơn thứ hai: intent đã `completed` thì dừng trước khi tới bước 2 (`billing_provider_event.go:156-161`, `:199-204`); và `(subscription_id, period_start)`, `payment_intent_id` là duy nhất.
4. Sau commit, `AICreditSyncConsumer` đẩy grant (§16.7). Tổ chức chưa có account Hub: `EnsureAccount` chạy trước (§16.4); `hub_account_id` chụp vào đơn ở lần đẩy đầu.

**Cờ bật muộn:** nếu cờ tắt lúc thanh toán thì không có đơn; sweep `EnsurePeriodGrants` (§16.6.3) bù đơn cho kỳ hiện tại khi cờ bật, nên khách trả tiền lúc cờ tắt không mất credit của kỳ đang chạy.

#### 16.6.2 Mua gói nạp (top-up)

- **Catalog**: `ai_credit_packs` (§16.5), kind hàng hóa mới; không có gói → nút ẩn (board g, khung g9).
- `POST /orgs/{orgID}/billing/ai-credit/checkout` (§16.10): chỉ owner (`requireOwner`), `ai_hub_routing && ai_billing_sync`, tổ chức đã có account Hub; tạo intent `kind='ai_credit_pack'` với `Amount` = giá gói (chụp), `plan_id` rỗng; dùng nguyên hạ tầng `provider.CreateCheckout` (`billing_checkout.go:120-143`). Trở về `?checkout=success|cancel&credit=1`.
- Hôm nay `Checkout` tái dùng intent chờ **cùng gói** (`GetPendingBillingPaymentIntentForPlan`) và dựng lại link VNPay từ chính intent (`IntentID`, `CreatedAt`, `ExpiresAt`), còn khi không có thì `ExpirePendingBillingPaymentIntents` hết hạn **mọi** intent đang chờ của tổ chức, không phân loại (`billing_checkout.go:76-97`, `billing.sql:123-132`). Với gói nạp: thêm query tái dùng `…ForPack` (cùng `pack_code`) cho board h (h10), và đổi `ExpirePendingBillingPaymentIntents` thành chỉ hết hạn intent **cùng loại** — nếu không, mở checkout gói nạp sẽ làm hết hạn checkout gói đăng ký đang chờ và ngược lại (intent hết hạn vẫn trả được: `billing_provider_event.go:162-166`, nên không mất tiền, nhưng trạng thái màn hình sai).
- `applyProviderEvent` rẽ nhánh theo `intent.kind`: gói nạp **không** đụng `subscriptions`; ghi `invoices.kind='ai_credit_pack'`, đơn `topup` (`source='order'`, `source_ref='uw-int-<intent_id>'`, `expires_at` theo §16.4, `amount_micro` = `credit_micro` của intent, chụp lúc tạo intent), audit + outbox cùng transaction. Đơn `topup` được tạo **bất kể cờ** `ai_hub_routing`/`ai_billing_sync` lúc IPN tới (BE-B3): intent `completed` là bằng chứng bán hàng, và sau commit không còn đường nào khác tạo đơn (`billing_provider_event.go:156-161` chặn IPN lặp, `billing_intent_reconcile.go:17-52` chỉ xử lý intent chưa thanh toán); nếu không, một khách trả tiền lúc cờ vừa tắt sẽ mất credit mà không gì chữa. Chỉ việc **bán** (checkout) và việc tạo đơn `plan_period` phụ thuộc cờ (§16.12); lần đẩy của đơn `topup` chạy `EnsureAccount` dù cờ định tuyến đã tắt. Reconcile bù đơn thiếu (§16.7).
- **Điều kiện mua (Q-AIP-19 (a))**: gói hiện tại của tổ chức có giá (`planIsPaid`, `billing.go:128`) và subscription đang `active`; ngược lại `403 ai_credit_pack_requires_paid_plan` (UI g3/g7: "Nâng cấp gói để nạp thêm"). Kiểm trong `AICreditService`, trong cùng transaction khóa `LockLiveSubscription` như `Checkout` (`billing_checkout.go:55-59`).
- **Thứ tự tiêu (Q-AIP-18 (a))**: Hub trừ grant hết hạn sớm nhất trước (`hub:internal/store/queries/ledger.sql:17-22`); vì `expires_at` của credit nạp muộn hơn credit kỳ còn hiệu lực **tại lúc tạo đơn** (§16.4), credit kỳ được tiêu trước và phần đã nạp được giữ tới cùng. Credit nạp chưa dùng mà hết hạn thì mất (Hub zero ở `ExpireGrants`), không hoàn tiền.

#### 16.6.3 Grant theo kỳ khi không có thanh toán (gói miễn phí, thủ công, bù)

`EnsurePeriodGrants` (`AIP-BILL-05`, `billing_ai_credit_period.go`) chạy trong `BillingService.RunWorkers` (mỗi vài phút) và ngay sau `EnsureAccount`; với từng tổ chức **đã liên kết** có `ai_hub_routing && ai_billing_sync` và subscription sống:

- kỳ hiện tại = `meterPeriodStart` (`entitlement.go:239-246`): kỳ đã trả nếu có, không thì tháng dương lịch giờ Việt Nam;
- nếu chưa có đơn `plan_period` cho `(subscription_id, period_start)` và `ai.credit_micro > 0` → tạo đơn (`ON CONFLICT DO NOTHING`), `source_ref` như §16.6.1; gói trả phí hết kỳ **và** qua ân hạn thì không tạo (không cấp cho kỳ đã hết); với **kỳ đã trả** thì đơn mang `payment_intent_id` và `invoice_id` của hóa đơn kỳ đó (hóa đơn `kind='subscription'` của `subscription_id` có `period_start` bằng `period_start`; query mới thêm vào regex `arch_test.go:212`, §16.10), để hoàn tiền hóa đơn ấy vẫn thu hồi được (BE-B11); kỳ miễn phí và đơn cộng tay không có hóa đơn nên không có thu hồi;
- phạm vi: gói miễn phí (Q-AIP-11: Starter có credit nhỏ), kỳ trả phí mà IPN không tạo đơn (cờ bật muộn, đơn bù), và gói do nhân viên đổi tay (`POST /admin/organizations/{orgID}/plan`, `handler/router/admin.go:54`) — ca cuối chỉ được grant ở lần quét kế tiếp, nhân viên có thể cộng tay (§16.11).

Gói miễn phí không thể được cấp hai lần trong một tháng: khóa là `(subscription_id, period_start)` với `period_start` = đầu tháng giờ Việt Nam (không phải `current_period_start` của subscription). Đổi gói tay nhiều lần trong tháng không sinh đơn thêm, vì `ChangeSubscriptionPlan` xóa kỳ trả (`current_period_end = NULL`, `billing.sql:83-97`) nên khóa vẫn là đầu tháng đó.

#### 16.6.4 Đổi gói giữa kỳ

Quyết định Q-AIP-14 (a): **giữ nguyên luật billing hiện có, không chia tỉ lệ tiền VND** (§12 (b)).

| Tình huống | Hành vi billing hôm nay | Credit |
|---|---|---|
| Nâng gói (Starter → Team → Business) | thanh toán mở **kỳ mới từ lúc trả**, không trừ phần kỳ cũ (`billing_provider_event.go:188-189`) | đơn `plan_period` **mới đầy đủ** theo gói mới; grant kỳ cũ vẫn dùng tới `expires_at` của nó (Hub trừ hết hạn sớm nhất trước) — khách không mất credit đã trả, và hai kỳ chồng nhau là hệ quả của việc luật hiện có tính kỳ mới từ lúc trả |
| Hạ gói trả phí (Team ← Business) | hôm nay **bị từ chối** (`downgrade_not_allowed`, `billing.go:203-207`, `billing_checkout.go:71-75`); owner chỉ có hủy cuối kỳ. **Q-AIP-20 (a)** (khuyến nghị theo baseline, thẻ `AIP-BILL-15`): lên lịch từ kỳ sau, quyền lợi giữ tới hết kỳ, owner trả gói thấp hơn khi kỳ hết | không đổi giữa kỳ; kỳ mới (sau khi trả) cấp credit **của gói thấp hơn** theo §16.6.1; không có đơn nào được tạo lúc *lên lịch* |
| Hủy cuối kỳ (`cancel_at`) → lapse | `Cancel` (`billing.go:286-300`) → hết kỳ → gói mặc định (`billing_lapse.go:35-57`, `:81`) | grant kỳ trả phí hết hạn tại `expires_at` (kỳ + 7 ngày); từ lúc về Starter, tháng dương lịch kế tiếp có đơn miễn phí nếu Starter có credit (§16.6.3); credit nạp (`topup`) **giữ tới hạn của nó** (Q-AIP-17) |
| `past_due` | dùng được 7 ngày (`entitlement.go:125`) | không đơn mới; credit cũ hết đúng cùng lúc ân hạn (§16.4) |

#### 16.6.5 Reset kỳ và rollover

**Khuyến nghị (Q-AIP-13 (a)): không rollover.** Credit kỳ hết hạn cuối kỳ cộng ân hạn; grant mới cho kỳ mới; credit nạp thêm giữ tới hạn của nó (12 tháng, Q-AIP-17). Lý do: (1) là mặc định của chính Hub (`hub:docs/SPEC.md:222-224`); (2) rollover phải thu hồi phần còn lại rồi cấp lại ở kỳ sau — Hub **không cho đổi `expires_at`** của grant cũ (bất biến: `hub:internal/admin/grants.go:27-36`), nên mỗi kỳ thêm hai lệnh Hub có thể lệch nhau và cần luồng đối soát phụ; (3) ai muốn dư thì mua gói nạp.

- "Reset" **không phải một lệnh Hub**: kỳ mới = một đơn mới (IPN hoặc sweep); credit cũ tự hết hạn ở Hub (`ExpireGrants` ~1 phút, giả định (8)). Số dư hiển thị lấy từ ví nên không hứa chính xác tới giây (§5.5).
- Hạn mức policy (workspace/người) có chu kỳ tính theo tháng UTC+7 của §3, **không** trùng chu kỳ trả của từng tổ chức; ví là trần của tổ chức, policy là trần con. Màn hình ghi rõ ngày hết hạn của credit kỳ (g1) và ngày đặt lại hạn mức (c, §11), hai ngày này có thể khác nhau.

#### 16.6.6 Giá VND và credit US$

- Hiển thị: giá VND mỗi kỳ **và** "gồm US$ y credit AI" là hai con số riêng (g1); gói nạp "US$ x — y ₫" (h1); ví "Còn US$ z". **Không quy đổi, không tỉ giá, không "≈"** (Q-AIP-2).
- Định dạng US$ 2 chữ số theo locale; giá trị `> 0` mà làm tròn ra 0,00 hiển thị "< US$ 0,01".
- Hóa đơn, VAT, số tiền VNPay giữ nguyên VND, không đổi (§12 (e)). Credit nằm trong mô tả hóa đơn gói nạp như tên gói, không như một dòng tiền.

### 16.7 Lỗi và đối soát

**Nguyên tắc: tiền đã nhận thì credit phải tới, đúng một lần.** Đơn `pending` không bao giờ bị bỏ; thân grant không bao giờ đổi.

**Đẩy grant** (`AICreditSyncConsumer`, **LaneSlow**, khuôn `HubPolicySyncConsumer` ở §6.3; topic `ai_credit.sync_requested`):

1. **Claim**: `UPDATE ai_credit_orders SET lease_until = now() + 60s, attempt_count = attempt_count + 1 WHERE id = $1 AND (status = 'pending' OR (status = 'failed' AND failed_kind = 'config')) AND next_attempt_at <= now() AND (lease_until IS NULL OR lease_until < now()) RETURNING *`. `next_attempt_at` có mặc định `now()` khi tạo đơn (nếu NULL thì điều kiện không bao giờ khớp). Đơn `failed` loại `conflict` và `expired` **không bao giờ claim được** (chỉ người xử lý, §16.11): nếu không, mỗi lượt sẽ tăng `attempt_count` và gọi Hub một lần `409` chắc chắn (BE-B6). Không có dòng → bỏ (node khác đang làm, chưa tới giờ, hoặc đơn không còn claim được). Reconcile dùng **cùng** predicate (bỏ `id = $1`) nên hai đường không giẫm nhau.
2. `hub_account_id`: dùng giá trị đã chụp; chưa có thì lấy từ `ai_hub_accounts`, **chưa liên kết thì `EnsureAccount` trước** (§16.4), rồi ghi vào đơn (một lần, không đổi nữa).
3. Nếu `expires_at <= now()` → `status='failed'`, `failed_kind='expired'`, audit `ai.credit.grant_failed`, **không gọi Hub** (không cấp credit đã hết hạn; người xử lý cộng tay ở §16.11 nếu khách xứng đáng).
4. `POST /admin/v1/grants` với **thân dựng chỉ từ cột bất biến của đơn**: `account_id = hub_account_id`, `amount_micro`, `source`, `source_ref`, `expires_at`, `priority`, `idempotency_key = "uw-ord-" + order_id`.
5. Kết quả:

| Hub trả | Hành động |
|---|---|
| `201` hoặc `200` | một transaction: `UPDATE … SET status='granted', hub_grant_id=$, granted_at=now() WHERE id=$ AND status <> 'granted'`, audit `ai.credit.granted`, outbox `ai_credit.granted`; xóa cache ví của tổ chức (§5.5) |
| `409` `code:"conflict"` (với `POST grants` chỉ có nghĩa khóa dùng với thân khác: `hub:internal/admin/grants.go:111-114`; Hub không có mã riêng, H-11) | `failed`, `failed_kind='conflict'`, **không bao giờ tự thử lại** (cùng khóa cùng thân vẫn 409); audit `ai.credit.grant_failed`; cảnh báo. Chỉ xảy ra nếu có lỗi lập trình làm đổi cột bất biến — test chặn (dưới) |
| `400`/`401`/`403` | `failed`, `failed_kind='config'` (credential sai/thu hồi, plan không có price book, account không thuộc app); cảnh báo vận hành (`ai_hub_misconfigured`, §8.1); ghi `next_attempt_at = now() + 1 giờ` để reconcile claim lại chậm (1 giờ/lần) nên **tự khỏi** khi sửa cấu hình, không cần nút "thử lại" |
| `404` (account chưa có ở Hub) | `EnsureAccount` rồi thử lại ngay một lần |
| `429`, `5xx`, hết thời gian, mạch ngắt mở | giữ `pending`, ghi `next_attempt_at` theo `outbox.RetryAt` (trần 5 phút, `server/internal/outbox/outbox.go:337-351`) rồi consumer **trả `nil`** (không trả lỗi: outbox không được dead-letter một đơn đã thanh toán); người thử lại tiếp theo là `ProcessAICreditReconcile` (dưới), không phải outbox; không tính là `failed` |

**Vì sao không cấp trùng được:** (1) DB: duy nhất `payment_intent_id`, `(subscription_id, period_start)`, `(organization_id, client_ref)` — không đường nào tạo hai đơn cho một khoản tiền; (2) Hub: khóa cố định theo `order_id` + thân bất biến: gửi lại sau khi mất response trả `200` cùng `id` (giả định (5)), hai lệnh song song cùng khóa chỉ tạo một grant (giả định (6)); (3) UniWork: claim có lease nên hai node không cùng đẩy, và ghi `granted` có điều kiện `status <> 'granted'`. Kịch bản xấu nhất — Hub đã tạo grant nhưng UniWork mất response hoặc chết trước khi ghi — hồi phục bằng chính lần thử sau (cùng khóa).

**Chống đổi thân.** Câu SQL `UPDATE` của sqlc chỉ có cột trạng thái (`status`, `failed_kind`, `hub_grant_id`, `granted_at`, `attempt_count`, `next_attempt_at`, `lease_until`, `last_error_code`, `hub_account_id` một lần); **không có query nào cập nhật `amount_micro`, `expires_at`, `source`, `source_ref`, `priority`**. Test: `TestAICreditOrderBodyIsImmutable` dựng thân từ đơn ở hai thời điểm khác nhau (đổi `ai.credit_micro` của gói giữa hai lần) và so bằng nhau; `TestAICreditOrderNeverGrantsTwice` chạy IPN lặp, hai consumer song song, mất response sau khi Hub đã tạo, và kiểm Hub giả có đúng một grant.

**Đối soát** (`ProcessAICreditReconcile`, gắn vào `BillingService.RunWorkers`, nhịp như `ProcessRefundPendingReconcile`: `billing_webhook.go:19-50`; khuôn `ProcessStalePaymentIntentReconcile`: `billing_intent_reconcile.go:17-52`):

- **là bộ thử lại duy nhất** (BE-B6): mỗi lượt claim tối đa N đơn thỏa **đúng predicate ở bước 1** — `pending` quá hạn lease (consumer chết giữa chừng), `pending` sau 429/5xx tới `next_attempt_at`, và `failed/config` tới `next_attempt_at` — rồi đẩy theo cùng đường trên; một Hub sập lâu hơn ngân sách thử lại của outbox (consumer có thể bị dead-letter) không làm kẹt đơn nào;
- **đơn nạp thiếu** (BE-B3): mọi intent `kind='ai_credit_pack'` đã `completed` mà không có `ai_credit_orders.payment_intent_id` tương ứng được tạo đơn `topup` (idempotent theo `payment_intent_id`, số chụp từ intent), cùng transaction với audit + outbox; chạy ở `billing_ai_credit_pack.go` (dưới allowlist query billing, §16.10), bất kể cờ;
- tương tự cho `ai_credit_reversals` (§16.8): claim `pending`, hoặc `waiting_grant` mà đơn đã `granted`, tới `next_attempt_at` và hết lease;
- **chỉ số** `uniwork_ai_credit_orders{status}`, `uniwork_ai_credit_pending_age_seconds` (đơn cũ nhất đang `pending`/`failed`), `uniwork_ai_credit_push_total{result}`; **cảnh báo `AICreditOrderStuck`** khi có đơn hoặc thu hồi `pending`/`failed` quá **15 phút** (nhãn `kind`), kèm runbook 4 mục ở `docs/runbooks/` (`scripts/alerts-runbooks.test.mjs`). Ngưỡng này là điều kiện qua R2b và R4 (§10).

**Hub sập** (mạch ngắt mở, 5xx kéo dài): thanh toán, hóa đơn, gia hạn **không bị ảnh hưởng** (§16.1 (3)); đơn nằm `pending`; màn Billing hiện "Đang cộng credit" (h5, h6) và ví "Số liệu cũ" (g12); sau khi Hub lên, reconcile đẩy hết theo thứ tự `created_at`. Không có chuyển hướng sang nhà cung cấp khác (Q-AIP-8).

**`409` ở các chỗ khác**: `revoke` quá phần chưa tiêu (§16.8), `PUT policy` (§6.3, không thuộc billing), `PUT plan` không có `409` (H-9). Phiên bản/đua ở phía UniWork (`row_version` của subscription) không đổi.

### 16.8 Hoàn tiền và thu hồi credit

**Phạm vi:** hoàn tiền vẫn **chỉ do nhân viên nền tảng** làm (Q-AIP-16 (a)); owner chỉ xem (board i, i1–i6). Hoàn thành công của một hóa đơn **có đơn credit** (`ai_credit_orders.payment_intent_id = invoices.payment_intent_id`) kéo theo một dòng `ai_credit_reversals`. Hóa đơn của đơn do sweep hoặc cộng tay (không có hóa đơn) không có thu hồi.

**Điểm móc.** Đúng ba chỗ hoàn thành công, mỗi chỗ đã gọi `revertSubscriptionAfterFullInvoiceRefund` trong transaction của mình; ngay cạnh đó gọi `AICreditService.requestReversalTx(ctx, q, invoice, actor)` **cùng transaction** (bao gồm audit + outbox, ADR 0009):

- `admin_billing_refund.go:104` — hoàn thủ công (toàn bộ);
- `admin_billing_refund.go:163` — `ConfirmInvoiceRefund` (toàn bộ **hoặc một phần**, hóa đơn có thể quay về `paid`);
- `billing_refund_reconcile.go:96` — đối soát VNPay (`confirmInvoiceRefundFromProvider`).

`refund_pending`, `partial_refund_pending` và hoàn bị từ chối (`revertRejectedInvoiceRefund`) **không** tạo thu hồi: credit chỉ động khi tiền đã hoàn thật (board i, khung i5).

**Tính mục tiêu.** `refunded_minor` = `invoices.amount_refunded` **tích lũy** sau lần hoàn này; `cum_target_micro = floor(order.amount_micro × refunded_minor / invoice.amount_paid)` tính bằng `numeric` trong SQL hoặc `big.Int` (nhân `int64` có thể tràn khi tích vượt ~9,2·10¹⁸, BE-B16); `target_micro = cum_target_micro − (cum_target_micro của thu hồi liền trước của đơn, hoặc 0)`. Khóa duy nhất `(order_id, refunded_minor)` làm hook **idempotent** (ba chỗ có thể chạy lại, đối soát có thể thấy cùng hóa đơn hai lần: chèn thứ hai bị chặn, không tạo thêm). Mã hôm nay chỉ cho **một lần hoàn mỗi hóa đơn** (VNPay: `admin_billing_refund.go:47-50`; thủ công chỉ hoàn toàn bộ: `:54-57`; §16.2), nên khóa theo `refunded_minor` tích lũy và phép trừ "phần chênh" là **phòng thủ**: nếu một thay đổi sau cho hoàn lần hai cho cùng hóa đơn, hook vẫn replay-safe và chỉ thu hồi phần chênh (BE-B13).

**Thực thi** (cùng `AICreditSyncConsumer`, topic `ai_credit.reversal_requested`, claim lease như §16.7):

1. Đơn chưa `granted` (Hub sập hoặc đang đẩy): thu hồi ở `waiting_grant`; khi đơn `granted` thì tiếp tục. Không hủy giữa chừng vì lệnh grant có thể đang bay ở Hub (đua); credit tới rồi bị thu hồi ngay, hội tụ cùng kết quả. Đơn kẹt `failed/conflict` thì thu hồi kẹt theo (cảnh báo chung, §16.7).
**Quy tắc phát lại (đứng trước bước 2, BE-B1).** Nếu dòng thu hồi **đã có `revoke_key`** mà chưa `reversed`, lần chạy này **bỏ qua bước 2–3** và gửi lại đúng bộ `revoke_key`/`revoke_micro`/`reason_ref` đã ghi — không đọc lại `remaining_micro`, không tính lại số. `200` → bước 5. Chỉ khi chính lần phát lại đó nhận `409` mới bắt đầu một lượt mới theo bước 6. Lý do: Hub trả lại thu hồi đã lưu **trước** khi kiểm số còn lại (`hub:internal/ledger/ledger.go:105-112`), nên nếu lệnh đầu đã được áp mà UniWork mất response thì phát lại cùng khóa luôn `200`; còn tính lại `min(target, remaining)` từ số còn lại **sau** khi lệnh đã áp rồi gửi khóa mới sẽ thu hồi thêm một lần nữa (thu hồi tổng vượt mục tiêu).
2. Lấy `remaining_micro` của `hub_grant_id` từ `GET /admin/v1/grants?account=<id>&limit=200` (mặc định 50, tối đa 200: `hub:internal/admin/accounts.go:18-19,103-114`; H-10). **Không thấy grant** (cũ hơn 200 grant) → `needs_support` (không đoán).
3. `revoke_micro = min(target_micro, remaining_micro)`. Bằng 0 → `nothing_to_reverse`, **không gọi Hub** (credit đã tiêu hết; không bao giờ ví âm).
4. **Ghi trước, gọi sau**: một transaction ngắn ghi `revoke_attempt`, `revoke_key = "uw-rev-<reversal_id>-<attempt>"`, `revoke_micro`, `reason_ref = "uw-refund-<reversal_id>"`; rồi mới `POST /admin/v1/grants/{id}/revoke {amount_micro, idempotency_key, reason}`. Mất response rồi chạy lại đi theo quy tắc phát lại ở trên (dùng **đúng** khóa/số/lý do đã ghi → `200` y hệt, giả định (7)), nên không thu hồi hai lần.
5. `200` → `reversed` (`revoked_micro = revoke_micro`), audit `ai.credit.reversed`, outbox `ai_credit.reversed`; xóa cache ví.
6. `409`. Hub dùng **một** mã cho cả hai nguyên nhân — `409` `code:"conflict"` (`hub:internal/admin/grants.go:111-127`; `httpx.CodeConflict` = `"conflict"`; không có `idempotency_mismatch`/`revoke_exceeds_unused` trong `hub:internal/httpx` hay `hub:docs/connect.md:670`) — nên client phân loại **theo ngữ cảnh**, không theo chữ trong `message` (H-11): đọc lại `remaining_micro`; nếu `remaining_micro < revoke_micro` thì lệnh đó chưa từng được Hub áp (khách vừa tiêu thêm: đua) → tăng `revoke_attempt` (**khóa mới**), tính lại số (bước 3–4), thử tối đa 3 lần mỗi lượt, vẫn đua thì để `pending` cho lượt sau; ngược lại (còn đủ mà vẫn `409`) là khóa dùng với thân khác, tức lỗi lập trình → `needs_support`.
7. `5xx/429/mạng` → `pending` + `RetryAt`; `400/401/403` → `needs_support` kèm `last_error_code`, cảnh báo.

**Ví dụ.** Gói Team 1 tháng, `amount_micro` = US$ 10: tiêu US$ 4, hoàn 50% → mục tiêu US$ 5, còn US$ 6 → thu hồi US$ 5, ví còn US$ 1. Cùng ví dụ nhưng tiêu US$ 8 → còn US$ 2, thu hồi US$ 2, **phần US$ 3 còn lại của mục tiêu không đòi lại** (i4 ghi "Đã dùng (không thu hồi)"). Tiêu hết → không gọi Hub.

**Số cho nhân viên quyết** (Q-AIP-15 (a), không chặn cứng): hộp thoại hoàn tiền ở `/admin` (j15) hiện "đã cấp / còn / đã dùng; sẽ thu hồi tối đa" cho đơn của hóa đơn đó, lấy từ `GET /admin/organizations/{orgID}/ai-credit` (§16.11, `remaining_micro` từ Hub qua `aihub`). Nhân viên tự chọn số tiền hoàn, chẳng hạn hoàn theo phần chưa dùng.

**Hoàn hóa đơn gói đăng ký toàn bộ** (i4): luật cũ vẫn chạy (về gói mặc định nếu cùng kỳ, `billing_subscription_refund.go:37-39`), cộng thu hồi credit chưa dùng của kỳ đó; credit nạp thêm (`topup`) **không** bị động tới trừ khi chính hóa đơn nạp được hoàn. **Hoàn hóa đơn gói nạp** không đổi gói đăng ký (§16.5).

**Hậu quả khi hoàn xong và ví đã chạm 0:** AI của tổ chức trả `402 insufficient_credit` theo luồng bình thường (§8.1); thông báo `ai_credit.depleted` đi theo webhook của Hub (§7) như mọi lần hết credit.

### 16.9 Sự kiện, audit, thông báo

**Bảy topic mới** (ADR 0009: `<entity>.<verb>`, payload chỉ id; hằng audit và dòng catalogue thêm ở **`AIP-BILL-02`**, đi trước các thẻ phát chúng, như `AIP-10`):

| Topic | v | Payload | Phạm vi | Giao | Phát bởi (cùng tx với audit) | Nghe bởi |
|---|---|---|---|---|---|---|
| `ai_credit.sync_requested` | 1 | `organization_id`, `order_id` | `-` | outbox | `createOrderTx`, `EnsurePeriodGrants`, cộng tay | `AICreditSyncConsumer` (**LaneSlow**) |
| `ai_credit.reversal_requested` | 1 | `organization_id`, `reversal_id` | `-` | outbox | `requestReversalTx` | `AICreditSyncConsumer` |
| `ai_credit.granted` | 1 | `organization_id`, `order_id` | organization | outbox | consumer sau khi Hub nhận | realtime làm mới `aiCreditKeys` + quy tắc thông báo |
| `ai_credit.reversed` | 1 | `organization_id`, `reversal_id` | organization | outbox | consumer sau khi Hub nhận | realtime làm mới (không có thông báo riêng, xem dưới) |
| `invoice.paid` | 1 | `organization_id`, `invoice_id` | `-` | outbox | `applyProviderEvent` sau `InsertInvoice` (`billing_provider_event.go:225-238`), cùng tx; chỉ hóa đơn `kind='subscription'` | quy tắc thông báo `billing_renewed` (lane notify) |
| `payment_intent.failed` | 1 | `organization_id`, `intent_id` | `-` | outbox | `Recorder.Record` (**không** `Emit`: intent chuyển sang `failed` là thay đổi nghiệp vụ, mà `Emit` chỉ cho topic hạ tầng không có lệnh nghiệp vụ, `audit.go:303-306`) với action `billing.payment_intent_failed`, cùng tx với `MarkBillingPaymentIntentFailed`, và **chỉ khi** UPDATE đổi đúng một dòng (hôm nay query là `:exec` và kết quả bị bỏ `_ =`: `billing.sql:211-213`, `billing_provider_event.go:148-155`; đổi sang trả số dòng — IPN lặp không phát lần hai vì `WHERE status IN ('pending','expired')` không khớp intent đã `failed`). Điểm phát: IPN không thành công hoặc sai số tiền/tiền tệ (`billing_provider_event.go:148-155`, `:167-178`) và `reconcileOneStalePaymentIntent` khi QueryDR báo chưa trả (`billing_intent_reconcile.go:47-51`); **không** phát ở lỗi tạo phiên của `Checkout` (`billing_checkout.go:134`: chưa có tiền nào di chuyển, khách thấy lỗi ngay trong ngăn, h9) | quy tắc thông báo `billing_payment_failed` |
| `invoice.refunded` | 1 | `organization_id`, `invoice_id` | `-` | outbox | ba chỗ hoàn thành công (§16.8), cùng tx | quy tắc thông báo `billing_refunded` |

Năm topic hạ tầng (phạm vi `-`) chỉ vào `CATALOGUE.md` và `catalogue.go`, **không** vào `events.ts` (cùng lý do `ai_quota.sync_requested`, §6.1: `scripts/events-catalogue.test.mjs` đòi danh sách client bằng đúng các dòng có `scope !== "-"`); hai topic cấp tổ chức vào đủ ba nơi và `TestIsolationRealtime` kiểm chúng. Con số (số tiền, còn lại) **không** ở payload: client đọc lại qua API. Hai topic đẩy chia riêng để consumer phân biệt đường grant/thu hồi mà vẫn một lane chậm. Ba topic `invoice.*`/`payment_intent.failed` **không riêng của AI** (billing hôm nay chưa phát sự kiện nào cho thanh toán: chỉ có `subscription.changed` theo người, không mang loại thay đổi, `billing.go:262-283`, `outbox/catalogue.go:319`): chúng được thêm vì baseline đòi thông báo gia hạn/thất bại/hoàn tiền, và chạy ở lane thông báo (không gọi bên thứ ba), nên không làm chậm IPN.

**Audit** (hằng ở `server/internal/audit/actions.go` — `AIP-BILL-02`; phủ `audit_coverage_test.go` do thẻ sở hữu lệnh, §6.2):

| Action | Lệnh sở hữu / thẻ | Phủ |
|---|---|---|
| `ai.credit.ordered` | `createOrderTx` qua `ApplyProviderEvent` (BILL-03), `EnsurePeriodGrants` (BILL-05), checkout nạp (BILL-06), cộng tay (BILL-08) | closure `cases` chạy lệnh thật (IPN thật, sweep, v.v.) |
| `ai.credit.granted`, `ai.credit.grant_failed` | `AICreditSyncConsumer` (BILL-04) | `actionsWithoutCommands`: "covered by ai_credit_sync_test.go" |
| `ai.credit.reversal_requested` | `requestReversalTx` (BILL-07) | closure chạy ba đường hoàn thật |
| `ai.credit.reversed`, `ai.credit.reversal_failed` | consumer (BILL-07) | `actionsWithoutCommands`: "covered by ai_credit_sync_test.go" |
| `ai.credit.admin_granted` | cộng tay (BILL-08) | closure chạy `POST /admin/organizations/{orgID}/ai-credit` |
| `ai.hub.plan_set` | `EnsureAccount` đặt plan (BILL-05) | closure chạy `EnsureAccount` thật với Hub giả |
| `billing.payment_intent_failed` | `applyProviderEvent` (nhánh thất bại/sai tiền) và `reconcileOneStalePaymentIntent` (BILL-10; hằng ở BILL-02) | closure chạy IPN thất bại thật và đối soát QueryDR; intent đã `failed` + IPN lặp không thêm dòng audit/outbox |

Người thực hiện: IPN/consumer/sweep là `audit.System("billing")` hoặc `audit.System("ai_credit")`, hỗ trợ là `audit.User(adminID)`; mọi dòng audit đều mang `correlation_id` (`middleware.Correlation`). Cộng tay còn ghi `admin_actions` (§16.11).

**Thông báo** (`server/internal/notification`, cùng khuôn §6.4; `AIP-BILL-10`). Bốn kind theo baseline của lead (board j được vẽ theo đó, j1–j6); mã/Hub không mâu thuẫn, nhưng ba kind sau **là billing nói chung chứ không riêng AI**, và hôm nay UniWork chưa có kind hay thư billing nào (`server/internal/mail/templates` không có mẫu billing):

| Kind | Khi nào | Nguồn | Nội dung (dựng ở server từ dòng, đọc theo id) |
|---|---|---|---|
| `billing_credit_added` | credit nạp hoặc cộng tay vào ví | `ai_credit.granted` của đơn `topup`, `admin_adjust` | "Đã nạp US$ x credit AI" |
| `billing_renewed` | một kỳ trả phí mới bắt đầu (mua mới, nâng gói hoặc gia hạn) | `invoice.paid` | "Đã thanh toán gói X, kỳ đến dd/mm" (kèm số hóa đơn; credit của kỳ nằm trong khối ví, không lặp thành thông báo thứ hai) |
| `billing_payment_failed` | VNPay báo không thành công hoặc sai số tiền (gói **hoặc** gói nạp) | `payment_intent.failed` | "Thanh toán chưa thành công" + liên kết thử lại; không bao giờ gửi cho intent hết hạn do hệ thống (`ExpirePending…`) |
| `billing_refunded` | hoàn tiền (một phần hoặc toàn bộ) đã xác nhận thành công | `invoice.refunded` | "Đã hoàn tiền hóa đơn #… (số tiền VND)"; nếu hóa đơn có credit: "Credit chưa dùng của hóa đơn sẽ được điều chỉnh" — **không** nêu số US$ vì thu hồi chạy sau (§16.8); kết quả thu hồi hiện ở lịch sử (board i), qua `ai_credit.reversed` làm mới |

- **Người nhận: chỉ owner tổ chức** (người trả tiền; một owner mỗi lúc, `idx_org_members_single_owner`), **không** admin tổ chức và **không** admin workspace. Dòng cấp tổ chức, không có workspace, hiện ở mọi workspace của owner (FE-36, §6.4).
- **Kênh: Hộp việc + email giao dịch** (tiền lệ `ai_quota_alert`, Q-AIP-7: thư giao dịch không đi qua digest); mẫu mới `billing_credit_added`, `billing_renewed`, `billing_payment_failed`, `billing_refunded` × `vi/en` × `html/txt` trong `server/internal/mail/templates` (`AIP-BILL-10`). Bốn kind **loại khỏi digest ngày** và `Prefs.Email` của chúng nghĩa là "nhận thư giao dịch" (cùng sửa như BE-26, §6.4); nhóm mới "Thanh toán" trong ma trận Thông báo, hai cột Hộp việc | Email bằng `Switch`, chỉ hiện ở góc nhìn owner (board j, khung j2).
- **Không thông báo** cho đơn do sweep tạo (tháng miễn phí, bù kỳ) và không có thông báo riêng cho kết quả thu hồi; tránh một dòng mỗi tháng cho mọi tổ chức.

### 16.10 API, kiểu dữ liệu, cô lập

**Nơi đặt mã và quy tắc kiến trúc.**

- Client Hub (`Grant`, `ListGrants`, `Revoke`, `PutAccountPlan`) nằm trong `server/internal/aihub` (`AIP-BILL-01`). Chỉ `internal/service` được import gói này; `internal/ai` **không** import nó và **không** chứa logic billing (quy tắc `TestAIPackageOnlyCallsAiQueries`, `TestAIPackageHasNoHubOrServiceImport`, `CLAUDE.md` › Audit and Events). `AICreditService` ở `server/internal/service/ai_credit*.go`; query là `AiCredit*` trong `server/pkg/db/queries/ai_credit.sql`.
- **`TestAIHubClientAlwaysScopesToLinkedAccount`** (`AIP-01`) mở rộng cho `Grant/Revoke/PutAccountPlan`: mọi lệnh nhận `organizationID` từ dòng `ai_hub_accounts` của tổ chức đó, không bao giờ từ input người dùng (cùng khuôn nhãn tenant của §5.3).
- Các query billing hiện có bị khóa theo tệp bởi `arch_test.go:212-232` (chỉ `billing.go`, `billing_catalog.go`, `billing_*.go` được gọi): query mới của nhánh gói nạp (`GetPendingBillingPaymentIntentForPack`, bản đổi của `ExpirePendingBillingPaymentIntents`) **thêm vào regex ở `arch_test.go:212`** và chỉ được gọi từ `billing_*.go`; `AICreditService` đạt đơn qua `createOrderTx` (gọi **từ** `billing_provider_event.go`, nơi tính `amount_micro`/`expires_at` và truyền vào `in`: BE-B8) chứ không gọi query billing. Hai việc cần query plan/subscription/hóa đơn nằm **dưới tiền tố `billing_`** của allowlist `arch_test.go:211-232` (`strings.Contains(slash, "internal/service/billing_")`): sweep `EnsurePeriodGrants` ở `billing_ai_credit_period.go` (liệt kê subscription sống và đọc `ai.credit_micro`; tên query liệt kê mới và query hóa đơn-theo-kỳ thêm vào regex `arch_test.go:212` cùng thẻ) và reconcile đơn nạp thiếu ở `billing_ai_credit_pack.go`; `ai_credit*.go` chỉ gọi query `AiCredit*`.
- Console: `service/admin_ai_credit.go` thêm vào danh sách cho phép của `TestAdminQueriesStayInAdminService` (`arch_test.go:325`) vì gọi `InsertAdminAction` của `admin.sql` qua `recordAdmin` (`service/admin.go:419`).

**Route mới** (router `server/internal/handler/router/billing.go`, `admin.go`; SDI/SDO ở `handler/dto/{sdi,sdo}/` có `description`/`example`, theo `docs/api-sdi-sdo.md`; `{orgID}` đã có `pathParamSDI`, không cần case mới):

| Route | Ai | Việc |
|---|---|---|
| `GET /api/v1/orgs/{orgID}/billing/ai-credit` | owner/admin tổ chức (`canViewBilling`) | `available` (= `ai_hub_routing && ai_billing_sync` **theo tổ chức**, không `UserID`, §10), ví (C2, cache RAM `singleflight` 30 giây, §5.5), credit kỳ này (`granted_micro`, `expires_at`), gói nạp, 20 đơn gần nhất, giao dịch nạp đang chờ; `available=false` → phần còn lại rỗng (board g7) |
| `POST /api/v1/orgs/{orgID}/billing/ai-credit/checkout` | owner (`requireOwner`) | thân `{pack_code, success_path, cancel_path}`; `success_path`/`cancel_path` qua `ValidateCheckoutPath` (`billing_checkout.go:21`) như checkout gói; trả phiên VNPay như `CreateCheckout` |
| `GET /api/v1/admin/organizations/{orgID}/ai-credit` | `support` đọc | ví, đơn, thu hồi, với `granted/remaining/spent` mỗi đơn (§16.8) |
| `POST /api/v1/admin/organizations/{orgID}/ai-credit` | `admin` ghi | cộng tay (§16.11) |

**`decode()` và giới hạn thân.** Thân của hai `POST` đi qua `decode(w, r, &in, limit)` (`handler/json.go`, `maxJSONBody` 1 MiB); handler không truy vấn DB và để service quyết khả năng nhìn thấy (`authorize()`/`RequireMember` → 403/404, `mapServiceError`).

**Client.** `packages/core/api/endpoints/billing.ts` thêm hai hàm (đọc credit, tạo checkout nạp), mỗi hàm qua `parseWithFallback(raw, schema, fallback, { endpoint })` với **schema khoan dung** (`status`, `kind`, `failed_kind` là `z.string()`; mọi số có mặc định 0; kiểu export thu hẹp) và một ca **malformed-response** trong `billing.test.ts` chứng minh suy giảm thay vì ném lỗi; hook `useAiCredit(orgId)` (khóa `aiCreditKeys` có `orgId`; hook cần workspace nhận `wsId`) và `useAiCreditReturn` (khuôn `packages/core/billing/use-checkout-return.ts`: đọc `?checkout=…&credit=1`, **không tin** tham số này làm bằng chứng — sự thật là IPN → đơn; hook thăm dò `GET …/ai-credit` mỗi 3 giây tối đa 90 giây rồi hiện h3b (đơn nạp vẫn `pending`) hoặc, khi intent đã `completed` mà credit chưa vào, h5 và sau 10 phút h6). Sự kiện `ai_credit.granted/reversed` làm mới khóa qua `use-realtime-sync.ts`; không ghi payload vào store. Mỗi `switch` trên enum máy chủ có `default`; UI optional-chain trường máy chủ. Mọi text qua `t()`; icon theo `docs/conventions.md` › Icons; đang tải là `<Spinner />`.

**Cô lập tenant.**

- `TestIsolationMatrix`: hai route tenant ở trên đi qua `isoRoutes` (route có `{orgID}` tự được phủ ngày đăng ký; kiểm có đối chứng — owner của chính tổ chức đọc/ghi qua cùng route không bị từ chối); hai route `/admin/…` là `isoPlatform` kèm lý do. Hàng của tổ chức A trong `ai_credit_orders` và `ai_credit_reversals` được gieo ở `AIP-BILL-02` và hash không đổi trước/sau khi B tấn công; `ai_credit_packs` miễn qua `tenantExemptTables` (catalog toàn cục).
- Trường thân kết thúc `_id`/`_ids` đòi `isoReferences` hoặc miễn kèm lý do (`TestEveryBodyIDFieldHasAReferenceCase`): thân của `POST …/checkout` dùng `pack_code` (mã, không phải id tenant) nên không có trường như vậy; thân cộng tay có `client_ref` (chuỗi của quản trị viên), cũng không.
- Câu hỏi riêng của billing: owner của B gửi `pack_code` đúng nhưng đến `{orgID}` của A → 403/404 từ `requireOwner`, không rò dữ liệu; đơn/ví của A không xuất hiện trong phản hồi của B.
- `TestIsolationRealtime`: B không nhận `ai_credit.granted/reversed` của A.
- Người bị vô hiệu hóa và tổ chức bị khóa bị cả hai cổng từ chối trước mọi vai trò (§2); `403 organization_suspended` áp cho cả ví và checkout nạp.

### 16.11 Console `/admin` — cộng credit tay

Cho nhân viên nền tảng (không UI cấp vai trò; `users.platform_role` chỉ do `server/cmd/uniwork-admin` cấp, `CLAUDE.md` › Platform Admin).

- `GET /api/v1/admin/organizations/{orgID}/ai-credit` (`support` đọc) và `POST` cùng đường (`admin` ghi) bảo vệ **chỉ bằng** `middleware.RequirePlatformRole`; không bao giờ đi qua `RequireMember`, không bao giờ trả nội dung tổ chức (chỉ số tiền, trạng thái, id).
- **Ghi:** thân `{amount_micro, expires_at?, reason, client_ref}`; `reason ≥ 10` ký tự; `amount_micro > 0` và không quá `AI_CREDIT_ADMIN_GRANT_MAX_MICRO` (env mới, vào `.env.example`; giá trị do chủ sản phẩm đặt; **chưa đặt = từ chối mọi ghi** — fail closed, ghi chú cạnh biến trong `.env.example`, BE-B15); tổ chức phải đã có account Hub (cộng tay **không** phụ thuộc `ai_billing_sync`: đây là đường nạp tay của pilot R2/R3, §10). Một transaction: chèn `ai_credit_orders` (`kind='admin_adjust'`, `source='adjust'`, `source_ref='uw-adj-<order_id>'`, `client_ref`), ghi `admin_actions` + `audit_events` (cùng trace id, `ai.credit.admin_granted`) và outbox `ai_credit.sync_requested`. `client_ref` trùng trong cùng tổ chức với **cùng thân** (`amount_micro`, `expires_at`, `reason`) → trả đơn cũ (bấm đúp không cấp hai lần); **khác thân → `409`**, không đổi đơn cũ và không âm thầm bỏ yêu cầu thứ hai (BE-B15).
- **Không có nút thu hồi tay hay "thử lại" ở v1** (§12 (g)): thu hồi ngoài luồng hoàn tiền do hub_admin ở Hub Console; đơn `failed/config` tự thử lại (§16.7).
- Khối "Credit AI" ở chi tiết tổ chức (board j, khung j10): ví, đơn (`failed` nổi bật), thu hồi, và số "đã cấp/còn/đã dùng" cho hộp thoại hoàn tiền (j5, §16.8).

### 16.12 Cờ và rollout

Cờ `ai_billing_sync` ở §10. Phép tính hiệu lực **theo tổ chức**, không `UserID`, cùng hàm `available` dùng chung với §5.9/§10:

| Thao tác | Điều kiện |
|---|---|
| Tạo đơn `plan_period` từ IPN; sweep `EnsurePeriodGrants`; **bán** gói nạp (checkout); đặt plan Hub (`PUT plan`, BE-B12); hiện khối credit ở tab Billing | `ai_hub_routing && ai_billing_sync` |
| Tạo đơn `topup` khi IPN của intent `ai_credit_pack` tới; reconcile bù đơn nạp thiếu; `EnsureAccount` cho lần đẩy của đơn đó | **không phụ thuộc cờ** (intent `completed` là bằng chứng bán hàng; sau đó không còn đường nào khác tạo đơn, BE-B3) |
| Đẩy grant/thu hồi **đã có** trong DB; reconcile | **không phụ thuộc cờ** (không bỏ rơi tiền đã nhận) |
| Cộng tay `/admin` | tổ chức đã có account Hub |
| Hóa đơn, IPN, gia hạn, hoàn tiền VNPay | không phụ thuộc cờ hay Hub |
| Tạo thu hồi khi hoàn tiền | khi **có đơn credit** cho hóa đơn đó, kể cả cờ đã tắt sau đó |

**Giai đoạn** (đã ở §10): R2 hub_admin nạp tay; **R2b** bật `ai_billing_sync` cho tổ chức nội bộ trên VNPay sandbox — mua gói nạp, gia hạn, hoàn tiền; **R3** pilot; **R4** mặc định bật khi `AIP-BILL-*` đã chạy ≥ 1 chu kỳ đầy đủ (mua → dùng → kỳ mới → hoàn thử) và 7 ngày không có `AICreditOrderStuck`. Hoàn tác = tắt `ai_billing_sync` (ngừng tạo đơn mới, đơn cũ vẫn đẩy tiếp).

**Việc vận hành trước R1:** hub_admin tạo Hub plan có price book cho app `uniwork`, `credit_limit_micro = 0`, ghi id vào `AI_HUB_PLAN_ID`; chủ sản phẩm đặt `ai.credit_micro` theo gói (Q-AIP-11) và gói nạp (Q-AIP-12) — **R2b không qua nếu hai thứ này chưa có số**.

**Env mới** (cả hai vào `.env.example`, `scripts/env-example.test.mjs`): `AI_HUB_PLAN_ID`, `AI_CREDIT_ADMIN_GRANT_MAX_MICRO` (chưa đặt = từ chối mọi cộng tay). Cảnh báo `AICreditOrderStuck` + runbook 4 mục (`deploy/alerts.yml`, `docs/runbooks/`, `scripts/alerts-runbooks.test.mjs`) thuộc `AIP-BILL-04`.

### 16.13 Giả định billing cần kiểm với Hub thật

Đã đưa vào §13.3 (5)–(9) và thẻ `AIP-BILL-01`, `-04`, `-07`; bổ sung:

(10) Một grant có `expires_at` ở **quá khứ** bị Hub từ chối hay vẫn tạo (đã tránh bằng bước 3 của §16.7: UniWork không bao giờ gửi grant đã hết hạn); (11) `GET /admin/v1/grants?account=` trả `remaining_micro` đúng sau khi `ExpireGrants` zero phần còn lại (cơ sở của §16.8 bước 2; kiểm cùng giả định (8)); (12) app credential của UniWork được phép `POST /admin/v1/grants` và `PUT …/plan` cho account của chính nó và bị `403` cho account khác (`hub:internal/admin/perm.go:31`, `grants.go:131-143`; kiểm bằng e2e ở R1/R2b, cùng với (9): `credit_limit_micro = 0`); (13) giá trị `ai.credit_micro` đi qua `effective()` đúng như số nguyên của một feature (không phải cờ/boolean) — kiểm bằng test của `AIP-BILL-02`; (14) `ApplyPaidSubscriptionFromProvider` và `InsertInvoice` chịu cột `kind` mới mà không đổi hành vi cho dữ liệu cũ (mặc định `subscription`) — kiểm bằng migration test và `billing_*_test.go` hiện có trước khi bán gói nạp.

---

## Lịch sử phiên bản

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| v0.5.1 | 2026-10-18 | **Sửa theo review BE billing vòng 1 (`reports/ai-plan-uw/review-bill-be-r1.md`, BE-B1…B16) và căn §11 g–j theo khung đã vẽ.** Tiền: thu hồi **phát lại đúng khóa/số/lý do đã ghi**, không tính lại (BE-B1, §16.8); hai `409` của Hub cùng `code:"conflict"`, phân loại theo `remaining_micro`, thêm H-11 (BE-B2); IPN gói nạp luôn tạo đơn `topup` bất kể cờ + reconcile bù đơn thiếu (BE-B3, §16.7, §16.12); `ai.credit_micro` đọc từ dòng `after`, `Limit` không nil và `> 0`, không bao giờ làm hỏng thanh toán (BE-B4); đơn IPN mang `subscription_id` + `period_start` (BE-B5); predicate claim = reconcile = bộ thử lại duy nhất, `conflict`/`expired` không claim (BE-B6); phân loại xuất/xóa tổ chức cho năm bảng (BE-B7); `createOrderTx` nhận số từ caller, sweep ở `billing_ai_credit_period.go` (BE-B8); `payment_intent.failed` qua `Record` + action `billing.payment_intent_failed`, chỉ khi UPDATE đổi một dòng (BE-B9); `GET grants` gửi `limit=200` (BE-B10); sweep gắn hóa đơn kỳ đã trả (BE-B11); `PUT plan` chỉ khi `ai_billing_sync` (BE-B12); hoàn lần hai ghi là phòng thủ (BE-B13); §15.2 thêm 8 dòng, sửa 6 dòng (BE-B14); cộng tay: cùng `client_ref` khác thân → `409`, env chưa đặt = từ chối (BE-B15); nit: "luôn" → "tại lúc tạo", dải thẻ `00…15`, `Q-AIP-11…20`, ba trích dẫn, tích `int64` → `numeric` (BE-B16). Thêm cột `credit_micro` cho `billing_payment_intents` (§16.5: spec nói chụp lúc tạo intent nhưng chưa có cột). §11: bỏ bảng "lịch sử nạp" khỏi g và danh sách view (đơn nạp hiện trong Hóa đơn); trạng thái g–j đổi sang id khung của board (49 khung); FE-B24 (huy hiệu "Đã hoàn một phần" là nhãn giao diện suy ra từ `amount_refunded > 0`, trạng thái hóa đơn vẫn `paid`); FE-B25 (`needs_support` của thu hồi giữ nguyên trong spec, khung i6b chờ vẽ). Không đổi số mục §1–§16. |
| v0.5 | 2026-10-18 | **Billing (Q-AIP-1 = (c)).** Thêm §16 Thanh toán AI (nguyên tắc, billing hôm nay, hợp đồng Hub đã kiểm, ánh xạ gói → Hub, dữ liệu, luồng mua/nạp/gia hạn/đổi gói/reset, lỗi và đối soát, hoàn tiền và thu hồi, sự kiện/audit/thông báo, API và cô lập, console `/admin`, cờ và rollout, giả định); cập nhật §1.4, §2 (ba hàng quyền), §4 C9, §10 (cờ `ai_billing_sync`, R2b, R4), §11 (board g–j), §12 (billing vào phạm vi, phần còn ngoài), §13 (Q-AIP-1…10 và D-1…7 đã quyết; Q-AIP-11…20 mới; H-9, H-10; giả định (5)–(9)), §14 (`AIP-BILL-00…15`, thứ tự, rủi ro (6)–(8)), §15.2 (truy vết AC-1 cho billing). Không đổi số mục §1–§15. **Theo "Shared billing terms baseline" của lead:** bốn kind thông báo billing chỉ cho owner (Hộp việc + thư giao dịch), Q-AIP-17 (credit nạp 12 tháng, thay "không hết hạn"), Q-AIP-18 (tiêu credit kỳ trước, nạp sau), Q-AIP-19 (gói nạp chỉ cho gói trả phí), Q-AIP-20 (hạ gói lên lịch, thẻ `AIP-BILL-15`); Q-AIP-13 (không rollover) giữ nguyên. |
| v0.4 | 2026-10-18 | Vòng 1 (quản lý hạn mức): sửa theo review BE vòng 3 (commit `627bae666`); §1–§15 gồm board a–f, H-1…H-8, thẻ `AIP-00…15` và `AIP-F`; lịch sử vòng 1 ở `reports/ai-plan-uw/PACKET.md`. |
