import { describe, expect, it } from "vitest";
import { myRelationFromVariant, taskScopeKey } from "./scope";

describe("taskScopeKey", () => {
  it("keys workspace and my scopes", () => {
    expect(taskScopeKey({ type: "workspace", actorKind: "all" })).toBe("workspace:all");
    expect(taskScopeKey({ type: "my", userId: "u1", relation: "assigned" })).toBe(
      "my:u1:assigned",
    );
  });
});

describe("myRelationFromVariant", () => {
  it("maps known variants and defaults to all", () => {
    expect(myRelationFromVariant("created")).toBe("created");
    expect(myRelationFromVariant("nope")).toBe("all");
  });
});
