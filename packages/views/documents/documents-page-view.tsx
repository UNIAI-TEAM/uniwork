"use client";

import { useMemo, useState } from "react";
import { FilePlus2, FileText, FolderTree, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import {
  useCreateDocument,
  useCreateDocumentFile,
} from "@uniwork/core/documents/hooks";
import {
  useDocumentList,
  useRecentDocuments,
  useSharedWithMe,
} from "@uniwork/core/documents/hooks-collections";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import type { DocumentList } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import {
  CollectionPageHeader,
  CollectionPageHeaderAction,
} from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { DocumentTree, DocumentTreeSheet } from "./document-tree";
import { DocumentsGateState, useDocumentsGate } from "./documents-gate";
import { DocumentsLibraryList } from "./documents-library-list";
import { DocumentUploadDialog } from "./document-upload-dialog";

export interface DocumentsPageViewProps {
  wsId: string;
  /** Opens the document the user created, uploaded or picked from a list. */
  onOpen: (documentId: string) => void;
}

type LibraryTab = "all" | "recent" | "shared" | "archived";
type KindFilter = "all" | "page" | "file";
type DateFilter = "all" | "today" | "week" | "month";

const LIBRARY_TABS: { id: LibraryTab; labelKey: string }[] = [
  { id: "all", labelKey: "documents.library.tabs.all" },
  { id: "recent", labelKey: "documents.library.tabs.recent" },
  { id: "shared", labelKey: "documents.library.tabs.shared" },
  { id: "archived", labelKey: "documents.library.tabs.archived" },
];

/**
 * A window on `updated_at`. The presets are computed once per filter choice —
 * never per render, or the query key would change on every keystroke-like
 * render and refetch in a loop. Only the lower bound is sent: an upper bound
 * frozen when the filter was picked would hide a document updated later.
 */
function dateRange(filter: DateFilter): { from?: string } {
  if (filter === "all") return {};
  const now = new Date();
  if (filter === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString() };
  }
  const days = filter === "week" ? 7 : 30;
  return { from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString() };
}

