"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLinkChatMessage } from "@uniwork/core/chat";
import { useDebouncedValue } from "@uniwork/core/hooks/use-debounced-value";
import { tableRowsPageBody, tableRowsPageQuery } from "@uniwork/core/tasks/surface/table-query";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@uniwork/ui/components/ui/command";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import { STATUS_CONFIG } from "../tasks/modes/status-config";
import { CHAT_DIALOG_BODY_CLASS, CHAT_DIALOG_CLASS, CHAT_DIALOG_WIDTH } from "./chat-dialog-look";
import { chatErrorMessage } from "./chat-error-message";

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
const RESULT_CAP = 40;
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
function useLinkableTasks(workspaceId: string, search: string, enabled: boolean) {
  const body = tableRowsPageBody({
    query: { search },
    groupBy: "none",
    hierarchy: false,
    groupKey: null,
    parentId: null,
    cursor: null,
    limit: RESULT_CAP,
  });
  return useQuery({
    ...tableRowsPageQuery(workspaceId, body),
    enabled: enabled && Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

export function LinkTaskDialog({
  open,
  onOpenChange,
  workspaceId,
  messageId,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  messageId: string;
  onLinked?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const linkTask = useLinkChatMessage(workspaceId);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const tasksQuery = useLinkableTasks(workspaceId, search, open);
  const [selectedId, setSelectedId] = useState("");
  // Kept with the id: a new search may no longer list the chosen task, and
  // the footer must still name what Submit will link.
  const [selectedTitle, setSelectedTitle] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const rows = tasksQuery.data?.rows ?? [];
  const shown = rows.map((row) => row.task);
  const total = tasksQuery.data?.total ?? shown.length;
  const capped = total > shown.length;
  const searching = query.trim() !== search || (tasksQuery.isFetching && tasksQuery.isPlaceholderData);

  const reset = () => {
    setQuery("");
    setSelectedId("");
    setSelectedTitle("");
    setLinkError(null);
  };

  const submit = () => {
    if (!selectedId || !messageId || linkTask.isPending) return;
    const taskId = selectedId;
    setLinkError(null);
    void linkTask
      .mutateAsync({ messageId, target_type: "task", target_id: taskId })
      .then((link) => {
        if (!link) {
          setLinkError(t("chat.link.link_error"));
          return;
        }
        reset();
        onOpenChange(false);
        onLinked?.(taskId);
      })
      .catch((err: unknown) => setLinkError(chatErrorMessage(err, t, t("chat.link.link_error"))));
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const listLabel = t("chat.link.task_list_aria");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogContent size="md" className={`${CHAT_DIALOG_CLASS} ${CHAT_DIALOG_WIDTH.narrow}`}>
        <FormDialogHeader
          title={t("chat.link.link_task_title")}
          description={t("chat.link.link_task_description")}
        />

        <FormDialogBody className={`${CHAT_DIALOG_BODY_CLASS} space-y-2.5`}>
          <Command
            shouldFilter={false}
            label={listLabel}
            className={COMMAND_CLASS}
          >
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={t("chat.link.search_placeholder")}
              aria-label={t("chat.link.search_label")}
              autoFocus
            />
            {tasksQuery.isPending ? (
              <TaskListSkeleton label={t("chat.link.loading")} />
            ) : tasksQuery.isError ? (
              <div role="alert" className="flex items-center justify-between gap-3 px-3 py-4">
                <p className="text-body text-muted-foreground">{t("chat.link.tasks_load_error")}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8.5 rounded-full px-3.5 font-semibold"
                  onClick={() => void tasksQuery.refetch()}
                >
                  {t("common.retry")}
                </Button>
              </div>
            ) : (
              <CommandList aria-label={listLabel} aria-busy={searching || undefined} className="h-75 max-h-75 p-1.5">
                <CommandEmpty className="py-6 text-body text-muted-foreground">
                  {search ? t("chat.link.empty") : t("chat.link.empty_workspace")}
                </CommandEmpty>
                {shown.map((task) => {
                  const selected = selectedId === task.id;
                  const tone = task.status ? STATUS_CONFIG[task.status]?.tone : undefined;
                  // cmdk's aria-selected is the keyboard cursor; the picked task
                  // is a separate fact, said by the visible check and the name.
                  return (
                    <CommandItem
                      key={task.id}
                      value={task.id}
                      data-checked={selected}
                      aria-label={
                        selected
                          ? t("chat.link.task_option_selected", { title: task.title })
                          : task.title
                      }
                      onSelect={() => {
                        setSelectedId(task.id);
                        setSelectedTitle(task.title);
                        setLinkError(null);
                      }}
                      className="mb-0.5 min-h-14.5 items-center gap-2.5 rounded-control px-2.5 py-2 data-[checked=true]:bg-brand-subtle data-[checked=true]:text-brand-subtle-foreground data-[checked=true]:data-[selected=true]:bg-brand-subtle data-[checked=true]:data-[selected=true]:text-brand-subtle-foreground [&>svg]:size-5! [&>svg]:text-brand"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className={cn("truncate text-body", selected ? "font-semibold" : "font-medium")}>
                          {task.title}
                        </span>
                        <span className="flex min-w-0 items-center gap-2 text-caption">
                          <span className="truncate text-muted-foreground tabular-nums">{task.identifier || task.id}</span>
                          {task.status ? (
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-2 leading-5 font-semibold",
                                tone ? tintClass[tone] : "bg-muted text-muted-foreground",
                              )}
                            >
                              {t(`tasks.status_${task.status}`, { defaultValue: task.status })}
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
              {t("chat.link.results_capped", { count: RESULT_CAP })}
            </p>
          ) : null}

          {linkError ? (
            <p role="alert" className="text-caption text-destructive">
              {linkError}
            </p>
          ) : null}
        </FormDialogBody>

        <FormDialogFooter
          onCancel={() => handleOpenChange(false)}
          cancelVariant="secondary"
          submitLabel={t("chat.link.link")}
          submittingLabel={t("chat.link.linking")}
          submitting={linkTask.isPending}
          submitDisabled={!selectedId || !messageId}
          onSubmit={submit}
          leading={
            selectedTitle ? (
              <span className="line-clamp-1 text-foreground" aria-live="polite">
                {t("chat.link.selected_task", { title: selectedTitle })}
              </span>
            ) : undefined
          }
        />
      </FormDialogContent>
    </Dialog>
  );
}
