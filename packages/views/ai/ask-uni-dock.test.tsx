import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, requestStreamMock, streamResponse, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { AskUniDock } from "./ask-uni-dock";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};
const desktopWidth = window.innerWidth;

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/workspaces/ws1/ai/capabilities") {
      return Promise.resolve({ enabled: true, ask_uni: true, meeting_summary: true, quota: { used_tokens: 0, limit_tokens: 500000 } });
    }
    if (path === "/api/v1/workspaces/ws1/ai/conversations") return Promise.resolve({ conversations: [] });
    return Promise.resolve({});
  });
  useAiPanelStore.setState({ open: false, conversationId: null, workspaceId: null, fullPage: false });
});

afterEach(() => {
  window.innerWidth = desktopWidth;
});

function mount() {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniDock enabled>
          <p>trang chính</p>
        </AskUniDock>
      </WorkspaceProvider>,
    ),
  );
}

describe("AskUniDock", () => {
  it("docks beside the content on desktop", async () => {
    window.innerWidth = 1280;
    mount();
    expect(screen.getByText("trang chính")).toBeVisible();
    expect(screen.queryByRole("complementary")).toBeNull();
    useAiPanelStore.getState().setOpen(true);
    const panel = await screen.findByRole("complementary", { name: "Hỏi UNI" });
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("trang chính")).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hides the content panel in full page and keeps it mounted", async () => {
    window.innerWidth = 1280;
    useAiPanelStore.setState({ open: true, fullPage: true });
    mount();
    await screen.findByRole("complementary", { name: "Hỏi UNI" });
    expect(screen.getByText("trang chính")).toBeInTheDocument();
    expect(screen.getByText("trang chính")).not.toBeVisible();
    useAiPanelStore.getState().setFullPage(false);
    await waitFor(() => expect(screen.getByText("trang chính")).toBeVisible());
  });

  it("opens a full-screen sheet on mobile", async () => {
    window.innerWidth = 500;
    useAiPanelStore.setState({ open: true });
    mount();
    expect(await screen.findByRole("dialog", { name: "Hỏi UNI" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByText("trang chính")).toBeInTheDocument();
    // The header owns close: the sheet adds none of its own.
    expect(screen.getAllByRole("button", { name: "Đóng" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Mở rộng toàn trang" })).toBeNull();
  });

  it("renders nothing but the content while the flag is off", async () => {
    useAiPanelStore.setState({ open: true });
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <AskUniDock enabled={false}>
            <p>trang chính</p>
          </AskUniDock>
        </WorkspaceProvider>,
      ),
    );
    expect(screen.getByText("trang chính")).toBeVisible();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("touch-action", () => {
  it.each([
    ["flag off", false, false],
    ["flag on, closed", true, false],
    ["flag on, docked", true, true],
  ])("restores touch-action: auto on the group and every panel (%s)", async (_name, enabled, open) => {
    window.innerWidth = 1280;
    useAiPanelStore.setState({ open });
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <AskUniDock enabled={enabled}>
            <p>trang chính</p>
          </AskUniDock>
        </WorkspaceProvider>,
      ),
    );
    if (open) await screen.findByRole("complementary", { name: "Hỏi UNI" });
    // The library writes pan-y inline on the group and on each panel's inner div (the one that takes className); an important class beats it.
    const carriers = [
      ...document.querySelectorAll('[data-slot="resizable-panel-group"], [data-panel] > div'),
    ];
    expect(carriers).toHaveLength(open ? 3 : 2);
    for (const el of carriers) expect(el).toHaveClass("!touch-auto");
  });
});

describe("test transport", () => {
  it("rejects an unmocked stream and replays SSE frames", async () => {
    await expect(requestStreamMock("/x", {})).rejects.toThrow(/unmocked stream/);
    const text = await streamResponse(["data: a\n\n", "data: b\n\n"]).text();
    expect(text).toBe("data: a\n\ndata: b\n\n");
  });
});
