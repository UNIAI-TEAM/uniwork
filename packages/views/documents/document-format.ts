"use client";

import { EMPTY_CELL, formatListDate } from "./doclist/format";

// Small display helpers shared by the G1-08 sheets and dialogs. They are pure
// and locale-driven: no token, no rounding rule lives anywhere else.

/** Today is named by its clock; any other day carries the date too. */
export function formatWhen(at: string | null | undefined, locale: string): string {
  if (!at) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return new Intl.DateTimeFormat(
    locale,
    sameDay ? { hour: "2-digit", minute: "2-digit" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(date);
}

/** The short stamp the trash and Lưu trữ rows still use: the shared list date (doclist/format.ts), "" for nothing to show.
 *  Those two screens move onto formatListDate with their own slices; until then this keeps their empty-cell fallback. */
export function formatShortWhen(at: string | null | undefined, locale: string, now: Date = new Date()): string {
  const text = formatListDate(at, now, locale);
  return text === EMPTY_CELL ? "" : text;
}
