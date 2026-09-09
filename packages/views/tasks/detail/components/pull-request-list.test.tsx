import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { TaskPullRequestList } from "./pull-request-list";

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
      "tasks.vcs": {
        status: "unavailable",
        reason_code: "vcs_provider_missing",
        explanation_key: "capabilities.vcs_provider_missing",
      },
    },
  };
});

describe("TaskPullRequestList", () => {
  it("renders section chrome with empty state and capability reason", () => {
    render(<TaskPullRequestList taskId="t1" />);

    const panel = screen.getByTestId("task-detail-pull-requests");
    expect(
      within(panel).getByRole("heading", {
        name: /pull requests|pull request/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(/no linked pull requests|chưa gắn pull request/i),
    ).toBeVisible();
    const reasons = within(panel).getAllByText(
      /version control|kiểm soát phiên bản|chưa kết nối/i,
    );
    expect(reasons.some((el) => !el.classList.contains("sr-only"))).toBe(true);
  });

  it("disables the link-PR control with a VCS reason", () => {
    render(<TaskPullRequestList taskId="t1" />);

    const control = screen.getByTestId("task-detail-pr-stub");
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute(
      "title",
      expect.stringMatching(/version control|kiểm soát phiên bản|chưa kết nối/i),
    );
  });

  it("ignores clicks while VCS is unavailable", () => {
    render(<TaskPullRequestList taskId="t1" />);

    const control = screen.getByTestId("task-detail-pr-stub");
    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-disabled", "true");
  });
});
