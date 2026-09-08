"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";

type PanelTone = "default" | "warning" | "brand";

const TONE_CLASS: Record<PanelTone, string> = {
  default: "border-surface-border",
  warning: "border-warning/40 bg-warning/5 dark:bg-warning/10",
  brand: "border-brand/30",
};

/**
 * One section of the meeting detail page: a titled surface with an optional
 * leading icon, a header action, a flush body for lists and a muted footer.
 */
export function MeetingPanelCard({
  id,
  title,
  description,
  icon: Icon,
  children,
  className,
  action,
  footer,
  flush = false,
  tone = "default",
}: {
  id?: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  footer?: ReactNode;
  /** Drop the body padding so a divided list runs edge to edge. */
  flush?: boolean;
  tone?: PanelTone;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-surface shadow-[var(--surface-shadow)]",
        TONE_CLASS[tone],
        className,
      )}
      aria-labelledby={id}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {Icon ? (
            <span
              aria-hidden
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-lg",
                tone === "warning" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
                tone === "brand" && "bg-brand/10 text-brand",
              )}
            >
              <Icon className="size-3.5" />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 id={id} className="text-pretty text-body font-semibold text-foreground">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-caption text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      <div className={flush ? undefined : "p-4"}>{children}</div>
      {footer ? (
        <div className="border-t border-border bg-surface-hover/60 px-4 py-3">{footer}</div>
      ) : null}
    </section>
  );
}
