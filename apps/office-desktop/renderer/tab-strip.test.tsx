/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { DesktopTabStrip, type DesktopTabSummary } from "./tab-strip";

const tabs: DesktopTabSummary[] = [
  { id: "a", title: "Report.docx", format: "docx", dirty: true },
  { id: "b", title: "Budget.xlsx", format: "xlsx", dirty: false },
  { id: "c", title: "Deck.pptx", format: "pptx", dirty: false, saving: true },
];
const callbacks = () => ({ onSelect: vi.fn(), onClose: vi.fn(), onCreate: vi.fn(), onOpenLocal: vi.fn(), onSignOut: vi.fn() });

it("renders format-neutral tabs with linked panels, dirty/saving labels and a pinned library", () => {
  const actions = callbacks();
  render(<DesktopTabStrip tabs={tabs} activeTabId="a" {...actions} />);
  const documentTab = screen.getByRole("tab", { name: /Report.docx/ });
  expect(documentTab).toHaveAttribute("aria-selected", "true");
  expect(documentTab).toHaveAttribute("aria-controls", "desktop-panel-a");
  expect(documentTab).toHaveAttribute("id", "desktop-tab-a");
  expect(screen.getByLabelText("Chưa lưu")).toBeInTheDocument();
  expect(screen.getByLabelText("Đang lưu…")).toBeInTheDocument();
  expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(3);
  fireEvent.click(screen.getByRole("tab", { name: "Thư viện" }));
  expect(actions.onSelect).toHaveBeenCalledWith(null);
  fireEvent.click(screen.getByRole("button", { name: "Đóng Report.docx" }));
  expect(actions.onClose).toHaveBeenCalledWith("a");
  expect(actions.onSelect).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Đóng Thư viện" })).not.toBeInTheDocument();
});

it("roves through library and document tabs with arrows, Home and End", () => {
  const actions = callbacks();
  render(<DesktopTabStrip tabs={tabs} activeTabId={null} {...actions} />);
  const library = screen.getByRole("tab", { name: "Thư viện" });
  fireEvent.keyDown(library, { key: "ArrowRight" });
  expect(actions.onSelect).toHaveBeenLastCalledWith("a");
  expect(screen.getByRole("tab", { name: /Report.docx/ })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(actions.onSelect).toHaveBeenLastCalledWith("c");
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  expect(actions.onSelect).toHaveBeenLastCalledWith(null);
  fireEvent.keyDown(library, { key: "ArrowLeft" });
  expect(actions.onSelect).toHaveBeenLastCalledWith("c");
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(library).toHaveFocus();
});

it("opens the create menu with Ctrl+T and invokes the existing DOCX action", async () => {
  const actions = callbacks();
  render(<DesktopTabStrip tabs={[]} activeTabId={null} {...actions} />);
  fireEvent.keyDown(window, { key: "t", ctrlKey: true });
  fireEvent.click(await screen.findByRole("menuitem", { name: /Tạo tài liệu DOCX/ }));
  expect(actions.onCreate).toHaveBeenCalledOnce();
});

it("disables creation independently of local open", async () => {
  const actions = callbacks();
  render(<DesktopTabStrip tabs={[]} activeTabId={null} {...actions} createDisabled />);
  fireEvent.click(screen.getByRole("button", { name: "Mở tab mới" }));
  expect(await screen.findByRole("menuitem", { name: /Tạo tài liệu DOCX/ })).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(screen.getByRole("menuitem", { name: "Mở tệp trên máy" }));
  expect(actions.onOpenLocal).toHaveBeenCalledOnce();
});

it("selects an overflow document and offers workspace/sign-out in the account menu", async () => {
  const actions = callbacks();
  const onSwitchWorkspace = vi.fn();
  render(<DesktopTabStrip tabs={tabs} activeTabId="a" {...actions} accountName="An Nguyen" accountEmail="an@example.com" onSwitchWorkspace={onSwitchWorkspace} />);
  fireEvent.click(screen.getByRole("button", { name: "Tất cả tab" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Budget.xlsx/ }));
  expect(actions.onSelect).toHaveBeenCalledWith("b");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Tài khoản: An Nguyen" }));
  expect(await screen.findByText("an@example.com")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "Đổi workspace" }));
  expect(onSwitchWorkspace).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Tài khoản: An Nguyen" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Đăng xuất" }));
  expect(actions.onSignOut).toHaveBeenCalledOnce();
});

