"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import * as api from "../api/endpoints/home";
import { updateTask } from "../api/endpoints/tasks";
import { batchUpdateTasks } from "../api/endpoints/tasks-suite";
import { useMarkRead } from "../notifications/hooks";
import { taskKeys } from "../tasks/keys";
import type { TaskStatus } from "../types/task";
import type { HomePreference, HomeSummary } from "../types/home";
import { overdueDays } from "./brief";
import { homeKeys } from "./keys";
import { DEFAULT_HOME_PREFS, normalizeHomePrefs, type HomePrefs } from "./prefs";

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

/**
 * The undo of a completion: each task goes back to the status it had. Not
 * optimistic — the completed rows are still on screen, dimmed, until the
 * refetch settles them either way.
 */
export function useReopenHomeTasks(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (previous: { id: string; status: TaskStatus }[]) => {
      await Promise.all(previous.map(({ id, status }) => updateTask(id, { status })));
    },
    onSettled: (_data, _error, previous) =>
      invalidateAfterComplete(
        qc,
        wsId,
        previous.map((p) => p.id),
      ),
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

/** The cached summary without the given notification, its unread count taken off when it was unread. */
function dropNotification(summary: HomeSummary | null | undefined, id: string): HomeSummary | null | undefined {
  const row = summary?.inbox.find((n) => n.id === id);
  if (!summary || !row) return summary;
  return {
    ...summary,
    inbox: summary.inbox.filter((n) => n.id !== id),
    counts: { ...summary.counts, unread: row.read_at ? summary.counts.unread : atLeastZero(summary.counts.unread - 1) },
  };
}

/**
 * Opening an inbox row from home marks it read and takes it off the cached
 * summary at once, so coming back to home never shows it as waiting. The
 * inbox caches are patched by the notification hook itself, and its settle
 * refetches the summary.
 */
export function useReadHomeNotification(wsId: string) {
  const qc = useQueryClient();
  const { mutate } = useMarkRead();
  return useCallback(
    (id: string) => {
      qc.setQueryData<HomeSummary | null>(homeKeys.summary(wsId), (summary) => dropNotification(summary, id));
      mutate([id]);
    },
    [mutate, qc, wsId],
  );
}
