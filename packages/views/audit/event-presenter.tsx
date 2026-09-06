"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ArrowRight,
  Bot,
  Cog,
  FileDown,
  KeyRound,
  LogIn,
  MessageSquare,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  User,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import type { AuditEvent } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { relativeTime } from "../notifications/relative-time";

/**
 * Turns a stored audit row into something a person reads: a verb glyph with a
 * tone, a translated action and resource, a diff a reader can scan. Shared by
 * the organization log and the per-resource activity so both tell the same
 * story with the same words.
 */

type Tone = "default" | "success" | "destructive" | "warning";

const VERB_ICONS: [RegExp, LucideIcon, Tone][] = [
  [/login_failed$/, ShieldAlert, "destructive"],
  [/(deleted|removed|revoked)$/, Trash2, "destructive"],
  [/(created|added|joined|invited)$/, Plus, "success"],
  [/login_succeeded$/, LogIn, "default"],
  [/password_/, KeyRound, "warning"],
  [/export_requested$/, FileDown, "default"],
  [/comment_added$/, MessageSquare, "default"],
  [/^webhook\./, Webhook, "default"],
  [/(updated|changed|set)$/, Pencil, "default"],
];

const TONE_CLASS: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
};

/** One glyph per verb; an action from a newer server gets the generic pulse. */
export function ActionIcon({ action, className }: { action: string; className?: string }) {
  const hit = VERB_ICONS.find(([re]) => re.test(action));
  const Icon = hit?.[1] ?? Activity;
  const tone = hit?.[2] ?? "default";
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full",
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

const ACTOR_ICONS: Record<string, LucideIcon> = { human: User, agent: Bot, system: Cog };

export function ActorIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = ACTOR_ICONS[kind] ?? User;
  return <Icon aria-hidden className={className} />;
}

/** Translated action / resource names; the raw token is the fallback so nothing goes blank. */
export function useAuditLabels() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  return {
    action: (action: string) => t(`actions.${action}`, { defaultValue: action }),
    resource: (type: string) => t(`resources.${type}`, { defaultValue: type }),
    actorKind: (kind: string) => t(`actor_kind.${kind}`, { defaultValue: t("actor_kind.unknown") }),
  };
}

/** "5 phút trước" up front, the exact instant on hover and for assistive tech. */
export function EventTime({ iso, className }: { iso: string; className?: string }) {
  const { i18n } = useTranslation();
  const date = new Date(iso);
  const absolute = Number.isNaN(date.getTime()) ? iso : date.toLocaleString(i18n.language);
  return (
    <time dateTime={iso} title={absolute} className={className}>
      {relativeTime(iso, i18n.language) || absolute}
    </time>
  );
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** A change entry as the server writes it: only the fields that moved. */
interface ChangeEntry {
  from?: unknown;
  to?: unknown;
}

function isChangeEntry(value: unknown): value is ChangeEntry {
  return typeof value === "object" && value !== null && ("from" in value || "to" in value);
}

function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "";
}

export function changeEntries(event: Pick<AuditEvent, "changes">): [string, ChangeEntry][] {
  return Object.entries(event.changes ?? {}).map(([field, raw]) => [
    field,
    isChangeEntry(raw) ? raw : { to: raw },
  ]);
}

/**
 * A stored value for a reader. `null` is a real value in this log — it is how
 * "the field was cleared" is recorded — so it gets a word rather than an empty
 * cell that reads as a rendering bug.
 */
/** `full` keeps ids whole — the detail sheet is where a reader copies them. */
export function ChangeValue({ value, className, full }: { value: unknown; className?: string; full?: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit.detail" });
  if (value === null || value === undefined || value === "") {
    return <span className={cn("text-muted-foreground italic", className)}>{t("empty")}</span>;
  }
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  // An id is a reference, not a word: show enough to tell two apart.
  const shown = full ? text : ULID.test(text) ? shortId(text) : text.length > 32 ? `${text.slice(0, 32)}…` : text;
  return (
    <span className={cn(full ? "break-all" : "truncate", className)} title={shown === text ? undefined : text}>
      {shown}
    </span>
  );
}

/**
 * The diff in one line: `status: todo → done`, at most `max` fields, then a
 * "+N" so a row never grows taller than its neighbours.
 */
export function ChangeSummary({
  event,
  max = 2,
  empty,
}: {
  event: Pick<AuditEvent, "changes">;
  max?: number;
  empty: ReactNode;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit.table" });
  const entries = changeEntries(event);
  if (entries.length === 0) return <span className="text-muted-foreground">{empty}</span>;
  const shown = entries.slice(0, max);
  const rest = entries.length - shown.length;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {shown.map(([field, change]) => (
        <span key={field} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-caption whitespace-nowrap">
          <span className="font-medium">{field}</span>
          {hasValue(change.from) ? (
            <>
              <ChangeValue value={change.from} className="text-muted-foreground line-through" />
              <ArrowRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            </>
          ) : null}
          <ChangeValue value={change.to} />
        </span>
      ))}
      {rest > 0 ? <span className="text-caption text-muted-foreground">{t("more_fields", { count: rest })}</span> : null}
    </span>
  );
}

/** Enough of a ULID to tell two apart, never the whole thing in a table cell. */
export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
