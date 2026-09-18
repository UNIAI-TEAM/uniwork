import type { TableFilter } from "../../api/endpoints/tasks-table";
import type {
  ActorFilterValue,
  FilterSnapshot,
  TaskDateFilter,
} from "../stores/view-store-types";

export interface MapStoreToTableFilterOptions {
  lockProjectFilter?: boolean;
  dateFilter?: TaskDateFilter | null;
}

function actorToCreatorRef(actor: ActorFilterValue): string | null {
  if (actor.type === "squad") return null;
  const kind = actor.type === "member" ? "human" : "agent";
  return `${kind}:${actor.id}`;
}

function assigneeIdsFromFilters(assignees: ActorFilterValue[]): string[] {
  const ids: string[] = [];
  for (const actor of assignees) {
    if (actor.type === "squad") continue;
    ids.push(actor.id);
  }
  return ids;
}

function propertiesFromSnapshot(
  propertyFilters: Record<string, string[]>,
): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(propertyFilters)) {
    if (values.length > 0) out[key] = values;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function mapStoreToTableFilter(
  snapshot: FilterSnapshot,
  opts: MapStoreToTableFilterOptions = {},
): TableFilter {
  const out: TableFilter = {};

  if (snapshot.statusFilters.length > 0) {
    out.statuses = [...snapshot.statusFilters];
  }
  if (snapshot.priorityFilters.length > 0) {
    out.priorities = [...snapshot.priorityFilters];
  }

  const assigneeIds = assigneeIdsFromFilters(snapshot.assigneeFilters);
  if (assigneeIds.length > 0) {
    out.assignee_ids = assigneeIds;
  }
  if (snapshot.includeNoAssignee) {
    out.include_no_assignee = true;
  }

  const creatorRefs = snapshot.creatorFilters
    .map(actorToCreatorRef)
    .filter((ref): ref is string => ref !== null);
  if (creatorRefs.length > 0) {
    out.creator_refs = creatorRefs;
  }

  if (!opts.lockProjectFilter) {
    if (snapshot.projectFilters.length > 0) {
      out.project_ids = [...snapshot.projectFilters];
    }
    if (snapshot.includeNoProject) {
      out.include_no_project = true;
    }
  }

  if (snapshot.labelFilters.length > 0) {
    out.label_ids = [...snapshot.labelFilters];
  }

  const properties = propertiesFromSnapshot(snapshot.propertyFilters);
  if (properties) {
    out.properties = properties;
  }

  const dateFilter = opts.dateFilter;
  if (dateFilter) {
    out.date_field = dateFilter.field;
    out.date_from = dateFilter.from;
    out.date_to = dateFilter.to;
  }

  return out;
}
