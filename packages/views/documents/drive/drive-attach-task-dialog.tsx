"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAttachDriveFileToTask, type DriveFile } from "@uniwork/core/drive-library";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
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
import { TaskSearchSelectCard } from "../../tasks/task-search-select-card";

interface DriveAttachTaskDialogProps {
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [selectedTitle, setSelectedTitle] = useState("");

  const alreadyLinkedTaskIds = useMemo(
    () => new Set(file.used_in_tasks.map((task) => task.task_id)),
    [file.used_in_tasks],
  );

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
            <TaskSearchSelectCard
              workspaceId={wsId}
              enabled={open && !confirmOpen}
              query={query}
              onQueryChange={setQuery}
              selectedId={selectedId}
              disabledTaskIds={alreadyLinkedTaskIds}
              onSelectTask={(task) => {
                setSelectedId(task.id);
                setSelectedTitle(task.title);
              }}
              copy={{
                listLabel: t("driveLibrary.detail.used_in.attach_dialog.task_list_aria"),
                searchPlaceholder: t("driveLibrary.detail.used_in.attach_dialog.search_placeholder"),
                searchLabel: t("driveLibrary.detail.used_in.attach_dialog.search_label"),
                loadingLabel: t("driveLibrary.detail.used_in.attach_dialog.loading"),
                loadErrorLabel: t("driveLibrary.detail.used_in.attach_dialog.load_error"),
                retryLabel: t("common.retry"),
                emptySearchLabel: t("driveLibrary.detail.used_in.attach_dialog.empty"),
                emptyWorkspaceLabel: t("driveLibrary.detail.used_in.attach_dialog.empty_workspace"),
                selectedOptionLabel: (title) =>
                  t("driveLibrary.detail.used_in.attach_dialog.task_option_selected", { title }),
                disabledOptionLabel: (title) =>
                  t("driveLibrary.detail.used_in.attach_dialog.task_option_already_linked", {
                    title,
                  }),
                disabledBadgeLabel: t("driveLibrary.detail.used_in.attach_dialog.already_linked"),
                resultsCappedLabel: (count) =>
                  t("driveLibrary.detail.used_in.attach_dialog.results_capped", { count }),
              }}
            />
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
