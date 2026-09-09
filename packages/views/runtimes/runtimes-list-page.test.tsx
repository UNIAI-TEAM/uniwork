import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { RuntimesListPage } from "./runtimes-list-page";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.includes("/api/v1/config")) {
      return Promise.resolve({
        flags: {},
        rum_sample_rate: 0,
        work_management_capabilities: {
          "tasks.agent_runs": {
            status: "unavailable",
            reason_code: "agent_runtime_missing",
            explanation_key: "capabilities.agent_runtime_missing",
          },
        },
      });
    }
    return Promise.resolve({});
  });
});

describe("RuntimesListPage", () => {
  it("renders an empty shell with a capability-disabled create control", async () => {
    render(wrap(<RuntimesListPage />));

    expect(await screen.findByText(/chưa có runtime|no runtimes/i)).toBeInTheDocument();

    const create = await screen.findByTestId("runtimes-create-stub");
    expect(create).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => {
      expect(create).toHaveAttribute(
        "title",
        expect.stringMatching(/agent runtime|runtime agent/i),
      );
    });

    const mutationCallsBefore = requestMock.mock.calls.length;
    fireEvent.click(create);
    expect(requestMock.mock.calls.length).toBe(mutationCallsBefore);
  });
});
