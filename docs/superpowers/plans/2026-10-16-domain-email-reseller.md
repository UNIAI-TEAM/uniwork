# Bán tên miền và hộp thư Implementation Plan

> **Trạng thái:** in-progress — plan viết theo spec bản 2 (UNI-1808); task adapter HTTP chờ bảng §0 của spec; chưa có mã.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chủ sở hữu tổ chức mua một gói tên miền + hộp thư (mức 3 hoặc 10) trên PAVietnam, trả UniWork qua VNPay. Giá bán do UniWork đặt. Hộp thư của người mua chỉ được tạo và nối Email Hub sau khi PAVietnam báo đã xác thực.

**Architecture:** Đơn tên miền không đi `BillingService.Checkout` và không ghi `invoices`. Cùng URL IPN VNPay: billing không nhận ra `txn_ref` thì domain service xử lý và trả `00` ngay sau khi ghi `paid`. Worker (lease 10 phút) mới gọi PAVietnam. Giữ tên là cột `holds_name`, không suy từ status. Mật khẩu chỉ niêm phong hộp thư của chủ sở hữu.

**Tech Stack:** Go, pgx, sqlc, Chi, VNPay `QueryTransaction`, Email Hub `sealSecret` + `Connect`, feature flag, Next.js, `packages/views/settings`.

**Spec:** `docs/superpowers/specs/2026-10-16-domain-email-reseller-design.md` (bản 2, UNI-1808).

**Cổng adapter:** Task 15 (HTTP thật tới PAVietnam) không được làm khi bảng §0 của spec còn trống. Task 1–14 dùng `registrar.Fake`. Cờ `domain_reseller` mặc định tắt. Không bịa đường dẫn API.

## Không làm trong plan này

Nhắc gia hạn trước 30 ngày, hóa đơn cho khách, và hóa đơn điện tử là nợ đã ghi trong spec §12, hạn rà 2026-12-31. Không có task. Ngoài phạm vi luôn: ghi DNS, tự gia hạn, tự hoàn tiền, nối hộp thư thêm cho thành viên khác, gán hộp thư, đổi mật khẩu, đổi registrant, gộp vào gói SaaS, mục sidebar, tải giấy tờ `.vn` lên UniWork.

## Ràng buộc toàn cục

- Không `FOREIGN KEY`. Mỗi index một file `CREATE INDEX CONCURRENTLY` và một `.down.sql`.
- `domain_packages`, `domain_package_prices` không có `organization_id` — thêm vào `tenantExemptTables` với lý do "bảng giá nền tảng, cùng loại với plans".
- Ba bảng còn lại có `organization_id TEXT NOT NULL`. `domain_orders.created_by` đi với `created_by_kind`.
- Query tenant có `organization_id = $n` hoặc `-- tenant: platform` / `-- tenant: system`.
- `password_enc` và `registrant_id_number_enc` là TEXT base64, cùng `sealSecret` của Email Hub. Không BYTEA.
- Log và audit không có giá vốn, mật khẩu, số giấy tờ, registrant, URL có token.
- Handler chỉ dựng actor bằng `service.Human`. Worker dùng `audit.System("domains")`. IPN dùng `audit.System("billing")`.
- Không gọi PAVietnam trong transaction hay khi đang `FOR UPDATE`. Claim rồi commit, rồi mới HTTP.
- File view tách sẵn: `domains-tab.tsx`, `domain-checkout-form.tsx`, `domain-order-list.tsx`. Mỗi file dưới 500 dòng. Chữ UI qua `t()`, cả `en` và `vi`.
- Commit không gõ trailer `Refs`. Không `--no-verify`.

## Review

- `pending_verification` không tạo hộp thư. Chỉ `Registration.Status == active` mới `CreateMailbox`.
- `register_failed` giữ `holds_name = true`. `expired` và `paid_after_expiry` đặt `holds_name = false` và `released_at`.
- IPN trả `00` trước Register. Worker mới Register.
- Intent hết hạn không nhả tên ngay: QueryDr trước. QueryDr không hỏi được thì đợi 2 giờ.
- Ghế thêm: `password_enc` NULL, status `provisioned`, mật khẩu chỉ trong SDO một lần. Không `needs_connect`.
- `workspace_id` null được. Connect không có workspace còn sống thì `workspace_required`, không gọi Email Hub.

