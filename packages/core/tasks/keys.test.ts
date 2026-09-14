import { describe, expect, it } from "vitest";
import { taskKeys } from "./keys";

function isPrefix(root: readonly unknown[], live: readonly unknown[]): boolean {
  return root.length <= live.length && root.every((seg, i) => seg === live[i]);
}

describe("taskKeys invalidate prefixes", () => {
  it("views / viewPrefs invalidate roots are prefixes of live query keys", () => {
    const wsId = "ws1";
    const scopeHash = "workspace:";
    expect(isPrefix(taskKeys.views(wsId), taskKeys.viewsScoped(wsId, scopeHash))).toBe(true);
    expect(isPrefix(taskKeys.viewPrefs(wsId), taskKeys.viewPrefsScoped(wsId, scopeHash))).toBe(
      true,
    );
    // Empty third segment is NOT a prefix of a real scope hash (the old bug).
    expect(isPrefix(["task-views", wsId, ""] as const, taskKeys.viewsScoped(wsId, scopeHash))).toBe(
      false,
    );
  });

  it("my-tasks / grouped / query / table roots prefix filtered live keys", () => {
    const wsId = "ws1";
    const hash = '{"limit":20}';
    expect(isPrefix(taskKeys.myTasks(wsId), taskKeys.myTasksFiltered(wsId, hash))).toBe(true);
    expect(isPrefix(taskKeys.groupedRoot(wsId), taskKeys.grouped(wsId, hash))).toBe(true);
    expect(isPrefix(taskKeys.queryRoot(wsId), taskKeys.query(wsId, hash))).toBe(true);
    expect(isPrefix(taskKeys.tableRoot(wsId), taskKeys.tableGroups(wsId, hash))).toBe(true);
  });

  it("infinite query / my-tasks keys sit under the 2-segment roots but never collide with the plain keys", () => {
    const wsId = "ws1";
    const hash = '{"project_id":"p1"}';
    // Under the roots: every existing prefix invalidate (mutations, realtime) still reaches them.
    expect(isPrefix(taskKeys.queryRoot(wsId), taskKeys.queryInfinite(wsId, hash))).toBe(true);
    expect(isPrefix(taskKeys.myTasks(wsId), taskKeys.myTasksInfinite(wsId, hash))).toBe(true);
    // Not the plain key for the same hash: TanStack would store `{ pages, pageParams }` and a
    // single `TaskQueryPage` in one cache entry, and both hooks would read the wrong shape.
    expect(taskKeys.queryInfinite(wsId, hash)).not.toEqual(taskKeys.query(wsId, hash));
    expect(taskKeys.myTasksInfinite(wsId, hash)).not.toEqual(taskKeys.myTasksFiltered(wsId, hash));
    expect(isPrefix(taskKeys.query(wsId, hash), taskKeys.queryInfinite(wsId, hash))).toBe(false);
    expect(isPrefix(taskKeys.myTasksFiltered(wsId, hash), taskKeys.myTasksInfinite(wsId, hash))).toBe(
      false,
    );
  });
});
