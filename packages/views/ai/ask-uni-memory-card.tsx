"use client";

import { useState } from "react";
import { Brain, Check, CircleCheck, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiPanelStore } from "@uniwork/core/ai";
import {
  useApplyAiMemoryProposal,
  useEditAiMemoryProposal,
  useRejectAiMemoryProposal,
  useUndoAiMemoryProposal,
} from "@uniwork/core/ai/memory";
import type { AiMemoryProposal, AiMessage } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { MEMORY_MAX_CHARS, MemoryKindToggle, runeCount, useMemoryErrorText } from "./ask-uni-memory-row";

const SETTLED = new Set(["rejected", "undone", "expired"]);

/** Text the model wrote: always a plain text node, never markdown, html or a link. */
function Row({ proposal: p, conversationId, orgSlug }: { proposal: AiMemoryProposal; conversationId: string; orgSlug: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.memory" });
  const setView = useAiPanelStore((s) => s.setView);
  const apply = useApplyAiMemoryProposal(conversationId, orgSlug);
  const reject = useRejectAiMemoryProposal(conversationId, orgSlug);
  const undo = useUndoAiMemoryProposal(conversationId, orgSlug);
  const edit = useEditAiMemoryProposal(conversationId, orgSlug);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.text);
  const [kind, setKind] = useState(p.kind);
  const [error, setError] = useState("");
  const errorText = useMemoryErrorText();
  const tooLong = editing && runeCount(text.trim()) > MEMORY_MAX_CHARS;
  const shownError = error || (tooLong ? t("errors.invalid_request") : "");
  const busy = apply.isPending || reject.isPending || undo.isPending || edit.isPending;

  const action = p.action === "update" || p.action === "forget" ? p.action : "remember";
  const run = (start: (cb: { onError: (e: unknown) => void; onSuccess?: () => void }) => void) => {
    setError("");
    start({ onError: (e) => setError(errorText(e)) });
  };
  const save = () => {
    const next = text.trim();
    if (next === "") return;
    // The server counts runes: no maxLength, which would cut an emoji line early.
    if (runeCount(next) > MEMORY_MAX_CHARS) return;
    run((cb) => edit.mutate({ id: p.id, body: { kind, text: next } }, { ...cb, onSuccess: () => setEditing(false) }));
  };

  // A forget row stores the entry it removes in before_*; its own kind and text are empty.
  const shownKind = action === "forget" ? p.before_kind : p.kind;
  const shownText = action === "forget" ? p.before_text : p.text;
  const kindLabel = shownKind === "preference" || shownKind === "fact" ? t(`kind_${shownKind}`) : "";
  const status = p.status;
  if (status === "applied") {
    // Done: one line, so the answer is not pushed down by a decided card.
    return (
      <li className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 py-2">
        <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
        <span className="text-caption text-success">{t(`proposal.done_${action}`)}</span>
        <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">{shownText}</span>
        <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => run((cb) => undo.mutate(p.id, cb))}>
          {t("proposal.undo")}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setView("memory")}>{t("proposal.open")}</Button>
        {shownError ? (
          <p role="alert" className="w-full text-caption text-destructive">
            {shownError}
          </p>
        ) : null}
      </li>
    );
  }
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <Brain aria-hidden className="size-3.5 shrink-0" />
        <p className="flex-1 font-medium">{t(`proposal.title_${action}`)}</p>
        {kindLabel && !editing ? <span className="rounded-md bg-muted px-1.5 py-0.5">{kindLabel}</span> : null}
      </div>
      {editing ? (
        <div className="mt-1.5 flex flex-col gap-2">
          {/* Its own line and wrapping, so a 300-character entry reads whole in the narrow dock; an entry is one line. */}
          <Textarea
            aria-label={t("proposal.edit_text")}
            aria-invalid={tooLong}
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[\r\n]+/g, " "))}
            className="min-h-0"
          />
          <div className="flex flex-wrap items-center gap-2">
            <MemoryKindToggle value={kind} onChange={setKind} />
            <div className="ms-auto flex gap-1.5">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>{t("proposal.edit_cancel")}</Button>
              <Button type="button" size="sm" disabled={busy} onClick={save}>{t("proposal.edit_save")}</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className={SETTLED.has(status) ? "mt-1.5 opacity-60" : "mt-1.5"}>
          {action === "update" && p.before_text !== "" ? (
            <p className="text-body break-words whitespace-pre-wrap text-muted-foreground line-through">
              <span className="sr-only">{t("proposal.was")}: </span>
              {p.before_text}
            </p>
          ) : null}
          <p
            className={`text-body break-words whitespace-pre-wrap ${action === "forget" ? "text-muted-foreground line-through" : "text-foreground"}`}
          >
            {shownText}
          </p>
        </div>
      )}
      {shownError ? (
        <p role="alert" className="mt-1.5 text-caption text-destructive">
          {shownError}
        </p>
      ) : null}
      {editing ? null : status === "pending" ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={action === "forget" ? "destructive" : "default"}
            disabled={busy}
            onClick={() => run((cb) => apply.mutate(p.id, cb))}
          >
            {action === "forget" ? <Trash2 aria-hidden /> : <Check aria-hidden />}
            {t(`proposal.${action === "update" ? "save" : action}`)}
          </Button>
          {action === "forget" ? null : (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setText(p.text); setKind(p.kind); setEditing(true); }}>
              {t("proposal.edit")}
            </Button>
          )}
          {/* Rejecting a forget keeps the entry, so it says so. */}
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => run((cb) => reject.mutate(p.id, cb))}>
            {t(action === "forget" ? "proposal.keep" : "proposal.reject")}
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-caption text-muted-foreground">{t(`proposal.${SETTLED.has(status) ? status : "unknown"}`)}</p>
      )}
    </li>
  );
}

/** The "Nhớ điều này?" card under an answer: what UNI wants to remember, update or forget, and the person decides. */
export function AskUniMemoryCard({
  message,
  conversationId,
  orgSlug,
  tainted,
}: {
  message: Pick<AiMessage, "id" | "memory_proposals">;
  conversationId: string;
  orgSlug: string;
  tainted: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.memory.proposal" });
  const rows = [...message.memory_proposals].sort((a, b) => a.position - b.position);
  if (rows.length === 0) return null;
  return (
    // Rows may remember, update or forget, so the region has a neutral name.
    <section aria-label={t("region")} className="mt-3 flex flex-col gap-2" data-slot="ask-uni-memory-card">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <ul className="divide-y divide-border">
          {rows.map((p) => (
            <Row key={p.id || `${p.position}`} proposal={p} conversationId={conversationId} orgSlug={orgSlug} />
          ))}
        </ul>
        {tainted ? (
          <p className="flex items-start gap-1.5 border-t border-border px-3 py-2 text-caption text-muted-foreground">
            <ShieldAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
            {t("tainted")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
