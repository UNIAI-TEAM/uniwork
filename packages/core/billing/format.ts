import type { Plan } from "../types/billing";

type Translate = (key: string, options?: Record<string, unknown>) => string;
const ZERO_DECIMAL_CURRENCIES = new Set(["VND", "JPY", "KRW", "CLP", "ISK", "UGX", "XAF", "XOF"]);

/** The catalog stores currency amounts as used by the organization's billing UI. */
export function formatPlanAmount(amount: number, currency: string, locale: string): string {
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      ...(ZERO_DECIMAL_CURRENCIES.has(code) ? { maximumFractionDigits: 0 } : {}),
    }).format(amount);
  } catch {
    return `${amount.toLocaleString(locale)} ${currency}`.trim();
  }
}

/** Expects translation keys scoped to settings.billing. */
export function formatPrice(plan: Plan, locale: string, t: Translate): string {
  if (plan.price_amount === null) return t("price_contact");
  if (plan.price_amount === 0) return t("price_free");
  const amount = formatPlanAmount(plan.price_amount, plan.price_currency, locale);
  return plan.billing_period === "none"
    ? amount
    : t("price_per", { amount, period: t(`period.${plan.billing_period}`, { defaultValue: plan.billing_period }) });
}

export function formatPlanQuotaLimit(featureKey: string, limit: number | null, locale: string, t: Translate): string {
  if (limit === null) return t("unlimited");
  if (featureKey === "storage.bytes") {
    // Preserve fractional GiB: rounding a real catalog limit up would overstate the offer.
    return t("plan_line_storage_gb", { n: (limit / 1024 ** 3).toLocaleString(locale, { maximumFractionDigits: 2 }) });
  }
  return limit.toLocaleString(locale);
}
