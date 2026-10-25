"use client";
import { memo, useEffect, useRef, useState } from "react";
import { useRemoteParticipants, useRoomContext } from "@livekit/components-react";
import { type Room, RoomEvent } from "livekit-client";
import { ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { type CaptionLanguage, useSetCaptionLanguage } from "@uniwork/core/meetings/captions";
import { ScribeMark, ScribeVoiceLine } from "@uniwork/ui/brand/scribe-mark";
import { type Tint, tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { cn } from "@uniwork/ui/lib/utils";
import { MEETING_AVATAR_TINTS } from "./meeting-detail/avatar-tint";
import { CaptionText, useCaptionScroll, useLanguageThumb } from "./meeting-scribe-caption-motion";
import { MeetingPersonAvatar } from "./meeting-person";
import { useRoomAvatarOf } from "./meeting-room-avatars";

/** The text-stream topic the AI scribe publishes captions on (spec D7). */
export const SCRIBE_CAPTION_TOPIC = "uw.caption";
// The lines a viewer can scroll back through; the whole meeting is in the transcript tab.
const KEPT_LINES = 50;
// Translations kept for the lines on screen and a few that may still arrive.
const KEPT_TRANSLATIONS = 60;
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
  /** The text shown is the picked language's translation, not what was said. */
  translated?: boolean;
  /** A final still waiting a short while for its translation. */
  pending?: boolean;
};

/** The topic one language's translated captions ride on (spec §5.3). */
export function scribeTranslationTopic(lang: string): string {
  return `${SCRIBE_CAPTION_TOPIC}.${lang}`;
}

/**
 * Applies one caption from the agent: the interim and final texts of a
 * segment share its id and the newer one replaces the older in place; a
 * final is never overwritten by an interim that arrives late. The newest
 * KEPT_LINES segments stay.
 */
export function applyScribeCaption(lines: readonly ScribeCaption[], c: ScribeCaption): ScribeCaption[] {
  const at = lines.findIndex((l) => l.segmentId === c.segmentId);
  if (at < 0) return [...lines, c].slice(-KEPT_LINES);
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

/** The agent's own attribute: "degraded" while its speech recognition fails and it retries (benchmark #1). */
export const SCRIBE_STATE_ATTRIBUTE = "uw.scribe_state";

/**
 * The scribe is in the room but paused: its STT vendor fails. Only the
 * agent's attribute counts (it is the one participant that sets its own).
 * Each viewer then keeps their device captions on until it is back.
 */
export function useScribePaused(): boolean {
  return useRemoteParticipants({ updateOnlyOn: [RoomEvent.ParticipantAttributesChanged] }).some(
    (p) => p.isAgent && p.attributes?.[SCRIBE_STATE_ATTRIBUTE] === "degraded",
  );
}

/** How long the room shows a joining scribe before each viewer's device captions step in. */
const SCRIBE_JOIN_WAIT_MS = 30_000;

/**
 * True while the scribe is on its way in and not late yet: the captions say
 * it is joining instead of handing the viewer device captions for the few
 * seconds it takes. A dispatch no worker takes is sent again for minutes
 * without failing (server scribeCapacityWait), so past SCRIBE_JOIN_WAIT_MS
 * the device captions take over until it arrives.
 */
export function useScribeJoinWait(onItsWay: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!onItsWay) return;
    const id = window.setTimeout(() => setLate(true), SCRIBE_JOIN_WAIT_MS);
    return () => {
      window.clearTimeout(id);
      setLate(false);
    };
  }, [onItsWay]);
  return onItsWay && !late;
}

/** vi-VN and vi are the same caption language (the agent's base_language). */
function baseLanguage(language: string | undefined): string {
  return (language ?? "").slice(0, 2).toLowerCase();
}

type TranslationState = "idle" | "translating" | "original" | "skipped";

/** The lines the server would not translate, and why (the agent's uw.skipped, spec §5.3). */
type Skipped = { reason: string; ids: ReadonlySet<string> };
const NOTHING_SKIPPED: Skipped = { reason: "", ids: new Set() };

