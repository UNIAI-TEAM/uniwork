import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAskModelChoice } from "@uniwork/core/ai/model-choice";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { AskUniModelPicker } from "./ask-uni-model-picker";
import { composerRoutes, user, workspace } from "./ask-uni-fixtures";

initI18n();

function mount() {
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniModelPicker />
      </WorkspaceProvider>,
    ),
  );
}

async function openMenu() {
  fireEvent.click(await screen.findByRole("button", { name: /^Chọn model/ }));
  return screen.findByRole("menu");
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation(composerRoutes);
  useAskModelChoice.setState({ model: "", effort: "" });
});

describe("AskUniModelPicker", () => {
  it("lists Auto first with the current model, then the enabled models", async () => {
    mount();
    const menu = await openMenu();
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("Tự động · Hiện tại: Sonnet 5.5"),
      expect.stringContaining("Haiku 5.5"),
      expect.stringContaining("Sonnet 5.5"),
      expect.stringContaining("Opus 5.5"),
    ]);
    expect(within(menu).queryByText("fable")).toBeNull();
  });

  it("hover shows the detail card with three five-step bars", async () => {
    mount();
    const menu = await openMenu();
    fireEvent.pointerEnter(within(menu).getByRole("menuitemradio", { name: /Haiku 5.5/ }));
    fireEvent.mouseEnter(within(menu).getByRole("menuitemradio", { name: /Haiku 5.5/ }));
    expect(await screen.findByText("Nhanh và nhẹ nhất, hợp câu hỏi ngắn và tra cứu nhanh.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Tốc độ 5/5" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Trí tuệ 3/5" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Chi phí 1/5" })).toBeInTheDocument();
  });

  it("the effort submenu sets low, medium and high", async () => {
    mount();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Mức nỗ lực/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Vừa" }));
    expect(useAskModelChoice.getState().effort).toBe("medium");
    const again = await openMenu();
    fireEvent.click(within(again).getByRole("menuitem", { name: /Mức nỗ lực/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Cao" }));
    expect(useAskModelChoice.getState().effort).toBe("high");
  });

  it("choosing Opus shows the quota note and the choice is remembered", async () => {
    mount();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Opus 5.5/ }));
    expect(useAskModelChoice.getState().model).toBe("opus");
    expect(await screen.findByText("Opus dùng nhiều hạn mức token hơn các model khác.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Chọn model/ })).toHaveTextContent("Opus 5.5");
    await act(async () => {});
    expect(JSON.stringify(Object.values(localStorage))).toContain("opus");
  });

  it("names the trigger with the visible model text (label in name)", async () => {
    useAskModelChoice.setState({ model: "opus" });
    mount();
    expect(await screen.findByRole("button", { name: "Chọn model: Opus 5.5" })).toBeInTheDocument();
  });

  it("shows a chosen effort on the trigger", async () => {
    useAskModelChoice.setState({ model: "haiku", effort: "low" });
    mount();
    const trigger = await screen.findByRole("button", { name: "Chọn model: Haiku 5.5 · Thấp" });
    expect(trigger).toHaveTextContent("Haiku 5.5 · Thấp");
  });

  it("falls back to Auto when the remembered model is not enabled", async () => {
    useAskModelChoice.setState({ model: "fable" });
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Chọn model/ })).toHaveTextContent("Tự động"));
  });
});
