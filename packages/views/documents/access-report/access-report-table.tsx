"use client";

import { Fragment, useId, useRef, useState } from "react";
import { Building2, ChevronDown, Link2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { deriveReportFacts, type ReportFacts } from "@uniwork/core/documents/access-report-facts";
import type { AccessReportDocument, AccessReportFlag, AccessReportRow } from "@uniwork/core/types/document-access-report";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { cn } from "@uniwork/ui/lib/utils";
import { initialOf } from "@uniwork/core/chat/initials";
import { DocumentTypeIcon, documentIconFormat } from "../document-type-icon";
import { ACCESS_PILL } from "../doclist/cells";
import { formatListDate } from "../doclist/format";
import { AccessReportGrants, grantName } from "./access-report-grants";
import { flagLabel, generalScopeLabel, whoLines } from "./access-report-labels";
import {
  AccessReportSortHeader,
  type PendingSortFocus,
  type ReportSortKey,
  type ReportSortOrder,
} from "./access-report-sort-header";

const NONE = "—";
/** Avatars drawn before the rest fold into the "who" line. */
const MAX_AVATARS = 4;

// The shared list's header and cell padding (documents-library-list / -row).
const TH = "px-3 py-2 font-medium whitespace-nowrap";
const TD = "px-3 py-2 align-middle";

/** The general access pill wears the shared list's pill tones: private grey, the workspace blue, the organization amber (the "shared" caution). */
const SCOPE_TONE: Record<string, string> = {
  restricted: ACCESS_PILL.restricted,
  workspace: ACCESS_PILL.workspace,
  organization: ACCESS_PILL.shared,
};

/** A public link is the loudest warning; reach outside the workspace next; direct manage is a note. */
const FLAG_TONE: Record<AccessReportFlag, string> = {
  public_link: "bg-destructive-soft text-destructive-soft-foreground",
  other_workspace: "bg-warning-soft text-warning-soft-foreground",
  organization: "bg-warning-soft text-warning-soft-foreground",
  direct_manage: "bg-info-soft text-info-soft-foreground",
};

export interface AccessReportTableProps {
  wsId: string;
  /** The loaded pages' documents, in the server's order. */
  documents: AccessReportDocument[];
  sort: ReportSortKey;
  order: ReportSortOrder;
  /** The server sorts: this asks for a new order, the caller refetches. */
  onSortChange: (next: { sort: ReportSortKey; order: ReportSortOrder }) => void;
  /** Opens a document from an open row; without it there is no "Open document". */
  documentHref?: (documentId: string) => string;
}

/**
 * The By document table (UNI-2039 F3): one row per document the reader
 * manages — type, name, folder path and owner, general access, who has access,
 * warnings and the last access change — under a single header. A row opens
 * onto its grants. Names only: the server sends no email and this screen never
 * asks for one. On a narrow screen the table keeps its columns and scrolls
 * inside its box.
 */
export function AccessReportTable({ wsId, documents, sort, order, onSortChange, documentHref }: AccessReportTableProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const pendingFocus = useRef<PendingSortFocus | null>(null);
  const sortProps = { sort, order, onSortChange, pendingFocus };
  return (
    // A size container: the open grants size themselves to this box (cqw), not to the viewport.
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto [container-type:inline-size]">
        {/* Fixed layout: a long name gives way to the ellipsis instead of widening the table. */}
        <table aria-label={t("documents.accessReport.title")} className="w-full min-w-[60rem] table-fixed border-collapse text-left text-body">
          <thead className="bg-muted/50">
            <tr className="border-b border-border text-caption text-muted-foreground">
              <AccessReportSortHeader column="title" label={t("documents.accessReport.col_document")} className="w-[28%]" {...sortProps} />
              <th scope="col" className={cn(TH, "w-[18%]")}>{t("documents.accessReport.col_general_scope")}</th>
              <th scope="col" className={cn(TH, "w-[18%]")}>{t("documents.accessReport.col_people")}</th>
              <th scope="col" className={cn(TH, "w-[18%]")}>{t("documents.accessReport.col_warnings")}</th>
              <AccessReportSortHeader column="changed" label={t("documents.accessReport.col_changed")} className="w-[14%]" {...sortProps} />
              <th scope="col" className={cn(TH, "w-16 px-2")}>
                <span className="sr-only">{t("documents.accessReport.col_expand")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {documents.map((entry) => (
              <DocumentRow
                key={entry.document.id}
                wsId={wsId}
                entry={entry}
                expanded={open.has(entry.document.id)}
                onToggle={() => toggle(entry.document.id)}
                documentHref={documentHref}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DocumentRow({
  wsId,
  entry,
  expanded,
  onToggle,
  documentHref,
}: {
  wsId: string;
  entry: AccessReportDocument;
  expanded: boolean;
  onToggle: () => void;
  documentHref?: (documentId: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const grantsId = useId();
  const { document: doc, rows } = entry;
  const facts = deriveReportFacts(doc, rows, wsId);
  const title = doc.title || t("documents.detail.untitled");
  const path = doc.path.map((item) => item.title).join(" / ");
  const owner = doc.acl_owner?.name ?? "";
  // A document at the root has no path; the root's own label stands in beside the owner.
  const where = owner
    ? t("documents.accessReport.path_owner", { path: path || t("documents.home.search.path_root"), owner })
    : path;
  const who = whoLines(t, facts);
  const scopeText = generalScopeLabel(t, facts.generalScope);
  const changed = formatListDate(facts.changedAt, new Date(), i18n.language);
  const toggleLabel = expanded
    ? t("documents.accessReport.collapse", { name: title })
    : t("documents.accessReport.expand_document", { name: title });
  const controls = expanded ? grantsId : undefined;

  return (
    <Fragment>
      <tr className={cn("border-b border-border transition-colors last:border-b-0 hover:bg-accent/40", expanded && "bg-muted/30")}>
        <td className={cn(TD, "overflow-hidden")}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={controls}
            onClick={onToggle}
            className="flex w-full min-w-0 items-center gap-2.5 rounded-sm text-left pointer-coarse:min-h-11"
          >
            <DocumentTypeIcon format={documentIconFormat(doc.kind, doc.title)} decorative className="size-8 shrink-0" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span title={title} className="truncate font-medium text-foreground">
                {title}
              </span>
              {where ? (
                <span title={where} className="truncate text-caption text-muted-foreground">
                  {where}
                </span>
              ) : null}
            </span>
          </button>
        </td>
        <td className={cn(TD, "overflow-hidden")}>
          {/* The pill never outgrows its cell: a long label wraps inside it to two lines at most, the full text on hover. */}
          <Badge
            variant="secondary"
            title={scopeText}
            className={cn(
              "block h-auto w-fit max-w-full whitespace-normal line-clamp-2 px-2.5 py-1 leading-tight [overflow-wrap:anywhere]",
              SCOPE_TONE[facts.generalScope.kind] ?? ACCESS_PILL.restricted,
            )}
          >
            {scopeText}
          </Badge>
        </td>
        <td className={cn(TD, "overflow-hidden")}>
          <WhoCell rows={rows} facts={facts} who={who} />
        </td>
        <td className={TD}>
          {facts.flags.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {facts.flags.map((flag) => (
                <Badge key={flag} className={FLAG_TONE[flag]}>
                  {flagLabel(t, flag)}
                </Badge>
              ))}
            </span>
          ) : (
            <span className="text-muted-foreground">{NONE}</span>
          )}
        </td>
        <td className={cn(TD, "whitespace-nowrap font-mono text-caption tabular-nums text-muted-foreground")}>{changed}</td>
        <td className={cn(TD, "px-2 text-right")}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={controls}
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={onToggle}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted pointer-coarse:size-11"
          >
            <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr id={grantsId} className="border-b border-border bg-muted/20">
          <td colSpan={6} className="px-3 pt-1 pb-4 md:pl-14">
            {/* Pinned to the left and never wider than the scroll box (cqw: the box,
                not the viewport, so the sidebar does not count), so a box scrolled to
                the right still opens on the grants' first column. */}
            <div
              data-grants-pin
              className="sticky left-3 w-[min(100%,calc(100cqw_-_1.5rem))] md:left-14 md:w-[min(100%,calc(100cqw_-_4.25rem))]"
            >
              <AccessReportGrants wsId={wsId} entry={entry} title={title} documentHref={documentHref} />
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

/**
 * Up to four faces of who has access, and under them the lines that count them
 * all: the groups, then the people and links. The cell clips and each line
 * truncates on its own with the full text on hover, so the counts never run
 * into the Warnings column and a long group name never pushes them out.
 */
function WhoCell({ rows, facts, who }: { rows: readonly AccessReportRow[]; facts: ReportFacts; who: { groups: readonly string[]; counts: readonly string[] } }) {
  const { t } = useTranslation();
  const seen = new Set<string>();
  const faces = rows.filter((row) => {
    const id = `${row.principal_type}:${row.principal_id}`;
    if (!row.active || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  // Before link rows arrive (S2) a live link is only a count: it gets a face too.
  const linkFace = facts.links > 0 && !faces.some((row) => row.principal_type === "link");
  const lines = [who.groups, who.counts].filter((parts) => parts.length > 0).map((parts) => parts.join(" · "));
  return (
    <span className="flex min-w-0 flex-col gap-1">
      {/* The lines below say who; the faces are a picture of it. */}
      <span aria-hidden className="flex shrink-0 pl-1.5">
        {faces.slice(0, MAX_AVATARS).map((row) => {
          const name = grantName(t, row);
          return (
            <span key={`${row.principal_type}:${row.principal_id}`} title={name} className="-ml-1.5 rounded-full ring-2 ring-card">
              <Face type={row.principal_type} name={name} />
            </span>
          );
        })}
        {linkFace && faces.length < MAX_AVATARS ? (
          <span title={t("documents.accessReport.anyone_with_link")} className="-ml-1.5 rounded-full ring-2 ring-card">
            <Face type="link" name="" />
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col text-muted-foreground" title={lines.length > 0 ? lines.join(" · ") : undefined}>
        {lines.length > 0 ? lines.map((line) => <span key={line} className="truncate">{line}</span>) : NONE}
      </span>
    </span>
  );
}

function Face({ type, name }: { type: string; name: string }) {
  if (type === "user") return <ActorAvatar name={name} initials={initialOf(name)} size="sm" />;
  const Icon = type === "organization" ? Building2 : type === "link" ? Link2 : Users;
  return (
    <span className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Icon className="size-3.5" />
    </span>
  );
}
