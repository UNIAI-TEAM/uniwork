"use client";

import type { ReactNode } from "react";
import { File, FileText, FolderOpen, Search, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DocumentList } from "@uniwork/core/types/document";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageState } from "../layout/collection-page";

/** A list row as the wire schema parses it (server enums stay lenient). */
export type DocumentLibraryRow = DocumentList["documents"][number];

/** Compact date of the last update; "—" when the server sent nothing usable. */
function formatUpdatedAt(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale || undefined, { dateStyle: "medium" }).format(date);
}

export interface DocumentsLibraryListProps {
  rows: DocumentLibraryRow[];
  /** First page still loading: skeleton rows, never fake counts or rows. */
  loading: boolean;
  /** The query failed and no rows are cached; `permission` is a 403 tab. */
  failure: "error" | "permission" | null;
  /** The rows are empty because a filter is on, not because the library is. */
  filtered: boolean;
  /** Show the archive badge on every row (the archive tab). */
  archived?: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onClearFilters: () => void;
  onOpen: (documentId: string) => void;
  /** Create page / upload file, offered when the library is truly empty. */
  emptyActions?: ReactNode;
}

/**
 * The library body: loading skeleton, empty/error states and the rows the
 * server returned. It is deliberately presentational — the page view owns the
 * queries and the tabs, so every row on screen comes from a server answer and
 * nothing is optimistically inserted.
 */
export function DocumentsLibraryList({
  rows,
  loading,
  failure,
  filtered,
  archived = false,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
  onClearFilters,
  onOpen,
  emptyActions,
}: DocumentsLibraryListProps) {
  const { t, i18n } = useTranslation();

  if (loading) {
    return (
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4" aria-busy="true" aria-label={t("documents.library.loading")}>
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-11 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (failure === "permission") {
    return (
      <CollectionPageState
        icon={ShieldAlert}
        title={t("documents.library.permission_title")}
        description={t("documents.library.permission_description")}
        role="status"
        actions={
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("documents.library.retry")}
          </Button>
        }
      />
    );
  }

  if (failure === "error") {
    return (
      <CollectionPageState
        icon={ShieldAlert}
        title={t("documents.library.error_title")}
        description={t("documents.library.error_description")}
        tone="destructive"
        role="alert"
        actions={
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("documents.library.retry")}
          </Button>
        }
      />
    );
  }

  if (rows.length === 0) {
    if (filtered) {
      return (
        <CollectionPageState
          icon={Search}
          title={t("documents.library.no_matches_title")}
          description={t("documents.library.no_matches_description")}
          role="status"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
              {t("documents.library.clear_filters")}
            </Button>
          }
        />
      );
    }
    return (
      <CollectionPageState
        icon={FolderOpen}
        title={t("documents.library.empty_title")}
        description={t("documents.library.empty_description")}
        role="status"
        actions={emptyActions}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ul aria-label={t("documents.page.title")}>
        {rows.map((doc) => (
          <li key={doc.id} className="border-b border-border last:border-b-0">
            <button
              type="button"
              onClick={() => onOpen(doc.id)}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent/50",
              )}
            >
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
                {doc.icon ? (
                  <span className="text-base leading-none">{doc.icon}</span>
                ) : doc.kind === "file" ? (
                  <File className="size-4" />
                ) : (
                  <FileText className="size-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-body">{doc.title || t("documents.detail.untitled")}</span>
                  {archived || doc.archived_at ? (
                    <Badge variant="secondary" className="shrink-0">
                      {t("documents.library.archived_badge")}
                    </Badge>
                  ) : null}
                </span>
                {doc.snippet ? (
                  <span className="mt-0.5 block truncate text-caption text-muted-foreground">{doc.snippet}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-caption text-muted-foreground">
                {doc.updated_at
                  ? t("documents.library.row_meta", {
                      time: formatUpdatedAt(doc.updated_at, i18n.language),
                    })
                  : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hasMore ? (
        <div className="flex justify-center p-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            aria-busy={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? t("documents.library.loading_more") : t("documents.library.load_more")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
