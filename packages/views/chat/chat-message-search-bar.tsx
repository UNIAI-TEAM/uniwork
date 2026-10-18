"use client";

import { ChevronDown, ChevronUp, Image as ImageIcon, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { useSearchChatRoomMessages } from "@uniwork/core/chat";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { describeChatMediaBody } from "./chat-expression-utils";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";
import { initialsOf } from "./chat-initials";
import { chatPersonFaceClass } from "./chat-person-card";
import { foldVi } from "./chat-search-fold";
import { cn } from "@uniwork/ui/lib/utils";

type NameContextEntry = {
  user_id: string;
  display_name: string;
};

/** The sender's own name, for the avatar's initials; "Bạn" only labels the row. */
function senderNameFor(message: ChatMessageRecord, nameContext: NameContextEntry[]): string {
  const match = nameContext.find((entry) => entry.user_id === message.sender_id);
  return match?.display_name?.trim() || message.sender_display_name?.trim() || message.sender_id;
}

/**
 * The snippet with the match marked. The body is shown the way a person
 * reads it (mentions as @names, not markup), and matched accent-insensitively
 * — "tuan" marks "Tuấn" — by folding each character and keeping where it came
 * from, so the mark lands on the original letters.
 */
function highlightSnippet(rawBody: string, query: string): ReactNode {
  const body = deserializeMessageBodyToComposerDraft(rawBody);
  const folded = foldVi(query.trim());
  if (!folded) return body;
  let hay = "";
  const origin: number[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const piece = foldVi(body[i] ?? "");
    for (let j = 0; j < piece.length; j += 1) origin.push(i);
    hay += piece;
  }
  const at = hay.indexOf(folded);
  if (at < 0) return body;
  const start = origin[at] ?? 0;
  const end = (origin[at + folded.length - 1] ?? start) + 1;
  const before = body.slice(0, start);
  const match = body.slice(start, end);
  const after = body.slice(end);
  return (
    <>
      {before}
      <mark className="rounded-sm bg-tint-yellow px-0.5 font-semibold text-foreground">{match}</mark>
      {after}
    </>
  );
}

/** "16/10 10:05": the day, then the time (canvas), whatever order the locale prefers. */
function formatResultTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  // Vietnamese ICU writes "16-10"; the canvas (and every other chat date) uses a slash.
  const day = date.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }).replace(/\D+/g, "/");
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time}`;
}

/** 44px icon buttons with a 12px radius, as on the canvas search row. */
const SEARCH_ICON_BUTTON = "size-11 shrink-0 rounded-lg text-muted-foreground hover:text-foreground";

export function ChatMessageSearchBar({
  workspaceId,
  roomId,
  currentUserId,
  nameContext,
  youLabel,
  onClose,
  onJumpToMessage,
}: {
  workspaceId: string;
  roomId: string;
  currentUserId: string;
  nameContext: NameContextEntry[];
  youLabel: string;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const listId = useId();
  const mediaLabels = { sticker: t("chat.media_sticker"), gif: t("chat.media_gif"), image: t("chat.media_image") };
  const inputRef = useRef<HTMLInputElement>(null);
  // Where focus was when search opened (the ⌘F target or the header button):
  // closing without a jump puts it back there. A jump hands focus to the
  // message instead.
  const openerRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const jumpedRef = useRef(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const opener = openerRef.current;
    inputRef.current?.focus();
    return () => {
      if (!jumpedRef.current && opener?.isConnected) {
        window.requestAnimationFrame(() => opener.focus());
      }
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [debouncedQuery]);

  const { data: results = [], isFetching } = useSearchChatRoomMessages(
    workspaceId,
    roomId,
    debouncedQuery,
    true,
  );

  const textResults = useMemo(
    () => results.filter((message) => message.kind === "text" || !message.kind),
    [results],
  );

  const selected = textResults[selectedIndex] ?? null;

  const moveSelection = (delta: number) => {
    if (textResults.length === 0) return;
    setSelectedIndex((current) => {
      const next = current + delta;
      if (next < 0) return textResults.length - 1;
      if (next >= textResults.length) return 0;
      return next;
    });
  };

  const jumpTo = (messageId: string) => {
    jumpedRef.current = true;
    onJumpToMessage(messageId);
    onClose();
  };

  const jumpToSelected = () => {
    if (!selected) return;
    jumpTo(selected.id);
  };

  // Arrow keys move the active option from the field; keep it in view.
  useEffect(() => {
    if (!selected) return;
    document.getElementById(`${listId}-${selected.id}`)?.scrollIntoView?.({ block: "nearest" });
  }, [listId, selected]);

  const showResults = debouncedQuery.length >= 2;
  // The position sits inside the field, for the eye; a screen reader already
  // hears the active option through aria-activedescendant, and hears the
  // total once, when the results change.
  const counter =
    showResults && !isFetching && textResults.length > 0
      ? t("chat.search_results_count", { current: selectedIndex + 1, total: textResults.length })
      : null;

  return (
    <div className="shrink-0 border-b border-border bg-surface">
      {/* Under the room header, which stays: a 60px row like the canvas. */}
      <div className="flex h-15 items-center gap-0.5 pr-2 pl-3 sm:pr-3">
        <div className="relative mr-1.5 min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("chat.search_messages_placeholder")}
            aria-label={t("chat.search_messages")}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={textResults.length > 0}
            aria-controls={listId}
            aria-activedescendant={selected ? `${listId}-${selected.id}` : undefined}
            className={cn(
              "h-11 rounded-lg bg-muted pl-10 md:text-body-lg [&::-webkit-search-cancel-button]:appearance-none",
              counter ? "pr-32" : "pr-3",
            )}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveSelection(1);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                moveSelection(-1);
                return;
              }
              if (event.key === "Enter") {
                // Enter that only commits a Vietnamese IME syllable is not a jump.
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                event.preventDefault();
                jumpToSelected();
              }
            }}
          />
          {counter ? (
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-label font-medium text-muted-foreground tabular-nums"
            >
              {counter}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={SEARCH_ICON_BUTTON}
          aria-label={t("chat.search_prev_result")}
          disabled={textResults.length === 0}
          onClick={() => moveSelection(-1)}
        >
          <ChevronUp aria-hidden className="size-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={SEARCH_ICON_BUTTON}
          aria-label={t("chat.search_next_result")}
          disabled={textResults.length === 0}
          onClick={() => moveSelection(1)}
        >
          <ChevronDown aria-hidden className="size-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={SEARCH_ICON_BUTTON}
          aria-label={t("chat.search_close")}
          onClick={onClose}
        >
          <X aria-hidden className="size-5" />
        </Button>
      </div>

      {showResults ? (
        <div className="border-t border-border bg-surface px-2 py-1.5">
          {isFetching ? (
            <div className="space-y-2 py-1" aria-busy>
              <span className="sr-only">{t("chat.search_loading")}</span>
              {["w-3/4", "w-1/2"].map((w) => (
                <div key={w} className="space-y-1.5 px-3 py-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className={cn("h-3", w)} />
                </div>
              ))}
            </div>
          ) : textResults.length === 0 ? (
            <p className="px-2.5 py-2 text-label text-muted-foreground" role="status">
              {t("chat.search_messages_no_results")}
            </p>
          ) : (
            <>
              <p className="sr-only" role="status">
                {t("chat.message_list.search_results_total", { count: textResults.length })}
              </p>
              {/* Focus stays in the search field; arrows move the active option
                  (aria-activedescendant), Enter or a click jumps to it. */}
              <ul id={listId} role="listbox" aria-label={t("chat.search_messages")} className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                {textResults.map((message, index) => {
                  const name = senderNameFor(message, nameContext);
                  const label = message.sender_id === currentUserId ? youLabel : name;
                  const selectedRow = index === selectedIndex;
                  const media = describeChatMediaBody(message.body, mediaLabels);
                  const jump = () => {
                    setSelectedIndex(index);
                    jumpTo(message.id);
                  };
                  return (
                    <li
                      key={message.id}
                      id={`${listId}-${message.id}`}
                      role="option"
                      aria-selected={selectedRow}
                      tabIndex={-1}
                      className={cn(
                        "flex cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-(--duration-fast)",
                        // The active option: the brand wash with a 3px bar inside its left edge (canvas).
                        selectedRow ? "bg-brand-subtle shadow-[inset_3px_0_0_var(--brand)]" : "hover:bg-surface-hover",
                      )}
                      onClick={jump}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") jump();
                      }}
                    >
                      <ActorAvatar
                        name={name}
                        initials={initialsOf(name)}
                        size="lg"
                        className={chatPersonFaceClass(message.sender_id)}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-label font-semibold text-foreground">{label}</span>
                          <span
                            className={cn(
                              "shrink-0 text-caption tabular-nums",
                              selectedRow ? "text-foreground/80" : "text-muted-foreground",
                            )}
                          >
                            {formatResultTime(message.created_at, i18n.language)}
                          </span>
                        </div>
                        {media ? (
                          <p className="flex items-center gap-1.5 text-label text-muted-foreground">
                            <ImageIcon aria-hidden className="size-3.75 shrink-0 text-brand" />
                            {media}
                          </p>
                        ) : (
                          <p
                            className={cn(
                              "line-clamp-2 text-label",
                              selectedRow ? "text-foreground/85" : "text-muted-foreground",
                            )}
                          >
                            {highlightSnippet(message.body, debouncedQuery)}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
