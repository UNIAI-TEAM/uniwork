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

/**
 * Turns the local microphone into transcript lines. Interim text shows in
 * the overlay; each final sentence is posted to the server so everyone's
 * transcript (and the AI summary) has it. Runs only while `enabled`.
 */
export function useLiveCaptions(meetingId: string, enabled: boolean) {
  const { i18n } = useTranslation();
  const append = useAppendTranscript(meetingId);
  const [interim, setInterim] = useState("");
  const [lastFinal, setLastFinal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const appendRef = useRef(append.mutate);
  appendRef.current = append.mutate;

  useEffect(() => {
    if (!enabled) {
      setInterim("");
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError("unsupported");
      return;
    }
    let stopped = false;
    const rec = new Ctor();
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
      // "no-speech" and "aborted" are routine; anything else surfaces once.
      if (e.error && e.error !== "no-speech" && e.error !== "aborted")
        setError(e.error);
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
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "start_failed");
    }
    return () => {
      stopped = true;
      rec.onend = null;
      rec.stop();
    };
  }, [enabled, meetingId, i18n.language]);

  return { interim, lastFinal, error };
}

export function MeetingCaptionsOverlay({
  interim,
  lastFinal,
  className,
  embedded = false,
}: {
  interim: string;
  lastFinal: string;
  className?: string;
  /** When true, sits in the stage footer stack instead of absolute positioning. */
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const text = interim || lastFinal;
  return (
    <>
      {/* Interim words change several times a second; only finished sentences reach assistive tech. */}
      <p className="sr-only" aria-live="polite">
        {lastFinal}
      </p>
      <div
        aria-hidden
        className={cn(
          embedded
            ? "pointer-events-none w-full max-w-3xl"
            : "pointer-events-none absolute inset-x-0 bottom-16 z-10 flex justify-center px-4",
          className,
        )}
        data-testid="meeting-captions"
      >
        <p className="rounded-xl bg-background/90 px-4 py-2 text-center text-body text-foreground ring-1 ring-border backdrop-blur-md">
          {text || t("meetings.captionsListening")}
        </p>
      </div>
    </>
  );
}
