# Quản lý gói AI và hạn mức trên UniWork (qua UniAI Hub v0.2.0)

> **Trạng thái:** draft — v0.2 (2026-10-18, UNI-1910, lane ai-plan-uw; v0.1 + sửa theo review BE/FE vòng 1), chưa có dòng code nào; chờ người dùng duyệt §13 (Q-AIP-1…10, D-1…D-7) và các board thiết kế (§11).

**Quan hệ:** [ADR 0010](../../adr/0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md) (mọi call qua `ai.Gateway`), [0029](../../adr/0029-ai-cua-office-tren-web-qua-ai-gateway.md) + [0034](../../adr/0034-desktop-dung-khoa-luu-tren-uniwork-qua-proxy-byok.md) (BYOK), [0008](../../adr/0008-cach-ly-tenant-o-tang-service.md), [0009](../../adr/0009-audit-va-outbox-cung-transaction.md), [0012](../../adr/0012-audit-bat-bien-bang-quyen-db-va-trigger.md), [0015](../../adr/0015-va-cache-tu-frame-realtime-theo-catalogue.md), [0031](../../adr/0031-uniwork-la-oauth-server-cho-client-ai-ben-ngoai.md), [0033](../../adr/0033-tool-ghi-qua-mcp-chay-truc-tiep-bang-actor-human.md).
**Nguồn phía Hub** (repo `llm-system`, đọc ở working tree 2026-10-18; trích dẫn dạng `hub:<đường dẫn>:<dòng>`): `docs/SPEC.md` (final, cập nhật S-P2), `docs/connect.md`, `docs/plans/2026-10-17-p2-plan.md` mục "Phía UniWork" (dòng 198–211), mã `internal/admin`, `internal/usage`, `internal/surface`, `internal/webhook`, `internal/admission`, `internal/auth`, `internal/httpx`.
**Nguồn thiết kế:** card `briefs/card-AI-PLAN-UW.md`; board HTML ở `reports/ai-plan-uw/design/` (§11).
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

Gồm: cấu hình hạn mức và model list theo tổ chức/workspace/người dùng; xem ví và mức dùng; chặn và cảnh báo; nối Office AI + Ask UNI + các capability khác qua Hub; webhook; cô lập tenant; cờ và rollout. **Không gồm** (§12): mua gói → `grant`, hoàn tiền → `revoke`, đặt plan Hub (đây là việc của billing, thẻ `AIP-BILL` riêng), P3/P4 của Hub.

---

## 2. Tác nhân và quyền

UniWork có hai tầng thành viên; mỗi quy tắc dưới đây nêu `PermissionContext{orgRole, wsRole}` (`packages/core/permissions/types.ts:10-25`) và cổng Go nó phản chiếu. Chỉ `OrganizationService.RequireMember` (`server/internal/service/organization.go:135-166`) và `WorkspaceService.RequireMember` (`service/workspace.go:243-277`, org owner/admin là admin ngầm của workspace) quyết định thành viên; `arch_test.go` cấm nơi khác gọi query thành viên. Người bị vô hiệu hóa (`member_deactivated`) và tổ chức bị khóa (`organization_suspended`) bị cả hai cổng từ chối trước mọi vai trò.

| Hành động | Ai | `PermissionContext` (quy tắc TS mới trong `rules.ts`) | Cổng Go |
|---|---|---|---|
| Xem "Gói AI": ví, kỳ, tổng dùng, bảng workspace/người dùng, cảnh báo | owner/admin **tổ chức** | `canViewAiPlan`: `orgRole ∈ {owner, admin}` (cùng khuôn `canViewBilling`, `rules.ts:126-131`) | `OrganizationService.RequireMember` + `adminLikeRole` (`workspace.go:717`) |
| Đặt, đổi, xóa hạn mức và model list của tổ chức / một workspace / một người dùng | owner/admin tổ chức | `canManageAiQuota`: cùng điều kiện `canViewAiPlan` | như trên; workspace đích đi qua `WorkspaceService.RequireMember(ws, actor)` (trả vai trò hiệu lực `admin` cho org owner/admin, và từ chối workspace của tổ chức khác); người dùng đích đi qua `OrganizationService.RequireMember(org, target)` |
| Xem hạn mức và mức dùng của workspace mình | owner/admin **workspace** (gồm org owner/admin ngầm) | `canViewWorkspaceAiQuota`: `wsRole ∈ {owner, admin}` (khuôn `canUpdateWorkspaceSettings`, `rules.ts:97-102`) | `WorkspaceService.RequireMember` + `adminLikeRole(m.Role)` (khuôn `WorkspaceUsage`, `askuni.go:377-390`) |
| Xem trạng thái của chính mình (còn dùng được / sắp hết / hết hạn mức, model đang dùng) | mọi thành viên workspace | `wsRole !== null` | `WorkspaceService.RequireMember`; mở rộng `GET /workspaces/{workspaceID}/ai/capabilities` (`askuni.go:126`) |
| Mua/đổi gói, nạp credit, hoàn tiền | owner tổ chức | `canManageBilling` (`rules.ts:138-143`) | `BillingService.requireOwner` (`billing.go:112`) — **ngoài phạm vi** |
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

Account mới **chưa có plan** và gọi AI nhận `402 insufficient_credit` (`hub:docs/connect.md:627`). Việc đặt plan và nạp credit thuộc `AIP-BILL`; ở pilot hub_admin nạp tay.

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
| Cache | RAM 60 giây theo `(org, workspace, user)`, làm mới khi có `ai_quota.updated` / webhook cùng tổ chức (§5.5). Hub cũng cache policy 5 giây |
| Danh mục cho form sửa hạn mức | gọi với `user=_catalog`, `feature=settings` (giá trị tổng hợp không khớp policy nào) để thấy model mà **gói** cho phép. *Giả định* cần một test với Hub thật (H-6) |

### C7. Lệnh gọi suy luận (qua `ai.Gateway`, không qua service)

`POST /v1/chat/completions` (Complete), `POST /v1/embeddings` (Embed), `POST /v1/images/generations`, `POST /v1/audio/transcriptions` (`hub:internal/surface/surface.go:50-59`). Header: `X-Hub-External-Account`, các nhãn ở C6, `X-Hub-Request-Id` (bắt buộc, ≤ 200 ký tự: `surface.go:99-103`). Response (chỉ khi Hub đã nhận) có `X-Hub-Request-Id`, và không stream có `X-Hub-Cost`, `X-Hub-Usage-Source` (`hub:docs/SPEC.md:462-466`). Id: §5.4. Lỗi: §8.

### C8. Webhook endpoint (một lần, do vận hành)

