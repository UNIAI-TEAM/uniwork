"use client";

import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Notification, TaskStatus } from "@uniwork/core/types";
import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { STATUS_CONFIG } from "../tasks/modes/status-config";
import { documentChangedTitleKey, documentChangedTitleParams, isDocumentChanged } from "./document-changed";
import { isPurgeDate, purgeDate } from "./trashed-notice";

/** The share levels the client words; any other value (a newer server) reads level-less. */
const SHARE_LEVELS: ReadonlySet<string> = new Set(["view", "comment", "edit", "manage"]);

/**
 * The number of documents a folder share rolled up (`params.count`, a decimal
 * string): set on a folder's grouped `document_shared` row, absent on a single
 * document's. Anything but a positive integer reads as the single sentence,
 * never "NaN" or "0 documents".
 */
export function folderShareCount(n: Notification): number | null {
  if (n.kind !== "document_shared") return null;
  const raw = n.params.count?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return null;
  const count = Number(raw);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

/** Brackets each param in the rendered sentence so it can be found again. */
const MARK = "⁣";

type Part = { text: string } | { param: string; value: string };

/**
 * Splits the sentence `t(title_key, params)` renders into its literal text
 * and the params it placed, in the order the locale put them. The sentence
 * itself stays owned by the locale file (and pinned to the server's
 * titles.go), so word order in Vietnamese and English never has to agree.
 */
export function titleParts(render: (params: Record<string, string>) => string, params: Record<string, string>): Part[] {
  const marked = Object.fromEntries(Object.keys(params).map((k) => [k, `${MARK}${k}${MARK}`]));
  const pieces = render(marked).split(MARK);
  return pieces
    .map((piece, i): Part | null => {
      if (i % 2 === 0) return piece ? { text: piece } : null;
      return piece in params ? { param: piece, value: params[piece] ?? "" } : { text: piece };
    })
    .filter((p): p is Part => p !== null);
}

/**
 * The locale key of the row's sentence. A document comment or break-glass row
 * whose title snapshot is gone (the server drops it once the reader lost
 * access) uses the title-less variant of the sentence, so it never quotes an
 * empty name or a bare `{{document}}`. An edit-request answer has two
 * sentences: a decline reads "still editing", not "handed you editing"
 * (UNI-1645, server titles.go). The edit-lock kinds always carry the name, so
 * they have no title-less variant. A document_shared row whose level is
 * missing or not one the client words reads without the level clause
 * (`_nolevel`), never "Quyền: ." and never the raw enum.
 */
export function notificationTitleKey(n: Notification): string {
  // One kind, ten verbs and three shapes: the client words it from the row's facts (document-changed.ts).
  if (isDocumentChanged(n)) return documentChangedTitleKey(n);
  if (n.kind === "document_edit_request_answered" && n.params.decision === "decline") {
    return "notifications.kind.document_edit_request_answered_declined";
  }
  // The requester was never allowed to read the title, so a declined request's
  // sentence has no document to drop (access addendum §3.4).
  if (n.kind === "document_access_declined") return n.title_key;
  // A bulk transfer row names the source member; once the name is gone the sentence reads "a member's".
  if (n.kind === "document_owners_bulk_transferred" && !n.params.name?.trim()) return `${n.title_key}_untitled`;
  // A batch not from one meeting (or a row from before the meeting param)
  // reads without it, never `cuộc họp ""` (server titles.go).
  if (n.kind === "tasks_assigned" && !n.params.meeting?.trim()) return `${n.title_key}_nomeeting`;
  // Finalized minutes have their own sentence (server titles.go recapMinutesTitleKey).
  if (n.kind === "meeting_recap_ready" && n.params.stage === "minutes") return `${n.title_key}_minutes`;
  if (n.kind === "meeting_task_due" && n.params.stage === "overdue") return `${n.title_key}_overdue`;
  const untitled = n.resource_type === "document" && n.title_key.startsWith("notifications.kind.document_") && !n.kind.startsWith("document_edit_");
  // A folder's grouped share has its own sentence (count documents in the folder); the same fallbacks apply.
  const base = folderShareCount(n) === null ? n.title_key : `${n.title_key}_folder`;
  const key = untitled && !n.params.document?.trim() ? `${base}_untitled` : base;
  if (n.kind === "document_shared" && !SHARE_LEVELS.has(n.params.level ?? "")) return `${key}_nolevel`;
  // A trash notice whose purge date cannot be read says no deadline rather than "before ".
  return n.kind === "document_trashed_by_other" && !isPurgeDate(n.params.date ?? "") ? `${key}_nodate` : key;
}

/**
 * The row's sentence with the parts a scan looks for picked out: who did it
 * (and, for an agent, that it was one — ADR 0007: the label comes from the
 * actor's kind, never from the name), what it happened to, and the state it
 * reached. A status arrives as its catalogue key and a role as its enum; both
 * are shown in the reader's language, the status on its own tint so "moved
 * to In review" reads at a glance.
 */
export function NotificationTitle({ notification: n, unread }: { notification: Notification; unread: boolean }) {
  const { t, i18n } = useTranslation();
  // The share count picks the plural form, so it goes in as a number, never as a marked part.
  const folderCount = folderShareCount(n);
  const countOption = folderCount === null ? {} : { count: folderCount };
  const shareParams = Object.fromEntries(Object.entries(n.params).filter(([k]) => k !== "count"));
  const titleParams = isDocumentChanged(n) ? documentChangedTitleParams(n) : n.kind === "document_shared" ? shareParams : n.params;
  const parts = titleParts(
    (params) => t(notificationTitleKey(n), { ...params, ...countOption, defaultValue: n.kind }),
    titleParams,
  );
  const isAgent = n.actor_kind === "agent";

  const render = (param: string, value: string): ReactNode => {
    switch (param) {
      case "actor":
        return (
          <>
            <span className={cn("text-foreground", unread ? "font-semibold" : "font-medium")}>{value}</span>
            {isAgent ? " " : null}
            {isAgent ? (
              <span className="inline-flex -translate-y-px items-center rounded-sm bg-brand-subtle px-1 text-micro leading-4 font-semibold text-brand-subtle-foreground align-middle">
                {t("people.agent_badge")}
              </span>
            ) : null}
          </>
        );
      case "task":
      case "meeting":
      case "workspace":
      case "document":
        return <span className="font-medium text-foreground">{value}</span>;
      case "status": {
        const cfg = STATUS_CONFIG[value as TaskStatus];
        return (
          <span
            className={cn(
              "inline-flex -translate-y-px items-center rounded-sm px-1.5 text-caption leading-5 font-medium align-middle",
              cfg ? tintClass[cfg.tone] : "bg-muted text-foreground",
            )}
          >
            {t(`tasks.status_${value}`, { defaultValue: value })}
          </span>
        );
      }
      case "date":
        return <span className="font-medium text-foreground">{purgeDate(value, i18n.language)}</span>;
      case "role":
        return <span className="font-medium text-foreground">{t(`people.role_${value}`, { defaultValue: value })}</span>;
      case "level":
        return (
          <span className="font-medium text-foreground">
            {SHARE_LEVELS.has(value) ? t(`documents.share.level_${value}`) : ""}
          </span>
        );
      default:
        return value;
    }
  };

  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{"text" in p ? p.text : render(p.param, p.value)}</Fragment>
      ))}
    </>
  );
}
