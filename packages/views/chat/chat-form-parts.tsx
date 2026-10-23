"use client";

import { CalendarDays, ChevronDown } from "lucide-react";
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
      <p id={id} role="alert" className="text-destructive text-pretty">
        {error}
      </p>
    );
  }
  if (hint) {
    return (
      <p id={id} className="text-muted-foreground text-pretty">
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
 * "31/200" beside a field's label. By default it shows up only once the text
 * nears its limit, so a short reminder is not watched by a number; `always`
 * keeps it on (the canvas' note, post and poll fields). It is polite-live only
 * near the limit, so typing is not read out key by key.
 */
export function ChatCharCounter({
  id,
  length,
  max,
  always = false,
}: {
  id: string;
  length: number;
  max: number;
  always?: boolean;
}) {
  const { t } = useTranslation();
  const near = nearLimit(length, max);
  if (!near && !always) return null;
  return (
    <span
      id={id}
      aria-live={near ? "polite" : undefined}
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

/** DateField's trigger body in a chat dialog: calendar, the day, and a chevron at the end. */
export function renderChatDateTrigger(label: string) {
  return (
    <>
      <CalendarDays aria-hidden className="size-4.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </>
  );
}
