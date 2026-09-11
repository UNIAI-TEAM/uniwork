"use client";

import { useMemo, useState } from "react";
import { FolderKanban, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import {
  PROJECT_PRIORITY_ORDER,
  PROJECT_STATUS_ORDER,
} from "@uniwork/core/projects/config";
import {
  useProjectViewStore,
  type ProjectColumnKey,
} from "@uniwork/core/projects/stores/view-store";
import {
  useCreatePin,
  useCreateProject,
  useDeleteProject,
  usePins,
  useProjects,
} from "@uniwork/core/tasks";
import type { Project, ProjectPriority, ProjectStatus } from "@uniwork/core/types/project";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import {
  CollectionPageHeader,
  CollectionPageHeaderAction,
  CollectionPageState,
} from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { PAGE_GUTTER } from "../layout/page-header";
import { ProjectsListGrid } from "./projects-list-grid";
import { ProjectsListTable } from "./projects-list-table";
import { ProjectsListToolbar } from "./projects-list-toolbar";
import {
  leadFilterValue,
  projectProgressRatio,
  resolveProjectLeadName,
} from "./project-row-metrics";

const PRIORITY_ORDER: Record<ProjectPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};
const STATUS_ORDER: Record<ProjectStatus, number> = {
  planned: 0,
  in_progress: 1,
  paused: 2,
  completed: 3,
  cancelled: 4,
};

function asPriority(value: string): ProjectPriority {
  return (PROJECT_PRIORITY_ORDER as string[]).includes(value)
    ? (value as ProjectPriority)
    : "none";
}

function asStatus(value: string): ProjectStatus {
  return (PROJECT_STATUS_ORDER as string[]).includes(value)
    ? (value as ProjectStatus)
    : "planned";
}

