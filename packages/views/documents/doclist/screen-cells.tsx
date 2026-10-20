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
// null and the cell writes "—". The words of each column ("Bạn đã mở",
// "3 người · 1 link", ...) belong to W4-W7, which replace their own entry.

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

/** At or under this many days left the trash countdown turns red (as the "Sắp xóa vĩnh viễn" group). */
const URGENT_DAYS = 7;

interface ScreenCellRenderer {
  /** The table cell's content, or null when the row has nothing for it. */
  cell: (fields: DocListRowFields, ctx: ScreenCellContext) => ReactNode;
  /** The same content as one line of text for the narrow row, or null. */
  line: (fields: DocListRowFields, ctx: ScreenCellContext) => string | null;
}

const date = (at: string | null | undefined, ctx: ScreenCellContext): string | null => {
  const value = formatListDate(at, ctx.now, ctx.locale, { yesterday: ctx.yesterday });
  return value === EMPTY_CELL ? null : value;
};

const dateCell = (at: (fields: DocListRowFields) => string | null | undefined): ScreenCellRenderer => ({
  cell: (fields, ctx) => {
    const value = date(at(fields), ctx);
    return value ? <span className="font-mono text-caption tabular-nums text-foreground">{value}</span> : null;
  },
  line: (fields, ctx) => date(at(fields), ctx),
});

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

const SUB_LINE = "font-mono text-caption tabular-nums";

/** The screen columns of the seven screens; W4-W7 replace the four date-only ones with their own words. */
const SCREEN_CELLS: Partial<Record<DocListScreenColumnId, ScreenCellRenderer>> = {
  activity: dateCell((fields) => fields.lastActivity?.at),
  starred: dateCell((fields) => fields.favoritedAt),
  shared: {
    cell: (fields, ctx) => {
      if (!fields.shared) return null;
      const at = date(fields.shared.at, ctx);
      return (
        <span className="flex min-w-0 flex-col gap-0.5">
          <DocPersonCell name={fields.shared.byName} kind={fields.shared.byKind} />
          {at ? <span className="font-mono text-caption tabular-nums text-muted-foreground">{at}</span> : null}
        </span>
      );
    },
    line: (fields, ctx) => {
      if (!fields.shared) return null;
      const parts = [fields.shared.byName, date(fields.shared.at, ctx)].filter((part): part is string => Boolean(part));
      return parts.length > 0 ? parts.join(" · ") : null;
    },
  },
  shared_with: dateCell((fields) => fields.shareSummary?.latestAt),
  // Thùng rác: who deleted · (date · "Còn N ngày").
  deleted: {
    cell: (fields, ctx) => {
      if (!fields.trashed) return null;
      const who = actor(fields.trashed.by, ctx, DELETED_BY);
      const at = date(fields.trashed.at, ctx);
      const left = purgeLeft(fields, ctx);
      return (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-body text-foreground">{who?.name ?? EMPTY_CELL}</span>
          {at || left ? (
            <span className={cn("flex min-w-0 items-center gap-1 text-muted-foreground", SUB_LINE)}>
              {at ? <span className="shrink-0">{at}</span> : null}
              {at && left ? <span aria-hidden>·</span> : null}
              {left ? <span className={cn("truncate", left.urgent && "text-destructive")}>{left.text}</span> : null}
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
  const line = SCREEN_CELLS[column]?.line(fields, ctx) ?? null;
  if (!line) return null;
  return (
    <span data-doclist-screen-line className={cn("block truncate text-caption text-muted-foreground", className)}>
      {line}
    </span>
  );
}
