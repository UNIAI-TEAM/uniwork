import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrap } from "../test/api-mock";
import { ProjectResourcesSection } from "./project-resources-section";

const me: User = {
  id: "u1",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.includes("/api/v1/config")) {
      return Promise.resolve({
        flags: {},
        rum_sample_rate: 0,
        work_management_capabilities: {
          "tasks.vcs": {
            status: "unavailable",
            reason_code: "vcs_provider_missing",
            explanation_key: "capabilities.vcs_provider_missing",
          },
          "tasks.local_workdir": {
            status: "unavailable",
            reason_code: "local_daemon_missing",
            explanation_key: "capabilities.local_daemon_missing",
          },
        },
      });
    }
    if (p.includes("/resources")) {
      return Promise.resolve({ resources: [], total: 0 });
    }
    return Promise.resolve({});
  });
});

describe("ProjectResourcesSection", () => {
  it("disables the GitHub add control with the VCS catalogue reason", async () => {
    render(wrap(<ProjectResourcesSection workspaceId="w1" projectId="p1" />));

    const githubAdd = await screen.findByTestId("project-resources-add-github");
    expect(githubAdd).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => {
      expect(githubAdd).toHaveAttribute(
        "title",
        expect.stringMatching(/version control|kiểm soát phiên bản|chưa kết nối/i),
      );
    });
    expect(githubAdd).toHaveAttribute(
      "aria-describedby",
      "project-resources-add-github-reason",
    );

    await waitFor(() => {
      expect(
        requestMock.mock.calls.some(([path]) =>
          String(path).includes("/projects/p1/resources"),
        ),
      ).toBe(true);
    });
  });

  it("disables the local-directory add control with the workdir catalogue reason", async () => {
    render(wrap(<ProjectResourcesSection workspaceId="w1" projectId="p1" />));

    const localAdd = await screen.findByTestId(
      "project-resources-add-local-directory",
    );
    expect(localAdd).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => {
      expect(localAdd).toHaveAttribute(
        "title",
        expect.stringMatching(/local workdir|daemon|thư mục làm việc/i),
      );
    });
    expect(localAdd).toHaveAttribute(
      "aria-describedby",
      "project-resources-add-local-directory-reason",
    );
  });

  it("ignores add clicks while VCS and workdir are unavailable (no mutation)", async () => {
    render(wrap(<ProjectResourcesSection workspaceId="w1" projectId="p1" />));

    const githubAdd = await screen.findByTestId("project-resources-add-github");
    const localAdd = await screen.findByTestId(
      "project-resources-add-local-directory",
    );

    const callsBefore = requestMock.mock.calls.length;
    fireEvent.click(githubAdd);
    fireEvent.click(localAdd);

    expect(githubAdd).toHaveAttribute("aria-disabled", "true");
    expect(localAdd).toHaveAttribute("aria-disabled", "true");
    expect(requestMock.mock.calls.length).toBe(callsBefore);
    expect(
      requestMock.mock.calls.some(([, init]) => {
        const method = String(
          (init as { method?: string } | undefined)?.method ?? "GET",
        ).toUpperCase();
        return method !== "GET";
      }),
    ).toBe(false);
  });
});
