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
      // The frame, not the bare <input>, is the real touch target and the real
      // focus host — `e2e/onboarding-mobile.spec.ts` measures `[data-slot]` for
      // exactly this reason and would otherwise climb to the whole field.
      data-slot="email-chips"
      role="presentation"
      className={cn(
        "flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border bg-surface px-2 py-1.5 pointer-coarse:min-h-11",
        // Đường bao của một control phải đạt 3:1 — xem `input.tsx`.
        invalidCount > 0 ? "border-destructive" : "border-input",
        // The draft input cannot carry its own focus ring (it is transparent
        // and sits between the chips), so the FRAME draws one for it — the same
        // `focus-within` pattern the option chips use.
        //
        // `has-[>input:focus-visible]` rather than `focus-within`: each chip's
        // delete button also lives inside this frame and already has the global
        // focus outline, so `focus-within` would wrap a second ring around it —
        // exactly what `e2e/onboarding-focus.spec.ts` forbids. The `>` narrows
        // this to the draft input, the only direct <input> child.
        "has-[>input:focus-visible]:border-ring has-[>input:focus-visible]:ring-3 has-[>input:focus-visible]:ring-ring/50",
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
        // `focus-visible:` rather than `focus:`: the frame draws the ring via
        // `has-[>input:focus-visible]`, and the old `focus:` form also stripped
        // the global outline in focus states where that ring never turns on.
        className="min-w-[10rem] flex-1 bg-transparent text-body text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => draft.trim() && add(draft)}
        aria-describedby={invalidCount > 0 ? `${id}-invalid` : undefined}
        aria-invalid={invalidCount > 0 ? true : undefined}
      />
      </div>
      {/* Enter adds a chip and Backspace removes one: both only change what is
          INSIDE the frame, leaving the draft input's value and the focus
          untouched, so a screen reader has nothing to announce. A recipient
          count in a live region is the only thing that says "one more" or
          "one gone". */}
      <span role="status" aria-live="polite" className="sr-only">
        {value.length ? t("workspace.invite_recipient_count", { count: value.length }) : t("workspace.invite_recipients_empty")}
      </span>
      {invalidCount > 0 && (
        <p id={`${id}-invalid`} role="alert" className="mt-1.5 text-caption text-destructive">
          {t("workspace.invite_invalid_summary", { count: invalidCount })}
        </p>
      )}
    </>
  );
}
