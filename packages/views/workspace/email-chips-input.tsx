"use client";
import { TriangleAlert, X } from "lucide-react";
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
  const invalidCount = value.filter((e) => !EMAIL_RE.test(e)).length;
  return (
    <>
      <div
      className={cn(
        "flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border bg-surface px-2 py-1.5 focus-within:border-ring pointer-coarse:min-h-11",
        // Đường bao của một control phải đạt 3:1 — xem `input.tsx`.
        invalidCount > 0 ? "border-destructive" : "border-input",
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
              ok ? "border-border bg-muted text-foreground" : "border-destructive/40 bg-destructive/5 text-destructive",
            )}
          >
            {/* Địa chỉ sai trước đây chỉ khác nhau ở màu — người mù màu, màn hình
                đơn sắc và screen reader đều không nhận ra. Thêm biểu tượng và
                một nhãn nói rõ vấn đề. */}
            {ok ? null : (
              <>
                <TriangleAlert aria-hidden className="size-3 shrink-0" />
                <span className="sr-only">{t("workspace.invite_invalid_email")}: </span>
              </>
            )}
            {email}
            <button
              type="button"
              aria-label={`${t("common.delete")} ${email}`}
              disabled={disabled}
              className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-border pointer-coarse:size-11"
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
        type="email"
        multiple
        value={draft}
        disabled={disabled}
        placeholder={value.length ? "" : placeholder}
        // Bàn phím mobile phải có "@" và không tự viết hoa/tự sửa địa chỉ email.
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="enter"
        className="min-w-[10rem] flex-1 bg-transparent text-body text-foreground placeholder:text-muted-foreground focus:outline-none"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => draft.trim() && add(draft)}
        aria-describedby={invalidCount > 0 ? `${id}-invalid` : undefined}
        aria-invalid={invalidCount > 0 ? true : undefined}
      />
      </div>
      {invalidCount > 0 && (
        <p id={`${id}-invalid`} role="alert" className="mt-1.5 text-caption text-destructive">
          {t("workspace.invite_invalid_summary", { count: invalidCount })}
        </p>
      )}
    </>
  );
}
