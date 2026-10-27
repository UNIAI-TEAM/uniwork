"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type ChatMessageSelection = {
  active: boolean;
  selectedIds: ReadonlySet<string>;
  enter: (messageId: string) => void;
  toggle: (messageId: string) => void;
  clear: () => void;
  isSelected: (messageId: string) => boolean;
};

/**
 * Telegram-style multi-select for one room's timeline: enter from a message
 * menu, toggle by id, Esc / room change clears.
 */
export function useChatMessageSelection(roomId: string): ChatMessageSelection {
  const [active, setActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setActive(false);
    setSelectedIds(new Set());
  }, [roomId]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setActive(false);
      setSelectedIds(new Set());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  const enter = useCallback((messageId: string) => {
    setActive(true);
    setSelectedIds(new Set([messageId]));
  }, []);

  const toggle = useCallback((messageId: string) => {
    setActive(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      if (next.size === 0) {
        setActive(false);
        return new Set();
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setActive(false);
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback((messageId: string) => selectedIds.has(messageId), [selectedIds]);

  return useMemo(
    () => ({ active, selectedIds, enter, toggle, clear, isSelected }),
    [active, clear, enter, isSelected, selectedIds, toggle],
  );
}

/** Join selected message bodies in timeline order for clipboard copy. */
export function joinSelectedChatMessageText(
  messages: readonly { id: string; body: string; ts: number }[],
  selectedIds: ReadonlySet<string>,
  textOf: (message: { id: string; body: string }) => string,
): string {
  return messages
    .filter((message) => selectedIds.has(message.id))
    .slice()
    .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
    .map((message) => textOf(message))
    .filter((text) => text.length > 0)
    .join("\n");
}