function ProjectBatchToolbar({
  workspaceId,
  rows,
  pinnedIds,
  canDelete,
  onClear,
}: {
  workspaceId: string;
  rows: Project[];
  pinnedIds: Set<string>;
  canDelete: boolean;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const createPin = useCreatePin(workspaceId);
  const deleteProject = useDeleteProject(workspaceId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (rows.length === 0) return null;
  const anyUnpinned = rows.some((p) => !pinnedIds.has(p.id));

  return (
    <>
      <div className="absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-background px-2 py-1.5 shadow-lg">
        <div className="mr-1 flex items-center gap-1.5 border-r pl-1 pr-2">
          <span className="text-body font-medium">
            {t("projects.page.selected", { count: rows.length })}
          </span>
          <button
            type="button"
            aria-label={t("projects.page.clear_selection")}
            onClick={onClear}
            className="rounded p-0.5 transition-colors hover:bg-accent"
          >
            <X className="size-3.5 text-muted-foreground" />
          </button>
        </div>
        {anyUnpinned ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              for (const p of rows) {
                if (!pinnedIds.has(p.id)) {
                  createPin.mutate({ item_type: "project", item_id: p.id });
                }
              }
              onClear();
            }}
          >
            <Pin className="mr-1 size-3.5" />
            {t("projects.page.pin")}
          </Button>
        ) : null}
        {canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="mr-1 size-3.5" />
            {t("projects.page.delete")}
          </Button>
        ) : null}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("projects.delete_dialog.title")}</DialogTitle>
            <DialogDescription>
              {t("projects.delete_dialog.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(false)}
            >
              {t("projects.delete_dialog.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                for (const p of rows) deleteProject.mutate(p.id);
                setConfirmDelete(false);
                onClear();
              }}
            >
              {t("projects.delete_dialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LoadingState({ isCompact }: { isCompact: boolean }) {
  if (isCompact) {
    return (
      <div className={cn("min-h-0 flex-1 overflow-auto pt-4", PAGE_GUTTER)}>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-md" />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto pt-4", PAGE_GUTTER)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}

export function ProjectsListPage({
  workspaceId,
  onOpenProject,
}: {
  workspaceId: string;
  onOpenProject: (projectId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const currentUser = useAuthStore((s) => s.user);
  const { data: listData, isLoading } = useProjects(workspaceId);
  const projects = useMemo(() => listData?.projects ?? [], [listData?.projects]);
  const { data: members = [] } = useMembers(workspaceId);
  const { data: pinsData } = usePins(workspaceId);
  const pins = useMemo(() => pinsData?.pins ?? [], [pinsData?.pins]);
  const createProject = useCreateProject(workspaceId);

  const viewMode = useProjectViewStore((s) => s.viewMode);
  const setViewMode = useProjectViewStore((s) => s.setViewMode);
  const sortField = useProjectViewStore((s) => s.sortField);
  const sortDirection = useProjectViewStore((s) => s.sortDirection);
  const hiddenColumns = useProjectViewStore((s) => s.hiddenColumns);
  const filters = useProjectViewStore((s) => s.filters);
  const toggleSort = useProjectViewStore((s) => s.toggleSort);
  const setSortField = useProjectViewStore((s) => s.setSortField);
  const setSortDirection = useProjectViewStore((s) => s.setSortDirection);
  const toggleColumn = useProjectViewStore((s) => s.toggleColumn);
  const toggleFilter = useProjectViewStore((s) => s.toggleFilter);
  const clearFilters = useProjectViewStore((s) => s.clearFilters);
  const isCompact = viewMode === "compact";
  const isColVisible = (key: ProjectColumnKey) => !hiddenColumns.includes(key);

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");

  const isWorkspaceAdmin = useMemo(() => {
    if (!currentUser) return false;
    const me = members.find((m) => m.user_id === currentUser.id);
    return me?.role === "owner" || me?.role === "admin";
  }, [members, currentUser]);

  const pinnedProjectIds = useMemo(() => {
    const s = new Set<string>();
    for (const pin of pins) {
      if (pin.item_type === "project") s.add(pin.item_id);
    }
    return s;
  }, [pins]);

  const memberNamesByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      map.set(m.user_id, m.display_name);
    }
    return map;
  }, [members]);

  const resolveLeadName = (project: Project) =>
    resolveProjectLeadName(project, memberNamesByUserId);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = projects.filter((p) => {
      if (q && !p.title.toLowerCase().includes(q)) return false;
      if (filters.statuses.length && !filters.statuses.includes(p.status)) {
        return false;
      }
      if (
        filters.priorities.length &&
        !filters.priorities.includes(p.priority)
      ) {
        return false;
      }
      if (filters.leads.length) {
        const v = leadFilterValue(p);
        if (!v || !filters.leads.includes(v)) return false;
      }
      return true;
    });
    const dir = sortDirection === "asc" ? 1 : -1;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortField === "name") return a.title.localeCompare(b.title) * dir;
      if (sortField === "priority") {
        return (
          (PRIORITY_ORDER[asPriority(a.priority)] -
            PRIORITY_ORDER[asPriority(b.priority)]) *
            dir || a.title.localeCompare(b.title)
        );
      }
      if (sortField === "status") {
        return (
          (STATUS_ORDER[asStatus(a.status)] - STATUS_ORDER[asStatus(b.status)]) *
            dir || a.title.localeCompare(b.title)
        );
      }
      if (sortField === "progress") {
        return (
          (projectProgressRatio(a) - projectProgressRatio(b)) * dir ||
          a.title.localeCompare(b.title)
        );
      }
      return (Date.parse(a.created_at) - Date.parse(b.created_at)) * dir;
    });
    return sorted;
  }, [projects, search, filters, sortField, sortDirection]);

  const selectedProjects = visible.filter((p) => selectedIds.has(p.id));
  const allSelected =
    visible.length > 0 && selectedProjects.length === visible.length;
  const handleToggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(visible.map((p) => p.id)));
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const showEmpty = !isLoading && projects.length === 0;
  const locale = i18n.language || "vi";

  const submitCreate = () => {
    const title = createTitle.trim();
    if (!title) return;
    createProject.mutate(
      { title },
      {
        onSuccess: (created) => {
          setCreateOpen(false);
          setCreateTitle("");
          if (created?.id) onOpenProject(created.id);
        },
      },
    );
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={FolderKanban}
        tone={moduleTone("projects")}
        title={t("projects.page.title")}
        count={projects.length}
        actions={
          <CollectionPageHeaderAction
            icon={Plus}
            label={t("projects.page.new_project")}
            onClick={() => setCreateOpen(true)}
          />
        }
      />

      {showEmpty ? (
        <CollectionPageState
          icon={FolderKanban}
          tone={moduleTone("projects")}
          title={t("projects.page.empty")}
          actions={
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              {t("projects.page.create_first")}
            </Button>
          }
        />
      ) : (
        <>
          <ProjectsListToolbar
            search={search}
            onSearchChange={setSearch}
            visibleCount={visible.length}
            totalCount={projects.length}
            filters={filters}
            toggleFilter={toggleFilter}
            clearFilters={clearFilters}
            sortField={sortField}
            sortDirection={sortDirection}
            setSortField={setSortField}
            setSortDirection={setSortDirection}
            viewMode={viewMode}
            setViewMode={setViewMode}
            hiddenColumns={hiddenColumns}
            toggleColumn={toggleColumn}
            isCompact={isCompact}
          />

          {isLoading ? (
            <LoadingState isCompact={isCompact} />
          ) : visible.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-24 text-muted-foreground">
              <Search className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-body">{t("projects.page.no_matches")}</p>
            </div>
          ) : isCompact ? (
            <ProjectsListTable
              workspaceId={workspaceId}
              projects={visible}
              pinnedIds={pinnedProjectIds}
              canDelete={isWorkspaceAdmin}
              sortField={sortField}
              sortDirection={sortDirection}
              isColVisible={isColVisible}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelected}
              onToggleAll={handleToggleAll}
              onSort={toggleSort}
              onOpenProject={onOpenProject}
              locale={locale}
              resolveLeadName={resolveLeadName}
            />
          ) : (
            <ProjectsListGrid
              workspaceId={workspaceId}
              projects={visible}
              pinnedIds={pinnedProjectIds}
              canDelete={isWorkspaceAdmin}
              onOpenProject={onOpenProject}
              locale={locale}
              resolveLeadName={resolveLeadName}
            />
          )}

          <ProjectBatchToolbar
            workspaceId={workspaceId}
            rows={selectedProjects}
            pinnedIds={pinnedProjectIds}
            canDelete={isWorkspaceAdmin}
            onClear={() => setSelectedIds(new Set())}
          />
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("projects.create_dialog.title")}</DialogTitle>
            <DialogDescription>
              {t("projects.create_dialog.description")}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            placeholder={t("projects.create_dialog.title_placeholder")}
            aria-label={t("projects.create_dialog.title_placeholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
            >
              {t("projects.create_dialog.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!createTitle.trim() || createProject.isPending}
              onClick={submitCreate}
            >
              {t("projects.create_dialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
