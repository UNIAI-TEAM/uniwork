"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryView } from "./documents-sidebar";
import { DocumentsSearchBox } from "./documents-search-box";
import type { UseDocumentsSearchResult } from "./use-documents-search";

export interface DocumentsScreenHeadProps {
  /** Names the h1 (`documents.home.views.*`) and the subtitle (`documents.home.view_subtitle.*`; one for every Ở nơi khác page). */
  view: LibraryView;
  search: UseDocumentsSearchResult;
  /** Beside the search box (the "open the navigation" button below `xl`). */
  actions?: ReactNode;
}

/**
 * The head row of a document list screen (doclist-canvas Main, recent-canvas):
 * the screen's h1 over its one-line subtitle, the search box on the right. It
 * replaces the module's collection header on these screens, the way the home
 * header does at the root and in a folder; the query still covers the workspace.
 */
export function DocumentsScreenHead({ view, search, actions }: DocumentsScreenHeadProps) {
  const { t } = useTranslation();
  const kind = view.kind === "sharedByMe" ? "shared_by_me" : view.kind;
  const title = t(`documents.home.views.${view.kind === "sources" ? (view.source ?? "sources") : kind}`);
  const subtitle = t(`documents.home.view_subtitle.${kind}`);
  return (
    <div className="@container flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
        <h1 className="truncate text-title font-semibold">{title}</h1>
        <p className="text-caption text-muted-foreground">{subtitle}</p>
      </div>
      <DocumentsSearchBox search={search} className="order-last basis-full @min-[48rem]:order-none @min-[48rem]:w-72 @min-[48rem]:basis-auto" />
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