it("maps the mouse wheel to horizontal overflow", () => {
  const { container } = render(<DesktopTabStrip tabs={tabs} activeTabId="a" {...callbacks()} />);
  const scroller = container.querySelector("[data-desktop-tab-scroll]")!;
  Object.defineProperties(scroller, { scrollWidth: { value: 800 }, clientWidth: { value: 200 } });
  fireEvent.wheel(scroller, { deltaY: 100 });
  expect(scroller.scrollLeft).toBe(100);
});

it("scrolls the whole active tab into the strip on activation and when the strip resizes", () => {
  const resizeCallbacks: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resizeCallbacks.push(callback); } observe() {} disconnect() {} });
  try {
    // 3 tabs of 220 px in a 300 px strip that starts at x = 100.
    const box = (left: number, width: number) => () => ({ left, right: left + width, width, top: 0, bottom: 32, height: 32, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    const place = (container: HTMLElement, scrollLeft: number) => {
      const scroller = container.querySelector<HTMLElement>("[data-desktop-tab-scroll]")!;
      scroller.getBoundingClientRect = box(100, 300);
      container.querySelectorAll<HTMLElement>(".desktop-document-tab").forEach((tab, index) => { tab.getBoundingClientRect = box(100 + index * 220 - scrollLeft, 220); });
      return scroller;
    };
    const { container, rerender } = render(<DesktopTabStrip tabs={tabs} activeTabId={null} {...callbacks()} />);
    const scroller = place(container, 0);
    expect(scroller.scrollLeft).toBe(0);
    // Tab c spans 540-760 in a strip ending at 400: it scrolls right by exactly the overflow.
    rerender(<DesktopTabStrip tabs={tabs} activeTabId="c" {...callbacks()} />);
    expect(scroller.scrollLeft).toBe(360);
    // Tab a now sits 360 px left of the strip's edge: activating it scrolls back.
    place(container, 360);
    rerender(<DesktopTabStrip tabs={tabs} activeTabId="a" {...callbacks()} />);
    expect(scroller.scrollLeft).toBe(0);
    place(container, 0);
    rerender(<DesktopTabStrip tabs={tabs} activeTabId="b" {...callbacks()} />);
    expect(scroller.scrollLeft).toBe(140);
    // A narrower strip (window resize) clips tab b on the right: the resize observer pulls it back in.
    place(container, 140);
    scroller.getBoundingClientRect = box(100, 200);
    resizeCallbacks.at(-1)!();
    expect(scroller.scrollLeft).toBe(220);
  } finally { vi.unstubAllGlobals(); }
});

it("keeps signed-out chrome free of account/document actions and shortcuts", () => {
  render(<DesktopTabStrip tabs={[]} activeTabId={null} {...callbacks()} signedOut />);
  expect(screen.getByText("UniWork Office")).toBeInTheDocument();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "t", ctrlKey: true });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("renders the same actions and document state in English", async () => {
  await setLocale("en");
  render(<DesktopTabStrip tabs={tabs} activeTabId="a" {...callbacks()} />);
  expect(screen.getByRole("tab", { name: "Library" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close Report.docx" })).toBeInTheDocument();
  expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();
  expect(screen.getByLabelText("Saving…")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open new tab" }));
  expect(await screen.findByRole("menuitem", { name: /Create DOCX document/ })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Open local file" })).toBeInTheDocument();
});

it("blocks create and open actions while busy", async () => {
  const actions = callbacks();
  render(<DesktopTabStrip tabs={[]} activeTabId={null} {...actions} busy />);
  fireEvent.click(screen.getByRole("button", { name: "Mở tab mới" }));
  const create = await screen.findByRole("menuitem", { name: /Tạo tài liệu DOCX/ });
  const open = screen.getByRole("menuitem", { name: "Mở tệp trên máy" });
  expect(create).toHaveAttribute("aria-disabled", "true");
  expect(open).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(create);
  fireEvent.click(open);
  expect(actions.onCreate).not.toHaveBeenCalled();
  expect(actions.onOpenLocal).not.toHaveBeenCalled();
});

it("pins the on-device home and a sign-in button instead of the cloud account menu in local mode", () => {
  const actions = callbacks();
  const onSignIn = vi.fn();
  render(<DesktopTabStrip mode="local" tabs={tabs} activeTabId={null} {...actions} onSignIn={onSignIn} />);
  expect(screen.getByRole("tab", { name: "Trên máy" })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Thư viện" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Tài khoản:/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
  expect(onSignIn).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("tab", { name: /Report.docx/ }));
  expect(actions.onSelect).toHaveBeenCalledWith("a");
});

it.each([["createDocx", "docx"], ["createMarkdown", "md"], ["createHtml", "html"]])("offers %s in the plus menu and passes the %s format", async (key, format) => {
  const actions = callbacks();
  render(<DesktopTabStrip tabs={[]} activeTabId={null} {...actions} />);
  fireEvent.click(screen.getByRole("button", { name: "Mở tab mới" }));
  expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual([i18n.t("officeDesktop.tabs.createDocx"), i18n.t("officeDesktop.tabs.createMarkdown"), i18n.t("officeDesktop.tabs.createHtml"), i18n.t("officeDesktop.tabs.openLocal")]);
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(i18n.t(`officeDesktop.tabs.${key}`)) }));
  expect(actions.onCreate).toHaveBeenCalledExactlyOnceWith(format);
});

it("drops focus to the page when the activated tab has no panel to receive it", () => {
  const actions = callbacks();
  render(<DesktopTabStrip tabs={tabs} activeTabId="a" {...actions} />);
  const budget = screen.getByRole("tab", { name: /Budget.xlsx/ });
  budget.focus();
  fireEvent.click(budget);
  expect(actions.onSelect).toHaveBeenLastCalledWith("b");
  expect(document.body).toHaveFocus();
});

it("keeps focus on the strip for the library tab and for arrow-key roving", () => {
  const actions = callbacks();
  render(<DesktopTabStrip tabs={tabs} activeTabId="a" {...actions} />);
  const library = screen.getByRole("tab", { name: "Thư viện" });
  library.focus();
  fireEvent.click(library);
  expect(library).toHaveFocus();
  fireEvent.keyDown(library, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: /Report.docx/ })).toHaveFocus();
});

