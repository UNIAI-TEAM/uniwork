"use client";

import type { ReactNode } from "react";
import { VideoOff } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";

/** The camera frame every preview state shares: stage surface, 4:3 by default. */
export const CAMERA_PREVIEW_FRAME =
  "dark relative flex aspect-[4/3] min-h-48 w-full items-center justify-center overflow-hidden rounded-xl bg-meeting-stage ring-1 ring-border";

/**
 * What the camera frame shows when there is no picture: an icon, a headline,
 * an optional detail line and an optional action. Lives apart from
 * meeting-camera-preview.tsx (which pulls livekit-client) so a page can draw
 * the frame before, or without, loading the SDK.
 */
export function CameraPreviewPlaceholder({
  title,
  detail,
  hint,
  action,
}: {
  title: string;
  detail?: string | null;
  hint?: string | null;
  action?: ReactNode;
}) {
  return (
    <div className="relative flex max-w-xs flex-col items-center gap-2 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <VideoOff aria-hidden className="size-6" />
      </span>
      <p className="text-body text-foreground">{title}</p>
      {detail ? <p className="text-caption text-muted-foreground">{detail}</p> : null}
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** The whole frame with a placeholder inside, for a preview that is not mounted. */
export function CameraPreviewFrame({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn(CAMERA_PREVIEW_FRAME, className)}>{children}</div>;
}
