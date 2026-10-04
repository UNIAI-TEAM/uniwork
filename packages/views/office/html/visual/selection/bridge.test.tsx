import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HtmlVisualShell } from "../shell";
import { HTML_SELECTION_FLAG, type HtmlSelection } from "./model";
import type { IsolatedPreviewPort, PreviewSession } from "../../../source-editor-types";

/** A mutable flag mock, the pattern document-file-view.test.tsx uses: the
 * suite flips the key and the shell re-reads it on the next render. */
const flagMock = vi.hoisted(() => ({ value: false }));
vi.mock("@uniwork/core/feature-flags", () => ({
  useFlag: (key: string, fallback: boolean) => (key === "office_html_visual_selection" ? flagMock.value : fallback),
}));

initI18n();
beforeEach(async () => {
  flagMock.value = false;
  await setLocale("en");
});

/** A preview port that captures the shell's forwarded events and hands back a
 * session whose inspector records any command the bridge might send. */
function previewPort() {
  const forwarded: ((event: { type: string }) => void)[] = [];
  const command = vi.fn();
  const mount = vi.fn(async (options: { onEvent?: (event: { type: string }) => void }): Promise<PreviewSession> => {
    if (options.onEvent) forwarded.push(options.onEvent);
    return { dispose: vi.fn(), update: vi.fn(), inspector: { command, close: vi.fn() } } as unknown as PreviewSession;
  });
  return {
    port: { mount } as IsolatedPreviewPort,
    command,
    // The bridge forwards untrusted frame payloads: the helper accepts a raw
    // record, exactly as the preview port would hand one over.
    emit: (event: Record<string, unknown>) => forwarded.forEach((send) => send(event as { type: string })),
  };
}

function renderShell(preview: IsolatedPreviewPort, onPreviewSelection?: (selection: HtmlSelection | null) => void) {
  return render(
    <HtmlVisualShell
      documentKey="doc"
      text="<p>hi</p>"
      viewMode="preview"
      onViewModeChange={() => undefined}
      preview={preview}
      zoom={100}
      onZoomChange={() => undefined}
      onPreviewSelection={onPreviewSelection}
    />,
  );
}

/** Wait for the port to be mounted, so the captured onEvent is wired. */
async function ready() {
  await waitFor(() => expect(screen.getByTestId("html-preview")).toBeInTheDocument());
}

const SELECT = { type: "select", sid: 7 };
const RECT = { type: "rect", sid: 7, rect: { x: 10, y: 20, width: 30, height: 40 } };

describe("HtmlSelectionOverlay behind the flag", () => {
  it("renders nothing extra and publishes nothing while the flag is off", async () => {
    const onSelection = vi.fn();
    const { port, emit } = previewPort();
    renderShell(port, onSelection);
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));

    expect(screen.queryByTestId("html-selection-outline")).toBeNull();
    expect(screen.queryByTestId("html-selection-status")).toBeNull();
    expect(onSelection).not.toHaveBeenCalled();
  });

  it("draws the outline from a forwarded event when the flag is on", async () => {
    flagMock.value = true;
    const onSelection = vi.fn();
    const { port, emit, command } = previewPort();
    renderShell(port, onSelection);
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));

    const outline = screen.getByTestId("html-selection-outline");
    expect(outline).toHaveAttribute("data-selection-sid", "7");
    expect(outline).toHaveStyle({ left: "10px", top: "20px", width: "30px", height: "40px" });
    // Inert: it can never take a click, a drag or a focus from the document.
    expect(outline).toHaveAttribute("aria-hidden");
    expect(outline.className).toContain("pointer-events-none");
    // Read-only: no command is ever sent back to the inspector.
    expect(command).not.toHaveBeenCalled();
    expect(onSelection).toHaveBeenLastCalledWith({ sid: 7, rect: { x: 10, y: 20, width: 30, height: 40 }, nodeName: null });
  });

  it("publishes the sid as soon as it is selected, before any geometry arrives", async () => {
    flagMock.value = true;
    const onSelection = vi.fn();
    const { port, emit } = previewPort();
    renderShell(port, onSelection);
    await ready();

    act(() => emit(SELECT));

    expect(screen.queryByTestId("html-selection-outline")).toBeNull();
    expect(onSelection).toHaveBeenLastCalledWith({ sid: 7, rect: null, nodeName: null });
  });

  it("does not let hover clobber the committed selection", async () => {
    flagMock.value = true;
    const { port, emit } = previewPort();
    renderShell(port);
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));
    act(() => emit({ type: "hover", sid: 9 }));
    act(() => emit({ type: "rect", sid: 9, rect: { x: 1, y: 2, width: 3, height: 4 } }));

    const outline = screen.getByTestId("html-selection-outline");
    expect(outline).toHaveAttribute("data-selection-sid", "7");
    expect(outline).toHaveStyle({ left: "10px", top: "20px", width: "30px", height: "40px" });
  });

  it("ignores a malformed payload instead of painting from it", async () => {
    flagMock.value = true;
    const onSelection = vi.fn();
    const { port, emit } = previewPort();
    renderShell(port, onSelection);
    await ready();

    act(() => emit({ type: "select", sid: "<img src=x onerror=alert(1)>" }));
    act(() => emit({ type: "rect", sid: 7, rect: { x: 0, y: 0, width: Number.NaN, height: 1 } }));
    act(() => emit({ type: "text-edit-commit", sid: 7, text: "edited" }));

    expect(screen.queryByTestId("html-selection-outline")).toBeNull();
    expect(onSelection).toHaveBeenLastCalledWith(null);
  });

  it("clears the outline and reports null when the selection is dropped", async () => {
    flagMock.value = true;
    const onSelection = vi.fn();
    const { port, emit } = previewPort();
    renderShell(port, onSelection);
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));
    expect(screen.getByTestId("html-selection-outline")).toBeInTheDocument();

    act(() => emit({ type: "select", sid: null }));

    expect(screen.queryByTestId("html-selection-outline")).toBeNull();
    expect(onSelection).toHaveBeenLastCalledWith(null);
  });

  it("announces the selection to assistive technology, translated", async () => {
    flagMock.value = true;
    const { port, emit } = previewPort();
    renderShell(port);
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));

    // The announcement text is a locale key H5 does not own (see the task's
    // MISSING KEY list); the a11y contract - a polite live region bound to the
    // selected element - is what this pins.
    const status = screen.getByTestId("html-selection-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("data-selection-sid", "7");
  });

  it("still forwards every event to the caller's own onPreviewEvent", async () => {
    flagMock.value = true;
    const onPreviewEvent = vi.fn();
    const { port, emit } = previewPort();
    render(
      <HtmlVisualShell
        documentKey="doc"
        text="<p>hi</p>"
        viewMode="preview"
        onViewModeChange={() => undefined}
        preview={port}
        zoom={100}
        onZoomChange={() => undefined}
        onPreviewEvent={onPreviewEvent}
      />,
    );
    await ready();

    act(() => emit(SELECT));

    expect(onPreviewEvent).toHaveBeenCalledWith(SELECT);
  });
});

describe("the flag key", () => {
  it("is the key the lead must register", () => {
    expect(HTML_SELECTION_FLAG).toBe("office_html_visual_selection");
  });
});
