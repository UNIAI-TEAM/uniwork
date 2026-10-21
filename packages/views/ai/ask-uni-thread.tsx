"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiMessages } from "@uniwork/core/ai";
import type { useAskUniStream } from "@uniwork/core/ai/stream";
import type { AiMessage, AskUniInput } from "@uniwork/core/types";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
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
}: {
  conversationId: string | null;
  stream: AskUniStream;
  /** The composer's model, effort and language, so a regenerated turn runs the way a typed one would. */
  askDefaults?: Pick<AskUniInput, "model" | "effort" | "locale">;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
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
  const live = state.status !== "idle" && sameConversation && !inStore && !storedStopped;

  const lastAssistant = [...stored].reverse().find((m) => m.role === "assistant" && !m.id.startsWith("pending-"));
  const lastQuestion = [...stored].reverse().find((m) => m.role === "user")?.content ?? "";
  const regenerate = () => {
    // A stored turn keeps no focus or mentions, so a regenerated one asks the same question in the same conversation only.
    if (lastQuestion) ask({ ...askDefaults, conversation_id: conversationId ?? undefined, question: lastQuestion });
  };

  const liveAnswer: AskUniTurnMessage = {
    id: "live",
    role: "assistant",
    content: state.message?.content ?? state.draft,
    citations: state.message?.citations ?? state.citations,
    notice: state.message?.notice ?? (state.status === "stopped" ? "stopped" : ""),
  };
  const waiting = streaming && state.draft === "" && Object.keys(state.counts).length === 0;

  // Follow the answer as it grows, but only while the reader is at the bottom.
  const onScroll = () => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [stored.length, state.draft, state.status, state.counts]);

  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <ul className="flex flex-col gap-4" aria-live="polite" aria-busy={streaming}>
        {stored.map((m) => (
          <AskUniMessageTurn
            key={m.id}
            message={m}
            conversationId={conversationId}
            counts={state.message?.id === m.id ? state.counts : undefined}
            onRegenerate={m.id === lastAssistant?.id ? regenerate : undefined}
            regenerateDisabled={streaming}
          />
        ))}
        {live ? (
          <>
            <AskUniMessageTurn message={{ id: "live-question", role: "user", content: state.question, citations: [] }} />
            {state.status === "error" ? (
              <StreamError code={state.errorCode} />
            ) : waiting ? (
              <li className="flex items-center gap-2 text-caption text-muted-foreground">
                <Spinner className="size-4" />
                {t("asking")}
              </li>
            ) : (
              <AskUniMessageTurn message={liveAnswer} streaming={streaming} counts={state.counts} />
            )}
          </>
        ) : null}
      </ul>
    </div>
  );
}
