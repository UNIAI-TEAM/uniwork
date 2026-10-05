"use client";

/**
 * MarkdownImageView — the Tiptap NodeView for a Markdown image.
 *
 * It renders the bytes the manifest resolves to, or a TYPED unavailable state.
 * It never falls back to the authored path: `resolveImageSource` maps a
 * relative path through the manifest to an opaque asset id, and the injected
 * host port turns that id into a display URL. A path that is not in the
 * manifest renders as "unavailable", never as a broken <img>.
 *
 * Clicking the image opens the viewer (C9: contextual, it opens ON the image;
 * no floating command button is drawn over the canvas).
 */
import { useState } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { AnyExtension } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { cn } from "@uniwork/ui/lib/utils";
import { ImageExtension } from "../../../editor/extensions";
import { imageDisplayUrl, resolveImageSource, imageResolutionStatus } from "./image-resolve";
import { useMarkdownImageScope } from "./image-scope";

export function MarkdownImageView({ node, selected, editor }: NodeViewProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.markdown.image" });
  const scope = useMarkdownImageScope();
  const [viewerOpen, setViewerOpen] = useState(false);
  const src = (node.attrs.src as string | null) ?? "";
  const alt = (node.attrs.alt as string | null) ?? "";
  const uploading = node.attrs.uploading === true;
  const width = (node.attrs.width as number | null) ?? undefined;
  const height = (node.attrs.height as number | null) ?? undefined;

  const resolution = resolveImageSource(src, scope.manifest);
  const url = imageDisplayUrl(resolution, scope.port);
  const editable = editor.isEditable;

  return (
    <NodeViewWrapper as="div" className="relative block max-w-full">
      {uploading ? (
        <span
          role="status"
          data-testid="md-image-uploading"
          className="inline-flex min-h-16 min-w-32 items-center justify-center rounded-md border border-dashed border-border bg-muted px-3 py-4 text-caption text-muted-foreground"
        >
          {t("uploading")}
        </span>
      ) : url ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-auto max-w-full p-0", selected && "ring-2 ring-ring")}
          data-testid="md-image-open"
          aria-label={t("viewer")}
          onClick={() => setViewerOpen(true)}
        >
          <img
            src={url}
            alt={alt}
            width={width}
            height={height}
            draggable={false}
            data-testid="md-image"
            data-resolution={imageResolutionStatus(resolution)}
            className="max-w-full rounded-md"
          />
        </Button>
      ) : (
        <span
          role="img"
          aria-label={alt || t("unavailable")}
          data-testid="md-image-unavailable"
          data-resolution={imageResolutionStatus(resolution)}
          className="inline-flex min-h-16 min-w-32 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted px-3 py-4 text-caption text-muted-foreground"
        >
          <span>{t("unavailable")}</span>
          {editable && alt ? <span className="text-muted-foreground">{alt}</span> : null}
        </span>
      )}
      {viewerOpen && url ? (
        <Dialog open onOpenChange={(open) => setViewerOpen(open)}>
          <DialogContent className="sm:max-w-3xl" closeLabel={t("close")}>
            <DialogTitle>{alt || t("viewer")}</DialogTitle>
            {alt ? <DialogDescription>{t("altLabel")}: {alt}</DialogDescription> : null}
            <img src={url} alt={alt} data-testid="md-image-viewer" className="mx-auto max-h-[70vh] max-w-full rounded-md" />
          </DialogContent>
        </Dialog>
      ) : null}
    </NodeViewWrapper>
  );
}


/**
 * The Markdown image node: the shared `ImageExtension` with its NodeView
 * swapped for {@link MarkdownImageView}. Only the NodeView changes - attributes
 * and `renderMarkdown` are inherited, so the Markdown bytes an image serialises
 * to are identical to the shared node. A host that wants manifest resolution
 * passes this to `createMarkdownEditorExtensions({ image })`; without it every
 * image would render through the shared `ImageView`, which puts the authored
 * (manifest-relative) path on `<img src>` and shows a broken image.
 */
export function createMarkdownImageExtension(): AnyExtension {
  return ImageExtension.extend({
    addNodeView() {
      return ReactNodeViewRenderer(MarkdownImageView);
    },
  });
}
