# F-02 · Gói, subscription, entitlement, quota (chưa billing thật) — Plan triển khai

> **Trạng thái:** shipped

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi organization có đúng một thuê bao sống trỏ vào một gói; gói khai báo entitlement (flag/quota); `EntitlementService.Can/CheckQuota/Consume` chặn ở tầng service Go trong cùng transaction nghiệp vụ, fail-closed, mã lỗi ổn định `entitlement_required` / `quota_exceeded`; 4 điểm gate đầu tiên; `BillingService` đổi gói bằng tay; tab Thanh toán trong Settings. Billing provider chỉ là interface + stub.

**Issue:** UNI-425 · **Spec:** `docs/superpowers/specs/2026-09-04-tenant-subscription-entitlement-design.md` · **Câu hỏi mở đã chốt:** OPEN_QUESTIONS B1–B4, X2 · **ADR:** 0007, 0008, 0009, 0012.

## Global Constraints

- Mọi lệnh chạy từ `uniwork/`. Go: `cd server && go test ./internal/... -run X`; đầy đủ `make test-go`. TS: `pnpm --filter @uniwork/core test`, `pnpm --filter @uniwork/views test`. sqlc: `make sqlc`.
- Migration: không `REFERENCES`/`FOREIGN KEY`, index `CONCURRENTLY` một mình một file, có `.down.sql`, bảng mới có `organization_id TEXT NOT NULL` hoặc nằm trong `tenantExemptTables` với lý do; bảng có `created_by` thì có `created_by_kind` (`lint_test.go`).
- Chỉ `internal/audit` ghi audit/outbox; command mới có dòng trong `audit_coverage_test.go`; sự kiện mới vào catalogue ba nơi.
- Không hard-code tên gói ngoài migration seed và test: `scripts/no-plan-literal.test.mjs` giữ luật.
- Chỉ `service/entitlement.go` và `service/billing.go` gọi query trên `subscriptions` / `usage_*` / `plans` (`arch_test.go`).
- Không thêm dependency. vi.json trước, en.json cùng key. JSX trong `views` qua `t()`.
- Commit sau mỗi task; message `feat(billing): …`, `feat(db): …`, `feat(core): …`, `feat(views): …`.

## Quyết định lúc implement (chốt các chỗ spec để ngỏ)

| # | Chỗ spec để ngỏ | Chốt |
|---|---|---|
| 1 | Số migration | Mới nhất trên `develop` là `068` → dùng `069`–`081` |
| 2 | Platform admin (X2) | Cột `users.platform_role TEXT` (NULL = người thường; `admin`) thêm ở `081`; `BillingService.ChangePlan` cho platform admin đổi gói bất kỳ. Chưa có UI/endpoint đặt cột — đặt tay qua SQL cho tới F-11 |
| 3 | Cache snapshot 60 s | **Không làm.** Gate = 2 query nhỏ trên khóa chính; thêm cache khi p95 của gate lộ ra trên metric. Không có cache thì không có bài toán invalidate liên instance |
| 4 | `Consume(ctx, tx pgx.Tx, …)` | Nhận `q *db.Queries` đã `WithTx` — cùng kiểu với `audit.Recorder.Record`, caller không phải chuyển đổi |
| 5 | Meter snapshot (`members.max`, `workspaces.max`) | `Consume` khóa dòng `subscriptions` của org (`FOR UPDATE`) rồi `COUNT` trên bảng nguồn; không ghi `usage_events` (spec §3.3) |
| 6 | Meter accumulate (`meeting.participant_minutes`) | Ghi ở chỗ đóng **một** phiên tham dự (`CloseAttendanceSession` trong `meeting_queries.go`), idempotency `attendance:<session_id>`; phút đã họp không từ chối được nên chỉ `RecordUsage` (không check). Hai đường đóng hàng loạt (`CloseOpenAttendanceForConference/ForMeeting`) chưa đo — `ponytail:` ghi ở code, làm khi có bảng usage cho người dùng (C-05) |
| 7 | `quota.threshold` | Phát từ `Consume` khi tổng vượt 80 %/100 % lần đầu trong kỳ (`usage_counters.notified_80_at/100_at`), scope `user`, một dòng cho mỗi owner/admin của org. FE chỉ invalidate; toast/cảnh báo là C-05 |
| 8 | `subscription.changed` | Outbox, scope `user`, một dòng cho mỗi owner/admin (`RealtimeConsumer` chỉ hiểu `payload.user_id`) |
| 9 | Audit action | Một action `subscription.changed` cho ChangePlan/Cancel/Resume; `metadata.kind` phân biệt |
| 10 | B4 downgrade khi usage vượt gói đích | Từ chối bằng `quota_exceeded` (meter snapshot đếm ngay lúc đổi) |
| 11 | `past_due` grace 7 ngày (B3) | `effective()` coi `past_due` là inactive **sau** `current_period_end + 7d`; trước đó vẫn active. Không thêm cột |
| 12 | Provider | `internal/billing`: `Provider` interface, `Manual` (checkout → `ErrProviderUnavailable`), `Stub(name)` cho `stripe`/`payos`; chọn bằng `BILLING_PROVIDER` (mặc định `manual`). Webhook inbox worker, invoice API, admin plan API → C-04 |
| 13 | `GET /plans` public | Đăng ký sau `RequireAuth` — trang Pricing ngoài phạm vi, không có client ẩn danh |
| 14 | `useEntitlements()` mirror công thức | Không mirror: server trả entitlement hiệu lực + usage trong `GET /orgs/{org}/billing`; FE đọc thẳng. Thêm hook khi có nút đầu tiên cần ẩn/hiện theo gói |
| 15 | `ErrorSDO.fields` | Thêm `Fields map[string]any json:"fields,omitempty"` vào `ErrorDetail` và `CodedError`; tương thích ngược |
| 16 | `go test` timeout | `scripts/test-go.sh` thêm `-timeout 30m`: test DB khóa advisory theo từng test nên các gói chờ nhau; dưới `-race` trên máy dev gói `service` (111 test) vượt 10 phút mặc định. Không đổi gì về nội dung kiểm |

