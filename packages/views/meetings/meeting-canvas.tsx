"use client";

import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * The plain page behind prejoin and lobby screens. Deliberately flat: the
 * ambient glow and dot grid it used to paint were decoration, which
 * PRODUCT.md rules out — the camera frame and the status card carry the page.
 */
export function MeetingCanvas({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col bg-background", className)}>{children}</div>
  );
}
