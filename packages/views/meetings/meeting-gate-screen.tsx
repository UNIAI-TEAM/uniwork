"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingCanvas } from "./meeting-canvas";

/**
 * The one screen for "you are not in the room, and here is why": a join that
 * ended for good, a declined request, a room that closed, a lost connection.
 * The signal tile and the title say what happened; the actions say what to do
 * next — never a hang-up button for a call the person never entered.
 */
export function MeetingGateScreen({
  icon,
  tone,
  title,
  description,
  actions,
  meetingTitle,
  alert = false,
  busy = false,
  className,
}: {
  icon: LucideIcon;
  tone: IconTileTone;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** The meeting's own name, shown small above the state so people know which call this is. */
  meetingTitle?: string;
  /** Errors are announced assertively; waiting and settled states politely. */
  alert?: boolean;
  /** Still waiting on someone else: a spinner leads the description. */
  busy?: boolean;
  className?: string;
}) {
  return (
    <MeetingCanvas className={cn("overflow-y-auto", className)}>
      <div className="m-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-12 text-center">
        <IconTile icon={icon} size="lg" tone={tone} />
        {/* One stable live region around the words only: the node survives a
            state change (waiting → declined), so the new sentence is read,
            and the buttons are never part of the announcement. */}
        <div aria-live={alert ? "assertive" : "polite"} aria-atomic="true" className="space-y-1.5">
          {meetingTitle ? <p className="line-clamp-1 text-label text-muted-foreground">{meetingTitle}</p> : null}
          <h1 data-gate-heading className="text-balance text-title font-semibold text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="mx-auto max-w-sm text-pretty text-body text-muted-foreground">
              {busy ? (
                <Spinner className="mr-1.5 inline-block size-3.5 align-[-0.125em] text-info motion-reduce:animate-none" />
              ) : null}
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center justify-center gap-2 pt-1">{actions}</div> : null}
      </div>
    </MeetingCanvas>
  );
}
