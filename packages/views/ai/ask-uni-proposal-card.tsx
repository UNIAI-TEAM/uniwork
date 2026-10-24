"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useApplyAiMessageProposals,
  useApplyAiProposal,
  useEditAiProposal,
  useRejectAiProposal,
  useUndoAiProposal,
} from "@uniwork/core/ai/proposals";
import { errorCode } from "@uniwork/core/api/http";
import type { AiMessage } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { AskUniProposalRow } from "./ask-uni-proposal-row";

/**
 * The rows UNI proposes for one answer. Ask mode: each row applies on its own, two or more waiting add "apply all".
 * Plan mode: rows start ticked and one button approves the ticked ones in order. Every call awaits the server;
 * the hooks repaint the rows from its answer.
 */
export function AskUniProposalCard({ message, conversationId, mode }: { message: Pick<AiMessage, "id" | "proposals">; conversationId: string; mode: string }) {
  const { t } = useTranslation();
  const apply = useApplyAiProposal(conversationId);
  const reject = useRejectAiProposal(conversationId);
  const undo = useUndoAiProposal(conversationId);
  const edit = useEditAiProposal(conversationId);
  const applyMany = useApplyAiMessageProposals(conversationId);
  // Plan rows are ticked until unticked here; errors are the last refused call per row.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const rows = [...message.proposals].sort((a, b) => a.position - b.position);
  const pending = rows.filter((r) => r.status === "pending");
  const plan = mode === "plan";
  const ticked = pending.filter((r) => !unticked.has(r.id));

  const [busyId, setBusyId] = useState("");
  const [cardError, setCardError] = useState("");
  // One call at a time: a second would replace the first one's callbacks, so every button waits.
  const inFlight = busyId !== "" || applyMany.isPending;

  // A refusal that carries rows repaints them (the hooks do that); the code still shows on the row it came from.
  const go = (id: string, start: (cb: { onError: (e: unknown) => void; onSettled: () => void }) => void) => {
    setErrors((e) => ({ ...e, [id]: "" }));
    setBusyId(id);
    start({ onError: (err) => setErrors((e) => ({ ...e, [id]: errorCode(err) ?? "default" })), onSettled: () => setBusyId("") });
  };
  const approve = (ids: string[]) => {
    setCardError("");
    applyMany.mutate({ messageId: message.id, ids }, { onError: (err) => setCardError(errorCode(err) ?? "default") });
  };

  const header = plan ? "header_plan" : pending.length > 0 ? "header_ask" : "header_done";
  return (
    <section aria-label={t(`ai.proposal.${header}`)} className="mt-3 flex flex-col gap-2">
      <h3 className="text-caption font-medium text-muted-foreground">{t(`ai.proposal.${header}`)}</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((p) => (
          <AskUniProposalRow
            key={p.id || `${p.position}`}
            proposal={p}
            selectable={plan}
            selected={!unticked.has(p.id)}
            onToggle={() => setUnticked((s) => { const n = new Set(s); if (!n.delete(p.id)) n.add(p.id); return n; })}
            onApply={() => go(p.id, (cb) => apply.mutate(p.id, cb))}
            onReject={() => go(p.id, (cb) => reject.mutate(p.id, cb))}
            onUndo={() => go(p.id, (cb) => undo.mutate(p.id, cb))}
            onEdit={(changes, cb) => {
              // The form shows its own refusal, so the row's error line stays quiet.
              setBusyId(p.id);
              edit.mutate({ id: p.id, changes }, { ...cb, onSettled: () => setBusyId("") });
            }}
            busy={inFlight}
            error={errors[p.id] || undefined}
          />
        ))}
      </ul>
      {cardError ? (
        <p role="alert" className="text-caption text-destructive">
          {t(`ai.proposal.error.${/^[a-z_]+$/.test(cardError) ? cardError : "default"}`, { defaultValue: t("ai.proposal.error.default") })}
        </p>
      ) : null}
      {plan && pending.length > 0 ? (
        <Button type="button" size="sm" className="self-start" disabled={ticked.length === 0 || inFlight} onClick={() => approve(ticked.map((r) => r.id))}>
          {t("ai.proposal.approve_plan", { count: ticked.length })}
        </Button>
      ) : null}
      {!plan && pending.length >= 2 ? (
        <Button type="button" size="sm" variant="outline" className="self-start" disabled={inFlight} onClick={() => approve(pending.map((r) => r.id))}>
          {t("ai.proposal.apply_all")}
        </Button>
      ) : null}
    </section>
  );
}
