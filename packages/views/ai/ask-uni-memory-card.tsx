"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiPanelStore } from "@uniwork/core/ai";
import {
  useApplyAiMemoryProposal,
  useEditAiMemoryProposal,
  useRejectAiMemoryProposal,
  useUndoAiMemoryProposal,
} from "@uniwork/core/ai/memory";
import { errorCode } from "@uniwork/core/api/http";
import type { AiMemoryProposal, AiMessage } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { MEMORY_MAX_CHARS } from "./ask-uni-memory-row";

const SAFE_CODE = /^[a-z_]+$/;
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
  const busy = apply.isPending || reject.isPending || undo.isPending || edit.isPending;

  const action = p.action === "update" || p.action === "forget" ? p.action : "remember";
  const run = (start: (cb: { onError: (e: unknown) => void; onSuccess?: () => void }) => void) => {
    setError("");
    start({ onError: (e) => setError(errorCode(e) ?? "default") });
  };
  const save = () => {
    const next = text.trim();
    if (next === "") return;
    run((cb) => edit.mutate({ id: p.id, body: { kind, text: next } }, { ...cb, onSuccess: () => setEditing(false) }));
  };

  const kindLabel = p.kind === "preference" || p.kind === "fact" ? t(`kind_${p.kind}`) : "";
  const status = p.status;
  return (
    <li className="px-3 py-2.5">
      <p className="text-caption font-medium text-muted-foreground">{t(`proposal.title_${action}`)}</p>
      {editing ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Input aria-label={t("proposal.edit_text")} maxLength={MEMORY_MAX_CHARS} value={text} onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1" />
          <Select
            items={[{ value: "preference", label: t("kind_preference") }, { value: "fact", label: t("kind_fact") }]}
            value={kind}
            onValueChange={(v) => v && setKind(v)}
          >
            <SelectTrigger aria-label={t("kind_label")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="preference">{t("kind_preference")}</SelectItem>
              <SelectItem value="fact">{t("kind_fact")}</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" size="sm" disabled={busy} onClick={save}>{t("proposal.edit_save")}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>{t("proposal.edit_cancel")}</Button>
        </div>
      ) : (
        <div className={SETTLED.has(status) ? "mt-1 opacity-60" : "mt-1"}>
          {action === "update" && p.before_text !== "" ? (
            <p className="text-body break-words whitespace-pre-wrap text-muted-foreground line-through">
              <span className="sr-only">{t("proposal.was")}: </span>
              {p.before_text}
            </p>
          ) : null}
          <p className="text-body break-words whitespace-pre-wrap text-foreground">{p.text}</p>
          {kindLabel ? <p className="mt-0.5 text-caption text-muted-foreground">{kindLabel}</p> : null}
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-1.5 text-caption text-destructive">
          {t(`errors.${SAFE_CODE.test(error) ? error : "default"}`, { defaultValue: t("errors.default") })}
        </p>
      ) : null}
      {editing ? null : status === "pending" ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" disabled={busy} onClick={() => run((cb) => apply.mutate(p.id, cb))}>
            {t(`proposal.${action === "update" ? "save" : action}`)}
          </Button>
          {action === "forget" ? null : (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setText(p.text); setKind(p.kind); setEditing(true); }}>
              {t("proposal.edit")}
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => run((cb) => reject.mutate(p.id, cb))}>
            {t("proposal.reject")}
          </Button>
        </div>
      ) : status === "applied" ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-caption text-success">{t(`proposal.done_${action}`)}</span>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => run((cb) => undo.mutate(p.id, cb))}>
            {t("proposal.undo")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setView("memory")}>{t("proposal.open")}</Button>
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
    <section aria-label={t("title_remember")} className="mt-3 flex flex-col gap-2" data-slot="ask-uni-memory-card">
      <div className="overflow-hidden rounded-lg bg-muted/50">
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
