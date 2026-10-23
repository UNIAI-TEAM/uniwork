# C-05 · Quota UI và cảnh báo ngưỡng

> **Trạng thái:** in-progress  
> **Spec:** `docs/superpowers/specs/2026-09-04-tenant-subscription-entitlement-design.md` (§6 FE)  
> **Phụ thuộc:** F-02 (entitlement + `quota.threshold` outbox), tab Thanh toán (`BillingUsage` / `QuotaMeterRow`)

## Phạm vi

- Toast khi `quota.threshold` realtime (owner/admin org, payload ids-only).
- Toast khi API trả `quota_exceeded` / `entitlement_required` (`apiErrorBus` → `EntitlementGateToastHost`).
- UI hạn mức trên tab Thanh toán đã có (`billing-usage`, `quota-meter`).

## Chưa ship

- Email ngưỡng quota (notify lane).
- `useQuotaWarnings` gắn meter/level chi tiết nếu catalogue bổ sung field.
