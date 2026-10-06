"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderKanban, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { DEFAULT_LOCALE } from "@uniwork/core/i18n";
import {
  useProjectViewStore,
  type ProjectColumnKey,
} from "@uniwork/core/projects/stores/view-store";
import {
  useCreatePin,
  useDeleteProject,
  usePins,
  useProjects,
} from "@uniwork/core/tasks";
import type { Project } from "@uniwork/core/types/project";
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
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import {
  CollectionPageHeader,
  CollectionPageHeaderAction,
  CollectionPageState,
} from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { PAGE_GUTTER } from "../layout/page-header";
import { navigateInternal, useOptionalNavigation } from "../navigation";
import { useWorkspaceAssigneeOptions } from "../tasks/pickers/member-options";
import { CreateProjectDialog } from "./create-project-dialog";
import type { OpenProject } from "./project-row-metrics";
import { ProjectsListGrid } from "./projects-list-grid";
import {
  PROJECTS_PAGE_SIZE,
  ProjectsListPagination,
} from "./projects-list-pagination";
import { ProjectsListTable } from "./projects-list-table";
import { ProjectsListToolbar } from "./projects-list-toolbar";
import {
  countProjectLeads,
  filterAndSortProjects,
} from "./projects-list-visible";

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
      <div
        data-slot="project-batch-toolbar"
        className="z-10 mx-auto mb-2 flex shrink-0 items-center gap-1 rounded-lg border border-border bg-background px-2 py-1.5 shadow-lg"
      >
        <div className="mr-1 flex items-center gap-1.5 border-r border-border pl-1 pr-2">
          <span className="text-body font-medium">
            {t("projects.page.selected", { count: rows.length })}
          </span>
          <button
            type="button"
            aria-label={t("projects.page.clear_selection")}
            onClick={onClear}
            className="rounded p-0.5 transition-colors hover:bg-accent pointer-coarse:min-h-11 pointer-coarse:min-w-11"
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
  workspaceName,
  projectPath,
}: {
  workspaceId: string;
  workspaceName?: string;
  /** In-app path of a project's detail page; tab intents open it in a new tab. */
  projectPath: (projectId: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const navigation = useOptionalNavigation();
  const currentUser = useAuthStore((s) => s.user);
  const { data: listData, isLoading } = useProjects(workspaceId);
  const projects = useMemo(() => listData?.projects ?? [], [listData?.projects]);
  const { data: members = [] } = useMembers(workspaceId);
  const { options: leadOptions } = useWorkspaceAssigneeOptions(workspaceId);
  const { data: pinsData } = usePins(workspaceId);
  const pins = useMemo(() => pinsData?.pins ?? [], [pinsData?.pins]);

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
  const [page, setPage] = useState(1);

  const openProject: OpenProject = (projectId, intent = "push") =>
    navigateInternal(navigation, projectPath(projectId), intent);

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

  const leadCounts = useMemo(
    () => countProjectLeads(projects),
    [projects],
  );

  const visible = useMemo(
    () => filterAndSortProjects(projects, { search, filters, sortField, sortDirection }),
    [projects, search, filters, sortField, sortDirection],
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / PROJECTS_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageProjects = useMemo(
    () =>
      visible.slice(
        (currentPage - 1) * PROJECTS_PAGE_SIZE,
        currentPage * PROJECTS_PAGE_SIZE,
      ),
    [currentPage, visible],
  );

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  const selectedProjects = visible.filter((p) => selectedIds.has(p.id));
  const allSelected =
    pageProjects.length > 0 && pageProjects.every((p) => selectedIds.has(p.id));
  const handleToggleAll = () =>
    setSelectedIds((previous) => {
      const next = new Set(previous);
      for (const project of pageProjects) {
        if (allSelected) next.delete(project.id);
        else next.add(project.id);
      }
      return next;
    });
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const showEmpty = !isLoading && projects.length === 0;
  const locale = i18n.language || DEFAULT_LOCALE;

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
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            visibleCount={visible.length}
            totalCount={projects.length}
            filters={filters}
            leadCounts={leadCounts}
            toggleFilter={(key, value) => {
              toggleFilter(key, value);
              setPage(1);
            }}
            clearFilters={() => {
              clearFilters();
              setPage(1);
            }}
            sortField={sortField}
            sortDirection={sortDirection}
            setSortField={(field) => {
              setSortField(field);
              setPage(1);
            }}
            setSortDirection={(direction) => {
              setSortDirection(direction);
              setPage(1);
            }}
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
              projects={pageProjects}
              pinnedIds={pinnedProjectIds}
              canDelete={isWorkspaceAdmin}
              sortField={sortField}
              sortDirection={sortDirection}
              isColVisible={isColVisible}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelected}
              onToggleAll={handleToggleAll}
              onSort={(field) => {
                toggleSort(field);
                setPage(1);
              }}
              onOpenProject={openProject}
              locale={locale}
              leadOptions={leadOptions}
              scrollResetKey={currentPage}
            />
          ) : (
            <ProjectsListGrid
              workspaceId={workspaceId}
              projects={pageProjects}
              pinnedIds={pinnedProjectIds}
              canDelete={isWorkspaceAdmin}
              onOpenProject={openProject}
              locale={locale}
              leadOptions={leadOptions}
              scrollResetKey={currentPage}
            />
          )}

          <ProjectBatchToolbar
            workspaceId={workspaceId}
            rows={selectedProjects}
            pinnedIds={pinnedProjectIds}
            canDelete={isWorkspaceAdmin}
            onClear={() => setSelectedIds(new Set())}
          />

          <ProjectsListPagination
            page={currentPage}
            pageCount={pageCount}
            onPageChange={setPage}
          />
        </>
      )}

      <CreateProjectDialog
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(projectId) => openProject(projectId)}
      />
    </div>
  );
}
