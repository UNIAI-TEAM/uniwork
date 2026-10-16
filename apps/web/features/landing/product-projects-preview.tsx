"use client";

import { useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Project } from "@uniwork/core/types/project";
import type { ProjectListFilters, ProjectColumnKey, ProjectSortField, ProjectSortDirection, ProjectViewMode } from "@uniwork/core/projects/stores/view-store";
import { useIsCompact } from "@uniwork/ui/hooks/use-mobile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { CollectionPageHeader } from "@uniwork/views/layout/collection-page";
import { MODULE_ICONS } from "@uniwork/views/layout/module-icons";
import { ProjectsListToolbar } from "@uniwork/views/projects/projects-list-toolbar";
import { ProjectsListGrid } from "@uniwork/views/projects/projects-list-grid";
import { ProjectsListTable } from "@uniwork/views/projects/projects-list-table";
import { ProjectOperationsContext } from "@uniwork/views/projects/project-operations-context";
import { ProjectDetailHeader, ProjectDescriptionSection } from "@uniwork/views/projects/project-detail-header";
import { ProjectStatusBadge, ProjectPriorityBadge } from "@uniwork/views/projects/components/project-badge";

export function ProductProjectsPreview({ completed, total, onTasks }: { completed: number; total: number; onTasks: () => void }) {
  const { t, i18n } = useTranslation();
  const compact = useIsCompact();
  const [projects, setProjects] = useState<Project[]>(() => ["UniWork", "Website", "Onboarding", "Marketing"].map((title, index) => ({ id: `demo-project-${index}`, organization_id: "demo", workspace_id: "demo", title, description: t("landing.lovable.projectExample"), status: index === 2 ? "planned" : "in_progress", priority: index === 0 ? "high" : "medium", revision: 1, task_count: index === 0 ? total : 6 + index, done_count: index === 0 ? completed : index, resource_count: 3, lead_type: "member", lead_id: "demo-member", created_at: "2026-10-12T08:00:00Z", updated_at: "2026-10-16T08:00:00Z" })));
  const [pinned, setPinned] = useState(new Set<string>());
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ProjectListFilters>({ statuses: [], priorities: [], leads: [] });
  const [sortField, setSortField] = useState<ProjectSortField>("created");
  const [sortDirection, setSortDirection] = useState<ProjectSortDirection>("desc");
  const [viewMode, setViewMode] = useState<ProjectViewMode>("compact");
  const [hidden, setHidden] = useState<ProjectColumnKey[]>(["tasks"]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const operations = { update: (id: string, patch: Partial<Project>) => setProjects(current => current.map(project => project.id === id ? { ...project, ...patch, revision: project.revision + 1 } : project)), pin: (id: string, value: boolean) => setPinned(current => { const next = new Set(current); if (value) next.add(id); else next.delete(id); return next; }), remove: (id: string) => setProjects(current => current.filter(project => project.id !== id)) };
  const current = projects.find(project => project.id === open);
  const visible = projects.map(project => project.id === "demo-project-0" ? { ...project, task_count: total, done_count: completed } : project).filter(project => project.title.toLowerCase().includes(search.toLowerCase()) && (!filters.statuses.length || filters.statuses.includes(project.status)) && (!filters.priorities.length || filters.priorities.includes(project.priority)) && (!filters.leads.length || filters.leads.includes("member:demo-member"))).sort((a, b) => pinned.has(a.id) !== pinned.has(b.id) ? Number(pinned.has(b.id)) - Number(pinned.has(a.id)) : (sortDirection === "asc" ? 1 : -1) * (sortField === "progress" ? a.done_count / a.task_count - b.done_count / b.task_count : String(sortField === "name" ? a.title : sortField === "created" ? a.created_at : a[sortField]).localeCompare(String(sortField === "name" ? b.title : sortField === "created" ? b.created_at : b[sortField]))));
  const shared = { workspaceId: "", projects: visible, pinnedIds: pinned, canDelete: true, canEdit: () => true, onOpenProject: (id: string) => setOpen(id), locale: i18n.language, leadOptions: [{ id: "demo-member", name: "Đạt Đặng", kind: "human" as const }], scrollResetKey: `${search}:${viewMode}:${sortField}:${sortDirection}` };
  return <ProjectOperationsContext.Provider value={operations}><div className="product-current-projects">
    <CollectionPageHeader headingAs="h2" icon={MODULE_ICONS.projects} tone="teal" title={t("projects.page.title")} count={projects.length} actions={<Button size="sm" onClick={() => { setName(""); setCreating(true); }}><Plus aria-hidden />{t("projects.page.new_project")}</Button>} />
    {current ? <div className="product-current-project-detail"><Button variant="ghost" className="self-start" onClick={() => setOpen(null)}><ArrowLeft aria-hidden />{t("projects.page.title")}</Button><ProjectDetailHeader workspaceId="" project={current} /><div className="flex gap-2"><ProjectStatusBadge project={current} onUpdate={patch => operations.update(current.id, patch)} /><ProjectPriorityBadge project={current} onUpdate={patch => operations.update(current.id, patch)} /></div><ProjectDescriptionSection workspaceId="" project={current} /><Button variant="outline" className="self-start" onClick={onTasks}>{t("tasks.title")}</Button></div> : <>
      <ProjectsListToolbar search={search} onSearchChange={setSearch} visibleCount={visible.length} totalCount={projects.length} filters={filters} leadCounts={new Map([["member:demo-member", projects.length]])} toggleFilter={(key, value) => setFilters(current => ({ ...current, [key]: current[key].includes(value) ? current[key].filter(item => item !== value) : [...current[key], value] }))} clearFilters={() => setFilters({ statuses: [], priorities: [], leads: [] })} sortField={sortField} sortDirection={sortDirection} setSortField={setSortField} setSortDirection={setSortDirection} viewMode={viewMode} setViewMode={setViewMode} hiddenColumns={hidden} toggleColumn={key => setHidden(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])} isCompact={compact} />
      {viewMode === "comfortable" ? <ProjectsListGrid {...shared} /> : <ProjectsListTable {...shared} sortField={sortField} sortDirection={sortDirection} isColVisible={key => !hidden.includes(key)} selectedIds={selected} onToggleSelect={id => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onToggleAll={() => setSelected(selected.size === visible.length ? new Set() : new Set(visible.map(project => project.id)))} onSort={field => { if (field === sortField) setSortDirection(value => value === "asc" ? "desc" : "asc"); else setSortField(field); }} />}
    </>}
    <Dialog open={creating} onOpenChange={setCreating}><DialogContent><DialogHeader><DialogTitle>{t("projects.page.new_project")}</DialogTitle><DialogDescription>{t("landing.lovable.sample")}</DialogDescription></DialogHeader><form onSubmit={event => { event.preventDefault(); if (!name.trim()) return; const id = `local-project-${projects.length}`; setProjects(current => [...current, { ...current[0]!, id, title: name.trim(), task_count: 0, done_count: 0, status: "planned" }]); setOpen(id); setCreating(false); }}><label>{t("projects.table.name")}<Input value={name} onChange={event => setName(event.target.value)} autoFocus required /></label><DialogFooter className="mt-4"><Button type="submit" disabled={!name.trim()}>{t("common.create")}</Button></DialogFooter></form></DialogContent></Dialog>
  </div></ProjectOperationsContext.Provider>;
}
