"use client";

import { useTranslation } from "react-i18next";

/** The honest empty state the pre-ribbon group strip showed for a tab with no
 *  commands (Review). The shared ribbon mounts only the active tab's groups,
 *  so a tab with `groups: []` would otherwise render a blank body. */
export function XlsxEmptyTabGroup() {
  const { t } = useTranslation();
  return (
    <span className="px-2 text-caption text-muted-foreground" data-testid="xlsx-toolbar-empty">
      {t("office.xlsx.toolbar.emptyTab")}
    </span>
  );
}