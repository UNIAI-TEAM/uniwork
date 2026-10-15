"use client";

import { Building2, CircleOff, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AccessReportDocument, AccessReportRow } from "@uniwork/core/types/document-access-report";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { cn } from "@uniwork/ui/lib/utils";
import { initialOf } from "../../chat/chat-initials";
import { AppLink } from "../../navigation";
import { formatWhen } from "../document-format";
import {
  accessLevelLabel,
  accessSourceLabel,
  accessVisibilityLabel,
  principalTypeLabel,
} from "./access-report-labels";

const NONE = "—";

/**
 * One column template for every document card, so Level, Source, Granted on and
 * Status sit at the same x in each. Fixed tracks for the short columns, shares
 * of the rest for the names (`minmax(0, …)` lets a long name truncate instead of
 * widening the grid). Below md there is no grid: each entry is a stacked row.
 */
const ROW_GRID =
  "md:grid md:grid-cols-[minmax(0,2.2fr)_5.5rem_6rem_minmax(0,1fr)_minmax(0,1.3fr)_8.5rem_10rem] md:items-center md:gap-x-3";

/** A 24px target on a desktop pointer, 44px on a coarse one — by min-height, not font size. */
const HIT_AREA = "flex min-h-6 min-w-0 items-center pointer-coarse:min-h-11";

export interface AccessReportTableProps {
  documents: AccessReportDocument[];
  /** Opens a document; without it the title is plain text. */
  documentHref?: (documentId: string) => string;
  /** Filter the whole report to one person (a click on their name). */
  onPickPerson: (userId: string) => void;
}

/**
 * One block per document the reader manages: the document's facts on top (path,
 * visibility, owner, live public links), then one row per grant. Names only —
 * the server sends no email and this screen never asks for one.
 *
 * The grants are a grid of ARIA table parts rather than a `<table>`: the same
 * markup is a column grid from md up and a stack of rows on a phone, and the
 * explicit roles keep it a table for assistive tech in both.
 */
