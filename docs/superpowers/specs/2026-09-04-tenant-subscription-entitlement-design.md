# UniWork — Gói, thuê bao, entitlement và quota theo tổ chức

**Ngày:** 2026-09-04
**Trạng thái:** Đã triển khai — đợt F (2026-09-06, UNI-425): schema, `EntitlementService`, 4 điểm gate, `BillingService` đổi gói tay, tab Thanh toán; plan `docs/superpowers/plans/2026-09-06-tenant-subscription-entitlement.md`. Còn lại: webhook/invoice/checkout thật (C-04), cảnh báo ngưỡng (C-05), admin plan API (F-11). Duyệt 2026-09-04 (quangpd — UNI-421); câu hỏi mở đã chốt trong `docs/roadmap/OPEN_QUESTIONS.md`; ADR 0007–0010 accepted.
**Spec liên quan:** `2026-08-24-uniwork-platform-design.md`, `2026-08-25-onboarding-organizations-design.md`, `2026-08-27-workspace-permissions-design.md`, `2026-09-04-organization-people-directory-design.md`
**Tham chiếu:** Vision §4.2 (mô hình kinh doanh), §5.2 (#2 Tenant & Subscription), §6.9 (DoD); bản cũ `unidigiwork` Blueprint §18, `src/contracts/billing/plan.ts`, `src/lib/api/billing.functions.ts`, `admin-plans.functions.ts`, `tests/integration/02_quota_gate.sql`


> **Ghi chú số migration:** số `0NN_` trong spec này là **giữ chỗ**; số thật được cấp khi viết plan, theo thứ tự triển khai trong `docs/roadmap/FEATURE_ROADMAP.md` (audit/outbox → entitlement → tasks → notifications → …) và theo migration mới nhất trên `develop` lúc đó. Các spec cùng ngày có dải số trùng nhau là cố ý.

## 1. Mục tiêu

Dựng tầng **Tenant & Subscription** cho `uniwork`: mỗi **organization** có đúng một thuê bao đang hiệu lực, thuê bao trỏ vào một **gói**, gói khai báo **entitlement** (bật/tắt tính năng và hạn mức), và mọi hành động tiêu thụ tài nguyên đi qua **quota gate** ở tầng service Go. Billing provider (cổng nội địa + Stripe) chỉ là adapter phía sau; sản phẩm chạy được hoàn toàn khi chưa nối provider nào (gói mặc định, nâng gói bằng tay bởi platform admin).

**Deliverable đợt này**

1. Schema `plans`, `plan_features`, `subscriptions`, `usage_counters`, `usage_events`, `invoices` (+ `webhook_inbox` đã có).
2. `EntitlementService` (`Can`, `CheckQuota`, `RecordUsage`) và gắn gate vào 4 điểm tiêu thụ đầu tiên (thành viên org, workspace, participant-minute họp, AI token).
3. API đọc gói công khai, đọc snapshot entitlement của org, lịch sử hóa đơn; API platform-admin đổi gói bằng tay.
4. Adapter interface `billing.Provider` + xử lý `webhook_inbox` cho Stripe (provider nội địa để mở, cùng interface).
5. Màn hình Billing tối thiểu trong Settings của organization.

**Ngoài phạm vi đợt này** (ghi để không quên)

- Checkout/thanh toán tự phục vụ hoàn chỉnh (chỉ có adapter + webhook + nâng gói thủ công).
- Tín dụng AI mang sang kỳ sau, hoàn tiền, proration.
- Quota theo workspace (đợt này quota chỉ theo organization).
- Trang Pricing công khai (Vision §4.2: chưa chốt giá, không đưa lên sản phẩm).

## 2. Quyết định đã chốt

| # | Quyết định |
|---|------------|
| 1 | Chủ thể thuê bao là **organization**, không phải workspace và không phải user. Cột định danh: `organization_id`. |
| 2 | Không hard-code tên gói: mã Go/TS chỉ gọi `Can(feature)` / `CheckQuota(meter, delta)`. Test `scripts/no-plan-literal.test.mjs` + Go test grep chặn chuỗi `"free"`/`"team"`/`"business"` ngoài package `billing`. |
| 3 | **Fail-closed:** thiếu subscription, thiếu entitlement, hoặc quota gate lỗi DB ⇒ từ chối với mã lỗi ổn định `entitlement_required` / `quota_exceeded`. Không "cho qua để đỡ phiền". |
| 4 | Entitlement hiệu lực = `plan_features` của gói hiện tại **ghi đè** bởi `subscription_overrides` (JSON trên subscription) — không có bảng `entitlements` snapshot như bản cũ; snapshot tính lúc đọc và cache 60 s trong process. |
| 5 | Kỳ tính quota = kỳ thuê bao (`current_period_start` → `current_period_end`), không phải tháng dương lịch như bản cũ. |
| 6 | Feature kind chỉ có hai loại: `flag` (bật/tắt) và `quota` (số, `NULL` = không giới hạn, `0` = tắt). |
| 7 | Gói mặc định khi tạo organization: gói có `is_default = true`; onboarding tạo subscription `active` với provider `manual` trong cùng transaction tạo org. |
| 8 | Provider là interface Go; `manual` luôn có; `stripe` và `vnpay` (đại diện cổng nội địa) là hai implementation, chọn bằng cấu hình. Không có hai writer cho `subscriptions`: chỉ `BillingService` ghi, provider chỉ trả kết quả. |
| 9 | Sự kiện `subscription.changed` phát qua outbox (không chỉ `EventPublisher` in-memory) vì downstream (email, audit, cache) cần đảm bảo giao. |

## 3. Dữ liệu

Quy tắc chung: ULID `TEXT`, không `FOREIGN KEY`, mỗi index là file `CONCURRENTLY` riêng, `created_at`/`updated_at` TIMESTAMPTZ. Số hiệu migration đề xuất `058`–`069` (điều chỉnh nếu nhánh khác chiếm số).

### 3.1 `058_billing_catalog.up.sql`

```sql
CREATE TABLE plans (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL,              -- unique, snake_case, immutable sau khi có subscription
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  billing_period TEXT NOT NULL DEFAULT 'month',  -- month | year | none (service chuẩn hóa, không CHECK)
  price_amount  BIGINT,                     -- đơn vị nhỏ nhất (VND: đồng); NULL = liên hệ
  price_currency TEXT NOT NULL DEFAULT 'VND',
  is_default    BOOLEAN NOT NULL DEFAULT false,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE features (
  key         TEXT PRIMARY KEY,             -- 'meeting.recording', 'members.max', 'ai.tokens'
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,                -- flag | quota
  unit        TEXT,                         -- 'members', 'minutes', 'tokens', NULL cho flag
  category    TEXT NOT NULL DEFAULT 'general',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE plan_features (
  plan_id     TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  quota_limit BIGINT,                       -- NULL = unlimited; chỉ dùng khi kind = quota
  PRIMARY KEY (plan_id, feature_key)
);
```

`059_plans_code_uidx.up.sql`: `CREATE UNIQUE INDEX CONCURRENTLY idx_plans_code ON plans(code);`
`060_plans_default_uidx.up.sql`: `CREATE UNIQUE INDEX CONCURRENTLY idx_plans_default_once ON plans(is_default) WHERE is_default;`

Seed (trong `058`, dữ liệu, không phải DDL): 1 gói `starter` `is_default`, và bảng `features` khởi đầu:

| key | kind | unit | ghi chú |
|---|---|---|---|
| `members.max` | quota | members | số thành viên org (đếm `organization_members` active) |
| `workspaces.max` | quota | workspaces | |
| `meeting.participant_minutes` | quota | minutes | cộng dồn theo kỳ từ `meeting_attendance_sessions` |
| `meeting.recording` | flag | | |
| `meeting.ai_summary` | flag | | |
| `ai.tokens` | quota | tokens | ghi bởi AI gateway (spec AI) |
| `storage.bytes` | quota | bytes | dành chỗ, spec Document dùng |
| `sso.oidc` | flag | | |

Giá trị `quota_limit` cho `starter` là **quyết định sản phẩm mở** (§10); seed để `NULL` (unlimited) cho đến khi chốt, để dev không bị chặn.

### 3.2 `061_subscriptions.up.sql`

```sql
CREATE TABLE subscriptions (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL,
  plan_id               TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active',  -- trialing | active | past_due | suspended | canceled
  provider              TEXT NOT NULL DEFAULT 'manual',  -- manual | stripe | vnpay
  provider_customer_id  TEXT,
  provider_subscription_id TEXT,
  current_period_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end    TIMESTAMPTZ,                     -- NULL cho gói không kỳ hạn
  cancel_at             TIMESTAMPTZ,
  canceled_at           TIMESTAMPTZ,
  trial_ends_at         TIMESTAMPTZ,
  overrides             JSONB NOT NULL DEFAULT '{}'::jsonb, -- {"members.max": 50, "meeting.recording": true}
  row_version           INTEGER NOT NULL DEFAULT 1,
  created_by            TEXT NOT NULL,
  updated_by            TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`062_subscriptions_org_active_uidx.up.sql`: `CREATE UNIQUE INDEX CONCURRENTLY idx_subscriptions_org_live ON subscriptions(organization_id) WHERE status <> 'canceled';` (một org chỉ có một thuê bao sống)
`063_subscriptions_provider_idx.up.sql`: `CREATE INDEX CONCURRENTLY idx_subscriptions_provider_sub ON subscriptions(provider, provider_subscription_id);`

Backfill trong `061` (DML): mỗi `organizations` chưa có subscription → 1 dòng `active`, `provider='manual'`, `plan_id` = gói `is_default`, `created_by = updated_by = organizations.created_by`.

### 3.3 `064_usage.up.sql`

```sql
CREATE TABLE usage_events (               -- append-only, nguồn để tái tính counter
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT,                    -- NULL khi meter ở cấp org (members)
  meter_key       TEXT NOT NULL,           -- = features.key có kind = quota
  delta           BIGINT NOT NULL,         -- có thể âm (xóa thành viên)
  actor_id        TEXT,                    -- user hoặc agent (spec AI): actor_kind ở cột kế
  actor_kind      TEXT NOT NULL DEFAULT 'human',
  ref_type        TEXT,                    -- 'meeting', 'ai_run', ...
  ref_id          TEXT,
  idempotency_key TEXT,                    -- ref_type:ref_id:meter khi có
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usage_counters (             -- tổng theo kỳ, ghi trong cùng tx với usage_events
  organization_id TEXT NOT NULL,
  meter_key       TEXT NOT NULL,
  period_start    TIMESTAMPTZ NOT NULL,
  total           BIGINT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, meter_key, period_start)
);
```

`065_usage_events_idem_uidx.up.sql`: `CREATE UNIQUE INDEX CONCURRENTLY idx_usage_events_idem ON usage_events(organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;`
`066_usage_events_org_meter_idx.up.sql`: `CREATE INDEX CONCURRENTLY idx_usage_events_org_meter ON usage_events(organization_id, meter_key, occurred_at);`

Meter **đếm hiện trạng** (`members.max`, `workspaces.max`, `storage.bytes`) không dùng counter theo kỳ: `CheckQuota` đếm trực tiếp (`COUNT(*)` trên bảng nguồn). Meter **cộng dồn** (`meeting.participant_minutes`, `ai.tokens`) dùng `usage_counters`. `features` thêm cột `meter_mode TEXT NOT NULL DEFAULT 'accumulate'` (`accumulate | snapshot`) trong `058`.

### 3.4 `067_invoices.up.sql`

```sql
CREATE TABLE invoices (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL,
  subscription_id     TEXT NOT NULL,
  provider            TEXT NOT NULL,
  provider_invoice_id TEXT,
  number              TEXT NOT NULL,              -- UW-2026-000123, sinh bởi service
  status              TEXT NOT NULL DEFAULT 'draft', -- draft | open | paid | void | uncollectible
  amount_due          BIGINT NOT NULL,
  amount_paid         BIGINT NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'VND',
  period_start        TIMESTAMPTZ NOT NULL,
  period_end          TIMESTAMPTZ NOT NULL,
  hosted_url          TEXT,                       -- link provider, không lưu PDF trong DB
  issued_at           TIMESTAMPTZ,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`068_invoices_org_idx.up.sql`: `CREATE INDEX CONCURRENTLY idx_invoices_org ON invoices(organization_id, created_at DESC);`
`069_invoices_number_uidx.up.sql`: `CREATE UNIQUE INDEX CONCURRENTLY idx_invoices_number ON invoices(number);`

`webhook_inbox` (đã có, `031`): tái dùng nguyên; `provider ∈ {stripe, vnpay}`, `provider_event_id` unique với provider (`032`).

`.down.sql` đảo ngược đầy đủ từng file.

## 4. Service (Go)

### 4.1 Package bố trí

```
server/internal/billing/            # package billing — KHÔNG import service
  provider.go                       # interface Provider + Manual
  stripe.go                         # implementation, đọc STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
  vnpay.go                          # stub trả ErrProviderUnavailable cho tới khi có hợp đồng
server/internal/service/
  entitlement.go                    # EntitlementService: Can, CheckQuota, RecordUsage, Snapshot
  entitlement_test.go
  billing.go                        # BillingService: ChangePlan, Cancel, Resume, ApplyProviderEvent, ListInvoices
  billing_test.go
  billing_webhook.go                # worker đọc webhook_inbox → BillingService.ApplyProviderEvent
server/pkg/db/queries/billing.sql   # plans, plan_features, features, subscriptions, invoices
server/pkg/db/queries/usage.sql
```

`server/internal/arch_test.go` bổ sung: chỉ `service/entitlement.go` và `service/billing.go` được gọi query trên `subscriptions`, `usage_*`; `billing` không import `service`.

### 4.2 `EntitlementService`

```go
type EntitlementService struct { q *db.Queries; pool *pgxpool.Pool; cache *snapshotCache }

// Can trả lỗi ErrEntitlementRequired (403, code "entitlement_required") khi flag tắt.
func (s *EntitlementService) Can(ctx context.Context, orgID, feature string) error

// CheckQuota kiểm tra delta có vượt limit không. Không ghi.
// Lỗi: ErrQuotaExceeded (402? -> quyết định: 403, code "quota_exceeded", fields meter, limit, current, delta).
func (s *EntitlementService) CheckQuota(ctx context.Context, orgID, meter string, delta int64) error

// Consume = CheckQuota + RecordUsage trong cùng tx với nghiệp vụ gọi.
// Caller truyền tx (pgx.Tx) để cùng commit với mutate — không có đường ghi usage ngoài tx nghiệp vụ.
func (s *EntitlementService) Consume(ctx context.Context, tx pgx.Tx, in ConsumeInput) error

type ConsumeInput struct {
  OrganizationID, WorkspaceID, Meter string
  Delta int64
  ActorID string; ActorKind string    // "human" | "agent"
  RefType, RefID, IdempotencyKey string
}

// Snapshot: gói + entitlement hiệu lực + usage hiện tại của org (cache 60 s, invalidate khi subscription.changed).
func (s *EntitlementService) Snapshot(ctx context.Context, orgID string) (EntitlementSnapshot, error)
```

Công thức hiệu lực (một chỗ duy nhất, có test bảng):

```
effective(feature) =
  overrides[feature]                       nếu subscription.overrides có khóa
  OR plan_features(plan_id, feature)       nếu có dòng
  OR {enabled: false, quota_limit: 0}      (fail-closed: gói không khai báo = không có)
subscription.status ∉ {trialing, active}  ⇒ mọi flag = false, mọi quota = 0, trừ danh sách
                                            GRACE_FEATURES = {"members.max"} giữ nguyên để không khóa người dùng đọc dữ liệu.
```

Lock: `Consume` cho meter `accumulate` dùng `INSERT ... ON CONFLICT DO UPDATE ... WHERE total + delta <= limit` (một câu lệnh, chống race như `tests/integration/07_concurrent_quota_race.sh` bản cũ). Meter `snapshot` dùng `SELECT ... FOR UPDATE` trên dòng `subscriptions` của org rồi `COUNT`.

### 4.3 Gắn gate (đợt này, đúng 4 điểm)

| Điểm gọi | Meter / feature | Nơi sửa |
|---|---|---|
| Thêm thành viên org (accept invite, add member) | `members.max`, delta +1 | `WorkspaceService.AcceptInvite`, `OrganizationService.AddMemberIfAbsent` |
| Tạo workspace | `workspaces.max`, +1 | `WorkspaceService.CreateInOrg` |
| Kết thúc phiên tham dự họp | `meeting.participant_minutes`, +ceil(minutes) | `meeting_participants.go` nơi đóng `meeting_attendance_sessions`; idempotency = `attendance:<session_id>` |
| Bật ghi hình / AI summary | `Can("meeting.recording")`, `Can("meeting.ai_summary")` | `meeting_control.go`, `meeting_ai.go` |

`ai.tokens` do spec AI gateway gọi `Consume`; spec này chỉ đảm bảo meter tồn tại.

### 4.4 `BillingService`

```go
func (s *BillingService) Current(ctx, actorID, orgID) (SubscriptionView, error)          // RequireOrgMember
func (s *BillingService) ChangePlan(ctx, actorID, orgID, planCode string, expectedVersion int) (SubscriptionView, error)
    // org owner: chỉ đổi giữa các gói provider = manual có price NULL/0 (downgrade tự do); còn lại yêu cầu provider checkout (đợt sau)
    // platform admin (users.is_platform_admin — cột thêm ở spec People §3.1): đổi bất kỳ, provider giữ 'manual'
    // row_version mismatch → ErrConflict (409, code "version_conflict")
func (s *BillingService) Cancel(ctx, actorID, orgID string) error   // owner; set cancel_at = current_period_end
func (s *BillingService) Resume(ctx, actorID, orgID string) error
func (s *BillingService) ListInvoices(ctx, actorID, orgID string, page Page) ([]db.Invoice, error)
func (s *BillingService) ApplyProviderEvent(ctx, ev billing.Event) error   // idempotent theo provider_event_id
```

Mọi mutate của `subscriptions`: trong một tx — update + `row_version = row_version + 1` + `outbox_events(topic='subscription.changed', payload={organization_id, subscription_id, plan_code, status})` + `EventPublisher.SendToUser` cho mọi org owner/admin (`subscription.changed`, payload id-only). Cache snapshot invalidate ngay trong process; các instance khác nhận qua outbox consumer.

### 4.5 Provider interface

```go
package billing

type Provider interface {
  Name() string
  // CreateCheckout trả URL để org owner thanh toán; provider Manual trả ErrProviderUnavailable.
  CreateCheckout(ctx, in CheckoutInput) (CheckoutSession, error)
  // ParseWebhook xác thực chữ ký và chuẩn hóa về Event; KHÔNG ghi DB.
  ParseWebhook(r *http.Request) (Event, error)
}

type Event struct {
  ProviderEventID string
  Type            string   // subscription.activated | subscription.updated | subscription.canceled | invoice.paid | invoice.failed
  OrganizationID  string   // map từ metadata/customer
  PlanCode        string
  PeriodStart, PeriodEnd time.Time
  Invoice         *InvoiceData
}
```

Handler `POST /billing/webhooks/{provider}`: `ParseWebhook` → ghi `webhook_inbox` (dedupe unique) → 200. Worker (`billing_webhook.go`, chạy cùng process như outbox worker hiện có) lấy `PENDING` → `ApplyProviderEvent` → `processed_at`. Lỗi → `attempt_count++`, `next_attempt_at` backoff, tối đa 10 lần rồi `status='DEAD'`; có metric Prometheus `uniwork_billing_webhook_dead_total`.

### 4.6 Mã lỗi ổn định (thêm vào `service/errors.go` + `mapServiceError`)

| Go | HTTP | `code` | `fields` |
|---|---|---|---|
| `ErrEntitlementRequired` | 403 | `entitlement_required` | `feature` |
| `ErrQuotaExceeded` | 403 | `quota_exceeded` | `meter, limit, current, delta` |
| `ErrSubscriptionInactive` | 403 | `subscription_inactive` | `status` |
| `ErrConflict` (đã có) | 409 | `version_conflict` | `expected, actual` |
| `ErrProviderUnavailable` | 503 | `billing_provider_unavailable` | `provider` |

`ErrorSDO` mở rộng thêm `Fields map[string]any` (tùy chọn, `omitempty`) — thay đổi contract cộng thêm, tương thích ngược.

## 5. API (`/api/v1`, sau `RequireAuth` trừ ghi chú)

Đăng ký qua wrapper `api` trong `server/internal/handler/router/billing.go` (tag mới `Billing`), SDI/SDO trong `dto/sdi/billing.go`, `dto/sdo/billing.go`. Path param mới `{org}` đã có case; thêm `{provider}`, `{invoiceId}` vào `pathParamSDI`.

| Method & path | Auth | SDI → SDO | Ghi chú |
|---|---|---|---|
| `GET /plans` | public | → `PlanListSDO{plans:[PlanDTO]}` | chỉ `is_active`; `PlanDTO{id, code, name, description, billing_period, price_amount, price_currency, is_default, features:[{feature_key, enabled, quota_limit}]}` |
| `GET /orgs/{org}/billing` | org member | → `SubscriptionSDO{subscription: SubscriptionDTO, entitlements:[EntitlementDTO]}` | `SubscriptionDTO{id, plan_code, plan_name, status, provider, current_period_start, current_period_end, cancel_at, trial_ends_at, row_version}`; `EntitlementDTO{feature_key, name, kind, unit, category, enabled, quota_limit, current_usage}` |
| `PATCH /orgs/{org}/billing/plan` | org owner / platform admin | `ChangePlanSDI{plan_code, row_version}` → `SubscriptionSDO` | 409 `version_conflict`; 402 không dùng — trả 403 + `checkout_required` khi cần provider |
| `POST /orgs/{org}/billing/checkout` | org owner | `CheckoutSDI{plan_code, success_path, cancel_path}` → `CheckoutSDO{url}` | 503 khi provider = manual |
| `POST /orgs/{org}/billing/cancel` | org owner | → `SubscriptionSDO` | |
| `POST /orgs/{org}/billing/resume` | org owner | → `SubscriptionSDO` | |
| `GET /orgs/{org}/billing/invoices` | org owner/admin | `?cursor&limit` → `InvoiceListSDO{invoices:[InvoiceDTO], next_cursor}` | `InvoiceDTO{id, number, status, amount_due, amount_paid, currency, period_start, period_end, hosted_url, issued_at, paid_at}` |
| `POST /billing/webhooks/{provider}` | chữ ký provider, **không** RequireAuth | raw body → 200 `StatusSDO` | § 8 của `api-sdi-sdo.md`: ngoại lệ Swagger nếu body không phải JSON SDI |
| `GET /admin/plans`, `PUT /admin/plans/{code}`, `PUT /admin/plans/{code}/features/{key}` | platform admin | `PlanUpsertSDI`, `PlanFeatureSDI{enabled, quota_limit}` | tag `Admin`; xóa gói không có — chỉ `is_active=false` |

Lỗi `entitlement_required` / `quota_exceeded` có thể trả từ **bất kỳ** endpoint có gate (tasks, meetings, members). FE xử lý chung ở `packages/core/api/http.ts` → `ApiError.code`.

## 6. Realtime & sự kiện

| Sự kiện | Kênh | Payload |
|---|---|---|
| `subscription.changed` | outbox topic + `SendToUser` cho org owner/admin | `{organization_id, subscription_id}` |
| `quota.threshold` | `SendToUser` cho org owner/admin, phát khi `total/limit` vượt 80 % và 100 % (mỗi ngưỡng một lần mỗi kỳ, ghi nhớ trong `usage_counters.updated_at` + cột `notified_80_at`, `notified_100_at` thêm ở `064`) | `{organization_id, meter_key, level}` |

Spec Notification (khác) tiêu thụ hai sự kiện này để tạo thông báo in-app/email; spec này chỉ phát.

## 7. Frontend

### 7.1 `packages/core/billing/`

```
types.ts        Plan, PlanFeature, Subscription, Entitlement, Invoice, SubscriptionStatus + SUBSCRIPTION_STATUSES
hooks.ts        billingKeys = { plans, current(orgId), invoices(orgId) }; usePlans, useSubscription(orgId),
                useChangePlan, useCancelSubscription, useResumeSubscription, useInvoices(orgId)
entitlements.ts useEntitlements(orgId) → { can(feature): boolean, quota(meter): {limit, used, remaining} | null, isLoading }
                Mirror của EntitlementService.effective — chỉ để ẩn/hiện; backend vẫn là nơi chặn.
```

`packages/core/api/endpoints/billing.ts`: `listPlans`, `getSubscription`, `changePlan`, `createCheckout`, `cancelSubscription`, `resumeSubscription`, `listInvoices`; mỗi hàm `parseWithFallback`; `billing.test.ts` có case malformed cho từng hàm. Enum `status` parse `z.string()`; `SUBSCRIPTION_STATUSES` là mảng hằng cạnh type.

`packages/core/realtime/use-realtime-sync.ts`: thêm map `subscription.changed → invalidate billingKeys.current(orgId)`, `quota.threshold → invalidate billingKeys.current(orgId)` + toast qua `useQuotaWarnings` (chỉ hiển thị, không lưu).

`packages/core/permissions/rules.ts`: `canManageBilling(ctx)` = `ctx.orgRole === "owner"`; `canViewBilling(ctx)` = `isAdminLike(ctx.orgRole)`. Cite gate Go trong comment.

### 7.2 `packages/views/settings/billing/`

```
billing-tab.tsx            Tab "Thanh toán" trong Settings (chỉ render khi canViewBilling)
current-plan-card.tsx      gói hiện tại, kỳ, trạng thái pill (semantic color), nút "Đổi gói" (canManageBilling)
usage-list.tsx             mỗi entitlement quota: nhãn, used/limit dạng số inline + thanh mỏng; flag: dấu bật/tắt
plan-picker-dialog.tsx     danh sách gói từ /plans; gói cần checkout → nút "Thanh toán" gọi createCheckout; manual → changePlan
invoice-table.tsx          bảng hóa đơn, link hosted_url mở tab mới; empty state "Chưa có hóa đơn nào"
```

Route: dùng trang Settings hiện có `apps/web/app/[orgSlug]/[workspaceSlug]/settings/page.tsx`, thêm tab; không route mới (Vision: billing nằm trong ADMIN group, permission-aware). `paths.ts` không đổi.

Copy vi/en trong `packages/core/i18n/locales/`, key `billing.*`; không có chữ số giá cứng trong locale (giá đến từ API). Theo `PRODUCT.md`: không hero KPI, không màu trang trí; trạng thái `past_due`/`suspended` dùng `--uw-warning`/`--uw-danger`.

### 7.3 Xử lý `quota_exceeded` toàn cục

`packages/core/api/http.ts` → khi `ApiError.code ∈ {quota_exceeded, entitlement_required}` phát `apiErrorBus` → `packages/views/layout/entitlement-gate-toast.tsx` hiện toast có nút "Xem gói" (`canViewBilling`) hoặc "Liên hệ quản trị viên". Component gọi thao tác vẫn nhận lỗi bình thường (không nuốt).

## 8. Kế thừa từ bản cũ và cái bỏ đi

| Bản cũ (`unidigiwork`) | Xử lý |
|---|---|
| Blueprint §18 danh sách bảng và quota | Kế thừa khái niệm; gộp `subscription_items` (không cần cho gói theo ghế đơn giản) và bỏ `entitlements` snapshot (tính lúc đọc) |
| `entitlements.can(feature)`, `FeatureKind flag|quota`, `quota_limit NULL = unlimited` | Kế thừa nguyên |
| `check_quota` / `record_usage` PL/pgSQL + `07_concurrent_quota_race.sh` | Viết lại trong Go `Consume`; ma trận test race giữ nguyên ý (§9) |
| Kỳ quota = tháng dương lịch | Bỏ; kỳ = kỳ thuê bao |
| `plans.tagline`, `cta_label`, `is_featured`, `price_label` (marketing) | Bỏ; trang Pricing chưa trong phạm vi |
| `demo_requests`, lead form | Bỏ |
| Admin UI plans của bản cũ (`admin.plans.tsx`) | Chỉ giữ API admin; UI admin tối thiểu ở spec Platform Admin |

## 9. Kiểm thử và DoD

**Go (`server/internal/service`)**

- `entitlement_test.go`: bảng `effective()` (override > plan > fail-closed; status inactive → 0 trừ GRACE); `Can` flag tắt → `ErrEntitlementRequired`; `CheckQuota` NULL = unlimited, 0 = tắt; `Consume` race: 20 goroutine cùng tx delta +1 với limit 10 → đúng 10 thành công (dùng test DB thật, `-race`); idempotency key trùng → no-op.
- `billing_test.go`: `ChangePlan` đúng version / sai version 409; owner đổi gói trả phí → `checkout_required`; platform admin đổi tự do; `Cancel`/`Resume`; `ApplyProviderEvent` idempotent theo `provider_event_id`; outbox có dòng `subscription.changed` trong cùng tx (rollback → không có).
- Gate tích hợp: `workspace_test.go` — tạo workspace thứ N+1 khi `workspaces.max = N` → `quota_exceeded`; `AcceptInvite` vượt `members.max` → lỗi và **không** ghi `organization_members` (tx rollback).
- `migrations/lint_test.go` tự áp cho `058+`; test backfill `061`: mọi org có đúng 1 subscription sống.
- `arch_test.go`: file ngoài whitelist chạm `subscriptions`/`usage_*` → fail.

**Vitest**

- `api/endpoints/billing.test.ts` malformed cho 7 hàm.
- `billing/entitlements.test.ts` mirror công thức hiệu lực.
- `permissions/rules.test.ts` `canManageBilling`/`canViewBilling`.
- `views/settings/billing` render 3 trạng thái: active / past_due / không có quyền.

**E2E (Playwright, thêm vào `e2e/`)**: owner mở Settings → Thanh toán → thấy gói mặc định và usage; đổi gói manual thành công; tạo workspace vượt hạn mức (seed plan test có `workspaces.max = 1`) → toast `quota_exceeded`.

**DoD (Vision §6.9)**: OpenAPI phản ánh đủ route mới (`swagger_test.go`); mã lỗi trong bảng §4.6; migration có `.down.sql`; `quota.threshold` và `subscription.changed` trong catalogue sự kiện (`docs/conventions.md` § events, cập nhật); vi/en parity; coverage không giảm; không literal tên gói ngoài package `billing` (test mới `scripts/no-plan-literal.test.mjs`).

## 10. Câu hỏi mở (chủ sở hữu sản phẩm quyết)

1. Bộ gói và `quota_limit` cụ thể cho từng gói (Vision §4.2 để mở tới tháng 3). Spec seed `starter` unlimited để không chặn dev.
2. Cổng nội địa nào là "vnpay" đại diện: VNPay, MoMo, hay PayOS? Ảnh hưởng adapter thứ hai, không ảnh hưởng schema.
3. Khi `past_due`: khóa ngay hay có grace 7 ngày? Spec hiện: `past_due` = mọi flag tắt trừ `members.max`; đề xuất thêm `grace_until` nếu chọn grace.
4. Platform admin xác định bằng cột `users.is_platform_admin` (spec People) hay bảng riêng `platform_admins`? Spec này giả định cột.
5. Có cho org owner **tự downgrade** về gói miễn phí khi usage hiện tại đã vượt hạn mức gói đích không? Đề xuất: cho phép, chỉ chặn tạo mới (không xóa dữ liệu).
