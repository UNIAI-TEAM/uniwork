import { z } from "zod";

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "suspended", "canceled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Lenient: server enums stay strings; the exported types narrow them. */
export const PlanFeatureSchema = z.object({
  feature_key: z.string(),
  enabled: z.boolean(),
  quota_limit: z.number().nullable().optional().default(null),
});
export type PlanFeature = z.infer<typeof PlanFeatureSchema>;

export const PlanSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().optional().default(""),
  billing_period: z.string().optional().default("none"),
  price_amount: z.number().nullable().optional().default(null),
  price_currency: z.string().optional().default("VND"),
  is_default: z.boolean().optional().default(false),
  features: z.array(PlanFeatureSchema).optional().default([]),
});
export type Plan = z.infer<typeof PlanSchema>;

export const SubscriptionSchema = z.object({
  id: z.string(),
  plan_code: z.string(),
  plan_name: z.string(),
  status: z.string(),
  provider: z.string(),
  current_period_start: z.string(),
  current_period_end: z.string().optional(),
  cancel_at: z.string().optional(),
  trial_ends_at: z.string().optional(),
  row_version: z.number(),
});
export type Subscription = Omit<z.infer<typeof SubscriptionSchema>, "status"> & {
  status: SubscriptionStatus;
};

/** One feature as it applies to the organization now, usage included. */
export const EntitlementSchema = z.object({
  feature_key: z.string(),
  name: z.string(),
  kind: z.string(),
  unit: z.string().optional(),
  category: z.string().optional().default("general"),
  enabled: z.boolean(),
  quota_limit: z.number().nullable().optional().default(null),
  current_usage: z.number().optional().default(0),
  /** false = nothing reads or writes this feature yet; the UI hides it. */
  metered: z.boolean().optional().default(true),
});
export type Entitlement = z.infer<typeof EntitlementSchema>;

export interface SubscriptionView {
  subscription: Subscription;
  entitlements: Entitlement[];
}
