# UniWork — Bán tên miền và hộp thư PAVietnam

> **Trạng thái:** in-progress — thiết kế duyệt 2026-10-16; bản 2 cùng ngày sau khi đối chiếu mã (§13 liệt kê thay đổi). Plan đã viết theo interface §5: `docs/superpowers/plans/2026-10-16-domain-email-reseller.md`. Task adapter HTTP vẫn chờ bảng §0. Chưa có mã.

**Ngày:** 2026-10-16 (bản 2)
**Issue:** UNI-1808. Nhánh `feature/UNI-1808-ban-ten-mien-va-hop-thu-pavietnam`.
**Spec liên quan:** `2026-09-04-tenant-subscription-entitlement-design.md` (gói SaaS, `BillingService.Checkout`, IPN VNPay), `2026-10-11-email-hub-oauth-custom-server-design.md` (nối IMAP/SMTP tên miền riêng).

## 0. Điều kiện tiên quyết (chặn plan)

Bản này đã chốt luồng tiền, máy trạng thái đơn, dữ liệu và chỗ đặt trong UI. Một thứ chưa chốt được vì thiếu dữ liệu: hình dạng API PAVietnam. Tài liệu API đại lý v4 chỉ cấp cho đối tác và không có trong repo. Plan triển khai phần UniWork theo interface §5 và fake; task adapter HTTP không được bắt đầu khi bảng dưới còn trống. Dev nhận tài liệu, trả lời bảng, cập nhật §4.2 (cột `registrant`) và §5, rồi mới viết `pavietnam/paths.go`. Không đoán đường dẫn.

| # | Câu hỏi | Chỗ ảnh hưởng |
|---|---|---|
| Q1 | Xác thực API bằng gì (user + key, HMAC, token)? Có whitelist IP không? | §5 adapter, §11 biến môi trường, IP egress cố định khi deploy |
| Q2 | Đăng ký tên miền cần những trường registrant nào, cho cá nhân và tổ chức, `.vn` và quốc tế? | §4.2 `registrant`, §6.2 form, §7 SDI |
| Q3 | Với `.vn`, PAVietnam có trả URL nộp giấy tờ không, hay UniWork phải nhận file? | D2, §6.3 `kyc_url`. Nếu phải nhận file thì spec này phải sửa lại, không làm tiếp |
| Q4 | Kiểm tra tên còn trống có trả giá vốn không? Giá vốn gói email lấy ở đâu? | §5 `Check`, §6.1 |
| Q5 | Mã sản phẩm gói email tương ứng 3 và 10 hộp thư | bảng map trong adapter |
| Q6 | Tạo hộp thư: gọi lại cùng local-part có idempotent không? Mật khẩu do ai sinh? | §6.4, §6.5 |
| Q7 | Trạng thái đơn đăng ký đọc qua API nào? Giá trị nào là "chờ giấy tờ", giá trị nào là "đã hoạt động"? | §5 `Status`, §6.4 |
| Q8 | Có môi trường sandbox không? | §10 test adapter |

## 1. Mục tiêu

Chủ tổ chức mua tên miền và một gói hộp thư ngay trong UniWork. Khách trả UniWork. PAVietnam là nhà cung cấp. Website của khách nằm ngoài UniWork; đợt này không ghi DNS.

Thành công khi:

- Chủ tổ chức tìm một tên miền, thấy giá UniWork của từng mức hộp thư, khai thông tin chủ thể, đặt tên hộp thư của mình, trả qua VNPay.
- Sau khi tiền vào, UniWork đặt hàng PAVietnam và đưa link xác thực giấy tờ. Chưa xác thực xong thì chưa có hộp thư.
- Khi tên miền hoạt động, hộp thư của người mua xuất hiện trong Email Hub mà họ không nhập máy chủ.
- Một tổ chức mua được nhiều tên miền. Suất hộp thư còn lại thêm sau, không tự nối vào Email Hub của người khác.
- Người không phải chủ tổ chức, và tổ chức khác, không thấy đơn, giá vốn, mật khẩu, số định danh.
- Không có đồng tiền nào vào mà không có đơn đi tiếp hoặc không có người được báo: mọi đơn đã thu tiền hoặc tới `active`, hoặc tới `needs_attention` và kéo alert.

## 2. Hiện trạng (2026-10-16)

- Email Hub nối hộp thư có sẵn. `EmailHubService.Connect` (`server/internal/service/email_hub_connect.go`) nhận địa chỉ, mật khẩu và máy chủ IMAP/SMTP, kiểm tra đăng nhập, niêm mật khẩu bằng `sealSecret` (base64 của `secretbox`), ghi audit. Yêu cầu actor là thành viên workspace và `Enabled()` (có `EMAIL_HUB_CREDENTIAL_KEY`). Không tạo hộp thư.
- `BillingService.Checkout` (`server/internal/service/billing_checkout.go`) đổi gói SaaS. `invoices.subscription_id` là `NOT NULL`. `billing_payment_intents` bắt buộc `subscription_id` và `plan_id`. `billing.CheckoutInput` nhận `IntentID`, `Amount`, `Currency`, `OrderInfo`, `ClientIP`, `CreatedAt`, `ExpiresAt`; VNPay dùng hai mốc thời gian làm `vnp_CreateDate` và `vnp_ExpireDate`.
- IPN VNPay là một URL: `POST/GET /api/v1/billing/webhooks/vnpay`. `HandleProviderWebhook` trả `01` và **rollback** dòng `webhook_inbox` khi `vnp_TxnRef` không khớp ý định gói (`errUnknownTxnRef`), nên một service khác có thể nhận tiếp cùng sự kiện.
- Billing coi intent `expired` **vẫn trả được** (`applyProviderEvent`: "a superseded checkout can still be paid") và có worker hỏi lại VNPay bằng QueryDr cho intent không nhận IPN (`ProcessStalePaymentIntentReconcile`, claim bằng `reconcile_attempted_at` + `FOR UPDATE SKIP LOCKED`). Đơn tên miền giữ cùng chuẩn.
- Worker nền theo mẫu `billingSvc.RunWorkers(runCtx)` + kênh done được chờ trong chuỗi tắt của `server/cmd/server/main.go`.
- `organizations` chỉ có `slug`, `name`. Không có pháp nhân, địa chỉ, mã số thuế. Thông tin chủ thể đăng ký phải thu lúc mua.
- Feature flag khai ở `server/internal/featureflags/keys.go` với `ReviewAt`; override user > organization > global; `GET /api/v1/config` đưa flag `Public` xuống `FeatureFlagsProvider`.
- Tab Thanh toán và Hóa đơn nằm nhóm Tổ chức trong `packages/views/settings/components/settings-page.tsx`. Cổng `org_owner` đã có (tab Quyền riêng tư), `useHiddenGates` ẩn tab khi vai không đủ.
- Chưa có bảng tên miền, chưa có client HTTP tới PAVietnam.

