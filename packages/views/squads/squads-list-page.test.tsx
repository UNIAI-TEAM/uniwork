import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { SquadsListPage } from "./squads-list-page";

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
          "tasks.squads": {
            status: "unavailable",
            reason_code: "squad_directory_missing",
            explanation_key: "capabilities.squad_directory_missing",
          },
        },
      });
    }
    return Promise.resolve({});
  });
});

describe("SquadsListPage", () => {
  it("renders an empty shell with a capability-disabled create control", async () => {
    render(wrap(<SquadsListPage />));

    expect(await screen.findByText(/chưa có squad|no squads/i)).toBeInTheDocument();

    const create = await screen.findByTestId("squads-create-stub");
    expect(create).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => {
      expect(create).toHaveAttribute(
        "title",
        expect.stringMatching(/squad directory|danh mục squad/i),
      );
    });

    const mutationCallsBefore = requestMock.mock.calls.length;
    fireEvent.click(create);
    expect(requestMock.mock.calls.length).toBe(mutationCallsBefore);
  });
});
