"use client";

import { cn } from "@uniwork/ui/lib/utils";

export function SidebarTypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="inline-block size-1 rounded-full bg-current opacity-70 animate-bounce"
          style={{ animationDelay: `${index * 120}ms` }}
        />
      ))}
    </span>
  );
}
