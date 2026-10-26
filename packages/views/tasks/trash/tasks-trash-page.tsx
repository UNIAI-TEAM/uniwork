"use client";

import { usePurgeTask, useRestoreTask, useTaskTrash } from "@uniwork/core/tasks";
import { TrashPage } from "../../trash/trash-page";
import type { TrashItem } from "../../trash/trash-list";
import { useTrashedByName } from "../../trash/use-trashed-by-name";

/** `/tasks/trash`: tasks moved to the trash, restorable for 30 days. */
export function TasksTrashPage({ workspaceId }: { workspaceId: string }) {
  const query = useTaskTrash(workspaceId);
  const restore = useRestoreTask(workspaceId);
  const purge = usePurgeTask(workspaceId);
  const nameOf = useTrashedByName(workspaceId);

  const items: TrashItem[] = (query.data?.pages.flatMap((page) => page.items) ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    subtitle: row.identifier,
    trashedAt: row.trashed_at,
    trashedByName: nameOf(row.trashed_by),
    purgeAfter: row.purge_after,
    // batch_size counts the task itself.
    extraCount: Math.max(0, row.batch_size - 1),
  }));

  return (
    <TrashPage
      kind="task"
      items={items}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      hasMore={Boolean(query.hasNextPage)}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
      restore={{ run: restore.mutateAsync, pending: restore.isPending }}
      purge={{ run: purge.mutateAsync, pending: purge.isPending }}
    />
  );
}
