"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAttachDriveFileToTask, type DriveFile } from "@uniwork/core/drive-library";
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
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { apiErrorCopy } from "../../api-error-copy";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../../common/form-dialog";
import {
  DrivePickerTaskConfirmDialog,
  driveLinkErrorReason,
} from "../../integrations/drive-picker";
import { STATUS_CONFIG } from "../../tasks/modes/status-config";

const COMMAND_CLASS = [
  "rounded-[14px]! border border-border bg-background p-0",
  "[&_[data-slot=command-input-wrapper]]:border-b [&_[data-slot=command-input-wrapper]]:border-border [&_[data-slot=command-input-wrapper]]:p-0",
  "[&_[data-slot=input-group]]:h-12! [&_[data-slot=input-group]]:rounded-none! [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:pl-1.5",
  "[&_[data-slot=command-input]]:text-body-lg [&_[data-slot=input-group]_svg]:size-4.5 [&_[data-slot=input-group]_svg]:opacity-70",
].join(" ");

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

function useAttachableTasks(wsId: string, search: string, enabled: boolean) {
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
    ...tableRowsPageQuery(wsId, body),
    enabled: enabled && Boolean(wsId),
    placeholderData: keepPreviousData,
  });
}

export interface DriveAttachTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  file: DriveFile;
}

/**
 * 4.2 "+ Gắn vào việc" task picker + §7.1 confirmation flow (spec §7.1, §7.6a, §7.7, §13).
 *
 * Searches workspace tasks via `tableRowsPageQuery`, marks tasks already in
 * `file.used_in_tasks` as disabled ("Đã gắn"), opens `DrivePickerTaskConfirmDialog`
 * when `file.sharing_state !== "shared"`, and links via `POST /workspaces/{ws}/drive-files`
 * with `task_id`.
 */
