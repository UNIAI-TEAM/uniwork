"use client";

import { Archive, ArrowLeft, Send, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubAttachment, EmailHubThread } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { AttachmentList, EmailHtmlFrame, formatWhen } from "./email-hub-view-parts";

interface EmailHubThreadDetailProps {
  activeThread: EmailHubThread;
  accountId: string;
  selectedId: string;
  detailData?: EmailHubThread | null;
  readableBody: boolean;
  bodyLoading: boolean;
  bodyLoadFailed: boolean;
  isError: boolean;
  starPending: boolean;
  movePending: boolean;
  downloadPending: boolean;
  onBack: () => void;
  onToggleStar: () => void;
  onReply: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onRefetch: () => void;
  onDownloadAttachment: (att: EmailHubAttachment) => void;
}

export function EmailHubThreadDetail({
  activeThread,
  accountId,
  selectedId,
  detailData,
  readableBody,
  bodyLoading,
  bodyLoadFailed,
  isError,
  starPending,
  movePending,
  downloadPending,
  onBack,
  onToggleStar,
  onReply,
  onArchive,
  onTrash,
  onRefetch,
  onDownloadAttachment,
}: EmailHubThreadDetailProps) {
  const { t } = useTranslation();

  return (
    <article className="mx-auto w-full max-w-none space-y-4">
      <Button type="button" variant="ghost" size="sm" className="-ml-2 gap-1" onClick={onBack}>
        <ArrowLeft className="size-4" />
        {t("email_hub.back_to_list")}
      </Button>
      <header className="space-y-2 border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-title font-medium">{activeThread.subject || t("email_hub.no_subject")}</h1>
          <div className="flex flex-wrap gap-2">
            {accountId && selectedId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
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
            {activeThread.folder === "INBOX" ? (
              <>
                <Button variant="outline" size="sm" className="gap-1" onClick={onReply}>
                  <Send className="size-3.5" />
                  {t("email_hub.reply")}
                </Button>
                <Button variant="outline" size="sm" className="gap-1" disabled={movePending} onClick={onArchive}>
                  <Archive className="size-3.5" />
                  {t("email_hub.archive")}
                </Button>
                <Button variant="outline" size="sm" className="gap-1" disabled={movePending} onClick={onTrash}>
                  <Trash2 className="size-3.5" />
                  {t("email_hub.trash")}
                </Button>
              </>
            ) : null}
          </div>
        </div>
        <p className="text-body text-muted-foreground">
          {t("email_hub.from")}:{" "}
          {activeThread.from_name ? `${activeThread.from_name} <${activeThread.from_addr}>` : activeThread.from_addr}
        </p>
        <p className="text-caption text-muted-foreground">{formatWhen(activeThread.sent_at)}</p>
      </header>
      {bodyLoading ? (
        <div className="space-y-2" aria-busy="true">
          <p className="text-caption text-muted-foreground">{t("email_hub.body_loading")}</p>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : readableBody && detailData?.body_html ? (
        <EmailHtmlFrame html={detailData.body_html} title={activeThread.subject || t("email_hub.no_subject")} />
      ) : readableBody && detailData?.body_text?.trim() ? (
        <pre className="whitespace-pre-wrap font-sans text-body">{detailData.body_text.trim()}</pre>
      ) : bodyLoadFailed || isError ? (
        <div className="space-y-3">
          <p className="text-body text-destructive">{t("email_hub.load_error")}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRefetch}>
            {t("common.retry")}
          </Button>
        </div>
      ) : (
        <p className="text-body text-muted-foreground">{t("email_hub.body_empty")}</p>
      )}
      {detailData?.attachments?.length ? (
        <AttachmentList
          attachments={detailData.attachments}
          downloading={downloadPending}
          onDownload={onDownloadAttachment}
        />
      ) : null}
    </article>
  );
}
