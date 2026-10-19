"use client";

import type { ReactNode, Ref } from "react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * Round controls on the dark call plane. Neutral is the meeting bar's chip;
 * `on` (camera, screen share live) is the call accent; `off` (mic muted) is
 * the light fill, so a muted mic stands out from the row; hang-up is the
 * solid red — the one control that ends something. Record keeps a red glyph
 * on the chip, and a live recording is the soft red with a red hairline.
 */
const TONE = {
  default: "bg-meeting-bar-chip-bg text-foreground group-hover/button:bg-meeting-bar-chip-hover",
  on: "bg-call-accent text-on-solid group-hover/button:bg-call-accent/90",
  off: "bg-foreground text-call-plane group-hover/button:bg-foreground/90",
  hangup: "bg-destructive-solid text-on-solid group-hover/button:bg-destructive-solid/90",
  record: "bg-meeting-bar-chip-bg text-destructive group-hover/button:bg-meeting-bar-chip-hover",
  recording: "bg-destructive-soft text-destructive-soft-foreground ring-[1.5px] ring-destructive/60 ring-inset",
  unavailable: "bg-meeting-bar-chip-bg/60 text-faint-foreground",
} as const;

type VoiceCallControlTone = keyof typeof TONE;

/** The record glyph: a ring with a dot, solid while it can record, hollow where it cannot. */
export function VoiceCallRecordGlyph({ hollow = false }: { hollow?: boolean }) {
  return (
    <span aria-hidden className="flex size-4.5 items-center justify-center rounded-full border-2 border-current">
      <span className={cn("size-2.25 rounded-full", hollow ? "border-2 border-current" : "bg-current")} />
    </span>
  );
}

/**
 * One call control, the same shape as the meeting room's: a fixed name (it
 * names the device, not the next action), `aria-pressed` for its state, and
 * the name again as a tooltip with its shortcut. In the panel it is a 52px
 * circle; fullscreen it is a 56px circle with the name written under it.
 */
export function VoiceCallControl({
  label,
  tooltip,
  shortcut,
  keyShortcuts,
  pressed,
  tone = "default",
  large = false,
  disabled,
  ariaDisabled,
  describedBy,
  onClick,
  buttonRef,
  children,
}: {
  label: string;
  /** What the tooltip says when it is more than the name (why it is unavailable). */
  tooltip?: string;
  /** The shortcut as a keycap after the name ("⌘D"). */
  shortcut?: string;
  keyShortcuts?: string;
  pressed?: boolean;
  tone?: VoiceCallControlTone;
  large?: boolean;
  disabled?: boolean;
  ariaDisabled?: boolean;
  describedBy?: string;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={buttonRef}
            type="button"
            variant="ghost"
            className={cn(
              "p-0 hover:bg-transparent dark:hover:bg-transparent",
              large
                ? "h-auto w-24 flex-col justify-start gap-1.75 rounded-lg text-center text-caption leading-4 font-medium whitespace-normal text-call-muted-foreground hover:text-call-muted-foreground"
                : "size-13 rounded-full",
            )}
            aria-label={large ? undefined : label}
            aria-pressed={pressed}
            aria-keyshortcuts={keyShortcuts}
            aria-disabled={ariaDisabled || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full transition-colors [&_svg:not([class*='size-'])]:size-5.5",
            large ? "size-14" : "size-13",
            TONE[tone],
            large && tone === "hangup" && "shadow-lg shadow-destructive-solid/30",
          )}
        >
          {children}
        </span>
        {large ? label : null}
      </TooltipTrigger>
      <TooltipContent className="font-semibold">
        {tooltip ?? label}
        {shortcut && !tooltip ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}
