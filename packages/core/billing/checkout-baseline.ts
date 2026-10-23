import { sessionStorageAdapter } from "../platform/storage";
import type { Subscription } from "../types";

/** Snapshot taken before redirecting to the payment provider. */
export type CheckoutSubscriptionFingerprint = {
  plan_code: string;
  row_version: number;
  current_period_end: string;
  status: string;
};

const storageKey = (orgId: string) => `billing:checkout-baseline:${orgId}`;

export function fingerprintSubscription(sub: Subscription): CheckoutSubscriptionFingerprint {
  return {
    plan_code: sub.plan_code,
    row_version: sub.row_version,
    current_period_end: sub.current_period_end ?? "",
    status: sub.status,
  };
}

export function saveCheckoutBaseline(orgId: string, sub: Subscription): void {
  sessionStorageAdapter.setItem(storageKey(orgId), JSON.stringify(fingerprintSubscription(sub)));
}

export function readCheckoutBaseline(orgId: string): CheckoutSubscriptionFingerprint | null {
  const raw = sessionStorageAdapter.getItem(storageKey(orgId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CheckoutSubscriptionFingerprint;
  } catch {
    return null;
  }
}

export function clearCheckoutBaseline(orgId: string): void {
  sessionStorageAdapter.removeItem(storageKey(orgId));
}

/** True when a paid IPN likely applied (upgrade, renewal, or past_due cleared). */
export function subscriptionAppliedAfterCheckout(
  base: CheckoutSubscriptionFingerprint,
  current: Subscription,
): boolean {
  if (current.plan_code !== base.plan_code) return true;
  if (current.row_version > base.row_version) return true;
  if (current.current_period_end !== base.current_period_end && current.current_period_end !== undefined) {
    return true;
  }
  if (base.status === "past_due" && current.status === "active") return true;
  return false;
}
