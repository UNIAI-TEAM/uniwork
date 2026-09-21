"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubAttachment } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
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
    <div className="w-full min-w-0 overflow-x-auto rounded-lg border border-border bg-background">
      <iframe
        ref={frameRef}
        title={title}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="block w-full min-w-0 border-0 bg-background"
        srcDoc={wrapEmailHtml(html)}
      />
    </div>
  );
}

export function EmptyPanel({ message, icon: Icon = Mail }: { message: string; icon?: typeof Mail }) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 p-6 text-center">
      <Icon className="size-10 text-muted-foreground/50" />
      <p className="max-w-xs text-body text-muted-foreground">{message}</p>
    </div>
  );
}

export function StatsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <h3 className="mb-2 text-caption font-medium text-muted-foreground">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-body">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-medium">{value}</span>
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
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border p-3">
      <h3 className="mb-2 text-body font-medium">{t("email_hub.attachments_title")}</h3>
      <ul className="space-y-2">
        {attachments.map((att) => (
          <li key={att.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-body">{att.filename || t("email_hub.attachment_untitled")}</p>
              <p className="text-caption text-muted-foreground">{formatBytes(att.size_bytes)}</p>
            </div>
            <Button variant="outline" size="sm" disabled={downloading} onClick={() => onDownload(att)}>
              {t("email_hub.download")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
