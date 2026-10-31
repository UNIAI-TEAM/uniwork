"use client";
import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

type AudioContextCtor = new () => AudioContext;

export function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Asks for one kind of device on its own. Until the browser grants access it
 * lists devices without ids or labels, so a picker would stay empty with no
 * way forward (with the camera off or refused the preview never prompts);
 * this is that way. The stream is closed at once — it only unlocks device
 * labels, then `onGranted` re-lists them. Stays in the tab order while it
 * asks (`aria-disabled`), so a keyboard user keeps their place.
 */
export function MeetingMediaPermissionAction({
  kind = "audio",
  label,
  icon: Icon,
  deniedMessage,
  onGranted,
}: {
  kind?: "audio" | "video";
  label: string;
  icon?: LucideIcon;
  deniedMessage: string;
  onGranted: () => void;
}) {
  const [state, setState] = useState<"idle" | "asking" | "denied">("idle");
  const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!md?.getUserMedia) return null;

  const ask = async () => {
    if (state === "asking") return;
    setState("asking");
    try {
      const stream = await md.getUserMedia({ [kind]: true });
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
        aria-disabled={state === "asking" || undefined}
        aria-busy={state === "asking" || undefined}
        onClick={() => void ask()}
      >
        {Icon ? <Icon aria-hidden className="size-3.5" /> : null}
        {label}
      </Button>
      {state === "denied" ? (
        <p role="alert" className="text-caption text-destructive">
          {deniedMessage}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The input level (0–100) of a microphone, read a few times a second, not
 * every frame. Given `track` (the mic already published in a room) it listens
 * to that one; a second capture of the same device can reconfigure it
 * (Bluetooth headsets drop to call quality) under what everyone else hears.
 */
function useMicLevel(deviceId?: string, track?: MediaStreamTrack): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    const Ctor = audioContextCtor();
    if (!Ctor || (!track && !md?.getUserMedia)) return;
    let cancelled = false;
    // Only a stream this meter opened is stopped on the way out; a borrowed
    // track keeps playing to the room.
    let owned: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    const source: Promise<MediaStream> = track
      ? Promise.resolve(new MediaStream([track]))
      : md!.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true }).then((s) => {
          owned = s;
          return s;
        });

    void source
      .then((s) => {
        if (cancelled) {
          for (const t of owned?.getTracks() ?? []) t.stop();
          return;
        }
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
      for (const t of owned?.getTracks() ?? []) t.stop();
      void ctx?.close();
      setLevel(0);
    };
  }, [deviceId, track]);

  return level;
}

/**
 * A thin input-level bar, so the viewer can see the chosen microphone hears
 * them; without an easing transition when reduced motion is asked for.
 */
export function MeetingMicLevel({
  deviceId,
  track,
  className,
}: {
  deviceId?: string;
  track?: MediaStreamTrack;
  className?: string;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion() ?? false;
  const level = useMicLevel(deviceId, track);

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

// Taller in the middle, so five dots read as a voice rather than a bar chart.
const DOT_SHAPE = [0.6, 0.85, 1, 0.85, 0.6] as const;

/**
 * Five dots that stretch with the voice, drawn inside the mic picker in the
 * prejoin (UNI-2285 D). `level` is 0–1. Under reduced motion the dots keep
 * their resting height and only brighten while the mic hears something.
 */
export function MeetingMicDots({ level, className }: { level: number; className?: string }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion() ?? false;
  const value = Math.round(Math.min(1, Math.max(0, level)) * 100);
  const hearing = value >= 10;
  return (
    <span
      role="meter"
      aria-label={t("meetings.micLevel")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      data-slot="mic-dots"
      data-motion-loop={reduceMotion ? undefined : ""}
      className={cn("inline-flex h-5 items-center gap-0.75", className)}
    >
      {DOT_SHAPE.map((shape, i) => (
        <span
          key={i}
          data-mic-dot=""
          className={cn(
            "w-1.25 rounded-full bg-success-solid",
            hearing ? "opacity-100" : "opacity-45",
            !reduceMotion && "transition-[height,opacity] duration-fast ease-out-quart",
          )}
          style={{ height: `${reduceMotion ? 5 : 5 + 14 * (value / 100) * shape}px` }}
        />
      ))}
    </span>
  );
}

/** The dots, listening to the chosen microphone. */
export function MeetingMicDotsLive({ deviceId, className }: { deviceId?: string; className?: string }) {
  return <MeetingMicDots level={useMicLevel(deviceId) / 100} className={className} />;
}
