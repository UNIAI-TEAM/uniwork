"use client";

import { useRef, type KeyboardEvent } from "react";
import { CircleAlert, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { isMyFolder } from "@uniwork/core/types/document";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageState } from "../layout/collection-page";
import { DocumentTypeIcon, documentIconFormat } from "./document-type-icon";
import {
  DOCUMENT_SEARCH_FILTERS,
  type DocumentSearchFilter,
  type UseDocumentsSearchResult,
} from "./use-documents-search";

const MAX_VISIBLE_PATH_SEGMENTS = 2;
const MAX_VISIBLE_PATH_CHARS = 36;
const MAX_SEGMENT_CHARS = 24;

function truncateSegmentFromLeft(segment: string): string {
  if (segment.length <= MAX_SEGMENT_CHARS) return segment;
  return `…${segment.slice(-(MAX_SEGMENT_CHARS - 1)).trimStart()}`;
}

/**
 * Formats a document's ancestor path (root -> direct parent) for search result
 * rows: truncates from the left ("… › Parent › " when `rootLabel` is provided,
 * or "… › Parent" when omitted) when there are more than two ancestors, a
 * segment is long, or the joined text exceeds the cap, while returning the
 * full path for the `title` tooltip and screen-reader announcement.
 */
export function formatSearchPath(
  path: { id: string; title: string }[] | undefined,
  rootLabel?: string,
): { display: string; full: string } {
  const segments = (path ?? []).map((item) => item.title.trim()).filter(Boolean);
  if (segments.length === 0) {
    if (!rootLabel) return { display: "", full: "" };
    return { display: rootLabel, full: rootLabel };
  }
  const full = segments.join(" › ");
  if (segments.length <= MAX_VISIBLE_PATH_SEGMENTS && full.length <= MAX_VISIBLE_PATH_CHARS) {
    return { display: full, full };
  }
  const capped = segments.map(truncateSegmentFromLeft);
  const tailSegments = capped.slice(-MAX_VISIBLE_PATH_SEGMENTS);
  const tail = tailSegments.join(" › ");
  if (segments.length === 1) {
    return { display: tail, full };
  }
  if (tail.length > MAX_VISIBLE_PATH_CHARS) {
    return { display: `… › ${tailSegments.at(-1)!}`, full };
  }
  return { display: `… › ${tail}`, full };
}

export interface DocumentsSearchResultsProps {
  search: UseDocumentsSearchResult;
  onSelectFolder: (folderId: string) => void;
  onSelectDocument: (documentId: string) => void;
  /** The caller's personal root folder id, once known, so ancestor paths use the i18n label. */
  myFolderId?: string | null;
}

export function DocumentsSearchResults({
  search,
  onSelectFolder,
  onSelectDocument,
  myFolderId = null,
}: DocumentsSearchResultsProps) {
  const { t } = useTranslation();
  const radioRefs = useRef<Record<DocumentSearchFilter, HTMLButtonElement | null>>({
    all: null,
    folder: null,
    document: null,
  });

  const chipLabel = (filter: DocumentSearchFilter): string => {
    switch (filter) {
      case "folder":
        return t("documents.home.search.filter_folder");
      case "document":
        return t("documents.home.search.filter_document");
      default:
        return t("documents.home.search.filter_all");
    }
  };

  const handleRadioKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: DocumentSearchFilter,
  ) => {
    const idx = DOCUMENT_SEARCH_FILTERS.indexOf(current);
    let nextIdx = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIdx = (idx + 1) % DOCUMENT_SEARCH_FILTERS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIdx = (idx - 1 + DOCUMENT_SEARCH_FILTERS.length) % DOCUMENT_SEARCH_FILTERS.length;
    } else if (event.key === "Home") {
      nextIdx = 0;
    } else if (event.key === "End") {
      nextIdx = DOCUMENT_SEARCH_FILTERS.length - 1;
    }
    if (nextIdx >= 0) {
      event.preventDefault();
      const next = DOCUMENT_SEARCH_FILTERS[nextIdx]!;
      search.setFilter(next);
      radioRefs.current[next]?.focus();
    }
  };

  const rootLabel = t("documents.home.search.path_root");

  return (
    <div className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-label={t("documents.home.search.filter_label")}
        className="flex flex-wrap items-center gap-1.5"
      >
        {DOCUMENT_SEARCH_FILTERS.map((value) => {
          const checked = search.filter === value;
          return (
            <button
              key={value}
              ref={(el) => {
                radioRefs.current[value] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => search.setFilter(value)}
              onKeyDown={(event) => handleRadioKeyDown(event, value)}
              className={cn(
                "inline-flex h-7 min-w-11 shrink-0 items-center justify-center rounded-full border px-3 text-caption font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11",
                checked
                  ? "border-foreground bg-foreground text-background"
                  : "border-input bg-background text-foreground hover:bg-accent",
              )}
            >
              {chipLabel(value)}
            </button>
          );
        })}
      </div>

      {search.loading ? (
        <div
          className="space-y-2"
          aria-busy="true"
          aria-label={t("documents.home.search.loading")}
        >
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full rounded-md" />
          ))}
        </div>
      ) : search.isError ? (
        <CollectionPageState
          icon={CircleAlert}
          tone="destructive"
          role="alert"
          title={t("documents.home.search.error_title")}
          description={t("documents.home.search.error_description")}
          actions={
            <Button type="button" variant="outline" size="sm" onClick={search.retry}>
              {t("documents.library.retry")}
            </Button>
          }
        />
      ) : search.items.length === 0 ? (
        <CollectionPageState
          icon={Search}
          role="status"
          title={t("documents.home.search.empty_title")}
          description={t("documents.home.search.empty_description")}
        />
      ) : (
        <div className="flex flex-col">
          <div className="overflow-hidden rounded-lg border border-border">
            <ul className="divide-y divide-border" aria-label={t("documents.home.search.label")}>
              {search.items.map((item) => {
                const isFolder = item.kind === "folder";
                const title = (isMyFolder(item) ? t("documents.home.my_folder.label") : item.title) || t("documents.detail.untitled");
                const format = documentIconFormat(item.kind, title);
                const localizedPath = item.path?.map((segment) =>
                  segment.id === myFolderId ? { ...segment, title: t("documents.home.my_folder.label") } : segment,
                );
                const { display, full } = formatSearchPath(localizedPath, rootLabel);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (isFolder) onSelectFolder(item.id);
                        else onSelectDocument(item.id);
                      }}
                      className="flex min-h-11 w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/40 pointer-coarse:min-h-11"
                    >
                      <DocumentTypeIcon
                        format={format}
                        decorative
                        className={cn("size-5 shrink-0", isFolder && "text-muted-foreground")}
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-x-2">
                        <span className="min-w-0 truncate text-body font-medium text-foreground sm:shrink-0 sm:max-w-[70%]">
                          {title}
                        </span>
                        <span
                          aria-hidden
                          title={full}
                          className="min-w-0 shrink truncate text-caption text-muted-foreground"
                        >
                          {display}
                        </span>
                        <span className="sr-only">
                          {t("documents.home.search.path", { path: full })}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {search.hasMore ? (
            <div className="flex justify-center p-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-disabled={search.loadingMore || undefined}
                aria-busy={search.loadingMore || undefined}
                onClick={() => {
                  if (!search.loadingMore) search.loadMore();
                }}
              >
                {search.loadingMore
                  ? t("documents.library.loading_more")
                  : t("documents.library.load_more")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
