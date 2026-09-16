"use client";

import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { CollectionPageState } from "../../layout/collection-page";

/** The table could not load its groups (or its only branch): say so and ask again. */
export function TableLoadErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <CollectionPageState
      icon={AlertCircle}
      tone="destructive"
      role="alert"
      className="flex-1"
      title={t("tasks.table.load_error")}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("tasks.table.load_more_retry")}
        </Button>
      }
    />
  );
}

/** What an empty table says: nothing matches the search (with a way out), or nothing is there. */
export function TableEmptyMessage({
  search,
  onClearSearch,
}: {
  search: string;
  onClearSearch: () => void;
}) {
  const { t } = useTranslation();
  if (!search) return <>{t("tasks.table.empty")}</>;
  return (
    <div className="flex flex-col items-center gap-2">
      <span>{t("tasks.table.empty_search", { query: search })}</span>
      <Button type="button" variant="outline" size="sm" onClick={onClearSearch}>
        {t("tasks.table.search_clear")}
      </Button>
    </div>
  );
}

/** A thin bar over the table while a changed query loads behind the rows still shown. */
export function TableRefreshingBar() {
  const { t } = useTranslation();
  return (
    <div
      role="progressbar"
      aria-label={t("tasks.table.refreshing")}
      className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-primary/15"
    >
      <div className="h-full w-full bg-primary/70 motion-safe:animate-pulse" />
    </div>
  );
}
