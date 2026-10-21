"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiMessages } from "@uniwork/core/ai";
import type { useAskUniStream } from "@uniwork/core/ai/stream";
import type { AiMessage } from "@uniwork/core/types";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { AskUniMessageTurn, type AskUniTurnMessage } from "./ask-uni-answer";

/** What AskUniPanel owns and hands down: the live turn's state and its controls. */
export type AskUniStream = ReturnType<typeof useAskUniStream>;

const NEAR_BOTTOM_PX = 80;
const SAFE_CODE = /^[a-z_]+$/;

/** Where the live turn started: its conversation (null = a new one) and how many turns the cache held. */
interface Anchor {
  conversationId: string | null;
  base: number;
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
export function AskUniThread({ conversationId, stream }: { conversationId: string | null; stream: AskUniStream }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const { state, ask } = stream;
  const cached = useAiMessages(conversationId).data;
  const stored: AiMessage[] = cached ?? [];
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const streaming = state.status === "streaming";
  // A new turn starts: remember its conversation and how long the cache was.
  useEffect(() => {
    if (streaming) setAnchor({ conversationId, base: stored.length });
    // Only a new question starts a turn; later cache or conversation changes must not move the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, state.question]);
  // A new conversation gets its id from the run event while the turn streams.
  useEffect(() => {
    if (streaming && anchor && anchor.conversationId === null && conversationId) setAnchor({ ...anchor, conversationId });
  }, [streaming, anchor, conversationId]);

  const inStore = state.message ? stored.some((m) => m.id === state.message?.id) : false;
  const sameConversation = !anchor || anchor.conversationId === conversationId;
  // A stopped turn has no message of its own: it is stored once the cache grew by its question and its partial answer.
  const storedStopped = state.status === "stopped" && !state.message && !!anchor && stored.length >= anchor.base + 2;
  const live = state.status !== "idle" && sameConversation && !inStore && !storedStopped;

  const lastAssistant = [...stored].reverse().find((m) => m.role === "assistant" && !m.id.startsWith("pending-"));
  const lastQuestion = [...stored].reverse().find((m) => m.role === "user")?.content ?? "";
  const regenerate = () => {
    // Model, effort and mentions are the composer's to add (Task 13); a regenerated turn asks the same question again.
    if (lastQuestion) ask({ conversation_id: conversationId ?? undefined, question: lastQuestion });
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
      <ul className="flex flex-col gap-4" aria-live="polite">
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
