"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AiProposal } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { DateField } from "../common/date-field";
import { DateTimeField } from "../common/datetime-field";
import { useWorkspaceId } from "../layout/workspace-context";
import { AskUniObjectPicker, type AskUniObjectItem } from "./ask-uni-object-picker";
import { bodyArg, bodyInForm, editKind, editRefusal, fieldLabel, formatProposalValue, type EditKind } from "./ask-uni-proposal-values";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface EditCallbacks {
  onSuccess: () => void;
  onError: (err: unknown) => void;
}

interface Props {
  proposal: AiProposal;
  /** Sends the changed arguments; the host owns the call and answers through the callbacks. */
  onSave: (changes: Record<string, unknown>, cb: EditCallbacks) => void;
  onDone: () => void;
  /** Another call is in flight. */
  busy?: boolean;
}

interface Item {
  key: string;
  kind: EditKind;
  type: string;
  options: string[];
  initial: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
// The server writes an instant as UTC RFC 3339; the field edits it as a local "YYYY-MM-DDTHH:mm".
function toLocal(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const toInstant = (local: string) => new Date(local).toISOString().replace(".000Z", "Z");

function itemsOf(p: AiProposal): Item[] {
  const items: Item[] = [];
  for (const f of p.preview.fields) {
    const kind = editKind(f, p.tool);
    if (!kind) continue;
    const to = typeof f.to === "string" ? f.to : "";
    const initial = kind === "datetime" ? toLocal(to) : kind === "date" ? (DAY.test(to) ? to : "") : kind === "object" ? "" : to;
    items.push({ key: f.field, kind, type: f.type, options: f.options, initial });
  }
  if (bodyInForm(p)) items.push({ key: bodyArg(p.tool), kind: "markdown", type: "text", options: [], initial: p.preview.body });
  return items;
}

function ObjectField({ id, label, kind, current, picked, onPick }: { id: string; label: string; kind: "member" | "project"; current: string; picked: string; onPick: (item: AskUniObjectItem) => void }) {
  const { t } = useTranslation();
  const wsId = useWorkspaceId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <Input
        id={id}
        aria-label={label}
        placeholder={picked || current}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {picked ? <p className="text-caption text-muted-foreground">{t("ai.proposal.picked", { name: picked })}</p> : null}
      {open ? (
        <AskUniObjectPicker
          wsId={wsId}
          query={query}
          kinds={[kind]}
          onDismiss={() => setOpen(false)}
          onPick={(item) => {
            onPick(item);
            setQuery("");
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * "Sửa" for one proposal: a control per editable field, only the changed ones are sent. It stays open until the
 * server accepts; a refusal shows at the field it names (else under the form) and keeps what was typed.
 */
export function AskUniProposalEdit({ proposal, onSave, onDone, busy = false }: Props) {
  const { t, i18n } = useTranslation();
  const items = itemsOf(proposal);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.key, i.initial])));
  const [picked, setPicked] = useState<Record<string, AskUniObjectItem>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ field: string; text: string } | null>(null);
  const set = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const changes: Record<string, unknown> = {};
    for (const i of items) {
      if (i.kind === "object") {
        if (picked[i.key]) changes[i.key] = picked[i.key]!.id;
      } else if (values[i.key] !== i.initial) {
        const v = values[i.key] ?? "";
        // An emptied date clears the field: the tools take null for that and refuse "".
        const isDate = i.kind === "date" || i.kind === "datetime";
        changes[i.key] = isDate && !v ? null : i.kind === "datetime" ? toInstant(v) : v;
      }
    }
    if (Object.keys(changes).length === 0) return onDone();
    setError(null);
    setSaving(true);
    onSave(changes, {
      onSuccess: onDone,
      onError: (err) => {
        setSaving(false);
        setError(editRefusal(err, items.map((i) => i.key), t));
      },
    });
  };

  const alert = (text: string) => (
    <p role="alert" className="text-caption text-destructive">
      {text}
    </p>
  );
  const control = (i: Item, id: string, label: string): ReactNode => {
    const v = values[i.key] ?? "";
    switch (i.kind) {
      case "markdown":
        return <Textarea id={id} aria-label={label} value={v} rows={4} onChange={(e) => set(i.key, e.target.value)} />;
      case "date":
        return <DateField id={id} ariaLabel={label} value={v} onChange={(d) => set(i.key, d)} />;
      case "datetime": {
        // Only a meeting's end is a datetime besides its start; each names its own hour and minute.
        const end = i.key === "ends_at";
        return (
          <DateTimeField
            id={id}
            value={v}
            onChange={(d) => set(i.key, d)}
            hourLabel={t(end ? "meetings.endHour" : "meetings.startHour")}
            minuteLabel={t(end ? "meetings.endMinute" : "meetings.startMinute")}
          />
        );
      }
      case "enum":
        return (
          <Select
            id={id}
            aria-label={label}
            value={v}
            onValueChange={(next) => next && set(i.key, next)}
            items={i.options.map((o) => ({ value: o, label: formatProposalValue(o, "enum", i.key, t, i18n.language, proposal.tool) }))}
          />
        );
      case "object": {
        const f = proposal.preview.fields.find((x) => x.field === i.key);
        return (
          <ObjectField
            id={id}
            label={label}
            kind={i.type === "project" ? "project" : "member"}
            current={f ? formatProposalValue(f.to, i.type, i.key, t, i18n.language, proposal.tool) : ""}
            picked={picked[i.key]?.title ?? ""}
            onPick={(item) => setPicked((s) => ({ ...s, [i.key]: item }))}
          />
        );
      }
      default:
        return <Input id={id} aria-label={label} value={v} onChange={(e) => set(i.key, e.target.value)} />;
    }
  };

  return (
    <form className="mt-2 flex flex-col gap-2.5" onSubmit={submit}>
      {items.map((i) => {
        const id = `${proposal.id}-edit-${i.key}`;
        const name = fieldLabel(t, i.key);
        return (
          <div key={i.key} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-caption text-muted-foreground">
              {name}
            </label>
            {control(i, id, t("ai.proposal.edit_field", { field: name }))}
            {error?.field === i.key ? alert(error.text) : null}
          </div>
        );
      })}
      {error && error.field === "" ? alert(error.text) : null}
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={busy || saving}>
          <Check aria-hidden />
          {t("ai.proposal.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={onDone}>
          <X aria-hidden />
          {t("ai.proposal.cancel")}
        </Button>
      </div>
    </form>
  );
}
