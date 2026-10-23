import { beforeEach, describe, expect, it } from "vitest";
import { readLastWorkspace, rememberLastWorkspace } from "./last-workspace";

beforeEach(() => {
  localStorage.clear();
});

describe("last workspace", () => {
  it("is null before the user has entered any workspace", () => {
    expect(readLastWorkspace("u1")).toBeNull();
  });

  it("returns the workspace remembered last", () => {
    rememberLastWorkspace("u1", { orgSlug: "acme", wsSlug: "team" });
    rememberLastWorkspace("u1", { orgSlug: "acme", wsSlug: "ops" });
    expect(readLastWorkspace("u1")).toEqual({ orgSlug: "acme", wsSlug: "ops" });
  });

  it("is kept per user, so a shared browser does not hand one person's workspace to another", () => {
    rememberLastWorkspace("u1", { orgSlug: "acme", wsSlug: "team" });
    expect(readLastWorkspace("u2")).toBeNull();
  });

  it("reads a malformed entry as nothing remembered", () => {
    localStorage.setItem("uniwork_last_workspace:u1", "{not json");
    expect(readLastWorkspace("u1")).toBeNull();
    localStorage.setItem("uniwork_last_workspace:u1", JSON.stringify({ orgSlug: "acme" }));
    expect(readLastWorkspace("u1")).toBeNull();
  });
});
