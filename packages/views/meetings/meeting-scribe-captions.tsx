"use client";
import { useEffect, useRef, useState } from "react";
import { useRemoteParticipants, useRoomContext } from "@livekit/components-react";
import { Check } from "lucide-react";
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
// The agent drops a final that waited 3 s for its batch; this covers that and the call itself.
const TRANSLATION_WAIT_MS = 5000;

type ScribeCaption = {
  segmentId: string;
  identity: string;
  text: string;
  final: boolean;
  /** `uw.language`: what the speaker said it in, e.g. vi-VN. */
  language?: string;
  /** When the final arrived, so its translation is waited for a short while only. */
  finalAt?: number;
};

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
  // Joins and leaves only (LiveKit always follows those): a speaking change must not re-render the stage.
  return useRemoteParticipants({ updateOnlyOn: [] }).some((p) => p.isAgent);
}

/** vi-VN and vi are the same caption language (the agent's base_language). */
function baseLanguage(language: string | undefined): string {
  return (language ?? "").slice(0, 2).toLowerCase();
}

type TranslationState = "idle" | "translating" | "original";

/**
 * Reads the agent's captions while `enabled`, and the translations of the
 * picked language. Only a stream sent by an agent participant counts, so
 * nobody in the room can caption in someone else's name; the speaker is the
 * identity the agent names, resolved to the name the server put in that
 * person's token.
 *
 * A final waits for its translation only when it was said in another
 * language than the picked one (the agent skips the rest), and only for
 * TRANSLATION_WAIT_MS: the agent drops what it cannot send in time and the
 * server may skip a batch, so after that the original stands. `ready` holds
 * the finals whose wait is over, oldest first, so each line reaches a screen
 * reader in the language it will stay in, even one whose translation lands
 * after a newer line that needed none.
 */
