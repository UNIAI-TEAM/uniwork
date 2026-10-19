"use client";

import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { listDocumentMentionCandidates } from "@uniwork/core/api/endpoints/document-comments";
import { documentKeys } from "@uniwork/core/documents/keys";
import type { MentionCandidate } from "@uniwork/core/types/document-access";
import { mentionDisplay, mentionPeopleInBody, withUniqueLabel } from "./document-comment-mention-draft";
import { extractMentionTokens } from "./document-comments-model";

// The S14 mention picker as a hook over a plain textarea (EXPERIENCE-G8 S14,
// Accessibility Floor › S14): typing `@` at the start of a word opens it, the
// characters after `@` up to the caret are the query (150 ms after the last
// key), and the only people it ever offers are the document's mention
// candidates (G8-06 + G8-18 `include=no_access` when caller can see workspace
// members). The textarea becomes an APG combobox only while the listbox is open.

const DEBOUNCE_MS = 150;

/** The `@query` the caret sits in, or null: `@` must start the text or follow whitespace. */
function triggerAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,50})$/.exec(before);
  if (!match) return null;
  return { start: caret - (match[2]?.length ?? 0) - 1, query: match[2] ?? "" };
}

/**
 * The empty-list message. When the picker also lists people without access (`include=no_access`),
 * an empty answer means no one in the workspace, so the copy must not say "with access".
 */
function emptyKey(searching: boolean, includeNoAccess: boolean) {
  if (includeNoAccess) return searching ? ("noMatchMembers" as const) : ("noCandidatesMembers" as const);
  return searching ? ("noMatch" as const) : ("noCandidates" as const);
}

/** One row of the listbox: a person, a message the user cannot pick, or Retry. */
export type PickerRow =
  | { type: "person"; id: string; candidate: MentionCandidate }
  | { type: "message"; id: string; key: "searching" | "noMatch" | "noCandidates" | "noMatchMembers" | "noCandidatesMembers" | "error" }
  | { type: "retry"; id: string };

interface Options {
  wsId: string;
  documentId: string;
  /** The composer text ("@Name"); the trigger and the caret live in it. */
  value: string;
  /** The stored body (tokens): which picked people are still mentioned. */
  body: string;
  /** `picked` is the person just inserted, not yet in the picked map. */
  setValue: (next: string, picked?: MentionCandidate) => void;
  textarea: () => HTMLTextAreaElement | null;
  /** Whether the caller may list workspace members (`seeMembers`); gates `include=no_access` (G8-18, N1). */
  canSeeMembers?: boolean;
  onPickCandidate?: (candidate: MentionCandidate) => void;
}

export function useMentionPicker({
  wsId,
  documentId,
  value,
  body,
  setValue,
  textarea,
  canSeeMembers,
  onPickCandidate,
}: Options) {
  const listboxId = useId();
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [pickedCandidates, setPickedCandidates] = useState<ReadonlyMap<string, MentionCandidate>>(
    () => new Map(),
  );
  const open = trigger !== null;
  const includeNoAccess = canSeeMembers === true;

  useEffect(() => {
    if (!trigger) return undefined;
    const timer = window.setTimeout(() => setDebounced(trigger.query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trigger]);

  useEffect(() => {
    if (!value.trim() && pickedCandidates.size > 0) {
      setPickedCandidates(new Map());
    }
  }, [value, pickedCandidates.size]);

  const q = debounced.trim();
  const query = useQuery({
    queryKey: [
      ...documentKeys.mentionCandidates(wsId, documentId, q),
      includeNoAccess ? "no_access" : "viewers",
    ] as const,
    queryFn: ({ signal }) =>
      listDocumentMentionCandidates(
        documentId,
        { q: q || undefined, include: includeNoAccess ? "no_access" : undefined },
        signal,
      ),
    enabled: open && Boolean(wsId) && Boolean(documentId),
  });

  const candidates = useMemo(() => {
    const raw = query.data ?? [];
    return includeNoAccess ? raw : raw.filter((c) => c.can_view !== false);
  }, [includeNoAccess, query.data]);

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
    return [{ type: "message", id: `${listboxId}-empty`, key: emptyKey(debounced !== "", includeNoAccess) }];
  }, [
    candidates,
    debounced,
    includeNoAccess,
    listboxId,
    query.isError,
    query.isFetching,
    query.isSuccess,
    trigger,
  ]);

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

  const choose = (picked: MentionCandidate) => {
    if (!trigger) return;
    const candidate = withUniqueLabel(picked, mentionPeopleInBody(body));
    const caret = trigger.start + 1 + trigger.query.length;
    const token = `${mentionDisplay(candidate)} `;
    const next = value.slice(0, trigger.start) + token + value.slice(caret);
    setPickedCandidates((prev) => {
      const copy = new Map(prev);
      copy.set(candidate.user_id.toUpperCase(), candidate);
      return copy;
    });
    onPickCandidate?.(candidate);
    setValue(next, candidate);
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

  const pickedInBody = useMemo(() => {
    const tokens = extractMentionTokens(body);
    const list: MentionCandidate[] = [];
    for (const token of tokens) {
      const found = pickedCandidates.get(token.userId.toUpperCase());
      if (found) list.push(found);
    }
    return list;
  }, [pickedCandidates, body]);

  const clearPicked = useCallback(() => setPickedCandidates(new Map()), []);

  return {
    open,
    rows,
    activeId: activeRow?.id,
    listboxId,
    count: candidates.length,
    query: debounced,
    pickedCandidates,
    pickedInBody,
    clearPicked,
    sync,
    close,
    activate,
    onKeyDown,
  };
}
