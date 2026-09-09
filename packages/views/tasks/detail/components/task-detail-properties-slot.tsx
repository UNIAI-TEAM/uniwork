"use client";

import { useTranslation } from "react-i18next";
import { PAGE_GUTTER } from "../../../layout/page-header";

/** Task 7 fills this with status / assignee / labels / dates pickers. */
export function TaskDetailPropertiesSidebarSlot() {
  const { t } = useTranslation();
  return (
    <aside
      aria-label={t("tasks.detail.properties_sidebar")}
      className={`h-full overflow-y-auto py-4 ${PAGE_GUTTER}`}
    >
      <h2 className="mb-3 text-caption font-medium text-muted-foreground">
        {t("tasks.detail.section_properties")}
      </h2>
      <p className="text-caption text-muted-foreground">
        {t("tasks.detail.properties_placeholder")}
      </p>
    </aside>
  );
}
