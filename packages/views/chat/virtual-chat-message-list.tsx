"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

const DEFAULT_ESTIMATE_PX = 88;

/** Restores scrollTop after inline → virtual swap (virtual mount resets the scroller to ~0). */
export function applyVirtualScrollRestore(scrollEl: HTMLDivElement, scrollTop: number): void {
  const apply = () => {
    const max = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    if (max === 0 && scrollTop > 0) {
      requestAnimationFrame(apply);
      return;
    }
    scrollEl.scrollTop = Math.min(Math.max(0, scrollTop), max);
  };
  apply();
}

/** Keeps the same messages in view after older rows are prepended above the header. */
export function preserveScrollAfterPrepend(
  scrollEl: HTMLDivElement,
  scrollHeightBefore: number,
  scrollTopBefore: number,
): void {
  const delta = scrollEl.scrollHeight - scrollHeightBefore;
  scrollEl.scrollTop = Math.max(0, scrollTopBefore + delta);
}

/** Virtual remeasure and images settle over a few frames — one rAF is not enough. */
export function preserveScrollAfterPrependOverFrames(
  scrollEl: HTMLDivElement,
  scrollHeightBefore: number,
  scrollTopBefore: number,
  programmaticScrollRef: RefObject<boolean>,
  onEachFrame?: () => void,
): void {
  programmaticScrollRef.current = true;
  const apply = () => {
    preserveScrollAfterPrepend(scrollEl, scrollHeightBefore, scrollTopBefore);
    onEachFrame?.();
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(() => {
      apply();
      programmaticScrollRef.current = false;
    });
  });
}

type TimelineLayoutSnap = { length: number; firstId: string; scrollHeight: number; scrollTop: number };

function timelinePrepended(
  messages: { id: string }[],
  snap: TimelineLayoutSnap,
  stickToBottomRef: RefObject<boolean>,
): boolean {
  return (
    messages.length > snap.length &&
    messages[0]?.id !== snap.firstId &&
    snap.scrollHeight > 0 &&
    !stickToBottomRef.current
  );
}

function usePreserveScrollOnPrepend(
  messages: { id: string }[],
  scrollRef: RefObject<HTMLDivElement | null>,
  stickToBottomRef: RefObject<boolean>,
  programmaticScrollRef: RefObject<boolean>,
  onPrependLayout?: (scrollEl: HTMLDivElement) => void,
): void {
  const snapRef = useRef<TimelineLayoutSnap>({ length: 0, firstId: "", scrollHeight: 0, scrollTop: 0 });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    const snap = snapRef.current;
    if (timelinePrepended(messages, snap, stickToBottomRef)) {
      onPrependLayout?.(el);
      preserveScrollAfterPrependOverFrames(el, snap.scrollHeight, snap.scrollTop, programmaticScrollRef, () => {
        onPrependLayout?.(el);
      });
    }
    snap.length = messages.length;
    snap.firstId = messages[0]?.id ?? "";
    snap.scrollHeight = el.scrollHeight;
    snap.scrollTop = el.scrollTop;
  }, [messages.length, messages[0]?.id, onPrependLayout, programmaticScrollRef, scrollRef, stickToBottomRef]);
}

interface ChatMessageListProps {
  messages: { id: string }[];
  /** Set in onScroll right before unpinned layout; consumed once when virtual mounts. */
  pendingVirtualScrollRestoreRef?: RefObject<number | null>;
  /**
   * Stable ids alone are not enough: grouping flips lastOfRun on the previous
   * row when a new bubble arrives, which changes height — the virtualizer must
   * remeasure, not reuse the old slot size (otherwise rows overlap).
   */
  getItemKey?: (index: number) => string | number;
  /** Pinned at the newest end: plain list layout (Telegram-smooth rapid sends). */
  useInlineLayout?: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  stickToBottomRef: RefObject<boolean>;
  /** When true, onScroll must not clear stick-to-bottom (panel reads this). */
  programmaticScrollRef: RefObject<boolean>;
  highlightMessageId?: string | null;
  /** Called once the highlighted row has been scrolled into view (focus it there). */
  onHighlightShown?: (messageId: string) => void;
  header?: ReactNode;
  empty?: ReactNode;
  renderMessage: (index: number) => ReactNode;
}

