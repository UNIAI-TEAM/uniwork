"use client";

import { useCallback } from "react";
import { CircleAlert, FileText, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice } from "../common/notice";
import type { ZoomCanvasApi } from "../editor/hooks/use-zoom-canvas";
import type { Size } from "../editor/utils/zoom-transform";
import { ZoomCanvas } from "../editor/zoom-canvas";

/** Waiting for the bytes: the stage is already there, so the page does not jump. */
export function MediaLoading() {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex min-h-0 flex-1 items-center justify-center gap-2 p-4 text-body text-muted-foreground">
      <Spinner />
      {t("documents.media.loading")}
    </div>
  );
}

/** The bytes did not arrive. Retry asks again; the page menu still downloads. */
export function MediaLoadError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <Notice
        tone="destructive"
        icon={CircleAlert}
        layout="inline"
        live="assertive"
        className="max-w-lg"
        action={
          <Button type="button" variant="outline" size="sm" aria-busy={retrying || undefined} onClick={onRetry}>
            <RefreshCw aria-hidden className="size-3.5" />
            {t("documents.media.retry")}
          </Button>
        }
      >
        <span className="font-medium text-foreground">{t("documents.media.error_title")}</span>{" "}
        {t("documents.media.error_description")}
      </Notice>
    </div>
  );
}

/** The browser has the bytes but cannot decode them (a truncated or corrupt file). */
export function MediaUnsupportedNotice() {
  const { t } = useTranslation();
  return (
    <Notice tone="info" icon={FileText} layout="inline">
      <span className="font-medium text-foreground">{t("documents.media.unsupported_title")}</span>{" "}
      {t("documents.media.unsupported_description")}
    </Notice>
  );
}

/**
 * The image on the shared pan/zoom canvas (the one the chat attachment preview
 * and the Mermaid viewer use). Zoom state is owned by the viewer so the status
 * bar's controls drive the same canvas.
 */
export function MediaImage({
  url,
  filename,
  canvas,
  natural,
  onNaturalSize,
  onDecodeError,
}: {
  url: string;
  filename: string;
  canvas: ZoomCanvasApi;
  natural: Size | null;
  onNaturalSize: (size: Size) => void;
  onDecodeError: () => void;
}) {
  const { t } = useTranslation();
  const measure = useCallback(
    (image: HTMLImageElement | null) => {
      // Zero for an image that has not decoded yet, and for an SVG that declares
      // only a viewBox: that one stays letterboxed (zoom controls stay disabled).
      if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
      onNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
    },
    [onNaturalSize],
  );
  return (
    <ZoomCanvas canvas={canvas} content={natural} label={t("editor.image.canvas_label")} className="rounded-md">
      <img
        // A cached image is `complete` before React attaches onLoad, so measure from the ref too.
        ref={measure}
        onLoad={(event) => measure(event.currentTarget)}
        onError={onDecodeError}
        src={url}
        alt={filename}
        className={cn("select-none", natural ? "block size-full shadow-office-page" : "max-h-full max-w-full object-contain")}
        // Native image dragging would hijack the pan gesture.
        draggable={false}
      />
    </ZoomCanvas>
  );
}