/** Panels as the workspace mounts them: hidden + inert unless active, focusable as a fallback. */
function panels(activeId: string, withRoot: Record<string, boolean>) {
  const host = document.createElement("div");
  for (const tab of tabs) {
    const panel = document.createElement("div");
    panel.id = `desktop-panel-${tab.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.tabIndex = -1;
    if (tab.id !== activeId) { panel.hidden = true; panel.setAttribute("inert", ""); }
    if (withRoot[tab.id]) {
      const root = document.createElement("div");
      root.setAttribute("role", "application");
      root.tabIndex = 0;
      root.dataset.root = tab.id;
      panel.append(root);
    }
    host.append(panel);
  }
  document.body.append(host);
  return { host, show: (id: string) => { for (const panel of host.children) { const own = panel.id === `desktop-panel-${id}`; (panel as HTMLElement).hidden = !own; if (own) panel.removeAttribute("inert"); else panel.setAttribute("inert", ""); } } };
}

it("moves focus into the activated document's editor root, where the editor's own Ctrl+F handler runs (R5)", () => {
  const actions = callbacks();
  const view = panels("a", { a: true, b: true });
  actions.onSelect.mockImplementation((id: string) => view.show(id));
  render(<DesktopTabStrip tabs={tabs} activeTabId="a" {...actions} />);
  const budget = screen.getByRole("tab", { name: /Budget.xlsx/ });
  budget.focus();
  fireEvent.click(budget);
  const root = view.host.querySelector<HTMLElement>("[data-root='b']")!;
  expect(root).toHaveFocus();
  // The root's own key handler sees the shortcut, exactly as a PDF editor root does.
  const onKey = vi.fn((event: KeyboardEvent) => event.preventDefault());
  root.addEventListener("keydown", onKey);
  expect(fireEvent.keyDown(document.activeElement!, { key: "f", ctrlKey: true })).toBe(false);
  expect(onKey).toHaveBeenCalledTimes(1);
  view.host.remove();
});

it("falls back to the activated panel itself when its document has no editor root yet, never a hidden one (R5)", () => {
  const actions = callbacks();
  const view = panels("a", { a: true, b: false });
  actions.onSelect.mockImplementation((id: string) => view.show(id));
  render(<DesktopTabStrip tabs={tabs} activeTabId="a" {...actions} />);
  const budget = screen.getByRole("tab", { name: /Budget.xlsx/ });
  budget.focus();
  fireEvent.keyDown(budget, { key: "Enter" });
  fireEvent.click(budget);
  expect(document.getElementById("desktop-panel-b")).toHaveFocus();
  expect(view.host.querySelector("[data-root='a']")).not.toHaveFocus();
  view.host.remove();
});
