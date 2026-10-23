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
  it("lists Auto first with the current model, then the enabled models, each beside its mark", async () => {
    mount();
    const menu = await openMenu();
    const rows = within(menu).getAllByRole("menuitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Tự động · Hiện tại: Sonnet 5.5"),
      expect.stringContaining("Haiku 5.5"),
      expect.stringContaining("Sonnet 5.5"),
      expect.stringContaining("Opus 5.5"),
    ]);
    expect(rows.map((r) => r.querySelector("[data-mark]")?.getAttribute("data-mark"))).toEqual(["uni", "anthropic", "anthropic", "anthropic"]);
    expect(within(menu).queryByText("fable")).toBeNull();
  });

  it("a row's flyout shows the model's card with three five-step bars", async () => {
    mount();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Haiku 5.5/ }));
    const description = await screen.findByText("Nhanh và nhẹ nhất, hợp câu hỏi ngắn và tra cứu nhanh.");
    // The card names its model with the provider mark, as the row does.
    const card = description.closest<HTMLElement>("[role=menu]");
    expect(card).not.toBe(menu);
    const title = within(card!).getByText("Haiku 5.5");
    expect(title.closest("p")?.querySelector("[data-mark]")).toHaveAttribute("data-mark", "anthropic");
    expect(screen.getByRole("img", { name: "Tốc độ 5/5" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Trí tuệ 3/5" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Chi phí 1/5" })).toBeInTheDocument();
  });

  it("a click picks the row's model, and its flyout sets the effort and closes", async () => {
    mount();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Haiku 5.5/ }));
    expect(useAskModelChoice.getState().model).toBe("haiku");
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Cao" }));
    expect(useAskModelChoice.getState()).toMatchObject({ model: "haiku", effort: "high" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    const again = await openMenu();
    fireEvent.click(within(again).getByRole("menuitem", { name: /Tự động/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Vừa" }));
    expect(useAskModelChoice.getState()).toMatchObject({ model: "", effort: "medium" });
  });

  it("marks the chosen row current and shows its effort there", async () => {
    useAskModelChoice.setState({ model: "opus", effort: "low" });
    mount();
    const menu = await openMenu();
    const opus = within(menu).getByRole("menuitem", { name: /Opus 5.5/ });
    expect(opus).toHaveAttribute("aria-current", "true");
    expect(opus).toHaveTextContent("Thấp");
    expect(within(menu).getByRole("menuitem", { name: /Haiku 5.5/ })).not.toHaveAttribute("aria-current");
  });

  it("choosing Opus shows the quota note and the choice is remembered", async () => {
    mount();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Opus 5.5/ }));
    expect(useAskModelChoice.getState().model).toBe("opus");
    expect(await screen.findByText("Opus dùng nhiều hạn mức token hơn các model khác.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Chọn model/ })).toHaveTextContent("Opus 5.5");
    await act(async () => {});
    expect(JSON.stringify(Object.values(localStorage))).toContain("opus");
  });

  it("the trigger wears the chosen model's mark, UNI's for Auto", async () => {
    mount();
    const trigger = await screen.findByRole("button", { name: /^Chọn model/ });
    await waitFor(() => expect(trigger.querySelector("[data-mark]")).toHaveAttribute("data-mark", "uni"));
    act(() => {
      useAskModelChoice.setState({ model: "sonnet" });
    });
    await waitFor(() => expect(trigger.querySelector("[data-mark]")).toHaveAttribute("data-mark", "anthropic"));
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
