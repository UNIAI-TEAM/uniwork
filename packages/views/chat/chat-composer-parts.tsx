"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Ban, Bell, CircleAlert, Eye, FileText, Lock, MicOff, Pause, Pencil, Play, Send, Square, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ComposerMessagePriority } from "@uniwork/core/chat/composer-priority";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { CHAT_FILE_MAX_LABEL, isChatImageFile } from "./chat-file-accept";
import { formatChatFileSize } from "./chat-file-size";
import { CHAT_ON_BUBBLE_FILL, CHAT_ON_BUBBLE_LINE } from "./chat-message-row";
import { COMPOSER_QUOTE_BAR_CLASS } from "./chat-reply-quote";
import type { ChatVoiceRecorderError, ChatVoiceRecording, ChatVoiceRecorderState } from "./use-chat-voice-recorder";
import { formatVoiceCallDuration } from "./voice-call-duration";

const VOICE_MAX_SECONDS = 120;
/** Bars in the live wave while recording, and in the clip's shape before sending (canvas). */
const LIVE_BARS = 64;
const CLIP_BARS = 48;

/** A bar's height in px for a 0–1 loudness: never flat, never past the 28px lane. */
function barHeight(level: number): number {
  return Math.round(4 + Math.min(1, Math.max(0, level)) * 22);
}

/** The whole clip's loudness folded into `count` bars (the loudest sample of each slice). */
export function clipShape(levels: readonly number[], count: number): number[] {
  if (levels.length === 0) return Array.from({ length: count }, () => 0);
  return Array.from({ length: count }, (_, index) => {
    const from = Math.floor((index * levels.length) / count);
    const to = Math.max(from + 1, Math.floor(((index + 1) * levels.length) / count));
    return Math.max(...levels.slice(from, to));
  });
}

/**
 * The recorded clip, played back before it is sent: play/pause, its shape
 * filling in as it plays (a range over it seeks), and where it is (canvas).
 */
function VoiceClipPreview({ recording, levels }: { recording: ChatVoiceRecording; levels: readonly number[] }) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const durationMs = recording.durationMs;
  const played = durationMs > 0 ? Math.min(positionMs / durationMs, 1) : 0;
  const bars = clipShape(levels, CLIP_BARS);
  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the person's own clip, played back before sending; there is no caption track */}
      <audio
        ref={audioRef}
        src={recording.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPositionMs(0);
        }}
        onTimeUpdate={(event) => setPositionMs(event.currentTarget.currentTime * 1000)}
      />
      <Button
        type="button"
        size="icon"
        className="size-8 shrink-0 rounded-full"
        aria-label={playing ? t("chat.voice_pause") : t("chat.voice_play")}
        onClick={toggle}
      >
        {playing ? <Pause className="size-3.5 fill-current" aria-hidden /> : <Play className="size-3.5 fill-current" aria-hidden />}
      </Button>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-caption text-muted-foreground">{t("chat.composer_state.preview")}</span>
        <span className="relative flex h-5 items-center gap-0.5 overflow-hidden rounded-sm has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-ring">
          {bars.map((level, index) => (
            <span
              key={index}
              aria-hidden
              className={cn("w-0.75 shrink-0 rounded-xs", index / CLIP_BARS < played ? "bg-brand" : "bg-faint-foreground/45")}
              style={{ height: Math.max(3, Math.round(barHeight(level) * 0.7)) }}
            />
          ))}
          <input
            type="range"
            min={0}
            max={durationMs}
            step={100}
            value={Math.min(positionMs, durationMs)}
            aria-label={t("chat.message_list.voice_seek")}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (audioRef.current) audioRef.current.currentTime = next / 1000;
              setPositionMs(next);
            }}
            className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
          />
        </span>
      </span>
      <span className="shrink-0 text-caption text-foreground tabular-nums">
        {`${formatVoiceCallDuration(Math.floor(positionMs / 1000))} / ${formatVoiceCallDuration(Math.round(durationMs / 1000))}`}
      </span>
    </span>
  );
}

