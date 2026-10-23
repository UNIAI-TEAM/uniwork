import { describe, expect, it } from "vitest";
import { z } from "zod";
import { issuePaths, SchemaMismatchError } from "./schema-mismatch";

describe("issuePaths", () => {
  it("keeps a zod issue's path and code only: its message and the received value may quote tenant data", () => {
    const result = z.object({ workspaces: z.array(z.object({ id: z.string() })) }).safeParse({ workspaces: [{ id: 7, name: "Phòng Bí Mật" }] });
    expect(result.success).toBe(false);
    const paths = issuePaths(result.error?.issues);
    expect(paths).toEqual([{ path: "workspaces.0.id", code: "invalid_type" }]);
    expect(JSON.stringify(paths)).not.toContain("Phòng");
  });

  it("reads anything else as no paths, and a malformed issue as what it can tell", () => {
    expect(issuePaths(undefined)).toEqual([]);
    expect(issuePaths("x")).toEqual([]);
    expect(issuePaths([null, { path: "nope" }, { path: [], code: 3 }])).toEqual([
      { path: "", code: "unknown" },
      { path: "", code: "unknown" },
      { path: "", code: "unknown" },
    ]);
    expect(issuePaths([{ path: ["a", Symbol("s"), 2], code: "custom" }])).toEqual([{ path: "a.?.2", code: "custom" }]);
  });
});

describe("SchemaMismatchError", () => {
  it("names the endpoint and the paths, never a value", () => {
    const error = new SchemaMismatchError("GET /api/v1/workspaces", [{ path: "workspaces", code: "invalid_type" }]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SchemaMismatchError");
    expect(error.message).toBe("API response failed schema validation: GET /api/v1/workspaces (workspaces invalid_type)");
    expect(error.endpoint).toBe("GET /api/v1/workspaces");
    expect(new SchemaMismatchError("GET /x", []).message).toBe("API response failed schema validation: GET /x");
  });
});
