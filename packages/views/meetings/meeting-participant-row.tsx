"use client";

import type { ReactNode } from "react";
import type { Participant } from "livekit-client";
import { Track } from "livekit-client";
import { useIsMuted, useIsSpeaking } from "@livekit/components-react";
import { Eye, EyeOff, Lock, MicOff, MoreVertical, Pin, PinOff, Volume2 } from "lucide-react";
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

export function MeetingParticipantRow({
  participant,
  subtitle,
  canHost,
  pinned,
  avatarUrl,
  roleChip = null,
  menuExtra = null,
}: {
  participant: Participant;
  subtitle?: string;
  canHost?: boolean;
  pinned?: boolean;
  /** Photo for this person when the caller can resolve it (e.g. from workspace members). */
  avatarUrl?: unknown;
  /** Guest, agent, secretary or observer chip beside the name; `null` for a plain member. */
  roleChip?: MeetingParticipantRole | null;
  /** Extra menu entries the caller owns, e.g. the host's role controls. */
  menuExtra?: ReactNode;
}) {
  const { t } = useTranslation();
  const speaking = useIsSpeaking(participant);
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const micLocked = useMicLocked(participant);
  const pinParticipant = useMeetingViewSessionStore((s) => s.pinParticipant);
  const toggleHidden = useMeetingViewSessionStore((s) => s.toggleHidden);
  const isHidden = useMeetingViewSessionStore((s) => s.isHidden(participant.identity));
  const name = displayName(participant);
  const label = participant.isLocal ? t("meetings.youSuffix", { name }) : name;

  return (
    <div
      className={cn(
        "group flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 transition-colors",
        "hover:bg-surface-hover",
        pinned && "bg-surface-selected",
      )}
    >
      <MeetingPersonAvatar name={name} avatarUrl={avatarUrl} />

      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-body text-foreground">
          <span className="min-w-0 truncate">{label}</span>
          {roleChip ? <MeetingRoleChip role={roleChip} /> : null}
        </p>
        {subtitle ? (
          <p className="truncate text-caption text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {micLocked ? (
          <span
            role="img"
            className="flex size-7 items-center justify-center rounded-full text-warning"
            aria-label={t("meetings.micLocked")}
          >
            <Lock aria-hidden className="size-3.5" />
          </span>
        ) : micMuted ? (
          <span
            role="img"
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground"
            aria-label={t("meetings.micIsOff")}
          >
            <MicOff aria-hidden className="size-3.5" />
          </span>
        ) : speaking ? (
          <span
            role="img"
            className="flex size-7 items-center justify-center rounded-full text-success"
            aria-label={t("meetings.speaking")}
          >
            <Volume2 aria-hidden className="size-3.5" />
          </span>
        ) : null}

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
            <MoreVertical aria-hidden className="size-4" />
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
            {canHost ? <MeetingModerationMenuItems participant={participant} micMuted={micMuted} /> : null}
            {menuExtra}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
