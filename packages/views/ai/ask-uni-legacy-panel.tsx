"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowLeft, MessageSquarePlus, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useAiCapabilities,
  useAiConversations,
  useAiMessages,
  useAiPanelStore,
  useAskUni,
  useDeleteAiConversation,
} from "@uniwork/core/ai";
import { errorCode } from "@uniwork/core/api/http";
import { useMeeting } from "@uniwork/core/meetings";
import type { AiCitation, AiMessage } from "@uniwork/core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { IconTile, tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";

const KNOWN_ERRORS = new Set([
  "ai_quota_exceeded",
  "ai_rate_limited",
  "ai_disabled",
  "ai_context_forbidden",
  "ai_output_invalid",
  "ai_provider_error",
  "ai_provider_timeout",
  "ai_tool_not_allowed",
]);

const SUGGESTIONS = ["suggestion_overdue", "suggestion_meetings", "suggestion_chat"] as const;

const MeetingIcon = MODULE_ICONS.meetings;

/** What the conversation is about, when it is about one meeting: "Cuộc họp: <title>". */
function MeetingContextChip({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const meeting = useMeeting(meetingId);
  // A meeting that cannot be read still says the question is about one, rather than vanishing.
  if (!meeting.data && !meeting.isError) return null;
  return (
    <p className="mb-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-caption text-foreground">
      <MeetingIcon aria-hidden className={cn("size-3.5 shrink-0", tintForegroundClass[moduleTone("meetings")])} />
      <span className="truncate">
        {meeting.data ? t("context_meeting", { title: meeting.data.title }) : t("context_meeting_unavailable")}
      </span>
    </p>
  );
}

/** The ai.errors.* key for a failed ask; the meeting copilot's Ask UNI box reads it too. */
export function resolveErrorKey(err: unknown): string {
  const code = errorCode(err) ?? "";
  if (KNOWN_ERRORS.has(code)) return code;
  const message = (err as { message?: unknown } | null)?.message;
  const candidate = typeof message === "string" ? message : "";
  return KNOWN_ERRORS.has(candidate) ? candidate : "default";
}

type Translate = ReturnType<typeof useTranslation>["t"];

function noticeText(t: Translate, code: string): string {
  switch (code) {
    case "no_sources":
      return t("notice.no_sources");
    case "stopped":
      return t("notice.stopped");
    case "interrupted":
      return t("notice.interrupted");
    default:
      return t("notice.unavailable");
  }
}

/** A transcript source is the meeting's title, worded in the reader's language. */
function citationLabel(t: Translate, c: AiCitation): string {
  if (c.kind === "transcript") return t("source_transcript", { title: c.title });
  return c.title || c.kind;
}

function Citations({ citations }: { citations: AiCitation[] }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const linkable = citations.filter((c) => c.href);
  if (linkable.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t("sources")}>
      {linkable.map((c) => (
        <li key={c.source_id}>
          {/* A link, styled as one: "[S1]" ties it to the answer's marker, in the text face, not as code. */}
          <AppLink
            href={c.href}
            className="inline-flex max-w-full items-center gap-1 text-caption text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11"
          >
            <span className="tabular-nums">[{c.source_id}]</span>
            <span className="truncate">{citationLabel(t, c)}</span>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

/** One question or answer. `notice` is optional so a static preview (the landing demo) can render a turn. */
export function AskUniMessageTurn({
  message,
}: {
  message: Pick<AiMessage, "id" | "role" | "content" | "citations"> & Partial<Pick<AiMessage, "notice">>;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const mine = message.role === "user";
  return (
    <li className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      <span className="px-1 text-caption font-medium text-muted-foreground">{mine ? t("you") : t("uni")}</span>
      <div
        className={cn(
          "max-w-[94%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-body leading-6",
          mine ? "bg-surface-selected text-surface-selected-foreground" : "border border-border bg-surface text-foreground",
        )}
      >
        {message.content === "" && message.notice ? noticeText(t, message.notice) : message.content}
        {mine ? null : <Citations citations={message.citations} />}
      </div>
    </li>
  );
}

/** The legacy ⌘J overlay panel, kept while ask_uni_stream is off (spec F-09 §6): ClickUp-Brain-style sidebar, read-only answers with sources. */
export function AskUniLegacyPanel() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "ai" });
  const { workspace } = useWorkspace();
  const caps = useAiCapabilities(workspace.id);
  const enabled = !!caps.data?.enabled;
  const {
    open,
    setOpen,
    conversationId,
    workspaceId,
    bindWorkspace,
    select,
    pendingFocus,
    focusByConversation,
    forgetConversation,
  } = useAiPanelStore();
  // Until bindWorkspace runs, the stored conversation may belong to the previous workspace.
  const activeConversationId = workspaceId === workspace.id ? conversationId : null;
  const conversations = useAiConversations(workspace.id, open && enabled);
  const messages = useAiMessages(activeConversationId);
  const ask = useAskUni(workspace.id);
  const remove = useDeleteAiConversation(workspace.id);
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const askReset = ask.reset;
  const answeredConversation = ask.data?.conversation_id;
  useEffect(() => {
    if (answeredConversation && answeredConversation !== activeConversationId) askReset();
  }, [activeConversationId, answeredConversation, askReset]);
  useEffect(() => bindWorkspace(workspace.id), [workspace.id, bindWorkspace]);

  if (!enabled) return null;

  const askQuestion = (raw: string) => {
    const q = raw.trim();
    if (!q || ask.isPending) return;
    setPendingQuestion(q);
    setQuestion("");
    // A follow-up keeps the conversation's focus: the server does not store it, and the chip says it holds.
    const focus = pendingFocus ?? (activeConversationId ? focusByConversation[activeConversationId] : undefined);
    ask.mutate(
      {
        question: q,
        conversation_id: activeConversationId ?? undefined,
        locale: i18n.language,
        focus: focus ? { kind: focus.kind, id: focus.id } : undefined,
      },
      {
        onSuccess: (res) => {
          // A late answer from the workspace we left must not open its conversation here.
          // (useAskUni already remembered the conversation's focus.)
          if (useAiPanelStore.getState().workspaceId !== workspace.id) return;
          select(res.conversation_id);
        },
        onSettled: () => setPendingQuestion(null),
        onError: () => setQuestion(q),
      },
    );
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    askQuestion(question);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // An IME commits its syllable on Enter; that keydown must not send.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  const turns: Pick<AiMessage, "id" | "role" | "content" | "notice" | "citations">[] = [...(messages.data ?? [])];
  if (pendingQuestion) turns.push({ id: "pending", role: "user", content: pendingQuestion, notice: "", citations: [] });
  const showHome = !activeConversationId && !pendingQuestion;
  const focus = pendingFocus ?? (activeConversationId ? focusByConversation[activeConversationId] : undefined);
  const meetingFocusId = focus?.kind === "meeting" ? focus.id : null;
  const recent = conversations.data ?? [];
  // One region, always mounted, says only what just changed; the history is never re-read.
  const answered = ask.data?.message;
  const liveText = ask.isPending
    ? t("asking")
    : answered
      ? t("answer_announcement", { answer: answered.content || noticeText(t, answered.notice) })
      : "";
  const loadingHistory = !!activeConversationId && messages.isPending;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        closeLabel={t("close")}
        initialFocus={composerRef}
      >
        <SheetHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 pr-8">
            {!showHome ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8 shrink-0"
                aria-label={t("back_conversations")}
                onClick={() => select(null)}
              >
                <ArrowLeft aria-hidden className="size-4" />
              </Button>
            ) : null}
            <div className="min-w-0 flex-1">
              <SheetTitle className="flex items-center gap-2 text-title">
                <IconTile icon={Sparkles} size="sm" tone="violet" />
                {t("title")}
              </SheetTitle>
              <SheetDescription className="mt-0.5 line-clamp-2">{t("description")}</SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8"
                aria-label={t("new_conversation")}
                onClick={() => select(null)}
              >
                <MessageSquarePlus aria-hidden className="size-4" />
              </Button>
              {activeConversationId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-8"
                  aria-label={t("delete_conversation")}
                  aria-disabled={remove.isPending || undefined}
                  onClick={() => {
                    if (!remove.isPending) setConfirmDelete(true);
                  }}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("delete_confirm_title")}</AlertDialogTitle>
                <AlertDialogDescription>{t("delete_confirm_description")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("delete_cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  aria-disabled={remove.isPending || undefined}
                  onClick={() => {
                    if (!activeConversationId || remove.isPending) return;
                    remove.mutate(activeConversationId, {
                      onSuccess: () => {
                        setConfirmDelete(false);
                        forgetConversation(activeConversationId);
                        select(null);
                      },
                    });
                  }}
                >
                  {t("delete_confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {showHome ? (
            <div className="flex h-full flex-col gap-6">
              <div className="flex flex-col items-center gap-3 pt-6 text-center">
                <IconTile icon={Sparkles} size="lg" tone="violet" />
                <div className="flex max-w-[40ch] flex-col gap-1">
                  <p className="text-body font-semibold text-foreground">{t("empty_title")}</p>
                  <p className="text-caption text-muted-foreground">{t("empty_description")}</p>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((key) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-disabled={ask.isPending || undefined}
                    onClick={() => askQuestion(t(key))}
                  >
                    {t(key)}
                  </Button>
                ))}
              </div>
              {recent.length > 0 ? (
                <div className="mt-auto space-y-2 border-t border-border pt-4">
                  <p className="text-caption font-medium text-muted-foreground">{t("conversations")}</p>
                  <ul className="space-y-1">
                    {recent.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-control border border-transparent px-3 py-2.5 text-left text-body hover:border-border hover:bg-surface-hover pointer-coarse:min-h-11"
                          onClick={() => select(c.id)}
                        >
                          <span className="min-w-0 flex-1 truncate">{c.title || t("untitled")}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : loadingHistory ? (
            <div className="space-y-4" aria-busy="true" aria-label={t("loading_conversation")}>
              <Skeleton className="ml-auto h-10 w-2/3" />
              <Skeleton className="h-20 w-11/12" />
            </div>
          ) : messages.isError && turns.length === 0 ? (
            <div role="alert" className="flex flex-col items-start gap-2 rounded-md border border-border bg-surface px-3 py-2.5">
              <p className="text-caption text-foreground">{t("conversation_error")}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void messages.refetch()}>
                {t("conversation_retry")}
              </Button>
            </div>
          ) : (
            <ul className="space-y-4">
              {turns.map((m) => (
                <AskUniMessageTurn key={m.id} message={m} />
              ))}
              {ask.isPending ? (
                <li aria-hidden className="flex items-center gap-2 text-caption text-muted-foreground">
                  <Spinner className="size-3.5" />
                  {t("asking")}
                </li>
              ) : null}
            </ul>
          )}
          <p role="status" className="sr-only">
            {liveText}
          </p>
          {ask.isError ? (
            <p
              role="alert"
              className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-caption text-destructive"
            >
              {t(`errors.${resolveErrorKey(ask.error)}`)}
            </p>
          ) : null}
          {ask.data && !ask.isPending ? (
            <p className="mt-4 text-caption text-muted-foreground tabular-nums">
              {t("usage_tokens", { in: ask.data.usage.input_tokens, out: ask.data.usage.output_tokens })}
            </p>
          ) : null}
        </div>

        <form onSubmit={submit} className="border-t border-border bg-surface/60 p-3">
          <div className="rounded-lg border border-border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
            {meetingFocusId ? <MeetingContextChip meetingId={meetingFocusId} /> : null}
            <Textarea
              ref={composerRef}
              aria-label={t("input_label")}
              aria-describedby="ask-uni-hint"
              placeholder={t("placeholder")}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              maxLength={2000}
              // The wrapper's full-strength ring is the one focus indicator of the composer.
              className="min-h-[3.25rem] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 focus-visible:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-1 pb-0.5 pt-1">
              {/* A touch keyboard has no Enter to read about; the hint stays as the field's description. */}
              <p id="ask-uni-hint" className="text-caption text-muted-foreground pointer-coarse:hidden">
                <Kbd>{t("key_enter")}</Kbd> {t("hint_send")}
              </p>
              <Button
                type="submit"
                size="sm"
                className="ml-auto px-4"
                aria-disabled={!question.trim() || ask.isPending || undefined}
              >
                {ask.isPending ? <Spinner className="size-3.5" /> : null}
                {t("ask")}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
