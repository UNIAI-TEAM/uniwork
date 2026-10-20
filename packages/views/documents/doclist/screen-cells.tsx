"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { DocPersonCell } from "./cells";
import type { DocListScreenColumnId } from "./columns";
import { EMPTY_CELL, formatListDate } from "./format";
import type { DocListRowFields } from "./row-fields";

// The screen column slot of the live list: one renderer per screen column
// (contract UNI-2045 §"Cột đặc trưng"), fed by the row's optional fields
// (row-fields.ts). A renderer draws the table cell and the text the narrow
// row stacks under Name when the column is off; without its field it answers
// null and the cell writes "—". The words of each column ("Bạn đã mở",
// "3 người · 1 link", ...) belong to W4-W7, which replace their own entry.

interface ScreenCellContext {
  now: Date;
  locale: string;
  /** `documents.list.date.yesterday` in the open locale. */
  yesterday: string;
}

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

/** The screen columns of the five live screens; Lưu trữ and Thùng rác bring theirs with W2/W3. */
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
};

function useScreenCellContext(): ScreenCellContext {
  const { t, i18n } = useTranslation();
  return { now: new Date(), locale: i18n.language, yesterday: t("documents.list.date.yesterday") };
}

/** The screen column cell's content: the renderer's answer, or "—". */
export function DocScreenCell({ column, fields }: { column: DocListScreenColumnId; fields: DocListRowFields }) {
  const ctx = useScreenCellContext();
  const content = SCREEN_CELLS[column]?.cell(fields, ctx) ?? null;
  return content ?? <span className="text-muted-foreground">{EMPTY_CELL}</span>;
}

/** The narrow row's screen line under Name; nothing when the row has no value for the column. */
export function DocScreenLine({ column, fields, className }: { column: DocListScreenColumnId; fields: DocListRowFields; className?: string }) {
  const ctx = useScreenCellContext();
  const line = SCREEN_CELLS[column]?.line(fields, ctx) ?? null;
  if (!line) return null;
  return (
    <span data-doclist-screen-line className={cn("block truncate text-caption text-muted-foreground", className)}>
      {line}
    </span>
  );
}
