"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Member } from "@uniwork/core/types/workspace";
import { DocumentsLibraryList } from "./documents-library-list";
import type { LibraryRowHandlers } from "./documents-library-row";
import type { DocListBulk } from "./doclist/bulk-actions";
import { ShelvedToolbar, SHELVED_BY_SYSTEM, type ShelvedByOption } from "./documents-shelved-toolbar";
import type { DocumentSummaryRow, DocumentTypeFilter, LibraryRow } from "./library-rows";
import type { useDocumentsLibrary } from "./use-documents-library";

/** The commands a shelved row offers (ARCHIVE-01 U-3/U-4). The page owns the
 *  mutations and their toasts; the row only names the item asked for. */
interface ShelvedRowActions {
  /** Bỏ lưu trữ: brings the item (and its same-batch shelved descendants the caller manages) back live. */
  onUnshelve: (doc: DocumentSummaryRow) => void;
  /** Chuyển vào thùng rác: the trash archive command (its own dialog), manage only. */
  onTrash: (doc: DocumentSummaryRow) => void;
  /** True while that item's unshelve request runs: its button is disabled, a second click sends nothing. */
  isUnshelving: (documentId: string) => boolean;
}

export interface DocumentsShelvedViewProps {
  library: ReturnType<typeof useDocumentsLibrary>;
  types: DocumentTypeFilter[];
  onTypes: (types: DocumentTypeFilter[]) => void;
  /** The workspace members (the "Lưu trữ bởi" options; the column reads `handlers.member`). */
  members: Member[] | undefined;
  handlers: LibraryRowHandlers;
  actions: ShelvedRowActions;
  /** The bulk bar's commands (W9): Bỏ lưu trữ · Tải xuống · Chuyển vào thùng rác; absent, no Select column. */
  bulk?: DocListBulk;
  /** A new value clears the selection. */
  selectionKey?: string;
  /** The search box rendered at the right end of the filter row (UNI-2205). */
  search?: ReactNode;
  /** Active search state when a query is entered on Lưu trữ (UNI-2205). */
  searchList?: {
    rows: LibraryRow[];
    loading: boolean;
    failure: "error" | "permission" | null;
    hasMore: boolean;
    loadingMore: boolean;
    loadMore: () => void;
    refetch: () => void;
    query: string;
    onClearSearch: () => void;
  } | null;
}

/**
 * The Lưu trữ view (Archive.dc, ARCHIVE-01 U-2): under the shared screen head
 * (its h1 and intro, documents-screen-head.tsx), the shelved toolbar (the shared filter bar + "Lưu trữ bởi") and the shared document list
 * with `screen="shelved"` (UNI-2045 W3): the Lưu trữ column (avatar + who
 * shelved · date), `Bỏ lưu trữ` · ⋯ on the row and the menu `Mở` · `Bỏ lưu
 * trữ` · `Tải xuống` │ `Chuyển vào thùng rác`, flat in the server's
 * shelved_at-newest order (F1).
 */
export function DocumentsShelvedView({
  library, types, onTypes, members, handlers, actions, bulk, selectionKey, search, searchList,
}: DocumentsShelvedViewProps) {
  const { t } = useTranslation();
  const state = searchList ?? library.state;
  // The "Lưu trữ bởi" options (U-2/Q-UI2): the workspace members plus the
  // former-member ids the loaded rows still carry, and a system entry when a
  // row was shelved by nobody. Filtering itself runs client-side in
  // useDocumentsLibrary; the toolbar says so.
  const shelvedByOptions: ShelvedByOption[] = [
    ...(members ?? []).map((m) => ({ value: m.user_id, label: m.display_name })),
    ...library.shelverIds
      .filter((id) => !(members ?? []).some((m) => m.user_id === id))
      .map((id) => ({ value: id, label: t("documents.shelved_list.shelved_by_former") })),
    ...(library.shelvedHasSystem ? [{ value: SHELVED_BY_SYSTEM, label: t("documents.shelved_list.shelved_by_system") }] : []),
  ];
  const filtered =
    Boolean(searchList) || types.length > 0 || library.shelvedBy !== null || library.editor !== "any" || library.updated !== "any";
  return (
    <>
      <ShelvedToolbar
        types={types}
        onTypes={onTypes}
        editor={library.editor}
        onEditor={library.setEditor}
        members={members}
        updated={library.updated}
        onUpdated={library.setUpdated}
        shelvedByOptions={shelvedByOptions}
        shelvedBy={library.shelvedBy}
        onShelvedBy={library.setShelvedBy}
        search={search}
      />
      <DocumentsLibraryList
        groups={[{ key: "all", rows: state.rows }]}
        loading={state.loading}
        failure={state.failure}
        filteredBy={filtered ? (!searchList && library.clientFiltered ? "client" : "server") : null}
        emptyFiltered={
          searchList
            ? {
                title: t("documents.home.search.no_results_title", { query: searchList.query }),
                description: undefined,
              }
            : {
                title: t("documents.shelved_list.no_matches_title"),
                description: t("documents.shelved_list.no_matches_description"),
              }
        }
        clearFiltersLabel={searchList ? t("documents.home.search.clear") : undefined}
        screen="shelved"
        sort={library.sortControl}
        selectable={Boolean(bulk)}
        bulk={bulk}
        selectionKey={selectionKey}
        hasMore={state.hasMore}
        loadingMore={state.loadingMore}
        onLoadMore={state.loadMore}
        onRetry={state.refetch}
        onClearFilters={() => {
          if (searchList) {
            searchList.onClearSearch();
            return;
          }
          onTypes([]);
          library.clearFilters();
        }}
        handlers={{ ...handlers, onUnshelve: actions.onUnshelve, onArchive: actions.onTrash, isBusy: actions.isUnshelving }}
        empty={{ title: t("documents.shelved_list.empty_title"), description: t("documents.shelved_list.empty_description") }}
      />
    </>
  );
}
