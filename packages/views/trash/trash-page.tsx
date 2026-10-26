"use client";

import { Trash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { PAGE_GUTTER } from "../layout/page-header";
import { toastApiError } from "../toast-api-error";
import { TrashList, type TrashItem } from "./trash-list";

/** A trash screen for one kind of item: header, loading, empty and error states, the list. */
export function TrashPage({
  kind,
  items,
  isLoading,
  isError,
  onRetry,
  hasMore,
  loadingMore,
  onLoadMore,
  restore,
  purge,
}: {
  kind: "task" | "project";
  items: TrashItem[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  restore: { run: (id: string) => Promise<unknown>; pending: boolean };
  purge: { run: (id: string) => Promise<unknown>; pending: boolean };
}) {
  const { t } = useTranslation();
  const settle = (action: Promise<unknown>, done: string, failed: string) =>
    action.then(
      () => toast.success(done),
      (err: unknown) => toastApiError(err, failed),
    );

  let body;
  if (isLoading) {
    body = (
      <div className={`flex flex-col gap-2 py-3 ${PAGE_GUTTER}`} aria-busy="true" aria-label={t("trash.loading")}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
    );
  } else if (isError) {
    body = (
      <CollectionPageState
        icon={Trash}
        tone="destructive"
        role="alert"
        title={t("trash.error_title")}
        actions={
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  } else if (items.length === 0) {
    body = (
      <CollectionPageState
        icon={Trash}
        title={t(kind === "task" ? "trash.tasks_empty_title" : "trash.projects_empty_title")}
        description={t("trash.empty_description")}
      />
    );
  } else {
    body = (
      <TrashList
        kind={kind}
        items={items}
        busy={restore.pending || purge.pending}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
        onRestore={(id) => void settle(restore.run(id), t("trash.restored"), t("trash.restore_failed"))}
        onPurge={(id) => void settle(purge.run(id), t("trash.purged"), t("trash.purge_failed"))}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CollectionPageHeader icon={Trash} title={t("trash.title")} count={items.length} />
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </div>
  );
}
