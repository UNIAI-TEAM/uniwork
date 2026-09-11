import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { CapabilityDisabledControl } from "./capability-disabled-control";

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
    work_management_capabilities: {},
  };
});

describe("CapabilityDisabledControl", () => {
  it("marks the control aria-disabled with a translated reason when unavailable", () => {
    publicConfigState.data.work_management_capabilities = {
      "tasks.agent_runs": {
        status: "unavailable",
        reason_code: "agent_runtime_missing",
        explanation_key: "capabilities.agent_runtime_missing",
      },
    };

    render(
      <CapabilityDisabledControl
        capabilityKey="tasks.agent_runs"
        label="Run agent"
        testId="agent-run-stub"
      />,
    );

    const control = screen.getByTestId("agent-run-stub");
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute(
      "title",
      expect.stringMatching(/agent runtime|runtime agent/i),
    );
    expect(control).toHaveAttribute("aria-describedby", "agent-run-stub-reason");
    expect(screen.getByText(/agent runtime|runtime agent/i)).toHaveClass("sr-only");
  });

  it("leaves the control enabled when the capability is available", () => {
    publicConfigState.data.work_management_capabilities = {
      "tasks.agent_runs": {
        status: "available",
        reason_code: "",
        explanation_key: "",
      },
    };

    render(
      <CapabilityDisabledControl
        capabilityKey="tasks.agent_runs"
        label="Run agent"
        testId="agent-run-stub"
      />,
    );

    const control = screen.getByTestId("agent-run-stub");
    expect(control).not.toHaveAttribute("aria-disabled", "true");
    expect(control).not.toHaveAttribute("title");
    expect(control).not.toHaveAttribute("aria-describedby");
  });

  it("ignores clicks while unavailable", () => {
    publicConfigState.data.work_management_capabilities = {
      "tasks.vcs": {
        status: "unavailable",
        reason_code: "vcs_provider_missing",
        explanation_key: "capabilities.vcs_provider_missing",
      },
    };

    render(
      <CapabilityDisabledControl
        capabilityKey="tasks.vcs"
        label="Link PR"
        testId="pr-stub"
      />,
    );

    const control = screen.getByTestId("pr-stub");
    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-disabled", "true");
  });
});
