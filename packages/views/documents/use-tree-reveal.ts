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
  /** False while a host container (such as a closed sheet) hides the tree. */
  visible?: boolean;
  rows: readonly { node: { id: string } }[];
  rowRefs: React.RefObject<Map<string, HTMLElement>>;
  setExpanded: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
}

function isRowVisible(el: HTMLElement, visible: boolean): boolean {
  if (!visible || !el.isConnected) return false;
  for (let cur: HTMLElement | null = el; cur; cur = cur.parentElement) {
    if (cur.hidden || cur.hasAttribute("hidden") || cur.getAttribute("aria-hidden") === "true") {
      return false;
    }
    if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
      const style = window.getComputedStyle(cur);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
    }
  }
  return true;
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
 * - Scrolls the rendered row for `currentId` into view once it is visible.
 */
export function useTreeReveal({
  wsId,
  currentId,
  enabled = true,
  visible = true,
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
  const wasVisibleRef = useRef<boolean>(false);
  const deferredWhileHiddenRef = useRef<boolean>(false);

  useEffect(() => {
    const target = currentId ?? null;
    if (lastTargetRef.current !== target) {
      lastTargetRef.current = target;
      revealedForRef.current = null;
      pendingScrollForRef.current = target;
      deferredWhileHiddenRef.current = false;
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
    if (!currentId) {
      wasVisibleRef.current = false;
      deferredWhileHiddenRef.current = false;
      return undefined;
    }
    if (!detail.data || detail.data.id !== currentId) return undefined;
    const ancestorIds = (detail.data.breadcrumbs ?? [])
      .map((crumb) => crumb.id)
      .filter((id) => Boolean(id) && id !== currentId);
    if (ancestorIds.length > 0 && revealedForRef.current !== currentId) return undefined;
    const el = rowRefs.current?.get(currentId);
    if (!el) {
      if (!visible) {
        wasVisibleRef.current = false;
        deferredWhileHiddenRef.current = true;
      }
      return undefined;
    }

    const currentlyVisible = isRowVisible(el, visible);
    if (!currentlyVisible) {
      wasVisibleRef.current = false;
      deferredWhileHiddenRef.current = true;
      pendingScrollForRef.current = currentId;
    } else if (!wasVisibleRef.current) {
      wasVisibleRef.current = true;
      pendingScrollForRef.current = currentId;
    }

    if (pendingScrollForRef.current !== currentId) return undefined;

    let rafId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const cleanup = () => {
      if (rafId !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      resizeObserver?.disconnect();
      resizeObserver = null;
    };

    const revealScroll = () => {
      rafId = null;
      const target = rowRefs.current?.get(currentId);
      if (!target || !isRowVisible(target, visible)) return;
      cleanup();
      const inDialog = Boolean(target.closest('[role="dialog"]'));
      const deferredWhileHidden = deferredWhileHiddenRef.current;
      wasVisibleRef.current = true;
      deferredWhileHiddenRef.current = false;
      pendingScrollForRef.current = null;
      if (typeof target.scrollIntoView !== "function") return;
      const tree = target.closest('[role="tree"]');
      const activeEl = typeof document !== "undefined" ? document.activeElement : null;
      const bodyWasActive = !activeEl || activeEl === document.body;
      const focusInTree = Boolean(tree && activeEl && tree.contains(activeEl));
      target.scrollIntoView({ block: "nearest" });
      if (inDialog || (deferredWhileHidden && focusInTree)) {
        target.focus({ preventScroll: true });
        return;
      }
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

    const scheduleReveal = () => {
      const target = rowRefs.current?.get(currentId);
      if (!target || !isRowVisible(target, visible)) {
        wasVisibleRef.current = false;
        return;
      }
      if (!wasVisibleRef.current) {
        wasVisibleRef.current = true;
        pendingScrollForRef.current = currentId;
      }
      if (pendingScrollForRef.current !== currentId) return;
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        if (rafId !== null) window.cancelAnimationFrame(rafId);
        rafId = window.requestAnimationFrame(revealScroll);
      } else {
        revealScroll();
      }
    };

    if (currentlyVisible) {
      scheduleReveal();
      return cleanup;
    }

    if (visible && typeof ResizeObserver !== "undefined") {
      const container = el.closest("nav") ?? el.closest('[role="tree"]') ?? el;
      resizeObserver = new ResizeObserver(() => {
        scheduleReveal();
      });
      resizeObserver.observe(container);
    }

    return cleanup;
  }, [currentId, visible, rows, rowRefs, detail.data]);
}
