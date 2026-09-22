"use client";

import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

/** Ambient canvas for prejoin and lobby waiting screens — decorative only. */
export function MeetingLobbyBackground({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -left-[18%] -top-[8%] size-[min(72vw,36rem)] rounded-full opacity-90"
          style={{
            background:
              "radial-gradient(circle at center, var(--meeting-lobby-glow-a) 0%, transparent 68%)",
          }}
        />
        <div
          className="absolute -bottom-[12%] -right-[14%] size-[min(64vw,32rem)] rounded-full opacity-90"
          style={{
            background:
              "radial-gradient(circle at center, var(--meeting-lobby-glow-b) 0%, transparent 70%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, var(--meeting-lobby-vignette-from) 0%, transparent 42%, var(--meeting-lobby-vignette-to) 100%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.2]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, var(--meeting-lobby-grid) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
      </div>
      <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
