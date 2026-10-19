"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Member } from "@uniwork/core/types/workspace";
import { DocumentsLibraryList } from "./documents-library-list";
import type { LibraryRowHandlers } from "./documents-library-row";
import type { ShelvedRowActions } from "./documents-shelved-row";
import { ShelvedToolbar, SHELVED_BY_SYSTEM, type ShelvedByOption } from "./documents-shelved-toolbar";
import { groupRows, type TypeChip } from "./library-rows";
import type { useDocumentsLibrary } from "./use-documents-library";

export interface DocumentsShelvedViewProps {
  library: ReturnType<typeof useDocumentsLibrary>;
  chip: TypeChip;
  onChip: (chip: TypeChip) => void;
  /** The workspace members (the "Lưu trữ bởi" options and column). */
  members: Member[] | undefined;
  memberIndex: ReadonlyMap<string, Member>;
  handlers: LibraryRowHandlers;
  actions: ShelvedRowActions;
  /** The "open the navigation" button below `xl`. */
  navButton: ReactNode;
}

/**
 * The Lưu trữ view (Archive.dc, ARCHIVE-01 U-2): its heading and intro, the
 * shelved toolbar (Loại chips + "Lưu trữ bởi") and one flat table in the
 * server's shelved_at-newest order, as its sort label says (F1).
 */
export function DocumentsShelvedView({ library, chip, onChip, members, memberIndex, handlers, actions, navButton }: DocumentsShelvedViewProps) {
  const { t } = useTranslation();
  const state = library.state;
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
  const filtered = chip !== "all" || library.shelvedBy !== null;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-title font-semibold">{t("documents.shelved_list.title")}</h2>
          <p className="text-caption text-muted-foreground">{t("documents.shelved_list.intro")}</p>
        </div>
        {navButton}
      </div>
      <ShelvedToolbar
        chip={chip}
        onChip={onChip}
        shelvedByOptions={shelvedByOptions}
        shelvedBy={library.shelvedBy}
        onShelvedBy={library.setShelvedBy}
      />
      <DocumentsLibraryList
        groups={groupRows(state.rows, "none", library.folderIndex)}
        loading={state.loading}
        failure={state.failure}
        filteredBy={filtered ? (library.clientFiltered ? "client" : "server") : null}
        typeFiltered={chip !== "all"}
        emptyFiltered={{
          title: t("documents.shelved_list.no_matches_title"),
          description: t("documents.shelved_list.no_matches_description"),
        }}
        shelved={{ actions, members: memberIndex, membersReady: Boolean(members) }}
        hasMore={state.hasMore}
        loadingMore={state.loadingMore}
        onLoadMore={state.loadMore}
        onRetry={state.refetch}
        onClearFilters={() => {
          onChip("all");
          library.setShelvedBy(null);
        }}
        handlers={handlers}
        empty={{ title: t("documents.shelved_list.empty_title"), description: t("documents.shelved_list.empty_description") }}
      />
    </div>
  );
}
