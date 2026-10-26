"use client";

import { Fragment, useId, useState } from "react";
import { ArrowDown, ArrowUp, BuildingComplex, ChevronDown, CircleAlert, Link2, Users, UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDocumentAccessReportPrincipals } from "@uniwork/core/documents/hooks-access-report";
import type { AccessReportPrincipal, AccessReportPrincipals } from "@uniwork/core/types/document-access-report";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { initialOf } from "@uniwork/core/chat/initials";
import { CollectionPageState } from "../../layout/collection-page";
import { SORT_HEADER_BUTTON } from "../library-sort-header";
import { accessLevelLabel, accessSourceLabel, principalTypeLabel, REPORT_LEVELS } from "./access-report-labels";
import { AccessReportPersonDocs, principalParam } from "./access-report-person-docs";

type TFunction = ReturnType<typeof useTranslation>["t"];
type PeopleSortKey = "count" | "name";
type PeopleSortOrder = "asc" | "desc";

/** The order a column starts in when it is first picked: names A to Z, counts largest first. */
const DEFAULT_ORDER: Record<PeopleSortKey, PeopleSortOrder> = { count: "desc", name: "asc" };

/**
 * One tone per level, strongest first. They are steps of one token, so the
 * bar reads by lightness and not only by hue; the words beside it say the rest.
 */
const LEVEL_TONE: Record<(typeof REPORT_LEVELS)[number], string> = {
  manage: "bg-primary",
  edit: "bg-primary/70",
  comment: "bg-primary/45",
  view: "bg-primary/25",
};
const SPLIT_ORDER = ["manage", "edit", "comment", "view"] as const;

/** A report principal's main source (`owner|workspace|direct|chat|link|break_glass`) as the report names a grant's source. */
const MAIN_SOURCE: Record<string, { source: string; origin?: string }> = {
  owner: { source: "acl_owner" },
  workspace: { source: "workspace" },
  direct: { source: "share" },
  chat: { source: "share", origin: "chat" },
  link: { source: "link" },
  break_glass: { source: "break_glass" },
};

/** What the principal is called: its name, "Anyone with the link", or its type when the account is gone. */
function personName(t: TFunction, p: AccessReportPrincipal): string {
  const name = p.principal_name?.trim();
  if (name) return name;
  return p.principal_type === "link" ? t("documents.accessReport.anyone_with_link") : principalTypeLabel(t, p.principal_type);
}

/** The line under the name; a kind this build does not know reads "Other". */
function kindLine(t: TFunction, p: AccessReportPrincipal): string {
  switch (p.kind) {
    case "member":
    case "other_workspace":
    case "organization":
    case "link":
      return t(`documents.accessReport.kind_${p.kind}`);
    case "home_workspace":
      return p.member_count === null
        ? t("documents.accessReport.who_workspace")
        : t("documents.accessReport.kind_home_workspace", { count: p.member_count });
    default:
      return t("documents.accessReport.principal_other");
  }
}

export interface AccessReportPeopleProps {
  wsId: string;
  /** Empty = the whole workspace. */
  folderId?: string;
  /** Free text over people and groups. */
  search?: string;
  /** `member|home_workspace|other_workspace|organization|link`; empty = all. */
  kind?: string;
  /** Level filter; it narrows the counts and the documents an open row lists. */
  levels?: string[];
  /** Documents the reader can view but does not manage; with no filter and nobody listed, the empty state says so. */
  skipped?: number;
  documentHref?: (documentId: string) => string;
}

/**
 * The By person table (UNI-2039 F4): one row per person or group holding
 * access — document count, how the levels split, the main source. The server
 * totals and sorts; a row opens onto that principal's documents. Names only.
 */