## 3. Quyết định đã chốt

| # | Quyết định |
|---|---|
| D1 | UniWork là người bán. Giá khách thấy do UniWork đặt, theo đuôi miền và theo mức hộp thư. Giá đại lý chỉ lưu trên đơn, không có trong JSON trả về web. |
| D2 | Bán `.vn` và tên miền quốc tế. Giấy tờ `.vn` nộp qua URL do PAVietnam trả (Q3). UniWork giữ thông tin chủ thể đã khai, số định danh được niêm; không nhận file giấy tờ. |
| D3 | Mức hộp thư là dữ liệu: đợt này có `mailboxes_3` (mặc định) và `mailboxes_10`. Mức khác là một dòng catalog mới, không phải nhánh code. |
| D4 | Lúc mua chỉ đặt tên hộp thư của chủ tổ chức. Suất còn lại thêm sau trên tên miền đó. Chỉ hộp thư người mua được `Connect` vào Email Hub. |
| D5 | Chỗ đặt: tab `domains` nhóm Tổ chức, cạnh Thanh toán, cổng `org_owner`. Email Hub có thẻ gợi ý khi tổ chức chưa giữ tên miền nào. |
| D6 | Đơn tên miền không gọi `Checkout` và không ghi `invoices` / `subscriptions`. Hệ quả ghi nhận: khách không có chứng từ trong tab Hóa đơn và chưa có hóa đơn điện tử cho khoản này. Xem lại trước khi mở ra ngoài pilot, hạn 2026-12-31 (§12). |
| D7 | Cùng IPN VNPay hiện có. `TxnRef` không thấy trong ý định gói thì xử lý như ý định tên miền. IPN trả `00` ngay sau khi ghi `paid`; đăng ký với PAVietnam do worker làm, không nằm trong request IPN. |
| D8 | `domain_packages` và `domain_package_prices` là catalog nền tảng, cùng loại với `plans`: không có `organization_id`, khai trong `tenantExemptTables` với lý do. Mọi bảng đơn và hộp thư thì có. |
| D9 | Bán được khi **cả hai** đúng: cấu hình PAVietnam đủ (§11) và flag `domain_reseller` bật cho tổ chức. Thiếu một thì tab và thẻ gợi ý ẩn, GET trả `enabled: false`, route ghi trả 404. Flag để bật dần theo tổ chức trong pilot; config quyết định có nhà cung cấp hay không. |
| D10 | Đã thu tiền mà đăng ký thất bại, hoặc tiền về sau khi đơn đã nhả tên: đơn `needs_attention`. Không tự hoàn tiền. Có metric, alert và runbook; console admin liệt kê các đơn này (§7, §11). |
| D11 | Tên miền đã hoạt động mà tạo hộp thư hoặc nối Email Hub lỗi: đơn vẫn `active`, hộp thư chủ `needs_connect`, chủ tổ chức thử lại. |
| D12 | Ngoài đợt này: DNS website, gia hạn tự động, hoàn tiền, nối hộp thư cho thành viên khác, gộp vào gói SaaS, mục mới trên thanh điều hướng. Nợ ghi nhận ở §12. |
| D13 | Thông tin chủ thể đăng ký (registrant) thu ở bước checkout và chụp vào đơn. Số định danh cá nhân niêm bằng hộp khóa Email Hub, không vào SDO, không vào audit. Trường cụ thể chốt theo Q2. |
| D14 | Mọi lệnh gọi PAVietnam do worker thực hiện đi qua một claim có lease (`claimed_at`, 10 phút, `FOR UPDATE SKIP LOCKED`) rồi commit trước khi gọi. Không giữ transaction, không `FOR UPDATE` xuyên qua lời gọi nhà cung cấp. |
| D15 | Intent hết hạn không nhả tên ngay. Worker hỏi QueryDr trước; chỉ nhả khi VNPay nói chưa trả, hoặc sau 2 giờ không hỏi được. Tiền về sau khi đã nhả tên không bao giờ bị bỏ qua: intent `completed`, đơn `needs_attention` lý do `paid_after_expiry`. |
| D16 | Mật khẩu hộp thư chỉ lưu (niêm) cho hộp thư UniWork tự nối (`for_owner`), vì nối lại cần nó. Suất khác hiện mật khẩu một lần trong response tạo và không lưu. |
| D17 | `domain_orders.workspace_id` cho phép NULL. Workspace chỉ dùng để `Connect`; mất workspace thì chủ tổ chức chọn lại lúc nối. |
| D18 | `offers` có rate limit theo người gọi, vì mỗi lượt tìm là N lời gọi PAVietnam. |

## 4. Dữ liệu

Migration tên `999<unix-ms>_…`, số lớn hơn migration đã áp dụng trên nhánh lúc viết plan. Không `FOREIGN KEY`. Mỗi index một file `CONCURRENTLY`. Mỗi `.up.sql` có `.down.sql`. Id là ULID.

### 4.1 Catalog

