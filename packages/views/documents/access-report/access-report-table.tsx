"use client";

import { Building2, CircleOff, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AccessReportDocument, AccessReportRow } from "@uniwork/core/types/document-access-report";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@uniwork/ui/components/ui/table";
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
              <h3 className="min-w-0 max-w-full truncate text-body font-medium text-foreground">
                {documentHref ? (
                  <AppLink href={documentHref(doc.id)} className="hover:underline">
                    {title}
                  </AppLink>
                ) : (
                  title
                )}
              </h3>
              <Badge variant="outline">{accessVisibilityLabel(t, doc.visibility)}</Badge>
              {path ? <span className="min-w-0 truncate text-caption text-muted-foreground">{path}</span> : null}
              <span className="ml-auto flex flex-wrap items-center gap-x-3 text-caption text-muted-foreground">
                {doc.acl_owner?.name ? <span>{`${t("documents.accessReport.col_owner")}: ${doc.acl_owner.name}`}</span> : null}
                <span>{`${t("documents.accessReport.col_links")}: ${doc.live_link_count}`}</span>
                {doc.person_level ? (
                  <span>{t("documents.accessReport.person_level", { level: accessLevelLabel(t, doc.person_level) })}</span>
                ) : null}
              </span>
            </div>
            <Table aria-label={title}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("documents.accessReport.col_principal")}</TableHead>
                  <TableHead>{t("documents.accessReport.col_level")}</TableHead>
                  <TableHead>{t("documents.accessReport.col_effective")}</TableHead>
                  <TableHead>{t("documents.accessReport.col_source")}</TableHead>
                  <TableHead>{t("documents.accessReport.col_granted_by")}</TableHead>
                  <TableHead>{t("documents.accessReport.col_granted_at")}</TableHead>
                  <TableHead>{t("documents.accessReport.col_status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <AccessReportRowLine
                    key={`${row.source}:${row.principal_type}:${row.principal_id}:${row.share_id ?? index}`}
                    row={row}
                    onPickPerson={onPickPerson}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })}
    </div>
  );
}

function AccessReportRowLine({
  row,
  onPickPerson,
}: {
  row: AccessReportRow;
  onPickPerson: (userId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const name = row.principal_name?.trim() || principalTypeLabel(t, row.principal_type);
  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          <PrincipalGlyph type={row.principal_type} name={name} />
          {row.principal_type === "user" && row.principal_id ? (
            <button
              type="button"
              onClick={() => onPickPerson(row.principal_id)}
              className="min-w-0 truncate rounded-sm text-left font-medium text-foreground hover:underline"
            >
              {name}
            </button>
          ) : (
            <span className="min-w-0 truncate font-medium text-foreground">{name}</span>
          )}
          {row.principal_type !== "user" ? (
            <span className="shrink-0 text-caption text-muted-foreground">{principalTypeLabel(t, row.principal_type)}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{accessLevelLabel(t, row.level)}</Badge>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{accessLevelLabel(t, row.effective_level)}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{accessSourceLabel(t, row.source)}</TableCell>
      <TableCell className="text-muted-foreground">{row.granted_by_name || NONE}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {row.granted_at ? formatWhen(row.granted_at, i18n.language) : NONE}
      </TableCell>
      <TableCell>
        {row.active ? null : (
          <Badge variant="outline" className="text-muted-foreground">
            <CircleOff aria-hidden data-icon="inline-start" />
            {t("documents.accessReport.inactive")}
          </Badge>
        )}
      </TableCell>
    </TableRow>
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
