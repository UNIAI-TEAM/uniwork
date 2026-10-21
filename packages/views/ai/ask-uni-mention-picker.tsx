"use client";

import { useEffect, useId, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { AskUniInput } from "@uniwork/core/types";
import { useFlag } from "@uniwork/core/feature-flags";
import { cn } from "@uniwork/ui/lib/utils";
import {
  useDocumentMatches,
  useMeetingMatches,
  useMemberMatches,
  useProjectMatches,
  useTaskMatches,
  type LookupItem,
} from "./ask-uni-lookup";

type MentionKind = NonNullable<AskUniInput["mentions"]>[number]["kind"];

export interface MentionPick {
  kind: MentionKind;
  id: string;
  label: string;
}

interface Group {
  kind: MentionKind;
  title: string;
  items: LookupItem[];
}

/**
 * The list under an open `@`. It never takes focus: the textarea keeps the caret and this list is
 * driven from its keys (arrows, Enter/Tab pick, Escape closes) through aria-activedescendant.
 */
export function AskUniMentionPicker({
  wsId,
  query,
  inputRef,
  onPick,
  onDismiss,
}: {
  wsId: string;
  query: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onPick: (pick: MentionPick) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.mention" });
  const uid = useId();
  const documentsOn = useFlag("documents", false);
  const all: Group[] = [
    { kind: "member", title: t("people"), items: useMemberMatches(wsId, query) },
    { kind: "task", title: t("tasks"), items: useTaskMatches(wsId, query, true) },
    { kind: "document", title: t("documents"), items: useDocumentMatches(wsId, query, documentsOn && query !== "") },
    { kind: "meeting", title: t("meetings"), items: useMeetingMatches(wsId, query, query !== "") },
    { kind: "project", title: t("projects"), items: useProjectMatches(wsId, query, query !== "") },
  ];
  const groups = all.filter((g) => g.items.length > 0);
  const flat = groups.flatMap((g) => g.items.map((item) => ({ kind: g.kind, id: item.id, label: item.title })));
  const [active, setActive] = useState(0);
  const optionId = (i: number) => `${uid}-${i}`;
  // A new query is a new list; the highlight returns to the top.
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === "Escape") {
        consume();
        onDismiss();
      } else if (flat.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        consume();
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length);
      } else if (flat.length > 0 && (e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        consume();
        const pick = flat[Math.min(active, flat.length - 1)];
        if (pick) onPick(pick);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [inputRef, flat, active, onPick, onDismiss]);

  // The textarea names the highlighted option for assistive tech.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || flat.length === 0) return;
    el.setAttribute("aria-activedescendant", optionId(Math.min(active, flat.length - 1)));
    return () => el.removeAttribute("aria-activedescendant");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputRef, active, flat.length]);

  let index = -1;
  return (
    <div
      role="listbox"
      aria-label={t("list")}
      className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-64 overflow-y-auto rounded-lg bg-surface-raised p-1 text-body shadow-[var(--menu-shadow)] ring-1 ring-surface-border"
    >
      {flat.length === 0 ? <p className="px-2 py-1.5 text-caption text-muted-foreground">{t("empty")}</p> : null}
      {groups.map((g) => (
        <div key={g.kind} role="group" aria-labelledby={`${uid}-${g.kind}`}>
          <p id={`${uid}-${g.kind}`} className="px-2 pt-1.5 pb-0.5 text-caption font-medium text-muted-foreground">
            {g.title}
          </p>
          {g.items.map((item) => {
            index += 1;
            const i = index;
            return (
              // Keys belong to the textarea (aria-activedescendant); the option itself only takes the pointer.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <div
                key={item.id}
                id={optionId(i)}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                // Keep the caret in the textarea while the pointer picks.
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setActive(i)}
                onClick={() => onPick({ kind: g.kind, id: item.id, label: item.title })}
                className={cn("cursor-default truncate rounded-md px-2 py-1.5", i === active && "bg-accent text-accent-foreground")}
              >
                {item.title}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
