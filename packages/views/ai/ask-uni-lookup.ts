"use client";

import { useQuery } from "@tanstack/react-query";
import { useChatRooms } from "@uniwork/core/chat";
import { useDocumentList } from "@uniwork/core/documents/hooks-collections";
import { useDebouncedValue } from "@uniwork/core/hooks/use-debounced-value";
import { useMeetings } from "@uniwork/core/meetings";
import { tableRowsPageBody, tableRowsPageQuery } from "@uniwork/core/tasks/surface/table-query";
import { useProjects, useSearchProjects } from "@uniwork/core/tasks";
import { useMembers } from "@uniwork/core/workspaces";

/** One thing a question can name or be scoped to. */
export interface LookupItem {
  id: string;
  title: string;
}

const LIMIT = 5;
const SEARCH_DEBOUNCE_MS = 200;

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const has = (hay: string, needle: string) => norm(hay).includes(norm(needle));

export function useMemberMatches(wsId: string, q: string): LookupItem[] {
  const members = useMembers(wsId).data ?? [];
  return members
    .filter((m) => !q || has(m.display_name, q) || has(m.email, q))
    .slice(0, LIMIT)
    .map((m) => ({ id: m.user_id, title: m.display_name || m.email }));
}

/** Tasks are searched on the server after the typing settles; an empty query asks nothing. */
export function useTaskMatches(wsId: string, q: string, enabled: boolean): LookupItem[] {
  const search = useDebouncedValue(q.trim(), SEARCH_DEBOUNCE_MS);
  const body = tableRowsPageBody({
    query: { search },
    groupBy: "none",
    hierarchy: false,
    groupKey: null,
    parentId: null,
    cursor: null,
    limit: LIMIT,
  });
  const rows = useQuery({ ...tableRowsPageQuery(wsId, body), enabled: enabled && !!wsId && search !== "" });
  return search === "" ? [] : (rows.data?.rows ?? []).map((r) => ({ id: r.task.id, title: r.task.title }));
}

export function useDocumentMatches(wsId: string, q: string, enabled: boolean): LookupItem[] {
  const search = useDebouncedValue(q.trim(), SEARCH_DEBOUNCE_MS);
  const list = useDocumentList(wsId, { q: search || undefined, kind: "document", limit: LIMIT }, { enabled });
  return enabled ? (list.data?.pages[0]?.documents ?? []).slice(0, LIMIT).map((d) => ({ id: d.id, title: d.title })) : [];
}

export function useMeetingMatches(wsId: string, q: string, enabled: boolean): LookupItem[] {
  const search = useDebouncedValue(q.trim(), SEARCH_DEBOUNCE_MS);
  // An empty workspace id keeps the list query idle.
  const list = useMeetings(enabled ? wsId : "", { q: search || undefined, limit: LIMIT });
  return enabled ? (list.data?.meetings ?? []).slice(0, LIMIT).map((m) => ({ id: m.id, title: m.title })) : [];
}

export function useProjectMatches(wsId: string, q: string, enabled: boolean): LookupItem[] {
  const search = useDebouncedValue(q.trim(), SEARCH_DEBOUNCE_MS);
  const found = useSearchProjects(enabled ? wsId : "", { q: search, limit: LIMIT });
  const all = useProjects(enabled && search === "" ? wsId : "");
  const projects = search ? (found.data?.projects ?? []) : (all.data?.projects ?? []);
  return enabled ? projects.slice(0, LIMIT).map((p) => ({ id: p.id, title: p.title })) : [];
}

export function useRoomMatches(wsId: string, q: string, enabled: boolean): LookupItem[] {
  const rooms = useChatRooms(enabled ? wsId : "").data ?? [];
  return enabled
    ? rooms.filter((r) => r.name && (!q || has(r.name, q))).slice(0, LIMIT).map((r) => ({ id: r.id, title: r.name }))
    : [];
}
