import { Download, ListTodo, Plus, SquareCheckBig } from "lucide-react";
import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { SidebarProvider } from "@uniwork/ui/components/ui/sidebar";
import {
  CollectionPageHeader,
  CollectionPageHeaderAction,
  CollectionPageHeaderLinkAction,
} from "./collection-page";
import { CollapsedNavTrigger, PAGE_GUTTER, PageHeader } from "./page-header";

initI18n();

function renderHeader(
  ui: React.ReactElement,
  providerProps?: { hasExternalTrigger?: boolean },
) {
  const { container } = render(
    <SidebarProvider {...providerProps}>{ui}</SidebarProvider>,
  );
  return within(container).getByRole("banner");
}

function expectTitleLeftOfFreeSpace(header: HTMLElement) {
  const trigger = header.querySelector("[data-slot='sidebar-trigger']");
  expect(trigger).not.toBeNull();
  expect(header.firstElementChild).toBe(trigger);
  expect(header).not.toHaveClass("justify-between");
}

describe("PageHeader title alignment", () => {
  it("keeps a collection title beside the nav trigger instead of centering it", () => {
    const header = renderHeader(
      <CollectionPageHeader
        icon={SquareCheckBig}
        title="Công việc"
        count={2}
        actions={<CollectionPageHeaderAction icon={Plus} label="Việc mới" />}
      />,
    );

    expectTitleLeftOfFreeSpace(header);

    const heading = within(header).getByRole("heading");
    expect(heading.textContent).toBe("Công việc");
    expect(heading.parentElement).toHaveClass("flex-1");
  });

  it("keeps an inline title packed against the nav trigger", () => {
    const header = renderHeader(
      <PageHeader>
        <ListTodo className="size-4 text-muted-foreground" />
        <h1 className="text-body font-medium">Issues</h1>
      </PageHeader>,
    );

    expectTitleLeftOfFreeSpace(header);
    expect(header.children).toHaveLength(3);
  });
});

describe("PageHeader base chrome", () => {
  it("supplies the trigger, gap and gutter without per-page classes", () => {
    const header = renderHeader(
      <PageHeader>
        <h1>Inbox</h1>
      </PageHeader>,
    );

    const trigger = header.querySelector("[data-slot='sidebar-trigger']")!;
    expect(trigger).toHaveClass("xl:hidden");
    expect(trigger.className).not.toMatch(/(^|\s)-?m[rsxe]?-/);
    expect(header).toHaveClass("gap-2", PAGE_GUTTER);
  });

  it("does not let a call site override the shared gutter", () => {
    const header = renderHeader(
      <PageHeader className="px-8">
        <h1>Inbox</h1>
      </PageHeader>,
    );

    expect(header).toHaveClass(PAGE_GUTTER);
    expect(header).not.toHaveClass("px-8");
  });

  it("drops its trigger under a shell that keeps its own on screen", () => {
    const header = renderHeader(
      <PageHeader>
        <h1>Inbox</h1>
      </PageHeader>,
      { hasExternalTrigger: true },
    );

    expect(header.querySelector("[data-slot='sidebar-trigger']")).toBeNull();
    expect(within(header).getByRole("heading")).toBe(header.firstElementChild);
  });

  it("keeps the collection leading icon on the TopBar collapse column", () => {
    const header = renderHeader(
      <CollectionPageHeader icon={SquareCheckBig} title="Công việc" />,
      { hasExternalTrigger: true },
    );

    expect(header.querySelector("[data-slot='sidebar-trigger']")).toBeNull();
    const iconSlot = header.querySelector("svg")?.parentElement;
    expect(iconSlot).toHaveClass("size-8");
  });

  it("renders nothing when no sidebar is mounted", () => {
    const { container } = render(<CollapsedNavTrigger />);
    expect(container.querySelector("[data-slot='sidebar-trigger']")).toBeNull();
  });
});

describe("CollectionPageHeaderLinkAction", () => {
  it("keeps the icon and the responsive label a header action gets", () => {
    const header = renderHeader(
      <CollectionPageHeader
        icon={SquareCheckBig}
        title="Danh bạ"
        actions={
          <CollectionPageHeaderLinkAction
            icon={Download}
            label="Xuất danh bạ"
            href="/export"
            download
          />
        }
      />,
    );

    const link = within(header).getByRole("link", { name: "Xuất danh bạ" });
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.querySelector("span")).toHaveClass("hidden", "md:inline");
  });

  it("stays a link and renders without the Base UI native-button assertion", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const header = renderHeader(
      <CollectionPageHeader
        icon={SquareCheckBig}
        title="Danh bạ"
        actions={
          <CollectionPageHeaderLinkAction
            icon={Download}
            label="Xuất danh bạ"
            href="/export"
            download
          />
        }
      />,
    );

    const link = within(header).getByRole("link", { name: "Xuất danh bạ" });
    expect(link).not.toHaveAttribute("role");
    expect(link).not.toHaveAttribute("type");
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
