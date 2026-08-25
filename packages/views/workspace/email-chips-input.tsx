"use client";
import { X } from "lucide-react";
import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmails(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const e = raw.trim().toLowerCase();
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

/** Ô nhập nhiều email: Enter/, ;/space/paste tách chip; chip sai định dạng tô đỏ. */
export function EmailChipsInput({
  id,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  id: string;
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const add = (text: string) => {
    const next = parseEmails(text).filter((e) => !value.includes(e));
    if (next.length) onChange([...value, ...next]);
    setDraft("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (["Enter", ",", ";", " "].includes(e.key)) {
      if (draft.trim()) {
        e.preventDefault();
        add(draft);
      } else if (e.key !== " ") e.preventDefault();
    } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    add(e.clipboardData.getData("text"));
  };
  return (
    <div
      className={cn(
        "flex min-h-10 flex-wrap items-center gap-1.5 rounded-[var(--uw-radius)] border border-line bg-surface px-2 py-1.5 focus-within:border-primary",
        disabled && "opacity-60",
      )}
      onClick={() => document.getElementById(id)?.focus()}
    >
      {value.map((email) => {
        const ok = EMAIL_RE.test(email);
        return (
          <span
            key={email}
            data-invalid={ok ? undefined : true}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption",
              ok ? "border-line bg-subtle text-primary" : "border-danger/40 bg-danger/5 text-danger",
            )}
          >
            {email}
            <button
              type="button"
              aria-label={`${t("common.delete")} ${email}`}
              disabled={disabled}
              className="rounded-full p-0.5 hover:bg-line"
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((v) => v !== email));
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      <input
        id={id}
        type="text"
        value={draft}
        disabled={disabled}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[10rem] flex-1 bg-transparent text-body text-primary placeholder:text-tertiary focus:outline-none"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  );
}
