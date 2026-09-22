"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@uniwork/core/api";
import { useLinkChatMessage } from "@uniwork/core/chat";
import { useTasks } from "@uniwork/core/tasks";
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
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";

/** Rows shown at once; past this the list asks for a narrower search. */
const RESULT_CAP = 40;

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
  const { data: tasks = [], isLoading, isError, refetch } = useTasks(workspaceId);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const { shown, capped } = useMemo(() => {
    const matches = q
      ? tasks.filter((task) =>
          `${task.title} ${task.identifier} ${task.id}`.toLowerCase().includes(q),
        )
      : tasks;
    return { shown: matches.slice(0, RESULT_CAP), capped: matches.length > RESULT_CAP };
  }, [q, tasks]);

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
      .catch((err: unknown) => setLinkError(apiErrorMessage(err) ?? t("chat.link.link_error")));
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const listLabel = t("chat.link.task_list_aria");

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
            {isLoading ? (
              <TaskListSkeleton label={t("chat.link.loading")} />
            ) : isError ? (
              <div role="alert" className="flex items-center justify-between gap-3 px-3 py-4">
                <p className="text-body text-muted-foreground">{t("chat.link.tasks_load_error")}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
                  {t("common.retry")}
                </Button>
              </div>
            ) : (
              <CommandList aria-label={listLabel} className="max-h-64 p-1">
                <CommandEmpty className="py-6 text-body text-muted-foreground">
                  {tasks.length === 0 ? t("chat.link.empty_workspace") : t("chat.link.empty")}
                </CommandEmpty>
                {shown.map((task) => {
                  const selected = selectedId === task.id;
                  return (
                    <CommandItem
                      key={task.id}
                      value={task.id}
                      data-checked={selected}
                      aria-checked={selected}
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
        />
      </FormDialogContent>
    </Dialog>
  );
}
