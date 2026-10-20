"use client";

import { useEffect, useId, useState } from "react";
import { ChevronLeft, ChevronRight, CircleAlert, FileSearch, FolderX, Info, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@uniwork/core/api";
import {
  useDocumentAccessReport,
  useDocumentAccessReportPrincipals,
  useDocumentAccessReportSummary,
} from "@uniwork/core/documents/hooks-access-report";
import { documentKeys } from "@uniwork/core/documents/keys";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { CollectionPageState } from "../../layout/collection-page";
import { AppLink, useNavigation } from "../../navigation";
import { AccessReportFiltersBar } from "./access-report-filters";
import { AccessReportHeader } from "./access-report-header";
import { AccessReportPeople } from "./access-report-people";
import { readReportQuery, writeReportQuery, type ReportQueryState, type ReportView } from "./access-report-query";
import { AccessReportTable } from "./access-report-table";
import { AccessReportTiles } from "./access-report-tiles";

export interface AccessReportViewProps {
  wsId: string;
  workspaceName: string;
  workspaceSlug: string;
  /** The Documents library, for the breadcrumb and the "folder gone" state. */
  libraryHref: string;
  /** Opens a document from its row; without it there is no "Open document". */
  documentHref?: (documentId: string) => string;
}

/** Consecutive empty pages the screen reads on its own before it waits for the reader. */
const MAX_EMPTY_PAGES = 5;
/** The By person tab's default order: the principals the tab and its line share. */
const PEOPLE_DEFAULT_SORT = { sort: "count", order: "desc" } as const;

/**
 * `/documents/access-report` (UNI-1643, redesigned in UNI-2039): who holds
 * which level on every document the reader manages, in the whole workspace or
 * one folder and its subfolders. Four whole-scope totals sit on top; the list
 * reads By document or By person. The scope, the tab, the filters and the sort
 * live in the URL. Documents the reader can open but does not manage are
 * counted, never listed, so the screen does not reveal who else has access.
 */
export function AccessReportView({ wsId, workspaceName, workspaceSlug, libraryHref, documentHref }: AccessReportViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pathname, searchParams, replace } = useNavigation();
  const state = readReportQuery(searchParams);
  const { folderId, view, filters, sort, order, kind } = state;
  const people = view === "people";

  const setState = (patch: Partial<ReportQueryState>) => {
    const qs = writeReportQuery(searchParams, { ...state, ...patch });
    replace(qs ? `${pathname}?${qs}` : pathname);
  };

  // The report also names the folder and answers 403/404 for the scope, so it
  // is read on both tabs.
  const report = useDocumentAccessReport(wsId, folderId, { ...filters, sort, order });
  // Tiles follow the scope only; the count under the list follows the filters.
  // With no filter both are the same query.
  const tiles = useDocumentAccessReportSummary(wsId, folderId, {});
  const matching = useDocumentAccessReportSummary(wsId, folderId, filters, { enabled: !people });
  const principals = useDocumentAccessReportPrincipals(
    wsId,
    { folderId, q: filters.q, kind, levels: filters.levels, ...PEOPLE_DEFAULT_SORT },
    { enabled: people },
  );

  const pages = report.data?.pages ?? [];
  const folderTitle = pages[0]?.scope.folder_title ?? null;
  const pageSkipped = pages.reduce((sum, p) => sum + p.summary.skipped, 0);
  const skipped = tiles.data?.skipped ?? pageSkipped;

  // Previous / Next walk the pages already read; a page that came back empty
  // (the server read documents the reader does not manage) is not one of them.
  const shown = pages.map((p) => p.documents).filter((docs) => docs.length > 0);
  const pagerKey = JSON.stringify([folderId, filters, sort, order]);
  const [pager, setPager] = useState({ key: pagerKey, index: 0, advancing: false });
  if (pager.key !== pagerKey) setPager({ key: pagerKey, index: 0, advancing: false });
  const index = pager.key === pagerKey ? Math.min(pager.index, Math.max(shown.length - 1, 0)) : 0;
  const advancing = pager.key === pagerKey && pager.advancing;
  const documents = shown[index] ?? [];
  const from = shown.slice(0, index).reduce((sum, docs) => sum + docs.length, 0) + 1;

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = report;
  let trailingEmpty = 0;
  while (trailingEmpty < pages.length && pages[pages.length - 1 - trailingEmpty]!.documents.length === 0) trailingEmpty++;
  // Nothing shown yet: read on until something is. Asked for the next page:
  // read on through a bounded run of empty pages.
  const readOn = !report.isPlaceholderData && (shown.length === 0 || (advancing && index + 1 >= shown.length && trailingEmpty < MAX_EMPTY_PAGES));
  useEffect(() => {
    if (report.data && readOn && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [report.data, readOn, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  // The page asked for has arrived (or there is none to come): move onto it.
  if (advancing && (index + 1 < shown.length || (!hasNextPage && !isFetchingNextPage) || trailingEmpty >= MAX_EMPTY_PAGES)) {
    setPager({ key: pagerKey, index: index + 1 < shown.length ? index + 1 : index, advancing: false });
  }

  const canNext = index + 1 < shown.length || Boolean(hasNextPage);
  const next = () => {
    if (index + 1 < shown.length) setPager({ key: pagerKey, index: index + 1, advancing: false });
    else if (hasNextPage) setPager({ key: pagerKey, index, advancing: true });
  };
  const prev = () => setPager({ key: pagerKey, index: Math.max(index - 1, 0), advancing: false });

  const status = report.error instanceof ApiError ? report.error.status : 0;
  const unusable = report.isError && (status === 403 || status === 404);
  const noRows = !report.isPending && !report.isPlaceholderData && !report.isError && shown.length === 0 && !hasNextPage;
  // A file with no rows names its filter and time only in its file name: say so
  // beside the button that makes it. Not when documents were merely skipped.
  const emptyNoteId = useId();
  const showEmptyNote = noRows && pageSkipped === 0;

  const back = (
    <AppLink href={libraryHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
      {t("documents.page.title")}
    </AppLink>
  );
  const loading = (
    <div role="status" aria-label={t("documents.accessReport.loading")} className="flex items-center justify-center gap-2 py-16 text-caption text-muted-foreground">
      <Spinner />
      {t("documents.accessReport.loading")}
    </div>
  );

  let body: React.ReactNode;
  if (report.isPending) {
    body = loading;
  } else if (report.isError && shown.length === 0) {
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
  } else if (noRows) {
    body =
      pageSkipped > 0 ? (
        <CollectionPageState icon={ShieldAlert} title={t("documents.accessReport.skipped_only")} description={t("documents.accessReport.skipped", { count: pageSkipped })} />
      ) : (
        <CollectionPageState icon={FileSearch} title={t("documents.accessReport.empty")} description={t("documents.accessReport.footnote")} />
      );
  } else if (shown.length === 0) {
    body = loading;
  } else {
    const total = matching.data?.matching_documents;
    // After a failed next page nothing is loading: the banner's Retry is the way on.
    const busy = isFetchingNextPage || (advancing && !isFetchNextPageError);
    body = (
      <div className="flex flex-col gap-3">
        <AccessReportTable
          wsId={wsId}
          documents={documents}
          sort={sort}
          order={order}
          onSortChange={(s) => setState(s)}
          documentHref={documentHref}
        />
        {isFetchNextPageError ? (
          // A later page failed: the documents above stay, and only that page is asked for again.
          <div role="alert" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-3 py-2 text-caption text-foreground">
            <CircleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
            {t("documents.accessReport.load_more_error")}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={report.isFetching}
              onClick={() => {
                setPager({ key: pagerKey, index, advancing: true });
                void fetchNextPage();
              }}
            >
              {t("documents.accessReport.retry")}
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
          <span>
            {total !== undefined
              ? t("documents.accessReport.count_range", {
                  from,
                  to: from + documents.length - 1,
                  total: matching.data?.truncated ? `${total}+` : total,
                })
              : null}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" aria-disabled={index === 0 || undefined} onClick={() => index > 0 && prev()}>
              <ChevronLeft aria-hidden />
              {t("documents.accessReport.prev")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-disabled={!canNext || busy || undefined}
              aria-busy={busy || undefined}
              onClick={() => canNext && !busy && next()}
            >
              {t("documents.accessReport.next")}
              {busy ? <Spinner aria-hidden role="presentation" /> : <ChevronRight aria-hidden />}
            </Button>
          </div>
        </div>
        <p className="text-caption text-muted-foreground">{t("documents.accessReport.footnote")}</p>
      </div>
    );
  }

  const principalCount = principals.data?.principals.length;
  const docCount = tiles.data?.tiles.documents;
  // The principals count follows the people filters and the document count is
  // the whole scope, so the pair is only said when no filter narrows the people.
  const peopleNarrowed = Boolean(filters.q || kind || filters.levels?.length);
  const line = people
    ? principalCount !== undefined && docCount !== undefined && !peopleNarrowed
      ? t("documents.accessReport.principals_line", { principals: principalCount, count: docCount })
      : null
    : skipped > 0
      ? t("documents.accessReport.skipped_line", { count: skipped })
      : null;

  const filtersBar = (
    <AccessReportFiltersBar
      wsId={wsId}
      folderId={folderId}
      view={view}
      filters={filters}
      kind={kind}
      onFiltersChange={(f) => setState({ filters: f })}
      onKindChange={(k) => setState({ kind: k })}
      onReset={() => setState({ filters: {}, kind: undefined })}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AccessReportHeader
        wsId={wsId}
        workspaceName={workspaceName}
        workspaceSlug={workspaceSlug}
        libraryHref={libraryHref}
        folderId={folderId}
        folderTitle={folderTitle}
        filters={filters}
        generatedAt={pages[0]?.generated_at}
        onFolderChange={(id) => setState({ folderId: id })}
        onRefresh={() => void queryClient.invalidateQueries({ queryKey: documentKeys.accessReportRoot(wsId) })}
        refreshing={report.isRefetching && !isFetchingNextPage}
        exportDescribedBy={showEmptyNote ? emptyNoteId : undefined}
      />
      {showEmptyNote ? (
        <p id={emptyNoteId} className="px-4 pb-2 text-right text-caption text-muted-foreground">
          {t("documents.accessReport.empty_export_note")}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {unusable ? (
          status === 403 ? (
            <CollectionPageState icon={ShieldAlert} tone="destructive" role="alert" title={t("documents.accessReport.forbidden")} actions={back} />
          ) : (
            <CollectionPageState icon={FolderX} tone="destructive" role="alert" title={t("documents.accessReport.folder_unavailable")} actions={back} />
          )
        ) : (
          <div className="flex w-full flex-col gap-4 px-4 pb-6">
            {people ? null : (
              <AccessReportTiles
                totals={tiles.data}
                failed={tiles.isError}
                flag={filters.flag}
                onPick={(flag) => setState({ filters: { ...filters, flag } })}
              />
            )}
            <Tabs value={view} onValueChange={(v) => setState({ view: v as ReportView })} className="gap-4">
              <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-b border-border">
                <TabsList variant="line" aria-label={t("documents.accessReport.tabs_label")}>
                  <TabsTrigger value="documents">{t("documents.accessReport.tab_documents")}</TabsTrigger>
                  <TabsTrigger value="people">{t("documents.accessReport.tab_people")}</TabsTrigger>
                </TabsList>
                {line ? (
                  <p className="flex items-center gap-1.5 pb-2 text-caption text-muted-foreground">
                    <Info aria-hidden className="size-3.5 shrink-0" />
                    {line}
                  </p>
                ) : null}
              </div>
              <TabsContent value="documents" className="flex flex-col gap-3">
                {filtersBar}
                {body}
              </TabsContent>
              <TabsContent value="people" className="flex flex-col gap-3">
                {filtersBar}
                {people ? (
                  <AccessReportPeople wsId={wsId} folderId={folderId} search={filters.q} kind={kind} levels={filters.levels} documentHref={documentHref} />
                ) : null}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
