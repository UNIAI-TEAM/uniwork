import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NavigationProvider } from "../navigation/context";
import type { NavigationAdapter } from "../navigation/types";
import { BreadcrumbHeader } from "./breadcrumb-header";

const navigation: NavigationAdapter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/",
  searchParams: new URLSearchParams(),
  getShareableUrl: (path) => path,
};

function renderHeader(actionsClassName?: string) {
  const view = render(
    <NavigationProvider value={navigation}>
      <BreadcrumbHeader
        segments={[{ href: "/documents", label: "Documents" }]}
        leaf="Report"
        actions={<button type="button">Save</button>}
        actionsClassName={actionsClassName}
      />
    </NavigationProvider>,
  );
  const header = within(view.container).getByRole("banner");
  return { header, actions: header.lastElementChild as HTMLElement };
}

describe("BreadcrumbHeader action wrapper", () => {
  it("keeps the exact default wrapper classes when no override is supplied", () => {
    const { actions } = renderHeader();
    expect(actions.className).toBe(
      "flex min-w-0 max-w-[58%] shrink-0 items-center justify-end gap-1 overflow-x-auto overflow-y-hidden sm:max-w-none sm:overflow-visible",
    );
  });

  it("merges a host override without changing the action child", () => {
    const { actions } = renderHeader(
      "w-full max-w-full justify-start overflow-visible md:w-auto md:justify-end md:overflow-x-auto",
    );
    expect(actions).toHaveClass("w-full", "max-w-full", "justify-start", "overflow-visible", "md:w-auto", "md:justify-end", "md:overflow-x-auto");
    expect(actions).not.toHaveClass("max-w-[58%]");
    expect(within(actions).getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