## Cấu trúc file

| File | Việc |
| --- | --- |
| `server/migrations/9991792300000000`–`0014` | Bảng và index |
| `server/internal/registrar/registrar.go` | Interface, tên miền, registrant |
| `server/internal/registrar/fake.go` | Fake cho test và khi chưa cấu hình |
| `server/internal/registrar/pavietnam/` | Chỉ Task 15 |
| `server/internal/service/domain_*.go` | Offer, checkout, IPN, worker, mailbox |
| `server/internal/handler/domains.go` | Route tổ chức |
| `server/internal/handler/admin_domains.go` | Giá và danh sách kẹt |
| `packages/views/settings/components/domains-*.tsx` | Ba màn |

---

### Task 1: Migration

**Files:**
- Create: `server/migrations/9991792300000000_domain_packages.up.sql` và `.down.sql`
- Create: `9991792300000001_domain_package_prices`
- Create: `9991792300000002_domain_orders`
- Create: `9991792300000003_domain_orders_holds_name_unique` (một lệnh CONCURRENTLY)
- Create: `9991792300000004_domain_orders_status_claimed`
- Create: `9991792300000005_domain_payment_intents`
- Create: `9991792300000006_domain_payment_intents_txn_unique`
- Create: `9991792300000007_domain_payment_intents_status_expires`
- Create: `9991792300000008_domain_mailboxes`
- Create: `9991792300000009_domain_mailboxes_local_unique`
- Modify: `server/migrations/lint_test.go` (`tenantExemptTables`)

- [ ] **Step 1: Bảng gói và giá**

`domain_packages`: `id`, `code TEXT UNIQUE NOT NULL`, `mailbox_count INT NOT NULL CHECK (mailbox_count > 0)`, `is_default BOOLEAN NOT NULL DEFAULT false`, `active`, `created_at`, `updated_at`.

Index riêng: unique `code`; unique partial `is_default` WHERE true.

Seed trong file bảng, không seed giá:

```sql
INSERT INTO domain_packages (id, code, mailbox_count, is_default, active)
VALUES
  ('01DOMAINPKGMAILBOX003', 'mailboxes_3', 3, true, true),
  ('01DOMAINPKGMAILBOX010', 'mailboxes_10', 10, false, true);
```

`domain_package_prices`: `id`, `package_id`, `tld`, `currency TEXT NOT NULL DEFAULT 'VND'`, `retail_amount BIGINT NOT NULL CHECK (retail_amount > 0)`, `wholesale_amount BIGINT NOT NULL CHECK (wholesale_amount >= 0)`, `active`, timestamps. Unique `(package_id, tld)`.

- [ ] **Step 2: Đơn**

```sql
CREATE TABLE domain_orders (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT,
  domain_name TEXT NOT NULL,
  tld TEXT NOT NULL,
  package_id TEXT NOT NULL,
  mailbox_quota INT NOT NULL,
  owner_local_part TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  registrant JSONB NOT NULL,
  registrant_id_number_enc TEXT,
  retail_amount BIGINT NOT NULL,
  wholesale_amount BIGINT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  holds_name BOOLEAN NOT NULL DEFAULT true,
  provider_ref TEXT,
  kyc_url TEXT,
  expires_at TIMESTAMPTZ,
  attention_reason TEXT,
  claimed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`status` thuộc `pending_payment`, `paid`, `pending_verification`, `active`, `needs_attention`, `expired`. `attention_reason` null hoặc `register_failed` hoặc `paid_after_expiry`.

Index file riêng:

```sql
CREATE UNIQUE INDEX CONCURRENTLY idx_domain_orders_name_held
  ON domain_orders (domain_name) WHERE holds_name;
CREATE INDEX CONCURRENTLY idx_domain_orders_status_claimed
  ON domain_orders (status, claimed_at);