`POST /admin/v1/webhooks` body `{app_id?, url, events[], allow_private_network}` → `201 {id, app_id, url, events, allow_private_network, status, created_at, updated_at, secret}`; `secret` (`whsec_…`) chỉ trả **một lần** (`hub:internal/admin/webhooks.go:28-52`, `:151-212`). `events` ⊂ `{policy.threshold, credit.low, credit.depleted}`, rỗng = cả ba (`hub:internal/webhook/events.go:6-41`). URL nội bộ cần `allow_private_network=true`, mà cờ này **chỉ `hub_admin`** đặt (app → 403: `webhooks.go:167-170`), và Hub không ở mạng công cộng (`hub:docs/connect.md:456`) → **hub_admin đăng ký**, đưa secret cho UniWork qua kênh bí mật (env, §7). UniWork không gọi route này lúc chạy; sức khỏe kiểm bằng `GET /admin/v1/webhooks/{id}/deliveries` → `{pending, delivered, failed, last_attempt_at, last_error_code, last_status_code}` (`webhooks.go:54-61`, `:306-334`) trong runbook, không thành màn hình người dùng.

### C9. Các lệnh gọi Hub **không** thuộc spec này (tham chiếu)

`POST /admin/v1/grants` (idempotent theo `idempotency_key`, body `grantWrite`: `hub:internal/admin/grants.go:27-36`), `POST /admin/v1/grants/{id}/revoke` (`:38-42`), `PUT /admin/v1/accounts/{id}/plan` (app chỉ đặt plan có price book cho channel mình, nếu không 403: `plans.go:449-500`), thuộc `AIP-BILL`.

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

**Làm mất hiệu lực trên mọi instance**: frame realtime đi tới trình duyệt, không tới các node server, nên không dùng được cho việc này. Đăng ký một **consumer outbox trong tiến trình trên mọi node** nghe `ai_quota.updated`, `ai_quota.threshold_reached`, `ai_credit.ran_low`, `ai_credit.depleted` và xóa mọi khóa của `organization_id` trong payload — đúng khuôn `featureflags.Invalidator` (`server/internal/featureflags/db_provider.go:123-134`, đăng ký ở `server/cmd/server/main.go:525`). Giữa hai lần xóa, TTL 60 giây vẫn là chặn trên của độ cũ.

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

| Action | Khi nào | Actor | Cách phủ trong `audit_coverage_test.go` |
|---|---|---|---|
| `ai.quota.saved` | tạo/sửa hạn mức (Changes = `audit.Diff` trước/sau) | `audit.User` | có trong `auditCommands` (chạy lệnh thật) |
| `ai.quota.cleared` | xóa hạn mức | `audit.User` | có trong `auditCommands` |
| `ai.hub.account_linked` | tạo/phục hồi liên kết account | `audit.User` hoặc `audit.System("ai.hub.bootstrap")` | có trong `auditCommands` |
| `ai.quota.threshold_reached`, `ai.credit.ran_low`, `ai.credit.depleted` | nhận webhook | `audit.System("ai.hub.webhook")` | vào `actionsWithoutCommands` với lý do "covered by ai_hub_webhook_test.go" (khuôn `ActionMcp*`, `audit_coverage_test.go:36-60`) |
| `ai.quota.sync_overrode_hub` | consumer ghi đè phiên bản Hub cao hơn (§6.3) | `audit.System("ai.hub.sync")` | `actionsWithoutCommands` ("covered by ai_hub_sync_test.go") |

Bằng chứng audit không bao giờ chứa token Hub hay secret webhook (`scripts/no-pii-log.test.mjs` cho log; Changes chỉ có trường cấu hình).

### 6.3 Consumer đồng bộ sang Hub

`HubPolicySyncConsumer` (LaneSlow, khuôn `outbox.WebhookConsumer`): đọc dòng `ai_quota_policies` theo `policy_id`, bỏ qua nếu `revision == synced_revision`, `PUT /admin/v1/policies` (C3) với `version=revision`:

**Hai chốt chống đua** (một người lưu tiếp khi lệnh PUT đang bay): `revision` là bộ đếm của UniWork, nên mọi ghi lại dòng đều có điều kiện theo đúng `revision` đã gửi (`sent`).

- `200` → `UPDATE … SET hub_policy_id=$, synced_revision=$sent, sync_state='synced' WHERE id=$ AND revision=$sent`. Nếu dòng đã sang `revision > sent` (có lần lưu mới trong lúc bay) thì **không** đánh dấu `synced`: để `sync_state='pending'` — `ai_quota.sync_requested` của lần lưu mới đã nằm trong outbox và sẽ đẩy bản mới.
- `409 conflict` → (a) đọc lại dòng `FOR UPDATE`; nếu `row.revision != sent` thì **bỏ** (lần lưu mới có consumer riêng) — không ghi `revision` lùi hay đè cấu hình mới hơn; (b) `GET /admin/v1/policies?account=` (C4) tìm policy cùng chủ thể; nếu `hub.version ≥ sent` thì ai đó (hub_admin qua Console) đã sửa bên Hub: **UniWork thắng** — đặt `revision = hub.version + 1` trong cùng tx với audit `ai.quota.sync_overrode_hub`, rồi PUT lại bằng snapshot đọc `FOR UPDATE` đó; (c) nếu Hub đã đúng nội dung (retry của cùng body) thì coi là `synced` theo cùng điều kiện `revision = sent`.
- `401`/`403` (credential app sai, thu hồi, hoặc nhãn/app không được phép) → `sync_state='failed'` ngay + cảnh báo vận hành (`ai_hub_misconfigured`, §8.1), **không** thử lại (lặp lại chỉ chờ tới dead-letter).
- `429` → thử lại, tôn trọng `Retry-After` (`hub:internal/httpx/httpx.go:69-73`) qua lịch thử lại của dispatcher; không tính là `failed`.
- Mạng/5xx → để dispatcher thử lại và chuyển dead-letter theo luật outbox (`docs/ops/RUNBOOK_OUTBOX.md`); dead-letter → `sync_state=failed` + chỉ báo trên màn hình Gói AI ("Chưa đồng bộ — đang thử lại") + metric.
- `404` (account chưa link) → chạy `EnsureAccount` (C1) rồi thử lại.
- `400` (nhãn chưa khai báo / model lạ) → `failed` với `sync_error_code`, không thử lại vô ích; cảnh báo vận hành (cấu hình app/catalog Hub chưa khớp).

**Ngữ nghĩa với người dùng:** lưu hạn mức trả về ngay khi UniWork commit; hạn mức có hiệu lực ở Hub sau khi đồng bộ (thường dưới vài giây). Màn hình hiện trạng thái `pending → synced` (thăm dò mỗi 3 giây tối đa 30 giây khi `pending`). Hub là nơi **thi hành**; cấu hình hiển thị luôn là của UniWork.

### 6.4 Thông báo cho người

Mỗi kind mới là một quy tắc trong `server/internal/notification/rules.go`, một tiêu đề trong `titles.go`, một hàng ma trận tùy chọn, và `NOTIFICATION_KINDS` ở `packages/core` (xem `kinds.go:1-12`). Người nhận được lọc qua cổng thành viên hiện tại (`rules.go:25-39`), người đã rời tổ chức không nhận gì:

| Kind | Người nhận | Kênh mặc định |
|---|---|---|
| `ai_quota_threshold` (policy workspace) | owner/admin workspace đó + owner/admin tổ chức | trong app; push tắt; có trong digest ngày |
| `ai_quota_threshold` (policy user) | chính người đó (mọi ngưỡng); owner/admin tổ chức chỉ khi `threshold ≥ 100` | như trên |
| `ai_quota_threshold` (policy tổ chức) | owner/admin tổ chức | như trên |
| `ai_credit_low` | owner/admin tổ chức | trong app + digest |
| `ai_credit_depleted` | owner/admin tổ chức | trong app + **email** (Q-AIP-7) |

