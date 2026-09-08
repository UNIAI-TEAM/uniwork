"use client";

import { useCallback, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { usePutProject } from "@uniwork/core/tasks";
import type {
  ProjectColumnKey,
  ProjectSortDirection,
  ProjectSortField,
} from "@uniwork/core/projects/stores/view-store";
import type { Project } from "@uniwork/core/types/project";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import {
  ListGrid,
  ListGridCell,
  ListGridHeader,
  ListGridHeaderCell,
  ListGridRow,
  LIST_GRID_BOTTOM_CLEARANCE,
  type ListGridSortDirection,
} from "@uniwork/ui/components/ui/list-grid";
import { ProjectIcon } from "./components/project-icon";
import { ProjectStatusBadge, ProjectPriorityBadge } from "./components/project-badge";
import { ProjectProgressRing } from "./components/project-progress";
import { ProjectRowActions } from "./components/project-row-actions";
import { formatRelativeDate } from "./project-row-metrics";

const COLUMN_WIDTHS: Record<ProjectColumnKey, number> = {
  priority: 116,
  progress: 88,
  lead: 132,
  tasks: 80,
  created: 104,
};

const FIXED_TRACKS_WIDTH = 384 + 10 * 12;

const GRID_COLS =
  "grid-cols-[0.75rem_1rem_minmax(120px,1fr)_116px_1.75rem_0.75rem] " +
  "@2xl:grid-cols-[0.75rem_1rem_minmax(200px,1fr)_116px_var(--pjc-priority)_var(--pjc-progress)_var(--pjc-lead)_var(--pjc-tasks)_var(--pjc-created)_1.75rem_0.75rem]";

const stopRowNavigation = (e: MouseEvent) => e.stopPropagation();

function columnTrackVars(
  isVisible: (key: ProjectColumnKey) => boolean,
): React.CSSProperties {
  const width = (key: ProjectColumnKey) =>
    isVisible(key) ? `${COLUMN_WIDTHS[key]}px` : "0px";
  const minWidth =
    FIXED_TRACKS_WIDTH +
    (Object.keys(COLUMN_WIDTHS) as ProjectColumnKey[]).reduce(
      (sum, key) => sum + (isVisible(key) ? COLUMN_WIDTHS[key] : 0),
      0,
    );
  return {
    "--pjc-priority": width("priority"),
    "--pjc-progress": width("progress"),
    "--pjc-lead": width("lead"),
    "--pjc-tasks": width("tasks"),
    "--pjc-created": width("created"),
    "--pjc-minw": `${minWidth}px`,
  } as React.CSSProperties;
}

function CheckboxCell({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <ListGridCell className="justify-center px-0">
      <button
        type="button"
        aria-pressed={checked}
        onClick={(e) => {
          stopRowNavigation(e);
          onToggle();
        }}
        onAuxClick={stopRowNavigation}
        className={`-m-1.5 flex items-center p-1.5 ${
          checked ? "" : "opacity-0 transition-opacity group-hover/row:opacity-100"
        }`}
      >
        <Checkbox checked={checked} tabIndex={-1} className="pointer-events-none" />
      </button>
    </ListGridCell>
  );
}

function ProjectTableRow({
  workspaceId,
  project,
  pinned,
  canDelete,
  isColVisible,
  selected,
  onToggleSelect,
  onOpenProject,
  locale,
}: {
  workspaceId: string;
  project: Project;
  pinned: boolean;
  canDelete: boolean;
  isColVisible: (key: ProjectColumnKey) => boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpenProject: (projectId: string) => void;
  locale: string;
}) {
  const putProject = usePutProject(workspaceId);
  const handleUpdate = useCallback(
    (patch: { status?: string; priority?: string }) =>
      putProject.mutate({
        projectId: project.id,
        body: { ...patch, revision: project.revision },
        ifMatch: String(project.revision),
      }),
    [project.id, project.revision, putProject],
  );

  return (
    <ListGridRow
      className={`h-11 cursor-pointer ${selected ? "bg-accent/30" : ""}`}
      onClick={() => onOpenProject(project.id)}
    >
      <CheckboxCell checked={selected} onToggle={onToggleSelect} />
      <ListGridCell className="gap-2">
        <ProjectIcon project={project} size="sm" />
        <span className="min-w-0 truncate text-body font-medium">{project.title}</span>
      </ListGridCell>

      <ListGridCell onClick={stopRowNavigation} onAuxClick={stopRowNavigation}>
        <ProjectStatusBadge
          project={project}
          onUpdate={(p) => handleUpdate(p)}
          align="start"
        />
      </ListGridCell>

      {isColVisible("priority") ? (
        <ListGridCell
          className="hidden @2xl:flex"
          onClick={stopRowNavigation}
          onAuxClick={stopRowNavigation}
        >
          <ProjectPriorityBadge
            project={project}
            onUpdate={(p) => handleUpdate(p)}
            align="start"
          />
        </ListGridCell>
      ) : (
        <ListGridCell className="hidden px-0 @2xl:flex" />
      )}

      {isColVisible("progress") ? (
        <ListGridCell className="hidden @2xl:flex">
          <ProjectProgressRing project={project} />
        </ListGridCell>
      ) : (
        <ListGridCell className="hidden px-0 @2xl:flex" />
      )}

      {isColVisible("lead") ? (
        <ListGridCell className="hidden @2xl:flex">
          <span className="min-w-0 truncate text-caption text-muted-foreground">
            {project.lead_id ?? "—"}
          </span>
        </ListGridCell>
      ) : (
        <ListGridCell className="hidden px-0 @2xl:flex" />
      )}

      {isColVisible("tasks") ? (
        <ListGridCell className="hidden justify-end font-mono text-caption tabular-nums text-muted-foreground @2xl:flex">
          {project.task_count}
        </ListGridCell>
      ) : (
        <ListGridCell className="hidden px-0 @2xl:flex" />
      )}

      {isColVisible("created") ? (
        <ListGridCell className="hidden whitespace-nowrap text-caption tabular-nums text-muted-foreground @2xl:flex">
          {formatRelativeDate(project.created_at, locale)}
        </ListGridCell>
      ) : (
        <ListGridCell className="hidden px-0 @2xl:flex" />
      )}

      <ListGridCell
        className="justify-end px-0"
        onClick={stopRowNavigation}
        onAuxClick={stopRowNavigation}
      >
        <ProjectRowActions
          workspaceId={workspaceId}
          project={project}
          pinned={pinned}
          canDelete={canDelete}
          onOpenProject={onOpenProject}
        />
      </ListGridCell>
    </ListGridRow>
  );
}

function ProjectTableHeader({
  sortField,
  sortDirection,
  onSort,
  isColVisible,
  allSelected,
  someSelected,
  onToggleAll,
}: {
  sortField: ProjectSortField;
  sortDirection: ListGridSortDirection;
  onSort: (field: ProjectSortField) => void;
  isColVisible: (key: ProjectColumnKey) => boolean;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
}) {
  const { t } = useTranslation();
  const sorted = (field: ProjectSortField) =>
    sortField === field ? sortDirection : false;
  const anySelected = allSelected || someSelected;
  return (
    <ListGridHeader>
      <div className="flex items-center justify-center">
        <button
          type="button"
          aria-pressed={allSelected}
          onClick={onToggleAll}
          className={`-m-1.5 flex items-center p-1.5 ${
            anySelected ? "" : "opacity-0 transition-opacity group-hover/header:opacity-100"
          }`}
        >
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            tabIndex={-1}
            className="pointer-events-none"
          />
        </button>
      </div>
      <ListGridHeaderCell sorted={sorted("name")} onSort={() => onSort("name")}>
        {t("projects.table.name")}
      </ListGridHeaderCell>
      <ListGridHeaderCell sorted={sorted("status")} onSort={() => onSort("status")}>
        {t("projects.table.status")}
      </ListGridHeaderCell>
      {isColVisible("priority") ? (
        <ListGridHeaderCell
          className="hidden @2xl:flex"
          sorted={sorted("priority")}
          onSort={() => onSort("priority")}
        >
          {t("projects.table.priority")}
        </ListGridHeaderCell>
      ) : (
        <ListGridHeaderCell className="hidden px-0 @2xl:flex" />
      )}
      {isColVisible("progress") ? (
        <ListGridHeaderCell
          className="hidden @2xl:flex"
          sorted={sorted("progress")}
          onSort={() => onSort("progress")}
        >
          {t("projects.table.progress")}
        </ListGridHeaderCell>
      ) : (
        <ListGridHeaderCell className="hidden px-0 @2xl:flex" />
      )}
      {isColVisible("lead") ? (
        <ListGridHeaderCell className="hidden @2xl:flex">
          {t("projects.table.lead")}
        </ListGridHeaderCell>
      ) : (
        <ListGridHeaderCell className="hidden px-0 @2xl:flex" />
      )}
      {isColVisible("tasks") ? (
        <ListGridHeaderCell className="hidden justify-end @2xl:flex" align="right">
          {t("projects.table.tasks")}
        </ListGridHeaderCell>
      ) : (
        <ListGridHeaderCell className="hidden px-0 @2xl:flex" />
      )}
      {isColVisible("created") ? (
        <ListGridHeaderCell
          className="hidden @2xl:flex"
          sorted={sorted("created")}
          onSort={() => onSort("created")}
        >
          {t("projects.table.created")}
        </ListGridHeaderCell>
      ) : (
        <ListGridHeaderCell className="hidden px-0 @2xl:flex" />
      )}
      <span aria-hidden="true" />
    </ListGridHeader>
  );
}

export function ProjectsListTable({
  workspaceId,
  projects,
  pinnedIds,
  canDelete,
  sortField,
  sortDirection,
  isColVisible,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  onSort,
  onOpenProject,
  locale,
}: {
  workspaceId: string;
  projects: Project[];
  pinnedIds: Set<string>;
  canDelete: boolean;
  sortField: ProjectSortField;
  sortDirection: ProjectSortDirection;
  isColVisible: (key: ProjectColumnKey) => boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onSort: (field: ProjectSortField) => void;
  onOpenProject: (projectId: string) => void;
  locale: string;
}) {
  const selectedCount = projects.filter((p) => selectedIds.has(p.id)).length;
  const allSelected = projects.length > 0 && selectedCount === projects.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div className="min-h-0 flex-1 overflow-auto @container">
      <ListGrid
        className={`${GRID_COLS} @2xl:min-w-[var(--pjc-minw)]`}
        style={{
          ...columnTrackVars(isColVisible),
          paddingBottom: LIST_GRID_BOTTOM_CLEARANCE,
        }}
      >
        <ProjectTableHeader
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={onSort}
          isColVisible={isColVisible}
          allSelected={allSelected}
          someSelected={someSelected}
          onToggleAll={onToggleAll}
        />
        {projects.map((project) => (
          <ProjectTableRow
            key={project.id}
            workspaceId={workspaceId}
            project={project}
            pinned={pinnedIds.has(project.id)}
            canDelete={canDelete}
            isColVisible={isColVisible}
            selected={selectedIds.has(project.id)}
            onToggleSelect={() => onToggleSelect(project.id)}
            onOpenProject={onOpenProject}
            locale={locale}
          />
        ))}
      </ListGrid>
    </div>
  );
}
