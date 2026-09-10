"use client";

import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";

export function ChatPageAuthLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col">
      <CollectionPageHeader icon={MessageSquare} title={t("chat.title")} />
      <CollectionPageState
        icon={MessageSquare}
        title={t("chat.loading")}
        description={t("chat.group_description")}
      />
    </div>
  );
}
