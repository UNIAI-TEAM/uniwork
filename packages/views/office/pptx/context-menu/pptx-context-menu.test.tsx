import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PptxContextMenu } from "./pptx-context-menu";
import type { PptxContextMenuContext } from "./context-menu-model";

initI18n();
beforeEach(async () => { await setLocale("en"); });

const ready: Partial<PptxContextMenuContext> = {
  slideBound: true,
  selectionCount: 2,
  canDelete: true,
  canEditText: true,
  canInsert: true,
  canReorder: true,
};

async function openMenu(context: Partial<PptxContextMenuContext> = {}) {
  const onAction = vi.fn();
  render(
    <PptxContextMenu {...ready} {...context} onAction={onAction}>
      <div data-testid="surface">slide surface</div>
    </PptxContextMenu>,
  );
  fireEvent.contextMenu(screen.getByTestId("surface"));
  const menu = await screen.findByRole("menu");
  return { menu, onAction };
}

describe("PptxContextMenu", () => {
  it("opens on right-click and runs an enabled row exactly once", async () => {
    const { menu, onAction } = await openMenu();
    expect(within(menu).getByRole("menuitem", { name: /Delete/ })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Delete/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("delete");
  });

  it("closes on Escape without running anything", async () => {
    const { menu, onAction } = await openMenu();
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows a disabled row with its reason and never dispatches it", async () => {
    const { menu, onAction } = await openMenu({ selectionCount: 0 });
    const del = within(menu).getByRole("menuitem", { name: /Delete/ });
    expect(del).toHaveAttribute("aria-disabled", "true");
    expect(within(del).getByText("Select an element first")).toBeInTheDocument();
    fireEvent.click(del);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("explains the unbound clipboard rows instead of pretending they work", async () => {
    const { menu, onAction } = await openMenu();
    // Anchor the name: the cut row's reason copy also contains "Copy and paste".
    const copy = within(menu).getByRole("menuitem", { name: /^Copy/ });
    expect(copy).toHaveAttribute("aria-disabled", "true");
    expect(within(copy).getByText("Copy and paste are not supported by this presentation engine yet")).toBeInTheDocument();
    fireEvent.click(copy);
    expect(onAction).not.toHaveBeenCalled();
  });
});