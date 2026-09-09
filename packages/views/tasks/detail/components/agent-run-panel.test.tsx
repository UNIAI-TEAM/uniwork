import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { AgentRunPanel } from "./agent-run-panel";

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
    },
  };
});

describe("AgentRunPanel", () => {
  it("renders section chrome with empty state and capability reason", () => {
    render(<AgentRunPanel taskId="t1" />);

    const panel = screen.getByTestId("task-detail-agent-run-panel");
    expect(
      within(panel).getByRole("heading", {
        name: /agent runs|nhật ký chạy|lịch sử chạy/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(/no agent runs|chưa có lần chạy/i),
    ).toBeVisible();
    const reasons = within(panel).getAllByText(
      /agent runtime|runtime agent|chưa khả dụng/i,
    );
    expect(reasons.some((el) => !el.classList.contains("sr-only"))).toBe(true);
  });

  it("disables start, usage, retry, and terminate controls with reasons", () => {
    render(<AgentRunPanel taskId="t1" />);

    for (const id of [
      "task-detail-agent-run-stub",
      "task-detail-agent-run-usage",
      "task-detail-agent-run-retry",
      "task-detail-agent-run-terminate",
    ]) {
      const control = screen.getByTestId(id);
      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute(
        "title",
        expect.stringMatching(/agent runtime|runtime agent|chưa khả dụng/i),
      );
    }
  });

  it("ignores clicks on disabled run actions", () => {
    render(<AgentRunPanel taskId="t1" />);

    const start = screen.getByTestId("task-detail-agent-run-stub");
    fireEvent.click(start);
    expect(start).toHaveAttribute("aria-disabled", "true");
  });
});
