"use client";

import { useEffect, useId } from "react";
import { ArrowLeft, CircleAlert, Download, FileSearch, FolderX, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useDocumentAccessReport } from "@uniwork/core/documents/hooks-access-report";
import type { AccessReportFilters } from "@uniwork/core/types/document-access-report";
import { useMembers } from "@uniwork/core/workspaces";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { CollectionPageHeader, CollectionPageState } from "../../layout/collection-page";
import { MODULE_ICONS } from "../../layout/module-icons";
import { moduleTone } from "../../layout/module-tones";
import { AppLink, useNavigation } from "../../navigation";
import { AccessReportFiltersBar } from "./access-report-filters";
import { REPORT_LEVELS } from "./access-report-labels";
import { AccessReportTable } from "./access-report-table";
import { useAccessReportExport } from "./use-access-report-export";

export interface AccessReportViewProps {
  wsId: string;
  workspaceName: string;
  workspaceSlug: string;
  /** The Documents library, for the way back and the "folder gone" state. */
  libraryHref: string;
  /** Opens a document from its title; without it titles are plain text. */
  documentHref?: (documentId: string) => string;
}

/** Consecutive empty pages the screen reads on its own once documents are shown. */
const MAX_EMPTY_PAGES = 5;

const VISIBILITIES: readonly string[] = ["workspace", "restricted"];

/** The folder and the filters live in the URL, so a report can be shared and reloaded. */
function readQuery(params: URLSearchParams): { folderId: string | undefined; filters: AccessReportFilters } {
  const levels = (params.get("level") ?? "").split(",").filter((l) => (REPORT_LEVELS as readonly string[]).includes(l));
  const visibility = params.get("visibility") ?? "";
  return {
    folderId: params.get("folder") || undefined,
    filters: {
      personId: params.get("person") || undefined,
      levels,
      visibility: VISIBILITIES.includes(visibility) ? visibility : undefined,
    },
  };
}

/**
 * `/documents/access-report` (UNI-1643): who holds which level on every document
 * the reader manages, in the whole workspace or one folder and its subfolders.
 * Read-only — the table only reports, the share panel of a document changes
 * grants. Documents the reader can open but does not manage are counted, never
 * listed, so the screen does not reveal who else has access to them.
 */
