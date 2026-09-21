"use client";

import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { useSearchChatRoomMessages } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { describeChatMediaBody } from "./chat-expression-utils";
import { cn } from "@uniwork/ui/lib/utils";

type NameContextEntry = {
  user_id: string;
  display_name: string;
};

function senderLabelFor(
  message: ChatMessageRecord,
  currentUserId: string,
  youLabel: string,
  nameContext: NameContextEntry[],
): string {
  if (message.sender_id === currentUserId) return youLabel;
  const match = nameContext.find((entry) => entry.user_id === message.sender_id);
  return match?.display_name?.trim() || message.sender_display_name?.trim() || message.sender_id;
}

function highlightSnippet(body: string, query: string): ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return body;
  const lowerBody = body.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const index = lowerBody.indexOf(lowerQuery);
  if (index < 0) return body;
  const before = body.slice(0, index);
  const match = body.slice(index, index + trimmed.length);
  const after = body.slice(index + trimmed.length);
  return (
    <>
      {before}
      <mark className="rounded-sm bg-brand-subtle px-0.5 font-medium text-brand-subtle-foreground">{match}</mark>
      {after}
    </>
  );
}

function formatResultTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
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

  const jumpToSelected = () => {
    if (!selected) return;
    onJumpToMessage(selected.id);
    onClose();
  };

  return (
    <div className="border-b border-border bg-surface">
      <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
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
            className="h-8 pl-9"
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
                event.preventDefault();
                jumpToSelected();
              }
            }}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={t("chat.search_prev_result")}
          disabled={textResults.length === 0}
          onClick={() => moveSelection(-1)}
        >
          <ChevronUp aria-hidden className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={t("chat.search_next_result")}
          disabled={textResults.length === 0}
          onClick={() => moveSelection(1)}
        >
          <ChevronDown aria-hidden className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={t("chat.search_close")}
          onClick={onClose}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>

      {debouncedQuery.length >= 2 ? (
        <div className="border-t border-border px-3 py-2 sm:px-4">
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
            <p className="py-1 text-caption text-muted-foreground">{t("chat.search_messages_no_results")}</p>
          ) : (
            <>
              <p className="mb-1.5 text-caption text-muted-foreground tabular-nums" aria-live="polite">
                {t("chat.search_results_count", {
                  current: selectedIndex + 1,
                  total: textResults.length,
                })}
              </p>
              {/* Focus stays in the search field; arrows move the active option
                  (aria-activedescendant), Enter or a click jumps to it. */}
              <ul id={listId} role="listbox" aria-label={t("chat.search_messages")} className="max-h-52 space-y-px overflow-y-auto">
                {textResults.map((message, index) => {
                  const label = senderLabelFor(message, currentUserId, youLabel, nameContext);
                  const jump = () => {
                    setSelectedIndex(index);
                    onJumpToMessage(message.id);
                    onClose();
                  };
                  return (
                    <li
                      key={message.id}
                      id={`${listId}-${message.id}`}
                      role="option"
                      aria-selected={index === selectedIndex}
                      tabIndex={-1}
                      className={cn(
                        "cursor-pointer rounded-md px-3 py-2 transition-colors duration-(--duration-fast) hover:bg-surface-hover",
                        index === selectedIndex && "bg-surface-selected hover:bg-surface-selected",
                      )}
                      onClick={jump}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") jump();
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-caption font-medium text-foreground">{label}</span>
                        <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                          {formatResultTime(message.created_at, i18n.language)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-caption text-muted-foreground">
                        {describeChatMediaBody(message.body, mediaLabels) ??
                          highlightSnippet(message.body, debouncedQuery)}
                      </p>
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
