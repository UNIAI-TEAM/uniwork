"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
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
import { DeactivatedBadge, RoleBadge, SelfTag } from "./person-badges";
import { PersonAvatar } from "./person-avatar";
import { PeopleRowsSkeleton } from "./people-skeleton";
import { useDepartmentTint } from "./use-department-tint";
import {
  useLoadMoreWhenAtEnd,
  useScrollViewport,
  useWindowedRows,
} from "./use-people-virtualizer";

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
 * Only a band of rows is in the DOM at any time, so the table states its true
 * row count and each row its own index: a screen reader must not be told the
 * window is the directory.
 */

const ROW_HEIGHT = 48;

// Sized so name, title and every optional column fit a 1440px window with the
// sidebar open; below that the pane scrolls.
const COLUMN_WIDTHS: Record<PeopleColumnKey, number> = {
  department: 152,
  email: 212,
  phone: 124,
  role: 112,
  status: 120,
};

// Fixed tracks: edges 20 + 20, name min 184, title min 128 = 352, plus the
// eight gap-x-3 gaps between the wide template's nine tracks.
const FIXED_TRACKS_WIDTH = 352 + 8 * 12;

// Render/track order: name, title, department, email, phone, role, status.
// MUST be a literal string — Tailwind cannot see an interpolated
// `grid-cols-[...]`, and an interpolated width silently drops the whole
// template, collapsing the grid to one column.
const GRID_COLS =
  "grid-cols-[1.25rem_minmax(140px,1.4fr)_minmax(96px,1fr)_1.25rem] " +
  "@2xl:grid-cols-[1.25rem_minmax(184px,1.4fr)_minmax(128px,1fr)_var(--pc-department)_var(--pc-email)_var(--pc-phone)_var(--pc-role)_var(--pc-status)_1.25rem]";

function columnTrackVars(isVisible: (key: PeopleColumnKey) => boolean): CSSProperties {
  const keys = Object.keys(COLUMN_WIDTHS) as PeopleColumnKey[];
  const minWidth =
    FIXED_TRACKS_WIDTH +
    keys.reduce((sum, key) => sum + (isVisible(key) ? COLUMN_WIDTHS[key] : 0), 0);
  return {
    "--pc-department": isVisible("department") ? `${COLUMN_WIDTHS.department}px` : "0px",
    "--pc-email": isVisible("email") ? `${COLUMN_WIDTHS.email}px` : "0px",
    "--pc-phone": isVisible("phone") ? `${COLUMN_WIDTHS.phone}px` : "0px",
    "--pc-role": isVisible("role") ? `${COLUMN_WIDTHS.role}px` : "0px",
    "--pc-status": isVisible("status") ? `${COLUMN_WIDTHS.status}px` : "0px",
    "--pc-minw": `${minWidth}px`,
  } as CSSProperties;
}

export function PeopleTable({
  people,
  hrefFor,
  hiddenColumns,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  people: Person[];
  hrefFor: (userId: string) => string;
  hiddenColumns: PeopleColumnKey[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewport = useScrollViewport(scrollRef);
  const rows = useWindowedRows({
    rowCount: people.length,
    rowHeight: ROW_HEIGHT,
    scrollRef,
    viewport,
    scrollMargin: LIST_GRID_HEADER_HEIGHT,
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
          aria-rowcount={people.length + 1}
          className={`${GRID_COLS} @2xl:min-w-[var(--pc-minw)]`}
          style={columnTrackVars(isVisible)}
        >
          <ListGridHeader aria-rowindex={1}>
            <ListGridHeaderCell>{t("people.column_name")}</ListGridHeaderCell>
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
      {/* The edge that has more columns behind it fades, so a cut-off column
          reads as "scroll for more" rather than as the table's end. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent transition-opacity duration-[var(--duration-fast)]",
          overflow.left ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent transition-opacity duration-[var(--duration-fast)]",
          overflow.right ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

/** Whether the scroller has content hidden past its left and right edges. */
function useHorizontalOverflow(
  ref: RefObject<HTMLDivElement | null>,
  layoutKey: string,
): { left: boolean; right: boolean } {
  const [state, setState] = useState({ left: false, right: false });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const max = element.scrollWidth - element.clientWidth;
      const next = { left: element.scrollLeft > 1, right: max - element.scrollLeft > 1 };
      setState((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    return () => element.removeEventListener("scroll", measure);
  }, [ref, layoutKey]);
  return state;
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
