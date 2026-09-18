import { describe, expect, it } from "vitest";
import type { Agent } from "@uniwork/core/types";
import { toWorkspaceAssigneeOptions } from "./member-options";

describe("toWorkspaceAssigneeOptions", () => {
  it("keeps workspace members before assignable agents", () => {
    const agents: Agent[] = [
      {
        id: "agent-1",
        organization_id: "org-1",
        name: "Agent 17",
        handle: "agent-17",
        description: "",
        status: "active",
        owner_user_id: "user-1",
      },
    ];

    expect(
      toWorkspaceAssigneeOptions(
        [{ id: "member-1", name: "Nguyễn An" }],
        agents,
      ),
    ).toEqual([
      {
        id: "member-1",
        kind: "human",
        name: "Nguyễn An",
        avatarUrl: undefined,
      },
      {
        id: "agent-1",
        kind: "agent",
        name: "Agent 17",
        avatarUrl: undefined,
      },
    ]);
  });
});
