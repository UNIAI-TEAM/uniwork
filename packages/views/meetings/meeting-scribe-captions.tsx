"use client";
import { useEffect, useRef, useState } from "react";
import { useRemoteParticipants, useRoomContext } from "@livekit/components-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { type CaptionLanguage, useSetCaptionLanguage } from "@uniwork/core/meetings/captions";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { cn } from "@uniwork/ui/lib/utils";

/** The text-stream topic the AI scribe publishes captions on (spec D7). */
export const SCRIBE_CAPTION_TOPIC = "uw.caption";
const SHOWN_LINES = 3;
// Translations kept for the lines on screen and a few that may still arrive.
const KEPT_TRANSLATIONS = 20;
const ORIGINAL = "original";

type ScribeCaption = { segmentId: string; identity: string; text: string; final: boolean };

/** The topic one language's translated captions ride on (spec §5.3). */
export function scribeTranslationTopic(lang: string): string {
  return `${SCRIBE_CAPTION_TOPIC}.${lang}`;
}

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
 * Reads the agent's captions while `enabled`, and the translations of the
 * picked language. Only a stream sent by an agent participant counts, so
 * nobody in the room can caption in someone else's name; the speaker is the
 * identity the agent names, resolved to the name the server put in that
 * person's token.
 */
function useScribeCaptions(enabled: boolean, lang: CaptionLanguage) {
  const room = useRoomContext();
  const [lines, setLines] = useState<ScribeCaption[]>([]);
  const [translated, setTranslated] = useState<ReadonlyMap<string, string>>(new Map());
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
  useEffect(() => {
    setTranslated(new Map());
    if (!enabled || !lang) return;
    const topic = scribeTranslationTopic(lang);
    room.registerTextStreamHandler(topic, (reader, from) => {
      if (!room.getParticipantByIdentity(from.identity)?.isAgent) return;
      const segmentId = reader.info.attributes?.["uw.segment_id"];
      if (!segmentId) return;
      void reader.readAll().then((text) => {
        setTranslated((prev) => new Map([...prev, [segmentId, text] as const].slice(-KEPT_TRANSLATIONS)));
      });
    });
    return () => room.unregisterTextStreamHandler(topic);
  }, [room, enabled, lang]);
  // A line without its translation (yet) shows the original.
  return lang ? lines.map((l) => (l.final ? { ...l, text: translated.get(l.segmentId) ?? l.text } : l)) : lines;
}

/**
 * The viewer's caption language (Gốc / Tiếng Việt / English). The server sets
 * it on their participant; a refusal goes back to the original. Leaving the
 * captions (unmount) clears it, so the agent stops translating for nobody.
 * Picks go to the server one at a time and only the newest is sent next, so
 * two quick clicks can never land in the wrong order.
 */
function useCaptionLanguage(meetingId: string | undefined) {
  const { t } = useTranslation();
  const [lang, setLang] = useState<CaptionLanguage>("");
  const { mutateAsync } = useSetCaptionLanguage(meetingId ?? "");
  // wanted: the newest pick; held: what the server last took; sending: a PUT is in flight.
  const wanted = useRef<CaptionLanguage>("");
  const held = useRef<CaptionLanguage>("");
  const sending = useRef(false);
  const flush = useRef(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (held.current !== wanted.current) {
        const next = wanted.current;
        try {
          await mutateAsync(next);
          held.current = next;
        } catch {
          // Refused: the server kept what it held. Only a refusal of the newest pick shows.
          if (wanted.current === next) {
            wanted.current = held.current;
            setLang(held.current);
            toast.error(t("meetings.scribe.captionLanguageFailed"));
          }
        }
      }
    } finally {
      sending.current = false;
    }
  });
  useEffect(
    () => () => {
      wanted.current = "";
      void flush.current();
    },
    [],
  );
  const pick = (next: CaptionLanguage) => {
    if (!meetingId || next === lang) return;
    setLang(next);
    wanted.current = next;
    void flush.current();
  };
  return { lang, pick };
}

/** The room's captions from the AI scribe: who said it, interim words dimmed, in the picked language. */
export function MeetingScribeCaptions({
  enabled,
  meetingId,
  className,
}: {
  enabled: boolean;
  meetingId?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const room = useRoomContext();
  const { lang, pick } = useCaptionLanguage(meetingId);
  const lines = useScribeCaptions(enabled, lang);
  const nameOf = (identity: string) =>
    room.getParticipantByIdentity(identity)?.name || t("meetings.scribe.unknownSpeaker");
  const lastFinal = [...lines].reverse().find((l) => l.final);
  return (
    <div className={cn("pointer-events-none w-full max-w-3xl", className)} data-testid="meeting-scribe-captions">
      {/* Interim words change several times a second; only finished sentences reach assistive tech. */}
      <p role="status" aria-live="polite" className="sr-only">
        {lastFinal ? `${nameOf(lastFinal.identity)}: ${lastFinal.text}` : ""}
      </p>
      <div className="rounded-xl bg-meeting-bar-bg px-4 py-2 ring-1 ring-meeting-bar-border">
        <div className="flex items-center justify-between gap-2">
          <p aria-hidden className="text-caption text-meeting-bar-muted-foreground">
            {t("meetings.scribe.captionsLabel")}
          </p>
          {meetingId ? (
            <ToggleGroup
              value={[lang || ORIGINAL]}
              onValueChange={(v) => {
                // Pressing the language that is on would clear the group; one is always picked.
                const next = v[0];
                if (next === ORIGINAL) pick("");
                else if (next === "vi" || next === "en") pick(next);
              }}
              aria-label={t("meetings.scribe.captionLanguage")}
              size="sm"
              className="pointer-events-auto"
            >
              <ToggleGroupItem value={ORIGINAL} className="text-caption text-meeting-bar-foreground">
                {t("meetings.scribe.captionOriginal")}
              </ToggleGroupItem>
              <ToggleGroupItem value="vi" className="text-caption text-meeting-bar-foreground">
                {t("meetings.scribe.captionVietnamese")}
              </ToggleGroupItem>
              <ToggleGroupItem value="en" className="text-caption text-meeting-bar-foreground">
                {t("meetings.scribe.captionEnglish")}
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null}
        </div>
        <div aria-hidden>
          {lines.length === 0 ? (
            <p className="text-center text-body text-meeting-bar-foreground">{t("meetings.captionsListening")}</p>
          ) : (
            lines.map((l) => (
              <p key={l.segmentId} className="text-body" data-final={l.final ? "1" : "0"}>
                <span className="font-medium text-meeting-bar-foreground">{`${nameOf(l.identity)}: `}</span>
                <span className={l.final ? "text-meeting-bar-foreground" : "text-meeting-bar-muted-foreground"}>
                  {l.text}
                </span>
              </p>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
