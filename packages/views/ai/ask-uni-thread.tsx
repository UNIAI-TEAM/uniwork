"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiMessages, useAiPanelStore } from "@uniwork/core/ai";
import type { AskOutcome, AskStreamState } from "@uniwork/core/ai/stream";
import type { AiAttachment, AiCitation, AiMessage, AskUniInput } from "@uniwork/core/types";
import { AskUniFollowups } from "./ask-uni-followups";
import { AskUniMessageTurn, type AskUniTurnMessage } from "./ask-uni-answer";
import { useEffectiveFocus } from "./ask-uni-page-context";
import { useSmoothText } from "./use-smooth-text";

/** What AskUniPanel owns and hands down: the live turn's state and its controls. */
export interface AskUniStream {
  state: AskStreamState;
  ask: (input: AskUniInput, display?: { attachments: AiAttachment[] }) => Promise<AskOutcome>;
  stop: () => void;
}
const NEAR_BOTTOM_PX = 80;
const SAFE_CODE = /^[a-z_]+$/;
// A model call that goes on to a tool streams a lead-in ("Để tôi tra cứu…") that the step then clears, so a call's
// text shows only once it is longer than a lead-in.
// shortcut: a lead-in longer than this still flashes; upgrade when the server can say which call is the answer.
const DRAFT_HOLD_CHARS = 160;

/** How many turns the cache held when the live turn started; null until the history has loaded. */
interface Anchor {
  base: number | null;
}