export function AccessReportPeople({ wsId, folderId, search, kind, levels, skipped = 0, documentHref }: AccessReportPeopleProps) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<{ sort: PeopleSortKey; order: PeopleSortOrder }>({ sort: "count", order: "desc" });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const query = useDocumentAccessReportPrincipals(wsId, {
    folderId,
    q: search?.trim() || undefined,
    kind: kind || undefined,
    levels: levels && levels.length > 0 ? levels : undefined,
    ...sort,
  });

  // A new sort or filter is a new query: keep the rows on screen until its answer lands.
  const [lastData, setLastData] = useState<AccessReportPrincipals | null>(null);
  if (query.data && query.data !== lastData) setLastData(query.data);
  const data = query.data ?? lastData;

  if (!data && query.isPending) {
    return (
      <div role="status" aria-label={t("documents.accessReport.loading")} className="flex items-center justify-center gap-2 py-16 text-caption text-muted-foreground">
        <Spinner />
        {t("documents.accessReport.loading")}
      </div>
    );
  }
  if (query.isError && !data) {
    return (
      <CollectionPageState
        icon={CircleAlert}
        tone="destructive"
        role="alert"
        title={t("documents.accessReport.error")}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t("documents.accessReport.retry")}
          </Button>
        }
      />
    );
  }
  const people = data?.principals ?? [];
  if (people.length === 0) {
    // Nobody listed because the reader manages nothing here: the By document wording, not "nothing matches".
    return <CollectionPageState icon={UsersRound} title={t(skipped > 0 ? "documents.accessReport.skipped_only" : "documents.accessReport.empty")} />;
  }

  const sortHeader = (column: PeopleSortKey, label: string) => (
    <SortHeader column={column} label={label} active={sort.sort === column ? sort.order : null} onPick={() => setSort(next(sort, column))} />
  );

  return (
    // A size container: an open row's documents size themselves to this box (cqw), not to the viewport.
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto [container-type:inline-size]">
        <table aria-label={t("documents.accessReport.tab_people")} aria-busy={query.isFetching || undefined} className="w-full border-collapse text-left text-body lg:min-w-[56rem]">
          <thead className="bg-muted/50">
            <tr className="border-b border-border text-caption text-muted-foreground">
              {sortHeader("name", t("documents.accessReport.col_principal"))}
              {sortHeader("count", t("documents.accessReport.col_count"))}
              <th scope="col" className={cn(TH, NARROW_HIDDEN)}>{t("documents.accessReport.col_split")}</th>
              <th scope="col" className={cn(TH, TABLET_HIDDEN)}>{t("documents.accessReport.col_main_source")}</th>
              <th scope="col" className={cn(TH, "w-12")}>
                <span className="sr-only">{t("documents.accessReport.col_expand")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const key = `${principalParam(p)}:${p.kind}`;
              return (
                <PersonRow
                  key={key}
                  wsId={wsId}
                  principal={p}
                  open={openKey === key}
                  onToggle={() => setOpenKey(openKey === key ? null : key)}
                  folderId={folderId}
                  levels={levels}
                  documentHref={documentHref}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TH = "px-3 py-2 font-medium whitespace-nowrap";
const TD = "px-3 py-2 align-middle";
// Below sm the split bar and the main source leave the row (an open row lists each document's level and source).
const NARROW_HIDDEN = "max-sm:hidden";
// The main source also leaves below lg, where the table has no width floor: at 768 it would clip it and the expand column.
const TABLET_HIDDEN = "max-lg:hidden";

function next(current: { sort: PeopleSortKey; order: PeopleSortOrder }, column: PeopleSortKey) {
  if (current.sort !== column) return { sort: column, order: DEFAULT_ORDER[column] };
  return { sort: column, order: current.order === "asc" ? ("desc" as const) : ("asc" as const) };
}

/** The UNI-2038 header pattern; F3's `access-report-sort-header` is typed for the document columns, so this one is its own. */
function SortHeader({ column, label, active, onPick }: { column: PeopleSortKey; label: string; active: PeopleSortOrder | null; onPick: () => void }) {
  const { t } = useTranslation();
  const Arrow = active === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" data-column={column} aria-sort={active ? (active === "asc" ? "ascending" : "descending") : "none"} className={TH}>
      <button
        type="button"
        aria-label={t("documents.accessReport.sort_by", { column: label })}
        onClick={onPick}
        className={cn(SORT_HEADER_BUTTON, active && "text-foreground")}
      >
        <span className="truncate">{label}</span>
        {active ? <Arrow aria-hidden className="size-3.5 shrink-0" /> : null}
      </button>
    </th>
  );
}

interface PersonRowProps {
  wsId: string;
  principal: AccessReportPrincipal;
  open: boolean;
  onToggle: () => void;
  folderId?: string;
  levels?: string[];
  documentHref?: (documentId: string) => string;
}

function PersonRow({ wsId, principal: p, open, onToggle, folderId, levels, documentHref }: PersonRowProps) {
  const { t } = useTranslation();
  const panelId = useId();
  const name = personName(t, p);
  const label = open ? t("documents.accessReport.collapse", { name }) : t("documents.accessReport.expand_person", { name });
  const parts = SPLIT_ORDER.filter((level) => p.levels[level] > 0);
  const total = parts.reduce((sum, level) => sum + p.levels[level], 0);
  const legend = parts.length > 0 ? parts.map((level) => `${p.levels[level]} ${accessLevelLabel(t, level)}`).join(" · ") : "—";
  const mainSource = accessSourceLabel(t, MAIN_SOURCE[p.main_source] ?? { source: "" });

  return (
    <Fragment>
      <tr className={cn("border-b border-border transition-colors last:border-b-0 hover:bg-accent/40", open && "bg-muted/40")}>
        <td className={TD}>
          <button
            type="button"
            aria-label={label}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={onToggle}
            className="flex min-h-8 min-w-0 max-w-full items-center gap-3 rounded-sm text-left pointer-coarse:min-h-11"
          >
            <PrincipalGlyph principal={p} name={name} />
            <span className="flex min-w-0 flex-col">
              <span title={name} className="truncate font-medium">{name}</span>
              <span className="truncate text-caption text-muted-foreground">{kindLine(t, p)}</span>
              {/* The split bar and the main source columns leave the row below sm: their words ride under the name. */}
              <span data-caption className="truncate text-caption text-muted-foreground sm:hidden">{`${legend} · ${mainSource}`}</span>
            </span>
          </button>
        </td>
        <td className={cn(TD, "font-semibold")}>{p.document_count}</td>
        <td className={cn(TD, NARROW_HIDDEN)}>
          <div className="flex max-w-72 flex-col gap-1.5">
            {total > 0 ? (
              <div data-slot="level-split" aria-hidden className="flex h-2 gap-px overflow-hidden rounded-full bg-muted">
                {parts.map((level) => (
                  <span key={level} className={LEVEL_TONE[level]} style={{ width: `${Math.round((p.levels[level] / total) * 100)}%` }} />
                ))}
              </div>
            ) : null}
            <span className="text-caption text-muted-foreground">
              {legend}
            </span>
          </div>
        </td>
        <td className={cn(TD, TABLET_HIDDEN, "text-muted-foreground")}>{mainSource}</td>
        <td className={cn(TD, "text-right")}>
          {/* A bigger target for the pointer; the name button is the one keyboard and screen-reader stop. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={onToggle}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted pointer-coarse:size-11"
          >
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-border bg-muted/20">
          <td colSpan={5} className="px-3 pt-1 pb-4 md:pl-14">
            {/* Pinned to the left and never wider than the scroll box, so the list opens on screen. */}
            <div
              data-people-pin
              className="sticky left-3 w-[min(100%,calc(100cqw_-_1.5rem))] md:left-14 md:w-[min(100%,calc(100cqw_-_4.25rem))]"
            >
              <AccessReportPersonDocs
                id={panelId}
                wsId={wsId}
                folderId={folderId}
                levels={levels}
                principal={p}
                name={name}
                documentHref={documentHref}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

/** A person gets their avatar; a group, an organization and the link a quiet tile with their icon. */
function PrincipalGlyph({ principal, name }: { principal: AccessReportPrincipal; name: string }) {
  if (principal.principal_type === "user") {
    return (
      <span aria-hidden className="flex shrink-0">
        <ActorAvatar name={name} initials={initialOf(name)} size="md" />
      </span>
    );
  }
  const Icon = principal.principal_type === "organization" ? BuildingComplex : principal.principal_type === "link" ? Link2 : Users;
  return (
    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <Icon className="size-4" />
    </span>
  );
}
