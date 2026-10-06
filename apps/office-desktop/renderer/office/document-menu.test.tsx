/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import { HeaderActionsFill, HeaderActionsSlotProvider } from "@uniwork/views/layout/header-actions-slot";
import { DesktopDocumentMenu, useDesktopPrint } from "./document-menu";

const openMenu = () => {
  const trigger = screen.getByRole("button", { name: i18n.t("office.ribbon.more") });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.click(trigger);
};

it("renders the host items and then the items a mounted view contributes", async () => {
  render(<HeaderActionsSlotProvider>
    <DesktopDocumentMenu><DropdownMenuItem>Back</DropdownMenuItem></DesktopDocumentMenu>
    <HeaderActionsFill menuItems={<DropdownMenuItem data-view-print>Print</DropdownMenuItem>} />
  </HeaderActionsSlotProvider>);
  openMenu();
  const items = await screen.findAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual(["Back", "Print"]);
  expect(document.querySelector("[data-header-menu-slot] [data-view-print]")).not.toBeNull();
});

it("drops a view's item when the view unmounts", async () => {
  const { rerender } = render(<HeaderActionsSlotProvider>
    <DesktopDocumentMenu><DropdownMenuItem>Back</DropdownMenuItem></DesktopDocumentMenu>
    <HeaderActionsFill menuItems={<DropdownMenuItem>Print</DropdownMenuItem>} />
  </HeaderActionsSlotProvider>);
  rerender(<HeaderActionsSlotProvider>
    <DesktopDocumentMenu><DropdownMenuItem>Back</DropdownMenuItem></DesktopDocumentMenu>
  </HeaderActionsSlotProvider>);
  openMenu();
  const items = await screen.findAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual(["Back"]);
});

type Hook = ReturnType<typeof useDesktopPrint>;
function HintProbe({ windows, bridge, onReady }: { windows: boolean; bridge: Parameters<typeof useDesktopPrint>[0]; onReady(hook: Hook): void }) {
  const hook = useDesktopPrint(bridge, windows);
  onReady(hook);
  return <div>{hook.hint}</div>;
}

it("shows the Windows preview hint while a print is in flight, then clears it", async () => {
  let finish: ((value: unknown) => void) | undefined;
  const bridge = { call: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
  let hook!: Hook;
  render(<HintProbe windows bridge={bridge} onReady={(next) => { hook = next; }} />);
  expect(screen.queryByTestId("print-preview-hint")).toBeNull();
  let pending!: Promise<unknown>;
  act(() => { pending = Promise.resolve(hook.port.print({ html: "<p>x</p>", title: "Doc.docx" })); });
  const hint = await screen.findByTestId("print-preview-hint");
  expect(hint).toHaveTextContent(i18n.t("officeDesktop.library.printPreviewHint"));
  expect(hint).toHaveAttribute("role", "status");
  expect(hint).toHaveClass("text-muted-foreground");
  await waitFor(() => expect(bridge.call).toHaveBeenCalledTimes(1));
  await act(async () => { finish!({ outcome: "printed" }); await pending; });
  expect(screen.queryByTestId("print-preview-hint")).toBeNull();
});

function pendingBridge(answers: Array<() => Promise<unknown>>) {
  return { call: vi.fn(() => answers.shift()!()) };
}
const printArgs = { html: "<p>x</p>", title: "Doc.docx" };

it("keeps the hint while the first dialog is open after a second Print is answered print_busy", async () => {
  let finish: ((value: unknown) => void) | undefined;
  const bridge = pendingBridge([() => new Promise((resolve) => { finish = resolve; }), async () => ({ outcome: "failed", reason: "print_busy" })]);
  let hook!: Hook;
  render(<HintProbe windows bridge={bridge} onReady={(next) => { hook = next; }} />);
  let first!: Promise<unknown>;
  act(() => { first = Promise.resolve(hook.port.print(printArgs)); });
  await screen.findByTestId("print-preview-hint");
  await act(async () => { expect(await hook.port.print(printArgs)).toEqual({ outcome: "failed", reason: "print_busy" }); });
  expect(screen.getByTestId("print-preview-hint")).toBeInTheDocument();
  await act(async () => { finish!({ outcome: "printed" }); await first; });
  expect(screen.queryByTestId("print-preview-hint")).toBeNull();
});

it("keeps the hint after a print_timeout until the window regains focus after the dialog", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  const bridge = pendingBridge([async () => ({ outcome: "failed", reason: "print_timeout" })]);
  let hook!: Hook;
  render(<HintProbe windows bridge={bridge} onReady={(next) => { hook = next; }} />);
  await act(async () => { await hook.port.print(printArgs); });
  expect(screen.getByTestId("print-preview-hint")).toBeInTheDocument();
  // The app window was already blurred by the dialog: its next focus means the dialog closed.
  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(screen.queryByTestId("print-preview-hint")).toBeNull();
});

