import type {
  TableGroupsResult,
  TableRowsBody,
} from "@uniwork/core/api/endpoints/tasks-table";
import type { TableGrouping } from "@uniwork/core/tasks/stores/view-store";
import { tableRowsPageBody } from "@uniwork/core/tasks/surface/table-query";
import type { CursorBranchSpec, CursorBranchState } from "../surface/use-cursor-branches";
import type { TaskTableDisplayRow } from "./table-view-model";

/*
 * The table as cursor branches: one root branch per open group (or one for the
 * whole table), and one child branch per expanded parent on screen, both keyed
 * `(group_key, parent_id)` as the rows API pages them. Parents are closed until
 * the user opens one, so a screen of parents costs no request per parent.
 */

type TableGroup = TableGroupsResult["groups"][number];
type TaskRow = Extract<TaskTableDisplayRow, { kind: "task" }>;

export interface TableParentRef {
  groupKey: string | null;
  parentId: string;
}

const STATIC_GROUPINGS = new Set(["none", "status", "priority", "assignee", "project"]);
const PROPERTY_PREFIX = "property:";
const TABLE_SKELETON_ROWS = 8;
const GROUP_SKELETON_ROWS = 3;

/** The rows API `group_by` for a stored grouping; anything unknown pages ungrouped. */
export function tableGroupByParam(grouping: TableGrouping): string {
  if (STATIC_GROUPINGS.has(grouping)) return grouping;
  if (grouping.startsWith(PROPERTY_PREFIX) && grouping.length > PROPERTY_PREFIX.length) {
    return grouping;
  }
  return "none";
}

export function tableBranchKey(groupKey: string | null, parentId: string | null): string {
  return `${groupKey ?? "__ungrouped"}::${parentId ?? "root"}`;
}

/** The group keys whose root branches are open, in display order. */
function openGroupKeys(
  groupBy: string,
  groups: readonly TableGroup[] | undefined,
  collapsedGroups: ReadonlySet<string>,
): Array<string | null> {
  if (groupBy === "none") return [null];
  return (groups ?? []).filter((g) => !collapsedGroups.has(g.key)).map((g) => g.key);
}

export function planBranches(input: {
  groupBy: string;
  groups: TableGroupsResult["groups"] | undefined;
  collapsedGroups: ReadonlySet<string>;
  hierarchy: boolean;
  expandedParents: ReadonlyArray<TableParentRef>;
  baseBody: Omit<TableRowsBody, "group_key" | "parent_id" | "cursor">;
}): CursorBranchSpec[] {
  const { baseBody } = input;
  const body = (groupKey: string | null, parentId: string | null) =>
    tableRowsPageBody({
      query: baseBody.query,
      groupBy: baseBody.group_by,
      hierarchy: baseBody.hierarchy,
      groupKey,
      parentId,
      cursor: null,
      limit: baseBody.limit,
    });

  const open = openGroupKeys(input.groupBy, input.groups, input.collapsedGroups);
  const specs: CursorBranchSpec[] = open.map((groupKey) => ({
    key: tableBranchKey(groupKey, null),
    body: body(groupKey, null),
    enabled: true,
  }));
  if (!input.hierarchy) return specs;

  const openSet = new Set(open);
  const planned = new Set(specs.map((s) => s.key));
  for (const { groupKey, parentId } of input.expandedParents) {
    const key = tableBranchKey(groupKey, parentId);
    if (!openSet.has(groupKey) || planned.has(key)) continue;
    planned.add(key);
    specs.push({ key, body: body(groupKey, parentId), enabled: true });
  }
  return specs;
}

interface WalkInput {
  groupBy: string;
  groups: TableGroupsResult["groups"] | undefined;
  branches: ReadonlyMap<string, CursorBranchState>;
  collapsedGroups: ReadonlySet<string>;
  hierarchy: boolean;
  expandedParents: ReadonlySet<string>;
}

/**
 * Walks the table top to bottom: groups, their root rows, and under each open
 * parent its child branch. A task id is visited once, which also ends a cycle.
 */
function walkTable(
  input: WalkInput,
  groupLabel: ((group: TableGroup) => string) | null,
  groupColor?: (group: TableGroup) => string | undefined,
): { rows: TaskTableDisplayRow[]; parents: TableParentRef[] } {
  const rows: TaskTableDisplayRow[] = [];
  const parents: TableParentRef[] = [];
  const seen = new Set<string>();

  const appendBranch = (
    groupKey: string | null,
    parentId: string | null,
    depth: number,
    skeletons: number,
  ) => {
    const key = tableBranchKey(groupKey, parentId);
    const branch = input.branches.get(key);
    if (!branch || branch.isLoading) {
      for (let i = 0; i < skeletons; i += 1) {
        rows.push({ kind: "skeleton", key: `skeleton:${key}:${i}`, depth });
      }
      return;
    }

    for (const row of branch.rows) {
      const id = row.task.id;
      if (seen.has(id)) continue;
      seen.add(id);
      const hasChildren = input.hierarchy && row.direct_child_count > 0;
      const expanded = hasChildren && input.expandedParents.has(id);
      const taskRow: TaskRow = {
        kind: "task",
        key: id,
        task: row.task,
        depth,
        hasChildren,
        collapsed: hasChildren && !expanded,
      };
      rows.push(taskRow);
      if (!expanded) continue;
      parents.push({ groupKey, parentId: id });
      appendBranch(groupKey, id, depth + 1, 1);
    }

    if (branch.hasMore || branch.isFetchingMore || branch.isError) {
      rows.push({
        kind: "load_more",
        key: `load_more:${key}`,
        state: branch.isError ? "error" : branch.isFetchingMore ? "loading" : "has_more",
        total: branch.total,
        loadedCount: branch.rows.length,
        depth,
        onLoad: branch.isError ? branch.retry : branch.loadMore,
      });
    }
  };

  if (input.groupBy === "none") {
    appendBranch(null, null, 0, TABLE_SKELETON_ROWS);
    return { rows, parents };
  }
  if (!input.groups) {
    for (let i = 0; i < TABLE_SKELETON_ROWS; i += 1) {
      rows.push({ kind: "skeleton", key: `skeleton:${i}` });
    }
    return { rows, parents };
  }
  for (const group of input.groups) {
    const collapsed = input.collapsedGroups.has(group.key);
    const color = groupColor?.(group);
    rows.push({
      kind: "group",
      key: group.key,
      label: groupLabel ? groupLabel(group) : group.key,
      count: group.count,
      collapsed,
      ...(color ? { color } : {}),
    });
    if (collapsed) continue;
    appendBranch(group.key, null, 0, Math.min(group.count || GROUP_SKELETON_ROWS, GROUP_SKELETON_ROWS));
  }
  return { rows, parents };
}

export function buildDisplayRows(
  input: WalkInput & {
    groupLabel: (group: TableGroup) => string;
    groupColor?: (group: TableGroup) => string | undefined;
  },
): TaskTableDisplayRow[] {
  return walkTable(input, input.groupLabel, input.groupColor).rows;
}

/**
 * The expanded parents actually on screen, with the group they sit in — what
 * `planBranches` asks child branches for. A stored id whose row is not loaded
 * (another view's parent, a deleted task) asks nothing.
 */
export function expandedParentsInView(input: WalkInput): TableParentRef[] {
  return walkTable(input, null).parents;
}

/** Order-sensitive identity of a parent list, to tell a changed plan from a rebuilt array. */
export function tableParentsSignature(parents: ReadonlyArray<TableParentRef>): string {
  return JSON.stringify(parents.map((p) => [p.groupKey, p.parentId]));
}
