"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppendTranscript } from "@uniwork/core/meetings";
import { cn } from "@uniwork/ui/lib/utils";

// Web Speech API is prefixed in Chromium and absent from the TS DOM lib
// in some configurations; this is the minimal surface we touch.
type RecognitionAlternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; 0: RecognitionAlternative };
type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
};
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function captionsSupported(): boolean {
  return recognitionCtor() !== null;
}

export function captionLang(locale: string): string {
  return locale.startsWith("en") ? "en-US" : "vi-VN";
}

/** Recognition errors that are part of normal operation, not a failure. */
const ROUTINE_ERRORS = new Set(["no-speech", "aborted"]);

/**
 * Turns the local microphone into transcript lines. Interim text shows in
 * the overlay; each final sentence is posted to the server so everyone's
 * transcript (and the AI summary) has it. Runs only while `enabled`.
 *
 * `onError` fires once for a failure the viewer must hear about (a blocked
 * microphone, an unsupported browser); the caller turns captions off, so the
 * overlay never sits on "listening" while nothing listens.
 */
export function useLiveCaptions(
  meetingId: string,
  enabled: boolean,
  onError?: (code: string) => void,
) {
  const { i18n } = useTranslation();
  const append = useAppendTranscript(meetingId);
  const [interim, setInterim] = useState("");
  const [lastFinal, setLastFinal] = useState("");
  const appendRef = useRef(append.mutate);
  appendRef.current = append.mutate;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled) {
      setInterim("");
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) {
      onErrorRef.current?.("unsupported");
      return;
    }
    let stopped = false;
    const rec = new Ctor();
    const fail = (code: string) => {
      if (stopped) return;
      stopped = true;
      rec.onend = null;
      onErrorRef.current?.(code);
    };
    rec.lang = captionLang(i18n.language);
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        const text = r[0].transcript.trim();
        if (!text) continue;
        if (r.isFinal) {
          setLastFinal(text);
          appendRef.current({ text, spokenAt: new Date().toISOString() });
        } else {
          partial += (partial ? " " : "") + text;
        }
      }
      setInterim(partial);
    };
    rec.onerror = (e) => {
      if (e.error && !ROUTINE_ERRORS.has(e.error)) fail(e.error);
    };
    // Chromium stops continuous recognition after a silence; restart until told otherwise.
    rec.onend = () => {
      if (!stopped) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }
    };
    try {
      rec.start();
    } catch (err) {
      fail(err instanceof Error ? err.message : "start_failed");
    }
    return () => {
      stopped = true;
      rec.onend = null;
      rec.stop();
    };
  }, [enabled, meetingId, i18n.language]);

  return { interim, lastFinal };
}

/** Recognition errors that mean the browser or the viewer blocked the microphone. */
export function captionsErrorKey(code: string): string {
  return code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture"
    ? "meetings.captionsMicBlocked"
    : code === "unsupported"
      ? "meetings.captionsUnsupported"
      : "meetings.captionsFailed";
}

/**
 * Captions from the viewer's own microphone (Web Speech), labelled as such:
 * they are automatic, and they are not the room's captions.
 */
export function MeetingCaptionsOverlay({
  interim,
  lastFinal,
  className,
}: {
  interim: string;
  lastFinal: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const text = interim || lastFinal;
  return (
    <div className={cn("pointer-events-none w-full max-w-3xl", className)} data-testid="meeting-captions">
      {/* Interim words change several times a second; only finished sentences reach assistive tech. */}
      <p role="status" aria-live="polite" className="sr-only">
        {lastFinal}
      </p>
      <div className="rounded-xl bg-meeting-bar-bg px-4 py-2 text-center ring-1 ring-meeting-bar-border">
        <p className="text-caption text-meeting-bar-muted-foreground">{t("meetings.captionsAutoLabel")}</p>
        <p aria-hidden className="text-body text-meeting-bar-foreground">
          {text || t("meetings.captionsListening")}
        </p>
      </div>
    </div>
  );
}
