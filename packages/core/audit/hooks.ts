"use client";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as audit from "../api/endpoints/audit";
import type { AuditQuery } from "../api/endpoints/audit";

export type { AuditQuery, AuditPage } from "../api/endpoints/audit";

/**
 * Query keys for the audit log. The organization id is part of every key: two
 * organizations open in two tabs must not share a cache entry, and the filter
 * is part of the list key so paging back to a previous filter is a cache hit
 * rather than a refetch.
 */
export const auditKeys = {
  root: ["audit"] as const,
  list: (orgId: string, query: AuditQuery) => ["audit", orgId, "events", query] as const,
  event: (orgId: string, eventId: string) => ["audit", orgId, "event", eventId] as const,
  retention: (orgId: string) => ["audit", orgId, "retention"] as const,
  exports: (orgId: string) => ["audit", orgId, "exports"] as const,
  history: (wsId: string, resourceType: string, resourceId: string) =>
    ["audit", "history", wsId, resourceType, resourceId] as const,
};

/**
 * The log as pages the reader scrolls through. "Load more" appends the next
 * page under the ones already on screen; a filter change keeps the previous
 * rows visible until the new first page lands, so the table never blanks.
 */
export function useAuditEvents(orgId: string, query: AuditQuery = {}) {
  return useInfiniteQuery({
    queryKey: auditKeys.list(orgId, query),
    queryFn: ({ pageParam }) => audit.listAuditEvents(orgId, { ...query, before: pageParam }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextBefore || undefined,
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });
}

export function useAuditEvent(orgId: string, eventId: string) {
  return useQuery({
    queryKey: auditKeys.event(orgId, eventId),
    queryFn: () => audit.getAuditEvent(orgId, eventId),
    enabled: !!orgId && !!eventId,
  });
}

/** The "Activity" list on a task or meeting detail screen. */
export function useResourceHistory(wsId: string, resourceType: string, resourceId: string) {
  return useQuery({
    queryKey: auditKeys.history(wsId, resourceType, resourceId),
    queryFn: () => audit.listResourceHistory(wsId, resourceType, resourceId),
    enabled: !!wsId && !!resourceId,
  });
}

export function useAuditRetention(orgId: string) {
  return useQuery({
    queryKey: auditKeys.retention(orgId),
    queryFn: () => audit.getAuditRetention(orgId),
    enabled: !!orgId,
  });
}

export function useSetAuditRetention(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (retainDays: number) => audit.setAuditRetention(orgId, retainDays),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: auditKeys.retention(orgId) });
      // Changing retention is itself audited, so the list on screen is stale.
      void qc.invalidateQueries({ queryKey: auditKeys.root });
    },
  });
}

/**
 * Export jobs. The list refetches while one is running: the job finishes on a
 * worker, so there is no response to wait for, and a screen that never
 * updates reads as a broken button.
 */
export function useAuditExports(orgId: string) {
  return useQuery({
    queryKey: auditKeys.exports(orgId),
    queryFn: () => audit.listAuditExports(orgId),
    enabled: !!orgId,
    refetchInterval: (query) => {
      const running = query.state.data?.some((e) => e.status === "pending" || e.status === "running");
      return running ? 3000 : false;
    },
  });
}

export function useCreateAuditExport(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { format: "csv" | "json"; from: string; to: string }) =>
      audit.createAuditExport(orgId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: auditKeys.exports(orgId) }),
  });
}
