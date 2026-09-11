"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

const DEFAULT_ESTIMATE_PX = 72;

interface VirtualChatMessageListProps {
  messages: { id: string }[];
  scrollRef: RefObject<HTMLDivElement | null>;
  stickToBottomRef: RefObject<boolean>;
  /** When true, onScroll must not clear stick-to-bottom (panel reads this). */
  programmaticScrollRef: RefObject<boolean>;
  highlightMessageId?: string | null;
  header?: ReactNode;
  empty?: ReactNode;
  renderMessage: (index: number) => ReactNode;
}

/** Keep the scrollport on the newest message while measures settle. */
export function pinChatScrollToBottom(
  scrollEl: HTMLDivElement,
  stickToBottomRef: RefObject<boolean>,
  programmaticScrollRef: RefObject<boolean>,
  options?: { force?: boolean },
) {
  if (!options?.force && !stickToBottomRef.current) return;
  stickToBottomRef.current = true;
  programmaticScrollRef.current = true;
  const apply = () => {
    scrollEl.scrollTop = scrollEl.scrollHeight;
  };
  apply();
  // measureElement grows the spacer after paint; keep pinning for two frames.
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(() => {
      apply();
      programmaticScrollRef.current = false;
    });
  });
}

/**
 * Update stick-to-bottom from a user scroll.
 * Do NOT clear stick when scrollTop is still ~0 — that flash happens on every
 * reload before we pin to the bottom, and clearing it leaves the user stuck up top.
 */
export function updateStickToBottomFromScroll(
  scrollEl: HTMLDivElement,
  stickToBottomRef: RefObject<boolean>,
  nearBottomPx = 120,
): boolean {
  const distanceFromBottom =
    scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
  const nearBottom = distanceFromBottom <= nearBottomPx;
  if (nearBottom) {
    stickToBottomRef.current = true;
    return true;
  }
  // User scrolled into the middle of history (away from both ends' flash zone).
  if (scrollEl.scrollTop > nearBottomPx) {
    stickToBottomRef.current = false;
    return false;
  }
  // scrollTop≈0 with a long list: either still waiting to pin, or already reading
  // the oldest page — keep the previous stick flag unchanged.
  return stickToBottomRef.current;
}

/** Renders only visible chat rows to keep long histories smooth. */
export function VirtualChatMessageList({
  messages,
  scrollRef,
  stickToBottomRef,
  programmaticScrollRef,
  highlightMessageId,
  header,
  empty,
  renderMessage,
}: VirtualChatMessageListProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DEFAULT_ESTIMATE_PX,
    getItemKey: (index) => messages[index]?.id ?? index,
    overscan: 12,
    // React 19 warns when flushSync runs during ref/measure callbacks.
    useFlushSync: false,
  });

  const lastMessageId = messages[messages.length - 1]?.id;
  const hadMessagesRef = useRef(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) {
      hadMessagesRef.current = false;
      return;
    }
    const firstPaint = !hadMessagesRef.current;
    hadMessagesRef.current = true;
    // First page for this mount / after empty → always land on newest.
    if (firstPaint || stickToBottomRef.current) {
      pinChatScrollToBottom(el, stickToBottomRef, programmaticScrollRef, {
        force: firstPaint,
      });
    }
  }, [messages.length, lastMessageId, scrollRef, stickToBottomRef, programmaticScrollRef]);

  // Row measures + header ("load older") change height after layout.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;
    const observer = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return;
      pinChatScrollToBottom(scrollEl, stickToBottomRef, programmaticScrollRef);
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [scrollRef, stickToBottomRef, programmaticScrollRef, messages.length]);

  useEffect(() => {
    if (!highlightMessageId) return;
    const index = messages.findIndex((message) => message.id === highlightMessageId);
    if (index < 0) return;
    programmaticScrollRef.current = true;
    stickToBottomRef.current = false;
    virtualizer.scrollToIndex(index, { align: "center" });
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, [highlightMessageId, messages, programmaticScrollRef, stickToBottomRef, virtualizer]);

  if (messages.length === 0) {
    return empty ?? null;
  }

  return (
    <div ref={contentRef} className="w-full max-w-full">
      {header}
      <div
        className="relative w-full max-w-full pb-2"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={messages[virtualRow.index]?.id ?? virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full max-w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {renderMessage(virtualRow.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