```sql
CREATE TABLE domain_packages (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL,
  mailbox_count INTEGER NOT NULL,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE domain_package_prices (
  id             TEXT PRIMARY KEY,
  package_id     TEXT NOT NULL,
  tld            TEXT NOT NULL,
  retail_amount  BIGINT NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'VND',
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Seed trong migration catalog: `mailboxes_3` (`mailbox_count` 3, `is_default` true, `sort_order` 0) và `mailboxes_10` (`mailbox_count` 10, `sort_order` 1). Không seed giá. Chưa có dòng giá đang hiệu lực thì mức đó không bán.

Index riêng: unique `domain_packages.code`; unique một `is_default` true; unique `(package_id, tld)` trên giá.

`tld` lưu không dấu chấm đầu, chữ thường (`vn`, `com.vn`, `com`). Khớp đuôi dài nhất: `acme.com.vn` lấy `com.vn`, không lấy `vn`.

Hai bảng này vào `tenantExemptTables` (`server/migrations/lint_test.go`) với lý do "catalog nền tảng, cùng loại `plans`".

### 4.2 Đơn, ý định thanh toán, hộp thư

```sql
CREATE TABLE domain_orders (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL,
  workspace_id              TEXT,                    -- D17: NULL khi workspace đã mất
  domain_name               TEXT NOT NULL,
  tld                       TEXT NOT NULL,
  package_id                TEXT NOT NULL,
  mailbox_quota             INTEGER NOT NULL,
  owner_local_part          TEXT NOT NULL,
  owner_user_id             TEXT NOT NULL,
  registrant                JSONB NOT NULL,          -- D13, §4.4
  registrant_id_number_enc  TEXT,                    -- D13, niêm; NULL cho tổ chức
  retail_amount             BIGINT NOT NULL,
  wholesale_amount          BIGINT NOT NULL,
  currency                  TEXT NOT NULL DEFAULT 'VND',
  status                    TEXT NOT NULL,
  holds_name                BOOLEAN NOT NULL DEFAULT true,
  provider_ref              TEXT,
  kyc_url                   TEXT,
  expires_at                TIMESTAMPTZ,
  attention_reason          TEXT,
  claimed_at                TIMESTAMPTZ,             -- D14
  released_at               TIMESTAMPTZ,
  created_by                TEXT NOT NULL,
  created_by_kind           TEXT NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE domain_payment_intents (
  id                      TEXT PRIMARY KEY,
  organization_id         TEXT NOT NULL,
  domain_order_id         TEXT NOT NULL,
  provider                TEXT NOT NULL,
  provider_txn_ref        TEXT NOT NULL,
  provider_order_info     TEXT NOT NULL,             -- QueryDr phải gửi đúng chuỗi lúc Pay
  amount                  BIGINT NOT NULL,
  currency                TEXT NOT NULL DEFAULT 'VND',
  status                  TEXT NOT NULL DEFAULT 'pending',
  expires_at              TIMESTAMPTZ NOT NULL,
  completed_at            TIMESTAMPTZ,
  reconcile_attempted_at  TIMESTAMPTZ,               -- D15, lease của QueryDr
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE domain_mailboxes (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL,
  domain_order_id       TEXT NOT NULL,
  local_part            TEXT NOT NULL,
  address               TEXT NOT NULL,
  for_owner             BOOLEAN NOT NULL DEFAULT false,
  status                TEXT NOT NULL,
  imap_host             TEXT,
  imap_port             INTEGER,
  imap_security         TEXT,
  smtp_host             TEXT,
  smtp_port             INTEGER,
  smtp_security         TEXT,
  username              TEXT,
  password_enc          TEXT,                        -- D16: chỉ for_owner; base64 như Email Hub
  email_hub_account_id  TEXT,
  created_by            TEXT NOT NULL,
  created_by_kind       TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`domain_orders.status`: `pending_payment`, `paid`, `pending_verification`, `active`, `needs_attention`, `expired`.

`domain_orders.attention_reason`: `register_failed`, `paid_after_expiry`.

`domain_payment_intents.status`: `pending`, `completed`, `failed`, `expired`.

`domain_mailboxes.status`: `provisioned` (suất thường, đã tạo ở PAVietnam, không nối), `needs_connect` (hộp thư chủ, chưa nối được), `active` (hộp thư chủ đã nối).

`created_by_kind` là `human`. Handler chỉ dựng actor bằng `service.Human`.

**Giữ tên miền** là cột `holds_name`, không suy từ `status`: unique partial index `domain_name WHERE holds_name`. `expired` và `needs_attention` lý do `paid_after_expiry` có `holds_name = false` (tên có thể đã về người khác). `needs_attention` lý do `register_failed` giữ `holds_name = true` vì tiền đã thu và hỗ trợ sẽ đăng ký lại bằng tay. Nhả tên ghi `released_at`.

Unique `(domain_order_id, local_part)`. Unique `provider_txn_ref`. Index `domain_payment_intents (status, expires_at)` cho worker. Index `domain_orders (status, claimed_at)` cho worker.

`wholesale_amount`, `password_enc`, `registrant_id_number_enc` không xuất hiện trong SDO. `kyc_url` chỉ có trên đơn của chính tổ chức, cho chủ tổ chức.

Một đơn có thể có nhiều intent (lần trả bỏ dở rồi trả lại, §6.2). Tại một thời điểm chỉ một intent `pending`.

### 4.3 Ai ghi giá

Chỉ platform admin. `POST /api/v1/admin/domain-package-prices` nhận `package_code`, `tld`, `retail_amount`, `is_active`, `reason` (≥ 10 ký tự); upsert theo `(package_code, tld)`. Ghi `admin_actions` và `audit_events` trong một transaction, cùng đường admin hiện có (`PUT /api/v1/admin/plans/{code}` là mẫu). `GET /api/v1/admin/domain-package-prices` trả bảng giá đang có để admin thấy mình đã bán gì (vai `support` đọc được).

Query admin nằm trong `server/pkg/db/queries/admin.sql` và chỉ `server/internal/service/admin.go` gọi, đúng `TestAdminQueriesStayInAdminService`. Đọc giá lúc bán là query của service tên miền, có `-- tenant: platform`.

### 4.4 Registrant

`registrant` là JSON theo một struct Go cố định, validate trước khi ghi. Tối thiểu, chốt lại theo Q2:

```json
{
  "kind": "organization | individual",
  "legal_name": "Công ty TNHH ...",
  "tax_code": "0101234567",
  "address": "...",
  "email": "...",
  "phone": "..."
}
```

`kind = individual` không có `tax_code` và bắt buộc số định danh, lưu niêm ở `registrant_id_number_enc`; SDO trả về chỉ 3 số cuối. `kind = organization` không có số định danh. Thiếu trường bắt buộc: `400 registrant_invalid`, kèm `fields`.

Registrant chụp vào đơn và không đổi sau checkout. Đổi registrant ở PAVietnam là việc của hỗ trợ, ngoài đợt này.

## 5. Nhà cung cấp

`server/internal/registrar` là chỗ duy nhất mở HTTP tới PAVietnam. Service import `internal/registrar` (interface) và không import `internal/registrar/pavietnam`; chỉ `pavietnam` đọc biến `PAVIETNAM_*`. `TestRegistrarClientOnlyInRegistrar` trong `server/internal/arch_test.go` giữ cả hai (mẫu: `TestProviderSDKOnlyInAIProvider`).

Interface dưới là **dự kiến**, viết theo luồng §6; dev sửa cho khớp tài liệu (§0) trước khi viết plan, giữ nguyên ranh giới gói.

```go
type Registrant struct {
    Kind      string // organization | individual
    LegalName string
    TaxCode   string
    IDNumber  string // chỉ individual; không log
    Address   string
    Email     string
    Phone     string
}

type Quote struct {
    Available       bool
    WholesaleAmount int64 // đồng, cả tên miền và gói email. 0 nghĩa là nhà cung cấp không đưa giá vốn
    Currency        string
}

type Registration struct {
    ProviderRef string
    Status      string // pending_verification | active
    KYCURL      string
    ExpiresAt   time.Time // zero khi chưa biết
}

type Mailbox struct {
    IMAPHost, IMAPSecurity, SMTPHost, SMTPSecurity, Username, Password string
    IMAPPort, SMTPPort int
}

type Provider interface {
    Configured() bool
    Check(ctx context.Context, domainName, packageCode string) (Quote, error)
    Register(ctx context.Context, domainName, packageCode string, r Registrant) (Registration, error)
    Status(ctx context.Context, providerRef string) (Registration, error)
    CreateMailbox(ctx context.Context, domainName, localPart string) (Mailbox, error)
}
```

Adapter `server/internal/registrar/pavietnam` đọc `PAVIETNAM_API_BASE`, `PAVIETNAM_API_USER`, `PAVIETNAM_API_KEY` (tên và số biến chốt lại theo Q1). Thiếu một biến thì `Configured()` là false. Đường dẫn endpoint **ghi cứng trong adapter** theo tài liệu, không phải biến môi trường. Test của adapter dùng `httptest`.

Timeout HTTP 15 giây. Lỗi nhà cung cấp thành mã ổn định `registrar_unavailable`. Không ghi host, key, registrant, hay thân lỗi thô vào log; log mang mã lỗi và id đơn.

Kỳ bán là 1 năm. `Register` đăng ký 1 năm cộng gói email tương ứng `mailbox_quota`. Adapter map mức UniWork sang mã sản phẩm PAVietnam trong một bảng ở file adapter (`mailboxes_3`, `mailboxes_10`; Q5). Mức lạ trả lỗi, service không bán.

`Check` không trả giá vốn (`WholesaleAmount == 0`) thì service từ chối bán: `price_not_sellable`. Giá vốn lớn hơn giá bán cũng `price_not_sellable`.

`CreateMailbox` gọi lại với cùng local-part phải trả đúng hộp thư đã tạo, không tạo hộp thứ hai (Q6). Nếu API không idempotent, adapter tự tra trước khi tạo.

Fake cho test service: `server/internal/registrar/fake`, lập trình được từng lời gọi (còn/hết tên, giá vốn, lỗi, trạng thái trả về theo thứ tự).

## 6. Luồng đơn

Chủ thể là organization. Mọi lệnh gọi `RequireMember` rồi chỉ tiếp khi vai tổ chức là `owner`, cùng kiểu `BillingService.requireOwner`. Mọi route kiểm tra D9 sau bước quyền: GET trả `enabled: false`, route ghi trả 404.

### 6.1 Tìm và xem giá

`GET /api/v1/orgs/{orgID}/domains/offers?name=`

Rate limit `RateLimitByIdentityBucket` bucket `domain-offers`, 20 lượt/phút theo user đã xác thực (D18); không Redis thì không giới hạn, như mọi limiter khác.

`name` là tên miền đầy đủ, chữ thường, đã trim. Không có dấu chấm thì `400 invalid_domain`. Đuôi không có trong catalog giá thì `404 tld_not_priced`.

Gọi `Check` một lần cho mỗi mức đang có giá, vì giá vốn phụ thuộc mức. Bỏ mức lỗi `registrar_unavailable`, mức có giá vốn 0, và mức có giá vốn cao hơn giá bán. Mọi mức có giá đều lỗi nhà cung cấp thì `503 registrar_unavailable`. Còn giá nhưng không mức nào bán được thì `200` với `offers` rỗng. Trả về: `enabled`, `domain_name`, và các mức bán được (`code`, `mailbox_count`, `is_default`, `retail_amount`, `currency`, `available`). Không trả giá vốn. `enabled: false` thì không gọi `Check`, danh sách mức rỗng.

### 6.2 Thanh toán

`POST /api/v1/orgs/{orgID}/domains/checkout`

Body: `domain_name`, `package_code`, `local_part`, `workspace_id`, `registrant` (§4.4, kèm `id_number` khi `individual`), `success_path`, `cancel_path`.

`local_part`: 1–64 ký tự, `^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$`, lưu chữ thường. `success_path` và `cancel_path` qua `ValidateCheckoutPath`. `registrant` validate trước khi gọi nhà cung cấp.

`Check` chạy trước transaction. Trong transaction, đọc lại giá bán:

1. Từ chối nếu chưa bật (D9), tên không available, mức không có giá, giá vốn 0 hoặc giá vốn > giá bán, `workspace_id` không thuộc tổ chức, hoặc người gọi không phải owner.
2. Tên đang được giữ (`holds_name`):
   - bởi tổ chức khác → `409 domain_held`;
   - bởi chính tổ chức này, đơn `pending_payment`, intent `pending` còn hạn, cùng mức và cùng local-part → **dùng lại**: không tạo đơn thứ hai, gọi lại `CreateCheckout` với cùng txn ref để lấy URL mới, kết thúc;
   - bởi chính tổ chức này, đơn `pending_payment`, intent đã quá hạn hoặc `failed` → hỏi QueryDr một lần (§6.4a, đồng bộ, 15 giây). Chưa trả → intent cũ `expired`/`failed`, tạo intent mới trên **cùng đơn** (bước 4), cập nhật mức và local-part nếu khác. Đã trả → `409 already_paid`, đơn đi tiếp theo §6.3 với sự kiện vừa nhận. Không hỏi được → `503 billing_provider_unavailable`;
   - bởi chính tổ chức này ở trạng thái khác → `409 domain_held`.
3. Tạo `domain_orders` status `pending_payment`, `holds_name` true, chép `retail_amount`, `wholesale_amount`, `mailbox_quota`, `owner_local_part`, `workspace_id`, `registrant`, `registrant_id_number_enc`, `tld`.
4. Tạo `domain_payment_intents` pending, `expires_at` = now + 15 phút, `provider_txn_ref` = id của intent, `provider_order_info` = `UniWork domain <domain_name>`.
5. Audit `domain_order.checkout_started` và commit.

Sau commit, `billing.Provider.CreateCheckout` với `Amount` là giá bán, `Currency` VND, `OrderInfo` là `provider_order_info`, `IntentID` là txn ref, `CreatedAt` và `ExpiresAt` lấy từ intent (VNPay đặt `vnp_ExpireDate`, nên trả sau hạn bị cổng từ chối; cửa sổ trả muộn chỉ còn độ trễ IPN). Không đụng subscription. `ErrProviderUnavailable` (kể cả `BILLING_PROVIDER` khác `vnpay`) trả `503 billing_provider_unavailable`, cùng mã với gói SaaS, rồi intent `failed`, đơn `expired`, `holds_name` false. Lỗi checkout khác cũng nhả đơn như vậy.

Đổi bảng giá sau bước 3 không đổi `retail_amount` của đơn.

### 6.3 IPN

`vnpayBillingWebhook` giữ nguyên bước parse. `HandleProviderWebhook` trả `01` thì handler gọi `DomainService.HandlePaid(ctx, ev)` và ghi mã nó trả về. Đường IPN **không** gọi PAVietnam: mục tiêu là trả lời VNPay trong vài trăm mili giây.

`HandlePaid` tra intent theo `provider_txn_ref`, khóa dòng đơn, rồi quyết định trong một transaction:

| Tình huống | Intent | Đơn | Mã trả |
|---|---|---|---|
| Không thấy txn ref | — | — | `01` |
| Intent đã `completed` | giữ | giữ | `02` |
| IPN không trả (`vnp_ResponseCode` ≠ `00`) | `pending` → `failed`; khác giữ | giữ `pending_payment` | `00` |
| Sai số tiền hoặc sai `VND` | `pending` → `failed` | giữ | `04` |
| Khớp tiền, đơn `pending_payment` (intent `pending`, `failed` hoặc `expired` đều nhận) | `completed` | `paid`, `holds_name` true | `00` |
| Khớp tiền, đơn đã `expired` (đã nhả tên) | `completed` | `needs_attention`, lý do `paid_after_expiry`, `holds_name` giữ false | `00` |
| Khớp tiền, đơn ở trạng thái khác (`paid`, `pending_verification`, `active`, `needs_attention`) | `completed` | giữ | `00` |

Audit `domain_order.paid` (trường hợp `paid`) hoặc `domain_order.needs_attention` (trường hợp trả muộn), metadata `source: ipn`, rồi commit. Lỗi DB giữa chừng: rollback, trả `99`, VNPay gọi lại; QueryDr (§6.4a) là lưới an toàn nếu VNPay thôi gọi.

Sau commit, `HandlePaid` có thể đánh thức worker bằng một gửi không chặn vào channel; không bắt buộc, worker 60 giây là bảo đảm.

### 6.4 Worker

`DomainService.RunWorkers(ctx)` trong process server, mỗi 60 giây, đăng ký vào chuỗi tắt của `server/cmd/server/main.go` với kênh done như `billingWorkersDone`. Nhiều node cùng chạy được: mọi lời gọi nhà cung cấp đứng sau một claim (D14). Claim là `UPDATE … SET claimed_at = now() WHERE id IN (SELECT … WHERE claimed_at IS NULL OR claimed_at < now() - interval '10 minutes' … FOR UPDATE SKIP LOCKED) RETURNING *`, commit, rồi mới gọi PAVietnam; kết quả ghi trong transaction mới và xóa `claimed_at`. Process chết giữa chừng thì lease hết sau 10 phút và node khác làm lại; mọi bước dưới phải chịu được làm lại.

**a. Hỏi lại VNPay** (intent `pending` quá `expires_at`, hoặc `failed`, chưa quá 7 ngày, lease `reconcile_attempted_at` 10 phút): gọi `billing.VNPay.QueryTransaction` với `TxnRef`, `TransactionDate` = `created_at` của intent theo giờ ICT, `OrderInfo` = `provider_order_info`. Lấy VNPay qua type assertion `s.billing.(*billing.VNPay)` như billing; provider khác thì bỏ bước này.

- Đã trả, đúng tiền → cùng bảng §6.3, metadata `source: reconcile`.
- Chưa trả hoặc không có giao dịch → intent `expired`. Đơn `pending_payment` không còn intent `pending` → đơn `expired`, `holds_name` false, `released_at`, audit `domain_order.expired`.
- Không hỏi được → giữ, thử lại sau lease. Quá `expires_at` + 2 giờ mà vẫn không hỏi được → đơn `expired` và nhả tên như trên; intent vẫn ở trong quét 7 ngày để một kết quả "đã trả" muộn thành `paid_after_expiry`.

**b. Đăng ký** (đơn `paid`, `provider_ref` trống): claim → `Register(domain, package, registrant)`.

- Trả `pending_verification` → đơn `pending_verification`, lưu `provider_ref`, `kyc_url`, audit `domain_order.registered`.
- Trả `active` → lưu `provider_ref`, rồi kích hoạt (d) ngay trong vòng này.
- Lỗi → đơn `needs_attention`, `attention_reason` `register_failed`, `holds_name` giữ true, audit `domain_order.needs_attention`. Không gọi lại tự động; hỗ trợ xử lý theo runbook. Lỗi mạng thuần (timeout) được thử lại tối đa 3 vòng trước khi thành `needs_attention`, đếm bằng metadata claim.

**c. Chờ xác thực** (đơn `pending_verification`): claim → `Status(provider_ref)`. Còn chờ thì giữ, cập nhật `kyc_url` nếu đổi. `active` thì kích hoạt (d). Lỗi thì bỏ vòng này.

**d. Kích hoạt** (không giữ transaction trong lúc gọi PAVietnam):

1. `CreateMailbox` cho `owner_local_part`. Gọi lại phải trả đúng hộp thư đã tạo.
2. Niêm mật khẩu bằng cùng hộp khóa Email Hub (`EMAIL_HUB_CREDENTIAL_KEY`), cùng định dạng base64 của `sealSecret`.
3. Một transaction: đơn `active`, `expires_at` lấy từ nhà cung cấp khi có, ghi `domain_mailboxes` `for_owner` true status `needs_connect` (bỏ qua nếu dòng đã có), audit `domain_mailbox.created` và `domain_order.activated`.
4. Sau commit, nối Email Hub (§6.7) nếu `workspace_id` còn trỏ tới workspace đang tồn tại; không thì để `needs_connect`, chủ tổ chức chọn workspace lúc nối.

### 6.5 Thêm suất

`POST /api/v1/orgs/{orgID}/domains/{domainOrderID}/mailboxes` body `local_part`.

Chỉ đơn `active`, không thì `409 domain_not_active`. Số dòng hộp thư đã bằng `mailbox_quota` thì `409 mailbox_quota_exceeded`. Tạo ở PAVietnam, ghi dòng status `provisioned`, `for_owner` false, `password_enc` NULL (D16), audit `domain_mailbox.created`. Không gọi `Connect`.

SDO của **đúng response tạo** có `initial_password`. Mọi GET sau không có trường này và UniWork không còn giữ nó. Mật khẩu không ghi log, không ghi audit. Quên mật khẩu là việc của hỗ trợ với PAVietnam, ngoài đợt này.

### 6.6 Đọc

`GET /api/v1/orgs/{orgID}/domains` và `GET …/{domainOrderID}`: chủ tổ chức. Danh sách không gồm `expired`. Mỗi đơn có tên, mức, giá bán, status, `attention_reason`, `kyc_url` khi đang `pending_verification`, `expires_at`, registrant (số định danh chỉ 3 số cuối), các hộp thư (địa chỉ, status, máy chủ, `for_owner`). Không có giá vốn, không có mật khẩu.

`enabled: false` thì cả hai GET trả `{ enabled: false, orders: [] }` và không 404, để client ẩn tab.

### 6.7 Nối hộp thư chủ vào Email Hub

Dùng chung cho worker (§6.4d bước 4) và `POST …/mailboxes/{mailboxID}/connect`.

Điều kiện: hộp thư `for_owner`, có `password_enc`, và chưa có tài khoản Email Hub đang nối cho địa chỉ đó của `owner_user_id` trong tổ chức. Route nhận `workspace_id` tùy chọn trong body để chọn lại workspace (D17); không có thì dùng `workspace_id` trên đơn; đơn không còn workspace hợp lệ thì `400 workspace_required`.

Gọi `EmailHubService.Connect` với actor `service.Human(owner_user_id)`, workspace đã chọn, máy chủ và mật khẩu mở niêm. Thành công: hộp thư `active`, lưu `email_hub_account_id`, audit `domain_mailbox.connected` với metadata `source: worker | owner`. Thất bại: hộp thư `needs_connect`, đơn vẫn `active`, lỗi trả về client theo mã Email Hub.

Audit của chính `Connect` trong Email Hub sẽ ghi actor là chủ tổ chức dù worker bấm. Chấp nhận: hành động đó là của họ (họ mua và chọn hộp thư); dòng `domain_mailbox.connected` ghi `source` nói rõ ai bấm. Không nhận mật khẩu từ client ở route này.

## 7. API

Đăng ký trong `server/internal/handler/router/domains.go`, tag `domains`, SDI/SDO ở `dto/sdi/domains.go` và `dto/sdo/domains.go`. `{domainOrderID}` và `{mailboxID}` cần case trong `pathParamSDI`. `{orgID}` đã có.

| Method | Path | Việc |
|---|---|---|
| GET | `/api/v1/orgs/{orgID}/domains` | Danh sách đơn |
| GET | `/api/v1/orgs/{orgID}/domains/offers` | Giá và còn tên |
| POST | `/api/v1/orgs/{orgID}/domains/checkout` | Tạo đơn và URL VNPay |
| GET | `/api/v1/orgs/{orgID}/domains/{domainOrderID}` | Một đơn |
| POST | `/api/v1/orgs/{orgID}/domains/{domainOrderID}/mailboxes` | Thêm suất |
| POST | `/api/v1/orgs/{orgID}/domains/{domainOrderID}/mailboxes/{mailboxID}/connect` | Nối (lại) hộp thư chủ |

Admin (`RequirePlatformRole`, không qua `RequireMember`, không trả nội dung):

| Method | Path | Việc |
|---|---|---|
| GET | `/api/v1/admin/domain-package-prices` | Bảng giá đang có (`support` đọc) |
| POST | `/api/v1/admin/domain-package-prices` | Upsert một giá, `reason` ≥ 10 ký tự (`admin`) |
| GET | `/api/v1/admin/domain-orders?status=` | Đơn theo trạng thái, mặc định `needs_attention`: id, tổ chức, tên miền, status, lý do, giá bán, thời điểm. Không có registrant, không có giá vốn (`support` đọc) |

Mã lỗi ổn định: `invalid_domain`, `invalid_local_part`, `registrant_invalid`, `tld_not_priced`, `price_not_sellable`, `domain_unavailable`, `domain_held`, `already_paid`, `registrar_unavailable`, `mailbox_quota_exceeded`, `domain_not_active`, `workspace_required`, `billing_provider_unavailable`. Kèm `403` khi không phải owner, `404` khi đơn không thuộc tổ chức hoặc khi D9 tắt trên route ghi.

`workspace_id` trong body checkout và body connect là field kết thúc bằng `_id`: thêm case `isoReferences` (workspace của tổ chức A bị tổ chức B đưa vào) và case đọc/ghi của chính owner A. Route mới có path tenant được `TestIsolationMatrix` phủ trong ngày đăng ký; ba bảng tenant mới xem §10.

Client: `packages/core/api/endpoints/domains.ts`, schema lỏng, `parseWithFallback`, test phản hồi hỏng. Không có trường wholesale, không có mật khẩu ngoài `initial_password` của response tạo.

Sự kiện realtime: không phát. Màn hình đọc lại sau khi người mua thao tác và khi họ mở tab; tab đang mở đơn `paid`/`pending_verification` poll 30 giây. Mất một lần poll chỉ chậm trạng thái.

## 8. Giao diện

Tab `domains`, nhãn i18n `settings.page.tabs.domains` ("Tên miền" / "Domains"), icon `Globe`, cổng `org_owner`. Ẩn thêm khi flag `domain_reseller` tắt (đọc từ `FeatureFlagsProvider`) hoặc GET trả `enabled: false`; đang tải thì tab còn, cùng quy tắc tab có cổng. File panel `packages/views/settings/components/domains-tab.tsx`; tách form mua (`domain-checkout-form.tsx`) và danh sách đơn (`domain-order-list.tsx`) ngay từ đầu để mỗi file dưới 500 dòng.

Form mua, ba bước trên một màn:

1. Ô tìm tên miền đầy đủ. Kết quả là các mức, mức `mailboxes_3` được chọn sẵn. Giá hiện trước ô local-part.
2. Thông tin chủ thể: chọn tổ chức / cá nhân, các trường §4.4. Lần sau điền sẵn từ đơn gần nhất của tổ chức (trừ số định danh).
3. Ô local-part, rồi nút thanh toán. Đang `pending_payment` thì nút mở lại URL đã có nếu còn hạn; không thì gọi checkout lại, server tự dùng lại đơn (§6.2 bước 2).

Danh sách đơn:

- `pending_verification` hiện link xác thực và một câu giải thích chưa có hộp thư cho tới khi xác thực xong.
- `needs_attention` lý do `register_failed`: "Đã nhận tiền, đăng ký chưa xong, UniWork đang xử lý, liên hệ hỗ trợ nếu quá 1 ngày làm việc". Lý do `paid_after_expiry`: "Khoản thanh toán đến sau khi đơn hết hạn, hỗ trợ sẽ liên hệ để hoàn tiền hoặc đăng ký lại". Không có nút hoàn tiền.
- `active` liệt kê hộp thư. Hộp thư chủ `needs_connect` có nút nối, kèm chọn workspace nếu đơn mất workspace. Form thêm suất hiện khi còn quota; sau khi tạo, hiện mật khẩu một lần trong dialog có nút chép và câu "UniWork không lưu mật khẩu này".
- `expires_at` hiện trên mỗi đơn `active`.

Thẻ gợi ý trong `packages/views/email-hub/email-hub-connect-empty.tsx`: chỉ khi người xem là chủ tổ chức, flag bật, `enabled`, và không có đơn đang giữ tên. Bấm thì `settings?tab=domains`. Copy qua `t()`, khoá `email_hub.domain_offer.*`, cả `en.json` và `vi.json`. Thẻ dùng icon `Globe`, không thêm icon module mới.

## 9. Audit

Mỗi lệnh đổi trạng thái gọi `audit.Recorder.Record` trong cùng transaction. Thêm action vào vocabulary của `server/internal/service/audit_coverage_test.go`:

| Lệnh | Action |
|---|---|
| StartCheckout | `domain_order.checkout_started` |
| MarkPaid (IPN hoặc reconcile) | `domain_order.paid` |
| Register | `domain_order.registered` |
| Activate | `domain_order.activated` |
| MarkNeedsAttention (`register_failed`, `paid_after_expiry`) | `domain_order.needs_attention` |
| Expire | `domain_order.expired` |
| CreateMailbox (chủ và suất thường) | `domain_mailbox.created` |
| ConnectMailbox | `domain_mailbox.connected` |
| UpsertPrice (admin) | `domain_package_price.upserted` |

Metadata có id đơn, tên miền, status trước và sau, `attention_reason` khi có, và `source` (`ipn`, `reconcile`, `worker`, `owner`). Không có giá vốn, mật khẩu, số định danh, registrant, hay URL có query bí mật. Actor của việc worker làm là `audit.System("domains")`; actor của IPN là `audit.System("billing")` như billing.

`Connect` của Email Hub vẫn ghi audit nối hộp thư của nó, ngoài audit `domain_mailbox.connected`.

## 10. Kiểm thử

Giá và đơn:

- Giá khóa lúc checkout. Đổi giá sau đó không đổi đơn đang mở.
- Thiếu giá, giá vốn 0, giá vốn cao hơn giá bán: `price_not_sellable`, không có đơn.
- Registrant thiếu trường: `registrant_invalid`, không gọi `Check`, không có đơn.
- Tên đã giữ bởi tổ chức khác: `domain_held`. Cùng tổ chức, intent còn hạn: dùng lại, không có đơn thứ hai. Cùng tổ chức, intent quá hạn, QueryDr nói chưa trả: intent mới trên cùng đơn. QueryDr nói đã trả: `already_paid` và đơn thành `paid`.
- `CreateCheckout` lỗi: intent `failed`, đơn `expired`, `holds_name` false.

IPN và reconcile (fake billing provider + fake registrar):

- IPN đúng số tiền một lần đưa đơn tới `paid` và trả `00` **mà không gọi** registrar. IPN lặp trả `02`. Sai số tiền: `04`, đơn vẫn `pending_payment`. IPN không trả: intent `failed`, đơn giữ.
- IPN đúng tiền trên intent `expired` khi đơn còn `pending_payment`: `paid`. Khi đơn đã `expired`: `needs_attention` lý do `paid_after_expiry`, `holds_name` vẫn false, intent `completed`.
- Worker: intent quá hạn, QueryDr chưa trả → đơn `expired`, tên nhả được (tổ chức khác checkout được). QueryDr lỗi liên tục → đơn giữ tên tới `expires_at` + 2 giờ rồi nhả. QueryDr đã trả → `paid`.
- Hai worker chạy song song trên cùng đơn `paid` chỉ gọi `Register` một lần (lease).

Đăng ký và kích hoạt:

- `Register` lỗi: `needs_attention`, `holds_name` true, không có hộp thư, metric tăng.
- `pending_verification`: worker không tạo hộp thư. `Status` active: tạo một hộp thư `for_owner` và gọi `Connect`.
- `Connect` lỗi: đơn `active`, hộp thư `needs_connect`, retry gọi `Connect` lại. Đơn mất workspace: route trả `workspace_required`, body có `workspace_id` thì nối được.
- Thêm suất thứ `quota+1` bị từ chối. Suất thêm không gọi `Connect`, `password_enc` NULL. Response tạo có `initial_password`; GET không có.

Cách ly và ranh giới:

- JSON offers, đơn, admin không chứa `wholesale`, `password`, số định danh đầy đủ.
- `TestIsolationMatrix`: ba bảng mới vào `isoUnseeded` với lý do "chỉ checkout có cổng thanh toán mới tạo; matrix chạy provider manual", như `billing_payment_intents`. Bù bằng `TestDomainIsolation` (service): tổ chức A có đơn `active` và hộp thư qua fake, owner tổ chức B gọi mọi route bằng id của A → 403/404, thân không chứa tên miền của A; owner A là control.
- `TestEveryBodyIDFieldHasAReferenceCase` có case cho `workspace_id` ở checkout và connect.
- `TestRegistrarClientOnlyInRegistrar` (arch): chỉ `internal/registrar/pavietnam` đọc `PAVIETNAM_*`, `internal/service` không import nó.
- Migration lint: hai bảng catalog trong `tenantExemptTables`; ba bảng tenant có `organization_id NOT NULL`; `created_by_kind` đi cặp.
- Endpoint domains có test phản hồi hỏng. Thẻ gợi ý không hiện với member thường và không hiện khi flag tắt.
- `scripts/env-example.test.mjs`, `scripts/alerts-runbooks.test.mjs`, `TestFlagsAreReviewed` xanh với biến, alert, flag mới.

Adapter PAVietnam: `httptest` theo tài liệu thật (§0), gồm một case lỗi thân thô để chứng minh log chỉ có mã.

## 11. Cấu hình và vận hành

Thêm vào `.env.example` (tên chốt theo Q1):

```
PAVIETNAM_API_BASE=
PAVIETNAM_API_USER=
PAVIETNAM_API_KEY=
```

Đủ ba biến và `EMAIL_HUB_CREDENTIAL_KEY` và `BILLING_PROVIDER=vnpay` thì `Configured()` true. Thiếu một biến PAVietnam thì false.

Flag trong `server/internal/featureflags/keys.go`: `domain_reseller`, `Default: false`, `Public: true`, `Owner: "billing"`, `ReviewAt: day(2026, 12, 31)`. Bật cho tổ chức pilot qua `feature_flag_overrides`.

Metric Prometheus: gauge `uniwork_domain_orders_needs_attention` (cập nhật mỗi vòng worker), counter `uniwork_domain_registrar_calls_total{op,result}`.

Alert `DomainOrderNeedsAttention` trong `deploy/alerts.yml`: gauge > 0 trong 5 phút, severity 2, runbook `docs/runbooks/DomainOrderNeedsAttention.md` với bốn mục Triệu chứng / Kiểm tra / Khắc phục / Leo thang. Khắc phục chỉ tới `GET /api/v1/admin/domain-orders` và các bước làm tay với PAVietnam và hoàn tiền VNPay.

Nếu Q1 nói PAVietnam whitelist IP: ghi IP egress của môi trường vào runbook deploy; không có IP cố định thì không bật flag.

## 12. Ngoài phạm vi và nợ ghi nhận

Ngoài phạm vi: DNS tới website có sẵn. Gia hạn tự động. Hoàn tiền tự động. Nhiều hơn một hộp thư tự nối Email Hub. Gán hộp thư cho thành viên. Đặt lại mật khẩu hộp thư. Đổi registrant. Gộp giá tên miền vào gói Starter/Team/Business. Module trên thanh điều hướng. Tải giấy tờ `.vn` lên UniWork.

Nợ ghi nhận, có hạn:

| Nợ | Vì sao chưa làm | Hạn xem lại |
|---|---|---|
| Nhắc gia hạn 30 ngày trước `expires_at` qua module notification | Đợt này không có gia hạn; nhưng tên miền hết hạn sẽ làm chết hộp thư Email Hub đang dùng | 2026-12-31 |
| Chứng từ cho khách và hóa đơn điện tử cho khoản tên miền (D6) | Không chạm `invoices` để không kéo subscription vào | 2026-12-31, trước khi mở ra ngoài pilot |

## 13. Thay đổi so với bản 1 (2026-10-16)

Bản 1 đã được đối chiếu với mã `develop` ngày 2026-10-16. Những chỗ đổi, để dev không làm theo bản cũ:

1. **Thêm §0.** Interface §5 là dự kiến cho tới khi có tài liệu API; đường dẫn endpoint không còn là biến môi trường (bỏ bốn biến `PAVIETNAM_*_PATH`).
2. **Registrant (D13, §4.4).** Bản 1 không có dữ liệu chủ thể đăng ký; không đăng ký được tên miền nào. Thêm `registrant` và `registrant_id_number_enc` vào đơn, thêm bước trong form và body checkout, thêm `registrar.Registrant` vào `Register`.
3. **Trả tiền muộn (D15, §6.3, §6.4a).** Bản 1 hết 15 phút là `expired` và nhả tên, không hỏi lại VNPay, không nói IPN đến trên intent đã hết hạn thì làm gì. Nay có QueryDr trước khi nhả, bảng quyết định IPN đầy đủ, lý do `paid_after_expiry`, cột `holds_name`, `released_at`, `reconcile_attempted_at`, `provider_order_info`.
4. **Claim có lease (D14).** Bản 1 nói `FOR UPDATE` nhưng gọi provider ngoài transaction, hai node sẽ cùng gọi. Nay `claimed_at` + `FOR UPDATE SKIP LOCKED`, theo mẫu billing.
5. **IPN trả `00` ngay (D7).** Bản 1 gọi `Register` trong request IPN với timeout 15 giây. Nay worker đăng ký.
6. **Flag (D9).** Bản 1 chỉ dựa cấu hình. Nay thêm `domain_reseller` để bật dần theo tổ chức.
7. **Mật khẩu (D16).** Bản 1 lưu niêm mật khẩu mọi suất và cho suất thường trạng thái `needs_connect`. Nay chỉ hộp thư chủ giữ mật khẩu; suất thường là `provisioned`, không lưu. `password_enc` là TEXT base64 như Email Hub, không BYTEA.
8. **`workspace_id` nullable (D17)** và route connect nhận `workspace_id`.
9. **Vận hành (D10, §11).** Thêm metric, alert, runbook, `GET /api/v1/admin/domain-orders`, `GET /api/v1/admin/domain-package-prices`.
10. **Rate limit offers (D18).**
11. **Checkout** truyền `CreatedAt`/`ExpiresAt` cho VNPay như billing.
12. **Kiểm thử** thêm cách ly cho ba bảng mới (`isoUnseeded` + `TestDomainIsolation`), arch test cho gói registrar, các case trả tiền muộn và lease.
13. **Nợ có hạn (§12)** cho nhắc gia hạn và chứng từ.
