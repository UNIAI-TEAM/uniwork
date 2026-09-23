"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { ChatMentionCandidate } from "./chat-mention-utils";
import {
  filterMentionCandidates,
  formatComposerMentionDisplay,
  getActiveMentionQuery,
  insertMentionToken,
} from "./chat-mention-utils";

/** The whole @-word starting at `start` (up to the next space), whatever the caret. */
function mentionWordAt(text: string, start: number): string | null {
  if (text[start] !== "@") return null;
  const rest = text.slice(start + 1);
  const end = rest.search(/\s/);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Keys the picker itself handles: releasing one must not re-read the caret and reset the picker. */
const PICKER_KEYS = new Set(["ArrowUp", "ArrowDown", "Escape", "Enter", "Tab"]);

/**
 * The @-mention picker's state, driven from the textarea. Arrow keys move
 * the active option, Enter or Tab picks it, Escape closes it — and it stays
 * closed for that @-word until what follows the @ changes.
 */
export function useComposerMentions({
  enabled,
  candidates,
  allLabel,
  draft,
  onDraftChange,
  textareaRef,
}: {
  enabled: boolean;
  candidates: ChatMentionCandidate[] | undefined;
  allLabel: string;
  draft: string;
  onDraftChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Escape closes the picker for one @-word; it stays closed while that word
  // is unchanged, wherever the caret goes.
  const dismissedRef = useRef<{ start: number; word: string } | null>(null);

  const visibleCandidates = useMemo(() => {
    if (!enabled || !mention) return [];
    return filterMentionCandidates(candidates ?? [], mention.query, { allLabel });
  }, [allLabel, candidates, enabled, mention]);

  const open = enabled && mention !== null;
  const activeIndex = Math.min(selectedIndex, Math.max(visibleCandidates.length - 1, 0));

  const sync = (value: string, cursor: number) => {
    const dismissed = dismissedRef.current;
    if (dismissed && mentionWordAt(value, dismissed.start) !== dismissed.word) dismissedRef.current = null;
    const active = enabled ? getActiveMentionQuery(value, cursor) : null;
    if (!active || (dismissedRef.current && dismissedRef.current.start === active.start)) {
      setMention(null);
      return;
    }
    // Only a different @-word or query starts the list over at the top.
    if (mention && mention.start === active.start && mention.query === active.query) return;
    setMention(active);
    setSelectedIndex(0);
  };

  const close = () => {
    const el = textareaRef.current;
    if (mention && el) dismissedRef.current = { start: mention.start, word: mentionWordAt(el.value, mention.start) ?? "" };
    setMention(null);
    setSelectedIndex(0);
  };

  const insert = (candidate: ChatMentionCandidate) => {
    const el = textareaRef.current;
    if (!mention || !el) return;
    const cursor = el.selectionStart ?? draft.length;
    const display = formatComposerMentionDisplay(candidate, allLabel);
    const { nextDraft, nextCursor } = insertMentionToken(draft, mention.start, cursor, display);
    onDraftChange(nextDraft);
    dismissedRef.current = null;
    setMention(null);
    setSelectedIndex(0);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(nextCursor, nextCursor);
    });
  };

  /** Handles a keydown for the picker; true when it consumed the key. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, Math.max(visibleCandidates.length - 1, 0)));
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return true;
    }
    if ((event.key === "Enter" || event.key === "Tab") && visibleCandidates.length > 0) {
      event.preventDefault();
      const picked = visibleCandidates[activeIndex];
      if (picked) insert(picked);
      return true;
    }
    return false;
  };

  /** Re-read the caret after it moved by a key the picker does not own. */
  const onKeyUp = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (PICKER_KEYS.has(event.key)) return;
    const el = event.currentTarget;
    sync(el.value, el.selectionStart ?? el.value.length);
  };

  return {
    open,
    visibleCandidates,
    activeIndex,
    setSelectedIndex,
    sync,
    insert,
    onKeyDown,
    onKeyUp,
  };
}
