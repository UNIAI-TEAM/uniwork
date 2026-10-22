"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useAiConversations,
  useAiPanelStore,
  useDeleteAiConversation,
  useRenameAiConversation,
} from "@uniwork/core/ai";
import type { AiConversation } from "@uniwork/core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";
import { formatConversationTime, groupConversations } from "./ask-uni-history-groups";

const TITLE_MAX = 80;
const SEARCH_MIN_RUNES = 2;
const SEARCH_MAX_RUNES = 100;
const SEARCH_DEBOUNCE_MS = 200;
const ACTION_CLASS =
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100";

/** The server wants 2..100 runes after trim; a shorter input shows the plain list. */
function searchQuery(raw: string): string | undefined {
  const runes = Array.from(raw.trim());
  return runes.length >= SEARCH_MIN_RUNES ? runes.slice(0, SEARCH_MAX_RUNES).join("") : undefined;
}

function RenameField({ conversation, onDone }: { conversation: AiConversation; onDone: () => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const { workspace } = useWorkspace();
  const rename = useRenameAiConversation(workspace.id);
  const [value, setValue] = useState(conversation.title);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // An IME commits its syllable on Enter; that keydown must not save.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDone();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rename.isPending) return;
      const title = value.trim();
      if (!title || title === conversation.title) return onDone();
      rename.mutate({ conversationId: conversation.id, title }, { onSettled: onDone });
    }
  };
  return (
    <Input
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      aria-label={t("rename_conversation")}
      value={value}
      maxLength={TITLE_MAX}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      className="h-8"
    />
  );
}

/** The conversation title as a button that opens the history: pick, rename inline, delete after a confirmation. */
export function AskUniHistory({ title }: { title: string }) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "ai" });
  const { workspace } = useWorkspace();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);
  // Under the minimum the plain list shows at once; only a real query waits for the debounce.
  const q = searchQuery(search) === undefined ? undefined : searchQuery(debounced);
  const conversations = useAiConversations(workspace.id, true, q);
  const remove = useDeleteAiConversation(workspace.id);
  const activeId = useAiPanelStore((s) => s.conversationId);
  const select = useAiPanelStore((s) => s.select);
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AiConversation | null>(null);
  const items = conversations.data ?? [];
  const now = new Date();
  const groups = groupConversations(items, now);
  const loadingSearch = q !== undefined && conversations.isPending && items.length === 0;
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setRenamingId(null);
            setSearch("");
            setDebounced("");
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-w-0 max-w-full justify-start gap-1 px-2 text-title"
              aria-label={t("history_with", { title })}
            />
          }
        >
          <span className="truncate">{title}</span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" aria-label={t("history")} className="w-80 gap-1 p-1">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("history_search")}
            aria-label={t("history_search")}
            className="h-8"
          />
          {conversations.isError ? (
            <div role="alert" className="flex items-center justify-between gap-2 px-2 py-3 text-caption text-muted-foreground">
              <span>{t("history_error")}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => void conversations.refetch()}>
                {t("history_retry")}
              </Button>
            </div>
          ) : loadingSearch ? (
            <div className="flex justify-center py-3">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <p className="px-2 py-3 text-caption text-muted-foreground">
              {q !== undefined ? t("history_no_match") : t("history_empty")}
            </p>
          ) : (
            <div aria-label={t("history")} role="group" className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {groups.map((g) => (
                <section key={g.key} className="flex flex-col gap-0.5">
                  <h3 className="px-2 pt-1 text-caption text-muted-foreground">{t(`history_group.${g.key}`)}</h3>
                  <ul className="flex flex-col gap-0.5">
                    {g.items.map((c) => (
                      <li key={c.id} className="group flex items-center gap-0.5">
                        {renamingId === c.id ? (
                          <div className="flex-1 p-0.5">
                            <RenameField conversation={c} onDone={() => setRenamingId(null)} />
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              aria-current={c.id === activeId ? "true" : undefined}
                              className={cn(
                                "flex min-w-0 flex-1 items-center gap-2 rounded-control px-2 py-2 text-left text-body hover:bg-surface-hover pointer-coarse:min-h-11",
                                c.id === activeId && "border-l-2 border-primary bg-surface-selected text-surface-selected-foreground",
                              )}
                              onClick={() => {
                                select(c.id);
                                setOpen(false);
                              }}
                            >
                              <span className="min-w-0 flex-1 truncate">{c.title || t("untitled")}</span>
                              {c.id === activeId ? <span className="sr-only">{t("history_current")}</span> : null}
                              <span className="shrink-0 text-caption text-muted-foreground">
                                {formatConversationTime(c.updated_at, now, i18n.language)}
                              </span>
                            </button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className={ACTION_CLASS}
                              aria-label={t("rename_conversation")}
                              onClick={() => setRenamingId(c.id)}
                            >
                              <Pencil aria-hidden className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className={ACTION_CLASS}
                              aria-label={t("delete_conversation")}
                              onClick={() => setDeleting(c)}
                            >
                              <Trash2 aria-hidden className="size-3.5" />
                            </Button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {/* Outside the popover: its content unmounts when the dialog takes focus. */}
      <AlertDialog open={deleting !== null} onOpenChange={(next) => !next && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("delete_confirm_description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>{t("delete_cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                const id = deleting.id;
                remove.mutate(id, {
                  onSuccess: () => {
                    if (useAiPanelStore.getState().conversationId === id) select(null);
                    setDeleting(null);
                  },
                });
              }}
            >
              {t("delete_confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
