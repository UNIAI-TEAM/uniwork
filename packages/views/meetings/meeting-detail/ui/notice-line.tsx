import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

const TONE = {
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
} as const;

/**
 * An icon-led line in signal ink (kit `.notice`) — never a card. The caption
 * under it stays muted whatever the tone. `role` is the caller's: "alert" for
 * a failure the reader must hear, nothing for a standing state.
 */
export function NoticeLine({
  tone,
  icon: Icon,
  children,
  caption,
  role,
  className,
}: {
  tone: keyof typeof TONE;
  icon: LucideIcon;
  children: ReactNode;
  caption?: ReactNode;
  role?: "alert" | "status";
  className?: string;
}) {
  return (
    <div role={role} className={cn("flex min-h-5 items-start gap-2", TONE[tone], className)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <div className="text-body">{children}</div>
        {caption ? <p className="mt-0.5 text-caption text-muted-foreground">{caption}</p> : null}
      </div>
    </div>
  );
}
