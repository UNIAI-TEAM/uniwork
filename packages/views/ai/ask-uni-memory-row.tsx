"use client";

import { useState } from "react";
import { Pencil, Trash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { errorCode } from "@uniwork/core/api/http";
import type { AiMemory } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";

export const MEMORY_MAX_CHARS = 300;

/** Characters as the server counts them: runes, so an emoji is one. */
export const runeCount = (s: string) => [...s].length;

const SAFE_CODE = /^[a-z_]+$/;

/**
 * Copy for a refused memory call: the memory screen's own key, then Ask UNI's shared AI copy (quota, provider down),
 * then the default. The split puts its own `importer.errors` copy first.
 */
export function useMemoryErrorText() {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  return (err: unknown, scope: "errors" | "importer.errors" = "errors"): string => {
    const code = errorCode(err) ?? "";
    if (!SAFE_CODE.test(code)) return t("memory.errors.default");
    const own = scope === "errors" ? [`memory.errors.${code}`] : [`memory.importer.errors.${code}`, `memory.errors.${code}`];
    return t([...own, `errors.${code}`, "memory.errors.default"]);
  };
}

// The registry's pressed tint is a shade off the card in dark mode; the chosen kind must read at a glance.
const PRESSED = "aria-pressed:border-primary/50 aria-pressed:bg-primary/15 aria-pressed:text-primary";

/** The two kinds as one segmented choice, shared by the line editor and the import review. */
export function MemoryKindToggle({ value, onChange }: { value: string; onChange: (kind: string) => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.memory" });
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      aria-label={t("kind_label")}
      value={[value]}
      onValueChange={(v) => {
        if (v[0]) onChange(v[0]);
      }}
    >
      <ToggleGroupItem value="preference" className={PRESSED}>
        {t("kind_preference")}
      </ToggleGroupItem>
      <ToggleGroupItem value="fact" className={PRESSED}>
        {t("kind_fact")}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/**
 * One memory line. The text (or its pencil) opens an editor that wraps the whole entry, with the kind, a counter and
 * Save/Cancel; Enter saves, Escape cancels, an empty or unchanged line saves nothing. `startEditing` opens it at once
 * for a new entry, whose `id` is "".
 */
export function AskUniMemoryRow({
  entry,
  onSave,
  onDelete,
  startEditing = false,
  onCancel,
}: {
  entry: AiMemory;
  /** Resolves with the error to show, or null once saved; the editor stays open until then. */
  onSave: (patch: { kind: string; text: string }) => Promise<string | null>;
  onDelete?: () => void;
  startEditing?: boolean;
  onCancel?: () => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.memory" });
  const [editing, setEditing] = useState(startEditing);
  const [text, setText] = useState(entry.text);
  const [kind, setKind] = useState(entry.kind);

  const close = () => {
    setEditing(false);
    setText(entry.text);
    setKind(entry.kind);
    setError(null);
    onCancel?.();
  };
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const length = runeCount(text.trim());
  const tooLong = length > MEMORY_MAX_CHARS;
  const shownError = error ?? (tooLong ? t("errors.invalid_request") : null);
  const commit = async () => {
    const next = text.trim();
    if (next === "" || (next === entry.text && kind === entry.kind)) return close();
    if (saving || runeCount(next) > MEMORY_MAX_CHARS) return;
    setSaving(true);
    setError(null);
    const failure = await onSave({ kind, text: next });
    setSaving(false);
    if (failure === null) close();
    else setError(failure);
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-2 bg-muted/40 px-3 py-2.5">
        {/* An entry is one line: a typed break becomes a space, and the box wraps so a long entry reads whole. */}
        <Textarea
          autoFocus
          aria-label={t("entry_label")}
          placeholder={t("entry_placeholder", { max: MEMORY_MAX_CHARS })}
          aria-invalid={tooLong}
          value={text}
          onChange={(e) => {
            setText(e.target.value.replace(/[\r\n]+/g, " "));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") close();
          }}
          className="min-h-0 bg-background"
        />
        <div className="flex flex-wrap items-center gap-2">
          <MemoryKindToggle value={kind} onChange={setKind} />
          <span className={`ms-auto text-caption ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
            {t("entry_count", { count: length, max: MEMORY_MAX_CHARS })}
          </span>
        </div>
        {shownError ? (
          <p role="alert" className="text-caption text-destructive">
            {shownError}
          </p>
        ) : null}
        <div className="flex justify-end gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={close}>
            {t("cancel")}
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void commit()}>
            {t("save")}
          </Button>
        </div>
      </li>
    );
  }
  return (
    <li className="group flex items-start gap-1 hover:bg-muted/50 focus-within:bg-muted/50">
      <button
        type="button"
        title={t("edit_entry")}
        onClick={() => setEditing(true)}
        className="min-w-0 flex-1 rounded-md px-3 py-2 text-start text-body break-words whitespace-pre-wrap"
      >
        {entry.text}
      </button>
      {/* Muted, but always there: ClickUp-style rows do not hide their actions until hover. */}
      <div className="flex shrink-0 items-center py-1 pe-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("edit_entry_named", { text: entry.text })}
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setEditing(true)}
        >
          <Pencil aria-hidden />
        </Button>
        {onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("delete_entry", { text: entry.text })}
            className="text-muted-foreground hover:text-foreground"
            onClick={onDelete}
          >
            <Trash aria-hidden />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
