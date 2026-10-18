"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Check, CircleAlert, Mic, Paperclip, Send, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ComposerMessagePriority } from "@uniwork/core/chat/composer-priority";
import { CHAT_MESSAGE_BODY_MAX_LENGTH } from "@uniwork/core/chat/client-msg-id";
import { useChatComposerDraftStore } from "@uniwork/core/chat/composer-draft-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { ComposerAttachMenu, ComposerToolbarButton, type ComposerAttachAction } from "./chat-composer-attach-menu";
import {
  ComposerEditBar,
  ComposerPriorityChip,
  ComposerReadOnlyBar,
  ComposerVoiceBar,
  StagedFileChip,
  type ComposerReadOnlyReason,
} from "./chat-composer-parts";
import { ChatExpressionPicker } from "./chat-expression-picker";
import { ChatMentionAutocomplete, mentionOptionId } from "./chat-mention-autocomplete";
import type { MemberAvatarUrlMap } from "./chat-member-avatar";
import type { ChatMentionCandidate } from "./chat-mention-utils";
import { deserializeMessageBodyToComposerDraft, serializeComposerDraftToMessageBody } from "./chat-mention-utils";
import { CHAT_FILE_ACCEPT, CHAT_FILE_MAX_LABEL, isChatFileTooLarge, pickChatAcceptedFiles } from "./chat-file-accept";
import { useChatVoiceRecorder } from "./use-chat-voice-recorder";
import { useComposerMentions } from "./use-composer-mentions";
import { SidebarTypingDots } from "./sidebar-typing-dots";
import { useFileDropZone } from "../editor/use-file-drop-zone";

/** Show the character count once a message gets this close to the limit. */
const COUNTER_THRESHOLD = 200;

export type ChatComposerHandle = {
  /** Put the caret back in the message field (after reply, thread, cancel). */
  focus: () => void;
};

