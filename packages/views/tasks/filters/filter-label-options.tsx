"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTaskLabels } from "@uniwork/core/tasks";
import {
  DropdownMenuCheckboxItem,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { useWorkspaceId } from "../../layout/workspace-context";
import { FILTER_ITEM_CLASS, HoverCheck } from "./hover-check";

export function FilterLabelOptions({
  counts,
  selected,
  onToggle,
  fixedIds,
  fixedTitle,
}: {
  counts: Map<string, number>;
  selected: string[];
  onToggle: (labelId: string) => void;
  fixedIds?: Set<string>;
  fixedTitle?: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const wsId = useWorkspaceId();
  const { data: labelList } = useTaskLabels(wsId);
  const labels = labelList?.labels ?? [];
  const query = search.trim().toLowerCase();
  const filtered = labels.filter((l) => l.name.toLowerCase().includes(query));

  return (
    <>
      <div className="border-b border-foreground/5 px-2 py-1.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("tasks.filters.search_placeholder")}
          className="w-full bg-transparent text-body outline-none placeholder:text-muted-foreground"
          autoFocus
        />
      </div>

      <div className="max-h-64 overflow-y-auto p-1">
        {filtered.map((l) => {
          const checked = selected.includes(l.id);
          const fixed = fixedIds?.has(l.id) === true;
          const count = counts.get(l.id) ?? 0;
          return (
            <DropdownMenuCheckboxItem
              key={l.id}
              checked={checked}
              disabled={fixed}
              title={fixed ? fixedTitle : undefined}
              onCheckedChange={() => onToggle(l.id)}
              className={FILTER_ITEM_CLASS}
            >
              <HoverCheck checked={checked} />
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: l.color || "var(--muted-foreground)" }}
                aria-hidden
              />
              <span className="truncate">{l.name}</span>
              {count > 0 ? (
                <span className="ml-auto text-caption text-muted-foreground">
                  {count}
                </span>
              ) : null}
            </DropdownMenuCheckboxItem>
          );
        })}

        {filtered.length === 0 ? (
          <div className="px-2 py-3 text-center text-body text-muted-foreground">
            {search
              ? t("tasks.filters.no_results")
              : t("tasks.filters.no_labels")}
          </div>
        ) : null}
      </div>
    </>
  );
}
