"use client";

import { useState } from "react";
import { ArrowUpRight, Ban, Check, CircleAlert, CircleCheck, Clock, Pencil, TriangleAlert, Undo2, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AiProposal } from "@uniwork/core/types";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { askRefHref } from "./ask-uni-context-chips";
import { entityKindIcon } from "./ask-uni-entity";
import { isInAppHref } from "./ask-uni-links";
import { AskUniProposalEdit, type EditCallbacks } from "./ask-uni-proposal-edit";
import { fieldLabel, formatProposalValue, hasEditable } from "./ask-uni-proposal-values";

const SAFE_CODE = /^[a-z_]+$/;
const FADED = new Set(["rejected", "undone", "expired"]);
// One glyph per settled state, beside its words.
const STATUS_ICON: Record<string, { Icon: LucideIcon; tone: string }> = {
  applied: { Icon: CircleCheck, tone: "text-success" },
  rejected: { Icon: Ban, tone: "text-muted-foreground" },
  undone: { Icon: Undo2, tone: "text-muted-foreground" },
  expired: { Icon: Clock, tone: "text-muted-foreground" },
};

export interface ProposalRowProps {
  proposal: AiProposal;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onEdit?: (changes: Record<string, unknown>, cb: EditCallbacks) => void;
  onApply?: () => void;
  onReject?: () => void;
  onUndo?: () => void;
  /** A call on this row is in flight. */
  busy?: boolean;
  /** Code of the last refused call on this row (e.g. an undo that found the object edited). */
  error?: string;
  /** Actions are off: the row is history, with no button or checkbox. */
  readOnly?: boolean;
}

