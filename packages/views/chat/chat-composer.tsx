"use client";

import { useCallback, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Mic, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ComposerMessagePriority } from "@uniwork/core/chat/composer-priority";
import { CHAT_MESSAGE_BODY_MAX_LENGTH } from "@uniwork/core/chat/client-msg-id";
import { useChatComposerDraftStore } from "@uniwork/core/chat/composer-draft-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { ComposerAttachMenu, ComposerToolbarButton, type ComposerAttachAction } from "./chat-composer-attach-menu";
import { ComposerPriorityChip, ComposerVoiceBar, StagedFileChip } from "./chat-composer-parts";
import { ChatExpressionPicker } from "./chat-expression-picker";
import { ChatMentionAutocomplete, mentionOptionId } from "./chat-mention-autocomplete";
import type { MemberAvatarUrlMap } from "./chat-member-avatar";
import type { ChatMentionCandidate } from "./chat-mention-utils";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";
import { CHAT_FILE_ACCEPT, pickChatAcceptedFiles } from "./chat-file-accept";
import { useChatVoiceRecorder } from "./use-chat-voice-recorder";
import { useComposerMentions } from "./use-composer-mentions";
import { useFileDropZone } from "../editor/use-file-drop-zone";

/** Show the character count once a message gets this close to the limit. */
const COUNTER_THRESHOLD = 200;

export type ChatComposerHandle = {
  /** Put the caret back in the message field (after reply, thread, cancel). */
  focus: () => void;
};

