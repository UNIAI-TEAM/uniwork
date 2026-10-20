"use client";
import { useEffect, useState } from "react";
import { useRemoteParticipants, useRoomContext } from "@livekit/components-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

/** The text-stream topic the AI scribe publishes captions on (spec D7). */
export const SCRIBE_CAPTION_TOPIC = "uw.caption";
const SHOWN_LINES = 3;

type ScribeCaption = { segmentId: string; identity: string; text: string; final: boolean };

/**
 * Applies one caption from the agent: the interim and final texts of a
 * segment share its id and the newer one replaces the older in place; a
 * final is never overwritten by an interim that arrives late. The newest
 * SHOWN_LINES segments stay.
 */
export function applyScribeCaption(lines: readonly ScribeCaption[], c: ScribeCaption): ScribeCaption[] {
  const at = lines.findIndex((l) => l.segmentId === c.segmentId);
  if (at < 0) return [...lines, c].slice(-SHOWN_LINES);
  if (lines[at]?.final && !c.final) return [...lines];
  const next = [...lines];
  next[at] = c;
  return next;
}

/** The AI scribe is in the room: LiveKit's AGENT kind, never an identity prefix (D8). */
export function useScribeInRoom(): boolean {
  return useRemoteParticipants().some((p) => p.isAgent);
}

/**
 * Reads the agent's captions while `enabled`. Only a stream sent by an agent
 * participant counts, so nobody in the room can caption in someone else's
 * name; the speaker is the identity the agent names, resolved to the name
 * the server put in that person's token.
 */
function useScribeCaptions(enabled: boolean): ScribeCaption[] {
  const room = useRoomContext();
  const [lines, setLines] = useState<ScribeCaption[]>([]);
  useEffect(() => {
    if (!enabled) {
      setLines([]);
      return;
    }
    room.registerTextStreamHandler(SCRIBE_CAPTION_TOPIC, (reader, from) => {
      if (!room.getParticipantByIdentity(from.identity)?.isAgent) return;
      const a = reader.info.attributes ?? {};
      const segmentId = a["uw.segment_id"];
      const identity = a["uw.participant_identity"];
      if (!segmentId || !identity) return;
      void reader.readAll().then((text) => {
        setLines((prev) => applyScribeCaption(prev, { segmentId, identity, text, final: a["uw.final"] === "1" }));
      });
    });
    return () => room.unregisterTextStreamHandler(SCRIBE_CAPTION_TOPIC);
  }, [room, enabled]);
  return lines;
}

/** The room's captions from the AI scribe: who said it, interim words dimmed. */
export function MeetingScribeCaptions({ enabled, className }: { enabled: boolean; className?: string }) {
  const { t } = useTranslation();
  const room = useRoomContext();
  const lines = useScribeCaptions(enabled);
  const nameOf = (identity: string) =>
    room.getParticipantByIdentity(identity)?.name || t("meetings.scribe.unknownSpeaker");
  const lastFinal = [...lines].reverse().find((l) => l.final);
  return (
    <div className={cn("pointer-events-none w-full max-w-3xl", className)} data-testid="meeting-scribe-captions">
      {/* Interim words change several times a second; only finished sentences reach assistive tech. */}
      <p role="status" aria-live="polite" className="sr-only">
        {lastFinal ? `${nameOf(lastFinal.identity)}: ${lastFinal.text}` : ""}
      </p>
      <div aria-hidden className="rounded-xl bg-meeting-bar-bg px-4 py-2 ring-1 ring-meeting-bar-border">
        <p className="text-center text-caption text-meeting-bar-muted-foreground">{t("meetings.scribe.captionsLabel")}</p>
        {lines.length === 0 ? (
          <p className="text-center text-body text-meeting-bar-foreground">{t("meetings.captionsListening")}</p>
        ) : (
          lines.map((l) => (
            <p key={l.segmentId} className="text-body" data-final={l.final ? "1" : "0"}>
              <span className="font-medium text-meeting-bar-foreground">{`${nameOf(l.identity)}: `}</span>
              <span className={l.final ? "text-meeting-bar-foreground" : "text-meeting-bar-muted-foreground"}>{l.text}</span>
            </p>
          ))
        )}
      </div>
    </div>
  );
}
