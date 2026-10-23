"use client";

import { useTranslation } from "react-i18next";
import type { TaskSurfacePagination } from "../surface/use-task-surface-data";
import { LoadMoreControls } from "./load-more-footer";

/** True while some tasks matching the query are not on screen. */
export function hasUnloadedTasks(pagination: TaskSurfacePagination): boolean {
  return pagination.hasMore || pagination.loaded < pagination.total;
}

/**
 * "Loaded N of M" above a surface fed by the flat paged query. Group and
 * lane counts only cover loaded rows, so this is where the real total is
 * stated. It counts loaded tasks, not rows on screen: with sub-tasks hidden
 * the surface can show fewer rows, even none. `withAction` adds the load-more controls for modes with no list end
 * to scroll to (gantt, swimlane); the list keeps its button at the end.
 */
export function LoadedCountNotice({
  pagination,
  withAction = false,
}: {
  pagination: TaskSurfacePagination;
  withAction?: boolean;
}) {
  const { t } = useTranslation();
  if (!hasUnloadedTasks(pagination)) return null;

  return (
    <div
      data-testid="loaded-count-notice"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5"
    >
      <p aria-live="polite" className="text-caption tabular-nums text-muted-foreground">
        {t("tasks.pagination.loaded_count", {
          count: pagination.loaded,
          total: pagination.total,
        })}
      </p>
      {withAction && pagination.hasMore ? (
        <LoadMoreControls
          isLoading={pagination.isLoadingMore}
          isError={pagination.isLoadMoreError}
          onLoadMore={pagination.loadMore}
        />
      ) : null}
    </div>
  );
}