```

- [ ] **Step 3: Intent và hộp thư**

`domain_payment_intents`: `organization_id`, `domain_order_id`, `provider`, `provider_txn_ref`, `provider_order_info TEXT NOT NULL`, `amount`, `currency`, `status` (`pending`/`completed`/`failed`/`expired`), `expires_at`, `completed_at`, `reconcile_attempted_at`, `created_at`. Unique `provider_txn_ref`. Index `(status, expires_at)`.

`domain_mailboxes`: `organization_id`, `domain_order_id`, `workspace_id`, `local_part`, `address`, `for_owner BOOLEAN`, `password_enc TEXT`, `status` (`provisioned`/`needs_connect`/`active`), `created_by`, `created_by_kind`, timestamps. Unique `(domain_order_id, local_part)`.

- [ ] **Step 4: Miễn tenant cho catalog**

Trong `tenantExemptTables` thêm hai dòng, lý do "bảng giá nền tảng, cùng loại với plans".

- [ ] **Step 5: Chạy lint migration**

Run: `cd server && go test ./migrations/ -run 'TestNewTablesCarryOrganizationID|TestEveryBusinessTable' -count=1`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/migrations
git commit -m "$(cat <<'EOF'
feat(domains): add package, order, and mailbox tables

Catalog prices stay platform-wide. Name holds are a boolean, not a status.
EOF
)"
```

---

### Task 2: Cờ và ba biến môi trường

**Files:**
- Modify: `server/internal/featureflags/keys.go`
- Modify: `.env.example`
- Modify: `server/internal/config/config.go` (chỗ đọc env hiện có)

- [ ] **Step 1: Cờ**

Thêm vào slice flag:

```go
{Key: "domain_reseller", Description: "Tab Tên miền và gợi ý Email Hub khi tổ chức mua tên miền PAVietnam", Default: false, Public: true, Owner: "billing", ReviewAt: day(2026, 12, 31)},
```

- [ ] **Step 2: Env**

Trong `.env.example`, cạnh khối billing:

```
# PAVietnam reseller. Empty base hides the domain tab even when the flag is on.
PAVIETNAM_API_BASE=
PAVIETNAM_API_USER=
PAVIETNAM_API_KEY=
```

Không thêm biến `*_PATH`.

- [ ] **Step 3: Test cờ và env**

Run: `cd server && go test ./internal/featureflags/ -run TestFlagsAreReviewed -count=1`

Run: `node --test scripts/env-example.test.mjs`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/featureflags/keys.go server/internal/config .env.example
git commit -m "$(cat <<'EOF'
feat(domains): gate the reseller on a flag and three env vars

Missing config or a disabled flag hides the feature. API paths stay in code.
EOF
)"
```

---

### Task 3: Interface registrar và Fake

**Files:**
- Create: `server/internal/registrar/registrar.go`
- Create: `server/internal/registrar/fake.go`
- Create: `server/internal/registrar/registrar_test.go`
- Test: `server/internal/arch_test.go` — `TestRegistrarClientOnlyInRegistrar`

- [ ] **Step 1: Viết test arch fail**

Trong `arch_test.go`, cấm `net/http` trong `internal/service` tới host PAVietnam, và cấm import `internal/registrar/pavietnam` ngoài package registrar. Tên test: `TestRegistrarClientOnlyInRegistrar`.

- [ ] **Step 2: Interface đúng spec §5**

```go
type Client interface {
    Check(ctx context.Context, domain string, packageCode string) (Quote, error)
    Register(ctx context.Context, domain string, packageCode string, reg Registrant) (Registration, error)
    Status(ctx context.Context, providerRef string) (Registration, error)
    CreateMailbox(ctx context.Context, providerRef, localPart string) (Mailbox, error)
}

type Quote struct {
    Available       bool
    WholesaleAmount int64
}

type Registration struct {
    ProviderRef string
    Status      string // pending_verification | active
    KYCURL      string
    ExpiresAt   *time.Time
}

type Mailbox struct {
    Address  string
    Password string
    IMAPHost string
    IMAPPort int
    SMTPHost string
    SMTPPort int
}
```

`SplitDomain` lấy đuôi dài nhất có trong bảng giá (`com.vn` trước `vn`). `NormalizeDomain` chữ thường, không scheme, không path.

- [ ] **Step 3: Fake**

`Fake` cho phép set Available, Wholesale, Status, lỗi theo tên. `Register` cùng tên lần hai trả cùng `ProviderRef` (idempotent). `CreateMailbox` cùng local-part trả cùng mật khẩu.

- [ ] **Step 4: Chạy test**

Run: `cd server && go test ./internal/registrar/ ./internal/ -run 'TestRegistrar|TestSplitDomain' -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/registrar server/internal/arch_test.go
git commit -m "$(cat <<'EOF'
feat(domains): add the registrar interface and an idempotent fake

