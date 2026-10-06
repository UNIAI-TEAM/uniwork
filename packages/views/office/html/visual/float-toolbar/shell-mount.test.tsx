// @vitest-environment jsdom
/**
 * The H6 toolbar mounted through the real shell: the H5 bridge forwards a
 * selection, the shell holds it and renders `HtmlFloatToolbar` in the overlay
 * region. These cases pin the integration the component tests cannot see -
 * that the toolbar is wired to the shell's event stream, that it appears only
 * when the flag is on AND a renderable rect has arrived, and that a click
 * reaches the caller's injected command.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HtmlVisualShell } from "../shell";
import type { HtmlFloatToolbarCommands } from "./float-toolbar";
import type { IsolatedPreviewPort, PreviewSession } from "../../../source-editor-types";

const flagMock = vi.hoisted(() => ({ value: false }));
vi.mock("@uniwork/core/feature-flags", () => ({
  useFlag: (key: string, fallback: boolean) => (key === "office_html_visual_edit" ? flagMock.value : fallback),
}));

initI18n();
beforeEach(async () => {
  flagMock.value = false;
  await setLocale("en");
});

function previewPort() {
  const forwarded: ((event: { type: string }) => void)[] = [];
  const mount = vi.fn(async (options: { onEvent?: (event: { type: string }) => void }): Promise<PreviewSession> => {
    if (options.onEvent) forwarded.push(options.onEvent);
    return { dispose: vi.fn(), update: vi.fn(), inspector: { command: vi.fn(), close: vi.fn() } } as unknown as PreviewSession;
  });
  return {
    port: { mount } as IsolatedPreviewPort,
    emit: (event: Record<string, unknown>) => forwarded.forEach((send) => send(event as { type: string })),
  };
}

function commands(): Required<HtmlFloatToolbarCommands> {
  return {
    onBold: vi.fn(),
    onItalic: vi.fn(),
    onFontSizeIncrease: vi.fn(),
    onFontSizeDecrease: vi.fn(),
    onColour: vi.fn(),
    onEditText: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onOpenStylePanel: vi.fn(),
  };
}

function renderShell(preview: IsolatedPreviewPort, floatCommands?: HtmlFloatToolbarCommands) {
  return render(
    <HtmlVisualShell
      documentKey="doc"
      text="<p>hi</p>"
      viewMode="preview"
      onViewModeChange={() => undefined}
      preview={preview}
      zoom={100}
      floatCommands={floatCommands}
    />,
  );
}

async function ready() {
  await waitFor(() => expect(screen.getByTestId("html-preview")).toBeInTheDocument());
}

const SELECT = { type: "select", sid: 7 };
const RECT = { type: "rect", sid: 7, rect: { x: 10, y: 20, width: 30, height: 40 } };

function action(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-float-action="${id}"]`);
  if (!found) throw new Error(`float action ${id} not found`);
  return found;
}

describe("HtmlFloatToolbar through the shell overlay", () => {
  it("is absent with the flag off, and nothing the bridge forwards changes that", async () => {
    const { port, emit } = previewPort();
    renderShell(port, commands());
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));

    expect(screen.queryByTestId("html-float-toolbar")).toBeNull();
  });

  it("appears once the flag is on AND a rect has arrived, at the selection rect", async () => {
    flagMock.value = true;
    const { port, emit } = previewPort();
    renderShell(port, commands());
    await ready();

    // A select with no geometry yet: still nothing to anchor to.
    act(() => emit(SELECT));
    expect(screen.queryByTestId("html-float-toolbar")).toBeNull();

    act(() => emit(RECT));
    const toolbar = screen.getByTestId("html-float-toolbar");
    // box (10,20) 30x40 at zoom 100, no frame offset. There is no room above
    // the box, so the toolbar flips below it: centre 25, top 20 + 40 + 8 = 68.
    expect(toolbar).toHaveStyle({ left: "25px", top: "68px" });
    expect(toolbar).toHaveAttribute("data-float-placement", "below");
    expect(toolbar).toHaveAttribute("data-selection-sid", "7");
  });

  it("disappears when the selection is dropped", async () => {
    flagMock.value = true;
    const { port, emit } = previewPort();
    renderShell(port, commands());
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));
    expect(screen.getByTestId("html-float-toolbar")).toBeInTheDocument();

    act(() => emit({ type: "select", sid: null }));
    expect(screen.queryByTestId("html-float-toolbar")).toBeNull();
  });

  it("paints nothing from a malformed rect", async () => {
    flagMock.value = true;
    const { port, emit } = previewPort();
    renderShell(port, commands());
    await ready();

    act(() => emit({ type: "select", sid: 7 }));
    act(() => emit({ type: "rect", sid: 7, rect: { x: 0, y: 0, width: Number.NaN, height: 10 } }));

    expect(screen.queryByTestId("html-float-toolbar")).toBeNull();
  });

  it("routes a click to the caller's injected command", async () => {
    flagMock.value = true;
    const c = commands();
    const { port, emit } = previewPort();
    renderShell(port, c);
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));

    fireEvent.click(action("bold"));
    expect(c.onBold).toHaveBeenCalledOnce();
    fireEvent.click(action("delete"));
    expect(c.onDelete).toHaveBeenCalledOnce();
    // The shell itself applies no op: the only thing that happened is the
    // callback the caller injected.
    expect(c.onDuplicate).not.toHaveBeenCalled();
  });
});
