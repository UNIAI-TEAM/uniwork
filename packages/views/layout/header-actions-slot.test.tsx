import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HeaderActionsFill, HeaderActionsSlotProvider, useHeaderActionsMenuFilled } from "./header-actions-slot";

function MenuProbe() {
  return <span data-testid="menu-filled">{String(useHeaderActionsMenuFilled())}</span>;
}

describe("useHeaderActionsMenuFilled", () => {
  it("is false with no provider and with no contributed menu items", () => {
    const { unmount } = render(<MenuProbe />);
    expect(screen.getByTestId("menu-filled")).toHaveTextContent("false");
    unmount();
    render(<HeaderActionsSlotProvider><MenuProbe /><HeaderActionsFill actions={<button type="button">a</button>} /></HeaderActionsSlotProvider>);
    expect(screen.getByTestId("menu-filled")).toHaveTextContent("false");
  });

  it("follows a surface that contributes menu items, and its unmount", () => {
    const tree = (withItems: boolean) => <HeaderActionsSlotProvider><MenuProbe />{withItems ? <HeaderActionsFill menuItems={<span>Print</span>} /> : null}</HeaderActionsSlotProvider>;
    const { rerender } = render(tree(true));
    expect(screen.getByTestId("menu-filled")).toHaveTextContent("true");
    rerender(tree(false));
    expect(screen.getByTestId("menu-filled")).toHaveTextContent("false");
  });
});
