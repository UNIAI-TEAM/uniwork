"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

/* Soft strips on the dark call plane: the tone's soft pair, a hairline of its
   signal colour, and the icon in the signal colour itself. */
const TONE = {
  warning: "border-warning/30 bg-warning-soft text-warning-soft-foreground [&>svg]:text-warning",
  destructive: "border-destructive/35 bg-destructive-soft text-destructive-soft-foreground [&>svg]:text-destructive",
  info: "border-info/30 bg-info-soft text-info-soft-foreground [&>svg]:text-info",
} as const;

/**
 * Something to know on the call plane: a recording in progress, a lost
 * connection, a blocked device. A bold first line when there is a title,
 * the detail under it, and pill actions under the text — so a narrow card
 * never squeezes the message into a column.
 */
export function VoiceCallStrip({
  tone,
  icon: Icon,
  title,
  children,
  actions,
  role,
  spin = false,
  className,
}: {
  tone: keyof typeof TONE;
  icon: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** "alert" for a failure that interrupts; otherwise the host announces the state. */
  role?: "alert" | "status";
  /** The icon turns while the call heals itself (reconnecting). */
  spin?: boolean;
  className?: string;
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex gap-2.5 rounded-[14px] border px-3.5 py-3 text-left text-label",
        !title && !actions && "items-center font-medium",
        TONE[tone],
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-4.5 shrink-0", spin && "motion-safe:animate-spin")} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.75">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <p>{children}</p> : null}
        {actions ? <div className="mt-1.75 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** A pill under a strip's text: the call accent for the way out, a hairline for the other. */
export function VoiceCallStripAction({
  primary = false,
  children,
  ...props
}: {
  primary?: boolean;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  "aria-busy"?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "h-8.5 rounded-full px-3.5 text-label font-semibold",
        primary
          ? "bg-call-accent text-on-solid hover:bg-call-accent/90 hover:text-on-solid"
          : "border-call-muted-foreground/40 text-foreground hover:bg-meeting-bar-chip-bg",
      )}
      {...props}
    >
      {children}
    </Button>
  );
}
