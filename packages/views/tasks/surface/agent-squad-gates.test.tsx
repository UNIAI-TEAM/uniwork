import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import {
  AgentTriggerStub,
  SquadAssignStub,
} from "./agent-squad-gates";

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

beforeAll(() => {
  initI18n();
});

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

describe("AgentTriggerStub / SquadAssignStub", () => {
  it("disables agent trigger when tasks.agent_runs is unavailable", () => {
    render(<AgentTriggerStub testId="surface-agent-trigger" />);

    const control = screen.getByTestId("surface-agent-trigger");
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute(
      "title",
      expect.stringMatching(/agent runtime|runtime agent|chưa khả dụng/i),
    );
    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-disabled", "true");
  });

  it("disables squad assign when tasks.squads is unavailable", () => {
    render(<SquadAssignStub testId="surface-squad-assign" />);

    const control = screen.getByTestId("surface-squad-assign");
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute(
      "title",
      expect.stringMatching(/squad|danh mục squad|chưa khả dụng/i),
    );
    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-disabled", "true");
  });
});
