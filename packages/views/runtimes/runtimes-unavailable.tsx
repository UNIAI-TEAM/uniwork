"use client";

import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CollectionPageState } from "../layout/collection-page";

/** Deep-link / flag-off shell — visible empty state, no crash. Kept light so the
 *  `/runtimes` route stays under the bundle budget when the parity flag is off. */
export function RuntimesUnavailable() {
  const { t } = useTranslation();
  return (
    <CollectionPageState
      icon={Cpu}
      title={t("runtimes.unavailable_title")}
      description={t("runtimes.unavailable_description")}
      role="status"
    />
  );
}
