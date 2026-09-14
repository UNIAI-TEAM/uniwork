import {
  tableRows,
  type TableFilter,
  type TableGroupsBody,
  type TableRowsBody,
} from "../../api/endpoints/tasks-table";
import { taskKeys } from "../keys";

/*
 * Request bodies for the table API, built in one place because their field
 * order is part of the cache key: the groups hook and every rows page hash the
 * body with `JSON.stringify`. The table view and the board both build through
 * here, so equal parameters give byte-equal keys (one cache entry), and a
 * writer walking `taskKeys.tableRoot` sees one key shape.
 */

interface TableQueryParams {
  filter?: TableFilter;
  groupBy: string;
  /** Accepted by the server into its fingerprint only; rows carry whole tasks. */
  columns: string[];
  limit: number;
}

/** The first page of groups (`/tasks/table/groups`). */
export function tableGroupsBody({
  filter,
  groupBy,
  columns,
  limit,
}: TableQueryParams): TableGroupsBody {
  return { filter, group_by: groupBy, columns, limit, offset: 0 };
}

/** One page of one branch (`/tasks/table/rows`); a null `groupKey` is the ungrouped branch. */
export function tableRowsPageBody(
  params: TableQueryParams & { groupKey: string | null; offset: number },
): TableRowsBody {
  return {
    filter: params.filter,
    group_by: params.groupBy,
    group_key: params.groupKey,
    columns: params.columns,
    limit: params.limit,
    offset: params.offset,
  };
}

/** Key and fetcher for one rows page. The key hashes exactly the body that is sent. */
export function tableRowsPageQuery(workspaceId: string, body: TableRowsBody) {
  return {
    queryKey: taskKeys.tableRows(workspaceId, JSON.stringify(body)),
    queryFn: () => tableRows(workspaceId, body),
  };
}
