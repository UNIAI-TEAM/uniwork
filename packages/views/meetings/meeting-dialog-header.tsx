"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

export function MeetingDialogHeader({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex gap-3", className)}>
      {Icon ? (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Icon aria-hidden className="size-5" />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <h2 className="text-pretty text-title-sm font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 text-pretty text-label text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
