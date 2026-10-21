"use client";

import { useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Pencil, Trash2 } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";

const TITLE_MAX = 80;

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
      const title = value.trim();
      if (!title || title === conversation.title) return onDone();
      rename.mutate({ conversationId: conversation.id, title }, { onSettled: onDone });
    }
  };
  return (
    <Input
      autoFocus
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
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const { workspace } = useWorkspace();
  const conversations = useAiConversations(workspace.id);
  const remove = useDeleteAiConversation(workspace.id);
  const activeId = useAiPanelStore((s) => s.conversationId);
  const select = useAiPanelStore((s) => s.select);
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AiConversation | null>(null);
  const items = conversations.data ?? [];
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button type="button" variant="ghost" size="sm" className="min-w-0 max-w-full justify-start gap-1 px-2 text-title" />
          }
        >
          <span className="truncate">{title}</span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 gap-1 p-1">
          {items.length === 0 ? (
            <p className="px-2 py-3 text-caption text-muted-foreground">{t("history_empty")}</p>
          ) : (
            <ul aria-label={t("history")} className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
              {items.map((c) => (
                <li key={c.id} className="flex items-center gap-0.5">
                  {renamingId === c.id ? (
                    <div className="flex-1 p-0.5">
                      <RenameField conversation={c} onDone={() => setRenamingId(null)} />
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-2 rounded-control px-2 py-2 text-left text-body hover:bg-surface-hover pointer-coarse:min-h-11",
                          c.id === activeId && "bg-surface-selected text-surface-selected-foreground",
                        )}
                        onClick={() => {
                          select(c.id);
                          setOpen(false);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{c.title || t("untitled")}</span>
                        {c.id === activeId ? <Check aria-hidden className="size-3.5 shrink-0" /> : null}
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("rename_conversation")}
                        onClick={() => setRenamingId(c.id)}
                      >
                        <Pencil aria-hidden className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
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
