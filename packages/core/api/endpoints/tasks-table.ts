import { z } from "zod";
import { TaskSchema, type Task } from "../../types/task";
import { request } from "../http";
import { parseWithFallback } from "../schema";

export interface TableFilter {
  statuses?: string[];
  priorities?: string[];
  assignee_ids?: string[];
  project_ids?: string[];
  include_no_assignee?: boolean;
  include_no_project?: boolean;
  /** `"human:<id>"` | `"agent:<id>"` */
  creator_refs?: string[];
  label_ids?: string[];
  properties?: Record<string, string[]>;
  date_field?: "created_at" | "updated_at";
  /** YYYY-MM-DD */
  date_from?: string;
  /** YYYY-MM-DD */
  date_to?: string;
}

export interface TableSort {
  field: string;
  direction: "asc" | "desc";
}

export interface TableQuery {
  filter?: TableFilter;
  search?: string;
  sort?: TableSort;
}

export interface TableGroupsBody {
  query: TableQuery;
  group_by: string;
}

export interface TableRowsBody {
  query: TableQuery;
  group_by: string;
  group_key: string | null;
  hierarchy: boolean;
  parent_id: string | null;
  cursor: string | null;
  limit: number;
}

export interface TableFacetsBody {
  query: TableQuery;
  facets: string[];
}

export type TableGroupValue = {
  kind: string;
  status?: string;
  priority?: string;
  actor?: { type: string; id: string };
  project_id?: string;
  property_id?: string;
  option?: string;
  label?: string;
};

export type TableRowLabel = { id: string; name: string; color: string };

export interface TableGroupDescriptor {
  key: string;
  value: TableGroupValue;
  count: number;
}

export interface TableGroupsResult {
  query_fingerprint: string;
  total: number;
  groups: TableGroupDescriptor[];
  next_cursor: string | null;
}

export type TableRowsResult = {
  query_fingerprint: string;
  group_key: string | null;
  parent_id: string | null;
  total: number;
  rows: Array<{ task: Task; direct_child_count: number; labels: TableRowLabel[] }>;
  next_cursor: string | null;
};

export interface TableFacetValue {
  key: string;
  count: number;
}

export interface TableFacet {
  kind: string;
  values: TableFacetValue[];
}

export interface TableFacetsResult {
  query_fingerprint: string;
  total: number;
  facets: TableFacet[];
}

const TableActorRefSchema = z.object({
  type: z.string(),
  id: z.string(),
});

const TableGroupValueSchema = z.object({
  kind: z.string(),
  status: z.string().optional(),
  priority: z.string().optional(),
  actor: TableActorRefSchema.optional(),
  project_id: z.string().optional(),
  property_id: z.string().optional(),
  option: z.string().optional(),
  label: z.string().optional(),
});

/** A `string | null` field the server may omit; missing degrades to `null`, never to a parse failure. */
const nullableString = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const TableGroupDescriptorSchema = z.object({
  key: z.string(),
  value: TableGroupValueSchema,
  count: z.number(),
});

const TableGroupsSchema = z.object({
  query_fingerprint: z.string(),
  total: z.number(),
  groups: z.array(TableGroupDescriptorSchema),
  next_cursor: nullableString,
});

const TableRowLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

const TableRowSchema = z.object({
  task: TaskSchema,
  direct_child_count: z.number(),
  // An old server (or a drifted one) may omit labels entirely; the row still parses.
  labels: z.array(TableRowLabelSchema).catch([]),
});

const TableRowsSchema = z.object({
  query_fingerprint: z.string(),
  group_key: nullableString,
  parent_id: nullableString,
  total: z.number(),
  rows: z.array(TableRowSchema),
  next_cursor: nullableString,
});

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
