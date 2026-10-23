"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { selectStandaloneAttachments } from "@uniwork/core/attachments/image-sequence";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import {
  useDeleteAttachment,
  useTaskAttachments,
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
import {
  Attachment as AttachmentRenderer,
  AttachmentDownloadProvider,
} from "../../../editor";
import { toastApiError } from "../../../toast-api-error";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

/**
 * Attachments that are not already referenced by the task description.
 * Rendering is delegated to the shared attachment dispatcher so images,
 * HTML previews, and file cards match every other rich-content surface.
 */
export function TaskDetailAttachmentsSection({
  workspaceId,
  taskId,
  content = "",
}: {
  workspaceId: string;
  taskId: string;
  content?: string;
}) {
  const { t } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;
  const cap = capabilityState(config, "tasks.attachments");
  const available = cap.status === "available";

  const { data: items = [], isLoading } = useTaskAttachments(workspaceId, taskId);
  const deleteMutation = useDeleteAttachment(workspaceId, taskId);
  const [pendingDelete, setPendingDelete] = useState<Attachment | null>(null);
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

  if (isLoading || standalone.length === 0) return null;

  return (
    <section aria-label={t("tasks.detail.attachments_section")} className="mt-3">
      <AttachmentDownloadProvider attachments={items}>
        <div className="flex flex-col gap-1">
          {standalone.map((attachment) => (
            <AttachmentRenderer
              key={attachment.id}
              attachment={{ kind: "record", attachment }}
              editable={available}
              onDelete={available ? () => setPendingDelete(attachment) : undefined}
            />
          ))}
        </div>
      </AttachmentDownloadProvider>

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
