"use client";

import { useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Bell,
  CircleAlert,
  Clock,
  Mic,
  Paperclip,
  Send,
  StickyNote,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ComposerMessagePriority } from "@uniwork/core/chat/composer-priority";
import { CHAT_MESSAGE_BODY_MAX_LENGTH } from "@uniwork/core/chat/client-msg-id";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { ChatExpressionPicker } from "./chat-expression-picker";
import { ChatMentionAutocomplete } from "./chat-mention-autocomplete";
import type { ChatMentionCandidate } from "./chat-mention-utils";
import {
  deserializeMessageBodyToComposerDraft,
  filterMentionCandidates,
  formatComposerMentionDisplay,
  getActiveMentionQuery,
  insertMentionToken,
} from "./chat-mention-utils";
import { useChatVoiceRecorder } from "./use-chat-voice-recorder";

type ComposerAttachAction =
  | "create_poll"
  | "create_reminder"
  | "create_note"
  | "mark_important"
  | "mark_urgent"
  | "stickers"
  | "voice"
  | "location";

type ComposerAttachMenuItem =
  | {
      id: ComposerAttachAction;
      icon: typeof BarChart3;
      labelKey: string;
      separatorAfter?: false;
    }
  | { separator: true };

const ATTACH_MENU_ITEMS: ComposerAttachMenuItem[] = [
  { id: "create_poll", icon: BarChart3, labelKey: "composer_create_poll" },
  { id: "create_reminder", icon: Clock, labelKey: "composer_create_reminder" },
  { id: "create_note", icon: StickyNote, labelKey: "composer_create_note" },
  { separator: true },
  { id: "mark_important", icon: CircleAlert, labelKey: "composer_mark_important" },
  { id: "mark_urgent", icon: Bell, labelKey: "composer_mark_urgent" },
];

function ComposerToolbarButton({
  label,
  disabled,
  children,
  className,
  ...props
}: React.ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        "pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function filterAttachMenuItems(
  items: ComposerAttachMenuItem[],
  showCreatePoll: boolean,
): ComposerAttachMenuItem[] {
  if (showCreatePoll) return items;
  return items.filter((item) => !("id" in item) || item.id !== "create_poll");
}

function ComposerAttachMenu({
  disabled,
  onAction,
  align = "end",
  showCreatePoll = true,
}: {
  disabled?: boolean;
  onAction: (action: ComposerAttachAction) => void;
  align?: "start" | "end";
  showCreatePoll?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuItems = useMemo(
    () => filterAttachMenuItems(ATTACH_MENU_ITEMS, showCreatePoll),
    [showCreatePoll],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <ComposerToolbarButton label={t("chat.composer_attach")} disabled={disabled}>
            <Paperclip aria-hidden className="size-5" />
          </ComposerToolbarButton>
        }
      />
      <PopoverContent align={align} side="top" className="w-72 p-1">
        <ul className="flex flex-col" role="menu" aria-label={t("chat.composer_attach_menu")}>
          {menuItems.map((item, index) =>
            "separator" in item ? (
              <li key={`sep-${index}`} role="separator" className="my-1 h-px bg-border" />
            ) : (
              <li key={item.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-body text-foreground",
                    "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                  )}
                  onClick={() => {
                    setOpen(false);
                    onAction(item.id);
                  }}
                >
                  <item.icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                  <span>{t(`chat.${item.labelKey}`)}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      </PopoverContent>
    </Popover>
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
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-caption text-destructive">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate font-medium">{label}</span>
      <button
        type="button"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-muted-foreground/10 hover:text-foreground"
        aria-label={t("chat.composer_clear_priority")}
        onClick={onClear}
      >
        <X className="size-3.5" aria-hidden />
      </button>
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
  showCreatePoll?: boolean;
}) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const canSend = !disabled && draft.trim().length > 0;
  const mentionEnabled = mentionCandidates !== undefined;
  const voiceRecorder = useChatVoiceRecorder();
  const voiceActive = voiceRecorder.state !== "idle" || Boolean(voiceRecorder.error);

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
    onSend();
  };

  const voiceTime = `${Math.floor(voiceRecorder.elapsedMs / 60_000)}:${Math.floor(
    (voiceRecorder.elapsedMs % 60_000) / 1000,
  )
    .toString()
    .padStart(2, "0")}`;

  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-border bg-surface px-3 py-3">
      {typingLabel ? (
        <p className="px-2 text-caption text-muted-foreground" aria-live="polite">
          {typingLabel}
        </p>
      ) : null}
      {composerPriority ? (
        <div className="px-2">
          <ComposerPriorityChip
            priority={composerPriority}
            onClear={() => onComposerPriorityChange?.(null)}
          />
        </div>
      ) : null}
      {voiceActive ? (
        <div className="flex min-h-11 items-center gap-3 rounded-2xl border border-border bg-muted/40 px-3 py-2">
          <span className="size-2 shrink-0 rounded-full bg-destructive" aria-hidden />
          <span className="min-w-0 flex-1 text-body tabular-nums text-foreground">
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
        <div className="flex min-w-0 items-end gap-2 rounded-2xl border border-border bg-muted/40 px-2 py-1.5 shadow-sm lg:rounded-full">
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
              placeholder={placeholder}
              aria-label={placeholder}
              disabled={disabled}
              rows={1}
              className="max-h-32 min-h-9 w-full resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0 md:text-body"
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
              <Button
                type="submit"
                size="icon"
                className="size-9 shrink-0 rounded-full"
                aria-label={sendLabel}
              >
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

export type { ComposerAttachAction };
