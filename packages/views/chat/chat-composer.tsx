"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { Bell, CircleAlert, FileText, Mic, Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ComposerMessagePriority } from "@uniwork/core/chat/composer-priority";
import { CHAT_MESSAGE_BODY_MAX_LENGTH } from "@uniwork/core/chat/client-msg-id";
import { Button } from "@uniwork/ui/components/ui/button";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import {
  ComposerAttachMenu,
  ComposerToolbarButton,
  type ComposerAttachAction,
} from "./chat-composer-attach-menu";
import { ChatExpressionPicker } from "./chat-expression-picker";
import { ChatMentionAutocomplete, mentionOptionId } from "./chat-mention-autocomplete";
import type { ChatMentionCandidate } from "./chat-mention-utils";
import {
  deserializeMessageBodyToComposerDraft,
  filterMentionCandidates,
  formatComposerMentionDisplay,
  getActiveMentionQuery,
  insertMentionToken,
} from "./chat-mention-utils";
import {
  CHAT_FILE_ACCEPT,
  pickChatAcceptedFiles,
} from "./chat-file-accept";
import { useChatVoiceRecorder } from "./use-chat-voice-recorder";
import { useFileDropZone } from "../editor/use-file-drop-zone";
import { formatVoiceCallDuration } from "./voice-call-duration";

const VOICE_MAX_SECONDS = 120;

