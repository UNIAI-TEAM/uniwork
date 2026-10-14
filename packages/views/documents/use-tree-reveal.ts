"use client";

import { useEffect, useRef } from "react";
import { ApiError } from "@uniwork/core/api";
import { useDocument } from "@uniwork/core/documents/hooks";

/** Do not retry 4xx (403/404) folder detail reads so invalid folders surface at once. */
export function shouldRetryFolderDetail(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 1;
}

export interface UseTreeRevealOptions {
  wsId: string;
  currentId: string | null | undefined;
  enabled?: boolean;
  rows: readonly { node: { id: string } }[];
  rowRefs: React.RefObject<Map<string, HTMLElement>>;
  setExpanded: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
}

/**
 * Reveals the open folder (`currentId`) in the sidebar tree:
 * - Reads ancestor IDs from `useDocument(wsId, currentId).data.breadcrumbs`
 *   (sharing the detail cache with the breadcrumb bar).
 * - Merges those ancestor IDs into `expanded` (never replacing branches the
 *   user already opened), at most once per distinct `currentId` value so an
 *   ancestor the user collapses after arrival stays collapsed across refetches.
 * - If a breadcrumb path is truncated by a restricted ancestor, opens the
 *   known prefix without error.
 * - Scrolls the rendered row for `currentId` into view once it mounts.
 */
export function useTreeReveal({
  wsId,
  currentId,
  enabled = true,
  rows,
  rowRefs,
  setExpanded,
}: UseTreeRevealOptions): void {
  const detail = useDocument(wsId, currentId ?? "", {
    enabled: enabled && Boolean(currentId),
    retry: shouldRetryFolderDetail,
  });
  const revealedForRef = useRef<string | null>(null);
  const pendingScrollForRef = useRef<string | null>(null);
  const lastTargetRef = useRef<string | null>(null);

  useEffect(() => {
    const target = currentId ?? null;
    if (lastTargetRef.current !== target) {
      lastTargetRef.current = target;
      revealedForRef.current = null;
      pendingScrollForRef.current = target;
    }
  }, [currentId]);

  useEffect(() => {
    if (!currentId) return;
    const doc = detail.data;
    if (!doc || doc.id !== currentId) return;
    if (revealedForRef.current === currentId) return;

    revealedForRef.current = currentId;
    pendingScrollForRef.current = currentId;

    const ancestorIds = (doc.breadcrumbs ?? [])
      .map((crumb) => crumb.id)
      .filter((id) => Boolean(id) && id !== currentId);

    if (ancestorIds.length === 0) return;

    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ancestorIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [currentId, detail.data, setExpanded]);

  useEffect(() => {
    if (!currentId || pendingScrollForRef.current !== currentId) return;
    if (!detail.data || detail.data.id !== currentId) return;
    const ancestorIds = (detail.data.breadcrumbs ?? [])
      .map((crumb) => crumb.id)
      .filter((id) => Boolean(id) && id !== currentId);
    if (ancestorIds.length > 0 && revealedForRef.current !== currentId) return;
    const el = rowRefs.current?.get(currentId);
    if (!el) return;

    const revealScroll = () => {
      const target = rowRefs.current?.get(currentId);
      if (!target) return;
      pendingScrollForRef.current = null;
      if (typeof target.scrollIntoView !== "function") return;
      const bodyWasActive =
        typeof document !== "undefined" &&
        (!document.activeElement || document.activeElement === document.body);
      target.scrollIntoView({ block: "nearest" });
      // `Element.scrollIntoView()` moves the browser's sequential focus
      // navigation start point to the scrolled element; resetting via body
      // keeps the first Tab at the top of document order (header -> nav -> tree).
      if (bodyWasActive && typeof document !== "undefined" && document.body) {
        const prevTabIndex = document.body.getAttribute("tabindex");
        document.body.setAttribute("tabindex", "-1");
        document.body.focus({ preventScroll: true });
        document.body.blur();
        if (prevTabIndex === null) document.body.removeAttribute("tabindex");
        else document.body.setAttribute("tabindex", prevTabIndex);
      }
    };

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      const rafId = window.requestAnimationFrame(revealScroll);
      return () => window.cancelAnimationFrame(rafId);
    }
    revealScroll();
    return undefined;
  }, [currentId, rows, rowRefs, detail.data]);
}
