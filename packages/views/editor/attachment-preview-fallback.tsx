"use client";

import type { ReactNode } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PreviewTooLargeError,
  PreviewUnsupportedError,
} from "./attachment-api";
import { useAttachmentHtmlText } from "./hooks/use-attachment-html-text";

export function TextBackedPreview({
  attachmentId,
  onDownload,
  render,
}: {
  attachmentId: string;
  onDownload: () => void;
  render: (text: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const query = useAttachmentHtmlText(attachmentId);

  if (query.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-body text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("editor.attachment.preview_loading")}
      </div>
    );
  }
  if (query.error) {
    if (query.error instanceof PreviewTooLargeError) {
      return (
        <UnsupportedFallback
          message={t("editor.attachment.preview_too_large")}
          onDownload={onDownload}
        />
      );
    }
    if (query.error instanceof PreviewUnsupportedError) {
      return (
        <UnsupportedFallback
          message={t("editor.attachment.preview_unsupported")}
          onDownload={onDownload}
        />
      );
    }
    return (
      <UnsupportedFallback
        message={t("editor.attachment.preview_failed")}
        onDownload={onDownload}
      />
    );
  }
  if (!query.data) return null;
  return <>{render(query.data)}</>;
}

export function UnsupportedFallback({
  message,
  onDownload,
}: {
  message: string;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <FileText className="size-8 text-muted-foreground" />
      <p className="text-body text-muted-foreground">{message}</p>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-body transition-colors hover:bg-muted"
        onClick={onDownload}
      >
        <Download className="size-4" />
        {t("editor.image.download")}
      </button>
    </div>
  );
}
