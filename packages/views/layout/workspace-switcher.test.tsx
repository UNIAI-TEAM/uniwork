import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { SidebarProvider } from "@uniwork/ui/components/ui/sidebar";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceSwitcher } from "./workspace-switcher";

initI18n();

const me: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const alpha: Workspace = {
  id: "w1", slug: "alpha", name: "Alpha", organization_id: "o1", organization_slug: "acme",
  organization_name: "Acme", description: "Nhóm làm sản phẩm", icon_emoji: "🚀",
};
const beta: Workspace = {
  id: "w2", slug: "beta", name: "Beta", organization_id: "o1", organization_slug: "acme",
  organization_name: "Acme", description: "",
};

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith("/api/v1/workspaces") ? { workspaces: [alpha, beta] } : {}),
  );
});

describe("WorkspaceSwitcher", () => {
  it("shows the emoji on the trigger and each description under its name", async () => {
    render(wrapWithNav(<SidebarProvider><WorkspaceSwitcher current={alpha} /></SidebarProvider>));
    const trigger = screen.getByRole("button", { name: /Alpha/ });
    expect(trigger).toHaveTextContent("🚀");
    fireEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: /Alpha/ })).toHaveTextContent("Nhóm làm sản phẩm");
    // An empty description draws no second line.
    expect(screen.getByRole("menuitem", { name: /Beta/ }).querySelector("span.block.text-caption")).toBeNull();
  });

  const gamma: Workspace = { ...beta, id: "w3", slug: "gamma", name: "Gamma" };

  function serve(summary: unknown, byWorkspace: Record<string, number>) {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/workspaces")) return Promise.resolve({ workspaces: [alpha, beta, gamma] });
      if (path === "/api/v1/me/chat/unread-summary") return Promise.resolve(summary);
      if (path === "/api/v1/me/notifications/unread-count") {
        return Promise.resolve({ total: 9, by_workspace: byWorkspace });
      }
      return Promise.resolve({});
    });
  }

  it("counts another workspace's chat unread on its row, red when it mentions the reader", async () => {
    serve(
      {
        direct: { unread: 7, mentions: 0 },
        workspaces: [
          { workspace_id: "w1", unread: 4, mentions: 0 },
          { workspace_id: "w2", unread: 120, mentions: 2 },
          { workspace_id: "w3", unread: 3, mentions: 0 },
        ],
      },
      { w2: 1 },
    );
    render(wrapWithNav(<SidebarProvider><WorkspaceSwitcher current={alpha} /></SidebarProvider>));
    fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));

    const mentioned = await screen.findByRole("img", {
      name: "120 tin nhắn chưa đọc. 2 tin nhắn nhắc bạn. 1 thông báo chưa đọc",
    });
    expect(mentioned).toHaveTextContent("99+");
    expect(mentioned).toHaveClass("bg-destructive-solid");
    const plain = screen.getByRole("img", { name: "3 tin nhắn chưa đọc" });
    expect(plain).toHaveTextContent("3");
    expect(plain).toHaveClass("bg-primary");
    // The current workspace has its own Chat badge; the dms in `direct` show everywhere.
    expect(screen.getByRole("menuitem", { name: /Alpha/ }).querySelector("[role=img]")).toBeNull();
  });

  it("keeps the notification dot for a workspace with no chat unread", async () => {
    serve({ direct: { unread: 0, mentions: 0 }, workspaces: [{ workspace_id: "w2", unread: 0, mentions: 0 }] }, {
      w2: 2,
    });
    render(wrapWithNav(<SidebarProvider><WorkspaceSwitcher current={alpha} /></SidebarProvider>));
    fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));

    const dot = await screen.findByRole("img", { name: "2 thông báo chưa đọc" });
    expect(dot).toBeEmptyDOMElement();
    expect(screen.getByRole("menuitem", { name: /Gamma/ }).querySelector("[role=img]")).toBeNull();
  });
});
