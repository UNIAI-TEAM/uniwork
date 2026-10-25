"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AiMemoryImportSplit } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { MEMORY_MAX_CHARS } from "./ask-uni-memory-row";

type Row = { text: string; kind: string; checked: boolean; instructionLike: boolean; duplicate: boolean };

const validText = (s: string) => s.trim() !== "" && s.trim().length <= MEMORY_MAX_CHARS;

/** Pre-tick valid, non-duplicate, non-instruction rows in order until the free slots run out. */
function initialRows(split: AiMemoryImportSplit, remaining: number): Row[] {
  let free = remaining;
  return split.candidates.map((c) => {
    const checked = !c.instruction_like && !c.duplicate && free > 0 && (c.kind === "preference" || c.kind === "fact") && validText(c.text);
    if (checked) free -= 1;
    return { text: c.text, kind: c.kind === "preference" ? "preference" : "fact", checked, instructionLike: c.instruction_like, duplicate: c.duplicate };
  });
}

/**
 * Step 3 of the import: one line per candidate with a tick, a kind and an editable text. Everything shown came from a
 * model reading untrusted paste, so it is rendered as plain text (input values and text nodes), never as markup.
 */
export function AskUniMemoryReview({
  split,
  remaining,
  onSave,
}: {
  split: AiMemoryImportSplit;
  remaining: number;
  /** Resolves with the error to show, or null once saved. */
  onSave: (entries: { kind: string; text: string }[]) => Promise<string | null>;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.memory" });
  const [rows, setRows] = useState(() => initialRows(split, remaining));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const picked = rows.filter((r) => r.checked);
  const full = picked.length >= remaining;
  const blocked = picked.length === 0 || picked.some((r) => !validText(r.text));

  const save = async () => {
    setSaving(true);
    setError(null);
    const failure = await onSave(picked.map((r) => ({ kind: r.kind, text: r.text.trim() })));
    setSaving(false);
    setError(failure);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 text-body font-semibold">{t("importer.review_title")}</h3>
        <span className="text-caption text-muted-foreground">{t("importer.remaining", { count: remaining })}</span>
      </div>
      {rows.length === 0 ? <p className="text-caption text-muted-foreground">{t("importer.empty")}</p> : null}
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-col gap-1 rounded-md border border-border p-2">
            <div className="flex items-center gap-2">
              <Checkbox
                aria-label={t("importer.tick_label")}
                checked={r.checked}
                disabled={!r.checked && full}
                onCheckedChange={(v) => patch(i, { checked: v === true })}
              />
              <Input
                aria-label={t("entry_label")}
                aria-invalid={!validText(r.text)}
                value={r.text}
                maxLength={MEMORY_MAX_CHARS}
                onChange={(e) => patch(i, { text: e.target.value.replace(/[\r\n]+/g, " ") })}
                className="min-w-0 flex-1"
              />
              <Select
                items={[
                  { value: "preference", label: t("kind_preference") },
                  { value: "fact", label: t("kind_fact") },
                ]}
                value={r.kind}
                onValueChange={(v) => v && patch(i, { kind: v })}
              >
                <SelectTrigger aria-label={t("kind_label")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="preference">{t("kind_preference")}</SelectItem>
                  <SelectItem value="fact">{t("kind_fact")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {r.instructionLike ? <p className="text-caption text-destructive">{t("importer.instruction_like")}</p> : null}
            {r.duplicate ? <p className="text-caption text-muted-foreground">{t("importer.duplicate")}</p> : null}
            {!validText(r.text) ? <p className="text-caption text-destructive">{t("importer.invalid_text")}</p> : null}
          </li>
        ))}
      </ul>
      {split.skipped.length > 0 ? (
        <details className="text-caption text-muted-foreground">
          <summary className="cursor-pointer">{t("importer.skipped", { count: split.skipped.length })}</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {split.skipped.map((s, i) => (
              <li key={i}>
                {s.text}
                {s.reason ? ` (${t(`importer.reason_${s.reason}`, { defaultValue: s.reason })})` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="button" disabled={blocked || saving} onClick={() => void save()}>
        {saving ? t("importer.saving") : t("importer.save", { count: picked.length })}
      </Button>
    </div>
  );
}