/** What the room says about a skip: the AI quota and a switched-off translation by name, anything else plainly. */
function skippedKey(reason: string): string {
  switch (reason) {
    case "ai_quota_exceeded":
      return "meetings.scribe.captionSkippedQuota";
    case "unavailable":
      return "meetings.scribe.captionSkippedOff";
    default:
      return "meetings.scribe.captionUntranslated";
  }
}

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
  const [skipped, setSkipped] = useState<Skipped>(NOTHING_SKIPPED);
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
    setSkipped(NOTHING_SKIPPED);
    if (!enabled || !lang) return;
    const topic = scribeTranslationTopic(lang);
    room.registerTextStreamHandler(topic, (reader, from) => {
      if (!room.getParticipantByIdentity(from.identity)?.isAgent) return;
      const a = reader.info.attributes ?? {};
      // The server skipped these lines (the AI quota is spent, say): they stay in the original, and the room says why.
      const reason = a["uw.skipped"];
      if (reason) {
        const ids = (a["uw.segment_ids"] ?? "").split(",").filter(Boolean);
        void reader.readAll().then(() => {
          setSkipped((prev) => ({ reason, ids: new Set([...prev.ids, ...ids].slice(-KEPT_TRANSLATIONS)) }));
        });
        return;
      }
      const segmentId = a["uw.segment_id"];
      if (!segmentId) return;
      void reader.readAll().then((text) => {
        setTranslated((prev) => new Map([...prev, [segmentId, text] as const].slice(-KEPT_TRANSLATIONS)));
      });
    });
    return () => room.unregisterTextStreamHandler(topic);
  }, [room, enabled, lang]);
  // A final said in the picked language needs nothing; one in another waits for its translation.
  const awaiting = (l: ScribeCaption) =>
    Boolean(lang) &&
    l.final &&
    baseLanguage(l.language) !== lang &&
    !translated.has(l.segmentId) &&
    !skipped.ids.has(l.segmentId);
  const waiting = (l: ScribeCaption) => awaiting(l) && now - (l.finalAt ?? 0) < TRANSLATION_WAIT_MS;
  const deadline = lines.filter(waiting).reduce((min, l) => Math.min(min, (l.finalAt ?? 0) + TRANSLATION_WAIT_MS), Infinity);
  useEffect(() => {
    if (deadline === Infinity) return;
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(id);
  }, [deadline]);
  // A line without its translation (yet) shows the original.
  const shown = lines.map((l) => {
    const text = lang && l.final ? translated.get(l.segmentId) : undefined;
    if (text !== undefined) return { ...l, text, translated: true };
    return waiting(l) ? { ...l, pending: true } : l;
  });
  const newestForeign = [...lines].reverse().find((l) => l.final && Boolean(lang) && baseLanguage(l.language) !== lang);
  const state: TranslationState = !newestForeign
    ? "idle"
    : skipped.ids.has(newestForeign.segmentId)
      ? "skipped"
      : !awaiting(newestForeign)
        ? "idle"
        : waiting(newestForeign)
          ? "translating"
          : "original";
  const ready = shown.filter((l) => l.final && !waiting(l));
  return { lines: shown, state, ready, skipReason: skipped.reason };
}

/**
 * Says the translation state once per picked language, not on every line:
 * a screen reader hears that captions are being translated, or that the
 * original is showing, the first time it happens.
 */
