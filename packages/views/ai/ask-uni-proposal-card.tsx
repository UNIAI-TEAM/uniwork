"use client";

import { useState } from "react";
import { CheckCheck, ListChecks, Sparkles } from "lucide-react";
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
 * the hooks repaint the rows from its answer. `readOnly` (actions switched off) keeps the rows as history with no
 * button or checkbox.
 */
export function AskUniProposalCard({ message, conversationId, readOnly = false }: { message: Pick<AiMessage, "id" | "proposals">; conversationId: string; readOnly?: boolean }) {
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
  // Position 0 is the "Tạo tài liệu" row: the server decides the mode and the batch from the model's rows alone.
  const steps = pending.filter((r) => r.position >= 1);
  const plan = !readOnly && rows.find((r) => r.position >= 1)?.mode === "plan";
  const ticked = steps.filter((r) => !unticked.has(r.id));

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

  const header = plan && steps.length > 0 ? "header_plan" : pending.length > 0 && !readOnly ? "header_ask" : "header_done";
  return (
    <section aria-label={t(`ai.proposal.${header}`)} className="mt-3 flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
        <Sparkles aria-hidden className="size-3.5 shrink-0 text-primary" />
        {t(`ai.proposal.${header}`)}
      </h3>
      <ul className="flex flex-col gap-2">
        {rows.map((p) => (
          <AskUniProposalRow
            key={p.id || `${p.position}`}
            proposal={p}
            selectable={plan && p.position >= 1}
            readOnly={readOnly}
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
      {plan && steps.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" disabled={ticked.length === 0 || inFlight} onClick={() => approve(ticked.map((r) => r.id))}>
            <ListChecks aria-hidden />
            {t("ai.proposal.approve_plan", { count: ticked.length })}
          </Button>
        </div>
      ) : null}
      {!plan && !readOnly && steps.length >= 2 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" disabled={inFlight} onClick={() => approve(steps.map((r) => r.id))}>
            <CheckCheck aria-hidden />
            {t("ai.proposal.apply_all")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
