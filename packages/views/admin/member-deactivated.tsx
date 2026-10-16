"use client";

import { useTranslation } from "react-i18next";
import { AccessNoticePage } from "./access-notice-page";

/**
 * What somebody sees once their membership of this organization has been
 * switched off (F-03 §6.3): every organization and workspace route answers 403
 * member_deactivated, so the shell shows this instead of the page. A
 * deactivated membership no longer counts as belonging (ADR 0032 D1), so the
 * way out is /get-started: create an organization or join another one.
 */
export function MemberDeactivatedPage({ announce = false }: { announce?: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "org.deactivated" });
  return (
    <AccessNoticePage
      title={t("title")}
      description={t("description")}
      linkLabel={t("get_started_link")}
      announce={announce}
    />
  );
}