type ChatComposerProps = {
  workspaceId: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder: string;
  sendLabel: string;
  typingLabel?: string | null;
  mentionCandidates?: ChatMentionCandidate[];
  memberAvatarByUserId?: MemberAvatarUrlMap;
  composerPriority?: ComposerMessagePriority | null;
  onComposerPriorityChange?: (priority: ComposerMessagePriority | null) => void;
  onAttachAction?: (action: ComposerAttachAction) => void;
  onSendMedia?: (body: string) => void | Promise<void>;
  onSendVoice?: (recording: { blob: Blob; durationMs: number }) => Promise<void>;
  onSendFile?: (file: File) => void | Promise<void>;
  showCreatePoll?: boolean;
  ref?: Ref<ChatComposerHandle>;
};

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
  memberAvatarByUserId,
  composerPriority = null,
  onComposerPriorityChange,
  onAttachAction,
  onSendMedia,
  onSendVoice,
  onSendFile,
  showCreatePoll = true,
  ref,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionListId = useId();
  const counterId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Pasted, dropped or picked files wait here until the message is sent, so
  // a wrong file can be taken back before anyone sees it.
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const canSend = !disabled && (draft.trim().length > 0 || stagedFiles.length > 0);
  const mentionEnabled = mentionCandidates !== undefined;
  const voiceRecorder = useChatVoiceRecorder();
  const voiceActive = voiceRecorder.state !== "idle" || Boolean(voiceRecorder.error);

  useImperativeHandle(ref, () => ({
    focus: () => window.requestAnimationFrame(() => textareaRef.current?.focus()),
  }));

  const normalizeDraft = (value: string) => deserializeMessageBodyToComposerDraft(value);
  const updateDraft = (value: string) => onDraftChange(normalizeDraft(value));

  const mentions = useComposerMentions({
    enabled: mentionEnabled,
    candidates: mentionCandidates,
    allLabel: t("chat.mention_all"),
    draft,
    onDraftChange: updateDraft,
    textareaRef,
  });

  const stageAcceptedFiles = useCallback(
    (files: File[]) => {
      if (disabled || !onSendFile) return;
      const accepted = pickChatAcceptedFiles(files);
      if (accepted.length === 0) {
        if (files.length > 0) toast.error(t("chat.file_type_unsupported"));
        return;
      }
      if (accepted.length < files.length) toast.error(t("chat.file_type_unsupported"));
      setStagedFiles((current) => [...current, ...accepted]);
      textareaRef.current?.focus();
    },
    [disabled, onSendFile, t],
  );

  const { isDragOver, dropZoneProps } = useFileDropZone({
    enabled: Boolean(onSendFile) && !disabled && !voiceActive,
    onDrop: stageAcceptedFiles,
  });

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

  // An emoji goes where the caret is, not at the end of the message.
  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? start;
    updateDraft(`${draft.slice(0, start)}${emoji}${draft.slice(end)}`);
    const caret = start + emoji.length;
    window.requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
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
    // The send button disappears with the text; keep typing where you were
    // (and keep a phone's keyboard up).
    textareaRef.current?.focus();
  };

  const remaining = CHAT_MESSAGE_BODY_MAX_LENGTH - draft.length;
  const showCounter = remaining <= COUNTER_THRESHOLD;

  return (
    <div
      className={cn("relative flex shrink-0 flex-col gap-1.5 border-t border-border bg-surface px-3 py-2.5 sm:px-4")}
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
        multiple
        className="sr-only"
        accept={CHAT_FILE_ACCEPT}
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length === 0 || disabled) return;
          stageAcceptedFiles(files);
        }}
      />
      {typingLabel ? (
        <p className="px-1 text-caption text-muted-foreground" aria-live="polite">
          {typingLabel}
        </p>
      ) : null}
      {stagedFiles.length > 0 ? (
        <div role="group" className="flex flex-wrap gap-1.5" aria-label={t("chat.composer_staged_files")}>
          {stagedFiles.map((file, index) => (
            <StagedFileChip
              key={`${file.name}-${file.size}-${index}`}
              file={file}
              onRemove={() => {
                setStagedFiles((current) => current.filter((_, i) => i !== index));
                textareaRef.current?.focus();
              }}
            />
          ))}
        </div>
      ) : null}
      {composerPriority ? (
        <div>
          <ComposerPriorityChip priority={composerPriority} onClear={() => onComposerPriorityChange?.(null)} />
        </div>
      ) : null}
      {voiceActive ? (
        <ComposerVoiceBar
          state={voiceRecorder.state}
          error={voiceRecorder.error}
          elapsedMs={voiceRecorder.elapsedMs}
          recording={voiceRecorder.recording}
          canSend={Boolean(onSendVoice)}
          onCancel={voiceRecorder.cancel}
          onStop={() => void voiceRecorder.stop()}
          onSend={() => {
            if (!onSendVoice) return;
            void voiceRecorder.upload(({ blob, durationMs }) => onSendVoice({ blob, durationMs }));
          }}
          textareaRef={textareaRef}
        />
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
              {mentions.open ? (
                <ChatMentionAutocomplete
                  listId={mentionListId}
                  candidates={mentions.visibleCandidates}
                  selectedIndex={mentions.activeIndex}
                  onSelect={mentions.insert}
                  onHover={mentions.setSelectedIndex}
                  memberAvatarByUserId={memberAvatarByUserId}
                />
              ) : null}
              <Textarea
                ref={textareaRef}
                value={draft}
                maxLength={CHAT_MESSAGE_BODY_MAX_LENGTH}
                onChange={(e) => {
                  const normalized = normalizeDraft(e.target.value);
                  onDraftChange(normalized);
                  mentions.sync(normalized, e.target.selectionStart ?? normalized.length);
                }}
                onClick={(e) => {
                  const el = e.currentTarget;
                  mentions.sync(el.value, el.selectionStart ?? el.value.length);
                }}
                onKeyUp={mentions.onKeyUp}
                onPaste={(e) => {
                  if (!onSendFile || disabled) return;
                  const files = Array.from(e.clipboardData?.files ?? []);
                  if (files.length === 0) return;
                  e.preventDefault();
                  stageAcceptedFiles(files);
                }}
                placeholder={placeholder}
                aria-label={placeholder}
                role={mentionEnabled ? "combobox" : undefined}
                aria-expanded={mentionEnabled ? mentions.open && mentions.visibleCandidates.length > 0 : undefined}
                aria-autocomplete={mentionEnabled ? "list" : undefined}
                aria-controls={mentions.open ? mentionListId : undefined}
                aria-activedescendant={
                  mentions.open && mentions.visibleCandidates.length > 0
                    ? mentionOptionId(mentionListId, mentions.activeIndex)
                    : undefined
                }
                aria-describedby={showCounter ? counterId : undefined}
                disabled={disabled}
                rows={1}
                className="max-h-40 min-h-9 w-full resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0 md:text-body dark:bg-transparent"
                onKeyDown={(e) => {
                  // A Vietnamese IME commits the pending syllable on Enter and the
                  // browser reports that commit as its own keydown, so acting on
                  // both sends the message twice under two client_msg_ids. A held
                  // key repeats for the same reason.
                  if (e.nativeEvent.isComposing || e.keyCode === 229 || e.repeat) return;
                  if (mentions.onKeyDown(e)) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            </div>

            <div className="flex shrink-0 items-center pb-0.5">
              {canSend ? (
                <Button
                  type="submit"
                  variant="brand"
                  size="icon-lg"
                  className="shrink-0"
                  aria-label={sendLabel}
                  // Tapping send must not take focus from the field: on a
                  // phone that would close the keyboard after every message.
                  onPointerDown={(event) => event.preventDefault()}
                >
                  <Send className="size-4" aria-hidden />
                </Button>
              ) : (
                <ComposerToolbarButton
                  label={t("chat.composer_state.record")}
                  disabled={disabled}
                  onClick={() => void voiceRecorder.start()}
                >
                  <Mic aria-hidden className="size-5" />
                </ComposerToolbarButton>
              )}
            </div>
          </div>
          {showCounter ? (
            <p
              id={counterId}
              className={cn(
                "mt-1 px-1 text-right text-micro tabular-nums",
                remaining <= 0 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {t("chat.composer_state.chars_left", { count: Math.max(remaining, 0) })}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}

/**
 * The composer of one conversation, with its draft in the chat draft store:
 * a keystroke re-renders this, not the page and the timeline around it.
 * Keyed by the draft so staged files, a voice clip and mention state never
 * follow the user into another conversation.
 */
export function ChatRoomComposer({
  draftKey,
  ...props
}: Omit<ChatComposerProps, "draft" | "onDraftChange"> & { draftKey: string }) {
  const draft = useChatComposerDraftStore((state) => state.drafts[draftKey] ?? "");
  const setDraft = useChatComposerDraftStore((state) => state.setDraft);
  const onDraftChange = useCallback((value: string) => setDraft(draftKey, value), [draftKey, setDraft]);
  return <ChatComposer key={draftKey} {...props} draft={draft} onDraftChange={onDraftChange} />;
}

export type { ComposerAttachAction } from "./chat-composer-attach-menu";
