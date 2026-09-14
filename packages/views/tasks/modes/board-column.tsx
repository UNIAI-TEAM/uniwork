"use client";

import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { EyeOff, MoreHorizontal, Plus } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";
import type { Task, TaskStatus } from "@uniwork/core/types";
import type { ActorKind } from "@uniwork/core/types/audit";
import { useViewStoreApi } from "@uniwork/core/tasks/stores/view-store-context";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import type { BoardColumnPaging } from "../surface/use-board-columns-data";
import {
  DraggableBoardCard,
  type BoardCardMeta,
} from "./board-card";
import { LoadMoreFooter } from "./load-more-footer";
import { statusColumnBg, STATUS_CONFIG } from "./status-config";
import { StatusPill } from "./status-pill";

export const BOARD_COL_WIDTH = 280;
export const BOARD_CARD_WIDTH = BOARD_COL_WIDTH - 16 - 8;

const BOARD_SEED_COUNT = 10;
const BOARD_CARD_ESTIMATED_HEIGHT = 110;
const BOARD_VIRTUALIZE_THRESHOLD = 30;

interface BoardVirtuosoContext {
  footer: ReactNode;
}

/**
 * Virtuoso's footer slot: one component for every render, the footer passed
 * through `context`. A component created per render would remount the footer,
 * and its load-more sentinel would observe again and ask for another page.
 */
function BoardVirtuosoFooter({ context }: { context: BoardVirtuosoContext }) {
  return <>{context.footer}</>;
}

const BOARD_VIRTUOSO_COMPONENTS = { Footer: BoardVirtuosoFooter };

interface BoardColumnGroupBase {
  id: string;
  title: string;
  totalCount?: number;
}

export type BoardColumnGroup = BoardColumnGroupBase &
  (
    | {
        kind: "status";
        /** Board status columns are categories, never raw custom status keys. */
        status: string;
        createData?: { status?: string };
      }
    | {
        kind: "assignee";
        assigneeId: string | null;
        assigneeKind?: ActorKind;
        createData?: {
          assignee_id?: string | null;
          assignee_kind?: ActorKind;
        };
      }
    | {
        kind: "project";
        projectId: string | null;
      }
  );

