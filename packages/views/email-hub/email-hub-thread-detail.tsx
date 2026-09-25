"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Forward, RefreshCw, Reply, ReplyAll } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEmailHubConversation } from "@uniwork/core/email-hub/hooks";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { identityTint } from "../people/identity-tint";
import { EmailHubConversationMessage } from "./email-hub-conversation-message";
import { useEmailHubRemoteImagesPref } from "./use-email-hub-remote-images-pref";
import { emailHubLocale, formatEmailFullDate, senderDisplayName } from "./email-hub-format";
import {
  emailHubThreadCapabilities,
  EmailHubThreadToolbar,
  type EmailHubThreadActions,
  type EmailHubThreadPending,
} from "./email-hub-thread-toolbar";
import { AttachmentList, EmailSenderAvatar } from "./email-hub-view-parts";

interface EmailHubThreadDetailProps {
  wsId: string;
  accountId: string;
  activeThread: EmailHubThread;
  browserFolder: string;
  detailData?: EmailHubThread | null;
  readableBody: boolean;
  bodyLoading: boolean;
  bodyLoadFailed: boolean;
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
  wsId,
  accountId,
  activeThread,
  browserFolder,
  detailData,
  readableBody,
  bodyLoading,
  bodyLoadFailed,
  actions,
  pending,
  aiOpen,
}: EmailHubThreadDetailProps) {
  const { t, i18n } = useTranslation();
  const locale = emailHubLocale(i18n.language);
  const thread = detailData ?? activeThread;
  const subject = thread.subject || t("email_hub.no_subject");
  const can = emailHubThreadCapabilities(thread, browserFolder);
  const labels = thread.imap_labels ?? [];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [alwaysShowRemoteImages, setAlwaysShowRemoteImages] = useEmailHubRemoteImagesPref();
  const [allowRemoteImages, setAllowRemoteImages] = useState(alwaysShowRemoteImages);
  const conversation = useEmailHubConversation(wsId, accountId, activeThread.id);
  const allowRemote = alwaysShowRemoteImages || allowRemoteImages;

  const messages = useMemo(() => {
    const list = conversation.data?.messages?.filter(Boolean) ?? [];
    if (list.length > 0) return list;
    return [activeThread];
  }, [activeThread, conversation.data?.messages]);

  const multiMessage = messages.length > 1;

  useEffect(() => {
    setAllowRemoteImages(alwaysShowRemoteImages);
  }, [activeThread.id, alwaysShowRemoteImages]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [activeThread.id]);

  const showPrimarySkeleton = !multiMessage && bodyLoading;

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
              {multiMessage ? (
                <p className="text-caption text-muted-foreground">
                  {t("email_hub.conversation_count", { count: messages.length })}
                </p>
              ) : null}
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
            {!multiMessage ? (
              <div className="flex min-w-0 items-start gap-3">
                <EmailSenderAvatar fromName={thread.from_name} fromAddr={thread.from_addr} />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                    <span className="truncate text-body font-semibold">
                      {senderDisplayName(thread.from_name, thread.from_addr)}
                    </span>
                    {thread.from_name ? (
                      <span className="truncate text-caption text-muted-foreground">{thread.from_addr}</span>
                    ) : null}
                  </p>
                  {thread.to_addrs.length ? (
                    <p className="truncate text-caption text-muted-foreground" title={thread.to_addrs.join(", ")}>
                      {t("email_hub.to_recipient", { name: thread.to_addrs.join(", ") })}
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
            ) : null}
          </header>

          {conversation.isLoading && multiMessage ? (
            <BodySkeleton />
          ) : multiMessage ? (
            <div className="space-y-4">
              {messages.map((msg) => (
                <EmailHubConversationMessage
                  key={msg.id}
                  wsId={wsId}
                  accountId={accountId}
                  message={msg}
                  detailOverride={msg.id === activeThread.id ? detailData : null}
                  allowRemote={allowRemote}
                  onAllowRemote={() => {
                    setAllowRemoteImages(true);
                    setAlwaysShowRemoteImages(true);
                  }}
                  locale={locale}
                />
              ))}
            </div>
          ) : showPrimarySkeleton ? (
            <BodySkeleton />
          ) : (
            <EmailHubConversationMessage
              wsId={wsId}
              accountId={accountId}
              message={activeThread}
              detailOverride={detailData}
              allowRemote={allowRemote}
              onAllowRemote={() => {
                setAllowRemoteImages(true);
                setAlwaysShowRemoteImages(true);
              }}
              locale={locale}
              showHeader={false}
            />
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