The live HTTP client stays out until the partner document answers the open questions.
EOF
)"
```

---

### Task 4: sqlc

**Files:**
- Create: `server/pkg/db/queries/domains.sql`
- Modify: generated sqlc (qua `make sqlc`)

- [ ] **Step 1: Query**

Viết query cho: list packages active; list prices active; get price by package+tld; insert/get/update order; claim order:

```sql
-- name: ClaimDomainOrder :one
-- tenant: system
UPDATE domain_orders
SET claimed_at = now(), updated_at = now()
WHERE id = (
  SELECT id FROM domain_orders
  WHERE status = $1
    AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

Intent: insert, get by txn ref, list pending expired, mark completed/failed/expired, set `reconcile_attempted_at`.

Mailbox: insert, list by order, count by order.

Mọi query đụng `organization_id` có `$n` hoặc `-- tenant: system` (worker) / `-- tenant: platform` (admin giá).

- [ ] **Step 2: Generate**

Run: `make sqlc`

Run: `cd server && go test ./migrations/ -run TestEveryQueryNamesItsTenant -count=1`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/pkg/db/queries/domains.sql server/pkg/db/generated
git commit -m "$(cat <<'EOF'
feat(domains): add sqlc queries with a ten-minute claim lease

Workers claim a row and commit before any registrar call.
EOF
)"
```

---

### Task 5: Offer và registrant

**Files:**
- Create: `server/internal/service/domain_offer.go`
- Create: `server/internal/service/domain_registrant.go`
- Test: `server/internal/service/domain_offer_test.go`

- [ ] **Step 1: Test fail**

`Offers` từ chối tên xấu (`invalid_domain`), đuôi không có giá (`tld_not_priced`), giá vốn 0 hoặc giá vốn lớn hơn giá bán (`price_not_priced` không — mã là `price_not_sellable`), tên `holds_name` (`domain_held`), Check báo hết (`domain_unavailable`). Kết quả không có `wholesale_amount`. Registrant tổ chức thiếu mã số thuế → `registrant_invalid`. Cá nhân thiếu số giấy tờ → cùng mã. Số giấy tờ không nằm trong JSON registrant.

- [ ] **Step 2: Implement**

`DomainService.Offers` gọi `Check` từng gói active có giá bán được. Thuê bao tổ chức không tham gia.

`validateRegistrant` nhận `kind` `organization|individual`, `legal_name`, `address`, `email`, `phone`; tổ chức thêm `tax_code`; cá nhân nhận số giấy tờ riêng để niêm phong, không ghi vào JSON.

- [ ] **Step 3: Test pass**

Run: `cd server && go test ./internal/service/ -run 'TestDomainOffer|TestRegistrant' -count=1`

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/domain_offer.go server/internal/service/domain_registrant.go server/internal/service/domain_offer_test.go
git commit -m "$(cat <<'EOF'
feat(domains): quote sellable packages and seal the registrant id

Wholesale stays inside the service. An unsellable tier is omitted, not discounted.
EOF
)"
```

---

### Task 6: Checkout

**Files:**
- Create: `server/internal/service/domain_checkout.go`
- Test: `server/internal/service/domain_checkout_test.go`

- [ ] **Step 1: Test fail**

Cùng tổ chức, đơn `pending_payment`, intent `pending` chưa hết hạn, cùng gói và local-part → trả lại URL, không tạo đơn thứ hai.

Intent hết hạn → `QueryTransaction` một lần. Chưa trả → hết hạn intent cũ, tạo intent mới trên cùng đơn, được đổi gói và local-part. Đã trả → `already_paid`. QueryDr lỗi → `billing_provider_unavailable`.

Tổ chức khác hoặc status khác `pending_payment` → `domain_held`.

Checkout ghi `registrant` JSON, `registrant_id_number_enc`, `retail_amount`, `wholesale_amount`, `holds_name true`, `provider_order_info = "UniWork domain " + domain`. `CreateCheckout` nhận `CreatedAt` và `ExpiresAt` (15 phút). Không có dòng `invoices`.

- [ ] **Step 2: Implement theo bảng spec §6.2**