**Cách biết ngưỡng:** consumer thông báo nhận `webhook_event_id` từ `ai_quota.threshold_reached` (§6.1) và đọc `threshold` bất biến từ `ai_hub_webhook_events`; "mức 100" nghĩa là `threshold ≥ 100` và "dưới 100" là còn lại, nên ngưỡng tùy chỉnh (`{50,90}`, §3) vẫn có quy tắc người nhận rõ ràng; email chỉ khi `threshold ≥ 100` và policy là cấp tổ chức.

Email: thư giao dịch mới `ai_quota_alert` (`server/internal/mail/mail.go:13-23` là danh sách kind; `Enqueuer.Enqueue(ctx, q, msg)` cùng transaction, `mail/outbox.go:21-24`) chỉ cho `ai_credit_depleted` và ngưỡng 100% của policy tổ chức; nội dung chỉ có tên tổ chức, tên workspace, liên kết tới "Gói AI", không có số tiền chi tiết của người khác.

---

## 7. Bộ nhận webhook

**Route:** `POST /api/v1/integrations/uniai-hub/webhook`, đăng ký **trong** wrapper `api` với `auth: false`, giống hai tiền lệ cùng loại: `POST /integrations/livekit/webhook` và `/billing/webhooks/vnpay` (`server/internal/handler/router/meetings.go:265`, `billing_webhooks.go:4-14`; `isoRoutes` xếp chúng `isoPublic` với lý do `reasonProvider`: `handler/isolation_routes_test.go:243-245`). Lý do **không** đặt ngoài wrapper như `/mcp` và `/oauth/*`: ngoại lệ đó dành cho giao thức theo RFC; webhook Hub là hợp đồng riêng của UniWork nên phải có mặt trong OpenAPI (một SDO rỗng) và trong `TestSwaggerSpecFollowsChiRoutesAndSDI`.

**Xử lý (theo thứ tự, mọi nhánh lỗi đều không ghi gì):**

1. **Giới hạn thân**: đọc **byte thô** qua `http.MaxBytesReader(w, r.Body, 64<<10)` (khuôn `handler/document_sources.go:170`). Không dùng `decode()` vì HMAC phải tính trên đúng byte nhận (`decode` giải mã rồi mới ra struct, `handler/json.go:36-49`). Quá cỡ → `413`.
2. **Xác minh chữ ký**: `X-Hub-Signature: t=<unix giây>,v1=<hex>`; tính `hex(HMAC-SHA256(secret, "<t>.<thân thô>"))` (`hub:internal/webhook/sign.go:10-22`), so bằng `hmac.Equal` (thời gian không đổi) với **từng** secret trong `AI_HUB_WEBHOOK_SECRETS` (phân tách dấu phẩy; cho phép chồng hai secret khi xoay vì Hub chưa có API xoay secret: tạo endpoint mới rồi tắt endpoint cũ). Thiếu header hoặc sai → `401`.
3. **Chống phát lại**: `t` lệch quá ±5 phút → `401`. An toàn vì Hub ký lại mỗi lần gửi với giờ hiện tại (`hub:internal/webhook/deliver.go:361-374`), kể cả khi thử lại.
4. **Giải mã** thân đã xác thực: `{id, account_id, occurred_at, hub_request_id?, policy_id?, period_id?, threshold?, spent_micro?, limit_micro?, balance_micro?, credit_limit_micro?}` (`hub:internal/webhook/enqueue.go:116-147`). **Loại event nằm ở header `X-Hub-Event`, không có trong thân** — đọc từ header, giá trị ngoài `{policy.threshold, credit.low, credit.depleted}` → bỏ qua `200`. **`X-Hub-Event` và `X-Hub-Delivery` là header nằm NGOÀI chuỗi được ký** (`<t>.<thân thô>`, `sign.go:10-22`), nên không tin chúng trước khi đối chiếu với thân đã ký: bắt buộc `X-Hub-Delivery != ""` **và** `X-Hub-Delivery == payload.id`, nếu không → `401` (chặn kẻ phát lại một thân đã ký trong ±5 phút với `X-Hub-Delivery` đổi để vượt dedup); và `X-Hub-Event` phải khớp trường của thân (`policy.threshold` đòi `policy_id` và `threshold`; `credit.*` chỉ cần `id`, `account_id`; các trường số còn lại là con trỏ tùy chọn: `enqueue.go:116-147`), nếu không → `400` + metric. Trường lạ được chấp nhận (tương thích tiến).
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
- **Người dùng bị vô hiệu hóa/xóa khỏi tổ chức**: policy `user` của họ ở lại (không làm gì có hại); UI lọc theo thành viên hiện tại, và cho "xóa" policy mồ côi. Để việc xóa làm được, `DELETE …/quotas/users/{userID}` chỉ đòi `OrganizationService.RequireMember(org, actor)` + `adminLikeRole` và tìm dòng theo `(organization_id=org, subject_kind='user', subject_id=userID)`; **không** gọi `RequireMember(org, target)` ở đường xóa (cổng đó trả `403 member_deactivated`/`forbidden` cho người đã bị vô hiệu hóa hay đã rời: `organization.go:141-165`). `PUT` (tạo/sửa) vẫn đòi `RequireMember(org, target)`: không đặt hạn mức mới cho người không còn hoạt động.
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
| `GET /orgs/{orgID}/ai/plan` | org admin | ví + tóm tắt kỳ + bảng ws/user |
| `GET /orgs/{orgID}/ai/quotas` | org admin | danh sách `ai_quota_policies` (kể cả dòng đã gỡ, để biết `revision`) + `spent_micro` |
| `PUT /orgs/{orgID}/ai/quotas/organization` | org admin | thân: `period, kind, limit_micro, thresholds, models, revision` — **không có trường `_id`** |
| `PUT /orgs/{orgID}/ai/quotas/workspaces/{workspaceID}` | org admin | `WorkspaceService.RequireMember(ws, actor)`: workspace phải thuộc `orgID` |
| `PUT /orgs/{orgID}/ai/quotas/users/{userID}` | org admin | `userID` phải là thành viên **đang hoạt động** của `orgID`: `OrganizationService.RequireMember(org, target)` |
| `DELETE /orgs/{orgID}/ai/quotas/organization`, `…/workspaces/{workspaceID}`, `…/users/{userID}` | org admin | đặt `removed_at`, tăng `revision`; đường `users` **chỉ** đòi `RequireMember(org, actor)` và tìm dòng theo `(organization_id, 'user', userID)` để dọn được policy của người đã rời (§8.2) |
| `GET /workspaces/{workspaceID}/ai/quota` | ws admin | hạn mức của workspace + bảng "Dùng trong workspace" |
| `GET /orgs/{orgID}/ai/models` | org admin | `_catalog` (C6) |
| `GET /workspaces/{workspaceID}/ai/capabilities` (mở rộng) | member | khối `plan{state,scope,resets_at,model}` |
| `POST /integrations/uniai-hub/webhook` | — | `isoPublic`, lý do `reasonProvider` |