## File map

**Backend — tạo mới**
- `server/migrations/069_billing_catalog.{up,down}.sql` — `plans`, `features`, `plan_features` + seed `starter` + 8 feature
- `070_plans_code_uidx`, `071_plans_default_uidx`
- `072_subscriptions.{up,down}.sql` (+ backfill), `073_subscriptions_org_live_uidx`, `074_subscriptions_provider_idx`
- `075_usage.{up,down}.sql`, `076_usage_events_idem_uidx`, `077_usage_events_org_meter_idx`
- `078_invoices.{up,down}.sql`, `079_invoices_org_idx`, `080_invoices_number_uidx`
- `081_users_platform_role.{up,down}.sql`
- `server/pkg/db/queries/billing.sql`, `usage.sql`
- `server/internal/billing/provider.go`
- `server/internal/service/entitlement.go`, `entitlement_test.go`, `billing.go`, `billing_test.go`
- `server/internal/handler/billing.go`, `dto/sdi/billing.go`, `dto/sdo/billing.go`, `router/billing.go`
- `scripts/no-plan-literal.test.mjs`

**Backend — sửa**
- `server/migrations/lint_test.go` — `tenantExemptTables` + `plans`, `features`, `plan_features`
- `server/internal/testutil/db.go` — TRUNCATE thêm bảng mới
- `server/internal/arch_test.go` — `TestBillingQueriesStayInBillingServices`
- `server/internal/service/errors.go`, `handler/auth.go` (`mapServiceError`), `dto/sdo/common.go`
- `server/internal/service/{workspace,organization,meeting_queries,meeting_ai,meeting}.go` — gate
- `server/internal/audit/actions.go`, `service/audit_coverage_test.go`
- `server/internal/outbox/catalogue.go`, `docs/events/CATALOGUE.md`, `packages/core/types/events.ts`
- `server/internal/handler/{router.go,router/routes.go,router/router.go,router/openapi.go}`, `cmd/server/main.go`, `internal/config/config.go`

**Frontend**
- `packages/core/types/billing.ts` (mới), `api/endpoints/billing.ts` + test (mới), `billing/hooks.ts` (mới), `package.json` exports
- `packages/core/permissions/rules.ts` + test, `use-resource-permissions.ts`, `index.ts` — `canManageBilling`, `canViewBilling`, `useBillingPermissions`
- `packages/core/realtime/use-realtime-sync.ts`
- `packages/views/settings/components/billing-tab.tsx` + test (mới), `settings-page.tsx`
- `packages/core/i18n/locales/{vi,en}.json` — `settings.billing.*`, `settings.page.tabs.billing`

**Docs**
- `docs/roadmap/FEATURE_ROADMAP.md` F-02 → CÓ; spec header; plan → `shipped`

## Tasks

### Task 1 — Migration + lint (`feat(db): billing catalogue, subscriptions, usage, invoices`)
- [x] `069`–`081` + down; seed `starter` `is_default`, 8 feature với `meter_mode`; backfill subscription `manual` cho mọi org
- [x] `lint_test.go`: exempt `plans`, `features`, `plan_features` (catalogue toàn hệ thống, không thuộc tenant)
- [x] `testutil/db.go` TRUNCATE thêm 7 bảng
- [x] Test backfill: sau migrate, mọi org có đúng 1 subscription sống (`entitlement_test.go`)