function useTranslationNotice(lang: CaptionLanguage, state: TranslationState, skipReason: string): string {
  const { t } = useTranslation();
  const [notice, setNotice] = useState("");
  const told = useRef(new Set<string>());
  useEffect(() => {
    told.current.clear();
    setNotice("");
  }, [lang]);
  // A skip is said once per reason: the quota running out is news, every line after it is not.
  const said = state === "skipped" ? `skipped:${skipReason}` : state;
  useEffect(() => {
    if (said === "idle" || told.current.has(said)) return;
    told.current.add(said);
    setNotice(
      t(
        state === "translating"
          ? "meetings.scribe.captionTranslating"
          : state === "skipped"
            ? skippedKey(skipReason)
            : "meetings.scribe.captionUntranslated",
      ),
    );
  }, [said, state, skipReason, t]);
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

const LANGUAGES = [
  [ORIGINAL, "meetings.scribe.captionOriginal", "meetings.scribe.captionOriginalShort"],
  ["vi", "meetings.scribe.captionVietnamese", "meetings.scribe.captionVietnameseShort"],
  ["en", "meetings.scribe.captionEnglish", "meetings.scribe.captionEnglishShort"],
] as const;

/**
 * How loud the room is now, 0–1, for the scribe's voice line. LiveKit reports
 * a linear level (10^(dBov/20)) in which speech sits around 0.03–0.3; the
 * square root spreads that over the line's range.
 */
function roomLoudness(room: Room): number {
  const level = room.activeSpeakers.reduce((max, p) => Math.max(max, p.audioLevel), 0);
  return Math.min(1, Math.sqrt(level) * 1.6);
}

/** A speaker keeps one tint wherever their name shows, without any state to hold it. */
function speakerTint(identity: string): Tint {
  let h = 0;
  for (const c of identity) h = (h * 31 + c.charCodeAt(0)) | 0;
  return MEETING_AVATAR_TINTS[Math.abs(h) % MEETING_AVATAR_TINTS.length]!;
}

/**
 * One caption line. Memoized on its own fields, so the fifty lines a viewer
 * can scroll back through stay still while interim words repaint the newest.
 */
const CaptionLine = memo(function CaptionLine({
  identity,
  name,
  avatarUrl,
  showWho,
  text,
  final,
  variant,
  pending,
}: {
  identity: string;
  name: string;
  avatarUrl: string | undefined;
  showWho: boolean;
  text: string;
  final: boolean;
  variant: string;
  pending: boolean;
}) {
  const tint = speakerTint(identity);
  return (
    <p data-final={final ? "1" : "0"} className="mt-0.5 first:mt-0">
      {showWho ? (
        <span
          className={cn(
            "me-2 inline-flex animate-caption-chip-in items-center gap-1.5 align-[1px] text-label leading-none font-semibold",
            tintForegroundClass[tint],
          )}
        >
          <MeetingPersonAvatar name={name} avatarUrl={avatarUrl} size={20} tint={tint} />
          {name}
        </span>
      ) : null}
      <CaptionText
        text={text}
        variant={variant}
        className={cn(
          "transition-colors duration-500",
          final ? "text-meeting-bar-foreground" : "text-meeting-bar-foreground/60",
          // Its translation is on its way: the line breathes until it arrives.
          pending && "animate-caption-breathe",
        )}
      />
    </p>
  );
});

/**
 * The room's captions from the AI scribe: who said it, interim words dimmed,
 * in the picked language. `joining`: the scribe is on its way in, and the box
 * says so until it arrives and starts listening. Looks and moves as the
 * preview the owner approved (artifact LbBoGwiRm919GYye1QMycB).
 */
export function MeetingScribeCaptions({
  enabled,
  meetingId,
  joining = false,
  className,
}: {
  enabled: boolean;
  meetingId?: string;
  joining?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const room = useRoomContext();
  const avatarOf = useRoomAvatarOf();
  const { lang, pick } = useCaptionLanguage(meetingId);
  const { lines, state, ready, skipReason } = useScribeCaptions(enabled, lang);
  const said = useSpokenOnce(ready);
  const notice = useTranslationNotice(lang, state, skipReason);
  const view = useRef<HTMLDivElement>(null);
  const { reading, unseen, latest } = useCaptionScroll(view, lines);
  const thumb = useLanguageThumb(lang || ORIGINAL);
  const nameOf = (identity: string) =>
    room.getParticipantByIdentity(identity)?.name || t("meetings.scribe.unknownSpeaker");
  const translating = state === "translating";
  return (
    // `dark`: the stage is dark in both themes; the footer sits outside its scope. A set width,
    // not w-full: the footer's stack fits its content, so the box would follow its longest line.
    <div className={cn("dark pointer-events-none w-180 max-w-full", className)} data-testid="meeting-scribe-captions">
      {/* Interim words change several times a second; only finished sentences reach assistive tech, each once. */}
      <p role="status" aria-live="polite" className="sr-only" data-testid="meeting-caption-announcer">
        {said.map((l) => `${nameOf(l.identity)}: ${l.text}`).join(" ")}
      </p>
      <p role="status" aria-live="polite" className="sr-only" data-testid="meeting-caption-translation-notice">
        {notice}
      </p>
      {/* Reading back, the box opens upwards over the stage: its negative margin keeps the room it takes in the
          footer, so the tiles never reflow while someone scrolls. */}
      <div
        data-reading={reading ? "" : undefined}
        className="relative isolate overflow-hidden rounded-2xl bg-meeting-caption-glass px-4 pt-2.5 pb-3.5 shadow-meeting-caption ring-1 ring-meeting-bar-border/60 backdrop-blur-[22px] backdrop-saturate-150 [--cap-lh:24px] max-sm:rounded-[18px] max-sm:px-3 max-sm:pt-2 max-sm:pb-3 sm:[--cap-lh:28px] data-reading:-mt-[calc(var(--cap-lh)*3.4)] data-reading:animate-caption-reveal"
      >
        {/* Joining or translating, the scribe is busy rather than listening: the light gathers and travels. */}
        <ScribeVoiceLine level={() => roomLoudness(room)} processing={joining || translating} />
        <div className="flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-1">
          <p
            aria-hidden
            className="flex items-center gap-2.5 text-caption font-medium tracking-[0.01em] text-meeting-bar-muted-foreground"
            data-testid="meeting-caption-label"
          >
            <ScribeMark state={joining ? "joining" : "live"} className="size-5" />
            <span className="max-sm:hidden">{t("meetings.scribe.captionsLabel")}</span>
            {/* Translating shows on the line and the thumb; a translation that will not come is said in words,
                as a warning when the server named why (the AI quota is spent, translation is off). */}
            {state === "skipped" ? (
              <span
                className="inline-flex min-h-[22px] animate-caption-chip-in items-center gap-1.5 rounded-[11px] bg-warning/12 px-2.5 py-0.5 font-semibold text-warning before:size-1.5 before:shrink-0 before:rounded-full before:bg-current"
                data-testid="meeting-caption-skipped"
              >
                {t(skippedKey(skipReason))}
              </span>
            ) : state === "original" ? (
              <span>{t("meetings.scribe.captionUntranslated")}</span>
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
              className="pointer-events-auto relative isolate ms-auto rounded-full bg-meeting-bar-chip-bg/60 p-[3px] ring-1 ring-meeting-bar-border/70"
            >
              {/* The picked language sits on a thumb that slides to it; it sweeps violet while a translation is on its way. */}
              <span
                ref={thumb}
                aria-hidden
                data-testid="meeting-caption-language-thumb"
                data-language={lang || ORIGINAL}
                className={cn(
                  "absolute inset-y-[3px] left-0 -z-10 rounded-full shadow-surface ring-1 ring-meeting-bar-chip-hover/80 data-placed:transition-[transform,width] data-placed:duration-[420ms] data-placed:ease-[cubic-bezier(0.3,1.3,0.5,1)]",
                  translating ? "animate-caption-thumb-sweep" : "bg-meeting-bar-chip-hover/80",
                )}
              />
              {LANGUAGES.map(([value, name, short]) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  aria-label={t(name)}
                  title={t(name)}
                  className="h-[26px] min-w-[38px] text-caption font-semibold tracking-[0.02em] text-meeting-bar-muted-foreground group-data-[spacing=0]/toggle-group:rounded-full group-data-[spacing=0]/toggle-group:px-2.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-full group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-full hover:bg-transparent hover:text-meeting-bar-foreground aria-pressed:bg-transparent aria-pressed:text-meeting-bar-foreground pointer-coarse:min-h-11"
                >
                  {t(short)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}
        </div>
        {/* Two lines in full, the one before fading out at the top edge as the newest wraps in below. Scrolled
            back, it opens to six and new lines wait below until the viewer comes back down. */}
        <div
          ref={view}
          role="region"
          aria-label={t("meetings.scribe.captionsHistory")}
          // A scroll region keyboard users can reach (WCAG 2.1.1); the live announcer above stays the screen reader's feed.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          data-reading={reading ? "" : undefined}
          className="pointer-events-auto relative mt-1.5 flex h-[calc(var(--cap-lh)*2.6)] flex-col overflow-y-auto overscroll-contain rounded-md text-title-sm leading-(--cap-lh) font-medium tracking-[-0.006em] [mask-image:linear-gradient(to_bottom,transparent,black_calc(1lh*0.95))] [scrollbar-width:none] sm:text-title data-reading:h-[calc(var(--cap-lh)*6)] data-reading:pe-10 [&::-webkit-scrollbar]:hidden"
        >
          {/* mt-auto, not justify-end: a column justified to its end cannot scroll back to what overflows its start. */}
          <div className="mt-auto">
            {lines.length === 0 ? (
              <p className="animate-caption-listening text-meeting-bar-muted-foreground">
                {/* Keyed so "joining" gives way to "listening" the way a caption word arrives. */}
                <span key={joining ? "joining" : "listening"} className="inline-block animate-caption-word-in">
                  {t(joining ? "meetings.scribe.chipJoining" : "meetings.captionsListening")}
                </span>
              </p>
            ) : (
              lines.map((l, i) => (
                <CaptionLine
                  key={l.segmentId}
                  identity={l.identity}
                  name={nameOf(l.identity)}
                  avatarUrl={avatarOf(l.identity)}
                  // The speaker shows when the voice changes, not on every line they say.
                  showWho={i === 0 || lines[i - 1]?.identity !== l.identity}
                  text={l.text}
                  final={l.final}
                  variant={l.translated ? `t:${lang}` : "o"}
                  pending={Boolean(l.pending)}
                />
              ))
            )}
          </div>
        </div>
        {reading ? (
          <Button
            type="button"
            variant="meetingChip"
            size="icon"
            onClick={latest}
            aria-label={t("meetings.scribe.captionsLatest")}
            title={t("meetings.scribe.captionsLatest")}
            data-testid="meeting-caption-latest"
            className="pointer-events-auto absolute right-3 bottom-3 z-10 animate-caption-chip-in rounded-full"
          >
            <ArrowDown aria-hidden className="size-4" />
            {/* New lines came while reading back. */}
            {unseen ? (
              <span aria-hidden data-testid="meeting-caption-unseen" className="absolute top-0.5 right-0.5 size-2 rounded-full bg-tint-violet-foreground" />
            ) : null}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
