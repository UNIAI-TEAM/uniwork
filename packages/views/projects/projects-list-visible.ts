import {
  PROJECT_PRIORITY_ORDER,
  PROJECT_STATUS_ORDER,
} from "@uniwork/core/projects/config";
import type {
  ProjectListFilters,
  ProjectSortDirection,
  ProjectSortField,
} from "@uniwork/core/projects/stores/view-store";
import type { ActorFilterValue } from "@uniwork/core/tasks/stores/view-store-types";
import type { Project, ProjectPriority, ProjectStatus } from "@uniwork/core/types/project";
import { foldedIncludes } from "../chat/chat-search-fold";
import { leadFilterValue, projectProgressRatio } from "./project-row-metrics";

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

/** Search (diacritic-insensitive title match) + filters, then the chosen sort. */
export function filterAndSortProjects(
  projects: readonly Project[],
  {
    search,
    filters,
    sortField,
    sortDirection,
  }: {
    search: string;
    filters: ProjectListFilters;
    sortField: ProjectSortField;
    sortDirection: ProjectSortDirection;
  },
): Project[] {
  const filtered = projects.filter((p) => {
    if (!foldedIncludes(p.title, search)) return false;
    if (filters.statuses.length && !filters.statuses.includes(p.status)) return false;
    if (filters.priorities.length && !filters.priorities.includes(p.priority)) return false;
    if (filters.leads.length) {
      const v = leadFilterValue(p);
      if (!v || !filters.leads.includes(v)) return false;
    }
    return true;
  });
  const dir = sortDirection === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    if (sortField === "name") return a.title.localeCompare(b.title) * dir;
    if (sortField === "priority") {
      return (
        (PRIORITY_ORDER[asPriority(a.priority)] - PRIORITY_ORDER[asPriority(b.priority)]) * dir ||
        a.title.localeCompare(b.title)
      );
    }
    if (sortField === "status") {
      return (
        (STATUS_ORDER[asStatus(a.status)] - STATUS_ORDER[asStatus(b.status)]) * dir ||
        a.title.localeCompare(b.title)
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
}

/**
 * How many projects each lead leads, keyed like `filters.leads`. Counted over
 * ALL projects, so toggling another dimension never changes the numbers.
 */
export function countProjectLeads(projects: readonly Project[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of projects) {
    const value = leadFilterValue(p);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/** `filters.leads` as the shared actor filter's selection; unknown kinds drop out. */
export function leadFiltersToActors(leads: readonly string[]): ActorFilterValue[] {
  return leads.flatMap((value) => {
    const [type, ...rest] = value.split(":");
    const id = rest.join(":");
    return (type === "member" || type === "agent") && id ? [{ type, id }] : [];
  });
}
