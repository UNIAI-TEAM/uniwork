"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { errorCode } from "@uniwork/core/api/http";
import type { AiMemory } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";

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

/**
 * One memory line. Click (or Enter on it) opens an editor with the kind; Enter saves, Escape cancels, an empty or
 * unchanged line saves nothing. `startEditing` opens it at once for a new entry, whose `id` is "".
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
    onCancel?.();
  };
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const tooLong = runeCount(text.trim()) > MEMORY_MAX_CHARS;
  const shownError = error ?? (tooLong ? t("errors.invalid_request") : null);
  const commit = async () => {
    const next = text.trim();
    if (next === "" || (next === entry.text && kind === entry.kind)) return close();
    if (saving) return;
    if (runeCount(next) > MEMORY_MAX_CHARS) return;
    setSaving(true);
    setError(null);
    const failure = await onSave({ kind, text: next });
    setSaving(false);
    if (failure === null) close();
    else setError(failure);
  };

  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 py-1">
        <Input
          autoFocus
          aria-label={t("entry_label")}
          placeholder={t("entry_placeholder", { max: MEMORY_MAX_CHARS })}
          aria-invalid={tooLong}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") void commit();
            else if (e.key === "Escape") close();
          }}
          className="min-w-0 flex-1"
        />
        <Select
          items={[
            { value: "preference", label: t("kind_preference") },
            { value: "fact", label: t("kind_fact") },
          ]}
          value={kind} onValueChange={(v) => v && setKind(v)}>
          <SelectTrigger aria-label={t("kind_label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="preference">{t("kind_preference")}</SelectItem>
            <SelectItem value="fact">{t("kind_fact")}</SelectItem>
          </SelectContent>
        </Select>
        {shownError ? (
          <p role="alert" className="w-full text-caption text-destructive">
            {shownError}
          </p>
        ) : null}
      </li>
    );
  }
  return (
    <li className="group flex items-center gap-1 rounded-md hover:bg-muted focus-within:bg-muted">
      <button
        type="button"
        title={t("edit_entry")}
        onClick={() => setEditing(true)}
        className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-start text-body"
      >
        {entry.text}
      </button>
      {/* Hidden until the line is hovered or holds focus; it stays in the tab order. */}
      {onDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("delete_entry", { text: entry.text })}
          className="text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100"
          onClick={onDelete}
        >
          <Trash2 aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}
