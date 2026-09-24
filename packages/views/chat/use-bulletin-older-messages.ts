"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listChatRoomMessages, type ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { chatKeys } from "@uniwork/core/chat";

const OLDER_PAGE = 80;

function oldestCreatedAt(rows: ChatMessageRecord[]): string | null {
  let oldest: ChatMessageRecord | null = null;
  for (const row of rows) {
    if (!oldest || Date.parse(row.created_at) < Date.parse(oldest.created_at)) oldest = row;
  }
  return oldest?.created_at ?? null;
}

/**
 * The bulletin only knows the room's loaded window. "Load older" pages further
 * back on request, from a cursor frozen at the first click so a message
 * arriving meanwhile does not restart the walk. Reads never advance the read
 * cursor (mark_read=0).
 */
export function useBulletinOlderMessages(
  workspaceId: string,
  roomId: string,
  windowRows: ChatMessageRecord[],
  windowFull: boolean,
) {
  const [from, setFrom] = useState<string | null>(null);
  const older = useInfiniteQuery({
    queryKey: chatKeys.roomBulletinOlder(workspaceId, roomId, from ?? ""),
    enabled: Boolean(from),
    initialPageParam: from ?? "",
    queryFn: ({ pageParam }) =>
      listChatRoomMessages(workspaceId, roomId, { before: pageParam, limit: OLDER_PAGE, mark_read: false }),
    getNextPageParam: (last) => (last.length < OLDER_PAGE ? undefined : (oldestCreatedAt(last) ?? undefined)),
  });

  const rows = useMemo(() => {
    const pages = older.data?.pages ?? [];
    if (pages.length === 0) return windowRows;
    const seen = new Set(windowRows.map((row) => row.id));
    const merged = [...windowRows];
    for (const page of pages) {
      for (const row of page) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        merged.push(row);
      }
    }
    return merged;
  }, [older.data, windowRows]);

  const started = from !== null;
  const canLoadMore = started ? older.hasNextPage || older.isError || older.isFetching : windowFull;

  return {
    rows,
    canLoadMore,
    loadingMore: older.isFetching,
    loadMoreFailed: older.isError,
    loadMore: () => {
      if (!started) {
        const cursor = oldestCreatedAt(windowRows);
        if (cursor) setFrom(cursor);
        return;
      }
      if (older.isError && !older.data) {
        void older.refetch();
        return;
      }
      void older.fetchNextPage();
    },
  };
}
