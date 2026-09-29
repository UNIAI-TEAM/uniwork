import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import {
  resetProjectViewStoreForTests,
  useProjectViewStore,
} from "@uniwork/core/projects/stores/view-store";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import type { NavigationAdapter } from "../navigation";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ProjectsListPage } from "./projects-list-page";

const me: User = {
  id: "u1",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "w1",
  slug: "main",
  name: "Acme",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const base = {
  organization_id: "o1",
  workspace_id: "w1",
  description: "",
  icon: null,
  start_date: null,
  due_date: null,
  revision: 1,
  resource_count: 0,
  updated_at: "2026-06-01T00:00:00Z",
};

const launch = {
  ...base,
  id: "p1",
  title: "Q3 launch",
  status: "in_progress",
  priority: "high",
  lead_type: "agent",
  lead_id: "a1",
  task_count: 3,
  done_count: 1,
  created_at: "2026-06-01T00:00:00Z",
};

const tet = {
  ...base,
  id: "p2",
  title: "Dự án Tết",
  status: "planned",
  priority: "none",
  lead_type: null,
  lead_id: null,
  task_count: 0,
  done_count: 0,
  created_at: "2026-06-02T00:00:00Z",
};

function nav(): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/",
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => p,
  };
}

function renderPage(adapter: NavigationAdapter = nav()) {
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={me}>
        <ProjectsListPage
          workspaceId="w1"
          workspaceName="Acme"
          projectPath={(id) => `/acme/main/projects/${id}`}
        />
      </WorkspaceProvider>,
      adapter,
    ),
  );
  return adapter;
}

function postCalls() {
  return requestMock.mock.calls.filter(
    ([path, init]) =>
      String(path).endsWith("/workspaces/w1/projects") &&
      (init as { method?: string } | undefined)?.method === "POST",
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetAuthStoreForTests();
  resetProjectViewStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown, init?: { method?: string; body?: unknown }) => {
    const p = String(path);
    if (p.endsWith("/workspaces/w1/projects") && init?.method === "POST") {
      const body = init.body as Record<string, unknown>;
      return new Promise((resolve) =>
        setTimeout(() => resolve({ project: { ...tet, ...body, id: "p9" } }), 0),
      );
    }
    if (p.includes("/projects") && !p.includes("/resources")) {
      return Promise.resolve({ projects: [launch, tet], total: 2 });
    }
    if (p.includes("/members")) {
      return Promise.resolve({
        members: [
          {
            workspace_id: "w1",
            user_id: "u1",
            role: "admin",
            email: "me@x.com",
            display_name: "Me",
          },
        ],
      });
    }
    if (p.includes("/agents")) {
      return Promise.resolve({
        agents: [
          {
            id: "a1",
            organization_id: "o1",
            name: "Uni Bot",
            handle: "uni",
            status: "active",
            owner_user_id: "u1",
          },
        ],
      });
    }
    if (p.includes("/pins")) {
      return Promise.resolve({ pins: [], total: 0 });
    }
    return Promise.resolve({});
  });
});

describe("ProjectsListPage", () => {
  it("shows project titles from listProjects", async () => {
    renderPage();
    expect(await screen.findByText("Q3 launch")).toBeInTheDocument();
    expect(screen.getByText("Dự án Tết")).toBeInTheDocument();
  });

  it("names an agent lead instead of showing it as unassigned", async () => {
    renderPage();
    expect(await screen.findByText("Uni Bot")).toBeInTheDocument();
  });

  it("finds a project when the search omits Vietnamese diacritics", async () => {
    renderPage();
    await screen.findByText("Q3 launch");
    fireEvent.change(screen.getByLabelText("Tìm dự án…"), {
      target: { value: "du an tet" },
    });
    expect(screen.queryByText("Q3 launch")).not.toBeInTheDocument();
    expect(screen.getByText("Dự án Tết")).toBeInTheDocument();
  });

  it("filters by lead through the shared actor filter, with counts and folded search", async () => {
    renderPage();
    await screen.findByText("Q3 launch");
    fireEvent.click(screen.getByRole("button", { name: /Bộ lọc/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Phụ trách/ }));
    const search = await screen.findByLabelText("Tìm…");
    const agent = await screen.findByRole("menuitemcheckbox", { name: /Uni Bot/ });
    expect(agent).toHaveTextContent("1");
    expect(screen.getByRole("menuitemcheckbox", { name: /Me/ })).not.toHaveTextContent("1");

    fireEvent.change(search, { target: { value: "uni bot" } });
    expect(screen.queryByRole("menuitemcheckbox", { name: /Me/ })).toBeNull();

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Uni Bot/ }));
    await waitFor(() => expect(screen.queryByText("Dự án Tết")).not.toBeInTheDocument());
    expect(screen.getByText("Q3 launch")).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: /Uni Bot/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("opens a project in place on a plain row click", async () => {
    const adapter = renderPage();
    fireEvent.click(await screen.findByText("Q3 launch"));
    expect(adapter.push).toHaveBeenCalledWith("/acme/main/projects/p1");
  });

  it("creates a project with every composer field and opens it", async () => {
    const adapter = renderPage();
    await screen.findByText("Q3 launch");
    fireEvent.click(screen.getByRole("button", { name: "Dự án mới" }));
    fireEvent.change(await screen.findByLabelText("Tiêu đề dự án"), {
      target: { value: "  Ra mắt app  " },
    });
    fireEvent.change(screen.getByLabelText("Thêm mô tả…"), {
      target: { value: "Mục tiêu quý 4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tạo dự án" }));

    await waitFor(() => expect(adapter.push).toHaveBeenCalledWith("/acme/main/projects/p9"));
    expect(postCalls()).toHaveLength(1);
    expect(postCalls()[0]?.[1]).toMatchObject({
      method: "POST",
      body: {
        title: "Ra mắt app",
        description: "Mục tiêu quý 4",
        status: "planned",
        priority: "none",
        lead_type: null,
        lead_id: null,
        start_date: null,
        due_date: null,
      },
    });
  });

  it("draws cards with the panel hairline, not the text colour", async () => {
    // A bare `border` takes currentColor: base.css sets no default colour.
    useProjectViewStore.getState().setViewMode("comfortable");
    renderPage();
    const title = await screen.findByRole("heading", { name: "Q3 launch" });
    const card = title.closest(".group\\/card");
    expect(card).toHaveClass("border", "border-border");
  });

  it("sends one create request when submit fires twice before the reply", async () => {
    renderPage();
    await screen.findByText("Q3 launch");
    fireEvent.click(screen.getByRole("button", { name: "Dự án mới" }));
    const title = await screen.findByLabelText("Tiêu đề dự án");
    fireEvent.change(title, { target: { value: "Một lần thôi" } });
    const form = title.closest("form");
    if (!form) throw new Error("composer form missing");
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(postCalls()).toHaveLength(1));
  });
});
