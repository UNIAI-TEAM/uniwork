"use client";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { listTrash, type TrashKind } from "../api/endpoints/trash";
import { trashKeys } from "./keys";

export interface TrashFilters {
  kind?: TrashKind;
  q?: string;
  trashedBy?: string;
}

/** The shared trash, one page per cursor; a filter change is a new list. */
export function useTrashList(wsId: string, filters: TrashFilters = {}) {
  const { kind, q, trashedBy } = filters;
  return useInfiniteQuery({
    queryKey: trashKeys.list(wsId, JSON.stringify([kind ?? "", q ?? "", trashedBy ?? ""])),
    queryFn: ({ pageParam }) => listTrash(wsId, { kind, q, trashedBy, cursor: pageParam || undefined }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: !!wsId,
    // Keep the rows while a filter changes, never across workspaces.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === wsId ? keepPreviousData(previous) : undefined,
  });
}
