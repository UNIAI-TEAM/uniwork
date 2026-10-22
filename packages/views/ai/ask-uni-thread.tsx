"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiMessages } from "@uniwork/core/ai";
import type { useAskUniStream } from "@uniwork/core/ai/stream";
import type { AiCitation, AiMessage, AskUniInput } from "@uniwork/core/types";
import { AskUniFollowups } from "./ask-uni-followups";
import { AskUniMessageTurn, type AskUniTurnMessage } from "./ask-uni-answer";

/** What AskUniPanel owns and hands down: the live turn's state and its controls. */
export type AskUniStream = ReturnType<typeof useAskUniStream>;

const NEAR_BOTTOM_PX = 80;
const SAFE_CODE = /^[a-z_]+$/;

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
      ask({ ...askDefaults, conversation_id: conversationId ?? undefined, question: lastQuestion, regenerate_message_id: lastAssistant.id });
    }
  };
  const askFollowup = (question: string) => ask({ ...askDefaults, conversation_id: conversationId ?? undefined, question });
  // The answer being regenerated keeps its place: the live cell replaces it while it streams.
  const regen = sameConversation && state.regenerateOf ? state.regenerateOf : null;
  const followups =
    streaming || live || !lastAssistant || lastAssistant.notice
      ? []
      : lastAssistant.followups.length > 0
        ? lastAssistant.followups
        : state.message?.id === lastAssistant.id
          ? state.followups
          : [];

  const liveAnswer: AskUniTurnMessage = {
    id: "live",
    role: "assistant",
    content: state.message?.content ?? state.draft,
    citations: state.message?.citations ?? state.citations,
    notice: state.message?.notice ?? (state.status === "stopped" ? "stopped" : ""),
  };
  // `[S#]` numbers are conversation-wide (the server seeds the book from earlier answers), so one map serves every answer.
  const sources = useMemo(() => {
    const out = new Map<string, AiCitation>();
    const add = (c: AiCitation) => out.set(c.source_id, c);
    for (const m of cached ?? []) m.citations.forEach(add);
    Object.values(state.sources).forEach(add);
    state.citations.forEach(add);
    state.message?.citations.forEach(add);
    return out;
  }, [cached, state.sources, state.citations, state.message]);

  // Follow the answer as it grows, but only while the reader is at the bottom.
  const onScroll = () => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [stored.length, state.draft, state.status, state.steps]);

  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <ul className="flex flex-col gap-4" aria-live="polite" aria-busy={streaming}>
        {stored.map((m) =>
          regen === m.id && streaming ? (
            <AskUniMessageTurn key={m.id} message={{ ...liveAnswer, id: "live", created_at: "" }} streaming steps={state.steps} writing={liveAnswer.content !== ""} sources={sources} wsId={wsId} />
          ) : (
          <Fragment key={m.id}>
          <AskUniMessageTurn
            message={m}
            conversationId={conversationId}
            steps={state.message?.id === m.id && state.steps.length > 0 ? state.steps : undefined}
            sources={sources}
            wsId={wsId}
            onRegenerate={m.id === lastAssistant?.id ? regenerate : undefined}
            regenerateDisabled={streaming}
          />
          {regen === m.id && state.status === "error" ? <StreamError code={state.errorCode} /> : null}
          {m.id === lastAssistant?.id ? <AskUniFollowups items={followups} onAsk={askFollowup} /> : null}
          </Fragment>
          ),
        )}
        {live ? (
          <>
            <AskUniMessageTurn message={{ id: "live-question", role: "user", content: state.question, citations: [] }} />
            {state.status === "error" ? (
              <StreamError code={state.errorCode} />
            ) : (
              <AskUniMessageTurn message={liveAnswer} streaming={streaming} steps={state.steps} writing={liveAnswer.content !== ""} sources={sources} wsId={wsId} />
            )}
          </>
        ) : null}
      </ul>
    </div>
  );
}