Dùng `billing.Provider.CreateCheckout`. Type-assert `*billing.VNPay` chỉ khi cần QueryDr, cùng chỗ `billing_vnpay_query.go`.

- [ ] **Step 3: Test pass và commit**

```bash
git add server/internal/service/domain_checkout.go server/internal/service/domain_checkout_test.go
git commit -m "$(cat <<'EOF'
feat(domains): reuse an open domain checkout before asking VNPay again

A second payment link is created only after QueryDr says the first was not paid.
EOF
)"
```

---

### Task 7: IPN — trả 00 trước khi Register

**Files:**
- Create: `server/internal/service/domain_ipn.go`
- Modify: `server/internal/handler/billing_vnpay_webhook.go` (sau khi billing trả không nhận ra txn)
- Test: `server/internal/service/domain_ipn_test.go`

- [ ] **Step 1: Test bảng spec §6.3**

| Tình huống | Mã | DB |
| --- | --- | --- |
| Không có txn | `01` | không ghi |
| Sai checksum | `97` | không ghi |
| Sai số tiền | `04` | không ghi `paid` |
| Đúng, intent pending | `00` | intent `completed`, đơn `paid`, `holds_name` true |
| Gọi IPN lần hai | `02` | không đổi |
| Intent đã `expired`, QueryDr hoặc IPN báo đã trả | `00` | intent `completed`, đơn `needs_attention`, reason `paid_after_expiry`, `holds_name` false |
| Đơn đã `active` | `02` | không gọi Register |

Assert test: sau `00`, fake registrar có 0 lần `Register`.

- [ ] **Step 2: Implement `HandlePaid`**

Trong một transaction: khóa intent, áp bảng trên, `audit.Record` action `domain_order.paid` hoặc `domain_order.needs_attention`, metadata `source=ipn`, `attention_reason` khi có. Không có registrant, giá vốn. Actor `audit.System("billing")`.

Webhook handler: billing trả lỗi không nhận txn thì gọi domain `HandlePaid`. Domain cũng không có txn thì mới `01`.

- [ ] **Step 3: Commit**

```bash
git add server/internal/service/domain_ipn.go server/internal/handler/billing_vnpay_webhook.go server/internal/service/domain_ipn_test.go
git commit -m "$(cat <<'EOF'
feat(domains): confirm a domain payment before any registrar call

The IPN returns 00 after the order is paid. Registration runs on the worker.
EOF
)"
```

---

### Task 8: Worker — QueryDr và Register

**Files:**
- Create: `server/internal/service/domain_worker.go`
- Modify: `server/cmd/server/main.go` (goroutine cạnh `billingSvc.RunWorkers`, cùng `shutdownCtx`)
- Test: `server/internal/service/domain_worker_test.go`

- [ ] **Step 1: Test reconcile**

Intent pending quá hạn, QueryDr bảo đã trả → cùng kết quả Task 7 (`paid` hoặc `paid_after_expiry` nếu đã release). QueryDr lỗi → chỉ ghi `reconcile_attempted_at`, không nhả tên. Quá 2 giờ kể từ `expires_at` mà QueryDr vẫn lỗi → đơn `expired`, `holds_name false`, `released_at` set.

- [ ] **Step 2: Test register**

Đơn `paid`, `provider_ref` rỗng: claim, commit, rồi `Register`. Status `pending_verification` → lưu ref, `kyc_url`, `expires_at`, không có dòng `domain_mailboxes`. Status `active` để Task 9.

`Register` lỗi → `needs_attention`, reason `register_failed`, `holds_name` vẫn true. Audit `domain_order.needs_attention`, metadata `source=worker`, `attention_reason=register_failed`.

Hai worker: fake đếm `Register` đúng 1 nhờ claim.

- [ ] **Step 3: `RunWorkers` mỗi 60 giây**

Thứ tự một nhịp: reconcile intent → register đơn `paid` chưa có ref → poll `pending_verification` (Task 9).

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/domain_worker.go server/cmd/server/main.go server/internal/service/domain_worker_test.go
git commit -m "$(cat <<'EOF'
feat(domains): register a paid domain outside the payment request

