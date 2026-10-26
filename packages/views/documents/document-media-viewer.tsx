"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Info, Maximize2, Minimize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDocumentMediaBlob } from "@uniwork/core/documents/hooks-media";
import type { Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { useZoomCanvas } from "../editor/hooks/use-zoom-canvas";
import type { Size } from "../editor/utils/zoom-transform";
import { ZoomControls, ZoomToolbarButton } from "../editor/zoom-canvas";
import type { DocumentFileActions } from "./document-file-actions";
import { DocumentFileCard, DocumentFileFacts, formatFileSize } from "./document-file-card";
import { useFullscreen, useObjectUrl } from "./document-media-hooks";
import { MediaImage, MediaLoading, MediaLoadError, MediaUnsupportedNotice } from "./document-media-stage";

type DocumentFile = NonNullable<Document["file"]>;

export interface DocumentMediaViewerProps {
  wsId: string;
  doc: Document;
  file: DocumentFile;
  actions: DocumentFileActions;
  readonly: boolean;
  canComment: boolean;
  permissionNoticeShown?: boolean;
}

/**
 * View-only image viewer for a `kind=file` document (UNI-2166). It
 * fills the page like an Office editor does: the page header, its overflow menu
 * (download, new version, version history) and the read-only notice are the
 * page's own, and the chrome below the stage is the status bar the PDF frame
 * uses, with the shared zoom controls in it. Nothing here creates or edits.
 */
export function DocumentMediaViewer({ wsId, doc, file, actions, readonly, canComment, permissionNoticeShown }: DocumentMediaViewerProps) {
  const { t, i18n } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(rootRef);
  const blob = useDocumentMediaBlob(wsId, doc.id, file.version_id, file.mime_type);
  const url = useObjectUrl(blob.data);
  // Both measurements and the decode failure belong to one URL: a new version never inherits them.
  const [measured, setMeasured] = useState<{ url: string; size: Size } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const natural = url !== null && measured?.url === url ? measured.size : null;
  const canvas = useZoomCanvas({ content: natural });

  // The canvas keeps the user's zoom across viewport changes on purpose; entering or
  // leaving full screen is a deliberate reset, so refit once the new size is measured.
  const { fit } = canvas;
  const wasFullscreen = useRef(fullscreen.active);
  useEffect(() => {
    if (wasFullscreen.current === fullscreen.active) return;
    wasFullscreen.current = fullscreen.active;
    const timer = window.setTimeout(fit, 150);
    return () => window.clearTimeout(timer);
  }, [fullscreen.active, fit]);

  const onNaturalSize = useCallback(
    (size: Size) => {
      if (url) setMeasured((prev) => (prev?.url === url && prev.size.width === size.width && prev.size.height === size.height ? prev : { url, size }));
    },
    [url],
  );
  const onDecodeError = useCallback(() => setFailedUrl(url), [url]);

  const unsupported = url !== null && failedUrl === url;
  const summary = [
    natural ? t("documents.media.dimensions", { width: natural.width, height: natural.height }) : "",
    formatFileSize(file.size_bytes, i18n.language),
  ].filter(Boolean).join(" · ");

  if (unsupported) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-office-canvas p-4" data-document-media-viewer="image" data-state="unsupported">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <MediaUnsupportedNotice />
          <DocumentFileCard file={file} actions={actions} readonly={readonly} canComment={canComment} permissionNoticeShown={permissionNoticeShown} />
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-office-canvas" data-document-media-viewer="image">
      {blob.isError ? (
        <MediaLoadError onRetry={() => void blob.refetch()} retrying={blob.isFetching} />
      ) : url === null ? (
        <MediaLoading />
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-4">
          <MediaImage url={url} filename={file.filename} canvas={canvas} natural={natural} onNaturalSize={onNaturalSize} onDecodeError={onDecodeError} />
        </div>
      )}

      <div className="flex min-h-6 shrink-0 items-center justify-between gap-3 border-t border-border bg-office-band px-3 text-caption text-muted-foreground" data-document-media-status>
        <div className="flex min-w-0 items-center gap-1.5">
          <Popover>
            <PopoverTrigger
              render={
                <Button type="button" variant="ghost" size="icon-xs" aria-label={t("documents.file.metadata_title")}>
                  <Info aria-hidden className="size-3.5" />
                </Button>
              }
            />
            <PopoverContent side="top" align="start" className="w-80">
              <p className="truncate text-body font-medium text-foreground">{file.filename}</p>
              <DocumentFileFacts file={file} className="grid grid-cols-2 gap-3" />
            </PopoverContent>
          </Popover>
          <span className="truncate tabular-nums">{summary}</span>
        </div>
        <ZoomControls canvas={canvas} disabled={natural === null} compact>
          {fullscreen.supported ? (
            <ZoomToolbarButton
              compact
              onClick={fullscreen.toggle}
              label={t(fullscreen.active ? "documents.media.fullscreen_exit" : "documents.media.fullscreen_enter")}
            >
              {fullscreen.active ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </ZoomToolbarButton>
          ) : null}
        </ZoomControls>
      </div>
    </div>
  );
}
