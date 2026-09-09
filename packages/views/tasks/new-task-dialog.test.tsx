import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { NewTaskDialog } from "./new-task-dialog";

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

describe("NewTaskDialog", () => {
  it("opens when controlled open=true without rendering a trigger button", () => {
    render(
      wrap(
        <NewTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />,
      ),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Việc mới" })).toBeNull();
  });

  it("gates agent trigger and squad assign stubs when capabilities are unavailable", () => {
    render(
      wrap(
        <NewTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />,
      ),
    );

    const agent = screen.getByTestId("create-agent-trigger");
    const squad = screen.getByTestId("create-squad-assign");
    expect(agent).toHaveAttribute("aria-disabled", "true");
    expect(squad).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(agent);
    fireEvent.click(squad);
    expect(agent).toHaveAttribute("aria-disabled", "true");
    expect(squad).toHaveAttribute("aria-disabled", "true");
  });
});
