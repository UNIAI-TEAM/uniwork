"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Loader2, X } from "lucide-react";
import type { Attachment } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { useTranslation } from "react-i18next";
import { ReadonlyContent } from "./readonly-content";
import { extensionToLanguage, getPreviewKind, type PreviewKind } from "./utils/preview";
import { useResignedInlineMediaURL } from "./hooks/use-inline-media-url";
import { useZoomCanvas, type ZoomCanvasApi } from "./hooks/use-zoom-canvas";
import { ZoomCanvas, ZoomControls } from "./zoom-canvas";
import type { Size } from "./utils/zoom-transform";
import { HtmlPreviewBody } from "./html-preview-body";
import { CodeBlockStatic } from "./code-block-static";
import { PreviewTooLargeError, PreviewUnsupportedError } from "./attachment-api";
import { TextBackedPreview, UnsupportedFallback } from "./attachment-preview-fallback";
// useAttachmentHtmlText used inside fallback
import { useAttachmentHtmlText } from "./hooks/use-attachment-html-text";
import type { PreviewSequence, PreviewSource, PreviewState } from "./attachment-preview-modal";
import { useSettledImageURL } from "./attachment-preview-modal";

export function PreviewPanel({
  kind,
  source,
  state,
  onClose,
  onDownload,
  onOpenInNewTab,
  sequence,
  onImageError,
}: {
  kind: PreviewKind | null;
  source: PreviewSource;
  state: PreviewState;
  onClose: () => void;
  onDownload: () => void;
  onOpenInNewTab?: () => void;
  sequence?: PreviewSequence;
  onImageError?: () => void;
}) {
  const { t } = useTranslation();

  // Gallery navigation hands this panel an attachment the reader never
  // clicked, so — unlike the click-through path, where <Attachment> had
  // already upgraded the URL — the modal has to run the re-sign itself. A
  // no-op for URLs that are already loadable (signed CDN, public storage).
  const targetUrl = useResignedInlineMediaURL(
    state.attachmentId ?? undefined,
    state.mediaUrl,
    kind === "image",
  );
  // The previous image stays on the canvas until this one has decoded — the
  // swap itself is what used to flash. Also absorbs the re-sign URL upgrade
  // (raw -> signed) without a second visible load.
  const mediaUrl = useSettledImageURL(targetUrl, kind === "image", onImageError);

  // Natural size is carried with the URL it was measured from, so a panel
  // reused for a different attachment can never fit the new image against the
  // old one's dimensions.
  const [measured, setMeasured] = useState<{ url: string; size: Size } | null>(
    null,
  );
  const natural =
    kind === "image" && measured?.url === mediaUrl ? measured.size : null;
  // Left / right arrows belong to the sequence when there is one; the canvas
  // keeps them for panning otherwise. Vertical arrows always pan, and a
  // zoomed image still pans horizontally by drag / wheel.
  const canvas = useZoomCanvas({
    content: natural,
    horizontalArrowPan: !sequence,
  });

  const handleNaturalSize = useCallback(
    (url: string, size: Size) => {
      setMeasured((previous) =>
        previous?.url === url &&
        previous.size.width === size.width &&
        previous.size.height === size.height
          ? previous
          : { url, size },
      );
    },
    [],
  );

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2">
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        {/* Baseline group: filename (text-body) and type (text-caption) are
            different type sizes on one line — the row's items-center would
            center their unequal line boxes and visibly offset the smaller
            text. Mixed-size text aligns by baseline. */}
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="truncate text-body font-medium">{state.filename}</p>
          <span className="shrink-0 text-caption text-muted-foreground">
            {state.contentType || "—"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {/* Navigation leads the action cluster, arrows off the image
              (they covered exactly the content being looked at) and the
              counter between the arrows it describes. min-w keeps the
              arrows from shifting as digit counts change. */}
          {sequence && (
            <div className="mr-1 flex shrink-0 items-center gap-0.5">
              <SequenceButton
                side="prev"
                label={t("editor.image.previous")}
                onClick={sequence.onPrev}
              />
              <span
                className="min-w-10 select-none text-center text-caption tabular-nums text-muted-foreground"
                aria-live="polite"
              >
                {t("editor.image.sequence_position", {
                  index: sequence.index + 1,
                  total: sequence.total,
                })}
              </span>
              <SequenceButton
                side="next"
                label={t("editor.image.next")}
                onClick={sequence.onNext}
              />
            </div>
          )}
          {/* Standalone preview keeps the original gate — no controls until
              the image is measured, and none at all for content that has no
              intrinsic size to drive. In a sequence they stay mounted
              (disabled while un-measured) instead: `natural` passes through
              null on every swap, and controls that vanish and reappear shift
              the buttons to their right on every navigation. */}
          {kind === "image" && (natural || sequence) && (
            <ZoomControls canvas={canvas} disabled={!natural} />
          )}
          {onOpenInNewTab && (
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              title={t("editor.attachment.open_in_new_tab")}
              aria-label={t("editor.attachment.open_in_new_tab")}
              onClick={onOpenInNewTab}
            >
              <ExternalLink className="size-4" />
            </button>
          )}
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title={t("editor.image.download")}
            aria-label={t("editor.image.download")}
            onClick={onDownload}
          >
            <Download className="size-4" />
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title={t("editor.attachment.close")}
            aria-label={t("editor.attachment.close")}
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      {/* Image gets a flex column: the canvas sizes itself with `flex: 1 1
          auto` and its content is absolutely positioned, so in a plain block
          parent it would collapse to zero height and show nothing. It also
          clips and handles its own wheel events — letting this wrapper scroll
          too would fight the pan. Every other kind keeps the block scroller;
          making them flex items would let tall text previews shrink to fit
          instead of scrolling. */}
      <div
        className={cn(
          "relative min-h-0 flex-1 bg-background",
          kind === "image" ? "flex flex-col overflow-hidden" : "overflow-auto",
        )}
      >
        {kind === "image" ? (
          <ImagePreview
            state={state}
            mediaUrl={mediaUrl}
            canvas={canvas}
            natural={natural}
            onNaturalSize={handleNaturalSize}
            onError={onImageError}
          />
        ) : (
          <PreviewContent
            kind={kind}
            source={source}
            state={state}
            onDownload={onDownload}
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sequence controls
// ---------------------------------------------------------------------------

// Header chevrons in the same idiom as the download/close buttons. `onClick`
// undefined means "boundary reached": the button stays mounted but disabled,
// so the reader can see they are at one end instead of the control vanishing
// and shifting the counter into its place. `enabled:hover` so the disabled
// state gets no hover feedback (and no pointer-events-none — a disabled
// control should still catch the cursor and read as "nothing here").
function SequenceButton({
  side,
  label,
  onClick,
}: {
  side: "prev" | "next";
  label: string;
  onClick?: () => void;
}) {
  const Icon = side === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      className="rounded-md p-1.5 text-muted-foreground transition-colors enabled:hover:bg-secondary enabled:hover:text-foreground disabled:opacity-30"
      title={label}
      aria-label={label}
      disabled={!onClick}
      onClick={onClick}
    >
      <Icon className="size-4" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Image — zoom canvas
// ---------------------------------------------------------------------------

function ImagePreview({
  state,
  mediaUrl,
  canvas,
  natural,
  onNaturalSize,
  onError,
}: {
  state: PreviewState;
  mediaUrl: string;
  canvas: ZoomCanvasApi;
  natural: Size | null;
  onNaturalSize: (url: string, size: Size) => void;
  onError?: () => void;
}) {
  const { t } = useTranslation();
  const url = mediaUrl;

  const readNaturalSize = useCallback(
    (image: HTMLImageElement | null) => {
      // naturalWidth is 0 for an image that hasn't decoded yet, and also for
      // an SVG that declares only a viewBox — Chromium gives those no
      // intrinsic size at all. Both fall back to the letterboxed branch;
      // the first recovers on load, the second stays there.
      if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
      onNaturalSize(url, {
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    },
    [onNaturalSize, url],
  );

  return (
    <ZoomCanvas
      canvas={canvas}
      content={natural}
      label={t("editor.image.canvas_label")}
      className="bg-black/40"
      autoFocus
    >
      <img
        // A cached image is already `complete` before React attaches onLoad,
        // so that event never fires — measure from the ref as well.
        ref={readNaturalSize}
        onLoad={(e) => readNaturalSize(e.currentTarget)}
        onError={onError}
        src={url}
        alt={state.filename}
        className={cn(
          "select-none",
          natural
            ? "block size-full"
            : "max-h-full max-w-full rounded-lg object-contain",
        )}
        // Native image dragging would hijack the pan gesture.
        draggable={false}
      />
    </ZoomCanvas>
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

// Dispatch on PreviewKind. New cases go here; remember that the modal frame
// (header, close, Download CTA, ESC handling) is shared — sub-renderers only
// own the content area. `image` is handled by PreviewPanel itself because its
// toolbar and canvas share zoom state.
function PreviewContent({
  kind,
  source,
  state,
  onDownload,
}: {
  kind: Exclude<PreviewKind, "image"> | null;
  source: PreviewSource;
  state: PreviewState;
  onDownload: () => void;
}) {
  const { t } = useTranslation();

  if (kind === null) {
    return (
      <UnsupportedFallback
        message={t("editor.attachment.preview_unsupported")}
        onDownload={onDownload}
      />
    );
  }

  // Text kinds need the attachment id for the /content proxy. The tryOpen
  // gate prevents URL-only sources from reaching here for text kinds, but
  // be defensive — a direct mount of <AttachmentPreviewModal> with a URL
  // source whose filename later resolves to a text kind would otherwise
  // crash on a null id.
  if (
    (kind === "markdown" || kind === "html" || kind === "text") &&
    !state.attachmentId
  ) {
    return (
      <UnsupportedFallback
        message={t("editor.attachment.preview_unsupported")}
        onDownload={onDownload}
      />
    );
  }

  switch (kind) {
    case "pdf":
      return (
        <iframe
          src={state.mediaUrl}
          className="h-full w-full bg-background"
          title={state.filename}
        />
      );
    case "video":
      return (
        <div className="flex h-full w-full items-center justify-center bg-black">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- attachment preview has no caption track */}
          <video
            src={state.mediaUrl}
            controls
            className="h-full w-full object-contain"
          />
        </div>
      );
    case "audio":
      return (
        <div className="flex h-full w-full items-center justify-center p-8">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- attachment preview has no caption track */}
          <audio src={state.mediaUrl} controls className="w-full max-w-xl" />
        </div>
      );
    case "markdown":
      return (
        <TextBackedPreview
          attachmentId={state.attachmentId!}
          onDownload={onDownload}
          render={(text) => (
            <ReadonlyContent
              content={text}
              className="px-6 py-4"
              attachments={source.kind === "full" ? [source.attachment] : []}
            />
          )}
        />
      );
    case "html":
      return (
        <TextBackedPreview
          attachmentId={state.attachmentId!}
          onDownload={onDownload}
          render={(text) => (
            <HtmlPreviewBody
              source={{ kind: "inline", html: text }}
              title={state.filename}
              className="h-full w-full"
              iframeClassName="rounded-none border-0"
            />
          )}
        />
      );
    case "text":
      return (
        <TextBackedPreview
          attachmentId={state.attachmentId!}
          onDownload={onDownload}
          render={(text) => (
            <CodeBlockStatic
              language={extensionToLanguage(state.filename)}
              body={text}
              className="px-6 py-4"
            />
          )}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Text-backed preview — fetches body once, then hands to the render prop
// ---------------------------------------------------------------------------

// React Query owns server state per the project convention; re-opening the
// same attachment hits the cache instead of re-fetching. Query is keyed on
// the attachment id alone — the 30 min TTL on the server-side signed URL
// is much longer than any plausible preview session.
