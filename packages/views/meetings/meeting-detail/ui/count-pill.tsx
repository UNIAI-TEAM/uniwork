import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

const TONE = {
  muted: "bg-muted text-muted-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  success: "bg-success-soft text-success-soft-foreground",
} as const;

/** A count or state beside a tab label (kit `.count`, "Nháp" = warning, "Đã chốt" = success). */
export function CountPill({
  tone = "muted",
  children,
  className,
}: {
  tone?: keyof typeof TONE;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm px-1.5 text-caption font-medium",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
