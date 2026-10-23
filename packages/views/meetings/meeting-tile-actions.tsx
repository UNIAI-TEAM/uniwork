"use client";
import { useRef, type ComponentProps } from "react";
import type { Participant } from "livekit-client";
import { Eye, EyeOff, Maximize, MicOff, Minimize, EllipsisVertical, Pin, PinOff } from "lucide-react";
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
  fullscreen,
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
  /** Offered on a share the viewer can watch full screen (see useTileFullscreen). */
  fullscreen?: { active: boolean; onToggle: () => void };
  onMenuOpenChange: (open: boolean) => void;
  onPin: () => void;
}) {
  const { t } = useTranslation();
  const requestMute = useRequestMute();
  const toggleHidden = useMeetingViewSessionStore((s) => s.toggleHidden);
  const isHidden = useMeetingViewSessionStore((s) => s.isHidden(participant.identity));
  const hostMuteSlot = canHost && !participant.isLocal;
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  // A share offers full screen, and the host's actions on its presenter.
  if (screenShare && !hostMuteSlot && !fullscreen) return null;

  // The controls sit in a corner on their own chip, so the face stays visible
  // and the dark wash is only behind the buttons. A thumbnail is too narrow
  // for three touch targets: it keeps the menu, which holds every action.
  const chipClassName = cn(
    "absolute z-30 flex items-center gap-0.5 rounded-full bg-meeting-bar-bg p-0.5 ring-1 ring-meeting-bar-border transition-opacity duration-fast motion-reduce:transition-none",
    compact ? "right-1 bottom-1" : "right-2 bottom-2 sm:right-3 sm:bottom-3",
    visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
    // Focus alone holds the chip up, except in full screen: the toggle keeps
    // focus after entering, and the tile's idle hide decides there.
    !visible && !fullscreen?.active && "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
  );
  // In the bottom corner, not the top: a shared window keeps its own close
  // and menu buttons top right.
  const fullscreenButton = fullscreen ? (
    <TileActionButton
      aria-label={fullscreen.active ? t("meetings.fullscreenExit") : t("meetings.fullscreenEnter")}
      onClick={fullscreen.onToggle}
    >
      {fullscreen.active ? <Minimize aria-hidden className="size-4" /> : <Maximize aria-hidden className="size-4" />}
    </TileActionButton>
  ) : null;

  // Full screen shows only the tile: a menu would open outside it, unseen,
  // so the way out is the one control kept there. A viewer's menu on a share
  // would be empty: pin and "don't watch" act on the person, the rest is the
  // host's.
  if (fullscreen?.active || (screenShare && !hostMuteSlot)) {
    return (
      <div data-tile-controls className={chipClassName}>
        {fullscreenButton}
      </div>
    );
  }

  return (
    <div data-tile-controls className={chipClassName}>
      {fullscreenButton}
      {!compact && !screenShare ? (
        <TileActionButton
          aria-label={pinned ? t("meetings.unpinFromScreen") : t("meetings.pinToScreen")}
          aria-pressed={pinned}
          onClick={onPin}
        >
          {pinned ? <PinOff aria-hidden className="size-4" /> : <Pin aria-hidden className="size-4" />}
        </TileActionButton>
      ) : null}

      {/* The slot outlives the mic: removed, the chip shrank and slid the pin
          button under the pointer that had just clicked mute. `invisible`
          takes it out of the tab order and the accessibility tree too. */}
      {!compact && hostMuteSlot ? (
        <TileActionButton
          aria-label={t("meetings.muteParticipant", { name })}
          disabled={micMuted}
          // A coarse pointer leaves mute to the menu: at 44px, three buttons
          // took the whole width of a phone's tile.
          className={cn("pointer-coarse:hidden", micMuted && "invisible")}
          onClick={() => {
            requestMute(participant.identity, name);
            // This button goes invisible once the mic is off; focus waits on
            // the menu instead of falling to the page.
            menuTriggerRef.current?.focus();
          }}
        >
          <MicOff aria-hidden className="size-4" />
        </TileActionButton>
      ) : null}

      <DropdownMenu onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger
          render={
            <TileActionButton
              ref={menuTriggerRef}
              aria-label={
                screenShare ? t("meetings.screenActions", { name }) : t("meetings.participantActions", { name })
              }
              className={cn("data-popup-open:bg-meeting-bar-chip-hover", compact && "size-7")}
            />
          }
        >
          <EllipsisVertical aria-hidden className={compact ? "size-3.5" : "size-4"} />
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
