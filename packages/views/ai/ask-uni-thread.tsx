"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiMessages } from "@uniwork/core/ai";
import type { AskStreamState, useAskUniStream } from "@uniwork/core/ai/stream";
import type { AiCitation, AiMessage, AskUniInput } from "@uniwork/core/types";
import { AskUniFollowups } from "./ask-uni-followups";
import { AskUniMessageTurn, type AskUniTurnMessage } from "./ask-uni-answer";
import { useEffectiveFocus } from "./ask-uni-page-context";
import { useSmoothText } from "./use-smooth-text";

/** What AskUniPanel owns and hands down: the live turn's state and its controls. */
export type AskUniStream = ReturnType<typeof useAskUniStream>;

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

function StreamError({ code }: { code: string | null }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.errors" });
  // The code comes off the wire; only a plain snake_case word may become a key.
  const text = code && SAFE_CODE.test(code) ? t(code, { defaultValue: t("default") }) : t("default");
  return (
    <li role="alert" className="flex items-start gap-2 text-caption text-destructive">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      {text}
    </li>
  );
}

/** One stored turn: while it is being regenerated the live cell takes its place; a failed regenerate shows it again with the error. */
function StoredTurn({
  message,
  replacement,
  error,
  isLast,
  followups,
  onAskFollowup,
  onRegenerate,
  conversationId,
  stream,
  thinking,
  sources,
  wsId,
}: {
  message: AiMessage;
  replacement: AskUniTurnMessage | null;
  /** Error code of a failed regenerate of this answer; undefined when there is none. */
  error: string | null | undefined;
  isLast: boolean;
  followups: string[];
  onAskFollowup: (q: string) => void;
  onRegenerate: () => void;
  conversationId: string | null;
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
        steps={stream.message?.id === message.id && stream.steps.length > 0 ? stream.steps : undefined}
        sources={sources}
        wsId={wsId}
        // An answer with proposals is not regenerated: its rows may already have changed something.
        onRegenerate={isLast && message.proposals.length === 0 ? onRegenerate : undefined}
        regenerateDisabled={stream.status === "streaming"}
      />
      {error !== undefined ? <StreamError code={error} /> : null}
      {isLast ? <AskUniFollowups items={followups} onAsk={onAskFollowup} /> : null}
    </>
  );
}

/** The docked panel's conversation: stored turns, then the live question and answer until the cache holds them. */
export function AskUniThread({
  conversationId,
  stream,
  askDefaults,
  wsId,
}: {
  conversationId: string | null;
  stream: AskUniStream;
  wsId?: string;
  /** The composer's model, effort and language, so a regenerated turn runs the way a typed one would. */
  askDefaults?: Pick<AskUniInput, "model" | "effort" | "locale">;
}) {
  const { state, ask } = stream;
  const focus = useEffectiveFocus();
  const cached = useAiMessages(conversationId).data;
  const stored: AiMessage[] = cached ?? [];
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const streaming = state.status === "streaming";
  // A new turn starts. A new conversation has nothing stored yet; otherwise the base waits for the history, never an empty loading list.
  useEffect(() => {
    if (streaming) setAnchor({ base: conversationId === null ? 0 : cached ? cached.length : null });
    // Only a new question starts a turn; later cache or conversation changes must not move the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, state.question]);
  useEffect(() => {
    if (anchor && anchor.base === null && cached) setAnchor({ base: cached.length });
  }, [anchor, cached]);

  const inStore = state.message ? stored.some((m) => m.id === state.message?.id) : false;
  // The turn belongs to the conversation it was asked in; a new one (null) shows only until `run` names it.
  const sameConversation = state.conversationId === conversationId;
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
  // A follow-up is sent as the composer would send it: the open page or picked object as focus.
  const askFollowup = (question: string) =>
    void ask({ ...askDefaults, conversation_id: conversationId ?? undefined, question, focus: focus ? { kind: focus.kind, id: focus.id } : undefined, mentions: [] });
  // The answer being regenerated keeps its place: the live cell replaces it while it streams.
  const regen = sameConversation && state.regenerateOf ? state.regenerateOf : null;
  const followups =
    // A regenerate that failed leaves the old answer standing, with its own follow-ups.
    streaming || live || (regen !== null && state.status !== "done" && state.status !== "error") || !lastAssistant || lastAssistant.notice
      ? []
      : lastAssistant.followups.length > 0
        ? lastAssistant.followups
        : state.message?.id === lastAssistant.id
          ? state.followups
          : [];

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
    for (const m of cached ?? []) m.citations.forEach(add);
    if (sameConversation) {
      Object.values(state.sources).forEach(add);
      state.citations.forEach(add);
      state.message?.citations.forEach(add);
    }
    return out;
  }, [cached, sameConversation, state.sources, state.citations, state.message]);

  // Follow the answer as it grows, but only while the reader is at the bottom.
  const onScroll = () => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [stored.length, draft, thinking, state.status, state.steps]);

  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <ul className="flex flex-col gap-4" aria-live="polite" aria-busy={streaming && sameConversation}>
        {stored.map((m) => (
          <StoredTurn
            key={m.id}
            message={m}
            replacement={regen === m.id && streaming ? liveAnswer : null}
            error={regen === m.id && state.status === "error" ? state.errorCode : undefined}
            isLast={m.id === lastAssistant?.id}
            followups={followups}
            onAskFollowup={askFollowup}
            onRegenerate={regenerate}
            conversationId={conversationId}
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
              <StreamError code={state.errorCode} />
            ) : (
              <AskUniMessageTurn message={liveAnswer} streaming={streaming} steps={state.steps} writing={liveAnswer.content !== ""} thinking={thinking} sources={sources} wsId={wsId} />
            )}
          </>
        ) : null}
      </ul>
    </div>
  );
}
