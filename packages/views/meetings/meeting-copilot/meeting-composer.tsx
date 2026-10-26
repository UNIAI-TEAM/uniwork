"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, AtSign, Check, CircleQuestionMark, Lock, PencilLine, Sparkles, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { aiKeys, useAiCapabilities, useAiMessages, useAiPanelStore, useAskUni } from "@uniwork/core/ai";
import { useAddNote } from "@uniwork/core/meetings";
import type { AiMessage } from "@uniwork/core/types";
import { isImeComposing } from "@uniwork/core/utils";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { AskUniEditor, type AskUniEditorHandle, type AskUniQuestion } from "../../ai/ask-uni-editor";
import { noticeText, resolveErrorKey } from "../../ai/ask-uni-legacy-panel";
import { MODULE_ICONS } from "../../layout/module-icons";
import { toastApiError } from "../../toast-api-error";
import { INPUT_TYPE, ROUND } from "../composer-classes";
import { tablistKeyTarget } from "../tablist-keys";
import { forChat } from "./ask-answer-card";
import { ComposerSuggestions, type ComposerSuggestion } from "./composer-suggestions";

const MAX_MENTIONS = 5;
const EMPTY: AskUniQuestion = { question: "", mentions: [] };
const MeetingIcon = MODULE_ICONS.meetings;

type Mode = "ask" | "note";
type Blocked = "outOfCredit" | "askOff";

/** The exchange the composer last had with UNI: what the answer card above it shows. */
export interface MeetingAsk {
  question: string;
  answer: AiMessage | null;
  pending: boolean;
  conversationId: string | null;
}

/** The conversation's newest answer and the question it answers. */
function lastExchange(history: AiMessage[] | undefined): { question: string; answer: AiMessage } | null {
  const i = history?.findLastIndex((m) => m.role === "assistant") ?? -1;
  if (!history || i < 0) return null;
  const prev = history[i - 1];
  return { question: prev?.role === "user" ? prev.content : "", answer: history[i]! };
}

const isAbort = (err: unknown) => (err as { name?: unknown } | null)?.name === "AbortError";

/** The refusals that close Ask for this meeting rather than fail one question. */
const REFUSALS: Record<string, Blocked> = { ai_quota_exceeded: "outOfCredit", ai_disabled: "askOff" };

function ModeRadio({ ref, checked, tone, disabled, describedBy, onPick, onKeyDown, icon, label }: {
  ref: Ref<HTMLButtonElement>;
  describedBy?: string;
  tone: string;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  checked: boolean;
  disabled: boolean;
  onPick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      tabIndex={checked ? 0 : -1}
      onClick={disabled ? undefined : onPick}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex h-6.5 items-center gap-1 rounded-lg pr-2.25 pl-1.75 text-caption transition-colors pointer-coarse:h-9.5 pointer-coarse:min-w-11 pointer-coarse:justify-center pointer-coarse:px-0 [&_svg]:size-3.5",
        checked ? cn("bg-surface font-semibold shadow-sm", tone) : "font-medium text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed text-faint-foreground hover:text-faint-foreground",
      )}
    >
      {icon}
      {/* On a phone the mode is its icon; the label still names the radio. */}
      <span className="pointer-coarse:sr-only">{label}</span>
    </button>
  );
}

/**
 * The UNI tab's one input, pinned under the feed: "Ask" puts a private
 * question to UNI about this meeting (`@` cards, Enter sends), "Note" writes a
 * note everyone in the room sees. The edge tells the state (`ai-edge` in
 * base.css): at rest, focused, UNI at work (beam, with Stop), or the ink of a
 * note. When Ask UNI is off or out of credit the composer falls back to notes
 * and says why. The exchange itself is reported through `onAsked` for the
 * answer card above.
 */
