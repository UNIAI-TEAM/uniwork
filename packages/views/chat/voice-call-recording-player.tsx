"use client";

import { useRef, useState } from "react";
import { Maximize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { formatVoiceCallDuration } from "./voice-call-duration";

/** A thin track with its filled part and thumb; the real <input type="range"> sits invisibly on top. */
function Track({
  label,
  valueText,
  value,
  max,
  step,
  fill,
  onChange,
  className,
}: {
  label: string;
  valueText?: string;
  value: number;
  max: number;
  step: number;
  /** The filled part: the call's speaking blue for position, white for volume. */
  fill: string;
  onChange: (value: number) => void;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className={cn("relative h-6", className)}>
      <span aria-hidden className="absolute inset-x-0 top-2.5 h-1 rounded-full bg-foreground/20" />
      <span aria-hidden className={cn("absolute top-2.5 left-0 h-1 rounded-full", fill)} style={{ width: `${pct}%` }} />
      <span
        aria-hidden
        className="absolute top-1.25 size-3.5 -translate-x-1/2 rounded-full bg-foreground shadow-md"
        style={{ left: `${pct}%` }}
      />
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.target.value))}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </span>
  );
}

const ROUND = "size-11 shrink-0 rounded-full";

/**
 * The recording on the call's dark letterbox with the canvas' own bar: play,
 * where it is, seek, the length, sound and fullscreen. Every control is a
 * real button or range, named, so the keyboard drives it like the native one.
 */
export function VoiceCallRecordingPlayer({ src, onError }: { src: string; onError: () => void }) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const total = Number.isFinite(duration) ? duration : 0;
  const format = (seconds: number) => formatVoiceCallDuration(Math.floor(seconds));

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  return (
    <div ref={frameRef} className="dark relative h-[378px] overflow-hidden rounded-[14px] bg-call-plane text-foreground">
      <div className="absolute inset-x-0 top-0 bottom-16.5">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- recorded call playback has no caption track */}
        <video
          ref={videoRef}
          className="size-full object-contain"
          playsInline
          preload="metadata"
          src={src}
          onError={onError}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onDurationChange={(event) => setDuration(event.currentTarget.duration)}
          onVolumeChange={(event) => {
            setVolume(event.currentTarget.volume);
            setMuted(event.currentTarget.muted);
          }}
        />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-16.5 items-center gap-3 pr-3.5 pl-4">
        <Button
          type="button"
          size="icon"
          className={cn(ROUND, "bg-foreground text-call-plane hover:bg-foreground/90")}
          aria-label={playing ? t("chat.voice_recording_pause") : t("chat.voice_recordings_play")}
          onClick={toggle}
        >
          {playing ? <Pause aria-hidden className="size-4.5 fill-current" /> : <Play aria-hidden className="size-4.5 fill-current" />}
        </Button>
        <span className="shrink-0 text-label font-semibold tabular-nums">{format(position)}</span>
        <Track
          className="flex-1"
          label={t("chat.voice_recording_seek")}
          valueText={t("chat.message_list.voice_position", { position: format(position), duration: format(total) })}
          value={position}
          max={total}
          step={1}
          fill="bg-call-speaking"
          onChange={(value) => {
            if (videoRef.current) videoRef.current.currentTime = value;
          }}
        />
        <span className="shrink-0 text-label text-call-muted-foreground tabular-nums">{format(total)}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(ROUND, "hover:bg-meeting-bar-chip-bg dark:hover:bg-meeting-bar-chip-bg")}
          aria-label={muted ? t("chat.voice_recording_unmute") : t("chat.voice_recording_mute")}
          onClick={() => {
            if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
          }}
        >
          {muted ? <VolumeX aria-hidden className="size-5" /> : <Volume2 aria-hidden className="size-5" />}
        </Button>
        <Track
          className="-ml-1.5 w-18 shrink-0"
          label={t("chat.voice_recording_volume")}
          value={muted ? 0 : Math.round(volume * 100)}
          max={100}
          step={5}
          fill="bg-foreground"
          onChange={(value) => {
            const video = videoRef.current;
            if (!video) return;
            video.volume = value / 100;
            video.muted = value === 0;
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(ROUND, "hover:bg-meeting-bar-chip-bg dark:hover:bg-meeting-bar-chip-bg")}
          aria-label={t("meetings.fullscreenEnter")}
          onClick={() => void frameRef.current?.requestFullscreen?.().catch(() => undefined)}
        >
          <Maximize aria-hidden className="size-4.5" />
        </Button>
      </div>
    </div>
  );
}
