import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { FolderBreadcrumb } from "./folder-breadcrumb";

const { t } = initI18n();

const sevenLevelPath = [
  { id: "f1", title: "Cấp 1" },
  { id: "f2", title: "Cấp 2" },
  { id: "f3", title: "Cấp 3" },
  { id: "f4", title: "Cấp 4" },
  { id: "f5", title: "Cấp 5" },
  { id: "f6", title: "Cấp 6" },
  { id: "f7", title: "Cấp 7" },
];

describe("FolderBreadcrumb", () => {
  it("collapses a 7-level path to root, '…', parent, and leaf without flex-wrap", () => {
    render(
      <FolderBreadcrumb
        path={sevenLevelPath}
        canRename
        renaming={false}
        onRoot={vi.fn()}
        onFolder={vi.fn()}
        onRename={vi.fn()}
      />,
    );

    const nav = screen.getByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(nav).not.toHaveClass("flex-wrap");

    expect(within(nav).getByRole("button", { name: t("documents.home.sidebar.home") })).toBeInTheDocument();
    const moreBtn = within(nav).getByRole("button", { name: t("documents.home.breadcrumb_more") });
    expect(moreBtn).toBeInTheDocument();
    expect(moreBtn).toHaveTextContent("…");
    expect(within(nav).getByRole("button", { name: "Cấp 6" })).toBeInTheDocument();
    expect(within(nav).getByText("Cấp 7")).toHaveAttribute("aria-current", "page");

    for (const hidden of ["Cấp 1", "Cấp 2", "Cấp 3", "Cấp 4", "Cấp 5"]) {
      expect(within(nav).queryByRole("button", { name: hidden })).toBeNull();
    }

    for (const btn of within(nav).getAllByRole("button")) {
      expect(btn).toHaveClass("pointer-coarse:min-h-11", "pointer-coarse:min-w-11");
    }
  });

  it("lists every hidden level in order inside the '…' menu and navigates on click", async () => {
    const onFolder = vi.fn();
    render(
      <FolderBreadcrumb
        path={sevenLevelPath}
        canRename={false}
        renaming={false}
        onRoot={vi.fn()}
        onFolder={onFolder}
        onRename={vi.fn()}
      />,
    );

    const moreBtn = screen.getByRole("button", { name: t("documents.home.breadcrumb_more") });
    fireEvent.click(moreBtn);

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Cấp 1",
      "Cấp 2",
      "Cấp 3",
      "Cấp 4",
      "Cấp 5",
    ]);
    for (const item of items) {
      expect(item).toHaveClass("pointer-coarse:min-h-11");
    }

    fireEvent.click(items[2]!);
    expect(onFolder).toHaveBeenCalledWith("f3");
  });

  it("supports keyboard operation on the '…' menu: Enter/Space opens, arrows move, Enter activates, Esc closes and returns focus", async () => {
    const onFolder = vi.fn();
    render(
      <FolderBreadcrumb
        path={sevenLevelPath}
        canRename={false}
        renaming={false}
        onRoot={vi.fn()}
        onFolder={onFolder}
        onRename={vi.fn()}
      />,
    );

    const moreBtn = screen.getByRole("button", { name: t("documents.home.breadcrumb_more") });
    moreBtn.focus();
    expect(moreBtn).toHaveFocus();

    // Open with Enter and move with ArrowDown / ArrowUp.
    fireEvent.keyDown(moreBtn, { key: "Enter" });
    fireEvent.click(moreBtn);
    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(5);
    await waitFor(() => expect(items[0]).toHaveFocus());

    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    await waitFor(() => expect(items[1]).toHaveFocus());

    fireEvent.keyDown(items[1]!, { key: "ArrowDown" });
    await waitFor(() => expect(items[2]).toHaveFocus());

    fireEvent.keyDown(items[2]!, { key: "ArrowUp" });
    await waitFor(() => expect(items[1]).toHaveFocus());

    // Escape closes the menu and restores focus to the trigger button without navigating.
    fireEvent.keyDown(items[1]!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
    await waitFor(() => expect(moreBtn).toHaveFocus());
    expect(onFolder).not.toHaveBeenCalled();

    // Reopen with Space, navigate to a hidden level, and activate it with Enter.
    fireEvent.keyDown(moreBtn, { key: " " });
    fireEvent.keyUp(moreBtn, { key: " " });
    fireEvent.click(moreBtn);
    const reopenedItems = await screen.findAllByRole("menuitem");
    await waitFor(() => expect(reopenedItems[0]).toHaveFocus());
    fireEvent.keyDown(reopenedItems[0]!, { key: "ArrowDown" });
    await waitFor(() => expect(reopenedItems[1]).toHaveFocus());
    fireEvent.keyDown(reopenedItems[1]!, { key: "Enter" });

    expect(onFolder).toHaveBeenCalledTimes(1);
    expect(onFolder).toHaveBeenCalledWith("f2");
  });

  it("shows short paths (≤ 3 levels) in full without '…' and keeps inline rename", () => {
    const onRoot = vi.fn();
    const onFolder = vi.fn();
    const onRename = vi.fn();

    const { rerender } = render(
      <FolderBreadcrumb
        path={[{ id: "f1", title: "Cấp 1" }]}
        canRename={false}
        renaming={false}
        onRoot={onRoot}
        onFolder={onFolder}
        onRename={onRename}
      />,
    );

    const nav = screen.getByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(nav).not.toHaveClass("flex-wrap");
    expect(within(nav).queryByRole("button", { name: t("documents.home.breadcrumb_more") })).toBeNull();
    expect(within(nav).queryByText("…")).toBeNull();
    expect(within(nav).getByText("Cấp 1")).toHaveAttribute("aria-current", "page");

    rerender(
      <FolderBreadcrumb
        path={[
          { id: "f1", title: "Cấp 1" },
          { id: "f2", title: "Cấp 2" },
        ]}
        canRename={false}
        renaming={false}
        onRoot={onRoot}
        onFolder={onFolder}
        onRename={onRename}
      />,
    );
    expect(within(nav).queryByRole("button", { name: t("documents.home.breadcrumb_more") })).toBeNull();
    expect(within(nav).getByRole("button", { name: "Cấp 1" })).toBeInTheDocument();
    expect(within(nav).getByText("Cấp 2")).toHaveAttribute("aria-current", "page");

    rerender(
      <FolderBreadcrumb
        path={[
          { id: "f1", title: "Cấp 1" },
          { id: "f2", title: "Cấp 2" },
          { id: "f3", title: "Cấp 3" },
        ]}
        canRename
        renaming={false}
        onRoot={onRoot}
        onFolder={onFolder}
        onRename={onRename}
      />,
    );

    expect(within(nav).queryByRole("button", { name: t("documents.home.breadcrumb_more") })).toBeNull();
    expect(within(nav).queryByText("…")).toBeNull();
    fireEvent.click(within(nav).getByRole("button", { name: t("documents.home.sidebar.home") }));
    expect(onRoot).toHaveBeenCalledTimes(1);
    fireEvent.click(within(nav).getByRole("button", { name: "Cấp 1" }));
    expect(onFolder).toHaveBeenCalledWith("f1");
    fireEvent.click(within(nav).getByRole("button", { name: "Cấp 2" }));
    expect(onFolder).toHaveBeenCalledWith("f2");
    expect(within(nav).getByText("Cấp 3")).toHaveAttribute("aria-current", "page");

    // Inline rename pencil still works on the leaf.
    fireEvent.click(within(nav).getByRole("button", { name: t("documents.home.folders.rename") }));
    const input = within(nav).getByRole("textbox", { name: t("documents.home.folders.rename_label") });
    fireEvent.change(input, { target: { value: "Cấp 3 mới" } });
    fireEvent.submit(input);
    expect(onRename).toHaveBeenCalledWith("Cấp 3 mới");
  });
});
