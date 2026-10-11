"use client";

import { useEffect, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";

// The browser tab names the screen: "Tài liệu · UniWork" on the library,
// "<title> · UniWork" on a document, and "<title> · UniWork Office" while an
// Office file is open in its editor. The pages are client components, so the
// root layout's metadata template never reaches them.
//
// Two hooks own one title. The route page sets it in a layout effect and the
// Office host in a passive effect: in any commit that mounts or re-titles both,
// layout effects run before passive ones, so the Office title is the one left
// standing, and once the host unmounts the page's next change takes it back.

/** The route page's tab title. `title` undefined = the documents library. */
export function useDocumentsTabTitle(title?: string): void {
  const { t } = useTranslation();
  useLayoutEffect(() => {
    document.title = t("documents.page.tab_title", { title: title?.trim() || t("documents.page.title") });
  }, [t, title]);
}

/** The Office host's tab title, for as long as the editor is mounted. */
export function useOfficeTabTitle(title: string): void {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = t("documents.page.office_tab_title", { title: title.trim() || t("documents.page.title") });
  }, [t, title]);
}
