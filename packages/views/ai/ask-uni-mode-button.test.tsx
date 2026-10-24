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

const mount = () =>
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniModeButton wsId="ws1" />
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
    const titles = within(menu).getAllByRole("menuitemradio").map((r) => document.getElementById(r.getAttribute("aria-labelledby") ?? "")?.textContent);
    expect(titles).toEqual(["Hỏi trước", "Kế hoạch"]);
    expect(within(menu).queryByText("Tự động")).toBeNull();
    // Each mode is named by its title alone and described by its one-line hint.
    expect(within(menu).getByRole("menuitemradio", { name: "Hỏi trước" })).toHaveAccessibleDescription("Hỏi bạn trước từng thay đổi");
    expect(within(menu).getByRole("menuitemradio", { name: "Kế hoạch" })).toHaveAccessibleDescription("Gom thành kế hoạch để bạn duyệt một lần");
    expect(within(menu).getByText("Khi UNI muốn thay đổi dữ liệu")).toBeInTheDocument();
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
});
