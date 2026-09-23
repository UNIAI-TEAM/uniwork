"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
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
import { cn } from "@uniwork/ui/lib/utils";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import { chatErrorMessage } from "./chat-error-message";

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
  const [linkError, setLinkError] = useState<string | null>(null);

  const rows = tasksQuery.data?.rows ?? [];
  const shown = rows.map((row) => row.task);
  const total = tasksQuery.data?.total ?? shown.length;
  const capped = total > shown.length;
  const searching = query.trim() !== search || (tasksQuery.isFetching && tasksQuery.isPlaceholderData);

  const reset = () => {
    setQuery("");
    setSelectedId("");
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
  const selectedTitle = shown.find((task) => task.id === selectedId)?.title;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogContent size="md">
        <FormDialogHeader
          title={t("chat.link.link_task_title")}
          description={t("chat.link.link_task_description")}
        />

        <FormDialogBody className="space-y-3">
          <Command
            shouldFilter={false}
            label={listLabel}
            className="rounded-lg! border border-border bg-background p-0"
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
                <Button type="button" size="sm" variant="outline" onClick={() => void tasksQuery.refetch()}>
                  {t("common.retry")}
                </Button>
              </div>
            ) : (
              <CommandList aria-label={listLabel} aria-busy={searching || undefined} className="max-h-64 p-1">
                <CommandEmpty className="py-6 text-body text-muted-foreground">
                  {search ? t("chat.link.empty") : t("chat.link.empty_workspace")}
                </CommandEmpty>
                {shown.map((task) => {
                  const selected = selectedId === task.id;
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
                        setLinkError(null);
                      }}
                      className="items-start data-[checked=true]:bg-surface-selected data-[checked=true]:text-surface-selected-foreground"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-body font-medium">{task.title}</span>
                        <span className="truncate text-caption text-muted-foreground">
                          {task.identifier || task.id}
                        </span>
                      </span>
                      <Check
                        aria-hidden
                        className={cn("mt-0.5 size-4 shrink-0", selected ? "opacity-100" : "opacity-0")}
                      />
                    </CommandItem>
                  );
                })}
              </CommandList>
            )}
          </Command>

          {capped ? (
            <p className="text-caption text-muted-foreground">
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
          submitLabel={t("chat.link.link")}
          submittingLabel={t("chat.link.linking")}
          submitting={linkTask.isPending}
          submitDisabled={!selectedId || !messageId}
          onSubmit={submit}
          leading={
            selectedTitle ? (
              <span className="line-clamp-1" aria-live="polite">
                {t("chat.link.selected_task", { title: selectedTitle })}
              </span>
            ) : undefined
          }
        />
      </FormDialogContent>
    </Dialog>
  );
}