function formatFileSize(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[unit]}`;
}

/** A file waiting in the composer: its name, size and a way to take it back out. */
function StagedFileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const { t, i18n } = useTranslation();
  return (
    <span className="inline-flex max-w-60 items-center gap-2 rounded-lg border border-border bg-surface py-1 pr-1 pl-2">
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-medium text-foreground">{file.name}</span>
        <span className="block text-micro text-muted-foreground tabular-nums">
          {formatFileSize(file.size, i18n.language)}
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

function ComposerPriorityChip({
  priority,
  onClear,
}: {
  priority: ComposerMessagePriority;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const Icon = priority === "important" ? CircleAlert : Bell;
  const label =
    priority === "important"
      ? t("chat.message_flag_important")
      : t("chat.message_flag_urgent");

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

export function ChatComposer({
  workspaceId,
  draft,
  onDraftChange,
  onSend,
  disabled,
  placeholder,
  sendLabel,
  typingLabel,
  mentionCandidates,
  composerPriority = null,
  onComposerPriorityChange,
  onAttachAction,
  onSendMedia,
  onSendVoice,
  onSendFile,
  showCreatePoll = true,
}: {
  workspaceId: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder: string;
  sendLabel: string;
  typingLabel?: string | null;
  mentionCandidates?: ChatMentionCandidate[];
  composerPriority?: ComposerMessagePriority | null;
  onComposerPriorityChange?: (priority: ComposerMessagePriority | null) => void;
  onAttachAction?: (action: ComposerAttachAction) => void;
  onSendMedia?: (body: string) => void | Promise<void>;
  onSendVoice?: (recording: { blob: Blob; durationMs: number }) => Promise<void>;
  onSendFile?: (file: File) => void | Promise<void>;
  showCreatePoll?: boolean;
}) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionListId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  // Pasted, dropped or picked files wait here until the message is sent, so
  // a wrong file can be taken back before anyone sees it.
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const canSend = !disabled && (draft.trim().length > 0 || stagedFiles.length > 0);
  const mentionEnabled = mentionCandidates !== undefined;
  const voiceRecorder = useChatVoiceRecorder();
  const voiceActive = voiceRecorder.state !== "idle" || Boolean(voiceRecorder.error);

  const stageAcceptedFiles = useCallback(
    (files: File[]) => {
      if (disabled || !onSendFile) return;
      const accepted = pickChatAcceptedFiles(files);
      if (accepted.length === 0) {
        if (files.length > 0) toast.error(t("chat.file_type_unsupported"));
        return;
      }
      setStagedFiles((current) => [...current, ...accepted]);
      textareaRef.current?.focus();
    },
    [disabled, onSendFile, t],
  );

  const { isDragOver, dropZoneProps } = useFileDropZone({
    enabled: Boolean(onSendFile) && !disabled && !voiceActive,
    onDrop: stageAcceptedFiles,
  });

  const visibleMentionCandidates = useMemo(() => {
    if (!mentionEnabled || mentionStart === null) return [];
    return filterMentionCandidates(mentionCandidates ?? [], mentionQuery, {
      allLabel: t("chat.mention_all"),
    });
  }, [mentionCandidates, mentionEnabled, mentionQuery, mentionStart, t]);

  const mentionPickerOpen = mentionEnabled && mentionStart !== null;

  const normalizeDraft = (value: string) => deserializeMessageBodyToComposerDraft(value);

  const updateDraft = (value: string) => {
    onDraftChange(normalizeDraft(value));
  };

  const syncMentionState = (value: string, cursor: number) => {
    if (!mentionEnabled) {
      setMentionStart(null);
      setMentionQuery("");
      return;
    }
    const active = getActiveMentionQuery(value, cursor);
    if (!active) {
      setMentionStart(null);
      setMentionQuery("");
      return;
    }
    setMentionStart(active.start);
    setMentionQuery(active.query);
    setSelectedMentionIndex(0);
  };

  const closeMentionPicker = () => {
    setMentionStart(null);
    setMentionQuery("");
    setSelectedMentionIndex(0);
  };

  const insertMention = (candidate: ChatMentionCandidate) => {
    if (mentionStart === null || !textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart ?? draft.length;
    const display = formatComposerMentionDisplay(candidate, t("chat.mention_all"));
    const { nextDraft, nextCursor } = insertMentionToken(draft, mentionStart, cursor, display);
    updateDraft(nextDraft);
    closeMentionPicker();
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleAttachAction = (action: ComposerAttachAction) => {
    if (action === "attach_file") {
      if (disabled) return;
      fileInputRef.current?.click();
      return;
    }
    if (onAttachAction) {
      onAttachAction(action);
      return;
    }
    toast.info(t("chat.composer_coming_soon"));
  };

  const insertEmoji = (emoji: string) => {
    updateDraft(`${draft}${emoji}`);
    textareaRef.current?.focus();
  };

  const handleSendMedia = (body: string) => {
    if (disabled) return;
    if (onSendMedia) {
      void onSendMedia(body);
      return;
    }
    updateDraft(body);
    textareaRef.current?.focus();
  };

  const submit = () => {
    if (!canSend) return;
    if (stagedFiles.length > 0 && onSendFile) {
      for (const file of stagedFiles) void onSendFile(file);
      setStagedFiles([]);
    }
    if (draft.trim().length > 0) onSend();
  };

  const voiceTime = `${formatVoiceCallDuration(Math.floor(voiceRecorder.elapsedMs / 1000))} / ${formatVoiceCallDuration(VOICE_MAX_SECONDS)}`;

  return (
    <div
      className={cn(
        "relative flex shrink-0 flex-col gap-1.5 border-t border-border bg-surface px-3 py-2.5 sm:px-4",
      )}
      {...dropZoneProps}
    >
      {isDragOver ? (
        <p
          className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand bg-brand-subtle text-body font-medium text-brand-subtle-foreground"
          aria-live="polite"
        >
          {t("chat.file_drop_hint")}
        </p>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        accept={CHAT_FILE_ACCEPT}
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || disabled) return;
          stageAcceptedFiles([file]);
        }}
      />
      {typingLabel ? (
        <p className="px-1 text-caption text-muted-foreground" aria-live="polite">
          {typingLabel}
        </p>
      ) : null}
      {stagedFiles.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label={t("chat.composer_staged_files")}>
          {stagedFiles.map((file, index) => (
            <StagedFileChip
              key={`${file.name}-${file.size}-${index}`}
              file={file}
              onRemove={() => setStagedFiles((current) => current.filter((_, i) => i !== index))}
            />
          ))}
        </div>
      ) : null}
      {composerPriority ? (
        <div>
          <ComposerPriorityChip
            priority={composerPriority}
            onClear={() => onComposerPriorityChange?.(null)}
          />
        </div>
      ) : null}
      {voiceActive ? (
        <div className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-muted px-3 py-2">
          <span className="size-2.5 shrink-0 rounded-full bg-destructive-solid motion-safe:animate-pulse" aria-hidden />
          <span
            className="min-w-0 flex-1 text-body tabular-nums text-foreground"
            role={voiceRecorder.state === "recording" ? "timer" : "status"}
            aria-label={voiceRecorder.state === "recording" ? t("chat.voice_recording_aria") : undefined}
          >
            {voiceRecorder.state === "requesting"
              ? t("chat.voice_requesting")
              : voiceRecorder.state === "uploading"
                ? t("chat.voice_uploading")
                : voiceTime}
          </span>
          {voiceRecorder.error ? (
            <span className="text-caption text-destructive" role="alert">
              {t("chat.voice_record_failed")}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={voiceRecorder.state === "uploading"}
            onClick={voiceRecorder.cancel}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              voiceRecorder.state === "requesting" ||
              voiceRecorder.state === "uploading" ||
              !onSendVoice
            }
            onClick={() => {
              if (!onSendVoice) return;
              void voiceRecorder.upload(({ blob, durationMs }) =>
                onSendVoice({ blob, durationMs }),
              );
            }}
          >
            {t("chat.send")}
          </Button>
        </div>
      ) : (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* The field's own ring is off, so the frame carries focus — the
            same border and ring an Input takes when focused. */}
        <div className="flex min-w-0 items-end gap-1 rounded-xl border border-input bg-surface px-1.5 py-1 transition-[border-color,box-shadow] duration-(--duration-fast) focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
          <div className="flex shrink-0 items-center">
            <div className="flex items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11">
              <ChatExpressionPicker
                workspaceId={workspaceId}
                disabled={disabled}
                align="start"
                onSelectEmoji={insertEmoji}
                onSendMedia={handleSendMedia}
              />
            </div>
            <ComposerAttachMenu
              disabled={disabled}
              onAction={handleAttachAction}
              align="start"
              showCreatePoll={showCreatePoll}
            />
          </div>

          <div className="relative min-w-0 flex-1">
            {mentionPickerOpen ? (
              <ChatMentionAutocomplete
                listId={mentionListId}
                candidates={visibleMentionCandidates}
                selectedIndex={Math.min(
                  selectedMentionIndex,
                  Math.max(visibleMentionCandidates.length - 1, 0),
                )}
                onSelect={insertMention}
                onHover={setSelectedMentionIndex}
              />
            ) : null}
            <Textarea
              ref={textareaRef}
              value={draft}
              maxLength={CHAT_MESSAGE_BODY_MAX_LENGTH}
              onChange={(e) => {
                const normalized = normalizeDraft(e.target.value);
                onDraftChange(normalized);
                syncMentionState(normalized, e.target.selectionStart ?? normalized.length);
              }}
              onClick={(e) => {
                syncMentionState(
                  e.currentTarget.value,
                  e.currentTarget.selectionStart ?? e.currentTarget.value.length,
                );
              }}
              onKeyUp={(e) => {
                syncMentionState(
                  e.currentTarget.value,
                  e.currentTarget.selectionStart ?? e.currentTarget.value.length,
                );
              }}
              onPaste={(e) => {
                if (!onSendFile || disabled) return;
                const files = Array.from(e.clipboardData?.files ?? []);
                if (files.length === 0) return;
                e.preventDefault();
                stageAcceptedFiles(files);
              }}
              placeholder={placeholder}
              aria-label={placeholder}
              aria-autocomplete={mentionEnabled ? "list" : undefined}
              aria-controls={mentionPickerOpen ? mentionListId : undefined}
              aria-activedescendant={
                mentionPickerOpen && visibleMentionCandidates.length > 0
                  ? mentionOptionId(
                      mentionListId,
                      Math.min(selectedMentionIndex, visibleMentionCandidates.length - 1),
                    )
                  : undefined
              }
              disabled={disabled}
              rows={1}
              className="max-h-40 min-h-9 w-full resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0 md:text-body dark:bg-transparent"
              onKeyDown={(e) => {
                // A Vietnamese IME commits the pending syllable on Enter and the
                // browser reports that commit as its own keydown, so acting on
                // both sends the message twice under two client_msg_ids. A held
                // key repeats for the same reason.
                if (e.nativeEvent.isComposing || e.keyCode === 229 || e.repeat) return;

                if (mentionPickerOpen) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSelectedMentionIndex((index) =>
                      Math.min(index + 1, Math.max(visibleMentionCandidates.length - 1, 0)),
                    );
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSelectedMentionIndex((index) => Math.max(index - 1, 0));
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeMentionPicker();
                    return;
                  }
                  if ((e.key === "Enter" || e.key === "Tab") && visibleMentionCandidates.length > 0) {
                    e.preventDefault();
                    const picked =
                      visibleMentionCandidates[
                        Math.min(
                          selectedMentionIndex,
                          Math.max(visibleMentionCandidates.length - 1, 0),
                        )
                      ];
                    if (picked) insertMention(picked);
                    return;
                  }
                }

                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>

          <div className="flex shrink-0 items-center pb-0.5">
            {canSend ? (
              <Button type="submit" variant="brand" size="icon-lg" className="shrink-0" aria-label={sendLabel}>
                <Send className="size-4" aria-hidden />
              </Button>
            ) : (
              <ComposerToolbarButton
                label={t("chat.composer_voice")}
                disabled={disabled}
                onClick={() => void voiceRecorder.start()}
              >
                <Mic aria-hidden className="size-5" />
              </ComposerToolbarButton>
            )}
          </div>
        </div>
      </form>
      )}
    </div>
  );
}

export type { ComposerAttachAction } from "./chat-composer-attach-menu";
