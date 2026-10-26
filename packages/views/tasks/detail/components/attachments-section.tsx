"use client";

import { useRef, useState } from "react";
import { ChevronDown, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { selectStandaloneAttachments } from "@uniwork/core/attachments/image-sequence";
import { capabilityState } from "@uniwork/core/capabilities";
import { editorAttachmentPurpose } from "@uniwork/core/constants/upload";
import { useDriveConnections, useTaskDriveFiles } from "@uniwork/core/drive";
import { useFlag, usePublicConfig } from "@uniwork/core/feature-flags";
import {
  useDeleteAttachment,
  useTaskAttachments,
  useUploadTaskAttachment,
} from "@uniwork/core/tasks";
import type { Attachment } from "@uniwork/core/types/attachment";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { GoogleDriveMark } from "../../../common/provider-icons";
import {
  Attachment as AttachmentRenderer,
  AttachmentDownloadProvider,
  FileDropOverlay,
  useEditorUpload,
  useFileDropZone,
} from "../../../editor";
import {
  useDrivePicker,
  type DrivePickerAdapter,
} from "../../../integrations/drive-picker";
import { DRIVE_CONNECTOR_FLAG } from "../../../settings/components/drive-integration-row";
import { toastApiError } from "../../../toast-api-error";
import { DriveTaskFileCard } from "./drive-task-file-card";

const EMPTY_CONFIG = {
  flags: {} as Record<string, boolean>,
  rum_sample_rate: 0,
  work_management_capabilities: {},
  drive: { available: false },
} as const;

export interface TaskDetailAttachmentsSectionProps {
  workspaceId: string;
  taskId: string;
  content?: string;
  /** Test / Storybook override for the Google Picker adapter. */
  pickerAdapter?: DrivePickerAdapter;
}

/**
 * Task detail §2.3 Attachments section (`Đính kèm`):
 * - Always renders a section with `Đính kèm` header and `Thêm tệp` button.
 * - Independent queries: uploaded attachments (`useTaskAttachments`) and
 *   Google Drive linked files (`useTaskDriveFiles`) render independently so
 *   either side failing or loading never hides the other.
 * - When both sides are empty, shows the empty state drop zone.
 */
export function TaskDetailAttachmentsSection({
  workspaceId,
  taskId,
  content = "",
  pickerAdapter,
}: TaskDetailAttachmentsSectionProps) {
  const { t } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;
  const cap = capabilityState(config, "tasks.attachments");
  const available = cap.status === "available";

  const flagFromContext = useFlag(DRIVE_CONNECTOR_FLAG, false);
  const driveFlagEnabled =
    flagFromContext || Boolean(config.flags?.[DRIVE_CONNECTOR_FLAG]);
  const driveAvailable = driveFlagEnabled && Boolean(config.drive?.available);

  const attachmentsQuery = useTaskAttachments(workspaceId, taskId);
  const items = attachmentsQuery.data ?? [];
  const driveFilesQuery = useTaskDriveFiles(workspaceId, taskId, {
    enabled: driveAvailable,
  });
  const driveFiles = driveAvailable ? (driveFilesQuery.data ?? []) : [];

  const connectionsQuery = useDriveConnections(workspaceId, {
    enabled: driveAvailable,
  });
  const connectedCount = connectionsQuery.data?.connections.length ?? 0;

  const deleteMutation = useDeleteAttachment(workspaceId, taskId);
  const uploadMutation = useUploadTaskAttachment(workspaceId, taskId);
  const [pendingDelete, setPendingDelete] = useState<Attachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { upload, uploading } = useEditorUpload(async (file) => {
    const attachment = await uploadMutation.mutateAsync({
      file,
      purpose: editorAttachmentPurpose(file),
    });
    if (!attachment) throw new Error("upload failed");
    return attachment;
  });

  const handleUploadFiles = (files: File[]) => {
    for (const file of files) {
      void upload(file, { taskId });
    }
  };

  const { isDragOver, dropZoneProps } = useFileDropZone({
    onDrop: handleUploadFiles,
    enabled: available && !uploading,
  });

  const picker = useDrivePicker({
    wsId: workspaceId,
    taskId,
    forTask: true,
    adapter: pickerAdapter,
  });

  const standalone = selectStandaloneAttachments(content, items);

  const onConfirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMutation.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
    } catch (err) {
      toastApiError(err, t("common.error"));
    }
  };

  const hasContent = driveFiles.length > 0 || standalone.length > 0;
  const isInitialLoading =
    attachmentsQuery.isLoading &&
    (driveAvailable ? driveFilesQuery.isLoading : true);

  return (
    <section
      aria-label={t("tasks.detail.attachments_section")}
      className="relative mt-6 flex flex-col gap-2.5 rounded-lg"
      {...dropZoneProps}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-body font-semibold text-foreground">
          {t("tasks.detail.attachments_section")}
        </h2>

        {available ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                const selected = Array.from(e.target.files ?? []);
                if (selected.length === 0) return;
                e.target.value = "";
                handleUploadFiles(selected);
              }}
            />

            {driveAvailable ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploading || picker.pending}
                    />
                  }
                >
                  <span>{t("tasks.detail.attachments_upload")}</span>
                  <ChevronDown data-icon="inline-end" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload aria-hidden="true" />
                    <span>{t("drive.attach_menu.upload_file")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      picker.open();
                    }}
                  >
                    <GoogleDriveMark
                      className="size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <div className="flex min-w-0 flex-col">
                      <span>{t("drive.attach_menu.from_drive")}</span>
                      {connectedCount > 0 ? (
                        <span className="text-caption text-muted-foreground">
                          {t("drive.attach_menu.connected_accounts", {
                            count: connectedCount,
                          })}
                        </span>
                      ) : null}
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => {
                  fileInputRef.current?.click();
                }}
              >
                <Upload data-icon="inline-start" aria-hidden="true" />
                <span>{t("tasks.detail.attachments_upload")}</span>
              </Button>
            )}
          </>
        ) : null}
      </div>

      {driveAvailable && driveFilesQuery.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-caption text-destructive"
        >
          <span>{t("drive.attachments.drive_load_error")}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              void driveFilesQuery.refetch();
            }}
          >
            {t("drive.attachments.retry")}
          </Button>
        </div>
      ) : null}

      {attachmentsQuery.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-caption text-destructive"
        >
          <span>{t("drive.attachments.uploads_load_error")}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              void attachmentsQuery.refetch();
            }}
          >
            {t("drive.attachments.retry")}
          </Button>
        </div>
      ) : null}

      {hasContent ? (
        <div className="flex flex-col gap-2.5">
          {driveFiles.map((card) => (
            <DriveTaskFileCard
              key={card.id}
              workspaceId={workspaceId}
              taskId={taskId}
              card={card}
              pickerAdapter={pickerAdapter}
            />
          ))}

          {standalone.length > 0 ? (
            <AttachmentDownloadProvider attachments={items}>
              <div className="flex flex-col gap-1">
                {standalone.map((attachment) => (
                  <AttachmentRenderer
                    key={attachment.id}
                    attachment={{ kind: "record", attachment }}
                    editable={available}
                    onDelete={
                      available
                        ? () => setPendingDelete(attachment)
                        : undefined
                    }
                  />
                ))}
              </div>
            </AttachmentDownloadProvider>
          ) : null}
        </div>
      ) : !isInitialLoading &&
        !attachmentsQuery.isError &&
        !(driveAvailable && driveFilesQuery.isError) ? (
        <div
          data-testid="task-attachments-empty"
          className="flex min-h-11 items-center rounded-lg border border-dashed border-border px-3.5 py-2.5 text-caption text-muted-foreground"
        >
          {t("tasks.detail.attachments_empty")}
        </div>
      ) : null}

      {isDragOver ? <FileDropOverlay /> : null}

      {picker.dialogs}

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tasks.detail.attachments_delete_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tasks.detail.attachments_delete_description", {
                filename: pendingDelete?.filename ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                void onConfirmDelete();
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
