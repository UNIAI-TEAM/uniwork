"use client";

import { FolderKanban } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CollectionPageState } from "../layout/collection-page";

/** Deep-link / flag-off shell — visible empty state, no crash. Kept light so the
 *  `/projects` route stays under the bundle budget when the parity flag is off. */
export function ProjectsUnavailable() {
  const { t } = useTranslation();
  return (
    <CollectionPageState
      icon={FolderKanban}
      title={t("projects.unavailable_title")}
      description={t("projects.unavailable_description")}
      role="status"
    />
  );
}
