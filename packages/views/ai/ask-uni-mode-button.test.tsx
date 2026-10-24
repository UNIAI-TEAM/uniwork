import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { AskUniModeButton } from "./ask-uni-mode-button";
import { capabilities, composerRoutes, user, workspace } from "./ask-uni-fixtures";

initI18n();

function serve(actions: { enabled: boolean; ceiling: string; mode: string }) {
  requestMock.mockImplementation((path: string, init?: { method?: string; body?: { mode?: string } }) => {
    if (path.endsWith("/ai/capabilities")) return Promise.resolve({ ...capabilities(), actions });
    if (path === "/api/v1/me/ask-uni-mode" && init?.method === "PUT") return Promise.resolve({ mode: init.body?.mode });
    return composerRoutes(path);
  });
}

const mount = (tainted = false) =>
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniModeButton wsId="ws1" conversationTainted={tainted} />
      </WorkspaceProvider>,
    ),
  );

beforeEach(() => {
  requestMock.mockReset();
});

describe("AskUniModeButton", () => {
  it("renders nothing when actions are off", async () => {
    serve({ enabled: false, ceiling: "plan", mode: "ask" });
    const { container } = mount();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders nothing when the ceiling is off", async () => {
    serve({ enabled: true, ceiling: "off", mode: "" });
    const { container } = mount();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(container.querySelector("button")).toBeNull();
  });

  it("lists only the modes at or below the ceiling and saves the pick", async () => {
    serve({ enabled: true, ceiling: "plan", mode: "ask" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Chế độ: Hỏi trước/ }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitemradio").map((r) => r.textContent)).toEqual(["Hỏi trước", "Kế hoạch"]);
    expect(within(menu).queryByText("Tự động")).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Kế hoạch" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/me/ask-uni-mode", { method: "PUT", body: { mode: "plan" } }));
    expect(await screen.findByRole("button", { name: /Chế độ: Kế hoạch/ })).toBeInTheDocument();
  });

  it("says when the mode did not save, and keeps the one in use", async () => {
    serve({ enabled: true, ceiling: "plan", mode: "ask" });
    const base = requestMock.getMockImplementation();
    requestMock.mockImplementation((path: string, init?: { method?: string }) =>
      path === "/api/v1/me/ask-uni-mode" ? Promise.reject(new ApiError("Ask UNI actions are off", "ai_actions_disabled", 403)) : base?.(path, init),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Chế độ: Hỏi trước/ }));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitemradio", { name: "Kế hoạch" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không lưu được chế độ. Thử lại.");
    expect(screen.getByRole("button", { name: /Chế độ: Hỏi trước/ })).toBeInTheDocument();
  });

  it("says every change still asks first in a tainted conversation on Tự động", async () => {
    serve({ enabled: true, ceiling: "auto", mode: "auto" });
    mount(true);
    expect(await screen.findByRole("status")).toHaveTextContent("mọi thay đổi vẫn hỏi bạn trước");
  });

  it("shows no such note when the conversation is clean or the mode is not Tự động", async () => {
    serve({ enabled: true, ceiling: "auto", mode: "auto" });
    const clean = mount(false);
    await screen.findByRole("button", { name: /Chế độ: Tự động/ });
    expect(screen.queryByRole("status")).toBeNull();
    clean.unmount();
    requestMock.mockReset();
    serve({ enabled: true, ceiling: "auto", mode: "plan" });
    mount(true);
    await screen.findByRole("button", { name: /Chế độ: Kế hoạch/ });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
