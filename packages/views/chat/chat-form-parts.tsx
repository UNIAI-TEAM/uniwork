"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * The left side of a chat form's footer: the submit error when the last try
 * failed (announced, next to the button that failed), otherwise why the
 * primary action is not ready yet. Nothing when the form is ready.
 */
export function ChatFormFooterNote({ id, error, hint }: { id?: string; error?: string | null; hint?: string | null }) {
  if (error) {
    return (
      <p id={id} role="alert" className="text-caption text-destructive text-pretty">
        {error}
      </p>
    );
  }
  if (hint) {
    return (
      <p id={id} className="text-caption text-muted-foreground text-pretty">
        {hint}
      </p>
    );
  }
  return null;
}

/** Share of `max` from which a length counter shows up. */
const COUNTER_FROM = 0.8;

/** Whether the counter for this length is on screen (so a field can point at it). */
export function nearLimit(length: number, max: number): boolean {
  return length >= max * COUNTER_FROM;
}

/**
 * "1 820/2 000" once the text nears its limit — invisible before that, so a
 * short note is not watched by a number. The count is polite-live only when
 * it is shown.
 */
export function ChatCharCounter({ id, length, max }: { id: string; length: number; max: number }) {
  const { t } = useTranslation();
  if (!nearLimit(length, max)) return null;
  return (
    <span
      id={id}
      aria-live="polite"
      className={cn("text-caption tabular-nums", length >= max ? "text-destructive" : "text-muted-foreground")}
    >
      {t("chat.form_char_count", { length, max })}
    </span>
  );
}

/**
 * The visible mark after a required field's label. Screen readers get the
 * same fact from `aria-required` on the field, so the mark itself is hidden.
 */
export function RequiredMark() {
  return (
    <span aria-hidden className="text-destructive">
      *
    </span>
  );
}
