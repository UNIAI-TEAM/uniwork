"use client";

import { ResolvedThreadBar as SharedResolvedThreadBar } from "../../../comments/resolved-thread-bar";

/** Task-side adapter: the shared resolved-thread bar with the task i18n namespace. */
export function ResolvedThreadBar({
  replyCount,
  expanded,
  onToggle,
}: {
  replyCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <SharedResolvedThreadBar
      replyCount={replyCount}
      expanded={expanded}
      onToggle={onToggle}
      tPrefix="tasks.detail"
    />
  );
}
