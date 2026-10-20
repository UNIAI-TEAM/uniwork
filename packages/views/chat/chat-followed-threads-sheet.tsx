"use client";

import { CircleAlert, MessagesSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatThreadRecord } from "@uniwork/core/api/endpoints/chat";
import { useFollowedChatThreads } from "@uniwork/core/chat";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@uniwork/ui/components/ui/empty";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice } from "../common/notice";
import { CHAT_EMPTY_TILE_CLASS, CHAT_EMPTY_TITLE_CLASS, CHAT_SHEET_CLASS, CHAT_SHEET_HEADER_CLASS } from "./chat-dialog-look";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";

function threadPreviewBody(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  return deserializeMessageBodyToComposerDraft(text);
}

/** Threads the caller follows in this workspace (spec: "Thread của tôi"). */
export function ChatFollowedThreadsSheet({
  open,
  onOpenChange,
  workspaceId,
  onOpenThread,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onOpenThread: (thread: ChatThreadRecord) => void;
}) {
  const { t } = useTranslation();
  const { data: threads = [], isLoading, isError, refetch } = useFollowedChatThreads(workspaceId, false, open);

  const body = (() => {
    if (isLoading) {
      return (
        <div className="flex flex-col gap-2 px-4 pb-4">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      );
    }
    if (isError) {
      return (
        <div className="px-4 pb-4">
          <Notice
            tone="destructive"
            icon={CircleAlert}
            layout="inline"
            live="assertive"
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8.5 rounded-full px-3.5 font-semibold"
                onClick={() => void refetch()}
              >
                {t("common.retry")}
              </Button>
            }
          >
            {t("chat.followed_threads.load_failed")}
          </Notice>
        </div>
      );
    }
    if (threads.length === 0) {
      return (
        <Empty className="border-none py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon" className={CHAT_EMPTY_TILE_CLASS}>
              <MessagesSquare aria-hidden />
            </EmptyMedia>
            <EmptyTitle className={CHAT_EMPTY_TITLE_CLASS}>{t("chat.followed_threads.empty")}</EmptyTitle>
            <EmptyDescription>{t("chat.followed_threads.empty_hint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }
    return (
      <ul className="flex flex-col gap-1 px-2 pb-4">
        {threads.map((thread) => {
          const preview = threadPreviewBody(thread.root_body);
          return (
            <li key={thread.thread_root_id}>
              <button
                type="button"
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left hover:bg-surface-hover",
                  thread.unread && "bg-brand-subtle/40",
                )}
                onClick={() => {
                  onOpenThread(thread);
                  onOpenChange(false);
                }}
              >
                <span className="line-clamp-2 text-body text-foreground">{preview || t("chat.followed_threads.untitled")}</span>
                <span className="flex items-center gap-2 text-caption text-muted-foreground">
                  {t("chat.followed_threads.reply_count", { count: thread.reply_count })}
                  {thread.unread ? (
                    <span className="size-2 shrink-0 rounded-full bg-brand" aria-label={t("chat.followed_threads.unread_aria")} />
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  })();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={CHAT_SHEET_CLASS} side="right">
        <SheetHeader className={CHAT_SHEET_HEADER_CLASS}>
          <SheetTitle>{t("chat.followed_threads.list_title")}</SheetTitle>
          <SheetDescription>{t("chat.followed_threads.list_description")}</SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}
