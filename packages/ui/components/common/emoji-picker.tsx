"use client";

import { useEffect, useRef, useCallback } from "react";
import data from "@emoji-mart/data";
import { Picker } from "emoji-mart";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  /** emoji-mart's own strings (search, category names) in the app's language; English when unset. */
  i18n?: object;
}

export function EmojiPicker({ onSelect, i18n }: EmojiPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const handleSelect = useCallback((emoji: { native: string }) => {
    onSelectRef.current(emoji.native);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const picker = new Picker({
      data,
      onEmojiSelect: handleSelect,
      // The app's theme, not the OS's: "auto" followed prefers-color-scheme, so
      // a dark app on a light OS got a white panel with an unreadable search.
      theme: container.closest(".dark") ? "dark" : "light",
      set: "native",
      previewPosition: "none",
      skinTonePosition: "search",
      maxFrequentRows: 2,
      ...(i18n ? { i18n } : {}),
    });

    container.appendChild(picker as unknown as Node);

    return () => {
      container.replaceChildren();
    };
  }, [handleSelect, i18n]);

  return <div ref={containerRef} />;
}