export function AccessReportView({ wsId, workspaceName, workspaceSlug, libraryHref, documentHref }: AccessReportViewProps) {
  const { t } = useTranslation();
  const { pathname, searchParams, replace } = useNavigation();
  const { folderId, filters } = readQuery(searchParams);

  const report = useDocumentAccessReport(wsId, folderId, filters);
  const exporter = useAccessReportExport(wsId, workspaceSlug, { folderId, ...filters });
  const members = useMembers(filters.personId ? wsId : "").data;

  const pages = report.data?.pages ?? [];
  const documents = pages.flatMap((page) => page.documents);
  const skipped = pages.reduce((sum, page) => sum + page.summary.skipped, 0);
  const folderTitle = pages[0]?.scope.folder_title ?? null;

  // A page can come back empty yet keep a cursor (the documents it read were not
  // the reader's to manage): keep reading rather than call the report empty.
  // With nothing shown yet there is no other way forward, so it reads on; once
  // documents are shown it reads through a bounded run of empty pages, then
  // leaves "Load more" to the reader.
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = report;
  let trailingEmpty = 0;
  while (trailingEmpty < pages.length && pages[pages.length - 1 - trailingEmpty]!.documents.length === 0) trailingEmpty++;
  const readOn = documents.length === 0 ? true : trailingEmpty > 0 && trailingEmpty < MAX_EMPTY_PAGES;
  useEffect(() => {
    if (report.data && readOn && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [report.data, readOn, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const personName = filters.personId
    ? (members?.find((m) => m.user_id === filters.personId)?.display_name ??
      documents
        .flatMap((d) => d.rows)
        .find((row) => row.principal_type === "user" && row.principal_id === filters.personId)?.principal_name ??
      null)
    : null;

  const setFilters = (next: AccessReportFilters) => {
    const params = new URLSearchParams(searchParams.toString());
    const set = (key: string, value: string | undefined) => (value ? params.set(key, value) : params.delete(key));
    set("person", next.personId);
    set("level", (next.levels ?? []).join(","));
    set("visibility", next.visibility);
    const qs = params.toString();
    replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const status = report.error instanceof ApiError ? report.error.status : 0;
  const unusable = report.isError && (status === 403 || status === 404);
  const scope = folderId
    ? t("documents.accessReport.scope_folder", { path: folderTitle ?? "" })
    : t("documents.accessReport.scope_workspace", { name: workspaceName });

  const noRows = !report.isPending && !report.isError && documents.length === 0 && !hasNextPage;
  // A file with no rows names its filter and time only in its file name: say so
  // beside the buttons that make it. Not when documents were merely skipped.
  const emptyNoteId = useId();
  const showEmptyNote = noRows && skipped === 0;

  // The icon is joined by a short word on a phone ("CSV", "Excel") and by the full label from md up.
  const exportButton = (format: "csv" | "xlsx", label: string, short: string) => {
    const busy = exporter.busy === format;
    return (
      <Button
        type="button"
        size="sm"
        variant="toolbar"
        className="h-8 gap-1 px-2.5"
        aria-disabled={exporter.busy ? true : undefined}
        aria-label={busy ? t("documents.accessReport.exporting") : label}
        aria-describedby={showEmptyNote ? emptyNoteId : undefined}
        onClick={() => exporter.run(format)}
      >
        {busy ? <Spinner className="size-3.5" /> : <Download aria-hidden className="size-3.5" />}
        <span className="md:hidden">{short}</span>
        <span className="hidden md:inline">{busy ? t("documents.accessReport.exporting") : label}</span>
      </Button>
    );
  };

  const back = (
    <AppLink href={libraryHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
      <ArrowLeft aria-hidden className="size-3.5" />
      {t("documents.page.title")}
    </AppLink>
  );

  let body: React.ReactNode;
  if (report.isPending) {
    body = (
      <div role="status" aria-label={t("documents.accessReport.loading")} className="flex items-center justify-center gap-2 py-16 text-caption text-muted-foreground">
        <Spinner />
        {t("documents.accessReport.loading")}
      </div>
    );
  } else if (report.isError && status === 403) {
    body = (
      <CollectionPageState icon={ShieldAlert} tone="destructive" role="alert" title={t("documents.accessReport.forbidden")} actions={back} />
    );
  } else if (report.isError && status === 404) {
    body = (
      <CollectionPageState icon={FolderX} tone="destructive" role="alert" title={t("documents.accessReport.folder_unavailable")} actions={back} />
    );
  } else if (report.isError && documents.length === 0) {
    // Nothing to keep on screen: the first page (or a refetch that left no documents) failed.
    body = (
      <CollectionPageState
        icon={CircleAlert}
        tone="destructive"
        role="alert"
        title={t("documents.accessReport.error")}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => void report.refetch()}>
            {t("documents.accessReport.retry")}
          </Button>
        }
      />
    );
  } else if (documents.length === 0 && !hasNextPage) {
    body =
      skipped > 0 ? (
        <CollectionPageState icon={ShieldAlert} title={t("documents.accessReport.skipped_only")} description={t("documents.accessReport.skipped", { count: skipped })} />
      ) : (
        <CollectionPageState icon={FileSearch} title={t("documents.accessReport.empty")} description={t("documents.accessReport.footnote")} />
      );
  } else if (documents.length === 0) {
    body = (
      <div role="status" aria-label={t("documents.accessReport.loading")} className="flex items-center justify-center gap-2 py-16 text-caption text-muted-foreground">
        <Spinner />
        {t("documents.accessReport.loading")}
      </div>
    );
  } else {
    body = (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4">
        {skipped > 0 ? <p className="text-caption text-muted-foreground">{t("documents.accessReport.skipped", { count: skipped })}</p> : null}
        <AccessReportTable
          documents={documents}
          documentHref={documentHref}
          onPickPerson={(personId) => setFilters({ ...filters, personId })}
        />
        {report.isError ? (
          // A later page failed: the documents above stay, and only that page is asked for again.
          <div role="alert" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-3 py-2 text-caption text-foreground">
            <CircleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
            {t("documents.accessReport.load_more_error")}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={report.isFetching}
              aria-busy={report.isFetching || undefined}
              onClick={() => void (isFetchNextPageError ? fetchNextPage() : report.refetch())}
            >
              {report.isFetching ? <Spinner /> : null}
              {t("documents.accessReport.retry")}
            </Button>
          </div>
        ) : hasNextPage ? (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isFetchingNextPage}
              aria-busy={isFetchingNextPage || undefined}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage ? <Spinner /> : null}
              {t("documents.accessReport.load_more")}
            </Button>
          </div>
        ) : null}
        <p className="text-caption text-muted-foreground">{t("documents.accessReport.footnote")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={MODULE_ICONS.documents}
        tone={moduleTone("documents")}
        title={t("documents.accessReport.title")}
        count={documents.length}
        description={report.isPending || unusable ? undefined : scope}
        actions={
          unusable ? null : (
            <>
              {exportButton("csv", t("documents.accessReport.export_csv"), t("documents.accessReport.export_csv_short"))}
              {exportButton("xlsx", t("documents.accessReport.export_xlsx"), t("documents.accessReport.export_xlsx_short"))}
            </>
          )
        }
      />
      {unusable ? null : (
        <>
          {showEmptyNote ? (
            <p id={emptyNoteId} className="border-b border-border px-4 py-1.5 text-right text-caption text-muted-foreground">
              {t("documents.accessReport.empty_export_note")}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">{back}</div>
          <AccessReportFiltersBar
            wsId={wsId}
            filters={filters}
            personName={personName}
            onChange={setFilters}
            onReset={() => setFilters({})}
          />
        </>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </div>
  );
}
