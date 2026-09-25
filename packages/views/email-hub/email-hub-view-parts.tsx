"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Download, FileText, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubAttachment } from "@uniwork/core/types/email-hub";
import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { identityTint } from "../people/identity-tint";
import { emailHubLocale, formatBytes, senderDisplayName, senderInitial } from "./email-hub-format";
import { useEmailHubSenderAvatarUrl } from "./email-hub-sender-avatar-context";
import { wrapEmailHtml } from "./email-hub-html";

/**
 * Tinted by the address, so the same sender is the same colour in the list,
 * the reading pane and every visit — the list reads by colour before it reads
 * by name. Every avatar used to share one brand wash.
 */
export function EmailSenderAvatar({
  fromName,
  fromAddr,
  className,
}: {
  fromName?: string;
  fromAddr?: string;
  className?: string;
}) {
  const avatarUrl = useEmailHubSenderAvatarUrl(fromAddr);
  const label = senderDisplayName(fromName, fromAddr);
  const initial = senderInitial(fromName, fromAddr);

  if (avatarUrl) {
    return (
      <span className={cn("inline-flex shrink-0", className)} aria-hidden>
        <ActorAvatar name={label || "?"} initials={initial} avatarUrl={avatarUrl} size="lg" className="size-9 text-caption" />
      </span>
    );
  }

  const tint = identityTint((fromAddr || fromName || "?").toLowerCase());
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-body font-semibold",
        tintClass[tint],
        className,
      )}
      aria-hidden
    >
      {initial}
    </span>
  );
}

const FRAME_MIN_HEIGHT = 160;
const FRAME_MAX_HEIGHT = 20_000;

/**
 * The HTML body. Its height follows the document for as long as it is shown:
 * measuring once on `load` cut off every email whose images arrived later.
 */
export function EmailHtmlFrame({ html, title, allowRemote }: { html: string; title: string; allowRemote: boolean }) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const resize = () => {
      try {
        const doc = frame.contentDocument;
        const height = doc?.documentElement?.scrollHeight ?? doc?.body?.scrollHeight;
        if (height && height > 0) {
          frame.style.height = `${Math.min(Math.max(height, FRAME_MIN_HEIGHT), FRAME_MAX_HEIGHT)}px`;
        }
      } catch {
        frame.style.height = "480px";
      }
    };
    const onLoad = () => {
      resize();
      observer?.disconnect();
      try {
        const root = frame.contentDocument?.documentElement;
        if (root && typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(resize);
          observer.observe(root);
        }
      } catch {
        /* cross-origin document: the load measurement is all we get */
      }
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [html, allowRemote]);

  return (
    <iframe
      ref={frameRef}
      title={title}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="block w-full min-w-0 border-0"
      style={{ height: FRAME_MIN_HEIGHT }}
      srcDoc={wrapEmailHtml(html, { allowRemote })}
    />
  );
}

/** An empty or waiting pane: what is going on, and the next step when there is one. */
export function EmailHubEmptyState({
  title,
  message,
  icon: Icon = Mail,
  action,
  className,
}: {
  title?: string;
  message: string;
  icon?: typeof Mail;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[14rem] flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      <span className="inline-flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden />
      </span>
      {title ? <p className="text-title-sm font-semibold text-balance text-foreground">{title}</p> : null}
      <p className="max-w-sm text-body text-pretty text-muted-foreground">{message}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function AttachmentList({
  attachments,
  downloading,
  onDownload,
}: {
  attachments: EmailHubAttachment[];
  downloading: boolean;
  onDownload: (att: EmailHubAttachment) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = emailHubLocale(i18n.language);
  return (
    <section aria-labelledby="email-hub-attachments-title">
      <h2 id="email-hub-attachments-title" className="mb-2 text-overline text-muted-foreground">
        {t("email_hub.attachments_count", { count: attachments.length })}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {attachments.map((att) => {
          const name = att.filename || t("email_hub.attachment_untitled");
          return (
            <li
              key={att.id}
              className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5"
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <FileText className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium" title={name}>
                  {name}
                </p>
                <p className="text-caption tabular-nums text-muted-foreground">{formatBytes(att.size_bytes, locale)}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground"
                disabled={downloading}
                aria-label={t("email_hub.download_named", { name })}
                onClick={() => onDownload(att)}
              >
                <Download aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
