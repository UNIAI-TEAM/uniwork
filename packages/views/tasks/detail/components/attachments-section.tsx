"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Download, Eye, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { requestBlob } from "@uniwork/core/api/http";
import { attachmentDownloadPath } from "@uniwork/core/api/endpoints/task-attachments";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
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
import { cn } from "@uniwork/ui/lib/utils";
import {
  FileDropOverlay,
  useAttachmentPreview,
  useEditorUpload,
  useFileDropZone,
} from "../../../editor";
import { getPreviewKind } from "../../../editor/utils/preview";
import { toastApiError } from "../../../toast-api-error";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

/** Detail surface only offers inline preview for image + PDF. */
function isSafePreviewKind(contentType: string, filename: string): boolean {
  const kind = getPreviewKind(contentType, filename);
  return kind === "image" || kind === "pdf";
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Task attachments: list, drop/upload with progress, delete confirm,
 * preview (img/pdf) and download via path builders. Capability-gated.
 */
export function TaskDetailAttachmentsSection({
  workspaceId,
  taskId,
}: {
  workspaceId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;
  const cap = capabilityState(config, "tasks.attachments");
  const available = cap.status === "available";
  const reason = t(cap.explanation_key || "capabilities.surface_not_ready");

  const { data: items = [], isLoading } = useTaskAttachments(workspaceId, taskId);
  const uploadMutation = useUploadTaskAttachment(workspaceId, taskId);
  const deleteMutation = useDeleteAttachment(workspaceId, taskId);
  const preview = useAttachmentPreview();
  const [pendingDelete, setPendingDelete] = useState<Attachment | null>(null);
  const [progressName, setProgressName] = useState<string | null>(null);

  const { upload, uploading } = useEditorUpload(async (file) => {
    const att = await uploadMutation.mutateAsync(file);
    if (!att) throw new Error("upload failed");
    return att;
  });

  const runUpload = useCallback(
    async (files: File[]) => {
      if (!available || files.length === 0) return;
      for (const file of files) {
        setProgressName(file.name);
        try {
          await upload(file, { taskId });
        } catch (err) {
          toastApiError(err, t("common.error"));
        } finally {
          setProgressName(null);
        }
      }
    },
    [available, taskId, t, upload],
  );

  const { isDragOver, dropZoneProps } = useFileDropZone({
    onDrop: (files) => {
      void runUpload(files);
    },
    enabled: available && !uploading,
  });

  const onDownload = async (att: Attachment) => {
    try {
      const blob = await requestBlob(attachmentDownloadPath(att.id));
      triggerBlobDownload(blob, att.filename);
    } catch (err) {
      toastApiError(err, t("common.error"));
    }
  };

  const onConfirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMutation.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
    } catch (err) {
      toastApiError(err, t("common.error"));
    }
  };

  return (
    <section
      aria-label={t("tasks.detail.attachments_section")}
      className="relative mt-8 border-t border-border pt-6"
      {...dropZoneProps}
    >
      {isDragOver ? <FileDropOverlay /> : null}

      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-body font-semibold text-foreground">
          {t("tasks.detail.attachments_section")}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!available || uploading}
          aria-disabled={!available || uploading || undefined}
          title={!available ? reason : undefined}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-3.5" aria-hidden />
          {t("tasks.detail.attachments_upload")}
        </Button>
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          className="sr-only"
          multiple
          disabled={!available || uploading}
          aria-label={t("tasks.detail.attachments_upload")}
          onChange={(e) => {
            const list = e.target.files;
            if (list?.length) void runUpload(Array.from(list));
            e.target.value = "";
          }}
        />
      </div>

      {!available ? (
        <p className="mb-3 text-caption text-muted-foreground">{reason}</p>
      ) : null}

      {uploading && progressName ? (
        <p
          data-testid="attachments-upload-progress"
          className="mb-3 flex items-center gap-2 text-caption text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {t("tasks.detail.attachments_uploading", { filename: progressName })}
        </p>
      ) : null}

      {isLoading ? (
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {t("tasks.detail.attachments_empty")}
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((att) => {
            const canPreview = isSafePreviewKind(att.content_type, att.filename);
            return (
              <li key={att.id}>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1.5",
                  )}
                >
                  <FileText
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-body">
                    {att.filename}
                  </span>
                  {canPreview ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      aria-label={t("editor.attachment.preview")}
                      title={t("editor.attachment.preview")}
                      onClick={() => {
                        preview.tryOpen({ kind: "full", attachment: att });
                      }}
                    >
                      <Eye className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    aria-label={t("editor.image.download")}
                    title={t("editor.image.download")}
                    onClick={() => {
                      void onDownload(att);
                    }}
                  >
                    <Download className="size-3.5" aria-hidden />
                  </button>
                  {available ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={t("editor.attachment.remove")}
                      title={t("editor.attachment.remove")}
                      onClick={() => setPendingDelete(att)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {preview.modal}

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
