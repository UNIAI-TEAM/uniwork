"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDocumentAccessReport } from "@uniwork/core/documents/hooks-access-report";
import { useRevokeReportGrant } from "@uniwork/core/documents/hooks-access-report-revoke";
import type { AccessReportPrincipal, AccessReportRow } from "@uniwork/core/types/document-access-report";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../../navigation";
import { DocumentTypeIcon, documentIconFormat } from "../document-type-icon";
import { accessLevelLabel, accessSourceLabel, revokeText } from "./access-report-labels";

/** Empty pages read in a row before the reader is left to ask for more (the server may return short pages). */
const MAX_EMPTY_PAGES = 5;

/** The `principal=` value the page query takes: `<type>:<id>`, or the bare type for "anyone with the link". */
export function principalParam(principal: Pick<AccessReportPrincipal, "principal_type" | "principal_id">): string {
  return principal.principal_id ? `${principal.principal_type}:${principal.principal_id}` : principal.principal_type;
}

function belongsTo(row: AccessReportRow, principal: AccessReportPrincipal): boolean {
  if (row.principal_type !== principal.principal_type) return false;
  return principal.principal_id === null || row.principal_id === principal.principal_id;
}

interface Pending {
  documentId: string;
  title: string;
  row: AccessReportRow;
}

export interface AccessReportPersonDocsProps {
  wsId: string;
  folderId?: string;
  levels?: string[];
  principal: AccessReportPrincipal;
  /** What the principal is called here: it names the list and the Revoke dialog. */
  name: string;
  id: string;
  documentHref?: (documentId: string) => string;
}

/**
 * The open row of the By person table: the documents one principal holds
 * access to, each with its level and source, and Revoke where the server named
 * a target. It reads the page query narrowed by `principal=` (the rows of that
 * principal are already the only ones sent; the filter here is a guard), so it
 * pages like the By document view. Revoke asks first and waits for the server;
 * the grant leaves the list when the report refetches, never before.
 */
export function AccessReportPersonDocs({ wsId, folderId, levels, principal, name, id, documentHref }: AccessReportPersonDocsProps) {
  const { t } = useTranslation();
  const report = useDocumentAccessReport(wsId, folderId, { levels, principal: principalParam(principal) });
  const revoke = useRevokeReportGrant(wsId);
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const { fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage } = report;

  const pageData = report.data?.pages;
  const pageCount = pageData?.length ?? 0;
  const items = useMemo(
    () =>
      (pageData ?? []).flatMap((page) =>
        page.documents.flatMap(({ document: doc, rows }) =>
          rows.filter((row) => belongsTo(row, principal)).map((row) => ({ doc, row })),
        ),
      ),
    [pageData, principal],
  );

  // A page with none of this principal's grants is not the end: read on, a few pages at most.
  useEffect(() => {
    if (items.length === 0 && hasNextPage && !isFetchingNextPage && !isFetchNextPageError && pageCount < MAX_EMPTY_PAGES) {
      void fetchNextPage();
    }
  }, [items.length, hasNextPage, isFetchingNextPage, isFetchNextPageError, pageCount, fetchNextPage]);

  const confirmRevoke = async () => {
    const pending = confirming;
    if (!pending?.row.revoke_target || revoke.isPending) return;
    try {
      await revoke.mutateAsync({ documentId: pending.documentId, target: pending.row.revoke_target });
      toast.success(revokeText(t, principal.principal_type, "done", name));
    } catch {
      toast.error(t("documents.accessReport.revoke_failed"));
    }
    setConfirming(null);
  };

  const loading = (
    <div role="status" aria-label={t("documents.accessReport.loading")} className="flex items-center gap-2 py-3 text-caption text-muted-foreground">
      <Spinner />
      {t("documents.accessReport.loading")}
    </div>
  );

  let body: React.ReactNode;
  if (report.isPending) {
    body = loading;
  } else if (report.isError && items.length === 0) {
    body = <ErrorLine message={t("documents.accessReport.error")} onRetry={() => void (isFetchNextPageError ? fetchNextPage() : report.refetch())} busy={report.isFetching} />;
  } else if (items.length === 0 && !hasNextPage) {
    body = <p className="py-3 text-caption text-muted-foreground">{t("documents.accessReport.empty")}</p>;
  } else if (items.length === 0) {
    body = loading;
  } else {
    body = (
      <>
        <ul aria-label={t("documents.accessReport.expand_person", { name })} className="flex flex-col">
          {items.map(({ doc, row }, index) => {
            const title = doc.title.trim() || t("documents.detail.untitled");
            return (
              <li
                key={`${doc.id}:${row.source}:${row.share_id ?? row.principal_id}:${index}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2 last:border-b-0"
              >
                <DocumentTypeIcon format={documentIconFormat(doc.kind, doc.title)} decorative className="size-6" />
                <span className="min-w-0 flex-1 basis-48 truncate font-medium" title={title}>
                  {documentHref ? (
                    <AppLink href={documentHref(doc.id)} className="rounded-sm hover:underline">
                      {title}
                    </AppLink>
                  ) : (
                    title
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{accessLevelLabel(t, row.level)}</Badge>
                  {row.active ? null : <span className="text-caption text-muted-foreground">{t("documents.accessReport.inactive")}</span>}
                </span>
                <span className="min-w-0 text-caption text-muted-foreground sm:w-48">{accessSourceLabel(t, row)}</span>
                <span className="ml-auto flex justify-end sm:w-24">
                  {row.revoke_target ? (
                    <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={() => setConfirming({ documentId: doc.id, title, row })}>
                      {t("documents.accessReport.revoke")}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
        {report.isError ? (
          <ErrorLine message={t("documents.accessReport.load_more_error")} onRetry={() => void (isFetchNextPageError ? fetchNextPage() : report.refetch())} busy={report.isFetching} />
        ) : hasNextPage ? (
          <div className="flex justify-center pt-2">
            <Button type="button" variant="outline" size="sm" aria-disabled={isFetchingNextPage || undefined} onClick={() => (isFetchingNextPage ? null : void fetchNextPage())}>
              {isFetchingNextPage ? <Spinner /> : null}
              {t("documents.accessReport.load_more")}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div id={id} className="flex flex-col">
      {body}
      <AlertDialog open={confirming !== null} onOpenChange={(open) => (open ? null : setConfirming(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{revokeText(t, principal.principal_type, "title", name)}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming ? `${confirming.title} · ${accessSourceLabel(t, confirming.row)} · ${accessLevelLabel(t, confirming.row.level)}` : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button type="button" variant="destructive" aria-disabled={revoke.isPending || undefined} onClick={() => void confirmRevoke()}>
              {revoke.isPending ? <Spinner /> : null}
              {t("documents.accessReport.revoke")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ErrorLine({ message, onRetry, busy, className }: { message: string; onRetry: () => void; busy: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-caption text-foreground", className)}>
      <CircleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
      {message}
      <Button type="button" variant="outline" size="sm" aria-disabled={busy || undefined} onClick={busy ? undefined : onRetry}>
        {busy ? <Spinner /> : null}
        {t("documents.accessReport.retry")}
      </Button>
    </div>
  );
}
