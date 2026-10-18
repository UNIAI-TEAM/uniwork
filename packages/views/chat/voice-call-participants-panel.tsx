"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, Users, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@uniwork/ui/components/ui/avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { voiceCallInitialOf } from "./voice-call-floating-panel";
import { useVoiceCallMedia } from "./voice-call-room-context";
import type { VoiceCallParticipantTile } from "./voice-call-room-types";

/** A state mark beside a row: the icon is drawn, the word is what is read. */
function StateMark({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <span role="img" aria-label={label} className={cn("flex shrink-0 [&_svg]:size-4.5", className)}>
      {children}
    </span>
  );
}

function ParticipantRow({ tile, label }: { tile: VoiceCallParticipantTile; label: string }) {
  const { t } = useTranslation();
  return (
    <li className={cn("flex min-h-15 items-center gap-3 rounded-lg px-2.5 py-2", tile.isSpeaking && "bg-brand/10")}>
      <Avatar className={cn("size-10", tile.isSpeaking && "ring-2 ring-brand ring-offset-2 ring-offset-meeting-stage")}>
        <AvatarFallback className="bg-brand-subtle font-display text-label font-bold text-brand-subtle-foreground">
          {voiceCallInitialOf(label)}
        </AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-foreground">{label}</span>
        {tile.isSpeaking ? (
          <span className="text-caption text-brand">{t("chat.voice_call_participant_speaking")}</span>
        ) : null}
      </span>
      {tile.hasVideo ? (
        <StateMark label={t("chat.voice_call_participant_camera_on")} className="text-faint-foreground">
          <Video aria-hidden />
        </StateMark>
      ) : null}
      {tile.micMuted ? (
        <StateMark label={t("chat.voice_call_mic_off")} className="text-destructive">
          <MicOff aria-hidden />
        </StateMark>
      ) : (
        <StateMark
          label={t("chat.voice_call_participant_mic_on")}
          className={tile.isSpeaking ? "text-brand" : "text-muted-foreground"}
        >
          <Mic aria-hidden />
        </StateMark>
      )}
    </li>
  );
}

/**
 * The fullscreen call's "who is here" list: a header toggle with the head
 * count, and a panel beside the stage. The open state outlives a trip out
 * of fullscreen, so coming back shows the panel as it was left. Escape keeps
 * its one meaning in fullscreen (leave fullscreen, never hang up) and does
 * not close the panel first; the panel's own X does.
 */
export function useVoiceCallParticipantsPanel(): { toggle: ReactNode; panel: ReactNode } {
  const { t } = useTranslation();
  const { participantTiles } = useVoiceCallMedia();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const titleId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const count = participantTiles.length;

  const toggle = (
    <Button
      ref={toggleRef}
      type="button"
      variant="meetingChip"
      aria-pressed={open}
      aria-controls={panelId}
      className="h-11 shrink-0 gap-2 rounded-full border-transparent px-3.5 font-semibold aria-pressed:bg-brand-subtle aria-pressed:text-brand-subtle-foreground"
      onClick={() => setOpen((value) => !value)}
    >
      <Users aria-hidden className="size-4.5" />
      <span className="max-sm:sr-only">{t("chat.voice_call_participants_toggle")}</span>
      <span className="min-w-5.5 rounded-full bg-primary px-1.5 text-center text-caption leading-5.5 text-primary-foreground tabular-nums">
        {count}
      </span>
    </Button>
  );

  const panel = open ? (
    <aside
      id={panelId}
      aria-labelledby={titleId}
      className="flex w-full shrink-0 flex-col overflow-hidden rounded-2xl bg-meeting-stage ring-1 ring-border sm:w-80"
    >
      <div className="flex h-15 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4.5">
        <h2 id={titleId} className="min-w-0 flex-1 truncate font-display text-body-lg font-bold text-foreground">
          {t("chat.voice_call_participants_title", { count })}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 rounded-lg text-muted-foreground"
          aria-label={t("chat.voice_call_participants_hide")}
          onClick={() => {
            setOpen(false);
            // The X leaves with the panel; focus goes back to what reopens it.
            toggleRef.current?.focus();
          }}
        >
          <X aria-hidden className="size-4.5" />
        </Button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {participantTiles.map((tile) => (
          <ParticipantRow
            key={tile.identity}
            tile={tile}
            label={tile.isLocal ? t("chat.you") : tile.name.trim() || tile.identity}
          />
        ))}
      </ul>
    </aside>
  ) : null;

  return { toggle, panel };
}
