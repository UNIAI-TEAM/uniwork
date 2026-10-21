"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Member } from "@uniwork/core/types/workspace";
import { cn } from "@uniwork/ui/lib/utils";
import { DocPersonCell } from "./cells";
import type { DocListScreenColumnId } from "./columns";
import { EMPTY_CELL, formatListDate } from "./format";
import { daysLeft } from "./groups";
import type { DocListRowFields } from "./row-fields";

// The screen column slot of the live list: one renderer per screen column
// (contract UNI-2045 §"Cột đặc trưng"), fed by the row's optional fields
// (row-fields.ts). A renderer draws the table cell and the text the narrow
// row stacks under Name when the column is off; without its field it answers
// null and the cell writes "—" (today's server sends none of SV-1..SV-4).

/** A workspace member by user id: their name and avatar, "former" when the
 *  loaded member list does not hold them, null while that list still loads. */
export type DocListMemberLookup = (userId: string) => { name: string; avatarUrl: string | null } | "former" | null;

/** The lookup over the workspace member list; until the list answers every id is "still loading". */
export function docMemberLookup(members: readonly Member[] | undefined): DocListMemberLookup {
  const byId = new Map((members ?? []).map((m) => [m.user_id, m]));
  return (userId) => {
    if (!members) return null;
    const found = byId.get(userId);
    if (!found) return "former";
    return { name: found.display_name, avatarUrl: typeof found.avatar_url === "string" ? found.avatar_url : null };
  };
}

interface ScreenCellContext {
  now: Date;
  locale: string;
  /** `documents.list.date.yesterday` in the open locale. */
  yesterday: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  member?: DocListMemberLookup;
}

const SUB_LINE = "font-mono text-caption tabular-nums";

/** At or under this many days left the trash countdown turns red (as the "Sắp xóa vĩnh viễn" group). */
const URGENT_DAYS = 7;

interface ScreenCellRenderer {
  /** The table cell's content, or null when the row has nothing for it. */
  cell: (fields: DocListRowFields, ctx: ScreenCellContext) => ReactNode;
  /** The same content as one line of text for the narrow row, or null. */
  line: (fields: DocListRowFields, ctx: ScreenCellContext) => string | null;
  /** The narrow row's line as parts the row lays out itself (Thùng rác, whose line wraps); answers null like `line`. */
  lineParts?: (fields: DocListRowFields, ctx: ScreenCellContext) => ReactNode;
}

const date = (at: string | null | undefined, ctx: ScreenCellContext): string | null => {
  const value = formatListDate(at, ctx.now, ctx.locale, { yesterday: ctx.yesterday });
  return value === EMPTY_CELL ? null : value;
};

/** A main line over the muted 12px sub line (a date unless `words`); null when both are empty. */
function twoLines(main: ReactNode, sub: string | null | undefined, opts: { words?: boolean } = {}): ReactNode {
  if (!main && !sub) return null;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {main}
      {sub ? <span className={cn("truncate text-muted-foreground", opts.words ? "text-caption" : SUB_LINE)}>{sub}</span> : null}
    </span>
  );
}

/** The narrow row's line: the parts that have a value, joined by " · ". */
const joinLine = (parts: readonly (string | null | undefined)[]): string | null => {
  const line = parts.filter((part): part is string => Boolean(part));
  return line.length > 0 ? line.join(" · ") : null;
};

const MAIN_TEXT = "truncate text-body text-foreground";

/** Recent's dot colour per activity; a kind this client does not know has no dot and no words. */
const ACTIVITY_DOT: Record<string, string> = { edited: "bg-primary", opened: "bg-success", commented: "bg-warning" };

function activityWords(fields: DocListRowFields, ctx: ScreenCellContext): { kind: string; text: string } | null {
  const kind = fields.lastActivity?.kind;
  switch (kind) {
    case "edited":
    case "opened":
    case "commented":
      return { kind, text: ctx.t(`documents.list.activity.${kind}`) };
    default:
      return null;
  }
}

/** "3 người · 1 workspace · 1 link", the zero parts left out; null when every count is zero. */
function shareSummaryText(fields: DocListRowFields, ctx: ScreenCellContext): string | null {
  const summary = fields.shareSummary;
  if (!summary) return null;
  const parts = [
    summary.people > 0 ? ctx.t("documents.list.share_summary.people", { count: summary.people }) : null,
    summary.workspaces > 0 ? ctx.t("documents.list.share_summary.workspaces", { count: summary.workspaces }) : null,
    summary.links > 0 ? ctx.t("documents.list.share_summary.links", { count: summary.links }) : null,
  ];
  return joinLine(parts);
}

