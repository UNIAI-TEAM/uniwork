"use client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as admin from "../api/endpoints/admin";
import type { AdminOrganizationQuery } from "../api/endpoints/admin";
import type { FlagOverrideDeleteInput, FlagOverrideInput } from "../types/admin";
import { adminKeys } from "./keys";

export { adminKeys } from "./keys";
export type { AdminOrganizationQuery } from "../api/endpoints/admin";

/**
 * The caller's platform role. A 404 is the server saying "no role" without
 * admitting the route exists; the layout guard reads the error status and
 * leaves. Never retried: the answer does not change between attempts.
 */
export function useAdminMe() {
  return useQuery({ queryKey: adminKeys.me, queryFn: admin.getAdminMe, retry: false });
}

export function useAdminOrganizations(query: AdminOrganizationQuery = {}, enabled = true) {
  return useQuery({
    queryKey: adminKeys.organizations(query),
    queryFn: () => admin.listAdminOrganizations(query),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAdminOrganization(orgId: string) {
  return useQuery({
    queryKey: adminKeys.organization(orgId),
    queryFn: () => admin.getAdminOrganization(orgId),
    enabled: !!orgId,
  });
}

/**
 * Every admin write awaits the server and refetches (spec §9: not
 * optimistic). The list and the detail both carry status/plan, so both go.
 */
function useOrganizationMutation<TVars>(orgId: string, fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.organization(orgId) });
      void qc.invalidateQueries({ queryKey: adminKeys.organizationsRoot });
    },
  });
}

export function useSuspendOrganization(orgId: string) {
  return useOrganizationMutation(orgId, (reason: string) => admin.suspendOrganization(orgId, reason));
}

export function useUnsuspendOrganization(orgId: string) {
  return useOrganizationMutation(orgId, (reason: string) => admin.unsuspendOrganization(orgId, reason));
}

export function useChangeOrganizationPlan(orgId: string) {
  return useOrganizationMutation(orgId, (body: { plan_code: string; reason: string }) =>
    admin.changeOrganizationPlan(orgId, body),
  );
}

export function useAdminTrace(traceId: string) {
  return useQuery({
    queryKey: adminKeys.trace(traceId),
    queryFn: () => admin.getAdminTrace(traceId),
    enabled: !!traceId,
  });
}

export function useAdminSystem() {
  return useQuery({ queryKey: adminKeys.system, queryFn: admin.getAdminSystem });
}

export function useAdminFlags() {
  return useQuery({ queryKey: adminKeys.flags, queryFn: admin.listAdminFlags });
}

export function useFlagOverrides(key: string) {
  return useQuery({
    queryKey: adminKeys.overrides(key),
    queryFn: () => admin.listFlagOverrides(key),
    enabled: !!key,
  });
}

function useOverrideMutation<TVars>(key: string, fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.overrides(key) });
      // The catalogue shows the override count.
      void qc.invalidateQueries({ queryKey: adminKeys.flags });
    },
  });
}

export function useSetFlagOverride(key: string) {
  return useOverrideMutation(key, (body: FlagOverrideInput) => admin.setFlagOverride(key, body));
}

export function useDeleteFlagOverride(key: string) {
  return useOverrideMutation(key, (body: FlagOverrideDeleteInput) => admin.deleteFlagOverride(key, body));
}
