"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type JumpFn = (threadId: string) => void;

type TaskThreadNavState = {
  open: boolean;
  pinned: boolean;
  hoverThreadId: string | null;
  onOpenChange: (open: boolean, pinned: boolean) => void;
  onHoverThread: (threadId: string | null) => void;
  scrollContainerEl: HTMLElement | null;
};

type TaskThreadNavApi = {
  jumpToThread: (threadId: string) => void;
  registerJump: (fn: JumpFn | null) => void;
  /**
   * Opens or closes the header panel. False when the trigger is absent
   * (no threads) so the page shortcut leaves the key alone.
   */
  toggle: () => boolean;
};

const TaskThreadNavStateContext = createContext<TaskThreadNavState | null>(null);
const TaskThreadNavApiContext = createContext<TaskThreadNavApi | null>(null);

/**
 * Owns the header thread-nav open/pin state and the jump callback the timeline
 * registers, so the shortcut and the header button share one coordinate system.
 *
 * State and API are separate contexts: the find scope only reads the stable
 * API (toggle), so hover/pin updates never re-render the find bar or fight
 * TipTap for focus.
 */
export function TaskThreadNavProvider({
  scrollContainerEl,
  children,
}: {
  scrollContainerEl: HTMLElement | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [hoverThreadId, setHoverThreadId] = useState<string | null>(null);
  const jumpRef = useRef<JumpFn | null>(null);
  const openRef = useRef(open);
  const pinnedRef = useRef(pinned);
  openRef.current = open;
  pinnedRef.current = pinned;

  const onOpenChange = useCallback((nextOpen: boolean, nextPinned: boolean) => {
    setOpen(nextOpen);
    setPinned(nextPinned);
    if (!nextOpen) setHoverThreadId(null);
  }, []);

  const registerJump = useCallback((fn: JumpFn | null) => {
    jumpRef.current = fn;
  }, []);

  const jumpToThread = useCallback((threadId: string) => {
    jumpRef.current?.(threadId);
  }, []);

  const toggle = useCallback(() => {
    const trigger = document.querySelector<HTMLElement>(
      "[data-testid='task-thread-nav-trigger']",
    );
    if (!trigger) return false;
    // Deliberate act: open already pinned. Pressing again over a pinned panel
    // closes it, matching the baseline Mod+Shift+O behaviour.
    if (openRef.current && pinnedRef.current) {
      onOpenChange(false, false);
    } else {
      onOpenChange(true, true);
    }
    return true;
  }, [onOpenChange]);

  const state = useMemo<TaskThreadNavState>(
    () => ({
      open,
      pinned,
      hoverThreadId,
      onOpenChange,
      onHoverThread: setHoverThreadId,
      scrollContainerEl,
    }),
    [open, pinned, hoverThreadId, onOpenChange, scrollContainerEl],
  );

  // Identity is fixed for the provider lifetime — toggle/jump close over refs.
  const api = useMemo<TaskThreadNavApi>(
    () => ({ jumpToThread, registerJump, toggle }),
    [jumpToThread, registerJump, toggle],
  );

  return (
    <TaskThreadNavApiContext.Provider value={api}>
      <TaskThreadNavStateContext.Provider value={state}>
        {children}
      </TaskThreadNavStateContext.Provider>
    </TaskThreadNavApiContext.Provider>
  );
}

/** Full state + API for the header panel and timeline jump wiring. */
export function useTaskThreadNav(): TaskThreadNavState & TaskThreadNavApi {
  const state = useContext(TaskThreadNavStateContext);
  const api = useContext(TaskThreadNavApiContext);
  if (!state || !api) {
    throw new Error("useTaskThreadNav must be used inside TaskThreadNavProvider");
  }
  return { ...state, ...api };
}

/** State + API when the provider may be absent (timeline / optional surfaces). */
export function useTaskThreadNavOptional(): (TaskThreadNavState & TaskThreadNavApi) | null {
  const state = useContext(TaskThreadNavStateContext);
  const api = useContext(TaskThreadNavApiContext);
  if (!state || !api) return null;
  return { ...state, ...api };
}

/**
 * Stable toggle for the page shortcut. Reads only the API context, whose
 * identity does not change on open/pin/hover — so the find scope never
 * re-renders when the panel opens.
 */
export function useToggleThreadNav(): (() => boolean) | null {
  const api = useContext(TaskThreadNavApiContext);
  return api?.toggle ?? null;
}
