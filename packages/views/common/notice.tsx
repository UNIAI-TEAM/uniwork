"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

export type NoticeTone = "warning" | "destructive" | "info" | "success" | "muted";

const TONE: Record<NoticeTone, string> = {
  warning: "bg-warning-soft text-warning-soft-foreground",
  destructive: "bg-destructive-soft text-destructive-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground",
  success: "bg-success-soft text-success-soft-foreground",
  muted: "bg-muted text-muted-foreground",
};

const LAYOUT = {
  /** Full-width strip above a surface (a conversation, a panel). */
  strip: "border-b border-border px-4 py-2",
  /** A rounded block inside content (a page section, a dialog body). */
  inline: "rounded-lg px-3 py-2.5",
} as const;

/**
 * A state the reader must not miss — offline, a send that failed, a meeting
 * past its window. The signal colour and the icon carry the kind together,
 * never the colour alone.
 */
export function Notice({
  tone,
  icon: Icon,
  children,
  action,
  live = "polite",
  layout = "strip",
  className,
}: {
  tone: NoticeTone;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  /**
   * The notice's own live region. A region mounted together with its text is
   * not reliably announced; a notice that comes and goes with a flapping
   * state should pass "off" and let its host keep one persistent status
   * region whose text changes (see chat-realtime-status-banner).
   */
  live?: "polite" | "assertive" | "off";
  layout?: keyof typeof LAYOUT;
  className?: string;
}) {
  return (
    <div
      role={live === "assertive" ? "alert" : live === "off" ? undefined : "status"}
      aria-live={live === "off" ? undefined : live}
      className={cn("flex items-center gap-2.5", LAYOUT[layout], TONE[tone], className)}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <div className="min-w-0 flex-1 text-caption font-medium text-pretty">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
