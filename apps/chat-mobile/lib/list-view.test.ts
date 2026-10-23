// TestFlight build 4: the workspace picker said "Bạn chưa ở workspace nào" for a query that was paused offline and
// never sent. Only an answer with no rows is "none"; a query not answered yet is loading, or waiting for the network.
import { describe, expect, it } from "vitest";
import { listView } from "./list-view";

describe("listView", () => {
  it("is empty only once the server answered with no rows", () => {
    expect(listView({ status: "success", fetchStatus: "idle", data: [] })).toBe("empty");
    expect(listView({ status: "success", fetchStatus: "fetching", data: [] })).toBe("empty");
  });

  it("waits for the network while a query with nothing yet is paused, and loads otherwise", () => {
    expect(listView({ status: "pending", fetchStatus: "paused", data: undefined })).toBe("waiting");
    expect(listView({ status: "pending", fetchStatus: "fetching", data: undefined })).toBe("loading");
    expect(listView({ status: "pending", fetchStatus: "idle", data: undefined })).toBe("loading");
  });

  it("says a failure when there are no rows to show, and keeps rows it already has", () => {
    expect(listView({ status: "error", fetchStatus: "idle", data: undefined })).toBe("error");
    expect(listView({ status: "error", fetchStatus: "idle", data: [] })).toBe("error");
    expect(listView({ status: "error", fetchStatus: "idle", data: [{ id: "w1" }] })).toBe("list");
    expect(listView({ status: "success", fetchStatus: "paused", data: [{ id: "w1" }] })).toBe("list");
  });
});
