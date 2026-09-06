import { z } from "zod";
import {
  EntitlementSchema,
  PlanSchema,
  SubscriptionSchema,
  type Plan,
  type SubscriptionView,
} from "../../types/billing";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const PlansResponse = z.object({ plans: z.array(PlanSchema) });
const SubscriptionResponse = z.object({
  subscription: SubscriptionSchema,
  entitlements: z.array(EntitlementSchema).optional().default([]),
});
const CheckoutResponse = z.object({ url: z.string() });

const enc = encodeURIComponent;

export async function listPlans(): Promise<Plan[]> {
  const raw = await request("/api/v1/plans");
  return parseWithFallback<{ plans: Plan[] }>(raw, PlansResponse, { plans: [] }, {
    endpoint: "GET /api/v1/plans",
  }).plans;
}

function parseSubscription(raw: unknown, endpoint: string): SubscriptionView | null {
  return parseWithFallback<SubscriptionView | null>(raw, SubscriptionResponse, null, { endpoint });
}

/** The organization's subscription with effective entitlements and usage. */
export async function getSubscription(orgId: string): Promise<SubscriptionView | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/billing`);
  return parseSubscription(raw, "GET /api/v1/orgs/{org}/billing");
}

export async function changePlan(
  orgId: string,
  body: { plan_code: string; row_version: number },
): Promise<SubscriptionView | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/billing/plan`, { method: "PATCH", body });
  return parseSubscription(raw, "PATCH /api/v1/orgs/{org}/billing/plan");
}

export async function cancelSubscription(orgId: string): Promise<SubscriptionView | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/billing/cancel`, { method: "POST" });
  return parseSubscription(raw, "POST /api/v1/orgs/{org}/billing/cancel");
}

export async function resumeSubscription(orgId: string): Promise<SubscriptionView | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/billing/resume`, { method: "POST" });
  return parseSubscription(raw, "POST /api/v1/orgs/{org}/billing/resume");
}

/** Payment page URL from the provider; 503 billing_provider_unavailable on manual. */
export async function createCheckout(
  orgId: string,
  body: { plan_code: string; success_path: string; cancel_path: string },
): Promise<string> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/billing/checkout`, { method: "POST", body });
  return parseWithFallback<{ url: string }>(raw, CheckoutResponse, { url: "" }, {
    endpoint: "POST /api/v1/orgs/{org}/billing/checkout",
  }).url;
}
