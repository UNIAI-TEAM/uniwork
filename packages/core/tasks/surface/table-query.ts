import {
  tableRows,
  type TableFilter,
  type TableGroupsBody,
  type TableQuery,
  type TableRowsBody,
} from "../../api/endpoints/tasks-table";
import { taskKeys } from "../keys";

/*
 * Request bodies for the cursor table API, built in one place because their
 * field order is part of the cache key: `tableRowsPageQuery` hashes the body
 * (minus `cursor`) with `JSON.stringify`. The board and the table view both
 * build through here, so equal parameters give byte-equal keys (one branch,
 * shared across pages), and a writer walking `taskKeys.tableRoot` sees one
 * key shape.
 */

export interface TableQueryParams {
  query: TableQuery;
  groupBy: string;
  hierarchy: boolean;
}

/**
 * A query in the canonical shape the cache key hashes: empty filter arrays
 * dropped, `search` trimmed (and omitted when that leaves nothing), and
 * `sort` omitted when it names the server's own default (`position` /
 * `asc`). Two callers that ask for "the same" query — built by hand, from a
 * view's stored filters, in whatever field order — normalize to the same
 * object, so `JSON.stringify` gives the same string and the same cache key.
 * Field order below is fixed (`filter`, `search`, `sort`) regardless of the
 * input's order.
 */
export function normalizeTableQuery(q: TableQuery): TableQuery {
  const out: TableQuery = {};

  const filter = q.filter;
  if (filter) {
    const nextFilter: TableFilter = {};
    if (filter.statuses && filter.statuses.length > 0) nextFilter.statuses = filter.statuses;
    if (filter.priorities && filter.priorities.length > 0) nextFilter.priorities = filter.priorities;
    if (filter.assignee_ids && filter.assignee_ids.length > 0) nextFilter.assignee_ids = filter.assignee_ids;
    if (filter.project_ids && filter.project_ids.length > 0) nextFilter.project_ids = filter.project_ids;
    if (Object.keys(nextFilter).length > 0) out.filter = nextFilter;
  }

  const search = q.search?.trim();
  if (search) out.search = search;

  if (q.sort && !(q.sort.field === "position" && q.sort.direction === "asc")) {
    out.sort = { field: q.sort.field, direction: q.sort.direction };
  }

  return out;
}

/** The groups request (`/tasks/table/groups`); groups are never paginated. */
export function tableGroupsBody(p: { query: TableQuery; groupBy: string }): TableGroupsBody {
  return { query: normalizeTableQuery(p.query), group_by: p.groupBy };
}

/** One page of one branch (`/tasks/table/rows`); a null `groupKey` is the ungrouped branch. */
export function tableRowsPageBody(
  p: TableQueryParams & {
    groupKey: string | null;
    parentId: string | null;
    cursor: string | null;
    limit: number;
  },
): TableRowsBody {
  return {
    query: normalizeTableQuery(p.query),
    group_by: p.groupBy,
    group_key: p.groupKey,
    hierarchy: p.hierarchy,
    parent_id: p.parentId,
    cursor: p.cursor,
    limit: p.limit,
  };
}

/** The body a rows page hashes under: the whole request minus `cursor`. */
function branchBodyHash(body: TableRowsBody): string {
  const { cursor: _cursor, ...rest } = body;
  return JSON.stringify(rest);
}

/** Key and fetcher for one rows page. The key hashes exactly the body that is sent. */
export function tableRowsPageQuery(workspaceId: string, body: TableRowsBody) {
  return {
    queryKey: taskKeys.tableRows(workspaceId, branchBodyHash(body), body.cursor ?? ""),
    queryFn: () => tableRows(workspaceId, body),
  };
}

/**
 * The key prefix shared by every page of one branch (same body, any
 * `cursor`) — a 4-segment key, one segment shorter than a page's own key, so
 * `getQueriesData`/`invalidateQueries` with this as `queryKey` prefix-matches
 * every loaded page of the branch and no other branch's pages.
 */
export function tableRowsBranchPrefix(workspaceId: string, body: TableRowsBody): readonly unknown[] {
  return taskKeys.tableRows(workspaceId, branchBodyHash(body));
}
