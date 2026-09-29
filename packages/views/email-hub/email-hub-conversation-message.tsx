"use client";

import { ImageOff, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  emailHubHasReadableBody,
  useEmailHubThread,
} from "@uniwork/core/email-hub/hooks";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { useEmailHubConversationBodySlot } from "./email-hub-conversation-body-gate";
import { emailHubLocale, formatEmailFullDate, senderDisplayName } from "./email-hub-format";
import { emailHasRemoteContent } from "./email-hub-html";
import { useEmailHubWhenVisible } from "./use-email-hub-when-visible";
import { EmailHtmlFrame, EmailSenderAvatar } from "./email-hub-view-parts";

function ConversationBodySkeleton() {
  const { t } = useTranslation();
  return (
    <div className="space-y-2" aria-busy="true">
      <p className="text-caption text-muted-foreground" role="status">
        {t("email_hub.body_loading")}
      </p>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function EmailHubConversationMessage({
  wsId,
  accountId,
  message,
  detailOverride,
  allowRemote,
  onAllowRemote,
  locale,
  showHeader = true,
  bodyFetchPriority = false,
}: {
  wsId: string;
  accountId: string;
  message: EmailHubThread;
  detailOverride?: EmailHubThread | null;
  allowRemote: boolean;
  onAllowRemote: () => void;
  locale: string;
  showHeader?: boolean;
  /** Open thread in reading pane — fetch body immediately, not gated by viewport. */
  bodyFetchPriority?: boolean;
}) {
  const { t } = useTranslation();
  const { ref: visibilityRef, visible } = useEmailHubWhenVisible();
  const override =
    detailOverride?.id === message.id && emailHubHasReadableBody(detailOverride) ? detailOverride : null;
  const needsBody = !emailHubHasReadableBody(override ?? message);
  const wantsFetch = needsBody && (bodyFetchPriority || visible);
  const hasSlot = useEmailHubConversationBodySlot(wantsFetch && !bodyFetchPriority);
  const mayFetchBody = wantsFetch && (bodyFetchPriority || hasSlot);
  const lazy = useEmailHubThread(wsId, accountId, mayFetchBody ? message.id : null, message);
  const data =
    (lazy.data && emailHubHasReadableBody(lazy.data) ? lazy.data : null) ??
    override ??
    (emailHubHasReadableBody(message) ? message : lazy.data ?? message);
  const bodyLoading = needsBody && mayFetchBody && (lazy.isBodyLoading || lazy.isFetching);
  const bodyLoadFailed = needsBody && mayFetchBody && lazy.isBodyLoadFailed;
  const bodyWaiting = needsBody && !mayFetchBody;
  const bodyHtml = emailHubHasReadableBody(data) ? data.body_html : undefined;
  const remoteBlocked = !!bodyHtml && !allowRemote && emailHasRemoteContent(bodyHtml);
  const outgoing = message.folder === "SENT" || message.folder === "DRAFTS";
  const displayName = outgoing
    ? t("email_hub.to_recipient", { name: message.to_addrs[0] ?? message.from_addr })
    : senderDisplayName(message.from_name, message.from_addr);

  return (
    <section
      ref={visibilityRef}
      className={cn("space-y-3", showHeader && "rounded-lg border border-border bg-surface p-4 @2xl:p-5")}
      aria-label={displayName}
    >
      {showHeader ? (
        <div className="flex min-w-0 items-start gap-3">
          <EmailSenderAvatar fromName={message.from_name} fromAddr={message.from_addr} />
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              <span className="truncate text-body font-semibold">{displayName}</span>
              {!outgoing && message.from_name ? (
                <span className="truncate text-caption text-muted-foreground">{message.from_addr}</span>
              ) : null}
            </p>
            <time dateTime={message.sent_at} className="block text-caption tabular-nums text-muted-foreground">
              {formatEmailFullDate(message.sent_at, locale)}
            </time>
          </div>
        </div>
      ) : null}

      {bodyLoading ? (
        <ConversationBodySkeleton />
      ) : bodyHtml ? (
        <div className="space-y-2">
          {remoteBlocked ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted px-3 py-2 text-caption text-muted-foreground">
              <ImageOff className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 text-pretty">{t("email_hub.remote_blocked")}</span>
              <Button type="button" variant="outline" size="sm" onClick={onAllowRemote}>
                {t("email_hub.remote_show")}
              </Button>
            </div>
          ) : null}
          <div className="overflow-hidden rounded-lg border border-border">
            <EmailHtmlFrame html={bodyHtml} title={message.subject} allowRemote={allowRemote} />
          </div>
        </div>
      ) : emailHubHasReadableBody(data) && data.body_text?.trim() ? (
        <div className="rounded-lg border border-border bg-background px-4 py-3">
          <p className="max-w-[72ch] font-sans text-body leading-relaxed whitespace-pre-wrap">{data.body_text.trim()}</p>
        </div>
      ) : bodyLoadFailed ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-caption text-muted-foreground">{t("email_hub.load_error")}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void lazy.refetch()}>
            <RefreshCw aria-hidden />
            {t("common.retry")}
          </Button>
        </div>
      ) : bodyWaiting || needsBody ? (
        <ConversationBodySkeleton />
      ) : (
        <p className="text-body text-muted-foreground">{t("email_hub.body_empty")}</p>
      )}
    </section>
  );
}
