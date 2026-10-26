"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { askUniStream, type AskUniStreamEvent } from "../api/endpoints/ai-stream";
import { errorCode } from "../api/http";
import type { AiAttachment, AiCitation, AiMemoryProposal, AiMessage, AiProposal, AiStep, AskUniInput } from "../types/ai";
import { aiKeys } from "./hooks";
import { buildTransientTranscript, useAiPanelStore } from "./store";
type AskStreamStatus = "idle" | "streaming" | "done" | "stopped" | "error";

export interface AskStreamState {
  status: AskStreamStatus;
  question: string;
  /** The conversation the turn was asked in; null until `run` names a new one. */
  conversationId: string | null;
  /** Text of the current model call; cleared on every step. */
  draft: string;
  /** Thinking summary of the current model call (ask_uni_thinking); a step takes it, and it is cleared then. */
  thinking: string;
  /** One entry per tool step, in arrival order; a step with tool "" is the server's malformed-answer retry. */
  steps: AiStep[];
  /** Sources found so far, by source_id. */
  sources: Record<string, AiCitation>;
  followups: string[];
  /** The rows UNI proposes in this turn, as the last `proposal` event told them (an auto-applied row arrives applied). */
  proposals: AiProposal[];
  /** The memory cards UNI proposes in this turn ("Nhớ điều này?"); never auto-applied. */
  memoryProposals: AiMemoryProposal[];
  /** Ids of the memory entries the answer used, as the `memory_used` event told them. */
  memoryIds: string[];
  /** The answer being regenerated, or null for a fresh question. */
  regenerateOf: string | null;
  /** The model key the turn asked for; "" for Auto. The stored answer's own `model` replaces it on done. */
  model: string;
  /** The files the turn's question carries, for its bubble; the done frame carries the answer only. Empty for a question without files. */
  attachments: AiAttachment[];
  citations: AiCitation[];
  message: AiMessage | null;
  errorCode: string | null;
}

/**
 * Whether the server took a turn's question: `accepted` once it says it runs
 * the turn (`run`, or `done`), never once it refused or the turn ended before
 * that. A refused question is not stored, so whoever sent it keeps it; `code`
 * and `message` are the refusal's (null when the turn was aborted).
 */
export type AskOutcome = { accepted: true } | { accepted: false; code: string | null; message: string };

const IDLE: AskStreamState = {
  status: "idle",
  question: "",
  conversationId: null,
  draft: "",
  thinking: "",
  steps: [],
  sources: {},
  followups: [],
  proposals: [],
  memoryProposals: [],
  memoryIds: [],
  regenerateOf: null,
  model: "",
  attachments: [],
  citations: [],
  message: null,
  errorCode: null,
};

