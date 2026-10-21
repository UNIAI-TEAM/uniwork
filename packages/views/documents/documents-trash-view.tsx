"use client";

import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DocumentsLibraryList } from "./documents-library-list";
import type { LibraryRowHandlers } from "./documents-library-row";
import type { DocListBulk } from "./doclist/bulk-actions";
import type { LibraryRow } from "./library-rows";
import type { TrashActions } from "./use-trash-actions";

export interface DocumentsTrashViewProps {
  /** The archived list the page already fetches, `deleted` ascending (Q2). */
  rows: LibraryRow[];
  loading: boolean;
  failure: "error" | "permission" | null;
  onRetry: () => void;
  /** The row commands RESTORE-01 wires: restore (direct) and purge (dialog the page renders). */
  actions: TrashActions;
  /** The page's row handlers: open, the member lookup of the Đã xóa column, ... */
  handlers: LibraryRowHandlers;
  /** The trashed document a notification pointed at (`?focus=`); its row is highlighted, scrolled to, and its Khôi phục focused. */
  focusId?: string | null;
  /** The first time a focus id is claimed: "focus" scrolls and moves the keyboard, "reveal" only scrolls (the row came in through a Load more the user pressed). Later mounts (scope switch, refetch) get null and keep the highlight. */
  claimFocus?: (documentId: string) => "focus" | "reveal" | null;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** The bulk bar's commands (W9): Khôi phục · Xóa vĩnh viễn over the selection; absent, no Select column. */
  bulk?: DocListBulk;
  /** A new value clears the selection. */
  selectionKey?: string;
}

/**
 * The Thùng rác screen: its heading and the 30-day intro, the shared document
 * list with `screen="trash"` (the Đã xóa column, `Khôi phục` · ⋯ on the row,
 * the menu `Khôi phục` · `Xem chi tiết` │ `Xóa vĩnh viễn`; UNI-2045 W2) and the
 * restore note. The order is the server's `deleted` ascending, so no header
 * sorts. Presentational: the page owns the queries, the restore mutation and
 * the purge dialog (use-trash-actions); every command needs manage
 * (`canManageTrashed`, RESTORE-01).
 */
export function DocumentsTrashView({
  rows,
  loading,
  failure,
  onRetry,
  actions,
  handlers,
  focusId,
  claimFocus,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  bulk,
  selectionKey,
}: DocumentsTrashViewProps) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const pagedFromCount = useRef<number | null>(null);
  useEffect(() => {
    const box = boxRef.current;
    const rowOf = (id: string) =>
      [...(box?.querySelectorAll<HTMLElement>("tr[data-library-row]") ?? [])].find((tr) => tr.dataset.libraryRow === id);
    const prevCount = !loadingMore ? pagedFromCount.current : null;
    if (!loadingMore && pagedFromCount.current !== null && (rows.length > pagedFromCount.current || !hasMore)) {
      pagedFromCount.current = null;
    }
    const rowEl = focusId ? rowOf(focusId) : undefined;
    const claim = focusId && rowEl ? claimFocus?.(focusId) : null;
    if (rowEl && claim) {
      rowEl.scrollIntoView?.({ block: "center" });
      if (claim === "focus" || !hasMore) {
        const restore = rowEl.querySelector<HTMLElement>("[data-trash-restore]");
        if (restore) {
          // focusVisible: the move comes from a pointer click on a notification, which alone would hide the ring.
          restore.focus({ focusVisible: true } as FocusOptions);
          return;
        }
      } else {
        return;
      }
    }
    if (prevCount !== null && !hasMore) {
      const firstNew = rows[prevCount] ? rowOf(rows[prevCount].id) : undefined;
      const target = firstNew?.querySelector<HTMLElement>("[data-trash-restore]") ?? box?.querySelector<HTMLElement>("table");
      target?.focus({ focusVisible: true } as FocusOptions);
    }
  }, [focusId, claimFocus, rows, hasMore, loadingMore]);

  return (
    <div ref={boxRef} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-semibold">{t("documents.trash.title")}</h1>
        <p className="text-caption text-muted-foreground">{t("documents.trash.subtitle")}</p>
      </div>
      <DocumentsLibraryList
        groups={[{ key: "all", rows }]}
        loading={loading}
        failure={failure}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={() => {
          if (!onLoadMore) return;
          pagedFromCount.current = rows.length;
          onLoadMore();
        }}
        onRetry={onRetry}
        onClearFilters={() => {}}
        handlers={{
          ...handlers,
          onRestore: actions.onRestore,
          onPurge: actions.onPurge,
          isBusy: actions.isRestoring,
          onViewDetails: (doc) => handlers.onOpen(doc.id),
        }}
        screen="trash"
        selectable={Boolean(bulk)}
        bulk={bulk}
        selectionKey={selectionKey}
        label={t("documents.trash.title")}
        highlightId={focusId}
        empty={{ icon: Trash2, title: t("documents.home.empty.archived_title"), description: t("documents.home.empty.archived_description") }}
      />
      {/* Always rendered so a screen reader hears the text when it appears; empty it takes no room. */}
      <p role="status" className="text-caption text-muted-foreground empty:sr-only">
        {focusId && hasMore && !rows.some((row) => row.id === focusId) ? t("documents.trash.focus_further") : null}
      </p>
      <p className="rounded-lg bg-muted px-3 py-2.5 text-caption text-muted-foreground">{t("documents.trash.note")}</p>
    </div>
  );
}