A failed register keeps the name hold so the owner can retry without a second charge.
EOF
)"
```

---

### Task 9: Kích hoạt sau xác thực và nối hộp thư chủ

**Files:**
- Modify: `server/internal/service/domain_worker.go`
- Create: `server/internal/service/domain_mailbox.go`
- Test: cùng file test worker

- [ ] **Step 1: Test poll**

`Status` còn `pending_verification` → không `CreateMailbox`. `Status` `active` → một mailbox `for_owner`, `password_enc` khác rỗng, status `needs_connect` rồi `active` nếu `Connect` thành công.

Workspace đã xóa → hộp thư `needs_connect`, đơn vẫn `active`, không gọi `Connect`. Owner gọi connect sau với `workspace_id`.

`CreateMailbox` lỗi sau khi status đã `active` → `needs_attention` không dùng ở đây: đơn đã `active`, lần sau claim mailbox chưa có. Test: gọi worker lần hai không tạo hộp thư thứ hai (idempotent).

- [ ] **Step 2: Nối**

`Connect` của Email Hub với host/port từ `Mailbox`. Mất `workspace_id` hoặc workspace không còn → lỗi `workspace_required` cho route connect thủ công.

Audit `domain_mailbox.connected`, metadata `source=worker` hoặc `owner`, không mật khẩu.

- [ ] **Step 3: Commit**

```bash
git add server/internal/service/domain_worker.go server/internal/service/domain_mailbox.go server/internal/service/domain_worker_test.go
git commit -m "$(cat <<'EOF'
feat(domains): open the owner mailbox only after the registrar verifies

A pending verification stores the KYC link and does not create mail.
EOF
)"
```

---

### Task 10: Thêm hộp thư và connect lại

**Files:**
- Modify: `server/internal/service/domain_mailbox.go`
- Test: `server/internal/service/domain_mailbox_test.go`

- [ ] **Step 1: Test**

Đơn chưa `active` → `domain_not_active`. Đủ quota → `mailbox_quota_exceeded`. Local-part trùng hoặc sai → `invalid_local_part`.

Thêm ghế: status `provisioned`, `password_enc` NULL, `for_owner` false. SDO có `initial_password` một lần. Lần GET sau không có mật khẩu và không có trong DB.

Connect ghế `provisioned` → từ chối (không có mật khẩu để nối). Connect hộp thư chủ `needs_connect` dùng `password_enc`.

- [ ] **Step 2: Commit**

```bash
git add server/internal/service/domain_mailbox.go server/internal/service/domain_mailbox_test.go
git commit -m "$(cat <<'EOF'
feat(domains): leave extra seats unconnected and forget their passwords

Only the owner's mailbox keeps a sealed password so reconnect can run.
EOF
)"
```

---

### Task 11: HTTP tổ chức và admin

**Files:**
- Create: `server/internal/handler/domains.go`
- Create: `server/internal/handler/admin_domains.go`
- Modify: `server/internal/handler/router/` (đăng ký route, `pathParamSDI`)
- Create: `server/internal/handler/dto/sdi/domain_order.go`, `sdo/domain_order.go`
- Modify: `server/internal/handler/router/openapi.go` — case `"orgID,domainOrderID"` và `"orgID,domainOrderID,mailboxID"`

Route:

| Method | Path | Ai |
| --- | --- | --- |
| GET | `/api/v1/orgs/{orgID}/domain-offers?domain=` | owner, cờ và config |
| POST | `/api/v1/orgs/{orgID}/domain-orders` | owner |
| GET | `/api/v1/orgs/{orgID}/domain-orders` | owner |
| GET | `/api/v1/orgs/{orgID}/domain-orders/{domainOrderID}` | owner |
| POST | `.../mailboxes` | owner |
| POST | `.../mailboxes/{mailboxID}/connect` | owner |
| GET | `/api/v1/admin/domain-package-prices` | support |
| POST | `/api/v1/admin/domain-package-prices` | admin, `reason` ≥ 10 |
| GET | `/api/v1/admin/domain-orders?status=` | support, mặc định `needs_attention` |

- [ ] **Step 1: Test handler**

Thiếu cờ hoặc thiếu config: GET offer `enabled: false`, POST 404. Member không phải owner: 403. Offer không trả giá vốn, số giấy tờ, URL KYC đầy đủ — KYC URL chỉ trên GET chi tiết đơn của owner. SDO registrant chỉ `kind`, `legal_name`, và `id_number_last3` khi là cá nhân.

Admin GET đơn không có registrant, không giá vốn. Admin POST giá: `wholesale > retail` hoặc wholesale 0 → 400. Audit `domain_package_price.upserted` kèm reason.

Rate limit offer: `RateLimitByIdentityBucket` bucket `domain-offers`, 20/phút. Không Redis thì không limit.

- [ ] **Step 2: `pathParamSDI`**

Case gộp tên param theo thứ tự trong path, không thêm case một mình `domainOrderID` nếu path luôn có `orgID` trước.

- [ ] **Step 3: Commit**

```bash
git add server/internal/handler server/internal/handler/dto
git commit -m "$(cat <<'EOF'
feat(domains): expose owner checkout and admin price edits

