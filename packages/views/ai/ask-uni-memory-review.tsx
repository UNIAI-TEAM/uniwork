"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AiMemoryImportSplit } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { MEMORY_MAX_CHARS, MemoryKindToggle, runeCount } from "./ask-uni-memory-row";

type Row = { text: string; kind: string; checked: boolean; instructionLike: boolean; duplicate: boolean };

// The server counts runes, so an emoji is one character here too.
const validText = (s: string) => s.trim() !== "" && runeCount(s.trim()) <= MEMORY_MAX_CHARS;

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
 * The import's pick step, in place in its card: one row per candidate with a tick, the whole text (editable) and the
 * kind. Everything shown came from a model reading untrusted paste, so it is rendered as plain text (input values and
 * text nodes), never as markup.
 */
export function AskUniMemoryReview({
  split,
  remaining,
  onSave,
  onPasteAgain,
}: {
  split: AiMemoryImportSplit;
  remaining: number;
  /** Resolves with the error to show, or null once saved. */
  onSave: (entries: { kind: string; text: string }[]) => Promise<string | null>;
  onPasteAgain: () => void;
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
      {rows.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {rows.map((r, i) => (
            <li key={i} className={`flex items-start gap-2.5 px-2.5 py-2.5 ${r.instructionLike ? "bg-warning-soft" : ""}`}>
              <Checkbox
                aria-label={t("importer.tick_label")}
                className="mt-2"
                checked={r.checked}
                disabled={!r.checked && full}
                onCheckedChange={(v) => patch(i, { checked: v === true })}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {/* Wraps like the line editor, so the whole candidate reads; a pasted break becomes a space. */}
                <Textarea
                  aria-label={t("entry_label")}
                  aria-invalid={!validText(r.text)}
                  value={r.text}
                  onChange={(e) => patch(i, { text: e.target.value.replace(/[\r\n]+/g, " ") })}
                  className="min-h-0 bg-background"
                />
                <MemoryKindToggle value={r.kind} onChange={(kind) => patch(i, { kind })} />
                {r.instructionLike ? (
                  <p className="flex items-start gap-1.5 text-caption text-warning-soft-foreground">
                    <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    {t("importer.instruction_like")}
                  </p>
                ) : null}
                {r.duplicate ? <p className="text-caption text-muted-foreground">{t("importer.duplicate")}</p> : null}
                {!validText(r.text) ? <p className="text-caption text-destructive">{t("importer.invalid_text")}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {split.skipped.length > 0 ? (
        <details className="text-caption text-muted-foreground">
          <summary className="cursor-pointer">{t("importer.skipped", { count: split.skipped.length })}</summary>
          <ul className="mt-1 flex flex-col gap-1 ps-4">
            {split.skipped.map((s, i) => (
              <li key={i}>
                {s.text || t("importer.hidden_text")}
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
      <div className="flex justify-end gap-1.5">
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onPasteAgain}>
          {t("importer.paste_again")}
        </Button>
        <Button type="button" size="sm" disabled={blocked || saving} onClick={() => void save()}>
          {saving ? t("importer.saving") : t("importer.save", { count: picked.length })}
        </Button>
      </div>
    </div>
  );
}