/** Keys a row for @tanstack/react-virtual — include layout flags that change height. */
export function virtualChatRowMeasureKey(
  message: { id: string; clientMsgId?: string } | undefined,
  layout: { lastOfRun: boolean; compactTop: boolean } | undefined,
  index: number,
): string | number {
  if (!message || !layout) return index;
  const stableId = message.clientMsgId ?? message.id;
  return `${stableId}:${layout.lastOfRun ? "L" : "m"}:${layout.compactTop ? "c" : "n"}`;
}

/**
 * Keep the scrollport on the newest message while measures settle. The
 * follow-up frames only pin while still pinned: a jump to a message
 * (search, pin bar, quote, deep link) unpins, and must not be undone.
 */
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
    if (stickToBottomRef.current) scrollEl.scrollTop = scrollEl.scrollHeight;
  };
  apply();
  requestAnimationFrame(() => {
    if (!stickToBottomRef.current) {
      programmaticScrollRef.current = false;
      return;
    }
    apply();
    requestAnimationFrame(() => {
      if (!stickToBottomRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
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
  if (scrollEl.scrollTop > nearBottomPx) {
    stickToBottomRef.current = false;
    return false;
  }
  return stickToBottomRef.current;
}

/** When the reader last scrolled by hand in the scroller: wheel, touch, pointer, key or focus. */
export function useReaderScrollAt(scrollRef: RefObject<HTMLDivElement | null>): RefObject<number> {
  const at = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mark = () => {
      at.current = Date.now();
    };
    const events = ["wheel", "touchmove", "pointerdown", "keydown", "focusin"] as const;
    for (const name of events) el.addEventListener(name, mark, { passive: true });
    return () => {
      for (const name of events) el.removeEventListener(name, mark);
    };
  }, [scrollRef]);
  return at;
}

function remeasureVirtualRows(
  scrollEl: HTMLDivElement,
  virtualizer: { getVirtualItems: () => { index: number }[]; measureElement: (el: Element) => void },
): void {
  for (const row of virtualizer.getVirtualItems()) {
    const node = scrollEl.querySelector(`[data-index="${row.index}"]`);
    if (node instanceof Element) virtualizer.measureElement(node);
  }
}

function usePinOnNewMessages(
  messages: { id: string }[],
  scrollRef: RefObject<HTMLDivElement | null>,
  stickToBottomRef: RefObject<boolean>,
  programmaticScrollRef: RefObject<boolean>,
  highlightMessageId: string | null | undefined,
  /** Plain list at the newest end: one sync scroll per row beats rAF lag while spamming. */
  syncOnly: boolean,
) {
  const lastMessageId = messages[messages.length - 1]?.id;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0 || highlightMessageId) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
    if (!syncOnly) pinChatScrollToBottom(el, stickToBottomRef, programmaticScrollRef);
  }, [
    highlightMessageId,
    lastMessageId,
    messages.length,
    programmaticScrollRef,
    scrollRef,
    stickToBottomRef,
    syncOnly,
  ]);
}

function useResizePinToBottom(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  stickToBottomRef: RefObject<boolean>,
  programmaticScrollRef: RefObject<boolean>,
  messageCount: number,
) {
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
  }, [contentRef, messageCount, programmaticScrollRef, scrollRef, stickToBottomRef]);
}

function InlineChatMessageList({
  messages,
  getItemKey,
  scrollRef,
  stickToBottomRef,
  programmaticScrollRef,
  highlightMessageId,
  onHighlightShown,
  header,
  renderMessage,
}: ChatMessageListProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const resolveItemKey = getItemKey ?? ((index: number) => messages[index]?.id ?? index);

  usePinOnNewMessages(messages, scrollRef, stickToBottomRef, programmaticScrollRef, highlightMessageId, true);
  usePreserveScrollOnPrepend(messages, scrollRef, stickToBottomRef, programmaticScrollRef);
  useResizePinToBottom(scrollRef, contentRef, stickToBottomRef, programmaticScrollRef, messages.length);

  useEffect(() => {
    if (!highlightMessageId) return;
    stickToBottomRef.current = false;
    const node = document.getElementById(`chat-msg-${highlightMessageId}`);
    if (!node) return;
    programmaticScrollRef.current = true;
    node.scrollIntoView({ block: "center" });
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
      onHighlightShown?.(highlightMessageId);
    });
  }, [highlightMessageId, onHighlightShown, programmaticScrollRef, stickToBottomRef]);

  return (
    <div ref={contentRef} className="w-full max-w-full">
      {header}
      <div className="relative w-full max-w-full pb-2">
        {messages.map((_, index) => (
          <div key={String(resolveItemKey(index))}>{renderMessage(index)}</div>
        ))}
      </div>
    </div>
  );
}

