import { describe, expect, it } from "vitest";
import { subscriptionAppliedAfterCheckout, type CheckoutSubscriptionFingerprint } from "./checkout-baseline";
import type { Subscription } from "../types";

const base: CheckoutSubscriptionFingerprint = {
  plan_code: "team",
  row_version: 3,
  current_period_end: "2026-10-06T00:00:00Z",
  status: "active",
};

function sub(partial: Partial<Subscription>): Subscription {
  return {
    id: "s1",
    plan_code: "team",
    plan_name: "Team",
    status: "active",
    provider: "vnpay",
    current_period_start: "2026-09-06T00:00:00Z",
    row_version: 3,
    ...partial,
  };
}

describe("subscriptionAppliedAfterCheckout", () => {
  it("detects plan upgrade", () => {
    expect(subscriptionAppliedAfterCheckout(base, sub({ plan_code: "enterprise", row_version: 4 }))).toBe(true);
  });

  it("detects renewal when plan code is unchanged", () => {
    expect(
      subscriptionAppliedAfterCheckout(
        base,
        sub({ row_version: 4, current_period_end: "2026-11-06T00:00:00Z" }),
      ),
    ).toBe(true);
  });

  it("detects past_due cleared", () => {
    expect(
      subscriptionAppliedAfterCheckout(
        { ...base, status: "past_due" },
        sub({ status: "active", row_version: 4 }),
      ),
    ).toBe(true);
  });

  it("is false when nothing changed", () => {
    expect(subscriptionAppliedAfterCheckout(base, sub({}))).toBe(false);
  });
});