export function DriveAttachTaskDialog({
  open,
  onOpenChange,
  wsId,
  file,
}: DriveAttachTaskDialogProps) {
  const { t } = useTranslation();
  const { t: tPicker } = useTranslation(undefined, { keyPrefix: "drive.picker" });
  const attachMutation = useAttachDriveFileToTask(wsId);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const tasksQuery = useAttachableTasks(wsId, search, open && !confirmOpen);
  const [selectedId, setSelectedId] = useState("");
  const [selectedTitle, setSelectedTitle] = useState("");

  const alreadyLinkedTaskIds = useMemo(
    () => new Set(file.used_in_tasks.map((task) => task.task_id)),
    [file.used_in_tasks],
  );

  const rows = tasksQuery.data?.rows ?? [];
  const shown = rows.map((row) => row.task);
  const total = tasksQuery.data?.total ?? shown.length;
  const capped = total > shown.length;
  const searching =
    query.trim() !== search || (tasksQuery.isFetching && tasksQuery.isPlaceholderData);

  const reset = () => {
    setQuery("");
    setSelectedId("");
    setSelectedTitle("");
    setConfirmOpen(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (attachMutation.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const executeAttach = async (taskId: string) => {
    if (!file.viewer_connection_id || attachMutation.isPending) return;
    try {
      const results = await attachMutation.mutateAsync({
        driveFileId: file.id,
        connectionId: file.viewer_connection_id,
        externalFileId: file.external_file_id,
        taskId,
      });
      const item = results.results[0];
      if (!item) {
        toast.error(t("driveLibrary.detail.used_in.attach_dialog.failed"));
        return;
      }
      if (item.outcome === "error") {
        toast.error(driveLinkErrorReason(item.error_code, tPicker, item.error_message));
        return;
      }
      toast.success(tPicker("outcomes.linked", { count: 1 }));
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        apiErrorCopy(err) ?? t("driveLibrary.detail.used_in.attach_dialog.failed"),
      );
    }
  };

  const handleSubmitPicker = () => {
    if (
      !selectedId ||
      alreadyLinkedTaskIds.has(selectedId) ||
      !file.viewer_connection_id ||
      attachMutation.isPending
    ) {
      return;
    }
    if (file.sharing_state !== "shared") {
      setConfirmOpen(true);
      return;
    }
    void executeAttach(selectedId);
  };

  const listLabel = t("driveLibrary.detail.used_in.attach_dialog.task_list_aria");

  return (
    <>
      <Dialog
        open={open && !confirmOpen}
        onOpenChange={(next) => {
          if (!next) handleOpenChange(false);
        }}
      >
        <FormDialogContent size="md" showCloseButton={!attachMutation.isPending}>
          <FormDialogHeader
            title={t("driveLibrary.detail.used_in.attach_dialog.title")}
            description={t("driveLibrary.detail.used_in.attach_dialog.description")}
          />

          <FormDialogBody className="space-y-2.5">
            <Command shouldFilter={false} label={listLabel} className={COMMAND_CLASS}>
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder={t("driveLibrary.detail.used_in.attach_dialog.search_placeholder")}
                aria-label={t("driveLibrary.detail.used_in.attach_dialog.search_label")}
                autoFocus
              />
              {tasksQuery.isPending ? (
                <TaskListSkeleton
                  label={t("driveLibrary.detail.used_in.attach_dialog.loading")}
                />
              ) : tasksQuery.isError ? (
                <div role="alert" className="flex items-center justify-between gap-3 px-3 py-4">
                  <p className="text-body text-muted-foreground">
                    {t("driveLibrary.detail.used_in.attach_dialog.load_error")}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void tasksQuery.refetch()}
                  >
                    {t("common.retry")}
                  </Button>
                </div>
              ) : (
                <CommandList
                  aria-label={listLabel}
                  aria-busy={searching || undefined}
                  className="h-75 max-h-75 p-1.5"
                >
                  <CommandEmpty className="py-6 text-body text-muted-foreground">
                    {search
                      ? t("driveLibrary.detail.used_in.attach_dialog.empty")
                      : t("driveLibrary.detail.used_in.attach_dialog.empty_workspace")}
                  </CommandEmpty>
                  {shown.map((task) => {
                    const alreadyLinked = alreadyLinkedTaskIds.has(task.id);
                    const selected = !alreadyLinked && selectedId === task.id;
                    const tone = task.status ? STATUS_CONFIG[task.status]?.tone : undefined;
                    return (
                      <CommandItem
                        key={task.id}
                        value={task.id}
                        disabled={alreadyLinked}
                        aria-disabled={alreadyLinked || undefined}
                        data-checked={selected}
                        aria-label={
                          alreadyLinked
                            ? t(
                                "driveLibrary.detail.used_in.attach_dialog.task_option_already_linked",
                                { title: task.title },
                              )
                            : selected
                              ? t(
                                  "driveLibrary.detail.used_in.attach_dialog.task_option_selected",
                                  { title: task.title },
                                )
                              : task.title
                        }
                        onSelect={() => {
                          if (alreadyLinked) return;
                          setSelectedId(task.id);
                          setSelectedTitle(task.title);
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
                                  tone ? tintClass[tone] : "bg-muted text-muted-foreground",
                                )}
                              >
                                {t(`tasks.status_${task.status}`, { defaultValue: task.status })}
                              </span>
                            ) : null}
                            {alreadyLinked ? (
                              <span className="shrink-0 rounded-full bg-muted px-2 leading-5 font-medium text-muted-foreground">
                                {t("driveLibrary.detail.used_in.attach_dialog.already_linked")}
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
                {t("driveLibrary.detail.used_in.attach_dialog.results_capped", {
                  count: RESULT_CAP,
                })}
              </p>
            ) : null}
          </FormDialogBody>

          <FormDialogFooter
            onCancel={() => handleOpenChange(false)}
            submitLabel={t("driveLibrary.detail.used_in.attach_dialog.submit")}
            submittingLabel={t("driveLibrary.detail.used_in.attach_dialog.submitting")}
            submitting={attachMutation.isPending}
            submitDisabled={!selectedId || alreadyLinkedTaskIds.has(selectedId)}
            onSubmit={handleSubmitPicker}
            leading={
              selectedTitle ? (
                <span className="line-clamp-1 text-foreground" aria-live="polite">
                  {t("driveLibrary.detail.used_in.attach_dialog.selected_task", {
                    title: selectedTitle,
                  })}
                </span>
              ) : undefined
            }
          />
        </FormDialogContent>
      </Dialog>

      <DrivePickerTaskConfirmDialog
        open={open && confirmOpen}
        fileCount={1}
        pending={attachMutation.isPending}
        onConfirm={() => {
          if (selectedId) {
            void executeAttach(selectedId);
          }
        }}
        onCancel={() => {
          if (!attachMutation.isPending) {
            setConfirmOpen(false);
          }
        }}
      />
    </>
  );
}