/** A file waiting in the composer: a thumbnail or kind icon, its name, size and a way to take it back out. */
export function StagedFileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const { t, i18n } = useTranslation();
  const isImage = isChatImageFile(file);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setPreviewUrl(null);
    };
  }, [file, isImage]);

  return (
    <span
      className={cn(
        "inline-flex h-16 w-64 max-w-full shrink-0 items-center gap-2.5 rounded-xl border py-1.5 pr-1 pl-1.5",
        CHAT_ON_BUBBLE_LINE,
        CHAT_ON_BUBBLE_FILL,
      )}
    >
      {isImage && previewUrl ? (
        <img src={previewUrl} alt={file.name} className="size-12 shrink-0 rounded-control bg-surface object-cover" />
      ) : (
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-control bg-brand-subtle text-brand-subtle-foreground"
          aria-hidden
        >
          <FileText className="size-5.5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-label font-semibold text-foreground">{file.name}</span>
        <span className="block text-caption text-muted-foreground tabular-nums">
          {formatChatFileSize(file.size, i18n.language)}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 shrink-0 rounded-control text-muted-foreground hover:text-foreground"
        aria-label={t("chat.composer_remove_file", { name: file.name })}
        title={t("chat.composer_remove_file", { name: file.name })}
        onClick={onRemove}
      >
        <X aria-hidden />
      </Button>
    </span>
  );
}

export function ComposerPriorityChip({
  priority,
  onClear,
}: {
  priority: ComposerMessagePriority;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const Icon = priority === "important" ? CircleAlert : Bell;
  const label = priority === "important" ? t("chat.message_flag_important") : t("chat.message_flag_urgent");

  return (
    <span
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full pr-0.75 pl-2.5 text-label font-semibold",
        priority === "urgent"
          ? "bg-destructive-soft text-destructive-soft-foreground"
          : "bg-warning-soft text-warning-soft-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      {/* The visible words are the button's name too. */}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="ml-1 h-5.5 shrink-0 rounded-full bg-current/10 px-2.5 font-semibold text-current hover:bg-current/15 hover:text-current"
        aria-label={t("chat.composer_clear_priority")}
        onClick={onClear}
      >
        {t("chat.composer_clear_priority")}
      </Button>
    </span>
  );
}

/**
 * Above the field while a sent message is being edited: what is being
 * edited, how to leave, and the way out. Esc and Enter are handled by the field.
 */
export function ComposerEditBar({ preview, onCancel }: { preview: string; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    // A container: the hint shows by the field's own width, so the 400px thread panel on a wide screen drops it too.
    <div className={cn("@container", COMPOSER_QUOTE_BAR_CLASS)}>
      <Pencil className="size-4.5 shrink-0 text-brand" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col py-0.5">
        <span className="truncate text-label font-semibold text-brand">{t("chat.editing_message")}</span>
        <span className="truncate text-label text-muted-foreground">{preview}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-1.5 text-caption text-muted-foreground @lg:inline-flex">
        <kbd className="rounded-md border border-border bg-surface px-1.5 text-micro font-semibold text-foreground">
          {t("chat.mention_keys_close_key")}
        </kbd>
        {t("chat.editing_hint")}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-10 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
        aria-label={t("chat.editing_cancel")}
        title={t("chat.editing_cancel")}
        onClick={onCancel}
      >
        <X className="size-4.5" aria-hidden />
      </Button>
    </div>
  );
}

/** Why the room is read-only for this person; each reason has its own mark. */
export type ComposerReadOnlyReason = "muted" | "restricted" | "blocked";

const READ_ONLY_ICONS: Record<ComposerReadOnlyReason, typeof Eye> = {
  muted: Eye,
  restricted: Lock,
  blocked: Ban,
};

/**
 * The composer of a room this person may only read: one centred line on the
 * wall instead of a greyed-out field. The disabled field is still here (its
 * placeholder is the line's text), so the control and its name stay what
 * assistive tech and tests already find.
 */
export function ComposerReadOnlyBar({
  reason,
  placeholder,
  textareaRef,
  blockedByMe = false,
  onUnblock,
  unblocking = false,
}: {
  reason: ComposerReadOnlyReason;
  placeholder: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** A blocked DM: I blocked them (else they blocked me). */
  blockedByMe?: boolean;
  /** "Bỏ chặn" in the pill, when I blocked them. */
  onUnblock?: () => void;
  unblocking?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = READ_ONLY_ICONS[reason];
  if (reason === "blocked") {
    // A white pill where the field was: who blocked whom, and the way back when it was me (canvas).
    return (
      <div className="mx-auto flex min-h-13 w-full max-w-183 items-center gap-2.5 rounded-full bg-chat-bubble-other py-1.5 pr-2 pl-4 shadow-chat-bubble">
        <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <p role="status" className="min-w-0 flex-1 text-body text-chat-chip-foreground">
          {blockedByMe ? t("chat.block_active_banner") : t("chat.blocked_me_banner")}
        </p>
        {/* The disabled field stays for assistive tech and tests, out of sight. */}
        <Textarea ref={textareaRef} disabled rows={1} aria-label={placeholder} className="sr-only" tabIndex={-1} />
        {blockedByMe && onUnblock ? (
          <Button
            type="button"
            variant="ghost"
            className="h-10 shrink-0 rounded-full bg-brand-subtle px-4.5 font-semibold text-brand hover:bg-brand-subtle/80 hover:text-brand"
            aria-disabled={unblocking || undefined}
            onClick={() => {
              if (!unblocking) onUnblock();
            }}
          >
            {unblocking ? t("chat.unblocking_user") : t("chat.unblock_user")}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="mx-auto flex min-h-12 w-full max-w-183 items-center justify-center gap-2.5 rounded-3xl bg-chat-chip px-5 py-2 shadow-chat-bubble">
      <Icon className="size-4.5 shrink-0 text-muted-foreground" aria-hidden />
      {/* The hidden copy sizes the box the field fills, so the icon and the words centre together. */}
      <span className="relative min-w-0 text-center text-body">
        <span aria-hidden className="invisible block">
          {placeholder}
        </span>
        <Textarea
          ref={textareaRef}
          disabled
          rows={1}
          placeholder={placeholder}
          aria-label={placeholder}
          className="absolute inset-0 h-full min-h-0 resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 text-center text-body shadow-none placeholder:text-muted-foreground disabled:cursor-default disabled:bg-transparent disabled:opacity-100 md:text-body dark:bg-transparent dark:disabled:bg-transparent"
        />
      </span>
    </div>
  );
}

const VOICE_ERROR_KEYS: Record<ChatVoiceRecorderError, string> = {
  denied: "chat.composer_state.error_denied",
  no_device: "chat.composer_state.error_no_device",
  busy: "chat.composer_state.error_busy",
  unsupported: "chat.composer_state.error_unsupported",
  failed: "chat.voice_record_failed",
  upload: "chat.composer_state.error_upload",
};

/**
 * The composer while a voice message is being made: recording (a live red
 * dot and a timer, Stop to listen back, Send), ready (a player to check the
 * clip before it goes), sending, or what went wrong in words that say what
 * to do about it. Focus comes here when recording starts.
 */
export function ComposerVoiceBar({
  state,
  error,
  elapsedMs,
  recording,
  levels = [],
  canSend,
  onCancel,
  onStop,
  onSend,
  textareaRef,
}: {
  state: ChatVoiceRecorderState;
  error: ChatVoiceRecorderError | null;
  elapsedMs: number;
  recording: ChatVoiceRecording | null;
  /** The microphone's loudness so far, 0–1 per tick (useChatVoiceRecorder). */
  levels?: readonly number[];
  canSend: boolean;
  onCancel: () => void;
  onStop: () => void;
  onSend: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const recordingNow = state === "recording";
  const hasClip = state === "ready" && Boolean(recording);
  const sendEnabled = canSend && (recordingNow || hasClip);

  // Recording takes the keyboard to its own controls; the textarea is gone.
  useEffect(() => {
    if (state === "recording" || (state === "idle" && error)) cancelRef.current?.focus();
  }, [error, state]);
  // And gives it back when the bar goes away.
  useEffect(
    () => () => {
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [textareaRef],
  );

  const busy = state === "requesting" || state === "uploading";
  const elapsed = formatVoiceCallDuration(Math.floor(elapsedMs / 1000));
  const limit = formatVoiceCallDuration(VOICE_MAX_SECONDS);

  return (
    <div className="mx-auto flex w-full max-w-183 items-center gap-2">
      <div
        className={cn(
          "flex min-h-12 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-3xl py-1.5 pr-1.5 pl-4.5 shadow-chat-bubble",
          error ? "bg-destructive-soft text-destructive-soft-foreground" : "bg-chat-bubble-other",
        )}
      >
        {error ? (
          <MicOff className="size-4.5 shrink-0" aria-hidden />
        ) : busy ? (
          <Spinner className="size-4.5 shrink-0 text-brand" />
        ) : recordingNow ? (
          <span className="size-2.5 shrink-0 rounded-full bg-destructive-solid motion-safe:animate-pulse" aria-hidden />
        ) : null}
        {error ? (
          <p className="min-w-0 flex-1 text-body" role="alert">
            {t(VOICE_ERROR_KEYS[error])}
          </p>
        ) : hasClip && recording ? (
          <VoiceClipPreview recording={recording} levels={levels} />
        ) : (
          <span
            className={cn("text-body-lg text-foreground tabular-nums", recordingNow ? "shrink-0" : "min-w-0 flex-1")}
            role={recordingNow ? "timer" : "status"}
            aria-label={recordingNow ? t("chat.voice_recording_aria") : undefined}
          >
            {state === "requesting" ? (
              t("chat.voice_requesting")
            ) : state === "uploading" ? (
              t("chat.voice_uploading")
            ) : (
              <>
                <span className="font-semibold">{elapsed}</span>
                <span className="text-muted-foreground">{` / ${limit}`}</span>
              </>
            )}
          </span>
        )}
        {recordingNow && !error ? (
          // The live wave: the newest bars on the right, the last few in the recording red (canvas).
          <span aria-hidden className="flex h-7 min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
            {levels.slice(-LIVE_BARS).map((level, index, shown) => (
              <span
                key={index}
                className={cn("w-0.75 shrink-0 rounded-xs", index >= shown.length - 6 ? "bg-destructive" : "bg-brand")}
                style={{ height: barHeight(level) }}
              />
            ))}
          </span>
        ) : null}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            ref={cancelRef}
            type="button"
            variant="ghost"
            className={cn(
              "h-9 rounded-full px-4 font-semibold",
              error ? "bg-surface text-foreground hover:bg-surface-hover" : "text-muted-foreground",
            )}
            disabled={state === "uploading"}
            onClick={onCancel}
          >
            {error && state === "idle" ? t("common.close") : t("common.cancel")}
          </Button>
          {recordingNow ? (
            <Button
              type="button"
              variant="secondary"
              className="h-9 gap-1.5 rounded-full pr-3.5 pl-3 font-semibold"
              onClick={onStop}
            >
              <Square aria-hidden className="size-3.5 fill-current" />
              {t("chat.composer_state.stop")}
            </Button>
          ) : null}
        </div>
      </div>
      {state === "idle" && error ? null : (
        <Button
          type="button"
          className="h-12 shrink-0 gap-2 rounded-full pr-5 pl-4 font-semibold"
          disabled={!sendEnabled}
          onClick={onSend}
        >
          <Send aria-hidden className="size-4.5" />
          {state === "ready" && error === "upload" ? t("chat.composer_state.retry") : t("chat.send")}
        </Button>
      )}
    </div>
  );
}

/** Over the composer while files are dragged onto it: where to drop and what it takes (canvas). */
export function ComposerDropOverlay() {
  const { t } = useTranslation();
  return (
    <div
      className="pointer-events-none absolute inset-x-4 inset-y-2 z-10 flex items-center justify-center gap-3 rounded-[20px] border-2 border-dashed border-brand bg-brand-subtle"
      aria-live="polite"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
        <Upload className="size-4.5" />
      </span>
      <span className="flex flex-col">
        <span className="text-body-lg font-semibold text-brand">{t("chat.file_drop_hint")}</span>
        <span className="text-caption text-chat-chip-foreground">
          {t("chat.file_drop_detail", { max: CHAT_FILE_MAX_LABEL })}
        </span>
      </span>
    </div>
  );
}

/** Under the field once a message nears the limit: what is left, or by how much it is over. */
export function ComposerCharCounter({ id, remaining }: { id: string; remaining: number }) {
  const { t } = useTranslation();
  return (
    <p
      id={id}
      className={cn(
        "mt-1.5 mr-15 flex items-center justify-end gap-1.5 text-caption tabular-nums",
        remaining <= 0 ? "font-semibold text-destructive" : "font-medium text-muted-foreground",
      )}
    >
      {remaining < 0 ? <CircleAlert className="size-3.5 shrink-0" aria-hidden /> : null}
      {remaining < 0
        ? t("chat.composer_state.chars_over", { count: -remaining })
        : t("chat.composer_state.chars_left", { count: remaining })}
    </p>
  );
}