it("clears a lingering hint when a later print settles with a real outcome, but not on print_busy", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const bridge = pendingBridge([async () => ({ outcome: "failed", reason: "print_timeout" }), async () => ({ outcome: "failed", reason: "print_busy" }), async () => ({ outcome: "cancelled" })]);
  let hook!: Hook;
  render(<HintProbe windows bridge={bridge} onReady={(next) => { hook = next; }} />);
  await act(async () => { await hook.port.print(printArgs); });
  await act(async () => { await hook.port.print(printArgs); });
  expect(screen.getByTestId("print-preview-hint")).toBeInTheDocument();
  // A focus without a prior blur is not the dialog closing.
  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(screen.getByTestId("print-preview-hint")).toBeInTheDocument();
  await act(async () => { await hook.port.print(printArgs); });
  expect(screen.queryByTestId("print-preview-hint")).toBeNull();
});

it("shows no hint off Windows", async () => {
  const bridge = { call: vi.fn(async () => ({ outcome: "printed" })) };
  let hook!: Hook;
  render(<HintProbe windows={false} bridge={bridge} onReady={(next) => { hook = next; }} />);
  await act(async () => { await hook.port.print({ html: "<p>x</p>", title: "Doc.docx" }); });
  expect(bridge.call).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("print-preview-hint")).toBeNull();
});

it("has no trigger when neither the host nor a view has an item", () => {
  render(<HeaderActionsSlotProvider><DesktopDocumentMenu>{null}</DesktopDocumentMenu></HeaderActionsSlotProvider>);
  expect(document.querySelector("[data-office-document-menu]")).toBeNull();
});

it("shows the trigger for a view's item alone", async () => {
  render(<HeaderActionsSlotProvider>
    <DesktopDocumentMenu>{null}</DesktopDocumentMenu>
    <HeaderActionsFill menuItems={<DropdownMenuItem>Print</DropdownMenuItem>} />
  </HeaderActionsSlotProvider>);
  openMenu();
  expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["Print"]);
});

it("ends a lingering hint after a short grace when the timeout lands on an already focused window", async () => {
  vi.useFakeTimers();
  try {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const bridge = pendingBridge([async () => ({ outcome: "failed", reason: "print_timeout" })]);
    let hook!: Hook;
    render(<HintProbe windows bridge={bridge} onReady={(next) => { hook = next; }} />);
    await act(async () => { await hook.port.print(printArgs); });
    expect(screen.getByTestId("print-preview-hint")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2999); });
    expect(screen.getByTestId("print-preview-hint")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByTestId("print-preview-hint")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("keeps waiting for the next focus when the window blurs during the grace", async () => {
  vi.useFakeTimers();
  try {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const bridge = pendingBridge([async () => ({ outcome: "failed", reason: "print_timeout" })]);
    let hook!: Hook;
    render(<HintProbe windows bridge={bridge} onReady={(next) => { hook = next; }} />);
    await act(async () => { await hook.port.print(printArgs); });
    act(() => { window.dispatchEvent(new Event("blur")); });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByTestId("print-preview-hint")).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(screen.queryByTestId("print-preview-hint")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
