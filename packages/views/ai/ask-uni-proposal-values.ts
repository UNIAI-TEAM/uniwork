import type { useTranslation } from "react-i18next";
import { apiErrorMessage, errorCode } from "@uniwork/core/api/http";
import type { AiProposal } from "@uniwork/core/types";

type TFunction = ReturnType<typeof useTranslation>["t"];

const MAX_TEXT = 200;
const SAFE_KEY = /^[a-z_]+$/;
const NAME_KEYS = ["name", "display_name", "title", "label"] as const;

/** `field` comes off the wire: only a plain snake_case word may become a translation key. */
export const fieldLabel = (t: TFunction, field: string) => (SAFE_KEY.test(field) ? t(`ai.proposal.field.${field}`, { defaultValue: field }) : field);

const STATUS_CODE = /^[A-Za-z_]+$/;

// Task, project and meeting each have a status vocabulary of their own; the tool says which one a value belongs to.
function statusLabel(v: string, tool: string, t: TFunction): string {
  if (!STATUS_CODE.test(v)) return v;
  if (tool.includes("meeting")) return t(`meetings.status_${v}`, { defaultValue: v });
  if (tool.includes("project")) return t(`projects.status.${v}`, { defaultValue: v });
  return t(`tasks.status_${v}`, { defaultValue: v });
}

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
export function formatProposalValue(v: unknown, type: string, field: string, t: TFunction, locale: string, tool = ""): string {
  if (v === null || v === undefined || v === "") return t("ai.proposal.empty_value");
  if (Array.isArray(v)) return v.map((x) => formatProposalValue(x, "", "", t, locale, tool)).join(", ");
  if (typeof v === "string") {
    if (type === "date" || type === "datetime") return formatDate(v, type === "datetime", locale);
    if (type === "enum" && field === "priority" && SAFE_KEY.test(v)) return t(`tasks.priority_${v}`, { defaultValue: v });
    if (type === "enum" && field === "status") return statusLabel(v, tool, t);
    if (type === "enum" && field === "mode" && SAFE_KEY.test(v)) return t(`ai.proposal.content_mode.${v}`, { defaultValue: v });
    if (type === "enum" && (field === "visibility" || field === "location") && SAFE_KEY.test(v)) return t(`ai.proposal.${field}.${v}`, { defaultValue: v });
    if (type === "enum" && field === "format") return v.toUpperCase();
    return clip(v);
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of NAME_KEYS) if (typeof o[k] === "string" && o[k] !== "") return clip(o[k]);
  }
  return t("ai.proposal.unreadable_value");
}

export type EditKind = "text" | "markdown" | "date" | "datetime" | "enum" | "object";

/**
 * The control "Sửa" gives a field, or null when it stays read-only. A field is editable only when its key is an
 * argument of the tool and its value is one we can send as that argument's machine value: labels (the preview holds
 * names), `*_id` text (a title standing for an id), lists of people (the picker takes one), and the status of a
 * task or meeting (its options are workspace labels, not status keys) are shown but not edited.
 */
export function editKind(f: AiProposal["preview"]["fields"][number], tool: string): EditKind | null {
  if (f.field.endsWith("_ids") || (f.type === "text" && f.field.endsWith("_id"))) return null;
  switch (f.type) {
    case "text":
    case "markdown":
      return typeof f.to === "string" ? f.type : null;
    case "date":
    case "datetime":
      return f.type;
    case "enum":
      return (f.field === "status" && !tool.includes("project")) || f.options.length === 0 ? null : "enum";
    case "person":
    case "project":
      return Array.isArray(f.to) ? null : "object";
    default:
      return null;
  }
}

/** The tool argument `preview.body` stands for: a page's content, a cancellation's reason, else the text it posts. */
export const bodyArg = (tool: string) =>
  tool === "create_document" || tool === "update_document" ? "content" : tool === "cancel_meeting" ? "reason" : tool === "create_office_document" ? "outline" : "body";

/** The Apply button's label key: a new Office file opens at once, a saved template says where it went. */
export const applyLabelKey = (tool: string) =>
  tool === "create_office_document" ? "ai.proposal.apply_create_open" : tool === "save_attachment_template" ? "ai.proposal.apply_save_template" : "ai.proposal.apply";

/** The body "Sửa" may change: not one the server cut to fit the card, or saving it would cut the page. */
export const bodyEditable = (p: AiProposal) => p.preview.body !== "" && !p.preview.body_truncated;

/** The body the generic "Sửa" form edits: an outline has its own dialog (rich editor), so it is not in the form. */
export const bodyInForm = (p: AiProposal) => bodyEditable(p) && bodyArg(p.tool) !== "outline";

/** Whether "Sửa" has anything to open: an editable field, or the whole text the row will post. */
export const hasEditable = (p: AiProposal) => bodyInForm(p) || p.preview.fields.some((f) => editKind(f, p.tool) !== null);

/**
 * How a refused edit reads. The server words an `invalid_args` refusal in English, for the model: it only names which
 * of `keys` is wrong (`field`, "" when none), the text is ours.
 */
export function editRefusal(err: unknown, keys: string[], t: TFunction): { field: string; text: string } {
  const code = errorCode(err) ?? "";
  const message = apiErrorMessage(err) ?? "";
  const field = keys.find((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(message)) ?? "";
  const known = code !== "invalid_args" && SAFE_KEY.test(code) ? t(`ai.proposal.error.${code}`, { defaultValue: "" }) : "";
  const invalid = field ? t("ai.proposal.edit_invalid_field", { field: fieldLabel(t, field) }) : t("ai.proposal.edit_invalid");
  return { field, text: code === "invalid_args" ? invalid : known || t("ai.proposal.generic_error") };
}
