"use client";

import { UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CollectionPageState } from "../layout/collection-page";

/** Deep-link / flag-off shell — visible empty state, no crash. Kept light so the
 *  `/squads` route stays under the bundle budget when the parity flag is off. */
export function SquadsUnavailable() {
  const { t } = useTranslation();
  return (
    <CollectionPageState
      icon={UsersRound}
      title={t("squads.unavailable_title")}
      description={t("squads.unavailable_description")}
      role="status"
    />
  );
}
