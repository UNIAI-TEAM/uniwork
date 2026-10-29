"use client";

import { Copy, Forward, Trash, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MODULE_ICONS } from "../layout/module-icons";
import { CHAT_CONVERSATION_GUTTER } from "./chat-wall";

/**
 * Replaces the composer while multi-select is active (Telegram Desktop):
 * count + clear on the left, bulk Copy / Create task / Forward / Delete on the right.
 */
export function ChatMessageSelectionBar({
  count,
  canForward,
  canDelete,
  canCreateTask = false,
  busy = false,
  onClear,
  onCopy,
  onForward,
  onDelete,
  onCreateTask,
}: {
  count: number;
  canForward: boolean;
  canDelete: boolean;
  canCreateTask?: boolean;
  busy?: boolean;
  onClear: () => void;
  onCopy: () => void;
  onForward: () => void;
  onDelete: () => void;
  onCreateTask?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="toolbar"
      aria-label={t("chat.selection.toolbar_aria")}
      className={cn(
        "flex shrink-0 items-center gap-2 border-t border-border bg-surface py-2.5",
        CHAT_CONVERSATION_GUTTER,
      )}
    >
      <Button type="button" variant="ghost" size="icon-lg" className="size-10 shrink-0 rounded-full" onClick={onClear} aria-label={t("chat.selection.clear")}>
        <X className="size-5" aria-hidden />
      </Button>
      <p className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
        {t("chat.selection.selected_count", { count })}
      </p>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="size-10 rounded-full"
          disabled={busy || count === 0}
          onClick={onCopy}
          aria-label={t("chat.selection.copy_selected")}
        >
          <Copy className="size-5" aria-hidden />
        </Button>
        {onCreateTask ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="size-10 rounded-full"
            disabled={busy || !canCreateTask}
            onClick={onCreateTask}
            aria-label={t("chat.selection.create_task_selected")}
          >
            <MODULE_ICONS.tasks className="size-5" aria-hidden />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="size-10 rounded-full"
          disabled={busy || !canForward}
          onClick={onForward}
          aria-label={t("chat.selection.forward_selected")}
        >
          <Forward className="size-5" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="size-10 rounded-full text-destructive hover:text-destructive"
          disabled={busy || !canDelete}
          onClick={onDelete}
          aria-label={t("chat.selection.delete_selected")}
        >
          <Trash className="size-5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
