"use client";

import type { ReactNode } from "react";
import {
  CircleDot,
  Filter,
  FolderKanban,
  ListFilter,
  SignalHigh,
  Tag,
  User,
  UserRoundPen,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import {
  useProjects,
  useTaskLabels,
  useTaskProperties,
} from "@uniwork/core/tasks";
import type { ActorFilterValue } from "@uniwork/core/tasks/stores/view-store";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import { TASK_PRIORITIES, TASK_STATUSES } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import {
  SAVE_VIEW_CHIP_ICON,
  SaveViewActorPreview,
  type SaveViewFilterChip,
  SaveViewFilterChipView,
  SaveViewPriorityPreview,
  SaveViewStatusPreview,
} from "./save-view-filter-chip";

export function SaveViewFilterMenu({
  workspaceId,
  lockProjectFilter = false,
  compact = false,
}: {
  workspaceId: string;
  lockProjectFilter?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { data: members = [] } = useMembers(workspaceId);
  const { data: agents = [] } = useWorkspaceAgents(workspaceId);
  const { data: projectList } = useProjects(workspaceId);
  const { data: labelList } = useTaskLabels(workspaceId);
  const { data: propertyList } = useTaskProperties(workspaceId);
  const projects = projectList?.projects ?? [];
  const labels = labelList?.labels ?? [];
  const properties = propertyList?.properties ?? [];

  const statusFilters = useViewStore((s) => s.statusFilters);
  const priorityFilters = useViewStore((s) => s.priorityFilters);
  const assigneeFilters = useViewStore((s) => s.assigneeFilters);
  const includeNoAssignee = useViewStore((s) => s.includeNoAssignee);
  const creatorFilters = useViewStore((s) => s.creatorFilters);
  const projectFilters = useViewStore((s) => s.projectFilters);
  const includeNoProject = useViewStore((s) => s.includeNoProject);
  const labelFilters = useViewStore((s) => s.labelFilters);
  const propertyFilters = useViewStore((s) => s.propertyFilters);
  const toggleStatusFilter = useViewStore((s) => s.toggleStatusFilter);
  const togglePriorityFilter = useViewStore((s) => s.togglePriorityFilter);
  const toggleAssigneeFilter = useViewStore((s) => s.toggleAssigneeFilter);
  const toggleNoAssignee = useViewStore((s) => s.toggleNoAssignee);
  const toggleCreatorFilter = useViewStore((s) => s.toggleCreatorFilter);
  const toggleProjectFilter = useViewStore((s) => s.toggleProjectFilter);
  const toggleNoProject = useViewStore((s) => s.toggleNoProject);
  const toggleLabelFilter = useViewStore((s) => s.toggleLabelFilter);
  const clearFilters = useViewStore((s) => s.clearFilters);
  const clearFilterDimension = useViewStore((s) => s.clearFilterDimension);

  const actorDetails = (values: ActorFilterValue[]) =>
    values.map((value) => {
      if (value.type === "member") {
        const member = members.find(({ user_id }) => user_id === value.id);
        return {
          id: value.id,
          name: member?.display_name || member?.email || value.id,
          avatarUrl:
            typeof member?.avatar_url === "string"
              ? member.avatar_url
              : undefined,
        };
      }
      const agent = agents.find(({ id }) => id === value.id);
      return {
        id: value.id,
        name: agent?.name || value.id,
        avatarUrl: agent?.avatar_url,
      };
    });

  const chips: SaveViewFilterChip[] = [];
  if (statusFilters.length > 0) {
    chips.push({
      key: "status",
      dimension: "status",
      icon: <CircleDot className={SAVE_VIEW_CHIP_ICON} aria-hidden />,
      label: t("tasks.filters.status"),
      preview: <SaveViewStatusPreview statuses={statusFilters} />,
      value:
        statusFilters.length === 1
          ? t(`tasks.status_${statusFilters[0]}`)
          : t("tasks.filters.status_count", { count: statusFilters.length }),
    });
  }
  if (priorityFilters.length > 0) {
    chips.push({
      key: "priority",
      dimension: "priority",
      icon: <SignalHigh className={SAVE_VIEW_CHIP_ICON} aria-hidden />,
      label: t("tasks.filters.priority"),
      preview: <SaveViewPriorityPreview priorities={priorityFilters} />,
      value:
        priorityFilters.length === 1
          ? t(`tasks.priority_${priorityFilters[0]}`)
          : t("tasks.filters.priority_count", { count: priorityFilters.length }),
    });
  }
  const selectedAssignees = actorDetails(assigneeFilters);
  const assigneeCount = selectedAssignees.length + (includeNoAssignee ? 1 : 0);
  if (assigneeCount > 0) {
    chips.push({
      key: "assignee",
      dimension: "assignee",
      icon: <User className={SAVE_VIEW_CHIP_ICON} aria-hidden />,
      label: t("tasks.filters.assignee"),
      preview: <SaveViewActorPreview actors={selectedAssignees} />,
      value:
        assigneeCount === 1
          ? includeNoAssignee
            ? t("tasks.unassigned")
            : selectedAssignees[0]?.name ?? ""
          : String(assigneeCount),
    });
  }
  const selectedCreators = actorDetails(creatorFilters);
  if (selectedCreators.length > 0) {
    chips.push({
      key: "creator",
      dimension: "creator",
      icon: <UserRoundPen className={SAVE_VIEW_CHIP_ICON} aria-hidden />,
      label: t("tasks.filters.creator"),
      preview: <SaveViewActorPreview actors={selectedCreators} />,
      value:
        selectedCreators.length === 1
          ? selectedCreators[0]?.name ?? ""
          : String(selectedCreators.length),
    });
  }
  const selectedProjects = projects.filter(({ id }) =>
    projectFilters.includes(id),
  );
  const projectCount = selectedProjects.length + (includeNoProject ? 1 : 0);
  if (!lockProjectFilter && projectCount > 0) {
    chips.push({
      key: "project",
      dimension: "project",
      icon: <FolderKanban className={SAVE_VIEW_CHIP_ICON} aria-hidden />,
      label: t("tasks.filters.project"),
      value:
        projectCount === 1
          ? includeNoProject
            ? t("tasks.save_view.no_project")
            : selectedProjects[0]?.title ?? ""
          : t("tasks.filters.project_count", { count: projectCount }),
    });
  }
  const selectedLabels = labels.filter(({ id }) => labelFilters.includes(id));
  if (selectedLabels.length > 0) {
    chips.push({
      key: "label",
      dimension: "label",
      icon: <Tag className={SAVE_VIEW_CHIP_ICON} aria-hidden />,
      label: t("tasks.filters.label"),
      value:
        selectedLabels.length === 1
          ? selectedLabels[0]?.name ?? ""
          : t("tasks.filters.label_count", { count: selectedLabels.length }),
    });
  }
  for (const [propertyId, values] of Object.entries(propertyFilters)) {
    if (values.length === 0) continue;
    chips.push({
      key: `property:${propertyId}`,
      dimension: `property:${propertyId}`,
      icon: <ListFilter className={SAVE_VIEW_CHIP_ICON} aria-hidden />,
      label:
        properties.find(({ id }) => id === propertyId)?.name ??
        t("tasks.filters.property"),
      value:
        values.length === 1
          ? values[0] ?? ""
          : t("tasks.filters.count_values", { count: values.length }),
    });
  }
  const activeCount = chips.length;

  return (
    <div
      className={cn(
        "space-y-1.5",
        compact && "flex min-w-0 flex-wrap items-center gap-1.5 space-y-0",
      )}
    >
      {!compact ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-body font-medium">
            {t("tasks.save_view.filters")}
          </span>
          {activeCount > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-3.5" aria-hidden />
              {t("tasks.filters.clear")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {chips.map((chip) => (
        <SaveViewFilterChipView
          key={chip.key}
          chip={chip}
          onRemove={() => clearFilterDimension(chip.dimension)}
        />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                "justify-start gap-2 border-dashed",
                compact ? "w-fit" : "w-full",
              )}
              aria-label={t("tasks.save_view.add_filter")}
            />
          }
        >
          <Filter className="size-3.5" aria-hidden />
          <span>{t("tasks.save_view.add_filter")}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <FilterSubmenu label={t("tasks.filters.status")}>
            {TASK_STATUSES.map((status) => (
              <DropdownMenuCheckboxItem
                key={status}
                checked={statusFilters.includes(status)}
                onCheckedChange={() => toggleStatusFilter(status)}
              >
                {t(`tasks.status_${status}`)}
              </DropdownMenuCheckboxItem>
            ))}
          </FilterSubmenu>

          <FilterSubmenu label={t("tasks.filters.priority")}>
            {TASK_PRIORITIES.map((priority) => (
              <DropdownMenuCheckboxItem
                key={priority}
                checked={priorityFilters.includes(priority)}
                onCheckedChange={() => togglePriorityFilter(priority)}
              >
                {t(`tasks.priority_${priority}`)}
              </DropdownMenuCheckboxItem>
            ))}
          </FilterSubmenu>

          <FilterSubmenu label={t("tasks.filters.assignee")}>
            <DropdownMenuCheckboxItem
              checked={includeNoAssignee}
              onCheckedChange={toggleNoAssignee}
            >
              {t("tasks.unassigned")}
            </DropdownMenuCheckboxItem>
            <ActorOptions
              members={members}
              agents={agents}
              values={assigneeFilters}
              onToggle={toggleAssigneeFilter}
            />
          </FilterSubmenu>

          <FilterSubmenu label={t("tasks.filters.creator")}>
            <ActorOptions
              members={members}
              agents={agents}
              values={creatorFilters}
              onToggle={toggleCreatorFilter}
            />
          </FilterSubmenu>

          {!lockProjectFilter ? (
            <FilterSubmenu label={t("tasks.filters.project")}>
              <DropdownMenuCheckboxItem
                checked={includeNoProject}
                onCheckedChange={toggleNoProject}
              >
                {t("tasks.save_view.no_project")}
              </DropdownMenuCheckboxItem>
              {projects.map((project) => (
                <DropdownMenuCheckboxItem
                  key={project.id}
                  checked={projectFilters.includes(project.id)}
                  onCheckedChange={() => toggleProjectFilter(project.id)}
                >
                  <span className="max-w-52 truncate">{project.title}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </FilterSubmenu>
          ) : null}

          <FilterSubmenu label={t("tasks.filters.label")}>
            {labels.length > 0 ? (
              labels.map((label) => (
                <DropdownMenuCheckboxItem
                  key={label.id}
                  checked={labelFilters.includes(label.id)}
                  onCheckedChange={() => toggleLabelFilter(label.id)}
                >
                  <span className="max-w-52 truncate">{label.name}</span>
                </DropdownMenuCheckboxItem>
              ))
            ) : (
              <DropdownMenuItem disabled>
                {t("tasks.save_view.no_options")}
              </DropdownMenuItem>
            )}
          </FilterSubmenu>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function FilterSubmenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 min-w-56 overflow-y-auto">
        {children}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ActorOptions({
  members,
  agents,
  values,
  onToggle,
}: {
  members: Array<{ user_id: string; display_name: string; email: string }>;
  agents: Array<{ id: string; name: string }>;
  values: ActorFilterValue[];
  onToggle: (value: ActorFilterValue) => void;
}) {
  const { t } = useTranslation();
  if (members.length === 0 && agents.length === 0) {
    return (
      <DropdownMenuItem disabled>
        {t("tasks.save_view.no_options")}
      </DropdownMenuItem>
    );
  }
  return (
    <>
      {members.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("tasks.save_view.members")}</DropdownMenuLabel>
            {members.map((member) => {
              const value = { type: "member", id: member.user_id } as const;
              return (
                <DropdownMenuCheckboxItem
                  key={member.user_id}
                  checked={actorChecked(values, value)}
                  onCheckedChange={() => onToggle(value)}
                >
                  <span className="max-w-52 truncate">
                    {member.display_name || member.email}
                  </span>
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuGroup>
        </>
      ) : null}
      {agents.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("tasks.save_view.agents")}</DropdownMenuLabel>
            {agents.map((agent) => {
              const value = { type: "agent", id: agent.id } as const;
              return (
                <DropdownMenuCheckboxItem
                  key={agent.id}
                  checked={actorChecked(values, value)}
                  onCheckedChange={() => onToggle(value)}
                >
                  <span className="max-w-52 truncate">{agent.name}</span>
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuGroup>
        </>
      ) : null}
    </>
  );
}

function actorChecked(
  values: ActorFilterValue[],
  value: ActorFilterValue,
): boolean {
  return values.some(({ type, id }) => type === value.type && id === value.id);
}
