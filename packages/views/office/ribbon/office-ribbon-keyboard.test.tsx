import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useOfficeRibbonPreferencesStore } from "@uniwork/core/office/ribbon-preferences";
import { OfficeRibbon } from "./office-ribbon";
import { ribbonFixture } from "./test/fixtures";

beforeEach(() => {
  useOfficeRibbonPreferencesStore.setState({ collapsed: {} });
});

afterEach(() => {
  window.innerWidth = 1024;
});

describe("keyboard navigation", () => {
  it("roves across tabs with arrows, Home and End, selecting as it goes", () => {
    const fixture = ribbonFixture({ tableSelected: true });
    render(<OfficeRibbon tabs={fixture.tabs} scope="docx" />);
    const home = screen.getByRole("tab", { name: "Home" });
    expect(home).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Insert" })).toHaveAttribute("tabindex", "-1");

    home.focus();
    fireEvent.keyDown(home, { key: "ArrowRight" });
    const insert = screen.getByRole("tab", { name: "Insert" });
    expect(insert).toHaveFocus();
    expect(insert).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(insert, { key: "End" });
    expect(screen.getByRole("tab", { name: "Table Design" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Table Design" }), { key: "ArrowRight" });
    expect(home).toHaveFocus();
    fireEvent.keyDown(home, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Table Design" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Table Design" }), { key: "Home" });
    expect(home).toHaveFocus();
  });

  it("enters the body with ArrowDown, roves one tab stop across groups and returns on Escape", async () => {
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
    const body = screen.getByRole("tabpanel");
    const paste = within(body).getByRole("button", { name: "Paste" });
    await waitFor(() => expect(paste).toHaveAttribute("tabindex", "0"));
    const cut = within(body).getByRole("button", { name: "Cut" });
    expect(cut).toHaveAttribute("tabindex", "-1");

    const home = screen.getByRole("tab", { name: "Home" });
    home.focus();
    fireEvent.keyDown(home, { key: "ArrowDown" });
    expect(paste).toHaveFocus();

    fireEvent.keyDown(paste, { key: "ArrowRight" });
    expect(within(body).getByRole("button", { name: "Tùy chọn Paste" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(cut).toHaveFocus();
    expect(cut).toHaveAttribute("tabindex", "0");
    expect(paste).toHaveAttribute("tabindex", "-1");
    // aria-disabled commands stay reachable.
    fireEvent.keyDown(cut, { key: "ArrowRight" });
    expect(within(body).getByRole("button", { name: "Copy" })).toHaveFocus();

    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(within(body).getByRole("button", { name: "Find" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(paste).toHaveFocus();
    fireEvent.keyDown(paste, { key: "ArrowLeft" });
    expect(paste).toHaveFocus();

    fireEvent.keyDown(paste, { key: "Escape" });
    expect(home).toHaveFocus();
  });
});

describe("simplified ribbon", () => {
  it("turns the body into one row of group buttons that open their panels", async () => {
    const fixture = ribbonFixture();
    render(<OfficeRibbon tabs={fixture.tabs} scope="docx" layout="simplified" />);
    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("data-ribbon-layout", "simplified");
    const row = screen.getByRole("toolbar", { name: "Nhóm lệnh" });
    expect(within(row).getAllByRole("button").map((button) => button.dataset.ribbonGroupButton)).toEqual([
      "clipboard",
      "font",
      "paragraph",
      "styles",
      "editing",
    ]);
    expect(screen.queryByRole("group", { name: "Font" })).not.toBeInTheDocument();
    expect(screen.getByRole("tablist").className).toContain("overflow-x-auto");

    fireEvent.click(within(row).getByRole("button", { name: /Editing/ }));
    await screen.findByRole("dialog", { name: "Lệnh Editing" });
    fireEvent.click(within(document.querySelector("[data-ribbon-panel='editing']") as HTMLElement).getByRole("button", { name: "Find" }));
    expect(fixture.actions.find).toHaveBeenCalledOnce();
  });

  it("is picked automatically at phone width", async () => {
    window.innerWidth = 390;
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" />);
    await waitFor(() => expect(screen.getByRole("region")).toHaveAttribute("data-ribbon-layout", "simplified"));
  });

  it("stays full when the caller pins the full layout", () => {
    window.innerWidth = 390;
    render(<OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" layout="full" />);
    expect(screen.getByRole("region")).toHaveAttribute("data-ribbon-layout", "full");
  });
});
