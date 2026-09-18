"use client";

import { useMemo, type ReactNode } from "react";
import {
  CalendarDays,
  CircleDot,
  FolderKanban,
  ListFilter,
  SignalHigh,
  Tag,
  User,
  UserRoundPen,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import {
  useProjects,
  useTaskLabels,
  useTaskProperties,
} from "@uniwork/core/tasks";
import {
  useViewStore,
  useViewStoreApi,
} from "@uniwork/core/tasks/stores/view-store-context";
import type {
  ActorFilterValue,
  FilterDimension,
  FilterSnapshot,
  TaskDateFilter,
} from "@uniwork/core/tasks/stores/view-store-types";
import {
  actorFilterKey,
  type TaskViewBaseline,
} from "@uniwork/core/tasks/views/baseline";
import { useMembers } from "@uniwork/core/workspaces";
import { getActiveFilterCount } from "../filters/filter-counts";
import {
  SaveViewActorPreview,
  SaveViewPriorityPreview,
  SaveViewStatusPreview,
} from "./save-view-filter-chip";
import {
  actorFilterValues,
  buildChipActorNames,
  hasActorPropertyFilterSelection,
  isActorPropertyType,
  propertyFilterOptionColors,
  propertyFilterOptionLabel,
  summarizeChipNames,
} from "./filter-chips-helpers";

export interface FilterChip {
  key: string;
  icon: ReactNode;
  label: string;
  value: string;
  preview?: ReactNode;
  onRemove: () => void;
}

const CHIP_ICON = "size-3 shrink-0 text-muted-foreground";

function DotStack({ colors }: { colors: string[] }) {
  if (colors.length === 0) return null;
  return (
    <span className="flex items-center -space-x-1" aria-hidden>
      {colors.slice(0, 3).map((color, i) => (
        <span
          key={i}
          className="inline-flex size-4 items-center justify-center rounded-full bg-background ring-1 ring-border"
        >
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: color }}
          />
        </span>
      ))}
    </span>
  );
}

