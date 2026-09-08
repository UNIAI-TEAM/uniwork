"use client";

import { useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { PeopleColumnKey } from "@uniwork/core/people/view-store";
import type { Person } from "@uniwork/core/types/people";
import { Avatar, AvatarFallback, AvatarImage } from "@uniwork/ui/components/ui/avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";
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
import { AppLink, useNavigation } from "../navigation";
import { initials } from "./actor-chip";
import { PeopleRowsSkeleton } from "./people-skeleton";
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
 * the pane scrolls sideways rather than dropping one silently.
 *
 * Only a band of rows is in the DOM at any time, so the table states its true
 * row count and each row its own index: a screen reader must not be told the
 * window is the directory.
 */

const ROW_HEIGHT = 48;

const COLUMN_WIDTHS: Record<PeopleColumnKey, number> = {
  department: 168,
  email: 224,
  phone: 140,
  role: 112,
  status: 128,
};

// Fixed tracks: edges 20 + 20, name min 200, title min 140 = 380, plus the
// eight gap-x-3 gaps between the wide template's nine tracks.
const FIXED_TRACKS_WIDTH = 380 + 8 * 12;

// Render/track order: name, title, department, email, phone, role, status.
// MUST be a literal string — Tailwind cannot see an interpolated
// `grid-cols-[...]`, and an interpolated width silently drops the whole
// template, collapsing the grid to one column.
const GRID_COLS =
  "grid-cols-[1.25rem_minmax(140px,1.4fr)_minmax(96px,1fr)_1.25rem] " +
  "@2xl:grid-cols-[1.25rem_minmax(200px,1.4fr)_minmax(140px,1fr)_var(--pc-department)_var(--pc-email)_var(--pc-phone)_var(--pc-role)_var(--pc-status)_1.25rem]";

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

  return (
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
  const deactivated = person.status === "deactivated";
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
        <Avatar className="size-6 shrink-0">
          {person.avatar_url ? <AvatarImage src={person.avatar_url} alt="" /> : null}
          <AvatarFallback className="text-micro">{initials(person.display_name)}</AvatarFallback>
        </Avatar>
        <AppLink
          href={href}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 truncate text-body font-medium text-foreground"
        >
          {person.display_name}
        </AppLink>
        {/* The status column is off by default, so deactivation is said here
            too: it changes what the row means, and must not depend on a
            column the reader may never turn on. */}
        {deactivated ? (
          <Badge variant="secondary" className="shrink-0">
            {t("people.status_deactivated")}
          </Badge>
        ) : null}
      </ListGridCell>
      <ListGridCell className="text-caption text-muted-foreground">
        <span className="min-w-0 truncate">{person.title || "—"}</span>
      </ListGridCell>
      <OptionalCell shown={isVisible("department")}>
        <span className="min-w-0 truncate text-caption text-muted-foreground">
          {person.department?.name ?? "—"}
        </span>
      </OptionalCell>
      <OptionalCell shown={isVisible("email")}>
        <span className="min-w-0 truncate text-caption text-muted-foreground">{person.email}</span>
      </OptionalCell>
      <OptionalCell shown={isVisible("phone")}>
        <span className="min-w-0 truncate text-caption tabular-nums text-muted-foreground">
          {person.phone || "—"}
        </span>
      </OptionalCell>
      <OptionalCell shown={isVisible("role")}>
        <Badge variant="outline" className="shrink-0">
          {t(`people.role_${person.org_role}`, { defaultValue: person.org_role })}
        </Badge>
      </OptionalCell>
      <OptionalCell shown={isVisible("status")}>
        <Badge variant={deactivated ? "secondary" : "outline"} className="shrink-0">
          {deactivated ? t("people.status_deactivated") : t("people.status_active")}
        </Badge>
      </OptionalCell>
    </ListGridRow>
  );
}