function useScribeCaptions(enabled: boolean, lang: CaptionLanguage) {
  const room = useRoomContext();
  const [lines, setLines] = useState<ScribeCaption[]>([]);
  const [translated, setTranslated] = useState<ReadonlyMap<string, string>>(new Map());
  const [now, setNow] = useState(() => Date.now());
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
      const final = a["uw.final"] === "1";
      const language = a["uw.language"];
      void reader.readAll().then((text) => {
        const caption: ScribeCaption = { segmentId, identity, text, final, language };
        setLines((prev) => applyScribeCaption(prev, final ? { ...caption, finalAt: Date.now() } : caption));
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
  // A final said in the picked language needs nothing; one in another waits for its translation.
  const awaiting = (l: ScribeCaption) =>
    Boolean(lang) && l.final && baseLanguage(l.language) !== lang && !translated.has(l.segmentId);
  const waiting = (l: ScribeCaption) => awaiting(l) && now - (l.finalAt ?? 0) < TRANSLATION_WAIT_MS;
  const deadline = lines.filter(waiting).reduce((min, l) => Math.min(min, (l.finalAt ?? 0) + TRANSLATION_WAIT_MS), Infinity);
  useEffect(() => {
    if (deadline === Infinity) return;
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(id);
  }, [deadline]);
  // A line without its translation (yet) shows the original.
  const shown = lang ? lines.map((l) => (l.final ? { ...l, text: translated.get(l.segmentId) ?? l.text } : l)) : lines;
  const newestForeign = [...lines].reverse().find((l) => l.final && Boolean(lang) && baseLanguage(l.language) !== lang);
  const state: TranslationState = !newestForeign || !awaiting(newestForeign)
    ? "idle"
    : waiting(newestForeign)
      ? "translating"
      : "original";
  const ready = shown.filter((l) => l.final && !waiting(l));
  return { lines: shown, state, ready };
}

/**
 * Says the translation state once per picked language, not on every line:
 * a screen reader hears that captions are being translated, or that the
 * original is showing, the first time it happens.
 */
function useTranslationNotice(lang: CaptionLanguage, state: TranslationState): string {
  const { t } = useTranslation();
  const [notice, setNotice] = useState("");
  const told = useRef(new Set<TranslationState>());
  useEffect(() => {
    told.current.clear();
    setNotice("");
  }, [lang]);
  useEffect(() => {
    if (state === "idle" || told.current.has(state)) return;
    told.current.add(state);
    setNotice(t(state === "translating" ? "meetings.scribe.captionTranslating" : "meetings.scribe.captionUntranslated"));
  }, [state, t]);
  return notice;
}

/**
 * Announces each final once, oldest first: the lines that became ready since
 * the last announcement are said together, and a later translation of a line
 * already read never repeats it.
 */
function useSpokenOnce(ready: readonly ScribeCaption[]): readonly ScribeCaption[] {
  const told = useRef(new Set<string>());
  const [said, setSaid] = useState<readonly ScribeCaption[]>([]);
  useEffect(() => {
    const fresh = ready.filter((l) => !told.current.has(l.segmentId));
    if (fresh.length === 0) return;
    for (const l of fresh) told.current.add(l.segmentId);
    setSaid(fresh);
  }, [ready]);
  return said;
}

/**
 * The viewer's caption language (Bản gốc / Tiếng Việt / English). The server sets
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
  // Unmounted: the reset may be refused because the room is closing; nobody is left to tell.
  const leaving = useRef(false);
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
            if (!leaving.current) {
              setLang(held.current);
              toast.error(t("meetings.scribe.captionLanguageFailed"));
            }
          }
        }
      }
    } finally {
      sending.current = false;
    }
  });
  useEffect(() => {
    leaving.current = false; // StrictMode mounts again after the cleanup below
    const send = flush.current;
    return () => {
      leaving.current = true;
      wanted.current = "";
      void send();
    };
  }, []);
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
  const { lines, state, ready } = useScribeCaptions(enabled, lang);
  const said = useSpokenOnce(ready);
  const notice = useTranslationNotice(lang, state);
  const nameOf = (identity: string) =>
    room.getParticipantByIdentity(identity)?.name || t("meetings.scribe.unknownSpeaker");
  return (
    // `dark`: the stage is dark in both themes; the footer sits outside its scope.
    <div className={cn("dark pointer-events-none w-full max-w-3xl", className)} data-testid="meeting-scribe-captions">
      {/* Interim words change several times a second; only finished sentences reach assistive tech, each once. */}
      <p role="status" aria-live="polite" className="sr-only" data-testid="meeting-caption-announcer">
        {said.map((l) => `${nameOf(l.identity)}: ${l.text}`).join(" ")}
      </p>
      <p role="status" aria-live="polite" className="sr-only" data-testid="meeting-caption-translation-notice">
        {notice}
      </p>
      <div className="rounded-xl bg-meeting-bar-bg px-4 py-2 ring-1 ring-meeting-bar-border">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <p aria-hidden className="text-caption text-meeting-bar-muted-foreground" data-testid="meeting-caption-label">
            {t("meetings.scribe.captionsLabel")}
            {state === "translating" ? (
              <span className="ml-2">{t("meetings.scribe.captionTranslating")}</span>
            ) : state === "original" ? (
              <span className="ml-2">{t("meetings.scribe.captionUntranslated")}</span>
            ) : null}
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
              {(
                [
                  [ORIGINAL, "meetings.scribe.captionOriginal"],
                  ["vi", "meetings.scribe.captionVietnamese"],
                  ["en", "meetings.scribe.captionEnglish"],
                ] as const
              ).map(([value, key]) => {
                const pressed = (lang || ORIGINAL) === value;
                return (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    // The bar is near black: the picked language takes the brand fill and a tick, never a grey that vanishes.
                    className="text-caption text-meeting-bar-foreground hover:bg-meeting-bar-chip-hover hover:text-meeting-bar-foreground aria-pressed:bg-brand aria-pressed:font-semibold aria-pressed:text-brand-foreground aria-pressed:hover:bg-brand/90 aria-pressed:hover:text-brand-foreground pointer-coarse:min-h-11"
                  >
                    {pressed ? <Check aria-hidden className="size-3.5" /> : null}
                    {t(key)}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          ) : null}
        </div>
        {/* Three lines at most, newest at the bottom: older words slide off the top. */}
        <div aria-hidden className="flex max-h-[3lh] flex-col justify-end overflow-hidden text-body">
          {lines.length === 0 ? (
            <p className="text-meeting-bar-foreground">{t("meetings.captionsListening")}</p>
          ) : (
            lines.map((l) => (
              <p key={l.segmentId} data-final={l.final ? "1" : "0"}>
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
