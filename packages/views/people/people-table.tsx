"use client";

import { useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { PeopleColumnKey } from "@uniwork/core/people/view-store";
import type { Person } from "@uniwork/core/types/people";
import { tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";
import {
  LIST_GRID_BOTTOM_CLEARANCE,
  LIST_GRID_HEADER_HEIGHT,
  ListGrid,
  ListGridBody,
  ListGridCell,
  ListGridHeader,
  ListGridHeaderCell,
  ListGridRow,
} from "@uniwork/ui/components/ui/list-grid";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink, useNavigation } from "../navigation";
import { EdgeFades, useHorizontalOverflow } from "./edge-fades";
import { DeactivatedBadge, RoleBadge, SelfTag } from "./person-badges";
import { PersonAvatar } from "./person-avatar";
import { PeopleRowsSkeleton } from "./people-skeleton";
import { useDepartmentTint } from "./use-department-tint";
import {
  useLoadMoreWhenAtEnd,
  useScrollViewport,
  useWindowedRows,
} from "./use-people-virtualizer";
import { useRemPx } from "./use-rem-px";

/**
 * The dense view: one person a row, one fact a column.
 *
 * Two zones, driven by a container query rather than the viewport so a split
 * pane is accounted for (see `list-grid.tsx`). Below @2xl only name and job
 * title render — the pair somebody scanning a narrow pane actually reads — and
 * the column switches do not apply. At @2xl every enabled column renders and
 * the pane scrolls sideways rather than dropping one silently; a fade on the
 * edge that has more says so, because a clipped column with no cue reads as
 * the end of the table.
 *
 * Only a band of rows is in the DOM at any time, so the table states the
 * directory's row count (as the server counts it, not the rows loaded so far)
 * and each row its own index: a screen reader must not be told the window is
 * the directory.
 *
 * Widths and the row height are in rem, so the table grows with the reader's
 * text size; the windowing converts the row height at that size.
 */

/** The row's `h-12`, in rem. */
const ROW_HEIGHT_REM = 3;

// Sized so name, title and every optional column fit a 1440px window with the
// sidebar open; below that the pane scrolls.
const COLUMN_WIDTHS_REM: Record<PeopleColumnKey, number> = {
  department: 9.5,
  email: 13.25,
  phone: 7.75,
  role: 7,
  status: 7.5,
};

// Fixed tracks: edges 1.25 + 1.25, name min 11.5, title min 8 = 22, plus the
// eight gap-x-3 (0.75rem) gaps between the wide template's nine tracks.
const FIXED_TRACKS_WIDTH_REM = 22 + 8 * 0.75;

// Render/track order: name, title, department, email, phone, role, status.
// MUST be a literal string — Tailwind cannot see an interpolated
// `grid-cols-[...]`, and an interpolated width silently drops the whole
// template, collapsing the grid to one column. Name and title share the
// spare width evenly: names are short, and the title is what was being cut.
const GRID_COLS =
  "grid-cols-[1.25rem_minmax(8.75rem,1.4fr)_minmax(6rem,1fr)_1.25rem] " +
  "@2xl:grid-cols-[1.25rem_minmax(11.5rem,1fr)_minmax(8rem,1fr)_var(--pc-department)_var(--pc-email)_var(--pc-phone)_var(--pc-role)_var(--pc-status)_1.25rem]";

function columnTrackVars(isVisible: (key: PeopleColumnKey) => boolean): CSSProperties {
  const keys = Object.keys(COLUMN_WIDTHS_REM) as PeopleColumnKey[];
  const minWidth =
    FIXED_TRACKS_WIDTH_REM +
    keys.reduce((sum, key) => sum + (isVisible(key) ? COLUMN_WIDTHS_REM[key] : 0), 0);
  const track = (key: PeopleColumnKey) => (isVisible(key) ? `${COLUMN_WIDTHS_REM[key]}rem` : "0px");
  return {
    "--pc-department": track("department"),
    "--pc-email": track("email"),
    "--pc-phone": track("phone"),
    "--pc-role": track("role"),
    "--pc-status": track("status"),
    "--pc-minw": `${minWidth}rem`,
  } as CSSProperties;
}

export function PeopleTable({
  people,
  total,
  hrefFor,
  hiddenColumns,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  people: Person[];
  /** How many people the whole directory (under the current filters) holds. */
  total: number;
  hrefFor: (userId: string) => string;
  hiddenColumns: PeopleColumnKey[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewport = useScrollViewport(scrollRef);
  const remPx = useRemPx();
  const rows = useWindowedRows({
    rowCount: people.length,
    rowHeight: ROW_HEIGHT_REM * remPx,
    scrollRef,
    viewport,
    // The header's height is given in pixels at the default 16px rem.
    scrollMargin: (LIST_GRID_HEADER_HEIGHT * remPx) / 16,
  });
  useLoadMoreWhenAtEnd({
    lastRendered: rows.lastRendered,
    total: people.length,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
  });
  const isVisible = (key: PeopleColumnKey) => !hiddenColumns.includes(key);
  const overflow = useHorizontalOverflow(scrollRef, `${viewport.size.width}|${hiddenColumns.join(",")}`);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="@container min-h-0 flex-1 overflow-auto">
        <ListGrid
          aria-label={t("people.title")}
          aria-rowcount={Math.max(total, people.length) + 1}
          className={`${GRID_COLS} @2xl:min-w-[var(--pc-minw)]`}
          style={columnTrackVars(isVisible)}
        >
          <ListGridHeader aria-rowindex={1}>
            {/* The server returns the directory in name order; saying so lets a
                screen reader know where a name will be. */}
            <ListGridHeaderCell aria-sort="ascending">{t("people.column_name")}</ListGridHeaderCell>
            <ListGridHeaderCell>{t("people.field_title")}</ListGridHeaderCell>
            <OptionalHeaderCell shown={isVisible("department")}>
              {t("people.department")}
            </OptionalHeaderCell>
            <OptionalHeaderCell shown={isVisible("email")}>
              {t("people.column_email")}
            </OptionalHeaderCell>
            <OptionalHeaderCell shown={isVisible("phone")}>
              {t("people.field_phone")}
            </OptionalHeaderCell>
            <OptionalHeaderCell shown={isVisible("role")}>
              {t("people.column_role")}
            </OptionalHeaderCell>
            <OptionalHeaderCell shown={isVisible("status")}>
              {t("people.column_status")}
            </OptionalHeaderCell>
          </ListGridHeader>
          <ListGridBody
            style={{
              paddingTop: rows.paddingTop,
              paddingBottom: rows.paddingBottom + LIST_GRID_BOTTOM_CLEARANCE,
            }}
          >
            {rows.indexes.map((index) => {
              const person = people[index];
              if (!person) return null;
              return (
                <PersonTableRow
                  key={person.user_id}
                  person={person}
                  href={hrefFor(person.user_id)}
                  rowIndex={index + 2}
                  isVisible={isVisible}
                />
              );
            })}
          </ListGridBody>
        </ListGrid>
        {isFetchingNextPage ? <PeopleRowsSkeleton count={3} className="px-5" /> : null}
      </div>
      {/* A cut-off column reads as "scroll for more", not as the table's end. */}
      <EdgeFades overflow={overflow} />
    </div>
  );
}

/**
 * A hidden column still occupies its track, collapsed to zero width, so the
 * header and every row keep counting the same tracks.
 */
function OptionalHeaderCell({ shown, children }: { shown: boolean; children: React.ReactNode }) {
  if (!shown) return <ListGridHeaderCell className="hidden px-0 @2xl:flex" />;
  return <ListGridHeaderCell className="hidden @2xl:flex">{children}</ListGridHeaderCell>;
}

function OptionalCell({ shown, children }: { shown: boolean; children: React.ReactNode }) {
  if (!shown) return <ListGridCell className="hidden px-0 @2xl:flex" />;
  return <ListGridCell className="hidden @2xl:flex">{children}</ListGridCell>;
}

function PersonTableRow({
  person,
  href,
  rowIndex,
  isVisible,
}: {
  person: Person;
  href: string;
  rowIndex: number;
  isVisible: (key: PeopleColumnKey) => boolean;
}) {
  const { t } = useTranslation();
  const { push } = useNavigation();
  const tintFor = useDepartmentTint();
  const deactivated = person.status === "deactivated";
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    // Whole-row navigation is a mouse convenience; the keyboard- and
    // screen-reader-accessible link is the AppLink in the name cell, which is
    // why the row itself is neither focusable nor keyboard-bound.
    <ListGridRow
      aria-rowindex={rowIndex}
      className="cursor-pointer"
      onClick={() => push(href)}
    >
      <ListGridCell className="gap-2">
        <PersonAvatar
          id={person.user_id}
          name={person.display_name}
          avatarUrl={person.avatar_url}
          size="sm"
          deactivated={deactivated}
        />
        <AppLink
          href={href}
          onClick={stop}
          className={cn(
            "min-w-0 truncate text-body font-medium",
            deactivated ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {person.display_name}
        </AppLink>
        {person.is_self ? <SelfTag /> : null}
      </ListGridCell>
      {/* The status column is off by default, so deactivation is said here
          too: it changes what the row means, and must not depend on a column
          the reader may never turn on. It sits in the title cell rather than
          beside the name, where it squeezed the name down to three letters. */}
      <ListGridCell className="gap-1.5 text-caption text-muted-foreground">
        {deactivated ? <DeactivatedBadge /> : null}
        <span className={cn("min-w-0 truncate", !person.title && "italic")}>
          {person.title || t("people.title_missing")}
        </span>
      </ListGridCell>
      <OptionalCell shown={isVisible("department")}>
        {person.department ? (
          <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full bg-current",
                tintForegroundClass[tintFor(person.department.id)],
              )}
            />
            <span className="truncate">{person.department.name}</span>
          </span>
        ) : (
          <EmptyValue />
        )}
      </OptionalCell>
      <OptionalCell shown={isVisible("email")}>
        <a
          href={`mailto:${person.email}`}
          onClick={stop}
          title={person.email}
          className="min-w-0 truncate text-caption text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {person.email}
        </a>
      </OptionalCell>
      <OptionalCell shown={isVisible("phone")}>
        {person.phone ? (
          <a
            href={`tel:${person.phone.replace(/\s+/g, "")}`}
            onClick={stop}
            className="min-w-0 truncate text-caption tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {person.phone}
          </a>
        ) : (
          <EmptyValue />
        )}
      </OptionalCell>
      <OptionalCell shown={isVisible("role")}>
        <RoleBadge role={person.org_role} showMember />
      </OptionalCell>
      <OptionalCell shown={isVisible("status")}>
        {deactivated ? (
          <DeactivatedBadge />
        ) : (
          <span className="text-caption text-muted-foreground">{t("people.status_active")}</span>
        )}
      </OptionalCell>
    </ListGridRow>
  );
}

/** A blank that is visibly blank, not a stray dash competing with real values. */
function EmptyValue() {
  const { t } = useTranslation();
  return (
    <span className="text-caption text-muted-foreground">
      <span aria-hidden="true">–</span>
      <span className="sr-only">{t("people.value_missing")}</span>
    </span>
  );
}
