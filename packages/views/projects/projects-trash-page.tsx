"use client";

import { useProjectTrash, usePurgeProject, useRestoreProject } from "@uniwork/core/tasks";
import { TrashPage } from "../trash/trash-page";
import type { TrashItem } from "../trash/trash-list";
import { useTrashedByName } from "../trash/use-trashed-by-name";

/** `/projects/trash`: projects moved to the trash, restorable for 30 days. */
export function ProjectsTrashPage({ workspaceId }: { workspaceId: string }) {
  const query = useProjectTrash(workspaceId);
  const restore = useRestoreProject(workspaceId);
  const purge = usePurgeProject(workspaceId);
  const nameOf = useTrashedByName(workspaceId);

  const items: TrashItem[] = (query.data?.pages.flatMap((page) => page.items) ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    trashedAt: row.trashed_at,
    trashedByName: nameOf(row.trashed_by),
    purgeAfter: row.purge_after,
    extraCount: row.task_count,
  }));

  return (
    <TrashPage
      kind="project"
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
