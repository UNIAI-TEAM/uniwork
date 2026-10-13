"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { useDocumentMentionCandidates } from "@uniwork/core/documents/hooks-comments";
import type { MentionCandidate } from "@uniwork/core/api/endpoints/document-comments";

// The S14 mention picker as a hook over a plain textarea (EXPERIENCE-G8 S14,
// Accessibility Floor › S14): typing `@` at the start of a word opens it, the
// characters after `@` up to the caret are the query (150 ms after the last
// key), and the only people it ever offers are the document's mention
// candidates (G8-06) - never a workspace member list. The textarea becomes an
// APG combobox only while the listbox is open.

const DEBOUNCE_MS = 150;

/** `[`, `]`, `(`, `)` and `\` are escaped in a token label (contract-collab 3). */
const escapeLabel = (label: string) => label.replace(/[\\[\]()]/g, (ch) => `\\${ch}`);

export function mentionToken(candidate: Pick<MentionCandidate, "user_id" | "display_name">): string {
  return `[@${escapeLabel(candidate.display_name || candidate.user_id)}](mention://member/${candidate.user_id})`;
}

/** The `@query` the caret sits in, or null: `@` must start the text or follow whitespace. */
function triggerAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,50})$/.exec(before);
  if (!match) return null;
  return { start: caret - (match[2]?.length ?? 0) - 1, query: match[2] ?? "" };
}

/** One row of the listbox: a person, a message the user cannot pick, or Retry. */
export type PickerRow =
  | { type: "person"; id: string; candidate: MentionCandidate }
  | { type: "message"; id: string; key: "searching" | "noMatch" | "noCandidates" | "error" }
  | { type: "retry"; id: string };

interface Options {
  wsId: string;
  documentId: string;
  value: string;
  setValue: (next: string) => void;
  textarea: () => HTMLTextAreaElement | null;
}

export function useMentionPicker({ wsId, documentId, value, setValue, textarea }: Options) {
  const listboxId = useId();
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const open = trigger !== null;

  useEffect(() => {
    if (!trigger) return undefined;
    const timer = window.setTimeout(() => setDebounced(trigger.query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trigger]);

  const query = useDocumentMentionCandidates(wsId, documentId, debounced, { enabled: open });
  const candidates = useMemo(() => query.data ?? [], [query.data]);

  const rows = useMemo<PickerRow[]>(() => {
    const people: PickerRow[] = candidates.map((candidate) => ({
      type: "person",
      id: `${listboxId}-${candidate.user_id}`,
      candidate,
    }));
    if (query.isError) {
      return [
        { type: "message", id: `${listboxId}-error`, key: "error" },
        { type: "retry", id: `${listboxId}-retry` },
      ];
    }
    // Old results stay while a new term is on its way (S14 "Đang tìm").
    if (query.isFetching || (trigger !== null && trigger.query !== debounced)) {
      return [{ type: "message", id: `${listboxId}-searching`, key: "searching" }, ...people];
    }
    if (people.length > 0) return people;
    if (!query.isSuccess) return [{ type: "message", id: `${listboxId}-searching`, key: "searching" }];
    return [{ type: "message", id: `${listboxId}-empty`, key: debounced ? "noMatch" : "noCandidates" }];
  }, [candidates, debounced, listboxId, query.isError, query.isFetching, query.isSuccess, trigger]);

  // The first selectable row is marked whenever the rows change.
  const selectable = rows.filter((row) => row.type !== "message");
  const activeRow = selectable[Math.min(active, Math.max(selectable.length - 1, 0))] ?? null;
  useEffect(() => setActive(0), [debounced]);

  const close = () => {
    setTrigger(null);
    setDebounced("");
  };

  /** Re-read the caret after every edit or caret move. */
  const sync = (text: string, caret: number) => {
    const next = triggerAt(text, caret);
    if (!next) {
      if (trigger) close();
      return;
    }
    setTrigger(next);
  };

  const choose = (candidate: MentionCandidate) => {
    if (!trigger) return;
    const caret = trigger.start + 1 + trigger.query.length;
    const token = `${mentionToken(candidate)} `;
    const next = value.slice(0, trigger.start) + token + value.slice(caret);
    setValue(next);
    close();
    const position = trigger.start + token.length;
    window.requestAnimationFrame(() => {
      const el = textarea();
      el?.focus();
      el?.setSelectionRange(position, position);
    });
  };

  const activate = (row: PickerRow) => {
    if (row.type === "person") choose(row.candidate);
    else if (row.type === "retry") void query.refetch();
  };

  /** Returns true when the picker consumed the key. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (event.key === "Escape") {
      close();
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (selectable.length > 0) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((current) => (current + step + selectable.length) % selectable.length);
      }
      return true;
    }
    // Ctrl/⌘+Enter while the listbox shows must not send the half-typed `@query` as plain text:
    // the picker keeps the key until the person picks someone or closes it (Escape).
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) return true;
    if ((event.key === "Enter" || event.key === "Tab") && !event.ctrlKey && !event.metaKey && activeRow) {
      activate(activeRow);
      return true;
    }
    return false;
  };

  return {
    open,
    rows,
    activeId: activeRow?.id,
    listboxId,
    count: candidates.length,
    query: debounced,
    sync,
    close,
    activate,
    onKeyDown,
  };
}
