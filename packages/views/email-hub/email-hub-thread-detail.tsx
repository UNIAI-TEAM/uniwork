"use client";

import { useEffect, useRef, useState } from "react";
import { Forward, ImageOff, RefreshCw, Reply, ReplyAll } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { identityTint } from "../people/identity-tint";
import { emailHubLocale, formatEmailFullDate, senderDisplayName } from "./email-hub-format";
import { emailHasRemoteContent } from "./email-hub-html";
import {
  emailHubThreadCapabilities,
  EmailHubThreadToolbar,
  type EmailHubThreadActions,
  type EmailHubThreadPending,
} from "./email-hub-thread-toolbar";
import { AttachmentList, EmailHtmlFrame, EmailSenderAvatar } from "./email-hub-view-parts";

interface EmailHubThreadDetailProps {
  activeThread: EmailHubThread;
  /** Sidebar folder the user is browsing (may differ from cached thread.folder briefly). */
  browserFolder: string;
  detailData?: EmailHubThread | null;
  readableBody: boolean;
  bodyLoading: boolean;
  bodyLoadFailed: boolean;
  isError: boolean;
  actions: EmailHubThreadActions;
  pending: EmailHubThreadPending;
  aiOpen: boolean;
}

function BodySkeleton() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 rounded-lg border border-border p-5" aria-busy="true">
      <p className="text-caption text-muted-foreground" role="status">
        {t("email_hub.body_loading")}
      </p>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="mt-2 h-40 w-full" />
    </div>
  );
}

export function EmailHubThreadDetail({
  activeThread,
  browserFolder,
  detailData,
  readableBody,
  bodyLoading,
  bodyLoadFailed,
  isError,
  actions,
  pending,
  aiOpen,
}: EmailHubThreadDetailProps) {
  const { t, i18n } = useTranslation();
  const locale = emailHubLocale(i18n.language);
  const thread = detailData ?? activeThread;
  const subject = thread.subject || t("email_hub.no_subject");
  const name = senderDisplayName(thread.from_name, thread.from_addr);
  const can = emailHubThreadCapabilities(thread, browserFolder);
  const labels = thread.imap_labels ?? [];
  const recipients = thread.to_addrs.join(", ");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [remoteAllowedFor, setRemoteAllowedFor] = useState<string | null>(null);
  const allowRemote = remoteAllowedFor === activeThread.id;
  const bodyHtml = readableBody ? detailData?.body_html : undefined;
  const remoteBlocked = !!bodyHtml && !allowRemote && emailHasRemoteContent(bodyHtml);

  // Opening an email removes the row that had focus; move it to the subject so
  // a keyboard or screen-reader user lands on what they opened, not on <body>.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [activeThread.id]);

  return (
    <article className="flex h-full min-h-0 w-full min-w-0 flex-col" aria-labelledby="email-hub-thread-subject">
      <EmailHubThreadToolbar
        thread={thread}
        browserFolder={browserFolder}
        actions={actions}
        pending={pending}
        aiOpen={aiOpen}
      />

      <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-4xl space-y-5 px-4 pt-5 pb-10 lg:px-8">
          <header className="space-y-4">
            <div className="space-y-2">
              <h1
                ref={headingRef}
                id="email-hub-thread-subject"
                tabIndex={-1}
                className="text-title-lg font-semibold text-balance focus:outline-none"
              >
                {subject}
              </h1>
              {labels.length > 0 ? (
                <ul className="flex flex-wrap gap-1" aria-label={t("email_hub.labels_section")}>
                  {labels.map((label) => (
                    <li
                      key={label}
                      className={cn("rounded-md px-1.5 py-0.5 text-caption", tintClass[identityTint(label.toLowerCase())])}
                    >
                      {label}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="flex min-w-0 items-start gap-3">
              <EmailSenderAvatar fromName={thread.from_name} fromAddr={thread.from_addr} />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                  <span className="truncate text-body font-semibold">{name}</span>
                  {thread.from_name ? (
                    <span className="truncate text-caption text-muted-foreground">{thread.from_addr}</span>
                  ) : null}
                </p>
                {recipients ? (
                  <p className="truncate text-caption text-muted-foreground" title={recipients}>
                    {t("email_hub.to_recipient", { name: recipients })}
                  </p>
                ) : null}
                <time dateTime={thread.sent_at} className="block text-caption tabular-nums text-muted-foreground @2xl:hidden">
                  {formatEmailFullDate(thread.sent_at, locale)}
                </time>
              </div>
              <time
                dateTime={thread.sent_at}
                className="hidden shrink-0 pt-0.5 text-caption tabular-nums text-muted-foreground @2xl:block"
              >
                {formatEmailFullDate(thread.sent_at, locale)}
              </time>
            </div>
          </header>

          {bodyLoading ? (
            <BodySkeleton />
          ) : bodyHtml ? (
            <div className="space-y-2">
              {remoteBlocked ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted px-3 py-2 text-caption text-muted-foreground">
                  <ImageOff className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 text-pretty">{t("email_hub.remote_blocked")}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setRemoteAllowedFor(activeThread.id)}>
                    {t("email_hub.remote_show")}
                  </Button>
                </div>
              ) : null}
              <div className="overflow-hidden rounded-lg border border-border">
                <EmailHtmlFrame html={bodyHtml} title={subject} allowRemote={allowRemote} />
              </div>
            </div>
          ) : readableBody && detailData?.body_text?.trim() ? (
            <div className="rounded-lg border border-border bg-surface px-5 py-4">
              <p className="max-w-[72ch] font-sans text-body leading-relaxed whitespace-pre-wrap">
                {detailData.body_text.trim()}
              </p>
            </div>
          ) : bodyLoadFailed || isError ? (
            <div
              className="flex flex-col items-center gap-3 rounded-lg border border-border px-4 py-10 text-center"
              role="alert"
            >
              <p className="text-body text-destructive">{t("email_hub.load_error")}</p>
              <Button type="button" variant="outline" onClick={actions.onRefetch}>
                <RefreshCw aria-hidden />
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-body text-muted-foreground">
              {t("email_hub.body_empty")}
            </p>
          )}

          {detailData?.attachments?.length ? (
            <AttachmentList
              attachments={detailData.attachments}
              downloading={pending.download}
              onDownload={actions.onDownloadAttachment}
            />
          ) : null}

          {can.canReply ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" variant="outline" size="lg" onClick={actions.onReply}>
                <Reply aria-hidden />
                {t("email_hub.reply")}
              </Button>
              {can.canReplyAll ? (
                <Button type="button" variant="outline" size="lg" onClick={actions.onReplyAll}>
                  <ReplyAll aria-hidden />
                  {t("email_hub.reply_all")}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="lg" onClick={actions.onForward}>
                <Forward aria-hidden />
                {t("email_hub.forward")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
