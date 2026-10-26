"use client";

import type { ReactNode } from "react";
import type { Participant } from "livekit-client";
import { Track } from "livekit-client";
import { useIsMuted, useIsSpeaking } from "@livekit/components-react";
import { Eye, EyeOff, Lock, Mic, MicOff, EllipsisVertical, Pin, PinOff } from "lucide-react";
import { identityTint } from "@uniwork/core/chat/identity-tint";
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
import { MeetingPersonAvatar } from "./meeting-person";
import { MeetingRoleChip } from "./meeting-role-chip";
import type { MeetingParticipantRole } from "./meeting-signals";
import { MeetingModerationMenuItems, useMicLocked } from "./meeting-moderation";

function displayName(participant: Participant): string {
  return participant.name || participant.identity;
}

/** Three green bars: someone is talking right now. */
function SpeakingBars({ label }: { label: string }) {
  return (
    <span role="img" aria-label={label} className="flex h-3.5 w-4 items-end justify-center gap-0.5">
      <span className="h-[7px] w-[3px] rounded-xs bg-success" />
      <span className="h-3.5 w-[3px] rounded-xs bg-success" />
      <span className="h-[9px] w-[3px] rounded-xs bg-success" />
    </span>
  );
}

export function MeetingParticipantRow({
  participant,
  host = false,
  sharedMic = false,
  canHost,
  pinned,
  avatarUrl,
  roleChip = null,
  menuExtra = null,
  removable = true,
}: {
  participant: Participant;
  /** The meeting's host: a chip beside the name. */
  host?: boolean;
  /** Whose mic the AI scribe splits into speakers: the clerk set it, everyone should see it. */
  sharedMic?: boolean;
  canHost?: boolean;
  pinned?: boolean;
  /** Photo for this person when the caller can resolve it (e.g. from workspace members). */
  avatarUrl?: unknown;
  /** Guest, agent, secretary or observer chip beside the name; `null` for a plain member. */
  roleChip?: MeetingParticipantRole | null;
  /** Extra menu entries the caller owns, e.g. the host's role controls. */
  menuExtra?: ReactNode;
  /** False on the meeting host's row: no "remove" entry. */
  removable?: boolean;
}) {
  const { t } = useTranslation();
  const speaking = useIsSpeaking(participant);
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const micLocked = useMicLocked(participant);
  const pinParticipant = useMeetingViewSessionStore((s) => s.pinParticipant);
  const toggleHidden = useMeetingViewSessionStore((s) => s.toggleHidden);
  const isHidden = useMeetingViewSessionStore((s) => s.isHidden(participant.identity));
  const name = displayName(participant);
  const chips = [host ? "host" : null, roleChip, sharedMic ? "sharedMic" : null].filter(
    (chip): chip is MeetingParticipantRole | "host" | "sharedMic" => chip !== null,
  );

  return (
    <div
      className={cn(
        "group flex min-h-12 min-w-0 items-center gap-2.5 rounded-xl px-1 py-1.5 transition-colors",
        "hover:bg-surface-hover",
        pinned && "bg-surface-selected",
      )}
    >
      <MeetingPersonAvatar
        name={name}
        avatarUrl={avatarUrl}
        tint={identityTint(participant.identity)}
        size={30}
        className={cn(speaking && "ring-2 ring-success/60 ring-offset-2 ring-offset-background")}
      />

      <p className="flex min-w-0 flex-1 items-center gap-1.5 text-body font-medium text-foreground">
        <span className="min-w-0 truncate">{name}</span>
        {participant.isLocal ? (
          <span className="shrink-0 text-caption font-normal text-faint-foreground">{t("meetings.panel.people.you")}</span>
        ) : null}
        {chips.map((chip) => (
          // The room draws the secretary quiet beside the host's brand chip (People board); the chip stays blue elsewhere.
          <MeetingRoleChip key={chip} role={chip} className={chip === "secretary" ? "bg-surface-hover text-muted-foreground" : undefined} />
        ))}
      </p>

      <div className="flex shrink-0 items-center gap-0.5">
        {/* One fixed column, so every row's mic state lines up. */}
        <span className="flex size-7 items-center justify-center">
          {micLocked ? (
            <span role="img" className="text-warning" aria-label={t("meetings.micLocked")}>
              <Lock aria-hidden className="size-4" />
            </span>
          ) : micMuted ? (
            <span role="img" className="text-destructive" aria-label={t("meetings.micIsOff")}>
              <MicOff aria-hidden className="size-4" />
            </span>
          ) : speaking ? (
            <SpeakingBars label={t("meetings.speaking")} />
          ) : (
            <span role="img" className="text-faint-foreground" aria-label={t("meetings.panel.people.micOn")}>
              <Mic aria-hidden className="size-4" />
            </span>
          )}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
                aria-label={t("meetings.participantActions", { name })}
              />
            }
          >
            <EllipsisVertical aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem
              onClick={() => pinParticipant(pinned ? null : participant.identity)}
            >
              {pinned ? (
                <PinOff aria-hidden className="size-4" />
              ) : (
                <Pin aria-hidden className="size-4" />
              )}
              {pinned ? t("meetings.unpinFromScreen") : t("meetings.pinToScreen")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleHidden(participant.identity)}>
              {isHidden ? (
                <Eye aria-hidden className="size-4" />
              ) : (
                <EyeOff aria-hidden className="size-4" />
              )}
              {isHidden ? t("meetings.watchParticipant") : t("meetings.dontWatch")}
            </DropdownMenuItem>
            {canHost ? (
              <MeetingModerationMenuItems participant={participant} micMuted={micMuted} removable={removable} />
            ) : null}
            {menuExtra}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
