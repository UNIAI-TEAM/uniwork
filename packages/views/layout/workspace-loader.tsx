"use client";

import { LogoLoader } from "@uniwork/ui/brand";
import { useTranslation } from "react-i18next";

/**
 * Full-screen workspace gate while the shell resolves the workspace from the URL.
 * Renders instead of the dashboard — sidebar and content do not mount behind it.
 */
export function WorkspaceLoader() {
  const { t } = useTranslation();
  return <LogoLoader fullScreen label={t("common.loading")} />;
}
