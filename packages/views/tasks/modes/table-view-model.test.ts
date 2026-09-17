import { describe, expect, it } from "vitest";
import { getTaskTableSelectionRange, groupLabelFromDescriptor } from "./table-view-model";

describe("table-view-model", () => {
  it("builds selection ranges between the anchor and the target", () => {
    expect(getTaskTableSelectionRange(["a", "b", "c"], "a", "c")).toEqual(["a", "b", "c"]);
    expect(getTaskTableSelectionRange(["a", "b", "c"], "c", "b")).toEqual(["b", "c"]);
  });

  it("returns null selection without anchor or unknown ids", () => {
    expect(getTaskTableSelectionRange(["a", "b"], null, "b")).toBeNull();
    expect(getTaskTableSelectionRange(["a", "b"], "missing", "b")).toBeNull();
    expect(getTaskTableSelectionRange(["a", "b"], "a", "missing")).toBeNull();
  });

  it("maps group descriptors to translated labels", () => {
    const labels = {
      translateStatus: (s: string) => `S:${s}`,
      translatePriority: (p: string) => `P:${p}`,
      unassigned: "Unassigned",
      noProject: "No project",
      noValue: "No value",
      checked: "Checked",
      unchecked: "Unchecked",
      resolveAssignee: (id: string) => (id === "u1" ? "Nguyen Ba Vinh" : undefined),
    };
    const label = (key: string, value: Parameters<typeof groupLabelFromDescriptor>[1]) =>
      groupLabelFromDescriptor(key, value, labels);

    expect(label("status:todo", { kind: "status", status: "todo" })).toBe("S:todo");
    expect(label("priority:high", { kind: "priority", priority: "high" })).toBe("P:high");
    expect(
      label("assignee:human:u1", {
        kind: "assignee",
        actor: { type: "human", id: "u1" },
        label: "Vinh (server)",
      }),
    ).toBe("Vinh (server)");
    expect(label("assignee:human:u1", { kind: "assignee", actor: { type: "human", id: "u1" } })).toBe(
      "Nguyen Ba Vinh",
    );
    expect(label("assignee:human:u9", { kind: "assignee", actor: { type: "human", id: "u9" } })).toBe(
      "u9",
    );
    expect(label("assignee:none", { kind: "assignee" })).toBe("Unassigned");
    expect(label("project:p1", { kind: "project", project_id: "p1", label: "Website" })).toBe(
      "Website",
    );
    expect(label("project:none", { kind: "project" })).toBe("No project");
    expect(
      label("property:x:v:YQ", { kind: "property", property_id: "x", option: "a", label: "Alpha" }),
    ).toBe("Alpha");
    expect(label("property:x:v:dHJ1ZQ", { kind: "property", property_id: "x", option: "true" })).toBe(
      "Checked",
    );
    expect(
      label("property:x:v:ZmFsc2U", { kind: "property", property_id: "x", option: "false" }),
    ).toBe("Unchecked");
    expect(label("property:x:none", { kind: "property", property_id: "x" })).toBe("No value");
    expect(label("raw-key", { kind: "other" })).toBe("raw-key");
  });
});
