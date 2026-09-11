"use client";

import { BarChart3, ChevronLeft, Clock, Megaphone, Pin, StickyNote } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatRoomMessages } from "@uniwork/core/chat";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { cn } from "@uniwork/ui/lib/utils";
import { ChatCreateNoteDialog } from "./chat-create-note-dialog";
import { ChatCreatePostDialog } from "./chat-create-post-dialog";
import { ChatCreatePollDialog } from "./chat-create-poll-dialog";
import { ChatCreateReminderDialog } from "./chat-create-reminder-dialog";
import { CHAT_MESSAGE_INITIAL } from "./chat-messages";
import {
  bulletinMessagePreview,
  filterBulletinMessages,
  type BulletinTab,
} from "./chat-room-bulletin-utils";

function bulletinKindIcon(kind: string, pinned: boolean) {
  if (pinned && kind === "text") return Pin;
  if (kind === "note") return StickyNote;
  if (kind === "post") return Megaphone;
  if (kind === "poll") return BarChart3;
  if (kind === "reminder") return Clock;
  if (pinned) return Pin;
  return Pin;
}

function BulletinTabPanel({
  tab,
  rows,
  voiceCallLabel,
  emptyLabel,
  onSelectMessage,
  onClose,
}: {
  tab: BulletinTab;
  rows: ChatMessageRecord[];
  voiceCallLabel: string;
  emptyLabel: string;
  onSelectMessage?: (messageId: string) => void;
  onClose: () => void;
}) {
  const filtered = useMemo(() => filterBulletinMessages(rows, tab), [rows, tab]);

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
        <p className="text-body text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {filtered.map((item) => {
        const Icon = bulletinKindIcon(item.kind, Boolean(item.pinned));
        const preview = bulletinMessagePreview(item, voiceCallLabel);
        return (
          <li key={item.id}>
            <button
              type="button"
              className={cn(
                "flex w-full items-start gap-3 rounded-xl border border-border px-3 py-3 text-left",
                "transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
              )}
              onClick={() => {
                onSelectMessage?.(item.id);
                onClose();
              }}
            >
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-3 text-body text-foreground">{preview}</span>
                <span className="mt-1 block text-caption text-muted-foreground">
                  {new Date(item.created_at).toLocaleString()}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ChatRoomBulletinSheet({
  open,
  onOpenChange,
  workspaceId,
  roomId,
  title,
  canCreateNotes = true,
  canCreatePolls = true,
  canPinMessages = false,
  showPolls = true,
  showReminders = true,
  initialTab = "all",
  onSelectMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  roomId: string;
  title: string;
  canCreateNotes?: boolean;
  canCreatePolls?: boolean;
  canPinMessages?: boolean;
  showPolls?: boolean;
  showReminders?: boolean;
  initialTab?: BulletinTab;
  onSelectMessage?: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const { data: rows = [] } = useChatRoomMessages(workspaceId, roomId, CHAT_MESSAGE_INITIAL);
  const [tab, setTab] = useState<BulletinTab>(initialTab);
  const [createNoteOpen, setCreateNoteOpen] = useState(false);
  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [createPollOpen, setCreatePollOpen] = useState(false);
  const [createReminderOpen, setCreateReminderOpen] = useState(false);

  const voiceCallLabel = t("chat.sidebar_voice_call_preview");

  const handleOpenChange = (next: boolean) => {
    if (!next) setTab(initialTab);
    onOpenChange(next);
  };

  const tabs: { value: BulletinTab; label: string; hidden?: boolean }[] = [
    { value: "all", label: t("chat.bulletin_tab_all") },
    { value: "pinned", label: t("chat.bulletin_tab_pinned") },
    { value: "posts", label: t("chat.bulletin_tab_posts"), hidden: !canCreateNotes },
    { value: "notes", label: t("chat.bulletin_tab_notes"), hidden: !canCreateNotes },
    { value: "polls", label: t("chat.bulletin_tab_polls"), hidden: !showPolls || !canCreatePolls },
    {
      value: "reminders",
      label: t("chat.bulletin_tab_reminders"),
      hidden: !showReminders || !canCreateNotes,
    },
  ];

  const visibleTabs = tabs.filter((entry) => !entry.hidden);

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[100dvh] max-h-[100dvh] w-full max-w-full flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[min(720px,92vh)] sm:max-w-2xl sm:rounded-xl"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t("chat.bulletin_sheet_description")}</DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 border-b border-border px-2 py-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-9 shrink-0"
              aria-label={t("chat.bulletin_back")}
              onClick={() => handleOpenChange(false)}
            >
              <ChevronLeft className="size-5" aria-hidden />
            </Button>
            <h2 className="min-w-0 flex-1 truncate text-center text-body font-semibold text-foreground">
              {title}
            </h2>
            <span className="size-9 shrink-0" aria-hidden />
          </div>

          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as BulletinTab)}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <TabsList
              variant="line"
              className="flex h-auto w-full shrink-0 gap-0 rounded-none border-b border-border bg-transparent px-1 sm:px-2"
            >
              {visibleTabs.map((entry) => (
                <TabsTrigger
                  key={entry.value}
                  value={entry.value}
                  className={cn(
                    "min-w-0 flex-1 rounded-none border-x-0 border-t-0 border-b-2 border-solid border-transparent bg-transparent px-1 pb-3 text-caption text-muted-foreground shadow-none -mb-px",
                    "data-active:border-x-0 data-active:border-t-0 data-active:border-b-foreground data-active:bg-transparent data-active:font-medium data-active:text-foreground data-active:shadow-none",
                    "dark:data-active:border-x-0 dark:data-active:border-t-0 dark:data-active:border-b-foreground dark:data-active:bg-transparent",
                    "focus-visible:border-x-0 focus-visible:border-t-0 focus-visible:ring-0 focus-visible:outline-none",
                    "after:hidden sm:px-2 sm:text-body",
                  )}
                >
                  <span className="block truncate">{entry.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {visibleTabs.map((entry) => (
              <TabsContent
                key={entry.value}
                value={entry.value}
                className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  <BulletinTabPanel
                    tab={entry.value}
                    rows={rows}
                    voiceCallLabel={voiceCallLabel}
                    emptyLabel={t("chat.bulletin_empty")}
                    onSelectMessage={onSelectMessage}
                    onClose={() => handleOpenChange(false)}
                  />
                </div>
              </TabsContent>
            ))}
          </Tabs>

          {(canCreateNotes || (showPolls && canCreatePolls)) && (
            <div className="shrink-0 space-y-2 border-t border-border bg-surface px-4 py-4">
              {showPolls && canCreatePolls ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full justify-center gap-2 rounded-xl border-brand/30 bg-brand/5 text-brand hover:bg-brand/10"
                  onClick={() => setCreatePollOpen(true)}
                >
                  <BarChart3 className="size-4" aria-hidden />
                  {t("chat.bulletin_create_poll")}
                </Button>
              ) : null}
              {canCreateNotes ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full justify-center gap-2 rounded-xl border-brand/30 bg-brand/5 text-brand hover:bg-brand/10"
                  onClick={() => setCreatePostOpen(true)}
                >
                  <Megaphone className="size-4" aria-hidden />
                  {t("chat.bulletin_create_post")}
                </Button>
              ) : null}
              {canCreateNotes ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full justify-center gap-2 rounded-xl border-brand/30 bg-brand/5 text-brand hover:bg-brand/10"
                  onClick={() => setCreateNoteOpen(true)}
                >
                  <StickyNote className="size-4" aria-hidden />
                  {t("chat.bulletin_create_note")}
                </Button>
              ) : null}
              {showReminders && canCreateNotes ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full justify-center gap-2 rounded-xl border-brand/30 bg-brand/5 text-brand hover:bg-brand/10"
                  onClick={() => setCreateReminderOpen(true)}
                >
                  <Clock className="size-4" aria-hidden />
                  {t("chat.bulletin_create_reminder")}
                </Button>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ChatCreateNoteDialog
        open={createNoteOpen}
        onOpenChange={setCreateNoteOpen}
        workspaceId={workspaceId}
        roomId={roomId}
        canPinToTop={canPinMessages}
      />
      <ChatCreatePostDialog
        open={createPostOpen}
        onOpenChange={setCreatePostOpen}
        workspaceId={workspaceId}
        roomId={roomId}
        canPinToTop={canPinMessages}
      />
      {showPolls ? (
        <ChatCreatePollDialog
          open={createPollOpen}
          onOpenChange={setCreatePollOpen}
          workspaceId={workspaceId}
          roomId={roomId}
        />
      ) : null}
      {showReminders ? (
        <ChatCreateReminderDialog
          open={createReminderOpen}
          onOpenChange={setCreateReminderOpen}
          workspaceId={workspaceId}
          roomId={roomId}
        />
      ) : null}
    </>
  );
}