/** A sent message being edited in place of a new one (only the author's text messages). */
export type ChatComposerEditing = {
  message: { id: string; body: string };
  saving: boolean;
  /** Why the last save failed; edit mode stays, with the text. */
  error: string | null;
  onSave: (text: string) => void;
  onCancel: () => void;
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
  /** A host may provide its own voice capture flow. */
  onRecordVoice?: () => void;
  /** Set with `disabled` when the room is read-only for this person: the field becomes one centred line. */
  readOnlyReason?: ComposerReadOnlyReason;
  /** Puts the field into edit mode: the edit bar above it, the text prefilled, Save instead of Send. */
  editing?: ChatComposerEditing | null;
  /** A thread reply: text, emoji and stickers only — no attach menu, no voice. */
  textOnly?: boolean;
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
  onRecordVoice,
  readOnlyReason,
  editing = null,
  textOnly = false,
  ref,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionAnchorRef = useRef<HTMLDivElement>(null);
  const mentionListId = useId();
  const counterId = useId();
  const stagedLabelId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Pasted, dropped or picked files wait here until the message is sent, so
  // a wrong file can be taken back before anyone sees it.
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  // Edit mode types into its own text, so the draft is there again, as it
  // was, when the edit is saved or cancelled.
  const [editDraft, setEditDraft] = useState<{ id: string; text: string } | null>(null);
  const editingId = editing?.message.id ?? null;
  const value = editing
    ? editDraft?.id === editing.message.id
      ? editDraft.text
      : deserializeMessageBodyToComposerDraft(editing.message.body)
    : draft;
  const setValue = editing
    ? (next: string) => setEditDraft({ id: editing.message.id, text: next })
    : onDraftChange;
  const canSend = editing
    ? !disabled && !editing.saving && value.trim().length > 0
    : !disabled && (draft.trim().length > 0 || stagedFiles.length > 0);
  const mentionEnabled = mentionCandidates !== undefined;
  const voiceRecorder = useChatVoiceRecorder();
  const voiceActive = voiceRecorder.state !== "idle" || Boolean(voiceRecorder.error);

  useImperativeHandle(ref, () => ({
    focus: () => window.requestAnimationFrame(() => textareaRef.current?.focus()),
  }));

  const normalizeDraft = (next: string) => deserializeMessageBodyToComposerDraft(next);
  const updateDraft = (next: string) => setValue(normalizeDraft(next));

  // Entering edit mode puts the caret at the end of the message.
  useEffect(() => {
    setEditDraft(null);
    if (!editingId) return;
    window.requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
  }, [editingId]);

  const mentions = useComposerMentions({
    enabled: mentionEnabled,
    candidates: mentionCandidates,
    allLabel: t("chat.mention_all"),
    draft: value,
    onDraftChange: updateDraft,
    textareaRef,
  });

  const stageAcceptedFiles = useCallback(
    (files: File[]) => {
      if (disabled || editing || !onSendFile) return;
      const accepted = pickChatAcceptedFiles(files);
      const ready = accepted.filter((file) => !isChatFileTooLarge(file));
      if (accepted.length < files.length) toast.error(t("chat.file_type_unsupported"));
      if (ready.length < accepted.length) toast.error(t("chat.file_too_large", { max: CHAT_FILE_MAX_LABEL }));
      if (ready.length === 0) return;
      setStagedFiles((current) => [...current, ...ready]);
      textareaRef.current?.focus();
    },
    [disabled, editing, onSendFile, t],
  );

  const { isDragOver, dropZoneProps } = useFileDropZone({
    enabled: Boolean(onSendFile) && !disabled && !voiceActive && !editing,
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
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    updateDraft(`${value.slice(0, start)}${emoji}${value.slice(end)}`);
    const caret = start + emoji.length;
    window.requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  };

  const handleSendMedia = (body: string) => {
    // A sticker is a message of its own; it cannot replace the text being edited.
    if (disabled || editing) return;
    if (onSendMedia) {
      void onSendMedia(body);
      return;
    }
    updateDraft(body);
    textareaRef.current?.focus();
  };

  // The server limits the sent body, where each @label is a longer mention
  // token. UTF-16 length counts an emoji as 2, so this is never looser than it.
  const remaining =
    CHAT_MESSAGE_BODY_MAX_LENGTH -
    serializeComposerDraftToMessageBody(value, mentionCandidates ?? [], t("chat.mention_all")).length;

  const submit = () => {
    if (!canSend) return;
    if (editing) {
      if (remaining >= 0) editing.onSave(value);
      return;
    }
    if (stagedFiles.length > 0 && onSendFile) {
      // One upload at a time: the server holds each file in memory while it
      // checks it, and a handful of large ones at once can exhaust the pod.
      const files = stagedFiles;
      void (async () => {
        for (const file of files) {
          try {
            await onSendFile(file);
          } catch {
            // The sender reports its own failure; the next file still goes.
          }
        }
      })();
      setStagedFiles([]);
    }
    // Over the limit the counter is already red; sending would only bounce.
    if (draft.trim().length > 0 && remaining >= 0) onSend();
    // The send button disappears with the text; keep typing where you were
    // (and keep a phone's keyboard up).
    textareaRef.current?.focus();
  };

  const showCounter = remaining <= COUNTER_THRESHOLD;
  const recordLabel = t("chat.composer_state.record");
  const saveLabel = t("chat.edit_dialog_save");

  return (
    <div className="relative flex shrink-0 flex-col gap-1.5 bg-chat-wall px-3 pt-1 pb-3 sm:px-6 sm:pb-5" {...dropZoneProps}>
      {isDragOver ? (
        <div
          className="pointer-events-none absolute inset-x-4 inset-y-2 z-10 flex items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand bg-brand-subtle"
          aria-live="polite"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
            <Upload className="size-4.5" />
          </span>
          <span className="text-body-lg font-semibold text-brand-subtle-foreground">{t("chat.file_drop_hint")}</span>
        </div>
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
        <p
          className="mx-auto flex w-full max-w-183 items-center gap-1.5 pl-15 text-label font-medium text-brand"
          aria-live="polite"
        >
          <SidebarTypingDots />
          {typingLabel}
        </p>
      ) : null}
      {disabled && readOnlyReason ? (
        <ComposerReadOnlyBar reason={readOnlyReason} placeholder={placeholder} textareaRef={textareaRef} />
      ) : voiceActive ? (
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
          className="mx-auto w-full max-w-183"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex items-end gap-2">
            {textOnly ? null : (
              <ComposerAttachMenu
                disabled={disabled || Boolean(editing)}
                onAction={handleAttachAction}
                align="start"
                showCreatePoll={showCreatePoll}
              />
            )}
            {/* The field's own ring is off, so the pill carries focus. */}
            <div
              className={cn(
                "flex min-h-12 min-w-0 flex-1 flex-col rounded-3xl bg-chat-bubble-other px-1.5 py-0.5 shadow-chat-bubble transition-shadow duration-(--duration-fast)",
                remaining < 0 ? "ring-2 ring-destructive" : "focus-within:ring-2 focus-within:ring-ring/30",
              )}
            >
              {editing ? (
                <ComposerEditBar
                  preview={deserializeMessageBodyToComposerDraft(editing.message.body)}
                  onCancel={() => {
                    editing.onCancel();
                    // The bar and its X go away; the caret stays in the field.
                    textareaRef.current?.focus();
                  }}
                />
              ) : null}
              {!editing && (composerPriority || stagedFiles.length > 0) ? (
                <>
                  <div className="flex flex-col items-start gap-2 px-1.5 pt-2.5 pb-2">
                    {composerPriority ? (
                      <ComposerPriorityChip priority={composerPriority} onClear={() => onComposerPriorityChange?.(null)} />
                    ) : null}
                    {stagedFiles.length > 0 ? (
                      <div role="group" aria-labelledby={stagedLabelId} className="flex w-full min-w-0 flex-col gap-2">
                        <span id={stagedLabelId} className="text-caption font-semibold text-muted-foreground">
                          {`${t("chat.composer_staged_files")} · ${stagedFiles.length}`}
                        </span>
                        <div className="flex gap-2 overflow-x-auto">
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
                      </div>
                    ) : null}
                  </div>
                  <div className="mx-1.5 h-px bg-border" />
                </>
              ) : null}
              <div className="flex items-end gap-1">
                <ChatExpressionPicker
                  workspaceId={workspaceId}
                  disabled={disabled}
                  align="start"
                  onSelectEmoji={insertEmoji}
                  onSendMedia={handleSendMedia}
                />
                <div ref={mentionAnchorRef} className="relative min-w-0 flex-1">
                  {mentions.open ? (
                    <ChatMentionAutocomplete
                      listId={mentionListId}
                      candidates={mentions.visibleCandidates}
                      selectedIndex={mentions.activeIndex}
                      onSelect={mentions.insert}
                      onHover={mentions.setSelectedIndex}
                      anchorRef={mentionAnchorRef}
                      memberAvatarByUserId={memberAvatarByUserId}
                    />
                  ) : null}
                  <Textarea
                    ref={textareaRef}
                    value={value}
                    maxLength={CHAT_MESSAGE_BODY_MAX_LENGTH}
                    onChange={(e) => {
                      const normalized = normalizeDraft(e.target.value);
                      setValue(normalized);
                      mentions.sync(normalized, e.target.selectionStart ?? normalized.length);
                    }}
                    onClick={(e) => {
                      const el = e.currentTarget;
                      mentions.sync(el.value, el.selectionStart ?? el.value.length);
                    }}
                    onKeyUp={mentions.onKeyUp}
                    onPaste={(e) => {
                      if (!onSendFile || disabled || editing) return;
                      const files = Array.from(e.clipboardData?.files ?? []);
                      if (files.length === 0) return;
                      e.preventDefault();
                      stageAcceptedFiles(files);
                    }}
                    placeholder={placeholder}
                    aria-label={editing ? t("chat.edit_dialog_title") : placeholder}
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
                    className="max-h-40 min-h-11 w-full resize-none rounded-none border-0 bg-transparent px-1 py-2.5 shadow-none focus-visible:ring-0 disabled:bg-transparent md:text-body-lg dark:bg-transparent dark:disabled:bg-transparent"
                    onKeyDown={(e) => {
                      // A Vietnamese IME commits the pending syllable on Enter and the
                      // browser reports that commit as its own keydown, so acting on
                      // both sends the message twice under two client_msg_ids. A held
                      // key repeats for the same reason.
                      if (e.nativeEvent.isComposing || e.keyCode === 229 || e.repeat) return;
                      if (mentions.onKeyDown(e)) return;
                      if (editing && e.key === "Escape") {
                        e.preventDefault();
                        editing.onCancel();
                        return;
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submit();
                      }
                    }}
                  />
                </div>
                {onSendFile ? (
                  <ComposerToolbarButton
                    label={t("chat.composer_attach_file")}
                    disabled={disabled || Boolean(editing)}
                    onClick={() => handleAttachAction("attach_file")}
                  >
                    <Paperclip aria-hidden />
                  </ComposerToolbarButton>
                ) : null}
              </div>
            </div>
            {canSend || editing || textOnly ? (
              <Button
                type="submit"
                size="icon-lg"
                className="size-12 rounded-full hover:bg-primary/90"
                aria-label={editing ? saveLabel : sendLabel}
                title={editing ? saveLabel : undefined}
                disabled={!canSend}
                // Tapping send must not take focus from the field: on a
                // phone that would close the keyboard after every message.
                onPointerDown={(event) => event.preventDefault()}
              >
                {!editing ? (
                  <Send className="size-5" aria-hidden />
                ) : editing.saving ? (
                  <Spinner className="size-5" />
                ) : (
                  <Check className="size-5.5" aria-hidden />
                )}
              </Button>
            ) : (
              <Button
                type="button"
                size="icon-lg"
                className="size-12 rounded-full hover:bg-primary/90"
                aria-label={recordLabel}
                title={recordLabel}
                disabled={disabled}
                onClick={() => {
                  if (onRecordVoice) onRecordVoice();
                  else void voiceRecorder.start();
                }}
              >
                <Mic className="size-5.5" aria-hidden />
              </Button>
            )}
          </div>
          {editing?.error ? (
            // Under the field, not the attach button beside it.
            <p role="alert" className={cn("mt-1.5 mr-15 pl-4 text-caption text-destructive", !textOnly && "ml-14")}>
              {editing.error}
            </p>
          ) : null}
          {showCounter ? (
            <p
              id={counterId}
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
