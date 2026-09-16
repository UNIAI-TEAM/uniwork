// Fake cursor table API behind the mocked transport: `/tasks/table/rows` pages
// one branch (`group_key` + `parent_id`) with `limit` and `cursor`, and
// `/tasks/table/groups` answers `groups(group_by)`. The cursor
// is base64 of the offset string — for this fake only; the real server's cursor
// is opaque and the client never reads it.
import type { TableGroupDescriptor } from "@uniwork/core/api/endpoints/tasks-table";
import { ApiError } from "@uniwork/core/api/http";
import { FAILED_ATTEMPT_REQUESTS, boardTask } from "./board-table-server";
import { requestMock } from "./request-mock";

type Params = Record<string, unknown>;

interface TableCursorServerOptions {
  /** Rows in one branch; `parentId` is null for top-level rows. `search` is the query's search. */
  count: (groupKey: string | null, parentId: string | null, search?: string) => number;
  /** What pages claim as the branch total, when it differs from the rows served. */
  claimed?: (groupKey: string | null, parentId: string | null) => number;
  /**
   * `group@offset` pages whose first attempt fails with a 503: the request and
   * the table queries' one automatic retry; the next request succeeds.
   */
  failOnce?: string[];
  /** `group@offset` pages whose first request answers 409 `cursor_query_mismatch`. */
  mismatchOnce?: string[];
  /** `direct_child_count` of the row at `index` in a branch; 0 by default. */
  childCount?: (groupKey: string | null, parentId: string | null, index: number) => number;
  /** Groups for a `group_by`; an `Error` returned is thrown instead. */
  groups?: (groupBy: string) => TableGroupDescriptor[] | Error;
  /** Requests (rows or groups body) held until `release()`. */
  hold?: (body: Params) => boolean;
}

/** `boundary` > 0 marks a cursor minted after `moveBoundary()`: same offset, different keyset value. */
export const encodeCursor = (offset: number, boundary = 0) =>
  btoa(boundary > 0 ? `${offset}~${boundary}` : String(offset));
const decodeCursor = (cursor: unknown) =>
  typeof cursor === "string" ? Number(atob(cursor).split("~")[0]) : 0;

export function serveTableCursor(options: TableCursorServerOptions) {
  const rowBodies: Params[] = [];
  const groupBodies: Params[] = [];
  const failed = new Set<string>();
  const requestsPerPage = new Map<string, number>();
  // Bumped by `change()`: every row's title then differs, as after an edit.
  let version = 0;
  // Bumped by `moveBoundary()`: every cursor then differs, as when the first page's last row moved.
  let boundary = 0;
  let release = () => {};
  let held = new Promise<void>((resolve) => {
    release = resolve;
  });

  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string, init?: { body?: unknown }) => {
    if (path.includes("/tasks/table/groups") && options.groups) {
      const body: Params = { ...(init?.body as Params | undefined) };
      groupBodies.push(body);
      if (options.hold?.(body)) await held;
      const groups = options.groups(String(body.group_by));
      if (groups instanceof Error) throw groups;
      return {
        query_fingerprint: "fp-groups",
        total: groups.reduce((sum, group) => sum + group.count, 0),
        groups,
        next_cursor: null,
      };
    }
    if (!path.includes("/tasks/table/rows")) {
      return { tasks: [], total: 0, limit: 50, offset: 0 };
    }
    const body: Params = { ...(init?.body as Params | undefined) };
    rowBodies.push(body);
    if (options.hold?.(body)) await held;
    const groupKey = typeof body.group_key === "string" ? body.group_key : null;
    const parentId = typeof body.parent_id === "string" ? body.parent_id : null;
    const offset = decodeCursor(body.cursor);
    const limit = Number(body.limit ?? 50);
    const page = `${String(groupKey)}@${offset}`;
    const nth = (requestsPerPage.get(page) ?? 0) + 1;
    requestsPerPage.set(page, nth);
    if (options.failOnce?.includes(page) && nth <= FAILED_ATTEMPT_REQUESTS) {
      throw new ApiError("page failed", "internal", 503);
    }
    if (options.mismatchOnce?.includes(page) && !failed.has(`409:${page}`)) {
      failed.add(`409:${page}`);
      throw new ApiError("cursor does not match the query", "cursor_query_mismatch", 409);
    }
    const total = options.count(groupKey, parentId, (body.query as { search?: string } | undefined)?.search);
    const end = Math.min(total, offset + limit);
    const rows = Array.from({ length: Math.max(0, end - offset) }, (_, k) => {
      const index = offset + k;
      const prefix = `${String(groupKey)}${parentId ? `/${parentId}` : ""}`;
      return {
        task: boardTask("todo", index, {
          id: `${prefix}-${index}`,
          title: `${prefix} ${index} v${version}`,
          parent_id: parentId ?? undefined,
        }),
        direct_child_count: options.childCount?.(groupKey, parentId, index) ?? 0,
        labels: [],
      };
    });
    return {
      query_fingerprint: "fp-rows",
      group_key: groupKey,
      parent_id: parentId,
      total: options.claimed?.(groupKey, parentId) ?? total,
      rows,
      next_cursor: end < total ? encodeCursor(end, boundary) : null,
    };
  });

  return {
    rowBodies,
    groupBodies,
    /** Every rows request as `group_key@cursor`, `null` for the first page. */
    rowRequests: () => rowBodies.map((body) => `${String(body.group_key)}@${String(body.cursor)}`),
    /** Lets every held request answer; requests after it are held again. */
    release: () => {
      const releaseHeld = release;
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      releaseHeld();
    },
    change: () => {
      version += 1;
    },
    moveBoundary: () => {
      boundary += 1;
    },
  };
}
