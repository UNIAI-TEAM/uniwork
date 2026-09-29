import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { requestMock } from "../../test/request-mock";
import type { AssigneeOption } from "./assignee-picker";
import {
  markUnassignableAgents,
  rankByFrequency,
  withAssigneeStatus,
} from "./assignee-option-decorations";
import { useWorkspaceAssigneeOptions } from "./member-options";

const options: AssigneeOption[] = [
  { id: "u1", kind: "human", name: "An" },
  { id: "u2", kind: "human", name: "Bình" },
  { id: "u3", kind: "human", name: "Chi" },
  { id: "a1", kind: "agent", name: "Agent 1" },
  { id: "a2", kind: "agent", name: "Agent 2" },
];

const ids = (list: AssigneeOption[]) => list.map((option) => option.id);

describe("rankByFrequency", () => {
  it("puts the assignees the caller picks most often first", () => {
    const ranked = rankByFrequency(options, [
      { assignee_kind: "human", assignee_id: "u3", frequency: 5 },
      { assignee_kind: "human", assignee_id: "u2", frequency: 2 },
      { assignee_kind: "agent", assignee_id: "a2", frequency: 1 },
    ]);

    expect(ids(ranked)).toEqual(["u3", "u2", "u1", "a2", "a1"]);
  });

  it("keeps the original order on ties, including never-picked assignees", () => {
    const ranked = rankByFrequency(options, [
      { assignee_kind: "human", assignee_id: "u2", frequency: 3 },
      { assignee_kind: "human", assignee_id: "u3", frequency: 3 },
    ]);

    expect(ids(ranked)).toEqual(["u2", "u3", "u1", "a1", "a2"]);
  });

  it("matches on kind as well as id", () => {
    const ranked = rankByFrequency(options, [
      { assignee_kind: "agent", assignee_id: "u3", frequency: 9 },
    ]);

    expect(ids(ranked)).toEqual(ids(options));
  });

  it("returns the same list when there is no frequency", () => {
    expect(rankByFrequency(options, [])).toBe(options);
    expect(rankByFrequency(options, undefined)).toBe(options);
  });
});

describe("markUnassignableAgents", () => {
  const reason = (code: string) => `reason:${code}`;

  it("gives paused and archived agents a reason and leaves the rest alone", () => {
    const marked = markUnassignableAgents(
      options,
      [
        { id: "a1", status: "paused" },
        { id: "a2", status: "archived" },
      ],
      reason,
    );

    expect(marked.map((option) => option.disabledReason)).toEqual([
      undefined,
      undefined,
      undefined,
      "reason:agent_paused",
      "reason:agent_archived",
    ]);
  });

  it("does not touch a member that shares an agent's id", () => {
    const marked = markUnassignableAgents(options, [{ id: "u1", status: "paused" }], reason);
    expect(marked).toBe(options);
  });
});

describe("withAssigneeStatus", () => {
  const labels = {
    online: "online",
    agent_active: "active",
    agent_paused: "paused",
    agent_archived: "archived",
  };

  it("dots online members and every agent by its status", () => {
    const withStatus = withAssigneeStatus(
      [...options, { id: "a3", kind: "agent", name: "Agent 3" }],
      {
        isOnline: (id) => id === "u2",
        agents: [
          { id: "a1", status: "active" },
          { id: "a2", status: "paused" },
          { id: "a3", status: "archived" },
        ],
        labels,
      },
    );

    expect(withStatus.map((option) => option.status)).toEqual([
      undefined,
      { tone: "success", label: "online" },
      undefined,
      { tone: "success", label: "active" },
      { tone: "warning", label: "paused" },
      { tone: "muted", label: "archived" },
    ]);
  });

  it("leaves an agent it knows nothing about without a dot", () => {
    const withStatus = withAssigneeStatus(options, { isOnline: () => false, agents: [], labels });
    expect(withStatus.every((option) => option.status === undefined)).toBe(true);
  });
});

describe("useWorkspaceAssigneeOptions ranking", () => {
  const member = (id: string, name: string) => ({
    workspace_id: "w1",
    user_id: id,
    role: "member",
    email: `${id}@x.vn`,
    display_name: name,
  });

  function serve(frequency: unknown, agents: unknown[] = []) {
    requestMock.mockImplementation((path: string) => {
      if (path.endsWith("/members")) {
        return Promise.resolve({ members: [member("u1", "An"), member("u2", "Bình")] });
      }
      if (path.endsWith("/agents")) return Promise.resolve({ agents });
      if (path.endsWith("/assignee-frequency")) return Promise.resolve(frequency);
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  }

  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return createElement(QueryClientProvider, { client }, children);
  }

  beforeEach(() => {
    requestMock.mockReset();
  });

  it("lists the members the caller assigns most often first", async () => {
    serve({ items: [{ assignee_kind: "human", assignee_id: "u2", frequency: 4 }] });
    const { result } = renderHook(() => useWorkspaceAssigneeOptions("w1"), { wrapper });

    await waitFor(() => expect(ids(result.current.options)).toEqual(["u2", "u1"]));
  });

  it("keeps the member order when the frequency response is malformed", async () => {
    serve({ items: "nope" });
    const { result } = renderHook(() => useWorkspaceAssigneeOptions("w1"), { wrapper });

    await waitFor(() => expect(ids(result.current.options)).toEqual(["u1", "u2"]));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/w1/assignee-frequency"),
    );
    expect(ids(result.current.options)).toEqual(["u1", "u2"]);
  });

  it("marks a paused agent as unable to take new work", async () => {
    const agent = { id: "a1", organization_id: "o1", name: "QA", handle: "qa", status: "paused", owner_user_id: "u1" };
    serve({ items: [] }, [agent]);
    const { result } = renderHook(() => useWorkspaceAssigneeOptions("w1"), { wrapper });

    await waitFor(() =>
      expect(result.current.options.find((option) => option.id === "a1")?.disabledReason).toBeTruthy(),
    );
  });
});
