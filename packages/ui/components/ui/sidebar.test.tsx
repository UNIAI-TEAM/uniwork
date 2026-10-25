import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sidebar, SidebarInset, SidebarProvider } from "./sidebar";

afterEach(cleanup);

describe("Sidebar inset surfaces", () => {
  it("uses the app shell behind a transparent desktop rail", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar variant="inset">Navigation</Sidebar>
        <SidebarInset>Content</SidebarInset>
      </SidebarProvider>,
    );

    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]');
    const inner = container.querySelector('[data-slot="sidebar-inner"]');
    const inset = container.querySelector('[data-slot="sidebar-inset"]');

    expect(wrapper).toHaveClass("has-data-[variant=inset]:bg-app-shell");
    expect(wrapper).toHaveClass(
      "has-data-[variant=inset]:[--sidebar-wrapper-fill:var(--app-shell)]",
    );
    expect(inner).toHaveClass("group-data-[variant=inset]:bg-transparent");
    expect(inset).toHaveClass(
      "lg:peer-data-[variant=inset]:ring-surface-border/60",
    );
  });

  it("lets the inset shrink beside the rail, so wide content scrolls inside it, never the page", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar variant="inset">Navigation</Sidebar>
        <SidebarInset>Content</SidebarInset>
      </SidebarProvider>,
    );
    // Without it the flex item's automatic minimum is its content (a wide board), and the page scrolls sideways
    // under the fixed rail once that board's own scroller reaches its end.
    expect(container.querySelector('[data-slot="sidebar-inset"]')).toHaveClass("min-w-0");
  });
});
