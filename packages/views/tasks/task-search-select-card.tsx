"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useDebouncedValue } from "@uniwork/core/hooks/use-debounced-value";
import { tableRowsPageBody, tableRowsPageQuery } from "@uniwork/core/tasks/surface/table-query";
import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@uniwork/ui/components/ui/command";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { STATUS_CONFIG } from "./modes/status-config";

/**
 * The canvas search box: one bordered card, a 48px search row on a hairline,
 * the list under it. Dressed from outside through the primitive's slots.
 */
const COMMAND_CLASS = [
  "rounded-[14px]! border border-border bg-background p-0",
  "[&_[data-slot=command-input-wrapper]]:border-b [&_[data-slot=command-input-wrapper]]:border-border [&_[data-slot=command-input-wrapper]]:p-0",
  "[&_[data-slot=input-group]]:h-12! [&_[data-slot=input-group]]:rounded-none! [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:pl-1.5",
  "[&_[data-slot=command-input]]:text-body-lg [&_[data-slot=input-group]_svg]:size-4.5 [&_[data-slot=input-group]_svg]:opacity-70",
].join(" ");

/** Rows asked of the server per search; past this the list asks for a narrower search. */
const TASK_SEARCH_RESULT_CAP = 40;
const SEARCH_DEBOUNCE_MS = 250;

function TaskListSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-1 p-1">
      <span className="sr-only">{label}</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-1.5 px-2 py-1.5" aria-hidden>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * One page of the workspace's tasks matching `search`, searched on the server
 * (title words, or a task number such as "UNI-12") — the dialog never pulls
 * the whole workspace into the browser to filter it.
 */
function useSearchableWorkspaceTasks(
  workspaceId: string,
  search: string,
  enabled: boolean,
) {
  const body = tableRowsPageBody({
    query: { search },
    groupBy: "none",
    hierarchy: false,
    groupKey: null,
    parentId: null,
    cursor: null,
    limit: TASK_SEARCH_RESULT_CAP,
  });
  return useQuery({
    ...tableRowsPageQuery(workspaceId, body),
    enabled: enabled && Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

export interface TaskSearchCopy {
  listLabel: string;
  searchPlaceholder: string;
  searchLabel: string;
  loadingLabel: string;
  loadErrorLabel: string;
  retryLabel: string;
  emptySearchLabel: string;
  emptyWorkspaceLabel: string;
  selectedOptionLabel: (title: string) => string;
  disabledOptionLabel?: (title: string) => string;
  disabledBadgeLabel?: string;
  resultsCappedLabel: (count: number) => string;
}

export interface TaskSearchSelectCardProps {
  workspaceId: string;
  enabled: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  selectedId: string;
  onSelectTask: (task: { id: string; title: string }) => void;
  disabledTaskIds?: ReadonlySet<string>;
  retryButtonClassName?: string;
  copy: TaskSearchCopy;
}

/**
 * Shared server-searched task picker card used by both `LinkTaskDialog` (Chat)
 * and `DriveAttachTaskDialog` (Drive 4.2).
 */
export function TaskSearchSelectCard({
  workspaceId,
  enabled,
  query,
  onQueryChange,
  selectedId,
  onSelectTask,
  disabledTaskIds,
  retryButtonClassName,
  copy,
}: TaskSearchSelectCardProps) {
  const { t } = useTranslation();
  const search = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const tasksQuery = useSearchableWorkspaceTasks(workspaceId, search, enabled);

  const rows = tasksQuery.data?.rows ?? [];
  const shown = rows.map((row) => row.task);
  const total = tasksQuery.data?.total ?? shown.length;
  const capped = total > shown.length;
  const searching =
    query.trim() !== search ||
    (tasksQuery.isFetching && tasksQuery.isPlaceholderData);

  return (
    <>
      <Command
        shouldFilter={false}
        label={copy.listLabel}
        className={COMMAND_CLASS}
      >
        <CommandInput
          value={query}
          onValueChange={onQueryChange}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchLabel}
          autoFocus
        />
        {tasksQuery.isPending ? (
          <TaskListSkeleton label={copy.loadingLabel} />
        ) : tasksQuery.isError ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 px-3 py-4"
          >
            <p className="text-body text-muted-foreground">
              {copy.loadErrorLabel}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={retryButtonClassName}
              onClick={() => void tasksQuery.refetch()}
            >
              {copy.retryLabel}
            </Button>
          </div>
        ) : (
          <CommandList
            aria-label={copy.listLabel}
            aria-busy={searching || undefined}
            className="h-75 max-h-75 p-1.5"
          >
            <CommandEmpty className="py-6 text-body text-muted-foreground">
              {search ? copy.emptySearchLabel : copy.emptyWorkspaceLabel}
            </CommandEmpty>
            {shown.map((task) => {
              const disabled = Boolean(disabledTaskIds?.has(task.id));
              const selected = !disabled && selectedId === task.id;
              const tone = task.status
                ? STATUS_CONFIG[task.status]?.tone
                : undefined;
              // cmdk's aria-selected is the keyboard cursor; the picked task
              // is a separate fact, said by the visible check and the name.
              return (
                <CommandItem
                  key={task.id}
                  value={task.id}
                  disabled={disabled}
                  aria-disabled={disabled || undefined}
                  data-checked={selected}
                  aria-label={
                    disabled && copy.disabledOptionLabel
                      ? copy.disabledOptionLabel(task.title)
                      : selected
                        ? copy.selectedOptionLabel(task.title)
                        : task.title
                  }
                  onSelect={() => {
                    if (disabled) return;
                    onSelectTask({ id: task.id, title: task.title });
                  }}
                  className="mb-0.5 min-h-14.5 items-center gap-2.5 rounded-control px-2.5 py-2 data-[checked=true]:bg-brand-subtle data-[checked=true]:text-brand-subtle-foreground data-[checked=true]:data-[selected=true]:bg-brand-subtle data-[checked=true]:data-[selected=true]:text-brand-subtle-foreground [&>svg]:size-5! [&>svg]:text-brand"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span
                      className={cn(
                        "truncate text-body",
                        selected ? "font-semibold" : "font-medium",
                      )}
                    >
                      {task.title}
                    </span>
                    <span className="flex min-w-0 items-center gap-2 text-caption">
                      <span className="truncate text-muted-foreground tabular-nums">
                        {task.identifier || task.id}
                      </span>
                      {task.status ? (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 leading-5 font-semibold",
                            tone
                              ? tintClass[tone]
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {t(`tasks.status_${task.status}`, {
                            defaultValue: task.status,
                          })}
                        </span>
                      ) : null}
                      {disabled && copy.disabledBadgeLabel ? (
                        <span className="shrink-0 rounded-full bg-muted px-2 leading-5 font-medium text-muted-foreground">
                          {copy.disabledBadgeLabel}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </CommandItem>
              );
            })}
          </CommandList>
        )}
      </Command>

      {capped ? (
        <p className="px-0.5 text-caption text-muted-foreground">
          {copy.resultsCappedLabel(TASK_SEARCH_RESULT_CAP)}
        </p>
      ) : null}
    </>
  );
}
