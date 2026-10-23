"use client";

import { useCallback, useMemo, useState } from "react";
import type { CommentThread } from "../components/comment-thread";
import { foldForFind } from "./use-task-find";

const NO_IDS: readonly string[] = [];

/**
 * Root ids of the resolved threads the open find query opens. A collapsed
 * resolved thread keeps its comments out of the DOM, so the page walk alone
 * would never count them.
 *
 * Deliberately temporary. It lives in the timeline, is recomputed for every
 * query, and is empty while the bar is closed (the query arrives as ""), so a
 * thread opened only by searching folds back when the bar closes. It never
 * reaches the persisted task-detail UI store, which remembers what the person
 * opened; a search is not that.
 *
 * Matching reads the raw comment body with the same folding as the page walk
 * (`foldForFind`: NFC, then lowercase), so a decomposed body and a composed
 * query agree. A query that only hits markdown syntax or a link target can
 * still open a thread whose rendered text shows no match.
 */
export function useFindExpandedThreads(
  threads: readonly CommentThread[],
  query: string,
): { ids: readonly string[]; dismiss: (rootId: string) => void } {
  // Threads the person collapsed by hand while this query was active. A new
  // query (closing the bar included) starts over: the render-time reset React
  // documents for state that follows a prop.
  const [dismissed, setDismissed] = useState<readonly string[]>(NO_IDS);
  const [dismissedFor, setDismissedFor] = useState(query);
  if (dismissedFor !== query) {
    setDismissedFor(query);
    setDismissed(NO_IDS);
  }

  const ids = useMemo(() => {
    const needle = foldForFind(query);
    if (needle.trim().length === 0) return NO_IDS;
    const matched = threads
      .filter(
        (thread) =>
          !!thread.root.resolved_at &&
          !dismissed.includes(thread.root.id) &&
          [thread.root, ...thread.replies].some((comment) =>
            foldForFind(comment.body).includes(needle),
          ),
      )
      .map((thread) => thread.root.id);
    return matched.length > 0 ? matched : NO_IDS;
  }, [threads, query, dismissed]);

  const dismiss = useCallback((rootId: string) => {
    setDismissed((current) => (current.includes(rootId) ? current : [...current, rootId]));
  }, []);

  return { ids, dismiss };
}