**Ca test phải thêm:**

- `TestIsolationMatrix` (`handler/isolation_matrix_test.go`): owner của B gọi mọi route trên với id của A, với `orgID` của B nhưng `workspaceID`/`userID` của A, và không phiên; mong 403/404 (401 khi không phiên), không chữ nào/ id nào của A trong thân, hash mọi dòng `organization_id` của A không đổi, không dòng B trỏ sang A; **mỗi lời từ chối có đối chứng** (owner A đọc/ghi cùng route thành công). Cụ thể cần sửa ba chỗ của bộ test, nếu không CI đỏ:
  1. **Gieo dữ liệu**: `isolation_world_test.go` gieo một dòng `ai_hub_accounts` và một dòng `ai_quota_policies` cho A (`emptyTenantTables`, `isolation_matrix_test.go:50` đòi mọi bảng tenant có dòng của A); `ai_hub_webhook_events` vào `isoUnseeded` (`:1182`) với lý do "chỉ route webhook công khai ghi nó, thế giới isolation không gửi gì".
  2. **`isoRoutes`** (`isolation_routes_test.go`): `PUT …/quotas/*` có `body: isoJSON(...)` (thân hợp lệ đủ để đối chứng *ghi* thành công của owner A); `{userID}` không phải dòng tenant nên **phải** phân loại kèm lý do ("chủ thể phải là thành viên của `orgID`"), nếu không `TestIsolationMatrix` đỏ (CLAUDE.md: route có `{param}` không phải dòng tenant thất bại cho tới khi `isoRoutes` phân loại nó kèm lý do); route webhook là `isoPublic` + `reasonProvider` (cạnh LiveKit/VNPay, `:243-245`); `skipControl` chỉ khi có lý do thật (không dùng cho các route này vì Hub giả trả lời được).
  3. **`newIsolationServer`** (`isolation_world_test.go:118`) nối một Hub giả (`httptest`, §14 `AIP-01`) để các đường đọc ví/policy trả lời được cho đối chứng của owner A.
- `TestEveryBodyIDFieldHasAReferenceCase`: các thân không có trường `*_id`/`*_ids` (chủ thể đi bằng đường dẫn) nên không cần `isoReferences`; nếu sau này thêm trường id thì thêm ca (`isoReferences` ở `isolation_references_test.go:115`).
- **Hub không bao giờ trộn tenant:** `TestAIHubClientAlwaysScopesToLinkedAccount`: client `aihub` mọi hàm nhận `organization_id`, tra `hub_account_id` từ **chính** dòng của tổ chức đó, không nhận `hub_account_id` từ ngoài; test với hai tổ chức và Hub giả: lệnh gọi của A chỉ mang account của A; `labels.workspace` do A chỉ định thuộc A.
- **Webhook:** `TestAIHubWebhookRoutesToTheLinkedOrganizationOnly` (event của account A chỉ phát topic `organization_id=A`; account lạ → `200` + không dòng nào), `TestAIHubWebhookDedupByDeliveryID`, `TestAIHubWebhookRejectsBadSignatureAndStaleTimestamp`, `TestAIHubWebhookRejectsDeliveryIDThatDiffersFromBodyID`, `TestAIHubWebhookUnknownPolicyEmitsNothing` (§7).
- **Realtime:** `TestIsolationRealtime` thêm `ai_quota.updated`, `ai_quota.threshold_reached`, `ai_credit.ran_low`, `ai_credit.depleted`: socket của B không nhận khung của A (phạm vi `organization`, `server/internal/realtime/hub_*_test.go`).
- **Phía Hub:** channel `uniwork` chỉ thấy account của mình (`hub:docs/SPEC.md:601`) — kiểm trong `scripts/e2e` của Hub, tham chiếu không lặp lại.

---

## 10. Cờ và rollout

**Hai cờ** trong `server/internal/featureflags/keys.go`, mỗi cờ có `ReviewAt` (`TestFlagsAreReviewed`), override user > tổ chức > toàn cục; cờ chỉ **ẩn** capability, không cấp quyền (khuôn `office_ai_uniwork`, `keys.go:61`):

| Key | Mặc định | Public | Owner | `ReviewAt` | Tác dụng |
|---|---|---|---|---|---|
| `ai_hub_routing` | `false` | không | `ai` | 2027-03-31 | tổ chức này gọi AI qua provider `hub` (cổng quota cũ tắt, §5.9); nơi tạo account Hub |
| `ai_plan_ui` | `false` | có | `ai` | 2027-03-31 | hiện tab "Gói AI", trình sửa hạn mức, trạng thái hạn mức ở end-user; chỉ có hiệu lực khi `ai_hub_routing && ai_plan_ui` (hai cờ cùng đánh giá **theo tổ chức**, không `UserID`; xem §5.9) |

**Hoàn tác** = tắt `ai_hub_routing` cho tổ chức; giữa kỳ, meter `ai.tokens` bắt đầu lại từ số đã ghi trước lúc chuyển (§5.9, chấp nhận ở pilot R2/R3). Cờ **không** cấp quyền: quyền vẫn do cổng ở §2. `GET /api/v1/config` đã công bố các cờ public (`keys.go:96-106`).

**Giai đoạn:**

| Bước | Việc | Điều kiện qua |
|---|---|---|
| R0 | Migration + mã với hai cờ tắt; ADR `AIP-00` merge trước | CI xanh; tổ chức hiện tại không đổi hành vi |
| R1 | Vận hành Hub: provision channel `uniwork` bằng `scripts/provision-uniwork.sh` (nhãn `user`,`feature` bắt buộc, `workspace` tùy chọn; `hub:docs/connect.md:400-439`), đặt env, hub_admin đăng ký webhook (C8) | `GET /v1/models` và một lượt chat thử OK; webhook thử nhận 200 |
| R2 | Bật hai cờ cho **tổ chức nội bộ UniWork**; hub_admin nạp credit tay | kịch bản AC: org admin chia hạn mức ws/user và bị chặn đúng (`hub:docs/SPEC.md:759` mục (b)) |
| R3 | Pilot vài tổ chức (override theo tổ chức) | không lỗi `ai_hub_*` kéo dài; số liệu ví khớp; thông báo đúng người |
| R4 | Mặc định bật | `AIP-BILL` đã chạy (grant khi mua gói) |
| R5 | Gỡ cờ + gỡ meter `ai.tokens`, `Quota.Record`, `usage_reconcile.go` | ADR cutover đóng; ghi một ADR gỡ |

**Thứ tự migration:** (1) bảng + index `CONCURRENTLY` (mỗi index một tệp) cho ba bảng, (2) không có migration dữ liệu. `EnsureAccount` chạy theo yêu cầu khi tổ chức được bật cờ (và có thể gọi bằng lệnh vận hành `cmd/ai-hub-link --org`), nên **backfill = không có** cho cấu hình; tổ chức chưa bật không có dòng nào.

---

## 11. Màn hình

