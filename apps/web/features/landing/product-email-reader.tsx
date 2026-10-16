"use client";

import { Forward, Reply, ReplyAll, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { EmailHubAiSummaryDetail } from "@uniwork/views/email-hub/email-hub-ai-insight";
import { EmailHubThreadToolbar, type EmailHubThreadActions } from "@uniwork/views/email-hub/email-hub-thread-toolbar";
import { AttachmentList, EmailSenderAvatar } from "@uniwork/views/email-hub/email-hub-view-parts";

export function ProductEmailReader({ thread, folder, actions, aiOpen }: {
  thread: EmailHubThread; folder: string; actions: EmailHubThreadActions; aiOpen: boolean;
}) {
  const { t, i18n } = useTranslation();
  const date = new Date(thread.sent_at).toLocaleString(i18n.language === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  return <article className="product-email-reader" aria-labelledby="demo-email-subject" data-demo-result={thread.is_starred ? "starred" : undefined}>
    <EmailHubThreadToolbar thread={thread} browserFolder={folder} actions={actions} pending={{ star: false, move: false, markRead: false, snooze: false, download: false }} aiOpen={aiOpen} />
    <div className="product-email-reading-body">
      <div className="product-email-message">
        <header className="space-y-4">
          <h2 id="demo-email-subject" tabIndex={-1} className="text-title-lg font-semibold text-balance focus:outline-none">{thread.subject}</h2>
          <div className="flex min-w-0 items-start gap-3">
            <EmailSenderAvatar fromName={thread.from_name} fromAddr={thread.from_addr} />
            <div className="min-w-0 flex-1"><p className="flex flex-wrap items-baseline gap-x-1.5"><strong className="text-body">{thread.from_name}</strong><span className="truncate text-caption text-muted-foreground">{thread.from_addr}</span></p><p className="truncate text-caption text-muted-foreground">{t("email_hub.to_recipient", { name: thread.to_addrs.join(", ") })}</p><time className="text-caption text-muted-foreground" dateTime={thread.sent_at}>{date}</time></div>
          </div>
        </header>
        <p className="text-body leading-relaxed whitespace-pre-wrap">{thread.body_text || thread.snippet}</p>
        {thread.attachments?.length ? <AttachmentList attachments={thread.attachments} downloading={false} onDownload={actions.onDownloadAttachment} /> : null}
        {thread.folder !== "DRAFTS" && thread.folder !== "SPAM" && <div className="flex flex-wrap gap-2 pt-1">{[{ key: "reply", icon: Reply, action: actions.onReply }, { key: "reply_all", icon: ReplyAll, action: actions.onReplyAll }, { key: "forward", icon: Forward, action: actions.onForward }].map(({ key, icon: Icon, action }) => <Button key={key} variant="outline" size="lg" onClick={action}><Icon aria-hidden />{t(`email_hub.${key}`)}</Button>)}</div>}
      </div>
      {aiOpen && <aside className="product-email-ai"><header className="flex items-center justify-between gap-2"><h2 className="text-title-sm font-semibold">{t("email_hub.ai_title")}</h2><Button variant="ghost" size="icon" aria-label={t("common.close")} onClick={actions.onToggleAi}><X aria-hidden /></Button></header><p className="text-caption text-muted-foreground">{t("landing.productDemo.email.localOnly")}</p><EmailHubAiSummaryDetail summary={{ summary: thread.snippet, key_points: [thread.subject], action_items: [], needs_reply: false, reply_hint: "", model: "demo", cached: false, summarized_at: "" }} /></aside>}
    </div>
  </article>;
}
