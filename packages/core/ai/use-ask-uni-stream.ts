"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { askUniStream, type AskUniStreamEvent } from "../api/endpoints/ai-stream";
import { errorCode } from "../api/http";
import type { AiCitation, AiMessage, AiStep, AskUniInput } from "../types/ai";
import { aiKeys } from "./hooks";
import { useAiPanelStore } from "./store";

type AskStreamStatus = "idle" | "streaming" | "done" | "stopped" | "error";

export interface AskStreamState {
  status: AskStreamStatus;
  question: string;
  /** The conversation the turn was asked in; null until `run` names a new one. */
  conversationId: string | null;
  /** Text of the current model call; cleared on every step. */
  draft: string;
  /** One entry per tool step, in arrival order; a step with tool "" is the server's malformed-answer retry. */
  steps: AiStep[];
  /** Sources found so far, by source_id. */
  sources: Record<string, AiCitation>;
  followups: string[];
  /** The answer being regenerated, or null for a fresh question. */
  regenerateOf: string | null;
  citations: AiCitation[];
  message: AiMessage | null;
  errorCode: string | null;
}

const IDLE: AskStreamState = {
  status: "idle",
  question: "",
  conversationId: null,
  draft: "",
  steps: [],
  sources: {},
  followups: [],
  regenerateOf: null,
  citations: [],
  message: null,
  errorCode: null,
};

/** Drives one streamed Ask UNI turn at a time; a newer turn, unmount or a workspace switch aborts the older one. */
export function useAskUniStream(wsId: string) {
  const qc = useQueryClient();
  const boundWs = useAiPanelStore((s) => s.workspaceId);
  const [state, setState] = useState<AskStreamState>(IDLE);
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);
  const turnConversation = useRef<string | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A stopped or failed run may be billed, and a new conversation must show in the history list.
  const refreshAfterEnd = useCallback(() => {
    void qc.invalidateQueries({ queryKey: aiKeys.conversations(wsId) });
    void qc.invalidateQueries({ queryKey: aiKeys.capabilities(wsId) });
    void qc.invalidateQueries({ queryKey: aiKeys.usages() });
  }, [qc, wsId]);

  const abort = useCallback(() => {
    seq.current += 1; // events of the aborted turn are no longer current
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = null;
    ctrl.current?.abort();
    ctrl.current = null;
  }, []);

  useEffect(() => {
    return () => {
      abort();
      setState(IDLE);
    };
  }, [wsId, boundWs, abort]);

  // A new conversation (or one left for an empty one) forgets the old turn, so the empty state returns.
  const conversationId = useAiPanelStore((s) => s.conversationId);
  const prevConversation = useRef(conversationId);
  useEffect(() => {
    if (prevConversation.current !== null && conversationId === null) {
      abort();
      setState(IDLE);
    }
    prevConversation.current = conversationId;
  }, [conversationId, abort]);

  const ask = useCallback(
    (input: AskUniInput) => {
      abort();
      const mySeq = seq.current;
      const controller = new AbortController();
      ctrl.current = controller;
      turnConversation.current = input.conversation_id ?? null;
      const regenerateOf = input.regenerate_message_id ?? null;
      setState({ ...IDLE, status: "streaming", question: input.question, conversationId: input.conversation_id ?? null, regenerateOf });
      let finished = false;
      const current = () => seq.current === mySeq && !controller.signal.aborted;

      const onEvent = (e: AskUniStreamEvent) => {
        if (!current()) return;
        switch (e.type) {
          case "run":
            turnConversation.current = e.conversationId;
            setState((s) => ({ ...s, conversationId: e.conversationId }));
            if (useAiPanelStore.getState().conversationId === null) useAiPanelStore.getState().select(e.conversationId);
            break;
          case "step":
            setState((s) => ({ ...s, draft: "", steps: [...s.steps, { tool: e.tool, label: e.label, counts: e.counts }] }));
            break;
          case "sources":
            setState((s) => ({ ...s, sources: { ...s.sources, ...Object.fromEntries(e.sources.map((x) => [x.source_id, x])) } }));
            break;
          case "followups":
            setState((s) => ({ ...s, followups: e.followups }));
            break;
          case "title":
            // The title lands after done; the conversation lists refetch rather than take the frame's payload.
            void qc.invalidateQueries({ queryKey: aiKeys.conversations(wsId) });
            break;
          case "delta":
            setState((s) => ({ ...s, draft: s.draft + e.text }));
            break;
          case "citations":
            setState((s) => ({ ...s, citations: e.citations }));
            break;
          case "done": {
            finished = true;
            const conversationId = turnConversation.current ?? useAiPanelStore.getState().conversationId;
            if (conversationId && regenerateOf) {
              // The question is already stored; the new answer takes the old one's place.
              qc.setQueryData<AiMessage[]>(aiKeys.messages(conversationId), (old) =>
                old?.map((m) => (m.id === regenerateOf ? e.message : m)),
              );
              void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
            } else if (conversationId) {
              const userEcho: AiMessage = {
                id: `pending-${e.message.id}`,
                role: "user",
                content: input.question,
                citations: [],
                notice: "",
                steps: [],
                followups: [],
                focus: null,
                mentions: [],
                created_at: e.message.created_at,
              };
              qc.setQueryData<AiMessage[]>(aiKeys.messages(conversationId), (old) => [...(old ?? []), userEcho, e.message]);
              void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
            }
            void qc.invalidateQueries({ queryKey: aiKeys.conversations(wsId) });
            void qc.invalidateQueries({ queryKey: aiKeys.capabilities(wsId) });
            void qc.invalidateQueries({ queryKey: aiKeys.usages() });
            setState((s) => ({ ...s, status: e.message.notice === "stopped" ? "stopped" : "done", message: e.message }));
            break;
          }
          case "error":
            finished = true;
            refreshAfterEnd();
            setState((s) => ({ ...s, status: "error", errorCode: e.code }));
            break;
        }
      };

      askUniStream(wsId, input, { signal: controller.signal, onEvent }).then(
        () => {
          if (current() && !finished) refreshAfterEnd();
          if (current() && !finished) setState((s) => ({ ...s, status: "error", errorCode: "stream_ended" }));
        },
        (err: unknown) => {
          // After done the stream stays open only for the title frame; losing it loses nothing.
          if (!current() || finished) return;
          refreshAfterEnd();
          setState((s) => ({ ...s, status: "error", errorCode: errorCode(err) ?? "internal" }));
        },
      );
    },
    [abort, qc, wsId, refreshAfterEnd],
  );

  const stop = useCallback(() => {
    abort();
    setState((s) => (s.status === "streaming" ? { ...s, status: "stopped" } : s));
    const conversationId = turnConversation.current;
    // The server stores the question and the partial answer with notice "stopped".
    refreshAfterEnd();
    if (!conversationId) return;
    void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
    // shortcut: fixed 1500 ms retry, the server stores the stopped turn only after it notices the cancel; upgrade to polling or a server event if that lags.
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
    }, 1500);
  }, [abort, qc, refreshAfterEnd]);

  return { state, ask, stop };
}