The public offer hides wholesale. Admin lists stuck orders without registrant data.
EOF
)"
```

---

### Task 12: Cô lập, audit, metric

**Files:**
- Modify: `server/internal/handler/isolation_matrix_test.go` (`isoUnseeded`)
- Create: `server/internal/service/domain_isolation_test.go`
- Modify: `server/internal/service/audit_coverage_test.go`, `server/internal/audit/actions.go`
- Modify: `deploy/alerts.yml`
- Create: `docs/runbooks/DomainOrderNeedsAttention.md`

- [ ] **Step 1: Audit actions**

`domain_order.created`, `domain_order.paid`, `domain_order.registered`, `domain_order.needs_attention`, `domain_mailbox.created`, `domain_mailbox.connected`, `domain_package_price.upserted`. Mỗi action có trong `auditActions()` và có một lệnh gọi.

- [ ] **Step 2: Isolation**

`isoUnseeded` thêm `domain_orders`, `domain_payment_intents`, `domain_mailboxes`, lý do "checkout cần cổng thanh toán; ma trận không chạy thanh toán".

`TestDomainIsolation`: org B gọi offer/GET/POST với id đơn của A → 404, body không chứa tên miền của A. Bật cờ và fake trong test.

- [ ] **Step 3: Metric và runbook**

Gauge `uniwork_domain_orders_needs_attention`. Counter `uniwork_domain_registrar_calls_total{op,result}`.

Alert trong `deploy/alerts.yml`:

```yaml
- alert: DomainOrderNeedsAttention
  expr: uniwork_domain_orders_needs_attention > 0
  for: 5m
  labels:
    severity: "2"
  annotations:
    summary: "Có đơn tên miền cần người xử lý"
    description: "{{ $value | printf \"%.0f\" }} đơn needs_attention quá 5 phút; không hoàn tiền tự động."
    runbook_url: https://github.com/UNIAI-TEAM/uniwork/blob/develop/docs/runbooks/DomainOrderNeedsAttention.md
```

Runbook bốn mục: Triệu chứng, Kiểm tra, Khắc phục, Leo thang. Khắc phục nói rõ `register_failed` (giữ tên, đăng ký lại) và `paid_after_expiry` (đã nhả tên, không Register lại trên đơn đó).

- [ ] **Step 4: Test**

Run: `node --test scripts/alerts-runbooks.test.mjs`

Run: `cd server && go test ./internal/service/ -run 'TestDomainIsolation|TestAudit' -count=1`

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/isolation_matrix_test.go server/internal/service/domain_isolation_test.go server/internal/audit deploy/alerts.yml docs/runbooks/DomainOrderNeedsAttention.md
git commit -m "$(cat <<'EOF'
feat(domains): alert when a paid domain order needs a person

Stuck orders stay visible to support without exposing the registrant snapshot.
EOF
)"
```

---

### Task 13: Client API

**Files:**
- Create: `packages/core/api/endpoints/domains.ts`
- Create: `packages/core/api/endpoints/domains.test.ts`
- Create: `packages/core/domains/hooks.ts`

- [ ] **Step 1: Test malformed**

`parseWithFallback`: offer thiếu `sellable` → mảng rỗng và `enabled: false`. Đơn thiếu `status` → bỏ qua dòng đó. Không cast JSON.

- [ ] **Step 2: Hook**

`domainKeys` gồm `organizationId`. Offer, list, create order, add mailbox, connect. Poll list khi còn đơn `paid` hoặc `pending_verification`: `refetchInterval: 30_000`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/api/endpoints/domains.ts packages/core/api/endpoints/domains.test.ts packages/core/domains
git commit -m "$(cat <<'EOF'
feat(domains): parse domain offers without throwing on a short payload

