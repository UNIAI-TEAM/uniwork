"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryView } from "./documents-sidebar";

export interface DocumentsScreenHeadProps {
  /** Names the h1 (`documents.home.views.*`) and the subtitle (`documents.home.view_subtitle.*`; one for every Ở nơi khác page). */
  view: LibraryView;
  /** Beside the heading block (the "open the navigation" button below `xl`). */
  actions?: ReactNode;
}

/**
 * The head row of a document list screen (doclist-canvas Main, recent-canvas):
 * the screen's h1 over its one-line subtitle. Search sits on the filter row
 * below (UNI-2205). It replaces the module's collection header on these
 * screens, the way the home header does at the root and in a folder.
 */
export function DocumentsScreenHead({ view, actions }: DocumentsScreenHeadProps) {
  const { t } = useTranslation();
  const kind = view.kind === "sharedByMe" ? "shared_by_me" : view.kind;
  // Lưu trữ names itself in its own copy block (title and the intro of what shelving does).
  const shelved = view.kind === "shelved";
  const title = shelved ? t("documents.shelved_list.title") : t(`documents.home.views.${view.kind === "sources" ? (view.source ?? "sources") : kind}`);
  const subtitle = shelved ? t("documents.shelved_list.intro") : t(`documents.home.view_subtitle.${kind}`);
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
        <h1 className="truncate text-title font-semibold">{title}</h1>
        <p className="text-caption text-muted-foreground">{subtitle}</p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