**Kiểu** (người dùng chốt 2026-10-18 17:35 và 17:50): mọi màn nhìn như **app UniWork đang chạy** — vỏ ứng dụng thật, trang Cài đặt thật (`SettingsTab/Section/Card/Row`, `QuotaMeterRow`), Inter + token ngữ nghĩa của `tokens.css` (cỡ chữ `--text-*`, không màu cứng), Ngăn Hỏi UNI; không dựng một ngôn ngữ thị giác mới và không theo canvas Documents. Mọi text trong `packages/views/` qua `t()` (`i18next/no-literal-string`); biểu tượng theo `docs/conventions.md` › Icons, module qua `MODULE_ICONS`, đang tải là `<Spinner />`. Giữ "workspace" nguyên tiếng Anh (glossary, `docs/conventions.md:169`, `:228-230`).

**Quy tắc rút gọn** (người dùng chốt, bắt buộc): một dòng chỉ ở lại nếu người dùng **làm gì đó trên nó hoặc cần nó để quyết**; một con số cho một ý; không dòng giải thích cho thứ người quản trị không đổi được. Vì vậy các hàng dưới đây **không** có: hạn mức nợ cho phép của ví, "còn dùng được" tính sẵn, số lượt chạy cùng lúc tối đa, "cảnh báo gần đây", "xem trước ảnh hưởng" của hạn mức, "người dùng nhiều nhất" và model đang dùng trên màn workspace, xuất CSV, số lượt/token của khóa riêng (UniWork không đo). Các số tương ứng vẫn nằm ở Hub/API (§4: `credit_limit_micro` ở C2…) nhưng **không có màn nào hiện chúng ở v1**; DTO không cần mang chúng. Mỗi board có sáng/tối, máy tính 1280 + di động 390, ở `reports/ai-plan-uw/design/<board>.html` (chỉ mục `index.html`, ghi chú `NOTES.md`; đã qua hai vòng sửa).

