import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Task } from "@uniwork/core/types";
import { wrap } from "../../test/api-mock";
import { ListView } from "./list-view";

initI18n();

const publicConfigState = vi.hoisted(() => ({
  data: {
    flags: {} as Record<string, boolean>,
    rum_sample_rate: 0,
    work_management_capabilities: {} as Record<
      string,
      {
        status: "available" | "unavailable";
        reason_code: string;
        explanation_key: string;
      }
    >,
  },
}));

vi.mock("@uniwork/core/feature-flags", () => ({
  usePublicConfig: () => ({ data: publicConfigState.data }),
}));

const sample: Task = {
  id: "t1",
  organization_id: "",
  workspace_id: "w1",
  number: 1,
  identifier: "T-1",
  revision: 1,
  title: "Suite row",
  description: "",
  status: "todo",
  priority: "medium",
  assignee_kind: "human",
  position: 1,
  kind: "normal",
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
};

beforeEach(() => {
  publicConfigState.data = {
    flags: {},
    rum_sample_rate: 0,
    work_management_capabilities: {
      "tasks.agent_runs": {
        status: "unavailable",
        reason_code: "agent_runtime_missing",
        explanation_key: "capabilities.agent_runtime_missing",
      },
      "tasks.squads": {
        status: "unavailable",
        reason_code: "squad_directory_missing",
        explanation_key: "capabilities.squad_directory_missing",
      },
    },
  };
});

describe("modes/ListView", () => {
  it("renders task titles from props without fetching", async () => {
    render(wrap(<ListView tasks={[sample]} />));
    expect(await screen.findByText("Suite row")).toBeInTheDocument();
  });

  it("gates agent trigger and squad assign when capabilities are unavailable", () => {
    render(wrap(<ListView tasks={[sample]} />));

    const agent = screen.getByTestId("list-agent-trigger");
    const squad = screen.getByTestId("list-squad-assign");
    expect(agent).toHaveAttribute("aria-disabled", "true");
    expect(squad).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(agent);
    fireEvent.click(squad);
    expect(agent).toHaveAttribute("aria-disabled", "true");
    expect(squad).toHaveAttribute("aria-disabled", "true");
  });
});
