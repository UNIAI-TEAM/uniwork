"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetMeetingScribe } from "@uniwork/core/meetings";
import { ScribeMark, type ScribeMarkState } from "@uniwork/ui/brand/scribe-mark";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../toast-api-error";
import { useScribeInRoom, useScribePaused } from "./meeting-scribe-captions";

type ScribeChipState = "on" | "paused" | "joining" | "failed" | "off";

/**
 * What the chip says: the agent in the room wins over what the server last
 * reported; in the room it is paused while its STT fails (benchmark #1).
 */
export function scribeChipState(
  meeting: Pick<Meeting, "scribe_enabled" | "scribe_status">,
  inRoom: boolean,
  paused = false,
): ScribeChipState {
  if (meeting.scribe_enabled === false) return "off";
  if (inRoom) return paused ? "paused" : "on";
  return meeting.scribe_status === "FAILED" ? "failed" : "joining";
}

const LABEL_KEY: Record<ScribeChipState, string> = {
  on: "meetings.scribe.chipOn",
  paused: "meetings.scribe.chipPaused",
  joining: "meetings.scribe.chipJoining",
  failed: "meetings.scribe.chipFailed",
  off: "meetings.scribe.chipOff",
};

/** The mark moves while the scribe transcribes or joins; paused fades, failed greys, off is the outline. */
const MARK_STATE: Record<ScribeChipState, ScribeMarkState> = {
  on: "live",
  paused: "paused",
  joining: "joining",
  failed: "failed",
  off: "off",
};

const EXPLAIN_KEY: Record<ScribeChipState, string> = {
  on: "meetings.scribe.explain",
  paused: "meetings.scribe.explainPaused",
  joining: "meetings.scribe.explainJoining",
  failed: "meetings.scribe.explainFailed",
  off: "meetings.scribe.explainOff",
};

/**
 * The room's sign that the AI scribe is listening (spec D14: always shown
 * while it is, to members and guests alike), with a short explanation and,
 * for the host or an admin, the switch for this meeting. Hidden where the
 * workspace has no scribe and none is in the room.
 */
export function MeetingScribeChip({
  meeting,
  available,
  canSwitch,
}: {
  meeting?: Meeting;
  /** The workspace's `scribe` capability. */
  available: boolean;
  /** Host or workspace admin, not a guest. */
  canSwitch: boolean;
}) {
  const { t } = useTranslation();
  const inRoom = useScribeInRoom();
  const paused = useScribePaused();
  const set = useSetMeetingScribe(meeting?.id ?? "");
  const [open, setOpen] = useState(false);
  if (!available && !inRoom) return null;
  // A guest has no Meeting (the room does not read it for them): the agent in
  // the room is all they need to see that the AI listens (UNI-1995 access).
  if (!meeting && !inRoom) return null;
  const state = meeting ? scribeChipState(meeting, inRoom, paused) : paused ? "paused" : "on";
  // A viewer who cannot switch it learns nothing from "joining" or "off".
  if (!canSwitch && (state === "joining" || state === "off")) return null;
  // The switch needs the meeting it switches.
  const switchable = canSwitch && !!meeting;
  const failed = state === "failed";
  // Paused reads as a warning too: the room is not being transcribed right now.
  const warn = failed || state === "paused";
  const switchTo = (enabled: boolean) => {
    set.mutate(enabled, {
      onSuccess: () => setOpen(false),
      onError: (err) => toastApiError(err, t("meetings.scribe.chipFailed")),
    });
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="meetingChip"
            size="sm"
            // Failed reads as a warning, not as the neutral "listening" chip.
            className={cn(
              "h-8 px-2 @4xl/stagehead:px-2.5",
              warn && "border-warning/60 text-warning hover:text-warning aria-expanded:text-warning data-popup-open:text-warning",
            )}
            data-testid="meeting-scribe-chip"
            data-state={state}
          />
        }
      >
        <ScribeMark state={MARK_STATE[state]} className="size-4" />
        {/* A narrow header keeps a short name, so the privacy signal is never an icon alone; a failure has its own. */}
        <span aria-hidden className="@4xl/stagehead:hidden">
          {t(
            failed
              ? "meetings.scribe.chipFailedShort"
              : state === "paused"
                ? "meetings.scribe.chipPausedShort"
                : "meetings.scribe.chipShort",
          )}
        </span>
        <span className="sr-only @4xl/stagehead:not-sr-only">{t(LABEL_KEY[state])}</span>
      </PopoverTrigger>
      {/* `dark`: the popup portals to <body>, out of the dark stage it belongs to. */}
      <PopoverContent className="dark w-72 space-y-3">
        <p className="text-body font-medium">{t(LABEL_KEY[state])}</p>
        <p className="text-caption text-muted-foreground">{t(EXPLAIN_KEY[state])}</p>
        {switchable && state === "failed" ? (
          <Button type="button" size="sm" onClick={() => switchTo(true)} aria-disabled={set.isPending} className="w-full">
            {set.isPending ? <Spinner /> : null}
            {t("common.retry")}
          </Button>
        ) : null}
        {switchable ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => switchTo(state === "off")}
            aria-disabled={set.isPending}
            className="w-full"
          >
            {set.isPending && state !== "failed" ? <Spinner /> : null}
            {t(state === "off" ? "meetings.scribe.turnOn" : "meetings.scribe.turnOff")}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
