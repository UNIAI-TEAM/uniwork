"use client";

import { Check, ListTodo, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatFollowUpRecord } from "@uniwork/core/api/endpoints/chat";
import { useChatFollowUps } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";

function followUpRoomLabel(
  item: ChatFollowUpRecord,
  t: (key: string) => string,
): string {
  switch (item.room_kind) {
    case "workspace":
      return t("chat.workspace_room");
    case "dm":
      return item.peer_display_name.trim() || item.room_name.trim() || t("chat.follow_up.unknown_room");
    case "channel": {
      const name = item.room_name.trim().replace(/^#/, "");
      if (!name) return t("chat.follow_up.unknown_room");
      return item.room_visibility === "private" ? name : `#${name}`;
    }
    case "group":
      return item.room_name.trim() || t("chat.follow_up.unknown_room");
    default:
      return (
        item.room_name.trim() ||
        item.peer_display_name.trim() ||
        t("chat.follow_up.unknown_room")
      );
  }
}

function followUpMessagePreview(
  item: ChatFollowUpRecord,
  t: (key: string) => string,
): string {
  const body = item.message_body.trim();
  if (!body) return t("chat.follow_up.message_missing");
  const sender = item.message_sender_name.trim();
  return sender ? `${sender}: ${body}` : body;
}

/** Personal FollowUps list for the workspace (open items by default). */
export function ChatFollowUpsSheet({
  open,
  onOpenChange,
  workspaceId,
  onComplete,
  onConvert,
  onDelete,
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onComplete: (followUpId: string) => void;
  onConvert: (followUpId: string) => void;
  onDelete: (followUpId: string) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const { data: followUps = [], isLoading, isError, refetch } = useChatFollowUps(
    workspaceId,
    { include_completed: false, limit: 50 },
    open,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>{t("chat.follow_up.list_title")}</SheetTitle>
          <SheetDescription>{t("chat.follow_up.list_description")}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <p className="px-1 text-caption text-muted-foreground">{t("chat.follow_up.loading")}</p>
          ) : null}
          {isError ? (
            <div className="flex flex-col gap-2 px-1">
              <p className="text-caption text-destructive">{t("chat.follow_up.load_failed")}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                {t("chat.retry")}
              </Button>
            </div>
          ) : null}
          {!isLoading && !isError && followUps.length === 0 ? (
            <p className="px-1 text-caption text-muted-foreground">{t("chat.follow_up.empty")}</p>
          ) : null}
          <ul className="space-y-2">
            {followUps.map((item) => {
              const roomLabel = followUpRoomLabel(item, t);
              const preview = followUpMessagePreview(item, t);
              const note = item.note.trim();
              return (
                <li
                  key={item.id}
                  className="rounded-md border border-border bg-surface px-3 py-2"
                >
                  <p className="truncate text-caption text-muted-foreground">{roomLabel}</p>
                  <p className="mt-0.5 line-clamp-2 text-body text-foreground">{preview}</p>
                  {note ? (
                    <p className="mt-1 truncate text-caption text-muted-foreground">
                      {t("chat.follow_up.note", { note })}
                    </p>
                  ) : null}
                  <p className="mt-0.5 truncate text-caption text-muted-foreground">
                    {item.due_at
                      ? t("chat.follow_up.due", { date: item.due_at.slice(0, 10) })
                      : t("chat.follow_up.no_due")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-2"
                      disabled={busy}
                      onClick={() => onComplete(item.id)}
                    >
                      <Check className="size-3.5" aria-hidden />
                      {t("chat.follow_up.complete")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-2"
                      disabled={busy}
                      onClick={() => onConvert(item.id)}
                    >
                      <ListTodo className="size-3.5" aria-hidden />
                      {t("chat.follow_up.convert")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-2 text-destructive"
                      disabled={busy}
                      onClick={() => onDelete(item.id)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                      {t("chat.follow_up.delete")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
