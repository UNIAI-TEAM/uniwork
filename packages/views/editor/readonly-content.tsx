"use client";

/**
 * ReadonlyContent — compatibility wrapper over RichContent.
 *
 * Callers (comment cards, description surfaces) keep this import path; the
 * renderer lives next to it under stubs/ until the full rich-content package
 * (fences, mermaid, entity unfurl) is ported.
 */

import { memo } from "react";
import type { Attachment } from "@uniwork/core/types";
import { RichContent } from "./stubs/rich-content";

interface ReadonlyContentProps {
  content: string;
  className?: string;
  /**
   * Attachments associated with the surrounding entity (comment / issue body).
   * Callers SHOULD pass a stable reference; a fresh array on every parent
   * render busts the memo.
   */
  attachments?: Attachment[];
}

export const ReadonlyContent = memo(function ReadonlyContent({
  content,
  className,
  attachments,
}: ReadonlyContentProps) {
  return (
    <RichContent
      content={content}
      attachments={attachments}
      density="document"
      phase="settled"
      className={className}
    />
  );
});
