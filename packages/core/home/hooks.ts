"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import * as api from "../api/endpoints/home";
import { updateTask } from "../api/endpoints/tasks";
import { batchUpdateTasks } from "../api/endpoints/tasks-suite";
import { taskKeys } from "../tasks/keys";
import type { HomePreference, HomeSummary } from "../types/home";
import { overdueDays } from "./brief";
import { DEFAULT_HOME_PREFS, normalizeHomePrefs, type HomePrefs } from "./prefs";

/** Workspace-scoped: the home screen is one person's view of one workspace. */
export const homeKeys = {
  summary: (wsId: string) => ["home", wsId, "summary"] as const,
  prefs: (wsId: string) => ["home", wsId, "prefs"] as const,
};

export function useHomeSummary(wsId: string) {
  return useQuery({
    queryKey: homeKeys.summary(wsId),
    queryFn: () => api.getHomeSummary(wsId),
    staleTime: 60_000,
  });
}

const atLeastZero = (n: number) => Math.max(0, n);

/** The cached summary with the given rows marked done and their counts taken off. */
function markDone(summary: HomeSummary, ids: string[]): HomeSummary {
  const hit = summary.my_work.filter((t) => ids.includes(t.id) && t.status !== "done");
  if (hit.length === 0) return summary;
  const overdue = hit.filter((t) => overdueDays(summary.today, t.due_date) > 0).length;
  const dueToday = hit.filter((t) => t.due_date === summary.today).length;
  return {
    ...summary,
    my_work: summary.my_work.map((t) => (ids.includes(t.id) ? { ...t, status: "done" } : t)),
    counts: {
      ...summary.counts,
      open: atLeastZero(summary.counts.open - hit.length),
      overdue: atLeastZero(summary.counts.overdue - overdue),
      due_today: atLeastZero(summary.counts.due_today - dueToday),
    },
  };
}

function invalidateAfterComplete(qc: QueryClient, wsId: string, ids: string[]) {
  const keys = [
    homeKeys.summary(wsId),
    taskKeys.list(wsId),
    taskKeys.myTasks(wsId),
    taskKeys.queryRoot(wsId),
    taskKeys.tableRoot(wsId),
    ...ids.map((id) => taskKeys.detail(id)),
  ];
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
}

/**
 * Completes one task (PATCH) or several (batch update). Optimistic on purpose:
 * the outcome is predictable, the person stays on the home screen, failure is
 * rare and rollback is a cache restore. The row stays, dimmed, until the
 * refetch drops it.
 */
export function useCompleteHomeTasks(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 1) await updateTask(ids[0]!, { status: "done" });
      else await batchUpdateTasks(wsId, { task_ids: ids, updates: { status: "done" } });
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: homeKeys.summary(wsId) });
      const previous = qc.getQueryData<HomeSummary | null>(homeKeys.summary(wsId));
      if (previous) qc.setQueryData<HomeSummary | null>(homeKeys.summary(wsId), markDone(previous, ids));
      return { previous };
    },
    onError: (_error, _ids, ctx) => {
      if (ctx?.previous) qc.setQueryData(homeKeys.summary(wsId), ctx.previous);
    },
    onSettled: (_data, _error, ids) => invalidateAfterComplete(qc, wsId, ids),
  });
}

/** The person's layout, saved optimistically; a failed save restores the last one. */
export function useHomePrefs(wsId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: homeKeys.prefs(wsId),
    queryFn: () => api.getHomePreference(wsId),
    staleTime: 5 * 60_000,
  });
  const prefs = useMemo(() => normalizeHomePrefs(query.data?.prefs), [query.data]);

  const mutation = useMutation({
    mutationFn: (next: HomePrefs) => api.putHomePreference(wsId, next),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: homeKeys.prefs(wsId) });
      const previous = qc.getQueryData<HomePreference>(homeKeys.prefs(wsId));
      qc.setQueryData<HomePreference>(homeKeys.prefs(wsId), { prefs: next, updated_at: previous?.updated_at ?? "" });
      return { previous };
    },
    onError: (_error, _next, ctx) => {
      if (ctx?.previous) qc.setQueryData(homeKeys.prefs(wsId), ctx.previous);
      else void qc.invalidateQueries({ queryKey: homeKeys.prefs(wsId) });
    },
    onSuccess: (saved) => {
      if (saved) qc.setQueryData(homeKeys.prefs(wsId), saved);
    },
  });

  const { mutate } = mutation;
  const update = useCallback((next: HomePrefs) => mutate(next), [mutate]);
  const reset = useCallback(() => mutate(DEFAULT_HOME_PREFS), [mutate]);

  return { prefs, loading: query.isLoading, saving: mutation.isPending, failed: mutation.isError, update, reset };
}
