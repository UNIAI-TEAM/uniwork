"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as billing from "../api/endpoints/billing";

/**
 * Query keys for billing. The organization id is part of every key: the
 * subscription belongs to the organization, not to the workspace on screen.
 */
export const billingKeys = {
  plans: ["billing", "plans"] as const,
  current: (orgId: string) => ["billing", orgId, "subscription"] as const,
};

export function usePlans() {
  return useQuery({ queryKey: billingKeys.plans, queryFn: billing.listPlans });
}

export function useSubscription(orgId: string) {
  return useQuery({
    queryKey: billingKeys.current(orgId),
    queryFn: () => billing.getSubscription(orgId),
    enabled: !!orgId,
  });
}

function useSubscriptionMutation<TVars>(orgId: string, fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // Every change is a fresh snapshot from the server; the socket also
    // invalidates for other admins (subscription.changed).
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.current(orgId) }),
  });
}

export function useChangePlan(orgId: string) {
  return useSubscriptionMutation(orgId, (body: { plan_code: string; row_version: number }) =>
    billing.changePlan(orgId, body),
  );
}

export function useCancelSubscription(orgId: string) {
  return useSubscriptionMutation(orgId, () => billing.cancelSubscription(orgId));
}

export function useResumeSubscription(orgId: string) {
  return useSubscriptionMutation(orgId, () => billing.resumeSubscription(orgId));
}

export function useCreateCheckout(orgId: string) {
  return useMutation({
    mutationFn: (body: { plan_code: string; success_path: string; cancel_path: string }) =>
      billing.createCheckout(orgId, body),
  });
}
