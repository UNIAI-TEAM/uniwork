"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactNode,
} from "react";

type Layer = {
  openMessageId: string | null;
  setOpenMessageId: (id: string | null) => void;
};

const ChatMessageActionsLayerContext = createContext<Layer | null>(null);

/** Lifts the virtual row that owns an open message menu above its neighbours (transform stacking). */
export function ChatMessageActionsLayerProvider({ children }: { children: ReactNode }) {
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);
  const value = useMemo(() => ({ openMessageId, setOpenMessageId }), [openMessageId]);
  return <ChatMessageActionsLayerContext.Provider value={value}>{children}</ChatMessageActionsLayerContext.Provider>;
}

export function useChatMessageActionsLayer(): Layer | null {
  return useContext(ChatMessageActionsLayerContext);
}

export function useRegisterMessageActionsOpen(messageId: string, open: boolean): void {
  const layer = useContext(ChatMessageActionsLayerContext);
  useEffect(() => {
    if (!layer) return;
    if (open) layer.setOpenMessageId(messageId);
    else if (layer.openMessageId === messageId) layer.setOpenMessageId(null);
    return () => {
      if (layer.openMessageId === messageId) layer.setOpenMessageId(null);
    };
  }, [layer, messageId, open]);
}

const MENU_GAP_PX = 6;
const VIEWPORT_EDGE_PX = 8;
/** Above virtual rows (`z-50`) and popovers (`z-50`) in the chat timeline. */
const MESSAGE_ACTIONS_Z = 500;
const MENU_HEIGHT_FALLBACK_PX = 320;

function scrollContainersFor(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let node: HTMLElement | null = el.parentElement; node; node = node.parentElement) {
    const { overflowY, overflowX, overflow } = getComputedStyle(node);
    const scrollable = [overflow, overflowX, overflowY].some((v) => v === "auto" || v === "scroll" || v === "overlay");
    if (scrollable) out.push(node);
  }
  return out;
}

function scrollerViewport(scroller: HTMLElement | undefined): { top: number; bottom: number } {
  if (!scroller) return { top: VIEWPORT_EDGE_PX, bottom: window.innerHeight - VIEWPORT_EDGE_PX };
  const rect = scroller.getBoundingClientRect();
  return { top: rect.top + VIEWPORT_EDGE_PX, bottom: rect.bottom - VIEWPORT_EDGE_PX };
}

/** Fixed coordinates for a menu portalled to `document.body`, anchored to the message column. */
export function useMessageActionsPortalPosition(
  anchorRef: RefObject<HTMLElement | null> | undefined,
  menuRef: RefObject<HTMLElement | null> | undefined,
  open: boolean,
  isOwn: boolean,
): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  const update = useCallback(() => {
    const anchor = anchorRef?.current;
    if (!anchor || !open) {
      setStyle(null);
      return;
    }
    const bubble =
      anchor.querySelector<HTMLElement>("[data-message-actions-anchor]") ??
      anchor;
    const rect = bubble.getBoundingClientRect();
    const scroller = scrollContainersFor(anchor)[0];
    const viewport = scrollerViewport(scroller);
    const menuHeight = menuRef?.current?.offsetHeight ?? MENU_HEIGHT_FALLBACK_PX;

    const spaceAbove = rect.top - viewport.top;
    const spaceBelow = viewport.bottom - rect.bottom;
    const fitsAbove = spaceAbove >= menuHeight + MENU_GAP_PX;
    const fitsBelow = spaceBelow >= menuHeight + MENU_GAP_PX;
    const placeAbove = fitsAbove || (!fitsBelow && spaceAbove >= spaceBelow);

    const horizontal = isOwn
      ? { right: window.innerWidth - rect.right }
      : { left: rect.left };

    if (placeAbove) {
      setStyle({
        position: "fixed",
        top: rect.top - MENU_GAP_PX,
        ...horizontal,
        transform: "translateY(-100%)",
        zIndex: MESSAGE_ACTIONS_Z,
      });
    } else {
      setStyle({
        position: "fixed",
        top: Math.min(rect.bottom + MENU_GAP_PX, viewport.bottom - menuHeight),
        ...horizontal,
        transform: "none",
        zIndex: MESSAGE_ACTIONS_Z,
      });
    }
  }, [anchorRef, isOwn, menuRef, open]);

  useLayoutEffect(() => {
    update();
    if (!open) return;
    const anchor = anchorRef?.current;
    const scrollRoots = anchor ? scrollContainersFor(anchor) : [];
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    for (const root of scrollRoots) root.addEventListener("scroll", update, { passive: true });

    const menu = menuRef?.current;
    const ro =
      menu && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => update())
        : null;
    if (menu && ro) ro.observe(menu);

    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      for (const root of scrollRoots) root.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [anchorRef, menuRef, open, update]);

  return style;
}