interface LibraryPageState {
  rows: DocumentList["documents"];
  loading: boolean;
  /** Set only when the failure leaves nothing on screen. */
  failure: "error" | "permission" | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

function failureOf(error: unknown): "error" | "permission" {
  return error && classifyDocumentError(error).cls === "permission" ? "permission" : "error";
}

/** Normalizes an infinite query result onto the shape every tab shares. */
function infiniteState(q: {
  data?: { pages: DocumentList[] };
  isPending: boolean;
  isError: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
  refetch: () => unknown;
}): LibraryPageState {
  const rows = q.data?.pages.flatMap((page) => page.documents) ?? [];
  return {
    rows,
    loading: q.isPending,
    failure: q.isError && rows.length === 0 ? failureOf(q.error) : null,
    hasMore: Boolean(q.hasNextPage),
    loadingMore: q.isFetchingNextPage,
    loadMore: () => void q.fetchNextPage(),
    refetch: () => void q.refetch(),
  };
}

/**
 * `/documents` — the library.
 *
 * Tabs read real server data per collection (all/recent/shared/archived) with
 * a real count of the rows the server returned, filters only where the list
 * endpoint supports them, cursor "load more" and the sidebar tree. No tab ever
 * shows a fabricated row or a number the server did not send (C-01 §7.1).
 */
export function DocumentsPageView({ wsId, onOpen }: DocumentsPageViewProps) {
  const { t } = useTranslation();
  const { gate, retry: retryGate } = useDocumentsGate();
  const enabled = gate === "on";
  const createPage = useCreateDocument(wsId);
  const createFile = useCreateDocumentFile(wsId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [tab, setTab] = useState<LibraryTab>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [date, setDate] = useState<DateFilter>("all");
  const [treeOpen, setTreeOpen] = useState(false);

  const range = useMemo(() => dateRange(date), [date]);
  const filters = useMemo(
    () => ({
      ...(kind === "all" ? {} : { kind }),
      ...(range.from ? { updatedFrom: range.from } : {}),
    }),
    [kind, range],
  );

  const allQuery = useDocumentList(wsId, filters, { enabled: enabled && tab === "all" });
  const recentQuery = useRecentDocuments(wsId, { enabled: enabled && tab === "recent" });
  const archivedQuery = useDocumentList(wsId, { ...filters, archived: true }, {
    enabled: enabled && tab === "archived",
  });
  const sharedQuery = useSharedWithMe(wsId, { enabled: enabled && tab === "shared" });

  const states: Record<LibraryTab, LibraryPageState> = {
    all: infiniteState(allQuery),
    recent: infiniteState(recentQuery),
    shared: infiniteState(sharedQuery),
    archived: infiniteState(archivedQuery),
  };
  const queries = { all: allQuery, recent: recentQuery, shared: sharedQuery, archived: archivedQuery };
  const active = states[tab];
  const filtersApply = tab === "all" || tab === "archived";

  /** The loaded row count for a tab, and null for a tab that has not loaded yet. */
  const countFor = (id: LibraryTab): number | null =>
    id === tab || queries[id].data ? states[id].rows.length : null;

  const newPage = async () => {
    try {
      const doc = await createPage.mutateAsync({ title: t("documents.page.new_page") });
      onOpen(doc.id);
    } catch (error) {
      toast.error(apiErrorMessage(error) ?? t("documents.page.create_failed"));
    }
  };

  const uploadFile = async (file: File) => {
    setUploadError(null);
    try {
      const doc = await createFile.mutateAsync({ file });
      setUploadOpen(false);
      onOpen(doc.id);
    } catch (error) {
      setUploadError(apiErrorMessage(error) ?? t("documents.page.upload_failed"));
    }
  };

  const emptyActions = (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={createPage.isPending}
        onClick={() => void newPage()}
      >
        <FilePlus2 aria-hidden className="size-3.5" />
        {t("documents.page.new_page")}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
        <Upload aria-hidden className="size-3.5" />
        {t("documents.page.upload_file")}
      </Button>
    </>
  );

  const list = (state: LibraryPageState, tabId: LibraryTab, archived = false) => (
    <DocumentsLibraryList
      rows={state.rows}
      loading={state.loading}
      failure={state.failure}
      filtered={(kind !== "all" || date !== "all") && (tabId === "all" || tabId === "archived")}
      archived={archived}
      hasMore={state.hasMore}
      loadingMore={state.loadingMore}
      onLoadMore={state.loadMore}
      onRetry={state.refetch}
      onClearFilters={() => {
        setKind("all");
        setDate("all");
      }}
      onOpen={onOpen}
      emptyActions={emptyActions}
    />
  );

  const kindItems = [
    { value: "all", label: t("documents.library.filters.kind_all") },
    { value: "page", label: t("documents.library.filters.kind_page") },
    { value: "file", label: t("documents.library.filters.kind_file") },
  ];
  const dateItems = [
    { value: "all", label: t("documents.library.filters.date_all") },
    { value: "today", label: t("documents.library.filters.date_today") },
    { value: "week", label: t("documents.library.filters.date_week") },
    { value: "month", label: t("documents.library.filters.date_month") },
  ];
  const filterSelect = (
    label: string,
    value: string,
    items: { value: string; label: string }[],
    onChange: (next: string) => void,
  ) => (
    <Select value={value} onValueChange={(next) => next && onChange(next)} items={items} aria-label={label}>
      <SelectTrigger size="sm" variant="subtle" className="w-full sm:w-36" aria-label={label}>
        <SelectValue placeholder={label}>{items.find((item) => item.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={FileText}
        tone={moduleTone("documents")}
        title={t("documents.page.title")}
        // The count is the loaded rows of the active tab; while the first page
        // is loading (or more pages exist) the tab badge carries the story, so
        // the header never flashes a 0 or contradicts it.
        count={enabled && !active.loading && !active.hasMore ? active.rows.length : undefined}
        actions={
          <>
            <CollectionPageHeaderAction
              icon={FilePlus2}
              label={t("documents.page.new_page")}
              disabled={!enabled || createPage.isPending}
              onClick={() => void newPage()}
            />
            <CollectionPageHeaderAction
              icon={Upload}
              label={t("documents.page.upload_file")}
              disabled={!enabled}
              onClick={() => setUploadOpen(true)}
            />
          </>
        }
      />

      {gate !== "on" ? (
        <DocumentsGateState gate={gate} retry={retryGate} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-64 shrink-0 overflow-hidden border-r border-border xl:block">
            <DocumentTree wsId={wsId} onOpen={onOpen} className="h-full" />
          </aside>

          <Tabs
            value={tab}
            onValueChange={(next) => setTab(next as LibraryTab)}
            className="min-h-0 min-w-0 flex-1 gap-0"
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
              <TabsList className="max-w-full overflow-x-auto">
                {LIBRARY_TABS.map((tabDef) => {
                  const count = countFor(tabDef.id);
                  return (
                    <TabsTrigger key={tabDef.id} value={tabDef.id}>
                      {t(tabDef.labelKey)}
                      {count !== null && count > 0 ? (
                        <span className="font-mono text-caption tabular-nums text-muted-foreground">
                          {count}
                          {states[tabDef.id].hasMore ? "+" : ""}
                        </span>
                      ) : null}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              {filtersApply ? (
                <div className="flex flex-wrap items-center gap-2">
                  {filterSelect(
                    t("documents.library.filters.kind_label"),
                    kind,
                    kindItems,
                    (next) => setKind(next as KindFilter),
                  )}
                  {filterSelect(
                    t("documents.library.filters.date_label"),
                    date,
                    dateItems,
                    (next) => setDate(next as DateFilter),
                  )}
                </div>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto xl:hidden"
                onClick={() => setTreeOpen(true)}
              >
                <FolderTree aria-hidden className="size-3.5" />
                {t("documents.tree.open_trigger")}
              </Button>
            </div>

            <TabsContent value="all" className="flex min-h-0 flex-col">
              {list(states.all, "all")}
            </TabsContent>
            <TabsContent value="recent" className="flex min-h-0 flex-col">
              {list(states.recent, "recent")}
            </TabsContent>
            <TabsContent value="shared" className="flex min-h-0 flex-col">
              {list(states.shared, "shared")}
            </TabsContent>
            <TabsContent value="archived" className="flex min-h-0 flex-col">
              {list(states.archived, "archived", true)}
            </TabsContent>
          </Tabs>
        </div>
      )}

      <DocumentTreeSheet
        open={treeOpen}
        onOpenChange={setTreeOpen}
        wsId={wsId}
        enabled={enabled}
        onOpen={(id) => {
          setTreeOpen(false);
          onOpen(id);
        }}
      />

      <DocumentUploadDialog
        open={uploadOpen}
        onOpenChange={(next) => {
          if (!next) setUploadError(null);
          setUploadOpen(next);
        }}
        title={t("documents.upload.title")}
        description={t("documents.upload.description")}
        hint={t("documents.upload.size_hint")}
        pending={createFile.isPending}
        error={uploadError}
        onSubmit={(file) => void uploadFile(file)}
      />
    </div>
  );
}