export function useFilterChips(
  workspaceId: string,
  dateFilter: TaskDateFilter | null,
  onDateFilterChange: ((filter: TaskDateFilter | null) => void) | undefined,
  baseline: TaskViewBaseline | undefined,
  lockProjectFilter: boolean,
) {
  const { t } = useTranslation();
  const store = useViewStoreApi();

  const statusFilters = useViewStore((s) => s.statusFilters);
  const priorityFilters = useViewStore((s) => s.priorityFilters);
  const assigneeFilters = useViewStore((s) => s.assigneeFilters);
  const includeNoAssignee = useViewStore((s) => s.includeNoAssignee);
  const creatorFilters = useViewStore((s) => s.creatorFilters);
  const projectFilters = useViewStore((s) => s.projectFilters);
  const includeNoProject = useViewStore((s) => s.includeNoProject);
  const labelFilters = useViewStore((s) => s.labelFilters);
  const propertyFilters = useViewStore((s) => s.propertyFilters);
  const setDateFilter = useViewStore((s) => s.setDateFilter);

  const hasPropertyFilterSelection = Object.values(propertyFilters).some(
    (selected) => selected.length > 0,
  );

  const hasStoreFilters =
    statusFilters.length > 0 ||
    priorityFilters.length > 0 ||
    assigneeFilters.length > 0 ||
    includeNoAssignee ||
    creatorFilters.length > 0 ||
    projectFilters.length > 0 ||
    includeNoProject ||
    labelFilters.length > 0 ||
    hasPropertyFilterSelection;

  const { data: propertyList } = useTaskProperties(
    hasStoreFilters && hasPropertyFilterSelection ? workspaceId : "",
  );
  const workspaceProperties = propertyList?.properties;
  const hasActorPropertyFilter = useMemo(
    () =>
      hasActorPropertyFilterSelection(
        propertyFilters,
        workspaceProperties ?? [],
      ),
    [propertyFilters, workspaceProperties],
  );

  const loadMembers =
    hasStoreFilters &&
    (assigneeFilters.length > 0 ||
      creatorFilters.length > 0 ||
      hasActorPropertyFilter);
  const { data: members = [] } = useMembers(loadMembers ? workspaceId : "");
  const { data: agents = [] } = useWorkspaceAgents(
    hasStoreFilters &&
      (assigneeFilters.length > 0 || creatorFilters.length > 0)
      ? workspaceId
      : "",
  );
  const { data: projectList } = useProjects(
    hasStoreFilters && projectFilters.length > 0 ? workspaceId : "",
  );
  const { data: labelList } = useTaskLabels(
    hasStoreFilters && labelFilters.length > 0 ? workspaceId : "",
  );
  const projects = projectList?.projects ?? [];
  const labels = labelList?.labels ?? [];

  const actorName = useMemo(
    () => buildChipActorNames(members, agents),
    [members, agents],
  );

  const clearDimension = (dimension: FilterDimension) => {
    if (!baseline) {
      store.getState().clearFilterDimension(dimension);
      return;
    }
    const s = store.getState();
    const raw = baseline.raw;
    const current: FilterSnapshot = {
      statusFilters: s.statusFilters,
      priorityFilters: s.priorityFilters,
      assigneeFilters: s.assigneeFilters,
      includeNoAssignee: s.includeNoAssignee,
      creatorFilters: s.creatorFilters,
      projectFilters: s.projectFilters,
      includeNoProject: s.includeNoProject,
      labelFilters: s.labelFilters,
      propertyFilters: s.propertyFilters,
    };
    switch (dimension) {
      case "status":
        s.resetFiltersTo({ ...current, statusFilters: raw.statusFilters });
        break;
      case "priority":
        s.resetFiltersTo({ ...current, priorityFilters: raw.priorityFilters });
        break;
      case "assignee":
        s.resetFiltersTo({
          ...current,
          assigneeFilters: raw.assigneeFilters,
          includeNoAssignee: raw.includeNoAssignee,
        });
        break;
      case "creator":
        s.resetFiltersTo({ ...current, creatorFilters: raw.creatorFilters });
        break;
      case "project":
        s.resetFiltersTo({
          ...current,
          projectFilters: raw.projectFilters,
          includeNoProject: raw.includeNoProject,
        });
        break;
      case "label":
        s.resetFiltersTo({ ...current, labelFilters: raw.labelFilters });
        break;
      default: {
        const propertyId = dimension.slice("property:".length);
        const nextPropertyFilters = { ...current.propertyFilters };
        const base = raw.propertyFilters[propertyId];
        if (base) nextPropertyFilters[propertyId] = base;
        else delete nextPropertyFilters[propertyId];
        s.resetFiltersTo({
          ...current,
          propertyFilters: nextPropertyFilters,
        });
      }
    }
  };

  const deltaStatus = baseline
    ? statusFilters.filter((s) => !baseline.status.has(s))
    : statusFilters;
  const deltaPriority = baseline
    ? priorityFilters.filter((p) => !baseline.priority.has(p))
    : priorityFilters;
  const deltaAssignees = baseline
    ? assigneeFilters.filter((a) => !baseline.assignee.has(actorFilterKey(a)))
    : assigneeFilters;
  const deltaNoAssignee = baseline
    ? includeNoAssignee && !baseline.includeNoAssignee
    : includeNoAssignee;
  const deltaCreators = baseline
    ? creatorFilters.filter((a) => !baseline.creator.has(actorFilterKey(a)))
    : creatorFilters;
  const deltaProjects = baseline
    ? projectFilters.filter((id) => !baseline.project.has(id))
    : projectFilters;
  const deltaNoProject = baseline
    ? includeNoProject && !baseline.includeNoProject
    : includeNoProject;
  const deltaLabels = baseline
    ? labelFilters.filter((id) => !baseline.label.has(id))
    : labelFilters;
  const deltaProperties: Record<string, string[]> = {};
  for (const [id, selected] of Object.entries(propertyFilters)) {
    const fixed = baseline?.property.get(id);
    const delta = fixed ? selected.filter((v) => !fixed.has(v)) : selected;
    if (delta.length > 0) deltaProperties[id] = delta;
  }

  const actorDetails = (values: ActorFilterValue[]) =>
    values.map((value) => {
      const name = actorName(value) ?? value.id;
      return {
        id: value.id,
        name,
        avatarUrl: undefined as string | undefined,
      };
    });

  const chips: FilterChip[] = [];

  if (deltaStatus.length > 0) {
    chips.push({
      key: "status",
      icon: <CircleDot className={CHIP_ICON} aria-hidden />,
      label: t("tasks.filters.status"),
      preview: <SaveViewStatusPreview statuses={deltaStatus} />,
      value:
        deltaStatus.length === 1
          ? t(`tasks.status_${deltaStatus[0]}`)
          : t("tasks.filters.status_count", { count: deltaStatus.length }),
      onRemove: () => clearDimension("status"),
    });
  }
  if (deltaPriority.length > 0) {
    chips.push({
      key: "priority",
      icon: <SignalHigh className={CHIP_ICON} aria-hidden />,
      label: t("tasks.filters.priority"),
      preview: <SaveViewPriorityPreview priorities={deltaPriority} />,
      value:
        deltaPriority.length === 1
          ? t(`tasks.priority_${deltaPriority[0]}`)
          : t("tasks.filters.priority_count", { count: deltaPriority.length }),
      onRemove: () => clearDimension("priority"),
    });
  }
  if (deltaAssignees.length > 0 || deltaNoAssignee) {
    const names = deltaAssignees.map(actorName);
    if (deltaNoAssignee) names.push(t("tasks.unassigned"));
    chips.push({
      key: "assignee",
      icon: <User className={CHIP_ICON} aria-hidden />,
      label: t("tasks.filters.assignee"),
      preview:
        deltaAssignees.length > 0 ? (
          <SaveViewActorPreview actors={actorDetails(deltaAssignees)} />
        ) : undefined,
      value: summarizeChipNames(names),
      onRemove: () => clearDimension("assignee"),
    });
  }
  if (deltaCreators.length > 0) {
    chips.push({
      key: "creator",
      icon: <UserRoundPen className={CHIP_ICON} aria-hidden />,
      label: t("tasks.filters.creator"),
      preview: <SaveViewActorPreview actors={actorDetails(deltaCreators)} />,
      value: summarizeChipNames(deltaCreators.map(actorName)),
      onRemove: () => clearDimension("creator"),
    });
  }
  if (!lockProjectFilter && (deltaProjects.length > 0 || deltaNoProject)) {
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const names = deltaProjects.map((id) => projectById.get(id)?.title);
    if (deltaNoProject) names.push(t("tasks.save_view.no_project"));
    chips.push({
      key: "project",
      icon: <FolderKanban className={CHIP_ICON} aria-hidden />,
      label: t("tasks.filters.project"),
      value: summarizeChipNames(names),
      onRemove: () => clearDimension("project"),
    });
  }
  if (deltaLabels.length > 0) {
    const labelById = new Map(labels.map((l) => [l.id, l]));
    chips.push({
      key: "label",
      icon: <Tag className={CHIP_ICON} aria-hidden />,
      label: t("tasks.filters.label"),
      preview: (
        <DotStack
          colors={deltaLabels
            .map((id) => labelById.get(id)?.color)
            .filter((c): c is string => !!c)}
        />
      ),
      value: summarizeChipNames(deltaLabels.map((id) => labelById.get(id)?.name)),
      onRemove: () => clearDimension("label"),
    });
  }
  for (const [propertyId, selected] of Object.entries(deltaProperties)) {
    if (selected.length === 0) continue;
    const definition = (workspaceProperties ?? []).find(
      (p) => p.id === propertyId,
    );
    if (!definition) continue;
    const actorProperty = isActorPropertyType(definition.type);
    const actorValues = actorProperty ? actorFilterValues(selected) : [];
    const optionColors = propertyFilterOptionColors(definition, selected);
    chips.push({
      key: `property:${propertyId}`,
      icon: <ListFilter className={CHIP_ICON} aria-hidden />,
      label: definition.name,
      preview:
        actorValues.length > 0 ? (
          <SaveViewActorPreview actors={actorDetails(actorValues)} />
        ) : optionColors.length > 0 ? (
          <DotStack colors={optionColors} />
        ) : undefined,
      value: summarizeChipNames(
        selected.map((id) =>
          propertyFilterOptionLabel(definition, id, t, actorName),
        ),
      ),
      onRemove: () => clearDimension(`property:${propertyId}`),
    });
  }
  if (dateFilter) {
    const fieldLabel =
      dateFilter.field === "created_at"
        ? t("tasks.filters.date_field_created")
        : t("tasks.filters.date_field_updated");
    chips.push({
      key: "date",
      icon: <CalendarDays className={CHIP_ICON} aria-hidden />,
      label: fieldLabel,
      value:
        dateFilter.from === dateFilter.to
          ? dateFilter.from
          : `${dateFilter.from} – ${dateFilter.to}`,
      onRemove: () => {
        setDateFilter(null);
        onDateFilterChange?.(null);
      },
    });
  }

  const clearAll = () => {
    if (baseline) {
      store.getState().resetFiltersTo(baseline.raw);
      setDateFilter(null);
      onDateFilterChange?.(null);
      return;
    }
    store.getState().clearFilters();
    onDateFilterChange?.(null);
  };

  const snapshot: FilterSnapshot & { dateFilter?: TaskDateFilter | null } = {
    statusFilters,
    priorityFilters,
    assigneeFilters,
    includeNoAssignee,
    creatorFilters,
    projectFilters,
    includeNoProject,
    labelFilters,
    propertyFilters,
    dateFilter,
  };
  const activeCount = getActiveFilterCount(
    snapshot,
    baseline,
    lockProjectFilter,
  );

  return { chips, activeCount, clearAll };
}
