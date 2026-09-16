// Fake cursor table API behind the mocked transport: `/tasks/table/rows` pages
// one branch (`group_key` + `parent_id`) with `limit` and `cursor`. The cursor
// is base64 of the offset string — for this fake only; the real server's cursor
// is opaque and the client never reads it.
import { ApiError } from "@uniwork/core/api/http";
import { boardTask } from "./board-table-server";
import { requestMock } from "./request-mock";

type Params = Record<string, unknown>;

interface TableCursorServerOptions {
  /** Rows in one branch; `parentId` is null for top-level rows. */
  count: (groupKey: string | null, parentId: string | null) => number;
  /** `group@offset` pages whose first request fails. */
  failOnce?: string[];
  /** `group@offset` pages whose first request answers 409 `cursor_query_mismatch`. */
  mismatchOnce?: string[];
}

export const encodeCursor = (offset: number) => btoa(String(offset));
const decodeCursor = (cursor: unknown) => (typeof cursor === "string" ? Number(atob(cursor)) : 0);

export function serveTableCursor(options: TableCursorServerOptions) {
  const rowBodies: Params[] = [];
  const failed = new Set<string>();
  // Bumped by `change()`: every row's title then differs, as after an edit.
  let version = 0;

  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string, init?: { body?: unknown }) => {
    if (!path.includes("/tasks/table/rows")) {
      return { tasks: [], total: 0, limit: 50, offset: 0 };
    }
    const body: Params = { ...(init?.body as Params | undefined) };
    rowBodies.push(body);
    const groupKey = typeof body.group_key === "string" ? body.group_key : null;
    const parentId = typeof body.parent_id === "string" ? body.parent_id : null;
    const offset = decodeCursor(body.cursor);
    const limit = Number(body.limit ?? 50);
    const page = `${String(groupKey)}@${offset}`;
    if (options.failOnce?.includes(page) && !failed.has(`fail:${page}`)) {
      failed.add(`fail:${page}`);
      throw new Error("page failed");
    }
    if (options.mismatchOnce?.includes(page) && !failed.has(`409:${page}`)) {
      failed.add(`409:${page}`);
      throw new ApiError("cursor does not match the query", "cursor_query_mismatch", 409);
    }
    const total = options.count(groupKey, parentId);
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
        direct_child_count: 0,
        labels: [],
      };
    });
    return {
      query_fingerprint: "fp-rows",
      group_key: groupKey,
      parent_id: parentId,
      total,
      rows,
      next_cursor: end < total ? encodeCursor(end) : null,
    };
  });

  return {
    rowBodies,
    /** Every rows request as `group_key@cursor`, `null` for the first page. */
    rowRequests: () => rowBodies.map((body) => `${String(body.group_key)}@${String(body.cursor)}`),
    change: () => {
      version += 1;
    },
  };
}
