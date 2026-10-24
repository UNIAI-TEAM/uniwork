"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AiProposal } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { entityKindIcon } from "./ask-uni-entity";
import { isInAppHref } from "./ask-uni-links";
import { fieldLabel, formatProposalValue } from "./ask-uni-proposal-values";

const SAFE_CODE = /^[a-z_]+$/;
const FADED = new Set(["rejected", "undone", "expired"]);
// The one field "Sửa" opens: the row's title when it has one, else the text it will post.
const EDIT_FIELDS = ["title", "name"];

export interface ProposalRowProps {
  proposal: AiProposal;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onEdit?: (changes: Record<string, unknown>) => void;
  onApply?: () => void;
  onReject?: () => void;
  onUndo?: () => void;
  /** A call on this row is in flight. */
  busy?: boolean;
  /** Code of the last refused call on this row (e.g. an undo that found the object edited). */
  error?: string;
}

function Fields({ proposal }: { proposal: AiProposal }) {
  const { t, i18n } = useTranslation();
  const fields = proposal.preview.fields;
  if (fields.length === 0) return null;
  return (
    <dl className="mt-1.5 flex flex-col gap-1 text-caption">
      {fields.map((f, i) => (
        <div key={`${f.field}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">{fieldLabel(t, f.field)}</dt>
          <dd className="min-w-0 break-words whitespace-pre-wrap text-foreground">
            {proposal.tool.startsWith("create_") ? null : (
              <>
                <span className="text-muted-foreground">{formatProposalValue(f.from, f.type, f.field, t, i18n.language)}</span>
                <span> → </span>
              </>
            )}
            <span>{formatProposalValue(f.to, f.type, f.field, t, i18n.language)}</span>
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

function Editor({ proposal, onSave, onCancel }: { proposal: AiProposal; onSave: (changes: Record<string, unknown>) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const field = proposal.preview.fields.find((f) => EDIT_FIELDS.includes(f.field));
  const key = field?.field ?? (proposal.preview.body !== "" ? "body" : "title");
  const initial = field ? (typeof field.to === "string" ? field.to : "") : proposal.preview.body;
  const [value, setValue] = useState(initial);
  const label = t("ai.proposal.edit_field", { field: fieldLabel(t, key) });
  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ [key]: value });
      }}
    >
      {key === "body" ? (
        <Textarea aria-label={label} value={value} rows={4} onChange={(e) => setValue(e.target.value)} />
      ) : (
        <Input aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} />
      )}
      <div className="flex gap-1.5">
        <Button type="submit" size="sm">
          {t("ai.proposal.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("ai.proposal.cancel")}
        </Button>
      </div>
    </form>
  );
}

function StatusLine({ proposal, error }: { proposal: AiProposal; error?: string }) {
  const { t } = useTranslation();
  const { status } = proposal;
  const code = error ?? (status === "failed" ? proposal.error_code : "");
  if (code || status === "failed") {
    const known = SAFE_CODE.test(code) ? t(`ai.proposal.error.${code}`, { defaultValue: "" }) : "";
    return (
      <p role="alert" className="mt-1.5 text-caption text-destructive">
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
  if (status === "unknown") return <p className="mt-1.5 text-caption text-muted-foreground">{t("ai.proposal.unknown")}</p>;
  if (FADED.has(status) || status === "applied") {
    return <p className="mt-1.5 text-caption text-muted-foreground">{t(`ai.proposal.status.${status}`)}</p>;
  }
  return null;
}

/** One change UNI proposes. Presentational: the card owns the calls. Every text from the model shows as plain text. */
export function AskUniProposalRow({ proposal, selectable = false, selected = false, onToggle, onEdit, onApply, onReject, onUndo, busy = false, error }: ProposalRowProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const { preview, status } = proposal;
  const Icon = entityKindIcon(preview.target.kind);
  const tool = SAFE_CODE.test(proposal.tool) ? t(`ai.proposal.tool.${proposal.tool}`, { defaultValue: t("ai.proposal.tool.other") }) : t("ai.proposal.tool.other");
  const pending = status === "pending";
  const href = proposal.result.href;
  // A link only to an in-app path: the href is data from the server, not markup.
  const link = isInAppHref(href) ? href : "";
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
          <Editor
            proposal={proposal}
            onCancel={() => setEditing(false)}
            onSave={(changes) => {
              onEdit(changes);
              setEditing(false);
            }}
          />
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 empty:hidden">
          {pending && !editing ? (
            <>
              <Button type="button" size="sm" disabled={disabled} onClick={onApply}>
                {t("ai.proposal.apply")}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setEditing(true)}>
                {t("ai.proposal.edit")}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onReject}>
                {t("ai.proposal.reject")}
              </Button>
            </>
          ) : null}
          {(status === "applied" || status === "unknown") && link ? (
            <AppLink href={link} className="text-caption text-primary underline-offset-2 hover:underline">
              {t("ai.proposal.open")}
            </AppLink>
          ) : null}
          {status === "applied" && proposal.can_undo ? (
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onUndo}>
              {t("ai.proposal.undo")}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
