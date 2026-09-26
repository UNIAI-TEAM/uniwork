"use client";

import {
  Archive,
  ArrowLeft,
  CalendarClock,
  Clock,
  Inbox,
  MailOpen,
  MoreHorizontal,
  Reply,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { EmailHubIconAction } from "./email-hub-list-header";

export type EmailHubSnoozePreset = "tomorrow" | "next_week" | "custom";

export interface EmailHubThreadActions {
  onBack: () => void;
  onToggleStar: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onMarkUnread: () => void;
  onRestoreInbox: () => void;
  onNotSpam: () => void;
  onArchive: () => void;
  onSpam: () => void;
  onTrash: () => void;
  onClearSnooze: () => void;
  onSnooze: (preset: EmailHubSnoozePreset) => void;
  onToggleAi: () => void;
  onRefetch: () => void;
  onDownloadAttachment: (att: { id: string; filename?: string }) => void;
}

export interface EmailHubThreadPending {
  star: boolean;
  move: boolean;
  markRead: boolean;
  snooze: boolean;
  download: boolean;
}

/** What a thread in a given folder can do. One place, so the toolbar and the shortcuts agree. */
export function emailHubThreadCapabilities(thread: EmailHubThread, browserFolder: string) {
  const folder = thread.folder;
  const inSpam = browserFolder === "SPAM" || folder === "SPAM";
  return {
    canReply: !inSpam && (folder === "INBOX" || folder === "SENT" || folder === "ARCHIVE"),
    canReplyAll: folder === "INBOX" || folder === "ARCHIVE",
    canTriage: folder === "INBOX",
    canTrash: folder === "INBOX" || folder === "SENT",
    canMarkUnread: folder === "INBOX" && thread.is_read,
    canRestore: folder === "TRASH" || folder === "ARCHIVE",
    snoozed: folder === "SNOOZED" || !!thread.snoozed_until,
    inSpam,
  };
}

function ToolbarDivider() {
  return <Separator orientation="vertical" className="mx-1 h-5" />;
}

/**
 * Below `sm` the triage actions live in one "more" menu: nine 44px targets
 * do not fit a 375px phone, and the overflow pushed Reply and the AI toggle
 * off the screen.
 */
function TriageOverflowMenu({
  can,
  actions,
  pending,
}: {
  can: ReturnType<typeof emailHubThreadCapabilities>;
  actions: EmailHubThreadActions;
  pending: EmailHubThreadPending;
}) {
  const { t } = useTranslation();
  if (!can.canTriage && !can.canTrash) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="text-muted-foreground hover:text-foreground sm:hidden"
            aria-label={t("email_hub.more_actions")}
          />
        }
      >
        <MoreHorizontal className="size-4.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {can.canTriage ? (
          <DropdownMenuItem disabled={pending.move} onClick={actions.onArchive}>
            <Archive aria-hidden />
            {t("email_hub.archive")}
          </DropdownMenuItem>
        ) : null}
        {can.canTriage ? (
          <DropdownMenuItem disabled={pending.move} onClick={actions.onSpam}>
            <ShieldAlert aria-hidden />
            {t("email_hub.report_spam")}
          </DropdownMenuItem>
        ) : null}
        {can.canTrash ? (
          <DropdownMenuItem variant="destructive" disabled={pending.move} onClick={actions.onTrash}>
            <Trash2 aria-hidden />
            {t("email_hub.trash")}
          </DropdownMenuItem>
        ) : null}
        {can.canMarkUnread ? (
          <DropdownMenuItem disabled={pending.markRead} onClick={actions.onMarkUnread}>
            <MailOpen aria-hidden />
            {t("email_hub.bulk.mark_unread")}
          </DropdownMenuItem>
        ) : null}
        {can.canTriage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("email_hub.snooze.action")}</DropdownMenuLabel>
              <DropdownMenuItem disabled={pending.snooze} onClick={() => actions.onSnooze("tomorrow")}>
                <Clock aria-hidden />
                {t("email_hub.snooze.tomorrow")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={pending.snooze} onClick={() => actions.onSnooze("next_week")}>
                <Clock aria-hidden />
                {t("email_hub.snooze.next_week")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={pending.snooze} onClick={() => actions.onSnooze("custom")}>
                <CalendarClock aria-hidden />
                {t("email_hub.snooze.custom")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The reading pane's action bar. Eleven labelled buttons used to wrap into four
 * rows beside the subject and squeeze it into a narrow column; the triage
 * actions are now icons with names and shortcuts in their tooltips, and the
 * one state-changing primary (reply, restore, not spam…) keeps its label.
 */
export function EmailHubThreadToolbar({
  thread,
  browserFolder,
  actions,
  pending,
  aiOpen,
}: {
  thread: EmailHubThread;
  browserFolder: string;
  actions: EmailHubThreadActions;
  pending: EmailHubThreadPending;
  aiOpen: boolean;
}) {
  const { t } = useTranslation();
  const can = emailHubThreadCapabilities(thread, browserFolder);

  const primary = can.inSpam
    ? { label: t("email_hub.not_spam"), icon: Inbox, onClick: actions.onNotSpam, disabled: pending.move }
    : can.snoozed
      ? { label: t("email_hub.snooze.unsnooze"), icon: Inbox, onClick: actions.onClearSnooze, disabled: pending.snooze }
      : can.canRestore
        ? { label: t("email_hub.restore_inbox"), icon: Inbox, onClick: actions.onRestoreInbox, disabled: pending.move }
        : can.canReply
          ? { label: t("email_hub.reply"), icon: Reply, onClick: actions.onReply, disabled: false }
          : null;

  return (
    <div
      className="flex shrink-0 items-center gap-0.5 border-b border-border px-2 py-1.5 lg:px-3"
      role="toolbar"
      aria-label={t("email_hub.thread_toolbar")}
    >
      <EmailHubIconAction icon={ArrowLeft} label={t("email_hub.back_to_list_shortcut")} onClick={actions.onBack} />
      <ToolbarDivider />
      <TriageOverflowMenu can={can} actions={actions} pending={pending} />

      <div className="hidden items-center gap-0.5 sm:flex">
        {can.canTriage ? (
          <>
            <EmailHubIconAction
              icon={Archive}
              label={t("email_hub.archive_shortcut")}
              disabled={pending.move}
              onClick={actions.onArchive}
            />
            <EmailHubIconAction
              icon={ShieldAlert}
              label={t("email_hub.report_spam")}
              disabled={pending.move}
              onClick={actions.onSpam}
            />
          </>
        ) : null}
        {can.canTrash ? (
          <EmailHubIconAction
            icon={Trash2}
            label={t("email_hub.trash_shortcut")}
            disabled={pending.move}
            className="hover:text-destructive"
            onClick={actions.onTrash}
          />
        ) : null}
        {can.canTriage ? (
          <>
            <ToolbarDivider />
            {can.canMarkUnread ? (
              <EmailHubIconAction
                icon={MailOpen}
                label={t("email_hub.mark_unread_shortcut")}
                disabled={pending.markRead}
                onClick={actions.onMarkUnread}
              />
            ) : null}
            <DropdownMenu>
              <Tooltip>
                <DropdownMenuTrigger
                  disabled={pending.snooze}
                  render={
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-lg"
                          className="text-muted-foreground hover:text-foreground"
                          aria-haspopup="menu"
                          aria-label={t("email_hub.snooze.action")}
                        />
                      }
                    />
                  }
                >
                  <Clock className="size-4.5" aria-hidden />
                </DropdownMenuTrigger>
                <TooltipContent>{t("email_hub.snooze.action")}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="min-w-52">
                <DropdownMenuItem onClick={() => actions.onSnooze("tomorrow")}>
                  {t("email_hub.snooze.tomorrow")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onSnooze("next_week")}>
                  {t("email_hub.snooze.next_week")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => actions.onSnooze("custom")}>
                  <CalendarClock aria-hidden />
                  {t("email_hub.snooze.custom")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className={cn(
                  thread.is_starred ? "text-warning hover:text-warning" : "text-muted-foreground hover:text-foreground",
                )}
                aria-label={t("email_hub.star_shortcut")}
                aria-pressed={thread.is_starred}
                disabled={pending.star}
                onClick={actions.onToggleStar}
              />
            }
          >
            <Star className={cn("size-4.5", thread.is_starred && "fill-current")} aria-hidden />
          </TooltipTrigger>
          <TooltipContent>{thread.is_starred ? t("email_hub.unstar") : t("email_hub.star")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant={aiOpen ? "brandSubtle" : "ghost"}
                size="icon-lg"
                className={cn(!aiOpen && "text-muted-foreground hover:text-foreground")}
                aria-label={t("email_hub.ai_title")}
                aria-pressed={aiOpen}
                onClick={actions.onToggleAi}
              />
            }
          >
            <Sparkles className="size-4.5" aria-hidden />
          </TooltipTrigger>
          <TooltipContent>{t("email_hub.ai_title")}</TooltipContent>
        </Tooltip>
        {primary ? (
          <Button
            type="button"
            variant="brand"
            size="lg"
            className="ml-1"
            disabled={primary.disabled}
            onClick={primary.onClick}
          >
            <primary.icon aria-hidden />
            <span className="hidden sm:inline">{primary.label}</span>
            <span className="sr-only sm:hidden">{primary.label}</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
