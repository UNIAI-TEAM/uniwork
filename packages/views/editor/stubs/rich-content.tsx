"use client";

/**
 * RichContent — readonly markdown for comments / descriptions.
 *
 * Full rich-content (fences, mermaid, entity unfurl) is not ported yet; this
 * is the product path comments already call through ReadonlyContent.
 * It must parse markdown and resolve attachments — the previous stub dumped
 * the source string, so a sent comment showed `![…]` and `>` literally.
 */

import { useMemo, type ReactNode } from "react";
import { Markdown, isAllowedFileCardHref } from "@uniwork/ui/markdown";
import { cn } from "@uniwork/ui/lib/utils";
import { useConfigStore } from "@uniwork/core/editor/config-store";
import type { Attachment as AttachmentRecord } from "@uniwork/core/types";
import { Attachment as AttachmentRenderer } from "../attachment";
import { AttachmentDownloadProvider } from "../attachment-download-context";
import { preprocessMarkdown } from "../utils/preprocess";

export type RichContentDensity = "document" | "compact";
export type RichContentPhase = "settled" | "streaming";

export function RichContent({
  content = "",
  attachments,
  density = "document",
  phase: _phase = "settled",
  className,
  children,
}: {
  content?: string;
  attachments?: AttachmentRecord[];
  density?: RichContentDensity;
  phase?: RichContentPhase;
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}) {
  const cdnDomain = useConfigStore((s) => s.cdnDomain);
  const source = typeof content === "string" ? content : "";
  const prepared = useMemo(
    () =>
      preprocessMarkdown(source, {
        cdnDomain,
        autolinkIssueIdentifiers: true,
      }),
    [source, cdnDomain],
  );

  const body = (
    <Markdown
      mode={density === "compact" ? "minimal" : "full"}
      className={cn(
        density === "document" && "prose prose-sm max-w-none dark:prose-invert",
        className,
      )}
      cdnDomain={cdnDomain || undefined}
      renderImage={({ src, alt }) => (
        <AttachmentRenderer
          attachment={{
            kind: "url",
            url: src,
            filename: alt,
            forceKind: "image",
          }}
        />
      )}
      renderFileCard={({ href, filename }) => {
        const safe = isAllowedFileCardHref(href) ? href : "";
        return (
          <AttachmentRenderer
            attachment={{
              kind: "url",
              url: safe,
              filename,
            }}
          />
        );
      }}
    >
      {prepared}
    </Markdown>
  );

  if (attachments && attachments.length > 0) {
    return (
      <AttachmentDownloadProvider attachments={attachments}>
        {children ?? body}
      </AttachmentDownloadProvider>
    );
  }

  return <>{children ?? body}</>;
}
