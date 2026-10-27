"use client";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { listTrash, TRASH_KINDS, type TrashKind } from "../api/endpoints/trash";
import { trashKeys } from "./keys";

export interface TrashFilters {
  kinds?: TrashKind[];
  q?: string;
  trashedBy?: string[];
}

/** The shared trash, one page per cursor; a filter change is a new list, the order of the picks is not. */
export function useTrashList(wsId: string, filters: TrashFilters = {}) {
  const picked = filters.kinds ?? [];
  const kinds = TRASH_KINDS.filter((kind) => picked.includes(kind));
  const trashedBy = [...new Set(filters.trashedBy)].sort();
  const q = filters.q;
  return useInfiniteQuery({
    queryKey: trashKeys.list(wsId, JSON.stringify([kinds, q ?? "", trashedBy])),
    queryFn: ({ pageParam }) => listTrash(wsId, { kinds, q, trashedBy, cursor: pageParam || undefined }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: !!wsId,
    // Keep the rows while a filter changes, never across workspaces.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === wsId ? keepPreviousData(previous) : undefined,
  });
}
