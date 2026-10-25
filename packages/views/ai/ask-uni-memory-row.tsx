"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AiMemory } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";

export const MEMORY_MAX_CHARS = 300;

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
  onSave: (patch: { kind: string; text: string }) => void;
  onDelete: () => void;
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
  const commit = () => {
    const next = text.trim();
    if (next !== "" && (next !== entry.text || kind !== entry.kind)) onSave({ kind, text: next });
    close();
  };

  if (editing) {
    return (
      <li className="flex items-center gap-2 py-1">
        <Input
          autoFocus
          aria-label={t("entry_label")}
          placeholder={t("entry_placeholder", { max: MEMORY_MAX_CHARS })}
          maxLength={MEMORY_MAX_CHARS}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") commit();
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
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("delete_entry")}
        className="text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
        onClick={onDelete}
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}
