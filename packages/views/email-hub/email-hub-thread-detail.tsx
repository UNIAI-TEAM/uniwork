"use client";

import {
  Archive,
  ArrowLeft,
  Forward,
  Inbox,
  MailOpen,
  Reply,
  ReplyAll,
  Clock,
  Send,
  ShieldAlert,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubAttachment, EmailHubThread } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import {
  AttachmentList,
  EmailHtmlFrame,
  EmailSenderAvatar,
  formatWhen,
} from "./email-hub-view-parts";
import { emailHubToolbarShellClass } from "./email-hub-ui";

interface EmailHubThreadDetailProps {
  activeThread: EmailHubThread;
  /** Sidebar folder the user is browsing (may differ from cached thread.folder briefly). */
  browserFolder: string;
  accountId: string;
  selectedId: string;
  detailData?: EmailHubThread | null;
  readableBody: boolean;
  bodyLoading: boolean;
  bodyLoadFailed: boolean;
  isError: boolean;
  starPending: boolean;
  movePending: boolean;
  snoozePending: boolean;
  markReadPending: boolean;
  downloadPending: boolean;
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
  onSnoozeTomorrow: () => void;
  onSnoozeNextWeek: () => void;
  onClearSnooze: () => void;
  onTrash: () => void;
  onRefetch: () => void;
  onDownloadAttachment: (att: EmailHubAttachment) => void;
}

