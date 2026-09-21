"use client";

import { BarChart3, ChevronLeft, Clock, Megaphone, Pin, Plus, StickyNote, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatRoomMessages } from "@uniwork/core/chat";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
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
  formatBulletinTime,
  type BulletinTab,
} from "./chat-room-bulletin-utils";

const KIND_VISUAL: Record<string, { icon: LucideIcon; tone: IconTileTone }> = {
  note: { icon: StickyNote, tone: "yellow" },
  post: { icon: Megaphone, tone: "orange" },
  reminder: { icon: Clock, tone: "teal" },
  poll: { icon: BarChart3, tone: "blue" },
};

/** Same tint and glyph per kind as the timeline cards; anything else is a pinned message. */
function bulletinKindVisual(kind: string): { icon: LucideIcon; tone: IconTileTone } {
  return KIND_VISUAL[kind] ?? { icon: Pin, tone: "muted" };
}

const EMPTY_KEY: Record<BulletinTab, string> = {
  all: "chat.bulletin_empty_all_window",
  pinned: "chat.bulletin_empty_pinned_window",
  posts: "chat.bulletin_empty_posts_window",
  notes: "chat.bulletin_empty_notes_window",
  polls: "chat.bulletin_empty_polls_window",
  reminders: "chat.bulletin_empty_reminders_window",
};

function BulletinListSkeleton({ label }: { label: string }) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <ul aria-hidden className="space-y-2">
        {[0, 1, 2, 3].map((row) => (
          <li key={row} className="flex items-start gap-3 rounded-xl border border-border px-3 py-3">
            <Skeleton className="size-7 shrink-0 rounded-md" />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-24" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BulletinTabPanel({
  tab,
  rows,
  loading,
  onSelectMessage,
  onClose,
}: {
  tab: BulletinTab;
  rows: ChatMessageRecord[];
  loading: boolean;
  onSelectMessage?: (messageId: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const filtered = useMemo(() => filterBulletinMessages(rows, tab), [rows, tab]);
  const voiceCallLabel = t("chat.sidebar_voice_call_preview");
  if (loading) return <BulletinListSkeleton label={t("chat.bulletin_loading")} />;

  // There is no pinned/bulletin endpoint: this reads the room's loaded
  // messages only, so every empty sentence names the window it looked at.
  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
        <p className="max-w-[40ch] text-body text-pretty text-muted-foreground">
          {rows.length === 0 ? t("chat.bulletin_empty_room") : t(EMPTY_KEY[tab], { count: rows.length })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="space-y-2">
        {filtered.map((item) => {
          const visual = bulletinKindVisual(item.kind);
          const preview = bulletinMessagePreview(item, voiceCallLabel);
          return (
            <li key={item.id}>
              <button
                type="button"
                className="flex w-full items-start gap-3 rounded-xl border border-border px-3 py-3 text-left transition-colors hover:bg-surface-hover"
                onClick={() => {
                  onSelectMessage?.(item.id);
                  onClose();
                }}
              >
                <IconTile icon={visual.icon} tone={visual.tone} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-3 text-body text-foreground">{preview}</span>
                  <time
                    dateTime={item.created_at}
                    className="mt-1 block text-caption text-muted-foreground tabular-nums"
                  >
                    {formatBulletinTime(item.created_at, i18n.language)}
                  </time>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length >= CHAT_MESSAGE_INITIAL ? (
        <p className="text-center text-caption text-muted-foreground">
          {t("chat.bulletin_window_hint", { count: rows.length })}
        </p>
      ) : null}
    </div>
  );
}

// Named "Sheet" for history; it renders a full-screen Dialog on mobile, a centred one on desktop.
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
  const messages = useChatRoomMessages(workspaceId, roomId, CHAT_MESSAGE_INITIAL);
  const rows = useMemo(() => messages.data ?? [], [messages.data]);
  const [tab, setTab] = useState<BulletinTab>(initialTab);
  const [createNoteOpen, setCreateNoteOpen] = useState(false);
  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [createPollOpen, setCreatePollOpen] = useState(false);
  const [createReminderOpen, setCreateReminderOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) setTab(initialTab);
    onOpenChange(next);
  };

  // Viewing never depends on create permission; only the feature switches
  // (polls, reminders) hide a tab. Create rights gate the "New" menu only.
  const tabs: { value: BulletinTab; label: string; hidden?: boolean }[] = [
    { value: "all", label: t("chat.bulletin_tab_all") },
    { value: "pinned", label: t("chat.bulletin_tab_pinned") },
    { value: "posts", label: t("chat.bulletin_tab_posts") },
    { value: "notes", label: t("chat.bulletin_tab_notes") },
    { value: "polls", label: t("chat.bulletin_tab_polls"), hidden: !showPolls },
    { value: "reminders", label: t("chat.bulletin_tab_reminders"), hidden: !showReminders },
  ];

  const createItems: { key: string; kind: string; label: string; onSelect: () => void }[] = [
    ...(showPolls && canCreatePolls
      ? [{ key: "poll", kind: "poll", label: t("chat.bulletin_create_poll"), onSelect: () => setCreatePollOpen(true) }]
      : []),
    ...(canCreateNotes
      ? [
          { key: "post", kind: "post", label: t("chat.bulletin_create_post"), onSelect: () => setCreatePostOpen(true) },
          { key: "note", kind: "note", label: t("chat.bulletin_create_note"), onSelect: () => setCreateNoteOpen(true) },
        ]
      : []),
    ...(showReminders && canCreateNotes
      ? [
          {
            key: "reminder",
            kind: "reminder",
            label: t("chat.bulletin_create_reminder"),
            onSelect: () => setCreateReminderOpen(true),
          },
        ]
      : []),
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
                    "focus-visible:border-x-0 focus-visible:border-t-0",
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
                    loading={messages.isPending}
                    onSelectMessage={onSelectMessage}
                    onClose={() => handleOpenChange(false)}
                  />
                </div>
              </TabsContent>
            ))}
          </Tabs>

          {createItems.length > 0 ? (
            <div className="flex shrink-0 justify-end border-t border-border bg-surface px-4 py-3">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" />}>
                  <Plus aria-hidden />
                  {t("chat.bulletin_create_menu")}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="min-w-48">
                  {createItems.map((item) => {
                    const visual = bulletinKindVisual(item.kind);
                    return (
                      <DropdownMenuItem key={item.key} className="gap-2.5 py-1.5" onClick={item.onSelect}>
                        <IconTile icon={visual.icon} tone={visual.tone} size="xs" />
                        {item.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
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