function VirtualizedChatMessageList({
  messages,
  getItemKey,
  scrollRef,
  stickToBottomRef,
  programmaticScrollRef,
  pendingVirtualScrollRestoreRef,
  highlightMessageId,
  onHighlightShown,
  header,
  renderMessage,
}: ChatMessageListProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const resolveItemKey = getItemKey ?? ((index: number) => messages[index]?.id ?? index);
  const measureGeneration = useMemo(
    () => messages.map((_, index) => String(resolveItemKey(index))).join("\n"),
    [messages, resolveItemKey],
  );

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DEFAULT_ESTIMATE_PX,
    getItemKey: resolveItemKey,
    overscan: 12,
    useFlushSync: false,
  });

  const lastMessageId = messages[messages.length - 1]?.id;
  const remeasure = useCallback(
    (scrollEl: HTMLDivElement) => {
      remeasureVirtualRows(scrollEl, virtualizer);
    },
    [virtualizer],
  );

  usePreserveScrollOnPrepend(messages, scrollRef, stickToBottomRef, programmaticScrollRef, remeasure);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    // Prepend preserve (and pin-to-bottom) own scrollTop for a few frames.
    if (programmaticScrollRef.current) return;
    const pending = pendingVirtualScrollRestoreRef?.current;
    if (pending != null) {
      pendingVirtualScrollRestoreRef.current = null;
      applyVirtualScrollRestore(el, pending);
      remeasureVirtualRows(el, virtualizer);
      requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        applyVirtualScrollRestore(scrollRef.current, pending);
        remeasureVirtualRows(scrollRef.current, virtualizer);
      });
      return;
    }
    remeasureVirtualRows(el, virtualizer);
    if (highlightMessageId || !stickToBottomRef.current) return;
    pinChatScrollToBottom(el, stickToBottomRef, programmaticScrollRef);
    requestAnimationFrame(() => {
      if (!scrollRef.current || !stickToBottomRef.current) return;
      remeasureVirtualRows(scrollRef.current, virtualizer);
      pinChatScrollToBottom(scrollRef.current, stickToBottomRef, programmaticScrollRef);
    });
  }, [
    highlightMessageId,
    lastMessageId,
    measureGeneration,
    messages.length,
    pendingVirtualScrollRestoreRef,
    programmaticScrollRef,
    scrollRef,
    stickToBottomRef,
    virtualizer,
  ]);

  useResizePinToBottom(scrollRef, contentRef, stickToBottomRef, programmaticScrollRef, messages.length);

  const scrolledHighlightRef = useRef<string | null>(null);
  const onHighlightShownRef = useRef(onHighlightShown);
  onHighlightShownRef.current = onHighlightShown;
  useEffect(() => {
    if (!highlightMessageId) {
      scrolledHighlightRef.current = null;
      return;
    }
    if (scrolledHighlightRef.current === highlightMessageId) return;
    const index = messages.findIndex((message) => message.id === highlightMessageId);
    if (index < 0) return;
    scrolledHighlightRef.current = highlightMessageId;
    stickToBottomRef.current = false;
    const align = () => {
      programmaticScrollRef.current = true;
      virtualizer.scrollToIndex(index, { align: "center" });
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
    };
    align();
    requestAnimationFrame(() => requestAnimationFrame(() => onHighlightShownRef.current?.(highlightMessageId)));
    const timers = [400, 1200].map((ms) => window.setTimeout(align, ms));
    const el = scrollRef.current;
    const stop = () => timers.forEach((timer) => window.clearTimeout(timer));
    const events = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    for (const name of events) el?.addEventListener(name, stop, { passive: true, once: true });
    return () => {
      stop();
      for (const name of events) el?.removeEventListener(name, stop);
    };
  }, [highlightMessageId, messages, programmaticScrollRef, scrollRef, stickToBottomRef, virtualizer]);

  return (
    <div ref={contentRef} className="w-full max-w-full">
      {header}
      <div
        className="relative w-full max-w-full pb-2"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
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

/** Renders chat rows; uses a plain list at the newest end, virtualizes when reading history. */
export function VirtualChatMessageList({
  messages,
  useInlineLayout = false,
  empty,
  ...rest
}: ChatMessageListProps) {
  if (messages.length === 0) return empty ?? null;
  if (useInlineLayout) return <InlineChatMessageList messages={messages} {...rest} />;
  return <VirtualizedChatMessageList messages={messages} {...rest} />;
}
