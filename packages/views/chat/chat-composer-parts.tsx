"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Bell, CircleAlert, FileText, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ComposerMessagePriority } from "@uniwork/core/chat/composer-priority";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { formatChatFileSize } from "./chat-file-size";
import type { ChatVoiceRecorderError, ChatVoiceRecording, ChatVoiceRecorderState } from "./use-chat-voice-recorder";
import { formatVoiceCallDuration } from "./voice-call-duration";

const VOICE_MAX_SECONDS = 120;

/** A file waiting in the composer: its name, size and a way to take it back out. */
export function StagedFileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const { t, i18n } = useTranslation();
  return (
    <span className="inline-flex max-w-60 items-center gap-2 rounded-lg border border-border bg-surface py-1 pr-1 pl-2">
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-medium text-foreground">{file.name}</span>
        <span className="block text-micro text-muted-foreground tabular-nums">
          {formatChatFileSize(file.size, i18n.language)}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={t("chat.composer_remove_file", { name: file.name })}
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
        "inline-flex max-w-full items-center gap-1.5 rounded-md py-0.5 pr-0.5 pl-2 text-caption font-semibold",
        priority === "urgent"
          ? "bg-destructive-soft text-destructive-soft-foreground"
          : "bg-warning-soft text-warning-soft-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-current hover:bg-transparent hover:opacity-80"
        aria-label={t("chat.composer_clear_priority")}
        onClick={onClear}
      >
        <X aria-hidden />
      </Button>
    </span>
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

  const time = `${formatVoiceCallDuration(Math.floor(elapsedMs / 1000))} / ${formatVoiceCallDuration(VOICE_MAX_SECONDS)}`;

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-muted px-3 py-2">
      {recordingNow ? (
        <span className="size-2.5 shrink-0 rounded-full bg-destructive-solid motion-safe:animate-pulse" aria-hidden />
      ) : null}
      {error ? (
        <p className="min-w-0 flex-1 text-caption text-destructive" role="alert">
          {t(VOICE_ERROR_KEYS[error])}
        </p>
      ) : hasClip && recording ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- the person's own clip, played back before sending; there is no caption track
        <audio
          controls
          src={recording.url}
          className="h-9 min-w-0 flex-1"
          aria-label={t("chat.composer_state.preview")}
        />
      ) : (
        <span
          className="min-w-0 flex-1 text-body text-foreground tabular-nums"
          role={recordingNow ? "timer" : "status"}
          aria-label={recordingNow ? t("chat.voice_recording_aria") : undefined}
        >
          {state === "requesting"
            ? t("chat.voice_requesting")
            : state === "uploading"
              ? t("chat.voice_uploading")
              : time}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          ref={cancelRef}
          type="button"
          variant="ghost"
          size="sm"
          disabled={state === "uploading"}
          onClick={onCancel}
        >
          {error && state === "idle" ? t("common.close") : t("common.cancel")}
        </Button>
        {recordingNow ? (
          <Button type="button" variant="outline" size="sm" onClick={onStop}>
            <Square aria-hidden />
            {t("chat.composer_state.stop")}
          </Button>
        ) : null}
        {state === "idle" && error ? null : (
          <Button type="button" size="sm" disabled={!sendEnabled} onClick={onSend}>
            {state === "ready" && error === "upload" ? t("chat.composer_state.retry") : t("chat.send")}
          </Button>
        )}
      </div>
    </div>
  );
}
