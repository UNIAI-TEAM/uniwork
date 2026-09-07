"use client";

import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

export function MeetingPanelCard({
  id,
  title,
  description,
  children,
  className,
  action,
}: {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section
      className={cn("rounded-xl border border-border bg-surface", className)}
      aria-labelledby={id}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="text-label font-semibold text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-caption text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