function Fields({ proposal }: { proposal: AiProposal }) {
  const { t, i18n } = useTranslation();
  const fields = proposal.preview.fields;
  if (fields.length === 0) return null;
  // A row that makes a new object has no old value: schedule_meeting creates without the create_ prefix.
  const creates = proposal.tool.startsWith("create_") || proposal.tool === "schedule_meeting";
  // A page edit's mode says how the body below lands; it has no old value either.
  const noFrom = (field: string) => creates || field === "mode";
  return (
    <dl className="mt-1.5 flex flex-col gap-1 text-caption">
      {fields.map((f, i) => (
        <div key={`${f.field}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">{fieldLabel(t, f.field)}</dt>
          <dd className="min-w-0 break-words whitespace-pre-wrap text-foreground">
            {noFrom(f.field) ? null : (
              <>
                <span className="text-muted-foreground">{formatProposalValue(f.from, f.type, f.field, t, i18n.language, proposal.tool)}</span>
                <span> → </span>
              </>
            )}
            <span>{formatProposalValue(f.to, f.type, f.field, t, i18n.language, proposal.tool)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Audience({ proposal }: { proposal: AiProposal }) {
  const { t } = useTranslation();
  const a = proposal.preview.audience;
  const who = SAFE_CODE.test(a.visibility) ? t(`ai.proposal.audience.${a.visibility}`, { count: a.room_members, defaultValue: "" }) : "";
  const names = a.notifies.map((n) => n.title).filter(Boolean).join(", ");
  const notifies = names ? t(a.notifies_more ? "ai.proposal.notifies_more" : "ai.proposal.notifies", { names }) : a.notifies_more ? t("ai.proposal.notifies_others") : "";
  if (!who && !notifies) return null;
  return (
    <p className="mt-1.5 text-caption text-muted-foreground">
      <span className="font-medium">{t("ai.proposal.audience_title")}:</span> {[who, notifies].filter(Boolean).join(" · ")}
    </p>
  );
}

function StatusLine({ proposal, error }: { proposal: AiProposal; error?: string }) {
  const { t } = useTranslation();
  const { status } = proposal;
  const code = error ?? (status === "failed" ? proposal.error_code : "");
  if (code || status === "failed") {
    const known = SAFE_CODE.test(code) ? t(`ai.proposal.error.${code}`, { defaultValue: "" }) : "";
    return (
      <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-caption text-destructive">
        <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
        {known || t("ai.proposal.error.default")}
      </p>
    );
  }
  if (status === "applying" || status === "undoing") {
    return (
      <p role="status" className="mt-1.5 flex items-center gap-1.5 text-caption text-muted-foreground">
        <Spinner className="size-3.5" />
        {t(status === "applying" ? "ai.proposal.applying" : "ai.proposal.undoing")}
      </p>
    );
  }
  if (status === "unknown") {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 text-caption text-muted-foreground">
        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
        {t("ai.proposal.unknown")}
      </p>
    );
  }
  const settled = STATUS_ICON[status];
  if (!settled) return null;
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-caption text-muted-foreground">
      <settled.Icon aria-hidden className={cn("size-3.5 shrink-0", settled.tone)} />
      {t(`ai.proposal.status.${status}`)}
    </p>
  );
}

/** One change UNI proposes. Presentational: the card owns the calls. Every text from the model shows as plain text. */
export function AskUniProposalRow({ proposal, selectable = false, selected = false, onToggle, onEdit, onApply, onReject, onUndo, busy = false, error, readOnly = false }: ProposalRowProps) {
  const { t } = useTranslation();
  const ws = useOptionalWorkspace()?.workspace;
  const [editing, setEditing] = useState(false);
  const { preview, status } = proposal;
  const Icon = entityKindIcon(preview.target.kind);
  const tool = SAFE_CODE.test(proposal.tool) ? t(`ai.proposal.tool.${proposal.tool}`, { defaultValue: t("ai.proposal.tool.other") }) : t("ai.proposal.tool.other");
  const pending = status === "pending" && !readOnly;
  const href = proposal.result.href;
  // A link only to an in-app path: the href is data from the server, not markup. A row whose outcome is unknown
  // made no result yet, so it opens the object it names, if any.
  const link = isInAppHref(href) ? href : status === "unknown" && preview.target.id ? (askRefHref(ws, preview.target) ?? "") : "";
  const editable = hasEditable(proposal);
  const disabled = busy || status === "applying" || status === "undoing";

  return (
    <li className={cn("flex items-start gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5", FADED.has(status) && "opacity-60")}>
      {selectable && pending ? (
        <Checkbox className="mt-0.5" checked={selected} onCheckedChange={() => onToggle?.()} aria-label={t("ai.proposal.select_step", { n: proposal.position })} />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 text-body">
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          {selectable ? <span className="text-caption text-muted-foreground">{t("ai.proposal.step_n", { n: proposal.position })}</span> : null}
          <span className="font-medium">{tool}</span>
          {preview.target.title ? <span className="min-w-0 break-words text-muted-foreground">{preview.target.title}</span> : null}
        </div>
        {preview.refs.length > 0 ? (
          <p className="mt-0.5 text-caption text-muted-foreground">{preview.refs.map((n) => t("ai.proposal.uses_step", { n })).join(" · ")}</p>
        ) : null}
        <Fields proposal={proposal} />
        {/* Verbatim and inert: the words that will be posted, line breaks kept, never parsed as markdown or html. */}
        {preview.body !== "" ? (
          <p className="mt-1.5 max-h-48 overflow-auto rounded-sm bg-muted px-2 py-1.5 text-body break-words whitespace-pre-wrap">{preview.body}</p>
        ) : null}
        <Audience proposal={proposal} />
        <StatusLine proposal={proposal} error={error} />
        {editing && pending && onEdit ? (
          <AskUniProposalEdit proposal={proposal} busy={busy} onSave={onEdit} onDone={() => setEditing(false)} />
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 empty:hidden">
          {pending && !editing ? (
            <>
              <Button type="button" size="sm" disabled={disabled} onClick={onApply}>
                <Check aria-hidden />
                {t("ai.proposal.apply")}
              </Button>
              {editable ? (
                <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setEditing(true)}>
                  <Pencil aria-hidden />
                  {t("ai.proposal.edit")}
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onReject}>
                <X aria-hidden />
                {t("ai.proposal.reject")}
              </Button>
            </>
          ) : null}
          {(status === "applied" || status === "unknown") && link ? (
            <AppLink href={link} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <ArrowUpRight aria-hidden />
              {t("ai.proposal.open")}
            </AppLink>
          ) : null}
          {status === "applied" && proposal.can_undo && !readOnly ? (
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onUndo}>
              <Undo2 aria-hidden />
              {t("ai.proposal.undo")}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