| Board | Màn hình (trạng thái đã vẽ) | Route / path builder | View package |
|---|---|---|---|
| `a-org-plan.html` | **Gói AI** (tab tổ chức, owner/admin; a1–a6): thẻ "Kỳ này" = **một dòng** "đã dùng / hạn mức" kèm số còn lại, tên gói từ catalog UniWork, kỳ; nhóm "Chia hạn mức" hai tab **Workspace** / **Người dùng** (đã dùng / hạn mức, "chờ đồng bộ"), nút sửa và nút **"Đặt hạn mức"** cho workspace/người chưa có hạn mức riêng (a1b, FE-22); một dòng "Cảnh báo" gọn (ngưỡng; người nhận). Trạng thái: đang tải, máy chủ AI không phản hồi (số liệu cuối kèm "Số liệu cũ · giờ", a3), chưa chia hạn mức (a4), cờ tắt (a5), thành viên mở thẳng `?tab=ai-plan` bị từ chối (a6). *Mẫu số của dòng tổng chưa chốt trong Hub (policy cấp tổ chức, C4, hoặc ví, C2); đề nghị: policy tổ chức nếu có, không thì chỉ "Còn US$ x" từ ví; chốt ở `AIP-07`* | `paths.workspace(org, ws).settings()` + `?tab=ai-plan` (nhóm tổ chức, `gate: "org_admin"`, trước "Truy cập AI"; icon `Gauge`); `?tab=` hiện có không đổi | `packages/views/settings/components/ai-plan-tab.tsx` (+ tệp con theo giới hạn 500 dòng) |
| `b-quota-editor.html` | **Trình sửa hạn mức** (b1–b8): **ngăn bên phải (`Sheet`)** trên máy tính như Hỏi UNI, toàn màn hình trên di động (FE-15; không phải hộp thoại); chủ thể (tổ chức/workspace/người), "Khi hết" (**Chặn**/**Chỉ cảnh báo**), hạn mức, kỳ, ngưỡng, model được phép từ `_catalog` (model ngoài gói hiện mờ kèm lý do, D-4). Lỗi nhập, đang lưu, hạn mức thấp hơn mức đã dùng (cảnh báo vàng, vẫn lưu được), **xung đột `409 quota_conflict`** ("Có người vừa sửa hạn mức này", So sánh trong `Dialog` / Tải bản mới), "Đang áp dụng…" (`pending`) và "Chưa áp dụng được" (`failed`); thêm người (b2b). Chỉ những trường v1 lưu | mở từ bảng ở (a); không có route riêng | `ai-quota-sheet.tsx`, `ai-quota-compare-dialog.tsx` |
| `c-workspace-quota.html` | **Tab AI của workspace, mở rộng** (c1–c5): giữ nguyên cấu trúc đã có (§1.1a) — "Hạn mức của tổ chức", "30 ngày qua", "Theo tính năng" — đổi đơn vị sang US$; thêm hàng chỉ đọc **"Hạn mức của workspace"** (đã dùng / hạn mức, "đặt lại 01/11"), dòng "Cần đổi hạn mức? Chỉ quản trị viên tổ chức đổi được" kèm tên người, và bảng **"Dùng trong workspace"** (một cột số). Workspace đã hết hạn mức (c2, cảnh báo đỏ + ngày đặt lại), chưa có hạn mức riêng (c3), thành viên thường bị từ chối (c5). Nút "Xin tăng hạn mức" chỉ ở c4, **phương án b chưa chọn** (Q-AIP-6). Thanh điều hướng chỉ liệt kê tab mà vai trò đó thấy (FE-20) | `?tab=ai` (nhóm workspace, `gate: "workspace_admin"`, mở rộng `ai-tab.tsx`) | `ai-tab.tsx` + `ai-workspace-quota.tsx` |
| `d-end-user-states.html` | **Trạng thái người dùng cuối** (d1–d6): dải vàng ≥ 80% trên ô nhập — thành viên chỉ thấy **trạng thái + ngày đặt lại**, số tiền chỉ cho hạn mức **cá nhân** của chính họ (d1, d1b); **hết hạn mức** nêu chủ thể (workspace/bạn/tổ chức) + ngày đặt lại + tên người liên hệ, không nút thử lại (d2–d2c); tổ chức hết credit 402 (d2d); Office AI cùng nội dung (d3); "AI đang bận" tự thử rồi nút Thử lại (d4, d4b); "AI tạm thời không dùng được" (d4c); nhãn chỉ đọc "Mô hình đang dùng" + "Bị giới hạn bởi gói" (d5a); bộ chọn model chỉ là **phương án b chưa chọn** (d5, Q-AIP-4); bảng câu chữ d6 = §8.1 nguyên văn | Ask UNI (`packages/views/ai/ask-uni-panel.tsx`), Office AI qua mã lỗi ở lớp host (`apps/web/platform/office-frame/`); frame genoffice ở fork cần map mã mới (`AIP-F`, rủi ro §14); **khung Office (d3, f1–f5) là sơ đồ dựng tay, không phải ảnh app thật** (FE-23, chưa có ảnh nguồn) | `ai-limit-notice.tsx` dùng chung |
| `e-notifications.html` | **Thông báo + email** (e1–e6): dòng Hộp việc cho `ai_quota_threshold`, `ai_credit_low`, `ai_credit_depleted` (board vẽ thêm một dòng "đã hết" như kind riêng `ai_quota_exhausted`; spec chưa tách: mức 100% là `threshold ≥ 100` của `ai_quota_threshold`, §6.4; `AIP-08` chốt có tách kind không) (dựng lại theo Hộp việc thật, có hàng chip loại); toast; nhóm **"Gói AI"** trong ma trận Thông báo — ma trận thật hai cột **Hộp việc | Email** bằng `Switch`, công tắc email chỉ ở hai loại có thể gửi thư (FE-19); **hai** thư `ai_quota_alert` (tổ chức đạt 100%, tổ chức hết credit; chỉ tên + liên kết, không số tiền); bảng tham chiếu người nhận (§6.4) | Hộp thư thông báo (`packages/views/notifications`), `notifications-matrix.tsx` | + mẫu thư `server/internal/mail/templates` |
| `f-byok-vs-plan.html` | **BYOK so với gói** (f1–f6): chọn nguồn gói/khóa riêng (mặc định gói, D-5), chỉ có gói (f2), chỉ có khóa riêng khi tổ chức chưa mở Gói AI (f3), hết hạn mức gói nhưng có khóa riêng — gợi ý chuyển, người dùng tự bấm (f4, D-6), nhãn nguồn dưới câu trả lời (f5), quản trị thấy gì (f6: không có số của khóa riêng) | Cài đặt → AI (`ai-tab.tsx`), nơi lưu khóa BYOK, chip Office | `ai-source-explainer.tsx` |

---

## 12. Ngoài phạm vi

- **Billing**: mua gói → `POST /admin/v1/grants` idempotent theo `order_id`, hoàn tiền → `revoke`, `PUT /admin/v1/accounts/{id}/plan` (thẻ `AIP-BILL`, `hub:docs/SPEC.md:610-613`, `connect.md:629-670`).
- **P3 Hub**: status model realtime, đối soát provider, API key + khách mời, token ngắn hạn cho client, Gemini native, batch/video/realtime, `model.status_changed`.
- **P4 Hub**: Hub Console công khai, OIDC, thanh toán `direct`, **link ví có sẵn + consent**, app thứ hai (D14, `SPEC.md:761`).
- BYOK đi qua Hub (`SPEC.md:771`); web search qua Hub; rerank/image edits ở UniWork (item 6 "chưa có yêu cầu": `hub:docs/plans/2026-10-17-p2-plan.md:209`).
- Hạn mức theo cặp `(workspace, user)`, hạn mức mặc định cho mọi user, xóa policy thật, `grant.*` webhook, phát `credit.*` khi revoke/hết hạn grant, dọn `webhook_outbox` (`SPEC.md:785-790`).
- Màn hình `/admin` mới; xuất báo cáo CSV của usage (`GET /usage/v1/export` chưa dùng).
- Sửa fork genoffice để hiển thị mã lỗi mới trong frame (thẻ riêng ở repo office; rủi ro §14).

---

## 13. D3 — Quyết định cần người dùng

Chỉ những gì người dùng phải chọn. Khuyến nghị đứng đầu, kèm lý do. Mọi quyết định còn lại (tên bảng, tên route, thứ tự migration…) đã nằm trong §3–§10 theo khuôn của repo.

**Q-AIP-1 — Phạm vi epic này.**
(a) Chỉ phần quản lý hạn mức, *giả sử* P1 đã tích hợp. — Không khả thi: UniWork **chưa có** tích hợp Hub (§1.1).
(b) **Nền + hạn mức** (tạo account, provider `hub`, cutover `Quota`, hạn mức, webhook, màn hình); **billing (grant khi mua gói) tách `AIP-BILL`**, pilot hub_admin nạp tay. *(khuyến nghị)*
(c) Tất cả cùng một epic, gồm grant/revoke/đặt plan.
Lý do: (b) đưa được tới R2 (kịch bản AC của §22 P2) mà không kéo luồng thanh toán VNPay (`billing_*.go`) vào; billing có lịch và rủi ro riêng.

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
(a) Chỉ thông báo trong app + digest ngày (kênh sẵn có).
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
(a) **Ra mắt bằng cách làm vòng** (§13.2); xin Hub bổ sung H-1…H-6 như cải tiến sau. *(khuyến nghị)*
(b) Chờ Hub thêm H-1 (chủ thể trong lỗi 429), H-2 (lọc `external_id`), H-5 (nhãn trong webhook) rồi mới ra mắt.
Lý do: mọi mục đều có cách làm vòng nhỏ, và chủ Hub đã nói phía UniWork không chặn v0.2.0.

### 13.2 Phụ thuộc Hub (nếu Hub thiếu thứ UniWork cần, ghi ở đây, không bịa)

| # | Thiếu gì | Hôm nay | Cách làm vòng | Đề nghị |
|---|---|---|---|---|
| H-1 | Lỗi `429 policy_exceeded` không nói policy/chủ thể nào (`admission.go:301`) | thông điệp chung | UniWork suy ra bằng C4 (§8.1) | thêm `policy_id`, `label_key`, `label_value` vào body |
| H-2 | Không tra `hub_account_id` theo `external_id` | `GET /accounts` + khớp `name` | đặt `name="uniwork:<org>"` (C1) | thêm `?external_id=` |
| H-3 | Không có hạn mức mặc định cho account/channel | không mặc định (Q-AIP-3) | một policy/ chủ thể | policy mặc định theo nhãn (SPEC §23) |
| H-4 | `GET /admin/v1/accounts/{id}/plan` và `plans` chỉ `hub_admin` | UniWork dùng catalog gói của mình | không cần đọc plan Hub | cho app đọc plan của account đã link |
| H-5 | Webhook `policy.threshold` chỉ có `policy_id`, không có `label_key/value` | UniWork tra `hub_policy_id` → dòng của mình | lưu `hub_policy_id` từ response PUT; khôi phục bằng PUT lặp (`200` cùng id) | thêm nhãn vào payload |
| H-6 | Không có "danh mục model của gói" cho form sửa | gọi `/v1/models` với `user=_catalog` | giá trị tổng hợp không khớp policy | endpoint danh mục theo account (guide theo plan, SPEC §23) |

### 13.3 Điều *giả định* cần kiểm bằng test với Hub thật (đã đưa vào thẻ)

(1) `user=_catalog` trả đúng danh mục gói (H-6) và `label_key=""` cho policy cấp tổ chức; (2) trạng thái dòng request của lượt `provider_unavailable` (id có tái dùng được không, §5.4); (3) `PUT` lặp cùng version và cùng body trả cùng `id` (đã thấy trong mã `policies.go:246-249`; kiểm thêm bằng e2e); (4) thứ tự chữ ký khi retry (đã thấy trong mã `deliver.go:361-374`).

### 13.4 Câu hỏi design D-1…D-6 (từ `reports/ai-plan-uw/design/index.html`)

Mười câu Q-AIP ở trên là quyết định về **hành vi và phạm vi**; sáu câu D-n là quyết định về **bản vẽ** mà index đã liệt kê. Cả sáu đều cần người dùng chọn (không câu nào tự quyết được từ mã), trừ ghi chú ở D-3. Khuyến nghị theo index; bản vẽ hiện vẽ theo khuyến nghị trừ khi ghi khác.

| # | Câu hỏi | Khuyến nghị (index) | Ai quyết | Ghi chú đối chiếu spec |
|---|---|---|---|---|
| D-1 | Hạn mức theo người áp ở **mọi** workspace (Hub chưa có cặp workspace+người) — chấp nhận ở bản đầu? | Chấp nhận; ghi rõ trong ngăn sửa (b2) | **người dùng** | khớp §2 "Ràng buộc do Hub quyết định" và Q-AIP-3; không có cách làm vòng ở UniWork |
| D-2 | Hạn mức mới mặc định là "Chặn" hay "Chỉ cảnh báo"? | "Chỉ cảnh báo" lần đầu | **người dùng** | **bản vẽ b1/b2b đang chọn sẵn "Chặn"** (lệch khuyến nghị); `kind` mặc định của Hub là `hard` (C3) nên "Chỉ cảnh báo" là UniWork gửi `kind=soft` tường minh |
| D-3 | Chỉ owner/admin **tổ chức** sửa; admin workspace chỉ xem? | Đúng | **người dùng** xác nhận | đã là quy tắc trong §2 (Hub: policy `user` áp ở mọi workspace, nên admin workspace sửa là vượt quyền); đổi quyết định này kéo theo đổi §2/§9 |
| D-4 | Model ngoài gói: hiện mờ kèm lý do hay ẩn hẳn (ngăn sửa; cả bộ chọn nếu Q-AIP-4 b)? | Hiện mờ kèm lý do | **người dùng** | danh mục từ `_catalog` (C6, giả định H-6) |
| D-5 | Khi có cả gói và khóa riêng, mặc định dùng nguồn nào? | Gói (mức dùng nằm trong hạn mức) | **người dùng** | §5.7 "Đường nào thắng" (lựa chọn tường minh của người dùng) |
| D-6 | Cho chuyển sang khóa riêng một chạm khi gói hết (đi vòng qua hạn mức admin)? | Cho, chỉ khi tổ chức bật BYOK, nói rõ nhà cung cấp tính phí theo khóa của họ | **người dùng** | §5.7 "Khi hết hạn mức gói"; quan hệ Q-AIP-5 (không có công tắc cấm BYOK ở v1) |

**Chưa có trong index, nên thêm (FE-24):** *D-7 — tab AI của workspace có giữ "30 ngày qua" và "Theo tính năng" (đang chạy ở app) hay rút gọn theo quy tắc của §11?* Khuyến nghị: giữ, vì là tính năng đã có và gỡ nó ngoài phạm vi epic (§1.1a); người dùng quyết.

---

## 14. D4 — Chia thẻ triển khai

Kích thước S ≤ nửa ngày, M ≈ 1–2 ngày, L ≈ 3–5 ngày. Cột "Hub" là phụ thuộc vào đầu ra của Hub (v0.2.0 là L1 policy `spent_micro`, L2 `/v1/models` nhãn, L3 webhook). Mọi thẻ code theo CLAUDE.md: viết test lỗi trước, chạy test hẹp khi làm, cả bộ ở MR; không cờ nào bật mặc định.

| ID | Tiêu đề | Phạm vi đường dẫn | Cỡ | Phụ thuộc | Hub |
|---|---|---|---|---|---|
| **AIP-00** | ADR "AI qua Hub: cutover `Quota`, nhãn tenant, topic outbox, Hub sập" (viết trước khi đổi luật; xem `docs/adr/README.md`, `scripts/governance.test.mjs`) | `docs/adr/0035-*.md` | S | Q-AIP-1, 8, 9 | — |
| **AIP-01** | Gói client Hub: `server/internal/aihub` (account, ví, policy GET/PUT, usage summary, models; kiểu lỗi; mạch ngắt; hết thời gian 2s đọc/5s ghi; liệt kê account có phân trang cho phục hồi, C1); Hub giả `httptest` dùng chung; test arch "chỉ `internal/service` import `aihub`" | `server/internal/aihub/**`, `server/internal/arch_test.go` | M | AIP-00 | v0.2.0 |
| **AIP-02** | Migration + sqlc ba bảng (index `CONCURRENTLY` riêng), query có `-- tenant:`, lint | `server/migrations/999*_ai_hub_*`, `server/pkg/db/queries/ai_hub.sql` | S | AIP-00 | — |
| **AIP-03** | `EnsureAccount`: tạo/phục hồi account Hub (lặp trang), ghi `ai_hub_accounts`; hiện thực giao diện `HubAccounts` (§5.1) cho Gateway; lệnh vận hành `cmd/ai-hub-link --org`. Audit `ai.hub.account_linked` đã đăng ký ở `AIP-10` | `server/internal/service/ai_hub_account.go`, `server/cmd/ai-hub-link/` | M | AIP-01, 02, 10 | C1 |
| **AIP-04** | **Provider `hub` + định tuyến Gateway**: giao diện hẹp trong `internal/ai` (`HubAccounts`, `HubCatalog`, `PolicyInspector`, `RoutingFlag`, §5.1) + test arch `TestAIPackageHasNoHubOrServiceImport`; `CallMeta` trên Completion/Embed/ảnh/phiên âm, `CostMicros`/`UsageSource` trên response (§5.2); Gateway giữ hai provider, chọn theo cờ **chỉ theo tổ chức** (§5.9); nhãn (§5.3), chọn model ∩ `/v1/models` (§5.2), id yêu cầu (§5.4), ánh xạ lỗi (§8.1); **sở hữu** `service/ai_quota.go` (cổng cờ cho `Quota`) và ghi `cost_micros` từ `X-Hub-Cost`; biến thể cloud ảnh/phiên âm; test với Hub giả + kiểm giả định (2) | `server/internal/ai/provider/hub.go`, `ai/gateway.go`, `ai/hub_ports.go`, `ai/cloud*.go`, `ai/errors.go`, `ai/policy.go`, `service/ai_quota.go`, `server/internal/arch_test.go` | **L** | AIP-01, 03, 09 | C6, C7 |
| **AIP-05** | `AIQuotaService`: list/get/save/clear (org/ws/user), cổng §2 (xóa `users/{userID}` chỉ cần `RequireMember(org, actor)`), `revision` lạc quan + upsert/tạo lại (§8.2), audit + `ai_quota.updated` + `ai_quota.sync_requested` cùng transaction (topic/hằng audit đã ở `AIP-10`); route SDI/SDO; hai case `pathParamSDI` mới `orgID,workspaceID` và `orgID,userID` (§9); **cùng thẻ** sửa `isolation_world_test.go` (gieo `ai_hub_accounts`, `ai_quota_policies`; `ai_hub_webhook_events` vào `isoUnseeded`), `isoRoutes` + thân cho route mới, Hub giả trong `newIsolationServer` — ngay khi route đăng ký `TestIsolationMatrix` đòi những thứ này | `server/internal/service/ai_quota_policy.go`, `handler/ai_quota.go`, `handler/dto/{sdi,sdo}/`, `handler/router/ai_quota.go`, `router/openapi.go`, `handler/isolation_*_test.go` | M | AIP-02, 10 | — |
| **AIP-06** | `HubPolicySyncConsumer` (LaneSlow): PUT, ghi có điều kiện `revision = sent`, 409 theo §6.3 (đọc lại `FOR UPDATE`), phân loại 401/403/429, dead-letter, metric | `server/internal/service/ai_hub_sync.go`, `server/cmd/server/main.go` | M | AIP-01, 05 | C3, C4 |
| **AIP-07** | API đọc: tóm tắt Gói AI (ví + kỳ + bảng), usage ws/user/cá nhân (bỏ `cost_micro`), `capabilities.plan`, danh mục model; hiện thực `HubCatalog`/`PolicyInspector` (§5.1); cache RAM `singleflight` khóa `(org, workspace, user, feature)` + **consumer outbox trong tiến trình** làm mất hiệu lực trên mọi node (§5.5, khuôn `featureflags.Invalidator`); isolation: `isoRoutes` + thân cho route đọc mới | `server/internal/service/ai_plan_read.go`, `handler/ai_plan.go`, router, `server/cmd/server/main.go`, `handler/isolation_*_test.go` | M | AIP-01, 05 | C2, C4, C5, C6 |
| **AIP-08** | Bộ nhận webhook: HMAC, `X-Hub-Delivery == payload.id`, chống phát lại, dedup, policy lạ không emit, giới hạn tốc độ riêng + `ExceptPaths`, audit, emit (topic/hằng audit đã ở `AIP-10`); quy tắc thông báo (đọc `threshold` từ `ai_hub_webhook_events`) + kind + tiêu đề + ma trận; thư `ai_quota_alert`; `isoRoutes` cho route webhook (`isoPublic`) | `server/internal/handler/ai_hub_webhook.go`, `router/ai_hub_webhook.go`, `server/internal/notification/{kinds,rules,titles}.go`, `server/internal/mail/**`, `handler/isolation_routes_test.go` | L | AIP-02, 03, 10 | C8 (đăng ký bởi vận hành) |
| **AIP-09** | Cờ `ai_hub_routing`, `ai_plan_ui` (+ `ReviewAt`), env + `.env.example`, metric Prometheus, runbook + cảnh báo (mỗi cảnh báo một runbook 4 mục: `scripts/alerts-runbooks.test.mjs`) | `featureflags/keys.go`, `.env.example`, `deploy/alerts.yml`, `docs/runbooks/` | S | AIP-00 | — |
| **AIP-10** | **Sự kiện + audit (đi trước mọi thẻ phát chúng)**: bốn topic có khán giả vào đủ ba nơi catalogue, `ai_quota.sync_requested` (phạm vi `-`) chỉ vào `CATALOGUE.md` + `catalogue.go` (§6.1), hằng `audit/actions.go` + mục `auditCommands`/`actionsWithoutCommands` trong `audit_coverage_test.go`; `TestIsolationRealtime` cho bốn topic. Đứng trước `AIP-03`, `05`, `08` để các thẻ ấy không làm `events-catalogue.test.mjs` / `audit_coverage_test.go` đỏ | `docs/events/CATALOGUE.md`, `outbox/catalogue.go`, `packages/core/types/events.ts`, `audit/actions.go`, `service/audit_coverage_test.go`, `realtime/` | S | AIP-00 | — |
| **AIP-11** | `packages/core`: endpoints + schema khoan dung + ca malformed, khóa truy vấn `aiPlanKeys` (có `wsId`), hook, làm mới realtime, quy tắc quyền §2, `paths` | `packages/core/api/endpoints/ai-plan.ts(+test)`, `core/ai/`, `core/permissions/`, `core/realtime/use-realtime-sync.ts` | M | AIP-05, 07 | — |
| **AIP-12** | Màn hình tổ chức/workspace: tab **Gói AI** (a), ngăn sửa hạn mức `ai-quota-sheet.tsx` (b) gồm hộp thoại so sánh 409, hạn mức workspace (c); i18n vi/en; test view. **Cũng sửa `docs/conventions.md`**: › Icons thêm hàng `Ban` (chặn do hạn mức), `Gauge` (gói/hạn mức), `KeyRound` (khóa riêng) (FE-14); §2 glossary thêm `credit`, `hạn mức`, `gói AI`, `hạn mức cá nhân` (FE-17) | `packages/views/settings/components/ai-plan-*.tsx`, `ai-quota-sheet.tsx`, `ai-tab.tsx`, `settings-page.tsx`, `docs/conventions.md` | **L** | AIP-11; board a,b,c | — |
| **AIP-13** | Người dùng cuối: `ai-limit-notice` (d), Ask UNI/catch-up map mã mới, giải thích BYOK (f), thông báo/mẫu (e) | `packages/views/ai/**`, `packages/views/chat/use-chat-catch-up-ui.ts`, `notifications*`, `locales/*.json` | M | AIP-11; board d,e,f | — |
| **AIP-14** | E2E Playwright + Hub giả: admin đặt hạn mức → người dùng bị chặn với đúng chủ thể; cảnh báo 80% tới đúng người; hai admin xung đột; Hub sập | `e2e/ai-plan.spec.ts` | M | AIP-12, 13 | v0.2.0 thật ở bước R2 |
| **AIP-15** | Hoàn tất cutover: ẩn hàng `ai.tokens` ở Billing cho tổ chức đã bật; `usage_reconcile.go` chỉ còn phục vụ tổ chức chưa bật; chốt đường cũ. **Không** đụng `service/ai_quota.go` và ghi `cost_micros` (của `AIP-04`) | `ai/usage_reconcile.go`, `packages/views/settings/components/{billing-tab,quota-meter}.tsx` | M | AIP-04 | — |
| **AIP-F** | (ngoài worktree) map mã lỗi mới trong frame genoffice | repo office | S | AIP-04 | — |
| **AIP-BILL** | (epic riêng, Q-AIP-1) grant khi thanh toán, revoke khi hoàn tiền, đặt plan | `service/billing_*.go` | L | AIP-03 | grants/plan |

**Thứ tự:** `AIP-00` → (`AIP-01` ∥ `AIP-02` ∥ `AIP-09` ∥ `AIP-10`) → `AIP-03` → (`AIP-05` ∥ `AIP-04`) → (`AIP-06` ∥ `AIP-07` ∥ `AIP-08`) → `AIP-11` → (`AIP-12` ∥ `AIP-13`) → `AIP-14` → `AIP-15`; `AIP-BILL` song song từ sau `AIP-03`, trước R4.

**Rủi ro chính:** (1) `AIP-04` chạm lõi Gateway và mọi capability — chia nhỏ theo capability, giữ đường cũ bằng cờ tổ chức; (2) frame genoffice ở fork hiển thị lỗi theo `code`, không sửa được từ worktree này (`AIP-F`); (3) `Retry-After`/id yêu cầu — kiểm giả định (2); (4) lệch múi giờ giữa nhóm `day` của usage (UTC) và kỳ policy (UTC+7) — chỉ dùng `spent_micro` cho thước hạn mức (C5); (5) Hub chưa tag v0.2.0 — mọi thẻ code kiểm lại hợp đồng ở §4 khi có tag.

---

## 15. Bảng truy vết AC-1

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