/** A member's photo by id; the name always comes from the server's own field. */
function memberAvatar(userId: string, ctx: ScreenCellContext): string | null {
  const found = ctx.member?.(userId) ?? null;
  return found && found !== "former" ? found.avatarUrl : null;
}

/** Who did it: a member's name and avatar, `formerKey` for an id the member
 *  list does not hold, `systemKey` (or nothing) for a null id, nothing while
 *  the list loads. */
function actor(
  by: string | null,
  ctx: ScreenCellContext,
  keys: { former: string; system?: string },
): { name: string; avatarUrl: string | null } | null {
  if (!by) return keys.system ? { name: ctx.t(keys.system), avatarUrl: null } : null;
  const found = ctx.member?.(by) ?? null;
  if (found === "former") return { name: ctx.t(keys.former), avatarUrl: null };
  return found;
}

const DELETED_BY = { former: "documents.trash.deleted_by_unknown" };
const SHELVED_BY = { former: "documents.shelved_list.shelved_by_former", system: "documents.shelved_list.shelved_by_system" };

/** The trash countdown: "Còn N ngày", red at 7 days or fewer; null without a purge date. */
function purgeLeft(fields: DocListRowFields, ctx: ScreenCellContext): { text: string; urgent: boolean } | null {
  const days = daysLeft(fields.trashed?.purgeAfter, ctx.now);
  return days === null ? null : { text: ctx.t("documents.list.days_left", { count: days }), urgent: days <= URGENT_DAYS };
}

/** The screen columns of the seven screens (contract UNI-2045 §"Cột đặc trưng"). */
const SCREEN_CELLS: Partial<Record<DocListScreenColumnId, ScreenCellRenderer>> = {
  // Gần đây: dot + "Bạn đã sửa|mở|bình luận" · date.
  activity: {
    cell: (fields, ctx) => {
      if (!fields.lastActivity) return null;
      const words = activityWords(fields, ctx);
      return twoLines(
        words ? (
          <span className="flex min-w-0 items-center gap-1.5 text-body text-foreground">
            <span aria-hidden data-activity-kind={words.kind} className={cn("size-2 shrink-0 rounded-full", ACTIVITY_DOT[words.kind])} />
            <span className="truncate">{words.text}</span>
          </span>
        ) : null,
        date(fields.lastActivity.at, ctx),
      );
    },
    line: (fields, ctx) => (fields.lastActivity ? joinLine([activityWords(fields, ctx)?.text, date(fields.lastActivity.at, ctx)]) : null),
  },
  // Có gắn sao: date · "Bạn gắn sao".
  starred: {
    cell: (fields, ctx) => {
      const at = date(fields.favoritedAt, ctx);
      if (!at) return null;
      return twoLines(<span className={cn("text-foreground", SUB_LINE)}>{at}</span>, ctx.t("documents.list.starred_by_you"), { words: true });
    },
    line: (fields, ctx) => {
      const at = date(fields.favoritedAt, ctx);
      return at ? joinLine([at, ctx.t("documents.list.starred_by_you")]) : null;
    },
  },
  // Được chia sẻ với tôi: avatar + who shared · date; a name the server withholds reads "—".
  shared: {
    cell: (fields, ctx) => {
      if (!fields.shared) return null;
      return twoLines(
        <DocPersonCell name={fields.shared.byName} avatarUrl={memberAvatar(fields.shared.by, ctx)} kind={fields.shared.byKind} />,
        date(fields.shared.at, ctx),
      );
    },
    line: (fields, ctx) => (fields.shared ? joinLine([fields.shared.byName ?? EMPTY_CELL, date(fields.shared.at, ctx)]) : null),
  },
  // Tôi đã chia sẻ: "3 người · 1 workspace · 1 link" · the latest share's date.
  shared_with: {
    cell: (fields, ctx) => {
      if (!fields.shareSummary) return null;
      const text = shareSummaryText(fields, ctx);
      return twoLines(text ? <span className={MAIN_TEXT}>{text}</span> : null, date(fields.shareSummary.latestAt, ctx));
    },
    line: (fields, ctx) => (fields.shareSummary ? joinLine([shareSummaryText(fields, ctx), date(fields.shareSummary.latestAt, ctx)]) : null),
  },
  // Thùng rác: who deleted, then the date, then "Còn N ngày" (each on its own line).
  deleted: {
    cell: (fields, ctx) => {
      if (!fields.trashed) return null;
      const who = actor(fields.trashed.by, ctx, DELETED_BY);
      const at = date(fields.trashed.at, ctx);
      const left = purgeLeft(fields, ctx);
      return (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-body text-foreground">{who?.name ?? EMPTY_CELL}</span>
          {/* Two lines, not "date · Còn N ngày" in one: the column is 118px and the countdown is the part that must stay whole. */}
          {at || left ? (
            <span className="flex min-w-0 flex-col gap-0.5">
              {at ? <span className={cn("truncate text-muted-foreground", SUB_LINE)}>{at}</span> : null}
              {left ? <span className={cn("truncate", SUB_LINE, left.urgent ? "text-destructive" : "text-muted-foreground")}>{left.text}</span> : null}
            </span>
          ) : null}
        </span>
      );
    },
    line: (fields, ctx) => {
      if (!fields.trashed) return null;
      const parts = [actor(fields.trashed.by, ctx, DELETED_BY)?.name, date(fields.trashed.at, ctx), purgeLeft(fields, ctx)?.text];
      const line = parts.filter((part): part is string => Boolean(part));
      return line.length > 0 ? line.join(" · ") : null;
    },
    // who · date on one row (the name truncates, the date stays whole) and the countdown on its own row: a separator
    // sits only between two parts that are both on its row, so a wrap can never strand one at a line end (N5).
    lineParts: (fields, ctx) => {
      if (!fields.trashed) return null;
      const who = actor(fields.trashed.by, ctx, DELETED_BY)?.name;
      const at = date(fields.trashed.at, ctx);
      const left = purgeLeft(fields, ctx)?.text;
      if (!who && !at && !left) return null;
      return (
        <>
          {who || at ? (
            <span className="flex min-w-0 items-baseline gap-x-1.5">
              {who ? <span className="min-w-0 truncate">{who}</span> : null}
              {who && at ? <span aria-hidden className="shrink-0">·</span> : null}
              {at ? <span className="shrink-0 whitespace-nowrap">{at}</span> : null}
            </span>
          ) : null}
          {left ? <span className="block">{left}</span> : null}
        </>
      );
    },
  },
  // Lưu trữ: avatar + who shelved · date.
  shelved: {
    cell: (fields, ctx) => {
      if (!fields.shelved) return null;
      const who = actor(fields.shelved.by, ctx, SHELVED_BY);
      const at = date(fields.shelved.at, ctx);
      return (
        <span className="flex min-w-0 flex-col gap-0.5">
          <DocPersonCell name={who?.name} avatarUrl={who?.avatarUrl} kind={fields.shelved.by ? undefined : "system"} />
          {at ? <span className={cn("text-muted-foreground", SUB_LINE)}>{at}</span> : null}
        </span>
      );
    },
    line: (fields, ctx) => {
      if (!fields.shelved) return null;
      const parts = [actor(fields.shelved.by, ctx, SHELVED_BY)?.name, date(fields.shelved.at, ctx)];
      const line = parts.filter((part): part is string => Boolean(part));
      return line.length > 0 ? line.join(" · ") : null;
    },
  },
};