Checkout keeps working when an older client meets a newer order shape.
EOF
)"
```

---

### Task 14: Tab Tên miền và thẻ gợi ý

**Files:**
- Create: `packages/views/settings/components/domains-tab.tsx`
- Create: `packages/views/settings/components/domain-checkout-form.tsx`
- Create: `packages/views/settings/components/domain-order-list.tsx`
- Modify: `packages/views/settings/components/settings-page.tsx`
- Modify: `packages/views/email-hub/email-hub-connect-empty.tsx`
- Modify: `packages/core/i18n/locales/en/settings.json`, `vi/settings.json`
- Test: `packages/views/settings/components/domains-tab.test.tsx`

- [ ] **Step 1: Test fail**

Cờ tắt hoặc `enabled: false` → không có tab. Owner thấy tab cạnh Billing, icon `Globe`. Form ba bước: tên miền và giá, registrant, local-part rồi thanh toán. Bước giá không có ô local-part.

Đơn `pending_verification` hiện câu: chưa có hộp thư cho đến khi xác thực xong, kèm link KYC.

Hai câu `needs_attention`: `register_failed` ("đã nhận tiền, đăng ký nhà cung cấp chưa xong") và `paid_after_expiry` ("thanh toán tới sau khi tên đã được nhả").

Không có đơn `holds_name` → thẻ gợi ý trên Email Hub, icon `Globe`, không icon module mới.

- [ ] **Step 2: Implement**

Gate tab bằng cờ public `domain_reseller` và `enabled` từ GET offer (gọi offer với domain rỗng chỉ để biết `enabled`, hoặc field trên GET đơn — chọn GET `/domain-orders` trả `enabled`). Ẩn tab khi false, cùng cơ chế `useHiddenGates` nếu gate org_owner đã có; member thường không thấy vì gate `org_owner`.

- [ ] **Step 3: Test pass**

Run: `pnpm exec vitest run packages/views/settings/components/domains-tab.test.tsx packages/core/api/endpoints/domains.test.ts`

- [ ] **Step 4: Commit**

```bash
git add packages/views/settings packages/views/email-hub packages/core/i18n
git commit -m "$(cat <<'EOF'
feat(domains): add the organization domain tab and the Email Hub suggestion

Owners see the price before naming a mailbox. Verification copy says mail waits.
EOF
)"
```

---

### Task 15: Adapter PAVietnam — chặn bởi spec §0

Không bắt đầu task này khi bảng câu hỏi trong spec §0 chưa được điền từ tài liệu đối tác.

Khi tài liệu có:

- [ ] Tạo `server/internal/registrar/pavietnam/client.go`. Hằng số đường dẫn nằm một file `paths.go`, chép từ tài liệu, không từ env.
- [ ] Auth theo câu trả lời Q1. Timeout 15 giây. Đo counter `op`/`result`.
- [ ] Map lỗi nhà cung cấp sang lỗi đã có (`domain_unavailable`, `registrar_unavailable`). Không thêm mã mới nếu tài liệu không buộc.
- [ ] Test httptest: request không ghi API key ra log; `Register` và `CreateMailbox` idempotent theo tài liệu (Q6).
- [ ] `Configured()` đúng khi cả ba env khác rỗng và cờ bật. Thiếu một cái → client không được gắn, service dùng trạng thái tắt (404 / `enabled: false`).

```bash
git add server/internal/registrar/pavietnam
git commit -m "$(cat <<'EOF'
feat(domains): call the PAVietnam API from the partner document

Paths live in one file so a doc change does not touch the order service.
EOF
)"
```

---

## Self-review

- Spec §6.1–§6.7 có task: offer (5), checkout (6), IPN (7), worker register và poll (8, 9), mailbox (10).
- Spec §4 schema nằm ở Task 1. Không còn `kyc_due_at`, `suspended`, hay BYTEA.
- Placeholder: Task 15 cố ý không có mã HTTP vì spec cấm đoán đường dẫn. Các task kia không phụ thuộc nó.
- Type name thống nhất: `DomainService`, `registrar.Client`, `holds_name`, `attention_reason`.
