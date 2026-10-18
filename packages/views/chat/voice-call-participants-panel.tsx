"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, Users, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { initialsOf } from "./chat-initials";
import { chatPersonFaceClass } from "./chat-person-card";
import { useVoiceCallMedia } from "./voice-call-room-context";
import type { VoiceCallParticipantTile } from "./voice-call-room-types";
import { VoiceCallSummaryHint } from "./voice-call-video-stage";

/** A state mark beside a row: the icon is drawn, the word is what is read. */
function StateMark({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <span role="img" aria-label={label} className={cn("flex shrink-0 [&_svg]:size-4.5", className)}>
      {children}
    </span>
  );
}

function ParticipantRow({ tile, label, caller }: { tile: VoiceCallParticipantTile; label: string; caller: boolean }) {
  const { t } = useTranslation();
  const live = [
    tile.isSpeaking ? t("chat.voice_call_participant_speaking") : null,
    tile.hasScreenShare ? t("chat.voice_call_participant_sharing") : null,
  ].filter((part): part is string => part !== null);
  return (
    <li className={cn("flex min-h-15 items-center gap-3 rounded-lg px-2.5 py-2", tile.isSpeaking && "bg-call-speaking/8")}>
      <span className="relative size-10 shrink-0">
        {tile.isSpeaking ? (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-call-speaking motion-safe:animate-ping motion-reduce:hidden"
            style={{ animationDuration: "1.8s" }}
          />
        ) : null}
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 inline-flex items-center justify-center rounded-full text-label",
            chatPersonFaceClass(tile.identity),
            tile.isSpeaking && "ring-2 ring-call-speaking ring-offset-2 ring-offset-call-stage",
          )}
        >
          {initialsOf(tile.name.trim() || label)}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-body leading-[19px] font-semibold text-foreground">{label}</span>
        {live.length > 0 ? (
          <span className="truncate text-caption text-call-speaking">
            {live.map((part, i) => (
              <span key={part}>
                {i > 0 ? " · " : null}
                {part}
              </span>
            ))}
          </span>
        ) : caller ? (
          <span className="text-caption text-faint-foreground">{t("chat.voice_call_participant_caller")}</span>
        ) : null}
      </span>
      {tile.hasVideo ? (
        <StateMark label={t("chat.voice_call_participant_camera_on")} className="text-call-muted-foreground">
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
          className={tile.isSpeaking ? "text-call-speaking" : "text-call-muted-foreground"}
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
export function useVoiceCallParticipantsPanel({
  isCaller = false,
  aiSummary = false,
}: {
  /** The viewer started the call: their row says "Người gọi". */
  isCaller?: boolean;
  /** The AI will summarise the call: the panel says so at its foot. */
  aiSummary?: boolean;
} = {}): { toggle: ReactNode; panel: ReactNode } {
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
      className="h-11 shrink-0 gap-2 rounded-full border-transparent px-3.5 text-body font-semibold aria-pressed:bg-call-speaking/15 aria-pressed:text-call-speaking"
      onClick={() => setOpen((value) => !value)}
    >
      <Users aria-hidden className="size-4.5" />
      <span className="max-sm:sr-only">{t("chat.voice_call_participants_toggle")}</span>
      <span className="h-5.5 min-w-5.5 rounded-full bg-call-accent px-1.75 text-center text-caption leading-5.5 text-on-solid tabular-nums">
        {count}
      </span>
    </Button>
  );

  const panel = open ? (
    <aside
      id={panelId}
      aria-labelledby={titleId}
      className="flex w-full shrink-0 flex-col overflow-hidden rounded-xl bg-call-stage ring-1 ring-call-hairline ring-inset sm:w-80"
    >
      <div className="flex h-15 shrink-0 items-center gap-2 border-b border-call-hairline pr-2 pl-4.5">
        <h2 id={titleId} className="min-w-0 truncate font-display text-body-lg leading-5 font-bold text-foreground">
          <span aria-hidden>{t("chat.voice_call_participants_toggle")}</span>
          <span className="sr-only">{t("chat.voice_call_participants_title", { count })}</span>
        </h2>
        <span
          aria-hidden
          className="h-5.5 min-w-5.5 rounded-full bg-meeting-bar-chip-bg px-1.75 text-center text-caption leading-5.5 font-semibold text-call-muted-foreground tabular-nums"
        >
          {count}
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 rounded-lg text-call-muted-foreground"
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
            caller={tile.isLocal && isCaller}
            label={tile.isLocal ? t("chat.you") : tile.name.trim() || tile.identity}
          />
        ))}
      </ul>
      {aiSummary ? <VoiceCallSummaryHint className="mx-3 mb-3 shrink-0 rounded-lg bg-meeting-bar-chip-bg/60 px-3 py-2.5" /> : null}
    </aside>
  ) : null;

  return { toggle, panel };
}
