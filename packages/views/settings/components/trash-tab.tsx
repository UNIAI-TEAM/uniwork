"use client";

import { useState } from "react";
import { Trash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFlag } from "@uniwork/core/feature-flags";
import { useDebouncedValue } from "@uniwork/core/hooks/use-debounced-value";
import { useTrashList } from "@uniwork/core/trash";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { CollectionPageState } from "../../layout/collection-page";
import { useWorkspace } from "../../layout/workspace-context";
import { EMPTY_TRASH_FILTERS, TrashFilters, type TrashFilterValues } from "../../trash/trash-filters";
import { TrashTable } from "../../trash/trash-table";
import { useTrashRowActions } from "../../trash/use-trash-row-actions";
import { useTrashedByName } from "../../trash/use-trashed-by-name";
import { SettingsCard, SettingsLoadError, SettingsSection, SettingsSkeletonRows, SettingsTab } from "./settings-layout";

/** Same pause as the documents search: one request once the typing stops. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Settings › Thùng rác: everything deleted in the workspace — tasks, projects
 * and documents — newest first, for every member. Each row restores or purges
 * through its own kind's command; a row the reader may not manage stays listed
 * with its commands locked.
 */
export function TrashTab() {
  const { t } = useTranslation();
  const { workspace, user } = useWorkspace();
  const documentsEnabled = useFlag("documents", false);
  const members = useMembers(workspace.id);
  const nameOf = useTrashedByName(workspace.id);
  const actions = useTrashRowActions(workspace.id);
  const [filters, setFilters] = useState<TrashFilterValues>(EMPTY_TRASH_FILTERS);
  const typed = useDebouncedValue(filters.q.trim(), SEARCH_DEBOUNCE_MS);
  // Clearing the box applies at once; only typing waits.
  const q = filters.q.trim() ? typed : "";
  const list = useTrashList(workspace.id, {
    kind: filters.kind || undefined,
    q: q || undefined,
    trashedBy: filters.trashedBy || undefined,
  });

  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filtering = Boolean(filters.kind || q || filters.trashedBy);

  let body;
  if (list.isLoading) {
    body = <SettingsSkeletonRows rows={4} />;
  } else if (list.isError && !list.data) {
    body = (
      <SettingsCard>
        <SettingsLoadError onRetry={() => void list.refetch()}>{t("trash.error_title")}</SettingsLoadError>
      </SettingsCard>
    );
  } else if (rows.length === 0) {
    body = (
      <CollectionPageState
        icon={Trash}
        title={filtering ? t("trash.no_match_title") : t("trash.empty_title")}
        role="status"
        headingLevel={3}
        actions={
          filtering ? (
            <Button variant="outline" onClick={() => setFilters(EMPTY_TRASH_FILTERS)}>
              {t("trash.clear_filters")}
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <TrashTable
        items={rows}
        nameOf={nameOf}
        busy={actions.busy}
        onRestore={actions.restore}
        onPurge={actions.purge}
        hasMore={Boolean(list.hasNextPage)}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
      />
    );
  }

  return (
    <SettingsTab title={t("settings.page.tabs.trash")} description={t("trash.description")}>
      <SettingsSection>
        <TrashFilters
          filters={filters}
          onChange={setFilters}
          members={members.data ?? []}
          meId={user.id}
          documentsEnabled={documentsEnabled}
        />
        {body}
      </SettingsSection>
    </SettingsTab>
  );
}
