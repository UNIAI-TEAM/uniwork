"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Ban, Bell, CircleAlert, Eye, FileText, Lock, MicOff, Send, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ComposerMessagePriority } from "@uniwork/core/chat/composer-priority";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { isChatImageFile } from "./chat-file-accept";
import { formatChatFileSize } from "./chat-file-size";
import type { ChatVoiceRecorderError, ChatVoiceRecording, ChatVoiceRecorderState } from "./use-chat-voice-recorder";
import { formatVoiceCallDuration } from "./voice-call-duration";

const VOICE_MAX_SECONDS = 120;

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
    <span className="inline-flex h-16 w-64 max-w-full shrink-0 items-center gap-2.5 rounded-xl border border-border bg-muted py-1.5 pr-1 pl-1.5">
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
}: {
  reason: ComposerReadOnlyReason;
  placeholder: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const Icon = READ_ONLY_ICONS[reason];
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
          // eslint-disable-next-line jsx-a11y/media-has-caption -- the person's own clip, played back before sending; there is no caption track
          <audio
            controls
            src={recording.url}
            className="h-9 min-w-0 flex-1"
            aria-label={t("chat.composer_state.preview")}
          />
        ) : (
          <span
            className="min-w-0 flex-1 text-body-lg text-foreground tabular-nums"
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