export function MeetingComposer({
  workspaceId,
  meetingId,
  notesCount,
  hasTranscript,
  suggestions,
  onAsked,
}: {
  workspaceId: string;
  meetingId: string;
  notesCount: number;
  hasTranscript: boolean;
  /** Questions offered over an empty Ask box (`useMeetingSuggestions`). */
  suggestions: ComposerSuggestion[];
  onAsked?: (ask: MeetingAsk) => void;
}) {
  const { t, i18n } = useTranslation();
  const { t: tAi } = useTranslation(undefined, { keyPrefix: "ai" });
  const tc = (key: string, opts?: Record<string, unknown>) => t(`meetings.panel.composer.${key}`, opts);
  const qc = useQueryClient();
  const { data: caps } = useAiCapabilities(workspaceId);
  const ask = useAskUni(workspaceId);
  const addNote = useAddNote(meetingId);
  // The conversation lives in the Ask UNI store and its turns in the query cache, so a remount
  // (switching the panel's tabs) shows the last answer again and ⌘J can continue it.
  const conversationId = useAiPanelStore((s) => s.conversationByMeeting[meetingId]);
  const history = useAiMessages(conversationId ?? null).data;

  const root = useRef<HTMLDivElement>(null);
  const box = useRef<AskUniEditorHandle>(null);
  const noteBox = useRef<HTMLTextAreaElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const controller = useRef<AbortController | null>(null);
  const [chosen, setChosen] = useState<Mode>("ask");
  const [draft, setDraft] = useState<AskUniQuestion>(EMPTY);
  const [asked, setAsked] = useState("");
  const [note, setNote] = useState("");
  // An ask refused for quota or with AI switched off closes Ask for this meeting, whatever the cached
  // capabilities (kept 5 minutes) still say.
  const [refused, setRefused] = useState<Blocked | null>(null);

  const quota = caps?.quota;
  const capsBlock: Blocked | null = !caps
    ? null
    : !caps.ask_uni
      ? "askOff"
      : quota && quota.limit_tokens !== null && quota.used_tokens >= quota.limit_tokens
        ? "outOfCredit"
        : null;
  const blocked = capsBlock ?? refused;
  // Blocking moves the person's own choice to Note, so a later unblock does not pull them back to Ask mid-note.
  if (blocked && chosen !== "note") setChosen("note");
  const mode: Mode = blocked ? "note" : chosen;
  const pending = ask.isPending;
  const focus = { kind: "meeting", id: meetingId } as const;

  const exchange = pending
    ? { question: asked, answer: null }
    : (lastExchange(history) ?? (ask.data ? { question: asked, answer: ask.data.message } : null));
  const report = useRef(onAsked);
  report.current = onAsked;
  const shownQuestion = exchange?.question ?? "";
  const shownAnswer = exchange?.answer ?? null;
  useEffect(() => {
    report.current?.({ question: shownQuestion, answer: shownAnswer, pending, conversationId: conversationId ?? null });
  }, [shownQuestion, shownAnswer, pending, conversationId]);

  const send = ({ question, mentions }: AskUniQuestion) => {
    if (!question || pending || mode !== "ask") return;
    const abort = new AbortController();
    controller.current = abort;
    setAsked(question);
    box.current?.clear();
    // useAskUni remembers the conversation for this meeting, even if the composer unmounts meanwhile.
    ask.mutate(
      { question, mentions, conversation_id: conversationId, locale: i18n.language, focus, signal: abort.signal },
      {
        // Stopped or failed, the question comes back to the box (as text: its cards are not restored). Refused
        // for good, it moves to the note box instead of waiting in a hidden one.
        onError: (err) => {
          const block = REFUSALS[resolveErrorKey(err)];
          if (!block) {
            box.current?.insert(question);
            return;
          }
          setRefused(block);
          setNote((n) => (n.trim() ? `${n}\n${question}` : question));
          void qc.invalidateQueries({ queryKey: aiKeys.capabilities(workspaceId) });
        },
      },
    );
  };

  const saveNote = (e?: FormEvent) => {
    e?.preventDefault();
    const text = note.trim();
    if (!text || addNote.isPending) return;
    addNote.mutate(text, {
      onSuccess: () => setNote(""),
      onError: (err) => toastApiError(err, t("meetings.noteAddFailed")),
    });
  };
  const noteKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || isImeComposing(e.nativeEvent)) return;
    e.preventDefault();
    saveNote();
  };

  const modes: { id: Mode; label: string; tone: string; icon: ReactNode }[] = [
    { id: "ask", label: tc("ask"), tone: "text-brand", icon: blocked ? <Lock aria-hidden /> : <Sparkles aria-hidden /> },
    { id: "note", label: tc("note"), tone: "text-foreground", icon: <PencilLine aria-hidden /> },
  ];
  // Leaving Ask clears its failure: it was about a question no longer on screen.
  const choose = (m: Mode) => {
    setChosen(m);
    if (m === "note" && ask.isError) ask.reset();
  };
  const radioKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = tablistKeyTarget(e.key, modes.findIndex((m) => m.id === mode), modes.length);
    if (next === null || blocked) return;
    e.preventDefault();
    choose(modes[next]!.id);
    radios.current[next]?.focus();
  };

  // Focus follows the exchange: to Stop while UNI works, back to the box when it ends (the box is hidden
  // meanwhile, and Stop leaves with the pending state). Only when focus was here or nowhere.
  const wasPending = useRef(pending);
  useEffect(() => {
    if (wasPending.current === pending) return;
    wasPending.current = pending;
    const active = document.activeElement;
    if (active && active !== document.body && !root.current?.contains(active)) return;
    if (pending) stopButton.current?.focus();
    else if (mode === "note") noteBox.current?.focus();
    else box.current?.focus();
  }, [pending, mode]);

  // A failure other than a stop or a refusal that closes Ask (which has its strip) is said in the frame.
  const answered = ask.data?.message;
  const failKey = ask.isError && !isAbort(ask.error) ? resolveErrorKey(ask.error) : null;
  const failure = failKey && !REFUSALS[failKey] ? failKey : null;
  const canAsk = draft.question !== "";
  const showSuggestions = mode === "ask" && !pending && !canAsk && suggestions.length > 0;

  return (
    <div ref={root} className="flex flex-col gap-2.5" data-testid="meeting-composer">
      {showSuggestions ? <ComposerSuggestions items={suggestions} onPick={(q) => send({ question: q, mentions: [] })} /> : null}
      <div
        data-testid="meeting-composer-frame"
        // Positioned: the @ picker opens above the frame. 22px corners on a phone (important beats the unlayered rule).
        className={cn("ai-edge relative pointer-coarse:[--ai-edge-radius:22px]!", mode === "note" && "ai-edge-note", pending && "border-beam-ai")}
      >
        <div>
          {blocked ? (
            <div className="flex items-center gap-2 rounded-t-[inherit] bg-warning-soft px-3 py-1.5 text-caption font-medium text-warning-soft-foreground">
              <Lock aria-hidden className="size-3.5 shrink-0" />
              <span id={reasonId} className="min-w-0 flex-1">
                {tc(blocked)}
              </span>
              <Popover>
                <PopoverTrigger
                  aria-label={tc("blockedHelp")}
                  className="relative grid size-6 shrink-0 place-items-center rounded-full pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-['']"
                >
                  <CircleQuestionMark aria-hidden className="size-3.5" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)] p-3 text-caption text-foreground">
                  {t(blocked === "askOff" ? "ai.errors.ai_disabled" : "ai.errors.ai_quota_exceeded")}
                </PopoverContent>
              </Popover>
            </div>
          ) : null}
          <form
            className="flex flex-col gap-2.5 pt-2.75 pr-2.5 pb-2 pl-3"
            onSubmit={mode === "note" ? saveNote : (e) => e.preventDefault()}
          >
            {failure ? (
              <p role="alert" className="px-0.5 text-caption text-destructive">
                {t(`ai.errors.${failure}`)}
              </p>
            ) : null}
            {/* Both boxes stay mounted, so switching modes keeps what was typed in each. */}
            <div hidden={mode !== "ask" || pending}>
              <AskUniEditor
                ref={box}
                wsId={workspaceId}
                label={tc("askLabel")}
                placeholder={conversationId ? tc("followupPlaceholder") : tc("askPlaceholder")}
                maxMentions={MAX_MENTIONS}
                className={INPUT_TYPE}
                disabled={!!blocked}
                onSubmit={send}
                onChange={setDraft}
              />
            </div>
            {/* Mounted before the first question, so the reader hears UNI start and then its answer, once: an answer
                read back from history on a remount is not news. Out of the layout while idle. */}
            <div
              role="status"
              data-testid="meeting-ask-live"
              className={pending ? "flex h-5.5 items-center gap-2 px-0.5 text-body font-medium" : "sr-only"}
            >
              {pending ? (
                <span className="ai-shimmer">
                  {notesCount > 0 && hasTranscript ? tc("readingNotes", { count: notesCount }) : tc("reading")}
                </span>
              ) : blocked ? (
                // The strip shows the reason; this says it when Ask closes.
                tc(blocked)
              ) : answered ? (
                t("ai.answer_announcement", { answer: forChat(answered.content) || noticeText(tAi, answered.notice) })
              ) : null}
            </div>
            <Textarea
              ref={noteBox}
              hidden={mode !== "note"}
              rows={1}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={noteKey}
              placeholder={tc("notePlaceholder")}
              aria-label={tc("noteLabel")}
              className={cn("max-h-[6lh] min-h-0 resize-none rounded-none border-0 bg-transparent px-0.5 py-0 focus-visible:ring-0 dark:bg-transparent", INPUT_TYPE)}
            />
            {pending ? (
              <div className="flex items-center gap-1.5">
                <span className="inline-flex h-6.5 items-center gap-1 rounded-[9px] bg-brand-subtle pr-2.25 pl-1.75 text-caption font-semibold text-brand">
                  <Lock aria-hidden className="size-3.5" />
                  {tc("private")}
                </span>
                <Button ref={stopButton} type="button" aria-label={tc("stop")} className={cn(ROUND, "ml-auto bg-foreground text-background hover:bg-foreground/90")} onClick={() => controller.current?.abort()}>
                  <span aria-hidden className="size-2.5 rounded-[2.5px] bg-background" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <div
                  role="radiogroup"
                  aria-label={tc("modeLabel")}
                  className={cn("flex rounded-[10px] p-0.5", mode === "note" ? "bg-warning-soft/60" : "bg-surface-hover")}
                >
                  {modes.map((m, i) => (
                    <ModeRadio
                      key={m.id}
                      ref={(el) => void (radios.current[i] = el)}
                      checked={mode === m.id}
                      tone={m.tone}
                      disabled={m.id === "ask" && !!blocked}
                      describedBy={m.id === "ask" && blocked ? reasonId : undefined}
                      onPick={() => choose(m.id)}
                      onKeyDown={radioKey}
                      icon={m.icon}
                      label={m.label}
                    />
                  ))}
                </div>
                {mode === "ask" ? (
                  <span title={tc("scopeLabel")} className="inline-flex h-6.5 items-center gap-1 rounded-lg px-2 text-caption font-medium text-muted-foreground ring-1 ring-border ring-inset">
                    <MeetingIcon aria-hidden className="size-3.5" />
                    <span aria-hidden>{tc("scope")}</span>
                    <span className="sr-only">{tc("scopeLabel")}</span>
                  </span>
                ) : (
                  <span className="inline-flex h-6.5 items-center gap-1 px-2 text-caption font-medium text-muted-foreground">
                    <Users aria-hidden className="size-3.5" />
                    {tc("everyone")}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                  {mode === "ask" ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={tc("mention")}
                        className="size-7.5 rounded-[9px] p-0 text-muted-foreground pointer-coarse:size-11"
                        onClick={() => {
                          box.current?.insert("@");
                          box.current?.focus();
                        }}
                      >
                        <AtSign aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        aria-label={tc("send")}
                        aria-disabled={!canAsk || undefined}
                        className={cn(ROUND, canAsk ? "bg-linear-to-br from-brand to-tint-violet-foreground text-brand-foreground" : "bg-surface-hover text-faint-foreground")}
                        onClick={() => send(draft)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="submit"
                      aria-label={tc("saveNote")}
                      aria-disabled={!note.trim() || addNote.isPending || undefined}
                      className={cn(ROUND, note.trim() ? "bg-foreground text-background hover:bg-foreground/90" : "bg-surface-hover text-faint-foreground")}
                    >
                      <Check aria-hidden />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
