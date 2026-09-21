"use client";

import { AlertCircle, Ban, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

export type ChatNoticeTone = "warning" | "destructive" | "info" | "muted";

const TONE: Record<ChatNoticeTone, string> = {
  warning: "bg-warning-soft text-warning-soft-foreground",
  destructive: "bg-destructive-soft text-destructive-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground",
  muted: "bg-muted text-muted-foreground",
};

/**
 * A full-width strip above the conversation for a state the reader must not
 * miss — offline, a send that failed, a blocked DM. The signal colour and the
 * icon carry the kind together, never the colour alone.
 */
export function ChatNotice({
  tone,
  icon: Icon,
  children,
  action,
  live = "polite",
}: {
  tone: ChatNoticeTone;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  live?: "polite" | "assertive" | "off";
}) {
  return (
    <div
      role={live === "assertive" ? "alert" : "status"}
      aria-live={live}
      className={cn("flex items-center gap-2.5 border-b border-border px-4 py-2", TONE[tone])}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <div className="min-w-0 flex-1 text-caption font-medium text-pretty">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** The strips a conversation can carry above its messages, in order of weight. */
export function ChatConversationNotices({
  workspaceLoadFailed,
  onRetryWorkspace,
  connectError,
  blockedNotice,
}: {
  workspaceLoadFailed: boolean;
  onRetryWorkspace: () => void;
  connectError: string | null;
  blockedNotice: string | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      {workspaceLoadFailed ? (
        <ChatNotice
          tone="destructive"
          icon={AlertCircle}
          action={
            <Button type="button" variant="outline" size="sm" onClick={onRetryWorkspace}>
              {t("chat.retry")}
            </Button>
          }
        >
          {t("chat.room_load_failed")}
        </ChatNotice>
      ) : null}
      {connectError ? (
        <ChatNotice tone="destructive" icon={AlertCircle} live="assertive">
          {connectError}
        </ChatNotice>
      ) : null}
      {blockedNotice ? (
        <ChatNotice tone="muted" icon={Ban}>
          {blockedNotice}
        </ChatNotice>
      ) : null}
    </>
  );
}
