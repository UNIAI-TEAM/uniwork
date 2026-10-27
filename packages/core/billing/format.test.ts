import { describe, expect, it } from "vitest";
import { formatPlanAmount, formatPlanQuotaLimit, formatPrice } from "./format";
import { PlanSchema } from "../types/billing";

const t = (key: string, options?: Record<string, unknown>) => {
  if (key === "price_per") return `${options?.amount} / ${options?.period}`;
  if (key === "plan_line_storage_gb") return `${options?.n} GB`;
  return key;
};

describe("catalog price and quota presentation", () => {
  it("distinguishes contact-only, free, and paid yearly plans without assuming a monthly price", () => {
    const plan = PlanSchema.parse({ id: "p", code: "custom", name: "Custom", price_amount: null });
    expect(formatPrice(plan, "en", t)).toBe("price_contact");
    expect(formatPrice({ ...plan, price_amount: 0 }, "en", t)).toBe("price_free");
    expect(formatPrice({ ...plan, price_amount: 890000, billing_period: "year" }, "en", t)).toBe("₫890,000 / period.year");
  });
  it("preserves currency precision and safely renders unknown currencies", () => {
    expect(formatPlanAmount(19.95, "USD", "en")).toBe("$19.95");
    expect(formatPlanAmount(18, "invalid-currency", "en")).toBe("18 invalid-currency");
  });
  it("distinguishes unlimited and zero without rounding storage limits up", () => {
    expect(formatPlanQuotaLimit("tasks.max", null, "en", t)).toBe("unlimited");
    expect(formatPlanQuotaLimit("tasks.max", 0, "en", t)).toBe("0");
    expect(formatPlanQuotaLimit("storage.bytes", 1.5 * 1024 ** 3, "en", t)).toBe("1.5 GB");
  });
});