function StreamError({ code, openUrl }: { code: string | null; openUrl?: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  // The code comes off the wire; only a plain snake_case word may become a key.
  const text = code && SAFE_CODE.test(code) ? t(`errors.${code}`, { defaultValue: t("errors.default") }) : t("errors.default");
  return (
    <li role="alert" className="flex flex-wrap items-center gap-2 text-caption text-destructive">
      <span className="flex items-start gap-2">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {text}
      </span>
      {code === "drive_format_unsupported" && openUrl ? (
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <ExternalLink aria-hidden className="size-3.5" />
          {t("drive.open_on_drive")}
        </a>
      ) : null}
    </li>
  );
}
/** One stored turn: while it is being regenerated the live cell takes its place; a failed regenerate shows it again with the error. */
function StoredTurn({
  message,
  replacement,
  error,
  openUrl,
  isLast,
  followups,
  onAskFollowup,
  onProposeTasks,
  onRegenerate,
  onAskAgain,
  conversationId,
  transient = false,
  stream,
  thinking,
  sources,
  wsId,
}: {
  message: AiMessage;
  replacement: AskUniTurnMessage | null;
  /** Error code of a failed regenerate of this answer; undefined when there is none. */
  error: string | null | undefined;
  openUrl?: string;
  isLast: boolean;
  followups: string[];
  onAskFollowup: (q: string) => void;
  onProposeTasks?: () => void;
  onRegenerate: () => void;
  onAskAgain?: () => void;
  conversationId: string | null;
  transient?: boolean;
  stream: AskStreamState;
  /** The live call's thinking, as the reader sees it. */
  thinking: string;
  sources: Map<string, AiCitation>;
  wsId?: string;
}) {
  if (replacement) {
    return (
      <AskUniMessageTurn
        message={{ ...replacement, id: "live" }}
        streaming
        steps={stream.steps}
        writing={replacement.content !== ""}
        thinking={thinking}
        sources={sources}
        wsId={wsId}
      />
    );
  }
  return (
    <>
      <AskUniMessageTurn
        message={message}
        conversationId={conversationId}
        transient={transient}
        steps={stream.message?.id === message.id && stream.steps.length > 0 ? stream.steps : undefined}
        sources={sources}
        wsId={wsId}
        // An answer with proposals (or memory proposals) is not regenerated: its rows may already have changed something.
        onRegenerate={!transient && isLast && message.proposals.length === 0 && message.memory_proposals.length === 0 ? onRegenerate : undefined}
        onAskAgain={transient && isLast ? onAskAgain : undefined}
        regenerateDisabled={stream.status === "streaming"}
      />
      {error !== undefined ? <StreamError code={error} openUrl={openUrl} /> : null}
      {isLast ? <AskUniFollowups items={followups} onAsk={onAskFollowup} onProposeTasks={onProposeTasks} /> : null}
    </>
  );
}

/** The docked panel's conversation: stored turns, then the live question and answer until the cache holds them. */
export function AskUniThread({
  conversationId,
  stream,
  askDefaults,
  wsId,
  onProposeDriveTasks,
}: {
  conversationId: string | null;
  stream: AskUniStream;
  wsId?: string;
  /** The composer's model, effort and language, so a regenerated turn runs the way a typed one would. */
  askDefaults?: Pick<AskUniInput, "model" | "effort" | "locale">;
  /** Optional seam for W6 "Tạo việc từ tài liệu này" suggestion chip in transient Drive answers. */
  onProposeDriveTasks?: (driveFileId: string) => void;
}) {
  const { state, ask } = stream;
  const focus = useEffectiveFocus();
  const transientMessages = useAiPanelStore((s) => s.transientMessages);
  const isTransient = conversationId === null && (focus?.kind === "drive_file" || transientMessages.length > 0);
  const cached = useAiMessages(isTransient ? null : conversationId).data;
  const stored = useMemo<AiMessage[]>(() => (isTransient ? transientMessages : (cached ?? [])), [isTransient, transientMessages, cached]);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const streaming = state.status === "streaming";
  // A new turn starts. A new conversation has nothing stored yet; otherwise the base waits for the history, never an empty loading list.
  useEffect(() => {
    if (streaming) {
      setAnchor({ base: isTransient ? transientMessages.length : conversationId === null ? 0 : cached ? cached.length : null });
    }
    // Only a new question starts a turn; later cache or conversation changes must not move the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, state.question]);
  useEffect(() => {
    if (!isTransient && anchor && anchor.base === null && cached) setAnchor({ base: cached.length });
  }, [isTransient, anchor, cached]);

  const inStore = state.message ? stored.some((m) => m.id === state.message?.id) : false;
  // The turn belongs to the conversation it was asked in; a new one (null) shows only until `run` names it.
  const sameConversation = isTransient ? state.conversationId === null : state.conversationId === conversationId;
  // A stopped turn has no message of its own: it is stored once the cache grew by its question and its partial answer.
  const storedStopped =
    state.status === "stopped" && !state.message && anchor?.base != null && stored.length >= anchor.base + 2;
  const live = state.status !== "idle" && sameConversation && !inStore && !storedStopped && !state.regenerateOf;

  const lastAssistant = [...stored].reverse().find((m) => m.role === "assistant" && !m.id.startsWith("pending-"));
  const lastQuestion = [...stored].reverse().find((m) => m.role === "user")?.content ?? "";
  // The server reuses the stored question, page chip and mentions; the question is sent only because the request requires it.
  const regenerate = () => {
    if (lastQuestion && lastAssistant) {
      void ask({ ...askDefaults, conversation_id: conversationId ?? undefined, question: lastQuestion, regenerate_message_id: lastAssistant.id });
    }
  };
  // Transient answers have no message id on the server: "Hỏi lại" resends the last question from the transcript.
  const askAgain = () => {
    if (lastQuestion) {
      void ask({
        ...askDefaults,
        question: lastQuestion,
        focus: focus ? { kind: focus.kind, id: focus.id } : undefined,
        mentions: [],
      });
    }
  };
  // A follow-up is sent as the composer would send it: the open page or picked object as focus.
  const askFollowup = (question: string) =>
    void ask({
      ...askDefaults,
      ...(isTransient ? {} : { conversation_id: conversationId ?? undefined }),
      question,
      focus: focus ? { kind: focus.kind, id: focus.id } : undefined,
      mentions: [],
    });
  // The answer being regenerated keeps its place: the live cell replaces it while it streams.
  const regen = sameConversation && state.regenerateOf ? state.regenerateOf : null;
  const showFollowups =
    !(streaming || live || (regen !== null && state.status !== "done" && state.status !== "error") || !lastAssistant || lastAssistant.notice);
  const followups = showFollowups
    ? lastAssistant.followups.length > 0
      ? lastAssistant.followups
      : state.message?.id === lastAssistant.id
        ? state.followups
        : []
    : [];
  const proposeHandler =
    showFollowups && isTransient && focus?.kind === "drive_file" && onProposeDriveTasks
      ? () => onProposeDriveTasks(focus.id)
      : undefined;

  const draft = useSmoothText(streaming && state.draft.length < DRAFT_HOLD_CHARS ? "" : state.draft, streaming);
  const thinking = useSmoothText(state.thinking, streaming);
  const liveAnswer: AskUniTurnMessage = {
    id: "live",
    role: "assistant",
    content: state.message?.content ?? draft,
    citations: state.message?.citations ?? state.citations,
    notice: state.message?.notice ?? (state.status === "stopped" ? "stopped" : ""),
    model: state.message?.model ?? state.model,
    file_notes: state.message?.file_notes ?? [],
  };
  // `[S#]` numbers carry across this conversation's answers (the server seeds the book from them), so this map resolves a
  // marker an answer does not cite itself; each answer's own citations still win. Only this conversation's stream adds to it.
  const sources = useMemo(() => {
    const out = new Map<string, AiCitation>();
    const add = (c: AiCitation) => out.set(c.source_id, c);
    for (const m of stored) m.citations.forEach(add);
    if (sameConversation) {
      Object.values(state.sources).forEach(add);
      state.citations.forEach(add);
      state.message?.citations.forEach(add);
    }
    return out;
  }, [stored, sameConversation, state.sources, state.citations, state.message]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [stored.length, draft, thinking, state.status, state.steps]);
  // The box also shrinks with no new content (the memory strip opens above the composer): stay at the bottom then too.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <ul className="flex flex-col gap-4" aria-live="polite" aria-busy={streaming && sameConversation}>
        {stored.map((m) => (
          <StoredTurn
            key={m.id}
            message={m}
            replacement={regen === m.id && streaming ? liveAnswer : null}
            error={regen === m.id && state.status === "error" ? state.errorCode : undefined}
            openUrl={focus?.openUrl}
            isLast={m.id === lastAssistant?.id}
            followups={followups}
            onAskFollowup={askFollowup}
            onProposeTasks={proposeHandler}
            onRegenerate={regenerate}
            onAskAgain={askAgain}
            conversationId={conversationId}
            transient={isTransient}
            stream={state}
            thinking={thinking}
            sources={sources}
            wsId={wsId}
          />
        ))}
        {live ? (
          <>
            <AskUniMessageTurn message={{ id: "live-question", role: "user", content: state.question, citations: [], attachments: state.attachments }} />
            {state.status === "error" ? (
              <StreamError code={state.errorCode} openUrl={focus?.openUrl} />
            ) : (
              <AskUniMessageTurn message={liveAnswer} streaming={streaming} steps={state.steps} writing={liveAnswer.content !== ""} thinking={thinking} sources={sources} wsId={wsId} />
            )}
          </>
        ) : null}
      </ul>
    </div>
  );
}