export function EmailHubThreadDetail({
  activeThread,
  browserFolder,
  accountId,
  selectedId,
  detailData,
  readableBody,
  bodyLoading,
  bodyLoadFailed,
  isError,
  starPending,
  movePending,
  snoozePending,
  markReadPending,
  downloadPending,
  onBack,
  onToggleStar,
  onReply,
  onReplyAll,
  onForward,
  onMarkUnread,
  onRestoreInbox,
  onNotSpam,
  onArchive,
  onSpam,
  onSnoozeTomorrow,
  onSnoozeNextWeek,
  onClearSnooze,
  onTrash,
  onRefetch,
  onDownloadAttachment,
}: EmailHubThreadDetailProps) {
  const { t } = useTranslation();
  const senderLabel = activeThread.from_name
    ? `${activeThread.from_name} <${activeThread.from_addr}>`
    : activeThread.from_addr;
  const folder = activeThread.folder;
  const inSpamView = browserFolder === "SPAM" || folder === "SPAM";
  const canReply = folder === "INBOX" || folder === "SENT";
  const canRestore = folder === "TRASH" || folder === "ARCHIVE";
  const labelChips = activeThread.imap_labels?.slice(0, 4) ?? [];

  return (
    <article className="flex h-full w-full min-w-0 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit gap-1.5 text-muted-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
          {t("email_hub.back_to_list")}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <header className="shrink-0 border-b border-border px-4 py-4 lg:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <EmailSenderAvatar fromName={activeThread.from_name} fromAddr={activeThread.from_addr} />
              <div className="min-w-0 space-y-1">
                <h1 className="text-title font-semibold leading-snug">
                  {activeThread.subject || t("email_hub.no_subject")}
                </h1>
                <p className="text-body text-muted-foreground">
                  {t("email_hub.from")}: <span className="text-foreground">{senderLabel}</span>
                </p>
                <p className="text-caption text-muted-foreground">{formatWhen(activeThread.sent_at)}</p>
                {labelChips.length > 0 ? (
                  <ul className="flex flex-wrap gap-1 pt-1">
                    {labelChips.map((label) => (
                      <li
                        key={label}
                        className="rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-caption text-muted-foreground"
                      >
                        {label}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            <div className={emailHubToolbarShellClass}>
              {accountId && selectedId ? (
                <Button
                  type="button"
                  variant={activeThread.is_starred ? "brandSubtle" : "toolbar"}
                  size="sm"
                  className="gap-1.5 shadow-none"
                  aria-label={activeThread.is_starred ? t("email_hub.unstar") : t("email_hub.star")}
                  disabled={starPending}
                  onClick={onToggleStar}
                >
                  <Star
                    className={cn(
                      "size-3.5",
                      activeThread.is_starred ? "fill-brand text-brand" : "text-muted-foreground",
                    )}
                    aria-hidden
                  />
                  {activeThread.is_starred ? t("email_hub.unstar") : t("email_hub.star")}
                </Button>
              ) : null}
              {canReply ? (
                <>
                  <Button variant="brand" size="sm" className="gap-1.5 shadow-none" onClick={onReply}>
                    <Reply className="size-3.5" />
                    {t("email_hub.reply")}
                  </Button>
                  {folder === "INBOX" ? (
                    <Button variant="toolbar" size="sm" className="gap-1.5 shadow-none" onClick={onReplyAll}>
                      <ReplyAll className="size-3.5" />
                      {t("email_hub.reply_all")}
                    </Button>
                  ) : null}
                  <Button variant="toolbar" size="sm" className="gap-1.5 shadow-none" onClick={onForward}>
                    <Forward className="size-3.5" />
                    {t("email_hub.forward")}
                  </Button>
                </>
              ) : null}
              {folder === "INBOX" && activeThread.is_read ? (
                <Button
                  variant="toolbar"
                  size="sm"
                  className="gap-1.5 shadow-none"
                  disabled={markReadPending}
                  onClick={onMarkUnread}
                >
                  <MailOpen className="size-3.5" />
                  {t("email_hub.mark_unread")}
                </Button>
              ) : null}
              {inSpamView ? (
                <Button
                  variant="brand"
                  size="sm"
                  className="gap-1.5 shadow-none"
                  disabled={movePending}
                  onClick={onNotSpam}
                >
                  <Inbox className="size-3.5" aria-hidden />
                  {t("email_hub.not_spam")}
                </Button>
              ) : null}
              {folder === "SNOOZED" || activeThread.snoozed_until ? (
                <Button
                  variant="brand"
                  size="sm"
                  className="gap-1.5 shadow-none"
                  disabled={snoozePending}
                  onClick={onClearSnooze}
                >
                  <Inbox className="size-3.5" />
                  {t("email_hub.snooze.unsnooze")}
                </Button>
              ) : null}
              {canRestore ? (
                <Button
                  variant="brand"
                  size="sm"
                  className="gap-1.5 shadow-none"
                  disabled={movePending}
                  onClick={onRestoreInbox}
                >
                  <Inbox className="size-3.5" />
                  {t("email_hub.restore_inbox")}
                </Button>
              ) : null}
              {folder === "INBOX" ? (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={snoozePending}
                      render={
                        <Button variant="toolbar" size="sm" className="gap-1.5 shadow-none" />
                      }
                    >
                      <Clock className="size-3.5" aria-hidden />
                      {t("email_hub.snooze.action")}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-44">
                      <DropdownMenuItem onClick={onSnoozeTomorrow}>{t("email_hub.snooze.tomorrow")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={onSnoozeNextWeek}>{t("email_hub.snooze.next_week")}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="toolbar"
                    size="sm"
                    className="gap-1.5 shadow-none"
                    disabled={movePending}
                    onClick={onArchive}
                  >
                    <Archive className="size-3.5" />
                    {t("email_hub.archive")}
                  </Button>
                  <Button
                    variant="toolbar"
                    size="sm"
                    className="gap-1.5 shadow-none"
                    disabled={movePending}
                    onClick={onSpam}
                  >
                    <ShieldAlert className="size-3.5" />
                    {t("email_hub.report_spam")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5 shadow-none"
                    disabled={movePending}
                    onClick={onTrash}
                  >
                    <Trash2 className="size-3.5" />
                    {t("email_hub.trash")}
                  </Button>
                </>
              ) : null}
              {folder === "SENT" ? (
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5 shadow-none"
                  disabled={movePending}
                  onClick={onTrash}
                >
                  <Trash2 className="size-3.5" />
                  {t("email_hub.trash")}
                </Button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {bodyLoading ? (
            <div className="space-y-3 px-4 py-4 lg:px-6" aria-busy="true">
              <p className="text-caption text-muted-foreground">{t("email_hub.body_loading")}</p>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-2 h-48 w-full" />
            </div>
          ) : readableBody && detailData?.body_html ? (
            <EmailHtmlFrame html={detailData.body_html} title={activeThread.subject || t("email_hub.no_subject")} />
          ) : readableBody && detailData?.body_text?.trim() ? (
            <pre className="whitespace-pre-wrap px-4 py-4 font-sans text-body leading-relaxed lg:px-6">
              {detailData.body_text.trim()}
            </pre>
          ) : bodyLoadFailed || isError ? (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center lg:px-6">
              <p className="text-body text-destructive">{t("email_hub.load_error")}</p>
              <Button type="button" variant="toolbar" size="sm" className="shadow-none" onClick={onRefetch}>
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            <p className="px-4 py-10 text-center text-body text-muted-foreground lg:px-6">{t("email_hub.body_empty")}</p>
          )}
        </div>

        {detailData?.attachments?.length ? (
          <div className="shrink-0 border-t border-border px-4 py-4 lg:px-6">
            <AttachmentList
              attachments={detailData.attachments}
              downloading={downloadPending}
              onDownload={onDownloadAttachment}
              embedded
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}
