"use client";

import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { useSearchChatRoomMessages } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
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
      <mark className="rounded-sm bg-brand/20 px-0.5 text-foreground">{match}</mark>
      {after}
    </>
  );
}

function formatResultTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
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
  const { t } = useTranslation();
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
            className="pl-9"
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
          className="shrink-0 rounded-full"
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
          className="shrink-0 rounded-full"
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
          className="shrink-0 rounded-full"
          aria-label={t("chat.search_close")}
          onClick={onClose}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>

      {debouncedQuery.length >= 2 ? (
        <div className="border-t border-border px-3 py-2 sm:px-4">
          {isFetching ? (
            <p className="text-caption text-muted-foreground">{t("chat.search_loading")}</p>
          ) : textResults.length === 0 ? (
            <p className="text-caption text-muted-foreground">{t("chat.search_messages_no_results")}</p>
          ) : (
            <>
              <p className="mb-2 text-caption text-muted-foreground">
                {t("chat.search_results_count", {
                  current: selectedIndex + 1,
                  total: textResults.length,
                })}
              </p>
              <ul className="max-h-52 space-y-1 overflow-y-auto">
                {textResults.map((message, index) => {
                  const label = senderLabelFor(message, currentUserId, youLabel, nameContext);
                  return (
                    <li key={message.id}>
                      <button
                        type="button"
                        className={cn(
                          "w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-muted",
                          index === selectedIndex && "bg-muted ring-1 ring-border",
                        )}
                        onClick={() => {
                          setSelectedIndex(index);
                          onJumpToMessage(message.id);
                          onClose();
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-caption font-medium text-foreground">
                            {label}
                          </span>
                          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                            {formatResultTime(message.created_at)}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-caption text-muted-foreground">
                          {highlightSnippet(message.body, debouncedQuery)}
                        </p>
                      </button>
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
