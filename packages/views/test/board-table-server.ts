// Fake table API behind the mocked transport, for board tests: groups and rows
// per status column, paged by group_key and offset as the real server pages them.
import { requestMock } from "./request-mock";

type Params = Record<string, unknown>;

export function boardTask(status: string, index: number, over: Params = {}): Params {
  return {
    id: `${status}-${index}`,
    workspace_id: "w1",
    title: `${status} ${index}`,
    description: "",
    status,
    priority: "medium",
    position: index,
    created_by: "u1",
    created_at: "2026-09-06T00:00:00Z",
    updated_at: "2026-09-06T00:00:00Z",
    ...over,
  };
}

interface BoardTableServerOptions {
  /** Tasks per status behind the table API; a status at 0 is absent from groups, as on the server. */
  counts: Record<string, number>;
  /** What groups and rows pages claim as a status total, when it differs from the rows served. */
  claimed?: Record<string, number>;
  /** Rows pages after the first start this many rows early, repeating ids across the boundary. */
  overlap?: number;
  /** `status@offset` pages whose first request fails. */
  failOnce?: string[];
  /** The first groups request fails. */
  failGroupsOnce?: boolean;
  /** `status@offset` page held until `release()`. */
  hold?: string;
  /** Hold only this request of the `hold` page, counting from 1; by default every one waits. */
  holdNth?: number;
  /** Tasks behind `/my-tasks`, spread over backlog / todo / in_progress. */
  myTasks?: number;
  row?: (status: string, index: number) => Params;
}

export function serveBoardTable(options: BoardTableServerOptions) {
  const rowBodies: Params[] = [];
  const groupBodies: Params[] = [];
  const paths: string[] = [];
  const failed = new Set<string>();
  const requestsPerPage = new Map<string, number>();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const row = options.row ?? ((status: string, index: number) => boardTask(status, index));
  const statuses = Object.keys(options.counts);
  const served = (status: string) => options.counts[status] ?? 0;
  const claimed = (status: string) => options.claimed?.[status] ?? served(status);
  const claimedTotal = () => statuses.reduce((sum, status) => sum + claimed(status), 0);

  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string, init?: { body?: unknown }) => {
    paths.push(path);
    const body: Params = { ...(init?.body as Params | undefined) };
    if (path.includes("/tasks/table/groups")) {
      groupBodies.push(body);
      if (options.failGroupsOnce && !failed.has("groups")) {
        failed.add("groups");
        throw new Error("groups failed");
      }
      return {
        query_fingerprint: "fp-groups",
        total: claimedTotal(),
        groups: statuses
          .filter((status) => served(status) > 0)
          .map((status) => ({
            key: status,
            value: { kind: "status", status },
            count: claimed(status),
          })),
        next_cursor: null,
      };
    }
    if (path.includes("/tasks/table/rows")) {
      rowBodies.push(body);
      const groupKey = typeof body.group_key === "string" ? body.group_key : null;
      const offset = Number(body.offset ?? 0);
      const limit = Number(body.limit ?? 50);
      const page = `${String(groupKey)}@${offset}`;
      const nth = (requestsPerPage.get(page) ?? 0) + 1;
      requestsPerPage.set(page, nth);
      if (options.hold === page && (options.holdNth === undefined || options.holdNth === nth)) {
        await held;
      }
      if (options.failOnce?.includes(page) && !failed.has(page)) {
        failed.add(page);
        throw new Error("page failed");
      }
      // Without a group key the server pages every status as one branch.
      const branchStatuses = groupKey === null ? statuses : [groupKey];
      const branch = branchStatuses.flatMap((status) =>
        Array.from({ length: served(status) }, (_, index) => row(status, index)),
      );
      const start = offset > 0 ? Math.max(0, offset - (options.overlap ?? 0)) : 0;
      const pageRows = branch.slice(start, start + limit);
      return {
        query_fingerprint: "fp-rows",
        group_key: groupKey,
        parent_id: null,
        total: groupKey === null ? claimedTotal() : claimed(groupKey),
        rows: pageRows.map((task) => ({ task, direct_child_count: 0 })),
        branch_total: pageRows.length,
        next_cursor: null,
      };
    }
    if (path.includes("/my-tasks")) {
      const params = Object.fromEntries(new URL(path, "http://test").searchParams);
      const offset = Number(params.offset ?? 0);
      const limit = Number(params.limit ?? 50);
      const total = options.myTasks ?? 0;
      const count = Math.max(0, Math.min(limit, total - offset));
      const spread = ["backlog", "todo", "in_progress"];
      return {
        tasks: Array.from({ length: count }, (_, k) =>
          row(spread[(offset + k) % spread.length]!, offset + k),
        ),
        total,
        limit,
        offset,
      };
    }
    return { tasks: [], total: 0, limit: 50, offset: 0 };
  });

  return {
    /** Every rows request as `group_key@offset`, in order. */
    rowRequests: () =>
      rowBodies.map((body) => `${String(body.group_key)}@${String(body.offset)}`),
    rowBodies,
    groupBodies,
    paths,
    release: () => release(),
  };
}
