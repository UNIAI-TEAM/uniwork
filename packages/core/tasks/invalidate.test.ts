import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { calendarKeys } from "../calendar/keys";
import { invalidateTaskCollections } from "./invalidate";
import { taskKeys } from "./keys";

describe("invalidateTaskCollections", () => {
  it("refreshes every collection a new task can land in, for that workspace only", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    await invalidateTaskCollections(qc, "ws1");

    const keys = spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining(
        [
          taskKeys.list("ws1"),
          taskKeys.queryRoot("ws1"),
          taskKeys.myTasks("ws1"),
          taskKeys.tableRoot("ws1"),
          calendarKeys.all("ws1"),
        ].map((k) => JSON.stringify(k)),
      ),
    );
    expect(keys.every((k) => k.includes('"ws1"'))).toBe(true);
  });
});
