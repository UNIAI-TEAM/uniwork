"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { askUniStream, type AskUniStreamEvent } from "../api/endpoints/ai-stream";
import { errorCode } from "../api/http";
import type { AiCitation, AiMessage, AskUniInput } from "../types/ai";
import { aiKeys } from "./hooks";
import { useAiPanelStore } from "./store";

type AskStreamStatus = "idle" | "streaming" | "done" | "stopped" | "error";

export interface AskStreamState {
  status: AskStreamStatus;
  question: string;
  /** Text of the current model call; cleared on every step. */
  draft: string;
  /** Summed step counts by tool kind. */
  counts: Record<string, number>;
  citations: AiCitation[];
  message: AiMessage | null;
  errorCode: string | null;
}

const IDLE: AskStreamState = {
  status: "idle",
  question: "",
  draft: "",
  counts: {},
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

  const ask = useCallback(
    (input: AskUniInput) => {
      abort();
      const mySeq = seq.current;
      const controller = new AbortController();
      ctrl.current = controller;
      turnConversation.current = input.conversation_id ?? null;
      setState({ ...IDLE, status: "streaming", question: input.question });
      let finished = false;
      const current = () => seq.current === mySeq && !controller.signal.aborted;

      const onEvent = (e: AskUniStreamEvent) => {
        if (!current()) return;
        switch (e.type) {
          case "run":
            turnConversation.current = e.conversationId;
            if (useAiPanelStore.getState().conversationId === null) useAiPanelStore.getState().select(e.conversationId);
            break;
          case "step":
            setState((s) => {
              const counts = { ...s.counts };
              for (const [k, n] of Object.entries(e.counts)) counts[k] = (counts[k] ?? 0) + n;
              return { ...s, draft: "", counts };
            });
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
            if (conversationId) {
              const userEcho: AiMessage = {
                id: `pending-${e.message.id}`,
                role: "user",
                content: input.question,
                citations: [],
                notice: "",
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
          if (!current()) return;
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
