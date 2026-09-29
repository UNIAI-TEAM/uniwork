"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTaskStatuses } from "@uniwork/core/tasks";
import { TASK_STATUSES } from "@uniwork/core/types";

export type StatusOption = {
  key: string;
  label: string;
  /** Built-in key the icon is drawn from. */
  category: string;
  /** Only a custom status carries its own colour; built-ins keep the theme's. */
  color?: string;
};

export type StatusCatalog = {
  /** What a task may move to: the catalog minus archived statuses, in order. */
  options: StatusOption[];
  /** Any key, archived included, so a task already in one still reads right. */
  optionOf: (key: string) => StatusOption;
};

const BUILT_IN = new Set<string>(TASK_STATUSES);

/**
 * The workspace's status catalog as every status picker reads it. Until the
 * catalog loads (or when it is empty) the seven built-ins stand in, so a
 * picker is never empty. Built-in labels come from `tasks.status_*`, a custom
 * status shows its own name.
 */
export function useStatusCatalog(workspaceId: string): StatusCatalog {
  const { t } = useTranslation();
  const { data } = useTaskStatuses(workspaceId);
  return useMemo(() => {
    const builtIn = (key: string): StatusOption => ({
      key,
      label: t(`tasks.status_${key}`),
      category: key,
    });
    const entries = (data?.statuses ?? []).map((status) => ({
      archived: Boolean(status.archived_at),
      position: status.position,
      option: status.is_system && BUILT_IN.has(status.key)
        ? builtIn(status.key)
        : {
            key: status.key,
            label: status.name,
            category: status.category,
            color: status.color || undefined,
          },
    }));
    const byKey = new Map(entries.map((entry) => [entry.option.key, entry.option]));
    const open = entries
      .filter((entry) => !entry.archived)
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.option);
    const options = open.length > 0 ? open : TASK_STATUSES.map(builtIn);
    const optionOf = (key: string): StatusOption =>
      byKey.get(key) ?? (BUILT_IN.has(key) ? builtIn(key) : { key, label: key, category: key });
    return { options, optionOf };
  }, [data, t]);
}