/** Drives one streamed Ask UNI turn at a time; a newer turn, unmount or a workspace switch aborts the older one. */
export function useAskUniStream(wsId: string) {
  const qc = useQueryClient();
  const boundWs = useAiPanelStore((s) => s.workspaceId);
  const [state, setState] = useState<AskStreamState>(IDLE);
  const stateRef = useRef<AskStreamState>(IDLE);
  stateRef.current = state;
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);
  const turnConversation = useRef<string | null>(null);
  const turnTransient = useRef(false);
  const turnAttachments = useRef<AiAttachment[]>([]);
  const transientIdSeq = useRef(0);
  const refetchTimer = useRef<number | null>(null);

  // A stopped or failed run may be billed, and a new conversation must show in the history list (unless transient).
  const refreshAfterEnd = useCallback(
    (transient = false) => {
      if (!transient) void qc.invalidateQueries({ queryKey: aiKeys.conversations(wsId) });
      void qc.invalidateQueries({ queryKey: aiKeys.capabilities(wsId) });
      void qc.invalidateQueries({ queryKey: aiKeys.usages() });
    },
    [qc, wsId],
  );
  const abort = useCallback(() => {
    seq.current += 1; // events of the aborted turn are no longer current
    if (refetchTimer.current !== null) window.clearTimeout(refetchTimer.current);
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

  // Clearing the transient transcript (closing panel, changing focus, picking history, "Hội thoại mới") aborts any transient turn and resets stream state.
  const transientEpoch = useAiPanelStore((s) => s.transientEpoch);
  const prevTransientEpoch = useRef(transientEpoch);
  useEffect(() => {
    if (prevTransientEpoch.current !== transientEpoch) {
      abort();
      setState(IDLE);
      prevTransientEpoch.current = transientEpoch;
    }
  }, [transientEpoch, abort]);

  const ask = useCallback(
    (input: AskUniInput, display?: { attachments: AiAttachment[] }): Promise<AskOutcome> => {
      abort();
      const mySeq = seq.current;
      const controller = new AbortController();
      ctrl.current = controller;
      const isTransient = Boolean(input.transient || input.focus?.kind === "drive_file");
      turnTransient.current = isTransient;
      const storeState = useAiPanelStore.getState();
      const { transcript, trimmed } = isTransient
        ? buildTransientTranscript(storeState.transientMessages)
        : { transcript: undefined, trimmed: false };
      if (isTransient && trimmed) {
        storeState.setTransientWindowTrimmed(true);
      }
      const wireInput: AskUniInput = isTransient
        ? {
            question: input.question,
            ...(input.focus ? { focus: { kind: input.focus.kind, id: input.focus.id } } : {}),
            ...(input.mentions ? { mentions: input.mentions } : {}),
            ...(input.locale ? { locale: input.locale } : {}),
            ...(input.model ? { model: input.model } : {}),
            ...(input.effort ? { effort: input.effort } : {}),
            ...(input.attachment_ids ? { attachment_ids: input.attachment_ids } : {}),
            ...(input.mode ? { mode: input.mode } : {}),
            transient: true,
            transcript: input.transcript ?? transcript ?? [],
          }
        : input;
      turnConversation.current = isTransient ? null : (wireInput.conversation_id ?? null);
      const regenerateOf = isTransient ? null : (wireInput.regenerate_message_id ?? null);
      const attachments = display?.attachments ?? [];
      turnAttachments.current = attachments;
      setState({
        ...IDLE,
        status: "streaming",
        question: wireInput.question,
        conversationId: isTransient ? null : (wireInput.conversation_id ?? null),
        regenerateOf,
        model: wireInput.model ?? "",
        attachments,
      });
      let finished = false;
      let proposals: AiProposal[] = [];
      let memoryProposals: AiMemoryProposal[] = [];
      let memoryIds: string[] = [];
      const current = () => seq.current === mySeq && !controller.signal.aborted;
      let settle: (o: AskOutcome) => void = () => undefined;
      const outcome = new Promise<AskOutcome>((resolve) => {
        let settled = false;
        settle = (o) => {
          if (!settled) resolve(o);
          settled = true;
        };
      });
      // An aborted turn (a newer one, stop, unmount) took nothing the caller can rely on.
      controller.signal.addEventListener("abort", () => settle({ accepted: false, code: null, message: "" }));

      const onEvent = (e: AskUniStreamEvent) => {
        if (!current()) return;
        switch (e.type) {
          case "run":
            settle({ accepted: true });
            if (!isTransient) {
              turnConversation.current = e.conversationId;
              setState((s) => ({ ...s, conversationId: e.conversationId }));
              if (useAiPanelStore.getState().conversationId === null && e.conversationId !== "") {
                useAiPanelStore.getState().select(e.conversationId);
              }
            }
            break;
          case "step":
            // The call's thinking leads to this step; its text was the note the step now carries.
            setState((s) => ({
              ...s,
              draft: "",
              thinking: "",
              steps: [...s.steps, { tool: e.tool, label: e.label, counts: e.counts, note: e.note, thought: s.thinking, kind: "" }],
            }));
            break;
          case "reasoning":
            setState((s) => ({ ...s, thinking: s.thinking + e.text }));
            break;
          case "sources":
            setState((s) => ({ ...s, sources: { ...s.sources, ...Object.fromEntries(e.sources.map((x) => [x.source_id, x])) } }));
            break;
          case "proposal":
            proposals = e.proposals;
            setState((s) => ({ ...s, proposals: e.proposals }));
            break;
          case "memory_proposals":
            memoryProposals = e.proposals;
            setState((s) => ({ ...s, memoryProposals: e.proposals }));
            break;
          case "memory_used":
            memoryIds = e.memoryIds;
            setState((s) => ({ ...s, memoryIds: e.memoryIds }));
            break;
          case "followups":
            setState((s) => ({ ...s, followups: e.followups }));
            break;
          case "title":
            // The title lands after done; the conversation lists refetch rather than take the frame's payload.
            if (!isTransient) void qc.invalidateQueries({ queryKey: aiKeys.conversations(wsId) });
            break;
          case "delta":
            setState((s) => ({ ...s, draft: s.draft + e.text }));
            break;
          case "citations":
            setState((s) => ({ ...s, citations: e.citations }));
            break;
          case "done": {
            finished = true;
            settle({ accepted: true });
            // The done frame carries the answer without its rows; the stored answer keeps the ones the turn announced.
            // A stopped turn stored none of them, so they are not kept.
            // The memory cards and the used ids ride the same way; a stopped turn stored neither.
            const stopped = e.message.notice === "stopped";
            const message: AiMessage = {
              ...e.message,
              ...(proposals.length > 0 && !stopped ? { proposals } : {}),
              ...(memoryProposals.length > 0 && !stopped ? { memory_proposals: memoryProposals } : {}),
              ...(memoryIds.length > 0 && !stopped ? { memory_ids: memoryIds } : {}),
            };
            if (isTransient) {
              transientIdSeq.current += 1;
              const answerId = message.id || `transient-a-${transientIdSeq.current}`;
              const userEcho: AiMessage = {
                id: `transient-u-${transientIdSeq.current}-${answerId}`,
                role: "user",
                content: wireInput.question,
                citations: [],
                notice: "",
                steps: [],
                followups: [],
                focus: null,
                mentions: [],
                model: "",
                attachments,
                file_notes: [],
                proposals: [],
                memory_ids: [],
                memory_proposals: [],
                created_at: e.message.created_at,
              };
              const storedAnswer: AiMessage = {
                ...message,
                id: answerId,
                steps: message.steps.length > 0 ? message.steps : stateRef.current.steps,
                followups: message.followups.length > 0 ? message.followups : stateRef.current.followups,
                citations: message.citations.length > 0 ? message.citations : stateRef.current.citations,
              };
              useAiPanelStore.getState().appendTransientTurn(userEcho, storedAnswer);
              void qc.invalidateQueries({ queryKey: aiKeys.capabilities(wsId) });
              void qc.invalidateQueries({ queryKey: aiKeys.usages() });
              setState((s) => ({
                ...s,
                status: e.message.notice === "stopped" ? "stopped" : "done",
                message: storedAnswer,
                proposals: stopped ? [] : s.proposals,
                memoryProposals: stopped ? [] : s.memoryProposals,
                memoryIds: stopped ? [] : s.memoryIds,
                steps: storedAnswer.steps,
                thinking: "",
              }));
              break;
            }
            const conversationId = turnConversation.current ?? useAiPanelStore.getState().conversationId;
            if (conversationId && regenerateOf) {
              // The question is already stored; the new answer takes the old one's place.
              qc.setQueryData<AiMessage[]>(aiKeys.messages(conversationId), (old) =>
                old?.map((m) => (m.id === regenerateOf ? message : m)),
              );
              void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
            } else if (conversationId) {
              const userEcho: AiMessage = {
                id: `pending-${e.message.id}`,
                role: "user",
                content: wireInput.question,
                citations: [],
                notice: "",
                steps: [],
                followups: [],
                focus: null,
                mentions: [],
                model: "",
                // The done frame carries the answer only, so the caller's list is the only source of the question's files;
                // their ids are upload file_ids until the refetch below swaps in the stored question and its attachment row ids.
                attachments,
                file_notes: [],
                proposals: [],
                memory_ids: [],
                memory_proposals: [],
                created_at: e.message.created_at,
              };
              qc.setQueryData<AiMessage[]>(aiKeys.messages(conversationId), (old) => [...(old ?? []), userEcho, message]);
              void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
            }
            void qc.invalidateQueries({ queryKey: aiKeys.conversations(wsId) });
            void qc.invalidateQueries({ queryKey: aiKeys.capabilities(wsId) });
            void qc.invalidateQueries({ queryKey: aiKeys.usages() });
            setState((s) => ({
              ...s,
              status: e.message.notice === "stopped" ? "stopped" : "done",
              message,
              proposals: stopped ? [] : s.proposals,
              memoryProposals: stopped ? [] : s.memoryProposals,
              memoryIds: stopped ? [] : s.memoryIds,
              // The stored steps add the think step that holds the answer call's thinking.
              steps: message.steps.length > 0 ? message.steps : s.steps,
              thinking: "",
            }));
            break;
          }
          case "error":
            finished = true;
            settle({ accepted: false, code: e.code, message: "" });
            refreshAfterEnd(isTransient);
            setState((s) => ({ ...s, status: "error", errorCode: e.code }));
            break;
        }
      };

      askUniStream(wsId, wireInput, { signal: controller.signal, onEvent }).then(
        () => {
          if (current() && !finished) refreshAfterEnd(isTransient);
          if (current() && !finished) setState((s) => ({ ...s, status: "error", errorCode: "stream_ended" }));
          settle({ accepted: false, code: "stream_ended", message: "" });
        },
        (err: unknown) => {
          // After done the stream stays open only for the title frame; losing it loses nothing.
          if (!current() || finished) return;
          refreshAfterEnd(isTransient);
          const code = errorCode(err) ?? "internal";
          setState((s) => ({ ...s, status: "error", errorCode: code }));
          settle({ accepted: false, code, message: err instanceof Error ? err.message : "" });
        },
      );
      return outcome;
    },
    [abort, qc, wsId, refreshAfterEnd],
  );

  const stop = useCallback(() => {
    abort();
    const isTransient = turnTransient.current;
    if (isTransient) {
      const snap = stateRef.current;
      if (snap.status === "streaming") {
        transientIdSeq.current += 1;
        const seqId = transientIdSeq.current;
        const nowIso = new Date().toISOString();
        const userEcho: AiMessage = {
          id: `transient-u-stopped-${seqId}`,
          role: "user",
          content: snap.question,
          citations: [],
          notice: "",
          steps: [],
          followups: [],
          focus: null,
          mentions: [],
          model: "",
          attachments: turnAttachments.current,
          file_notes: [],
          proposals: [],
          memory_ids: [],
          memory_proposals: [],
          created_at: nowIso,
        };
        const stoppedAnswer: AiMessage = {
          id: `transient-a-stopped-${seqId}`,
          role: "assistant",
          content: snap.draft,
          citations: snap.citations,
          notice: "stopped",
          steps: snap.steps,
          followups: [],
          focus: null,
          mentions: [],
          model: snap.model,
          attachments: [],
          file_notes: [],
          proposals: [],
          memory_ids: [],
          memory_proposals: [],
          created_at: nowIso,
        };
        useAiPanelStore.getState().appendTransientTurn(userEcho, stoppedAnswer);
        setState((s) => ({ ...s, status: "stopped", message: stoppedAnswer, proposals: [], memoryProposals: [], memoryIds: [], thinking: "" }));
      }
      // Transient turns are never stored on the server: refresh quota/usages only, no message invalidation or 1,500 ms revisit.
      refreshAfterEnd(true);
      return;
    }
    setState((s) => (s.status === "streaming" ? { ...s, status: "stopped" } : s));
    const conversationId = turnConversation.current;
    // The server stores the question and the partial answer with notice "stopped".
    refreshAfterEnd(false);
    if (!conversationId) return;
    void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
    // shortcut: fixed 1500 ms retry, the server stores the stopped turn only after it notices the cancel; upgrade to polling or a server event if that lags.
    refetchTimer.current = window.setTimeout(() => {
      refetchTimer.current = null;
      void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
    }, 1500);
  }, [abort, qc, refreshAfterEnd]);
  return { state, ask, stop };
}
