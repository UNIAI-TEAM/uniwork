import type { useTranslation } from "react-i18next";

type TFunction = ReturnType<typeof useTranslation>["t"];

const MAX_TEXT = 200;
const SAFE_KEY = /^[a-z_]+$/;
const NAME_KEYS = ["name", "display_name", "title", "label"] as const;

/** `field` comes off the wire: only a plain snake_case word may become a translation key. */
export const fieldLabel = (t: TFunction, field: string) => (SAFE_KEY.test(field) ? t(`ai.proposal.field.${field}`, { defaultValue: field }) : field);

const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);

function formatDate(raw: string, time: boolean, locale: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  try {
    // A bare date is a calendar day, not an instant: read it in UTC so no zone shifts it.
    return time ? d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : d.toLocaleDateString(locale, { dateStyle: "medium", ...(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? { timeZone: "UTC" } : {}) });
  } catch {
    return raw;
  }
}

/**
 * A field value as plain readable text. Values are `unknown` on the wire; an unexpected shape reads as a safe
 * string and never throws. Nothing here is rendered as markdown or html.
 */
export function formatProposalValue(v: unknown, type: string, field: string, t: TFunction, locale: string): string {
  if (v === null || v === undefined || v === "") return t("ai.proposal.empty_value");
  if (Array.isArray(v)) return v.map((x) => formatProposalValue(x, "", "", t, locale)).join(", ");
  if (typeof v === "string") {
    if (type === "date" || type === "datetime") return formatDate(v, type === "datetime", locale);
    if (type === "enum" && (field === "status" || field === "priority") && SAFE_KEY.test(v)) return t(`tasks.${field}_${v}`, { defaultValue: v });
    return clip(v);
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of NAME_KEYS) if (typeof o[k] === "string" && o[k] !== "") return clip(o[k]);
  }
  return t("ai.proposal.unreadable_value");
}
