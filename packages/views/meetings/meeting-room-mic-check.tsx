"use client";
import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Asks for the microphone on its own. With the camera off (or refused) the
 * preview never triggers a prompt, so the mic list would stay empty with no
 * way forward; this is that way. The stream is closed at once — it only
 * unlocks device labels, then `onGranted` re-lists them.
 */
export function MeetingMicPermissionAction({ onGranted }: { onGranted: () => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "asking" | "denied">("idle");
  const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!md?.getUserMedia) return null;

  const ask = async () => {
    setState("asking");
    try {
      const stream = await md.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      setState("idle");
      onGranted();
    } catch {
      setState("denied");
    }
  };

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={state === "asking"}
        aria-busy={state === "asking" || undefined}
        onClick={() => void ask()}
      >
        <Mic aria-hidden className="size-3.5" />
        {t("meetings.micAllow")}
      </Button>
      {state === "denied" ? (
        <p role="alert" className="text-caption text-destructive">
          {t("meetings.micAllowDenied")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A thin input-level bar, so the viewer can see the chosen microphone hears
 * them before joining. Reads a few times a second, not every frame, and
 * without an easing transition when reduced motion is asked for.
 */
export function MeetingMicLevel({ deviceId, className }: { deviceId?: string; className?: string }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion() ?? false;
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    const Ctor = audioContextCtor();
    if (!md?.getUserMedia || !Ctor) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    void md
      .getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true })
      .then((s) => {
        if (cancelled) {
          for (const track of s.getTracks()) track.stop();
          return;
        }
        stream = s;
        ctx = new Ctor();
        // Opened straight from a link, the page has had no user gesture and
        // the context starts suspended: the analyser would read only silence.
        if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        timer = setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += ((v - 128) / 128) ** 2;
          const rms = Math.sqrt(sum / samples.length);
          setLevel(Math.min(100, Math.round(rms * 300)));
        }, 150);
      })
      .catch(() => setLevel(0));

    return () => {
      cancelled = true;
      clearInterval(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
      void ctx?.close();
      setLevel(0);
    };
  }, [deviceId]);

  return (
    <div
      role="meter"
      aria-label={t("meetings.micLevel")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={level}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      data-testid="meeting-mic-level"
    >
      <div
        className={cn("h-full rounded-full bg-success", !reduceMotion && "transition-[width] duration-fast")}
        style={{ width: `${level}%` }}
      />
    </div>
  );
}
