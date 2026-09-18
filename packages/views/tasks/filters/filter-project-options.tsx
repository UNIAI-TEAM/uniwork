"use client";

import { useState } from "react";
import { FolderMinus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProjects } from "@uniwork/core/tasks";
import {
  DropdownMenuCheckboxItem,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { ProjectIcon } from "../../projects/components/project-icon";
import { useWorkspaceId } from "../../layout/workspace-context";
import { FILTER_ITEM_CLASS, HoverCheck } from "./hover-check";

export function FilterProjectOptions({
  counts,
  selected,
  onToggle,
  includeNoProject,
  onToggleNoProject,
  noProjectCount,
  fixedIds,
  noProjectFixed = false,
  fixedTitle,
}: {
  counts: Map<string, number>;
  selected: string[];
  onToggle: (projectId: string) => void;
  includeNoProject: boolean;
  onToggleNoProject: () => void;
  noProjectCount: number;
  fixedIds?: Set<string>;
  noProjectFixed?: boolean;
  fixedTitle?: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const wsId = useWorkspaceId();
  const { data: projectList } = useProjects(wsId);
  const projects = projectList?.projects ?? [];
  const query = search.trim().toLowerCase();
  const filtered = projects.filter((p) =>
    p.title.toLowerCase().includes(query),
  );

  const noProjectLabel = t("tasks.save_view.no_project").toLowerCase();
  const showNoProject =
    !query ||
    noProjectLabel.includes(query) ||
    "no project".includes(query) ||
    "unassigned".includes(query);

  return (
    <>
      <div className="border-b border-foreground/5 px-2 py-1.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("tasks.filters.search_placeholder")}
          aria-label={t("tasks.filters.search_placeholder")}
          className="w-full bg-transparent text-body outline-none placeholder:text-muted-foreground"
          autoFocus
        />
      </div>

      <div className="max-h-64 overflow-y-auto p-1">
        {showNoProject ? (
          <DropdownMenuCheckboxItem
            checked={includeNoProject}
            disabled={noProjectFixed}
            title={noProjectFixed ? fixedTitle : undefined}
            onCheckedChange={() => onToggleNoProject()}
            className={FILTER_ITEM_CLASS}
          >
            <HoverCheck checked={includeNoProject} />
            <FolderMinus className="size-3.5 text-muted-foreground" aria-hidden />
            {t("tasks.save_view.no_project")}
            {noProjectCount > 0 ? (
              <span className="ml-auto text-caption text-muted-foreground">
                {noProjectCount}
              </span>
            ) : null}
          </DropdownMenuCheckboxItem>
        ) : null}

        {filtered.map((p) => {
          const checked = selected.includes(p.id);
          const fixed = fixedIds?.has(p.id) === true;
          const count = counts.get(p.id) ?? 0;
          return (
            <DropdownMenuCheckboxItem
              key={p.id}
              checked={checked}
              disabled={fixed}
              title={fixed ? fixedTitle : undefined}
              onCheckedChange={() => onToggle(p.id)}
              className={FILTER_ITEM_CLASS}
            >
              <HoverCheck checked={checked} />
              <ProjectIcon project={p} size="sm" />
              <span className="truncate">{p.title}</span>
              {count > 0 ? (
                <span className="ml-auto text-caption text-muted-foreground">
                  {count}
                </span>
              ) : null}
            </DropdownMenuCheckboxItem>
          );
        })}

        {filtered.length === 0 && search ? (
          <div className="px-2 py-3 text-center text-body text-muted-foreground">
            {t("tasks.filters.no_results")}
          </div>
        ) : null}
      </div>
    </>
  );
}
