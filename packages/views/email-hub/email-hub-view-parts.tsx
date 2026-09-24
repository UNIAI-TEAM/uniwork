"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubAttachment } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { wrapEmailHtml } from "./email-hub-html";

export function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function senderInitial(fromName?: string, fromAddr?: string) {
  const source = (fromName?.trim() || fromAddr?.trim() || "?").replace(/[<>"']/g, "");
  const letter = source.match(/[A-Za-z0-9]/)?.[0];
  return (letter ?? "?").toUpperCase();
}

export function EmailSenderAvatar({
  fromName,
  fromAddr,
  className,
}: {
  fromName?: string;
  fromAddr?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-body font-semibold text-brand",
        className,
      )}
      aria-hidden
    >
      {senderInitial(fromName, fromAddr)}
    </span>
  );
}

export function EmailHtmlFrame({ html, title }: { html: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const resize = () => {
      try {
        const doc = frame.contentDocument;
        const height = doc?.documentElement?.scrollHeight ?? doc?.body?.scrollHeight;
        if (height && height > 0) {
          frame.style.height = `${Math.min(Math.max(height + 16, 240), 6000)}px`;
        }
      } catch {
        frame.style.height = "480px";
      }
    };
    frame.addEventListener("load", resize);
    return () => frame.removeEventListener("load", resize);
  }, [html]);

  return (
    <iframe
      ref={frameRef}
      title={title}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="block w-full min-w-0 border-0 bg-transparent"
      srcDoc={wrapEmailHtml(html)}
    />
  );
}

export function EmptyPanel({ message, icon: Icon = Mail }: { message: string; icon?: typeof Mail }) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-muted/60">
        <Icon className="size-7 text-muted-foreground" />
      </span>
      <p className="max-w-sm text-body leading-relaxed text-muted-foreground">{message}</p>
    </div>
  );
}

export function StatsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 shadow-[var(--surface-shadow)]">
      <h3 className="mb-3 text-caption font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-body">
      <span className="text-muted-foreground">{label}</span>
      <span className="rounded-full bg-muted/60 px-2.5 py-0.5 tabular-nums text-body font-semibold">{value}</span>
    </div>
  );
}

export function AttachmentList({
  attachments,
  downloading,
  onDownload,
  embedded = false,
}: {
  attachments: EmailHubAttachment[];
  downloading: boolean;
  onDownload: (att: EmailHubAttachment) => void;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={embedded ? undefined : "rounded-xl border border-border bg-background p-4 shadow-[var(--surface-shadow)]"}>
      <h3 className="mb-3 text-body font-medium">{t("email_hub.attachments_title")}</h3>
      <ul className="space-y-2">
        {attachments.map((att) => (
          <li
            key={att.id}
            className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-body font-medium">{att.filename || t("email_hub.attachment_untitled")}</p>
              <p className="text-caption text-muted-foreground">{formatBytes(att.size_bytes)}</p>
            </div>
            <Button
              variant="toolbar"
              size="sm"
              className="shrink-0 rounded-lg shadow-none"
              disabled={downloading}
              onClick={() => onDownload(att)}
            >
              {t("email_hub.download")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