### Task 2 — Query + EntitlementService (`feat(billing): EntitlementService with fail-closed gate`)
- [x] `billing.sql`: plans/features/plan_features/subscriptions; `usage.sql`: usage_events, usage_counters (upsert có điều kiện `total + delta <= limit`)
- [x] `errors.go`: `ErrEntitlementRequired`, `ErrQuotaExceeded`, `ErrSubscriptionInactive`, `CodedError.Fields`; `mapServiceError` + `ErrorDetail.Fields`
- [x] `entitlement.go`: `effective()` (override > plan > fail-closed; inactive ⇒ 0 trừ GRACE `members.max`; `past_due` + 7 ngày), `Can`, `CheckQuota`, `Consume`, `Snapshot`
- [x] `arch_test.go`: query billing chỉ trong `entitlement.go`/`billing.go`
- [x] Test: bảng `effective()`; `Can` flag tắt; `CheckQuota` NULL/0; race 20 goroutine limit 10 ⇒ đúng 10; idempotency trùng ⇒ no-op

### Task 3 — Gate 4 điểm (`feat(billing): quota gates on members, workspaces, meeting minutes, recording and AI summary`)
- [x] `AcceptInvite`: nếu chưa là org member ⇒ `Consume(members.max, +1)` trong tx
- [x] `CreateInOrg`: `Consume(workspaces.max, +1)` trong tx
- [x] `meeting_queries.go`: đóng phiên tham dự ⇒ `RecordUsage(meeting.participant_minutes, ceil)`, idempotency `attendance:<id>`
- [x] `StartRecording` ⇒ `Can(meeting.recording)`; `Summarize` ⇒ `Can(meeting.ai_summary)`
- [x] Test: workspace thứ N+1 ⇒ `quota_exceeded`; `AcceptInvite` vượt ⇒ lỗi và không có dòng `organization_members`

### Task 4 — BillingService + sự kiện (`feat(billing): BillingService change plan, cancel, resume; subscription.changed`)
- [x] `internal/billing/provider.go`; config `BILLING_PROVIDER`
- [x] `billing.go`: `Current`, `ChangePlan` (owner: gói manual giá NULL/0; platform admin: bất kỳ; `row_version` ⇒ 409; B4 ⇒ `quota_exceeded`), `Cancel`, `Resume`, `Checkout`
- [x] Audit `subscription.changed`; outbox `subscription.changed`, `quota.threshold` vào catalogue ba nơi; `audit_coverage_test.go`
- [x] Test: version sai ⇒ 409; owner gói trả phí ⇒ `checkout_required`; outbox có dòng cùng tx; org khác ⇒ 403

### Task 5 — HTTP (`feat(api): billing endpoints`)
- [x] Routes: `GET /plans`, `GET /orgs/{org}/billing`, `PATCH /orgs/{org}/billing/plan`, `POST /orgs/{org}/billing/{cancel,resume,checkout}`; SDI/SDO; `main.go` wiring
- [x] `swagger_test` xanh; handler test đổi gói qua HTTP

### Task 6 — Core (`feat(core): billing types, endpoints, hooks, permission mirror`)
- [x] `types/billing.ts`; `endpoints/billing.ts` 6 hàm + malformed test
- [x] `billing/hooks.ts`: `billingKeys`, `usePlans`, `useSubscription`, `useChangePlan`, `useCancelSubscription`, `useResumeSubscription`, `useCreateCheckout`
- [x] `permissions`: `canManageBilling` (owner), `canViewBilling` (admin-like) + test; `useBillingPermissions`
- [x] realtime: `subscription.changed`, `quota.threshold` ⇒ invalidate `billingKeys.current`

### Task 7 — Views (`feat(views): billing tab in settings`)
- [x] `billing-tab.tsx`: gói hiện tại + trạng thái, usage list, đổi gói (manual ⇒ `changePlan`, trả phí ⇒ `createCheckout`), hủy/khôi phục; không có quyền ⇒ state thông báo
- [x] `settings-page.tsx` thêm tab `billing`; i18n vi/en
- [x] Test view: active / past_due / không có quyền

### Task 8 — Guard + docs đóng vòng (`docs: F-02 shipped`)
- [x] `scripts/no-plan-literal.test.mjs`
- [x] Roadmap F-02 `CÓ (2026-09-06)`; spec header; plan → `shipped`
- [x] `make check` xanh; `[agent]` comment trên UNI-425

## Đã cố ý bỏ ra ngoài

- Stripe/PayOS thật, webhook inbox worker, hóa đơn API/UI, checkout tự phục vụ — C-04.
- Cảnh báo ngưỡng quota (toast, email), `useQuotaWarnings`, `entitlement-gate-toast` — C-05.
- Admin API `/admin/plans` và UI đặt `platform_role` — F-11.
- Cache snapshot 60 s (quyết định #3).
- Meter `ai.tokens`, `storage.bytes`: chỉ seed feature; gọi `Consume` ở spec AI/Document.
- Đo phút cho đường đóng phiên hàng loạt (quyết định #6).
