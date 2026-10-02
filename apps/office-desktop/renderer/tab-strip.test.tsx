/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

it("maps the mouse wheel to horizontal overflow and reveals the selected tab", () => {
  const scrollIntoView = vi.fn();
  const previous = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  try {
    const { container, rerender } = render(<DesktopTabStrip tabs={tabs} activeTabId="a" {...callbacks()} />);
    const scroller = container.querySelector("[data-desktop-tab-scroll]")!;
    Object.defineProperties(scroller, { scrollWidth: { value: 800 }, clientWidth: { value: 200 } });
    fireEvent.wheel(scroller, { deltaY: 100 });
    expect(scroller.scrollLeft).toBe(100);
    rerender(<DesktopTabStrip tabs={tabs} activeTabId="c" {...callbacks()} />);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  } finally { HTMLElement.prototype.scrollIntoView = previous; }
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
