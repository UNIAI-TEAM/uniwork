import { describe, expect, it } from "vitest";
import { routePattern } from "./route-pattern";

describe("routePattern", () => {
  it("hides tenant slugs and ids", () => {
    expect(routePattern("/acme/team/tasks/01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("/[orgSlug]/[workspaceSlug]/tasks/:id");
    expect(routePattern("/acme/team")).toBe("/[orgSlug]/[workspaceSlug]");
    expect(routePattern("/acme/team/chat")).toBe("/[orgSlug]/[workspaceSlug]/chat");
  });
  it("keeps global routes, ids replaced", () => {
    expect(routePattern("/login")).toBe("/login");
    expect(routePattern("/admin/organizations/01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("/admin/organizations/:id");
    expect(routePattern("/")).toBe("/");
    expect(routePattern("/workspaces")).toBe("/workspaces");
  });
});
