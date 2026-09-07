"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, type ReactNode, type RefObject } from "react";

const DEFAULT_ESTIMATE_PX = 72;

interface VirtualChatMessageListProps {
  messages: { id: string }[];
  scrollRef: RefObject<HTMLDivElement | null>;
  stickToBottomRef: RefObject<boolean>;
  highlightMessageId?: string | null;
  header?: ReactNode;
  empty?: ReactNode;
  renderMessage: (index: number) => ReactNode;
}

/** Renders only visible chat rows to keep long histories smooth. */
export function VirtualChatMessageList({
  messages,
  scrollRef,
  stickToBottomRef,
  highlightMessageId,
  header,
  empty,
  renderMessage,
}: VirtualChatMessageListProps) {
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DEFAULT_ESTIMATE_PX,
    getItemKey: (index) => messages[index]?.id ?? index,
    overscan: 10,
    // React 19 warns when flushSync runs during ref/measure callbacks.
    useFlushSync: false,
  });

  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (!stickToBottomRef.current || messages.length === 0) return;
    virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
  }, [messages.length, lastMessageId, stickToBottomRef, virtualizer]);

  useEffect(() => {
    if (!highlightMessageId) return;
    const index = messages.findIndex((message) => message.id === highlightMessageId);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "center" });
  }, [highlightMessageId, messages, virtualizer]);

  if (messages.length === 0) {
    return empty ?? null;
  }

  return (
    <>
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
    </>
  );
}
