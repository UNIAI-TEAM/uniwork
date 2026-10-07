// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { HtmlVisualShell } from "./shell";
import type { IsolatedPreviewPort, PreviewSession } from "../../source-editor-types";

initI18n();

const preview = {
  mount: vi.fn(async (): Promise<PreviewSession> => ({ dispose: vi.fn(), update: vi.fn() }) as unknown as PreviewSession),
} as unknown as IsolatedPreviewPort;

function shell(viewMode: "split" | "source") {
  return (
    <HtmlVisualShell
      documentKey="d"
      text="<p>x</p>"
      viewMode={viewMode}
      onViewModeChange={() => undefined}
      preview={preview}
      zoom={100}
      overlay={<div data-testid="ov" />}
      sidePanel={<div data-testid="side" />}
    />
  );
}

describe("shell side panel", () => {
  it("sits in the flow beside the preview, not inside the overlay slot", () => {
    render(shell("split"));
    const side = screen.getByTestId("html-side-panel");
    expect(side.contains(screen.getByTestId("side"))).toBe(true);
    expect(side.contains(screen.getByTestId("ov"))).toBe(false);
    // After the preview scroll pane in document order: beside it, never over it.
    const preview = screen.getByTestId("html-preview-scroll");
    expect(preview.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(side.className).not.toContain("absolute");
  });

  it("renders nothing without a preview on screen", () => {
    render(shell("source"));
    expect(screen.queryByTestId("html-side-panel")).toBeNull();
  });
});
