"use client";

import { useTranslation } from "react-i18next";
import { useDocumentVersion } from "@uniwork/core/documents/hooks-versions";
import type { Document } from "@uniwork/core/types/document";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import { DocumentEditor } from "./document-editor";

export interface VersionPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  doc: Document;
  /** Which version ordinal to read; undefined keeps the dialog closed. */
  versionNo: number | undefined;
}

/** No upload path exists in a read-only preview: an image drop is refused. */
const refuseUpload = async () => {
  throw new Error("document_preview_readonly");
};

/**
 * A past version's content, read-only. Page versions carry their sanitized
 * JSON here; the same editor stack renders it so a mark, table or asset looks
 * the way it looked at that checkpoint. Nothing in this dialog can write: the
 * editor is read-only and the uploader refuses.
 */
export function VersionPreviewDialog({
  open,
  onOpenChange,
  wsId,
  doc,
  versionNo,
}: VersionPreviewDialogProps) {
  const { t } = useTranslation();
  const version = useDocumentVersion(wsId, doc.id, versionNo);
  const errorClass = version.error ? classifyDocumentError(version.error).cls : undefined;
  const body = version.data?.content;
  const hasContent = body !== undefined && body !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85dvh] overflow-hidden sm:max-w-2xl"
        closeLabel={t("common.close")}
      >
        <DialogHeader>
          <DialogTitle>{t("documents.versions.preview_title", { no: versionNo ?? 0 })}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("documents.versions.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65dvh] min-h-40 overflow-y-auto rounded-lg border border-border bg-background p-4">
          {version.isPending ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : version.isError && errorClass !== "missing" ? (
            <p role="alert" className="text-caption text-destructive">
              {t("documents.versions.preview_error")}
            </p>
          ) : !version.data ? (
            <p className="text-caption text-muted-foreground">
              {t("documents.versions.preview_error")}
            </p>
          ) : !hasContent ? (
            <p className="text-caption text-muted-foreground">
              {t("documents.versions.preview_empty")}
            </p>
          ) : (
            <DocumentEditor
              wsId={wsId}
              documentId={doc.id}
              initialContent={body}
              content={body}
              contentRevision={String(versionNo ?? 0)}
              dirty={false}
              editable={false}
              onChange={() => undefined}
              onUploadAsset={refuseUpload}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
