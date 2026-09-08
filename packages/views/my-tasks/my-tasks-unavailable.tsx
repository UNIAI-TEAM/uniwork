"use client";

import { ListTodo } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CollectionPageState } from "../layout/collection-page";

/** Deep-link / flag-off shell — visible empty state, no crash. Kept light so the
 *  `/my-tasks` route stays under the bundle budget when the parity flag is off. */
export function MyTasksUnavailable() {
  const { t } = useTranslation();
  return (
    <CollectionPageState
      icon={ListTodo}
      title={t("myTasks.unavailable_title")}
      description={t("myTasks.unavailable_description")}
      role="status"
    />
  );
}
