"use client";

import { useEffect, type ReactNode } from "react";
import { useComments } from "@uniwork/core/tasks";
import { useTaskDetailShortcuts } from "../hooks/use-task-detail-shortcuts";
import { useToggleThreadNav } from "../thread-nav-context";
import { TaskFindQueryContext } from "./find-query-context";
import { TaskFindBar } from "./task-find-bar";
import { useTaskFind } from "./use-task-find";

/**
 * In-page find for one loaded task: the find state, the page's keyboard
 * shortcuts and the floating bar.
 *
 * The page content arrives as `children`, an element the page created. When
 * find state changes (every keystroke, every new count) only this component
 * re-renders; React skips the unchanged `children` element, so the title and
 * description editors are left alone, and the query reaches the timeline
 * through a context nothing else reads.
 */
export function TaskFindScope({
  taskId,
  container,
  description,
  children,
}: {
  taskId: string;
  /** The page's scroll container: the searched region. */
  container: HTMLElement | null;
  description: string;
  children: ReactNode;
}) {
  // Same query key as the timeline, so no second request. Read here rather
  // than in the page, so a comments refetch does not re-render the editors.
  const { data: comments } = useComments(taskId);
  const find = useTaskFind({
    container,
    contentKey: `${comments?.length ?? 0}:${description}`,
  });
  const { open, query, closeFind, openFind, barRef } = find;
  // Stable API only — open/pin/hover must not re-render this scope (TipTap).
  const onToggleThreadNav = useToggleThreadNav();
  useTaskDetailShortcuts({
    container,
    findBarRef: barRef,
    onFind: openFind,
    onToggleThreadNav,
  });

  // The route reuses the page for another task: drop the old search.
  useEffect(() => {
    closeFind();
  }, [taskId, closeFind]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {open ? (
        // Outside the scroll container, so it stays put while the page
        // scrolls; z-30 clears the sticky comment composer (z-10).
        <TaskFindBar find={find} className="absolute right-4 top-3 z-30" />
      ) : null}
      <TaskFindQueryContext.Provider value={open ? query : ""}>
        {children}
      </TaskFindQueryContext.Provider>
    </div>
  );
}
