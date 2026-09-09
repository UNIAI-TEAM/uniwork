import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { TaskDetailFlagGate } from "./task-detail-flag-gate";

function renderGate(parity: boolean) {
  const service = new FeatureFlagService(
    new StaticProvider({ tasks_work_management_parity: { default: parity } }),
  );
  render(
    <FeatureFlagsProvider service={service}>
      <TaskDetailFlagGate
        mvp={<div data-testid="task-detail-mvp">MVP</div>}
        suite={<div data-testid="task-detail-suite">Suite</div>}
      />
    </FeatureFlagsProvider>,
  );
}

describe("TaskDetailFlagGate", () => {
  it("renders MVP when tasks_work_management_parity is off", () => {
    renderGate(false);
    expect(screen.getByTestId("task-detail-mvp")).toBeInTheDocument();
    expect(screen.queryByTestId("task-detail-suite")).not.toBeInTheDocument();
  });

  it("renders suite inside Suspense when tasks_work_management_parity is on", () => {
    renderGate(true);
    expect(screen.getByTestId("task-detail-suite")).toBeInTheDocument();
    expect(screen.queryByTestId("task-detail-mvp")).not.toBeInTheDocument();
  });
});
