"use client";
import { useState } from "react";
import { Captions, CaptionsOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSetMeetingScribe } from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toastApiError } from "../toast-api-error";
import { useScribeInRoom } from "./meeting-scribe-captions";

type ScribeChipState = "on" | "joining" | "failed" | "off";

/** What the chip says: the agent in the room wins over what the server last reported. */
export function scribeChipState(meeting: Pick<Meeting, "scribe_enabled" | "scribe_status">, inRoom: boolean): ScribeChipState {
  if (meeting.scribe_enabled === false) return "off";
  if (inRoom) return "on";
  return meeting.scribe_status === "FAILED" ? "failed" : "joining";
}

const LABEL_KEY: Record<ScribeChipState, string> = {
  on: "meetings.scribe.chipOn",
  joining: "meetings.scribe.chipJoining",
  failed: "meetings.scribe.chipFailed",
  off: "meetings.scribe.chipOff",
};

/**
 * The room's sign that the AI scribe is listening (spec D14: always shown
 * while it is), with a short explanation and, for the host or an admin, the
 * switch for this meeting. Hidden where the workspace has no scribe and none
 * is in the room.
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
  const set = useSetMeetingScribe(meeting?.id ?? "");
  const [open, setOpen] = useState(false);
  if (!meeting || (!available && !inRoom)) return null;
  const state = scribeChipState(meeting, inRoom);
  // A viewer who cannot switch it learns nothing from "joining" or "off".
  if (!canSwitch && (state === "joining" || state === "off")) return null;
  const Icon = state === "off" ? CaptionsOff : Captions;
  const toggle = () => {
    set.mutate(state === "off", {
      onSuccess: () => setOpen(false),
      onError: (err) => toastApiError(err, t("meetings.scribe.chipFailed")),
    });
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="meetingChip" size="sm" className="h-8 px-2 sm:px-2.5" data-testid="meeting-scribe-chip" />}
      >
        <Icon aria-hidden className="size-4" />
        <span className="sr-only sm:not-sr-only sm:max-w-[10rem] sm:truncate">{t(LABEL_KEY[state])}</span>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3">
        <p className="text-body font-medium">{t(LABEL_KEY[state])}</p>
        <p className="text-caption text-muted-foreground">
          {t(state === "off" ? "meetings.scribe.explainOff" : "meetings.scribe.explain")}
        </p>
        {canSwitch ? (
          <Button type="button" size="sm" variant="outline" onClick={toggle} aria-disabled={set.isPending} className="w-full">
            {set.isPending ? <Spinner /> : null}
            {t(state === "off" ? "meetings.scribe.turnOn" : "meetings.scribe.turnOff")}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