export function AccessReportTable({ documents, documentHref, onPickPerson }: AccessReportTableProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      {documents.map(({ document: doc, rows }) => {
        const title = doc.title || t("documents.detail.untitled");
        const path = doc.path.map((item) => item.title).join(" / ");
        return (
          <div
            key={doc.id}
            role="group"
            aria-label={title}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-3 py-2">
              <h3 className="flex min-w-0 max-w-full text-body font-medium text-foreground">
                {documentHref ? (
                  <AppLink href={documentHref(doc.id)} title={title} className={cn(HIT_AREA, "hover:underline")}>
                    <span className="truncate">{title}</span>
                  </AppLink>
                ) : (
                  <span title={title} className="truncate">
                    {title}
                  </span>
                )}
              </h3>
              <Badge variant="outline">{accessVisibilityLabel(t, doc.visibility)}</Badge>
              {path ? (
                <span title={path} className="min-w-0 truncate text-caption text-muted-foreground">
                  {path}
                </span>
              ) : null}
              <span className="ml-auto flex flex-wrap items-center gap-x-3 text-caption text-muted-foreground">
                {doc.acl_owner?.name ? <span>{`${t("documents.accessReport.col_owner")}: ${doc.acl_owner.name}`}</span> : null}
                <span>{`${t("documents.accessReport.col_links")}: ${doc.live_link_count}`}</span>
                {doc.person_level ? (
                  <span>{t("documents.accessReport.person_level", { level: accessLevelLabel(t, doc.person_level) })}</span>
                ) : null}
              </span>
            </div>
            <div role="table" aria-label={title}>
              <div role="rowgroup">
                <div
                  role="row"
                  className={cn(ROW_GRID, "border-b border-border px-3 text-caption font-medium text-muted-foreground max-md:sr-only md:h-9")}
                >
                  <div role="columnheader">{t("documents.accessReport.col_principal")}</div>
                  <div role="columnheader">{t("documents.accessReport.col_level")}</div>
                  <div role="columnheader">{t("documents.accessReport.col_effective")}</div>
                  <div role="columnheader">{t("documents.accessReport.col_source")}</div>
                  <div role="columnheader">{t("documents.accessReport.col_granted_by")}</div>
                  <div role="columnheader">{t("documents.accessReport.col_granted_at")}</div>
                  <div role="columnheader">{t("documents.accessReport.col_status")}</div>
                </div>
              </div>
              <div role="rowgroup">
                {rows.map((row, index) => (
                  <AccessReportRowLine
                    key={`${row.source}:${row.principal_type}:${row.principal_id}:${row.share_id ?? index}`}
                    row={row}
                    onPickPerson={onPickPerson}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A cell: its own `data-label` prints as a small caption on the stacked phone layout. */
const CELL = "min-w-0 max-md:text-caption max-md:before:mr-1 max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]";

function AccessReportRowLine({
  row,
  onPickPerson,
}: {
  row: AccessReportRow;
  onPickPerson: (userId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const name = row.principal_name?.trim() || principalTypeLabel(t, row.principal_type);
  const grantedBy = row.granted_by_name || NONE;
  const grantedAt = row.granted_at ? formatWhen(row.granted_at, i18n.language) : NONE;
  const label = (key: string) => t(`documents.accessReport.${key}`);
  return (
    <div
      role="row"
      className={cn(
        ROW_GRID,
        "border-b border-border px-3 py-2 text-body last:border-b-0 hover:bg-muted/50",
        "max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-3 max-md:gap-y-1",
      )}
    >
      <div role="cell" data-label={label("col_principal")} className="min-w-0 max-md:order-1 max-md:basis-full max-md:before:content-none">
        <div className="flex min-w-0 items-center gap-2">
          <PrincipalGlyph type={row.principal_type} name={name} />
          {row.principal_type === "user" && row.principal_id ? (
            <button
              type="button"
              title={name}
              onClick={() => onPickPerson(row.principal_id)}
              className={cn(HIT_AREA, "rounded-sm text-left font-medium text-foreground hover:underline")}
            >
              <span className="truncate">{name}</span>
            </button>
          ) : (
            <span title={name} className="min-w-0 truncate font-medium text-foreground">
              {name}
            </span>
          )}
          {row.principal_type !== "user" ? (
            <span className="shrink-0 text-caption text-muted-foreground">{principalTypeLabel(t, row.principal_type)}</span>
          ) : null}
        </div>
      </div>
      <div role="cell" data-label={label("col_level")} className={cn(CELL, "max-md:order-2")}>
        <Badge variant="secondary">{accessLevelLabel(t, row.level)}</Badge>
      </div>
      <div role="cell" data-label={label("col_effective")} className={cn(CELL, "max-md:order-3")}>
        <Badge variant="outline">{accessLevelLabel(t, row.effective_level)}</Badge>
      </div>
      <div role="cell" data-label={label("col_source")} className={cn(CELL, "truncate text-muted-foreground max-md:order-4")}>
        {accessSourceLabel(t, row.source)}
      </div>
      <div
        role="cell"
        data-label={label("col_granted_by")}
        title={row.granted_by_name || undefined}
        className={cn(CELL, "truncate text-muted-foreground max-md:order-6")}
      >
        {grantedBy}
      </div>
      <div role="cell" data-label={label("col_granted_at")} className={cn(CELL, "truncate text-muted-foreground max-md:order-7")}>
        {grantedAt}
      </div>
      {/* Last in the grid; on a phone it sits before the "granted" line, so the chip is seen first. */}
      <div role="cell" data-label={label("col_status")} className={cn(CELL, "max-md:order-5 max-md:empty:hidden max-md:before:content-none")}>
        {row.active ? null : (
          <Badge variant="outline" className="text-muted-foreground">
            <CircleOff aria-hidden data-icon="inline-start" />
            {t("documents.accessReport.inactive")}
          </Badge>
        )}
      </div>
    </div>
  );
}

function PrincipalGlyph({ type, name }: { type: string; name: string }) {
  if (type === "user") {
    return <ActorAvatar name={name} initials={initialOf(name)} size="md" />;
  }
  const Icon = type === "organization" ? Building2 : Users;
  return (
    <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Icon className="size-3.5" />
    </span>
  );
}