export const BoardColumn = memo(function BoardColumn({
  group,
  taskIds,
  taskMap,
  cardMeta,
  totalCount,
  countIsPartial = false,
  paging,
  onCreateTask,
  onOpenTask,
  sortLabel,
  disableDragging = false,
}: {
  group: BoardColumnGroup;
  taskIds: string[];
  taskMap: Map<string, Task>;
  cardMeta?: ReadonlyMap<string, BoardCardMeta>;
  /** Tasks in the column on the server; the loaded cards when absent. */
  totalCount?: number;
  /** The count covers only the tasks loaded so far, so the heading says "N loaded", not a total. */
  countIsPartial?: boolean;
  /** Server paging of this column, which then ends with the shared load-more footer. */
  paging?: BoardColumnPaging;
  onCreateTask?: (defaults: {
    status?: string;
    assignee_id?: string | null;
    assignee_kind?: ActorKind;
  }) => void;
  onOpenTask?: (id: string) => void;
  sortLabel?: string | null;
  disableDragging?: boolean;
}) {
  const status = group.kind === "status" ? group.status : undefined;
  const cfg = status ? STATUS_CONFIG[status as TaskStatus] : null;
  const { setNodeRef, isOver } = useDroppable({ id: group.id });
  const viewStoreApi = useViewStoreApi();
  const { t } = useTranslation();

  const resolvedTasks = useMemo(
    () =>
      taskIds.flatMap((id) => {
        const task = taskMap.get(id);
        return task ? [task] : [];
      }),
    [taskIds, taskMap],
  );

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const mergedRef = useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      setScrollEl(el);
    },
    [setNodeRef],
  );

  // The column end is where its next page is asked for, in both branches below.
  // Virtuoso's endReached is left unwired on purpose: it fires again whenever
  // the data array is rebuilt, which every page landing and every realtime
  // refetch does, so a column end on screen would load every page by itself.
  const footer = paging ? (
    <LoadMoreFooter
      hasMore={paging.hasMore}
      isLoading={paging.isLoadingMore}
      isError={paging.isError}
      total={paging.count}
      onLoadMore={paging.loadMore}
    />
  ) : null;

  const computeItemKey = (_index: number, task: Task) => task.id;
  const itemContent = (index: number, task: Task) => (
    <div className={index === 0 ? undefined : "pt-2"}>
      <DraggableBoardCard
        task={task}
        meta={cardMeta?.get(task.id)}
        onOpen={onOpenTask}
        disableSorting={!!sortLabel}
        disableDragging={disableDragging}
      />
    </div>
  );

  const count = totalCount ?? taskIds.length;
  const labelKey = status ? `tasks.status_${status}` : "";
  const translated = status ? t(labelKey) : group.title;
  const title =
    status && translated !== labelKey ? translated : group.title || status || "";

  return (
    <div
      style={{ width: BOARD_COL_WIDTH }}
      data-testid={status ? `board-column-${status}` : `board-column-${group.id}`}
      className={cn(
        "flex shrink-0 flex-col rounded-xl p-2",
        cfg?.columnBg ?? statusColumnBg(status ?? "") ?? "bg-muted/40",
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1.5">
        <div
          className="flex min-w-0 items-center gap-2"
          role="heading"
          aria-level={3}
          aria-label={
            countIsPartial
              ? `${title}, ${t("tasks.surface.loaded_count", { count })}`
              : `${title}, ${count}`
          }
        >
          {status ? (
            <StatusPill status={status} label={title} className="max-w-full" />
          ) : (
            <span className="truncate text-body font-medium" title={title}>
              {title}
            </span>
          )}
          <span className="shrink-0 text-caption font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {status ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full text-muted-foreground"
                    aria-label={t("tasks.surface.column_menu")}
                  />
                }
              >
                <MoreHorizontal className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    viewStoreApi.getState().hideStatus(status as TaskStatus)
                  }
                >
                  <EyeOff className="size-3.5" />
                  {t("tasks.surface.hide_column")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {onCreateTask && "createData" in group ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-muted-foreground"
              aria-label={t("tasks.surface.add_task")}
              onClick={() =>
                onCreateTask({
                  ...(group.createData ?? {}),
                })
              }
            >
              <Plus className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-[200px] flex-1 rounded-lg">
        {isOver && sortLabel ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/40">
            <span className="rounded-md border border-border bg-popover px-2.5 py-1 text-caption font-medium text-popover-foreground shadow-sm">
              {sortLabel}
            </span>
          </div>
        ) : null}
        <div
          ref={mergedRef}
          className={cn(
            "absolute inset-0 overflow-y-auto rounded-lg p-1 transition-colors",
            isOver && sortLabel
              ? "bg-accent/15 ring-2 ring-brand/25"
              : isOver
                ? "bg-accent/60"
                : "",
          )}
        >
          {resolvedTasks.length > 0 ? (
            <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
              {resolvedTasks.length <= BOARD_VIRTUALIZE_THRESHOLD ? (
                <>
                  {resolvedTasks.map((task, index) => (
                    <div key={task.id}>{itemContent(index, task)}</div>
                  ))}
                  {footer}
                </>
              ) : scrollEl ? (
                <Virtuoso
                  customScrollParent={scrollEl}
                  data={resolvedTasks}
                  context={{ footer }}
                  computeItemKey={computeItemKey}
                  initialItemCount={Math.min(
                    resolvedTasks.length,
                    BOARD_SEED_COUNT,
                  )}
                  defaultItemHeight={BOARD_CARD_ESTIMATED_HEIGHT}
                  increaseViewportBy={{ top: 300, bottom: 300 }}
                  components={BOARD_VIRTUOSO_COMPONENTS}
                  itemContent={itemContent}
                />
              ) : (
                resolvedTasks
                  .slice(0, BOARD_SEED_COUNT)
                  .map((task, index) => (
                    <div key={task.id}>{itemContent(index, task)}</div>
                  ))
              )}
            </SortableContext>
          ) : (
            <>
              {/* A column still paging (or retrying a failed page) is not empty. */}
              {taskIds.length === 0 && !paging?.hasMore ? (
                <p className="py-8 text-center text-caption text-muted-foreground">
                  {t("tasks.surface.empty_column")}
                </p>
              ) : null}
              {footer}
            </>
          )}
        </div>
      </div>
    </div>
  );
});
