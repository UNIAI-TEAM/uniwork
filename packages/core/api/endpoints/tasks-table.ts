import { z } from "zod";
import { TaskSchema, type Task } from "../../types/task";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const TableActorRefSchema = z.object({
  type: z.string(),
  id: z.string(),
});

const TableGroupValueSchema = z.object({
  kind: z.string(),
  status: z.string().optional(),
  priority: z.string().optional(),
  actor: TableActorRefSchema.optional(),
});

const TableGroupDescriptorSchema = z.object({
  key: z.string(),
  value: TableGroupValueSchema,
  count: z.number(),
});

const TableGroupsSchema = z.object({
  query_fingerprint: z.string(),
  total: z.number(),
  groups: z.array(TableGroupDescriptorSchema),
  next_cursor: z.string().nullable().optional(),
});
export type TableGroupsResult = z.infer<typeof TableGroupsSchema>;

const TableRowSchema = z.object({
  task: TaskSchema,
  direct_child_count: z.number(),
});

const TableRowsSchema = z.object({
  query_fingerprint: z.string(),
  group_key: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  total: z.number(),
  rows: z.array(TableRowSchema),
  branch_total: z.number(),
  next_cursor: z.string().nullable().optional(),
});
export type TableRowsResult = Omit<z.infer<typeof TableRowsSchema>, "rows"> & {
  rows: Array<{ task: Task; direct_child_count: number }>;
};

const TableFacetValueSchema = z.object({
  key: z.string(),
  count: z.number(),
});

const TableFacetSchema = z.object({
  kind: z.string(),
  values: z.array(TableFacetValueSchema),
});

const TableFacetsSchema = z.object({
  query_fingerprint: z.string(),
  total: z.number(),
  facets: z.array(TableFacetSchema),
});
export type TableFacetsResult = z.infer<typeof TableFacetsSchema>;

export interface TableFilter {
  statuses?: string[];
  priorities?: string[];
  assignee_ids?: string[];
}

export interface TableGroupsBody {
  filter?: TableFilter;
  group_by: string;
  columns?: string[];
  limit?: number;
  offset?: number;
}

export interface TableRowsBody {
  filter?: TableFilter;
  group_by: string;
  group_key?: string | null;
  columns?: string[];
  limit?: number;
  offset?: number;
}

export interface TableFacetsBody {
  filter?: TableFilter;
  facets: string[];
  columns?: string[];
}

const enc = encodeURIComponent;

const emptyGroups: TableGroupsResult = {
  query_fingerprint: "",
  total: 0,
  groups: [],
  next_cursor: null,
};

const emptyRows: TableRowsResult = {
  query_fingerprint: "",
  group_key: null,
  parent_id: null,
  total: 0,
  rows: [],
  branch_total: 0,
  next_cursor: null,
};

const emptyFacets: TableFacetsResult = {
  query_fingerprint: "",
  total: 0,
  facets: [],
};

export async function tableGroups(
  workspaceId: string,
  body: TableGroupsBody,
): Promise<TableGroupsResult> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/tasks/table/groups`, {
    method: "POST",
    body,
  });
  return parseWithFallback(raw, TableGroupsSchema, emptyGroups, {
    endpoint: "POST /api/v1/workspaces/{ws}/tasks/table/groups",
  });
}

export async function tableRows(
  workspaceId: string,
  body: TableRowsBody,
): Promise<TableRowsResult> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/tasks/table/rows`, {
    method: "POST",
    body,
  });
  return parseWithFallback(raw, TableRowsSchema, emptyRows, {
    endpoint: "POST /api/v1/workspaces/{ws}/tasks/table/rows",
  });
}

export async function tableFacets(
  workspaceId: string,
  body: TableFacetsBody,
): Promise<TableFacetsResult> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/tasks/table/facets`, {
    method: "POST",
    body,
  });
  return parseWithFallback(raw, TableFacetsSchema, emptyFacets, {
    endpoint: "POST /api/v1/workspaces/{ws}/tasks/table/facets",
  });
}