function useScreenCellContext(member?: DocListMemberLookup): ScreenCellContext {
  const { t, i18n } = useTranslation();
  return { now: new Date(), locale: i18n.language, yesterday: t("documents.list.date.yesterday"), t, member };
}

interface ScreenCellProps {
  column: DocListScreenColumnId;
  fields: DocListRowFields;
  /** Names the person of the Đã xóa and Lưu trữ columns. */
  member?: DocListMemberLookup;
}

/** The screen column cell's content: the renderer's answer, or "—". */
export function DocScreenCell({ column, fields, member }: ScreenCellProps) {
  const ctx = useScreenCellContext(member);
  const content = SCREEN_CELLS[column]?.cell(fields, ctx) ?? null;
  return content ?? <span className="text-muted-foreground">{EMPTY_CELL}</span>;
}

/** The narrow row's screen line under Name; nothing when the row has no value for the column. */
export function DocScreenLine({ column, fields, member, className }: ScreenCellProps & { className?: string }) {
  const ctx = useScreenCellContext(member);
  const renderer = SCREEN_CELLS[column];
  const parts = renderer?.lineParts?.(fields, ctx) ?? null;
  if (parts) {
    // Thùng rác: its line is the longest (who · date and Còn N ngày), so it keeps the countdown whole on a row of its own.
    return (
      <span data-doclist-screen-line className={cn("block text-caption text-muted-foreground", className)}>
        {parts}
      </span>
    );
  }
  const line = renderer?.line(fields, ctx) ?? null;
  if (!line) return null;
  return (
    <span data-doclist-screen-line className={cn("block truncate text-caption text-muted-foreground", className)}>
      {line}
    </span>
  );
}
