"use client";
import type { ComponentProps } from "react";
import type { Participant } from "livekit-client";
import { Eye, EyeOff, MicOff, MoreVertical, Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingViewSessionStore } from "@uniwork/core/meetings/view-session";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingModerationMenuItems } from "./meeting-moderation";
import { useRequestMute } from "./use-meeting-signals";

function TileActionButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn(
        "size-8 rounded-full text-meeting-bar-foreground hover:bg-meeting-bar-chip-hover hover:text-meeting-bar-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function MeetingTileActions({
  participant,
  name,
  pinned,
  compact,
  canHost,
  micMuted,
  screenShare,
  visible,
  onMenuOpenChange,
  onPin,
}: {
  participant: Participant;
  name: string;
  pinned: boolean;
  compact: boolean;
  canHost: boolean;
  micMuted: boolean;
  /**
   * A shared screen offers neither pin nor "don't watch": both act on the
   * person, so they moved the presenter's camera or hid the presentation.
   */
  screenShare: boolean;
  visible: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onPin: () => void;
}) {
  const { t } = useTranslation();
  const requestMute = useRequestMute();
  const toggleHidden = useMeetingViewSessionStore((s) => s.toggleHidden);
  const isHidden = useMeetingViewSessionStore((s) => s.isHidden(participant.identity));
  const showHostMute = canHost && !participant.isLocal && !micMuted;
  // A share offers only the host's actions on its presenter.
  if (screenShare && !(canHost && !participant.isLocal)) return null;

  // The controls sit in a corner on their own chip, so the face stays visible
  // and the dark wash is only behind the buttons. A thumbnail is too narrow
  // for three touch targets: it keeps the menu, which holds every action.
  return (
    <div
      data-tile-controls
      className={cn(
        "absolute z-30 flex items-center gap-0.5 rounded-full bg-meeting-bar-bg p-0.5 ring-1 ring-meeting-bar-border transition-opacity duration-fast motion-reduce:transition-none",
        compact ? "right-1 bottom-1" : "right-2 bottom-2 sm:right-3 sm:bottom-3",
        visible
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
      )}
    >
      {!compact && !screenShare ? (
        <TileActionButton
          aria-label={pinned ? t("meetings.unpinFromScreen") : t("meetings.pinToScreen")}
          aria-pressed={pinned}
          onClick={onPin}
        >
          {pinned ? <PinOff aria-hidden className="size-4" /> : <Pin aria-hidden className="size-4" />}
        </TileActionButton>
      ) : null}

      {!compact && showHostMute ? (
        <TileActionButton
          aria-label={t("meetings.muteParticipant", { name })}
          onClick={() => requestMute(participant.identity, name)}
        >
          <MicOff aria-hidden className="size-4" />
        </TileActionButton>
      ) : null}

      <DropdownMenu onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger
          render={
            <TileActionButton
              aria-label={
                screenShare ? t("meetings.screenActions", { name }) : t("meetings.participantActions", { name })
              }
              className={cn("data-popup-open:bg-meeting-bar-chip-hover", compact && "size-7")}
            />
          }
        >
          <MoreVertical aria-hidden className={compact ? "size-3.5" : "size-4"} />
        </DropdownMenuTrigger>
        {/* `dark`: the menu opens over the dark stage, as the tile's own chip does. */}
        <DropdownMenuContent align="end" className="dark min-w-44">
          {!screenShare ? (
            <DropdownMenuItem onClick={onPin}>
              {pinned ? <PinOff aria-hidden className="size-4" /> : <Pin aria-hidden className="size-4" />}
              {pinned ? t("meetings.unpinFromScreen") : t("meetings.pinToScreen")}
            </DropdownMenuItem>
          ) : null}
          {!screenShare ? (
            <DropdownMenuItem onClick={() => toggleHidden(participant.identity)}>
              {isHidden ? <Eye aria-hidden className="size-4" /> : <EyeOff aria-hidden className="size-4" />}
              {isHidden ? t("meetings.watchParticipant") : t("meetings.dontWatch")}
            </DropdownMenuItem>
          ) : null}
          {canHost ? (
            <MeetingModerationMenuItems participant={participant} micMuted={micMuted} separated={!screenShare} />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
