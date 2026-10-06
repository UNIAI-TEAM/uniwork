// UNI-924 A6-wire: the chrome mount attaches the shared zoom controller to the
// live surface and draws the read-only ruler from the geometry the pagination
// driver paints on `.doc-zoom`.
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { createDocxDocumentScope, DocxDocumentScopeProvider } from "../editor-store";
import { DocxViewChrome } from "./docx-view-chrome";
import { DOCX_ZOOM_CSS_VAR } from "./zoom-factor";
import {
  DOCX_ZOOM_DATA_ATTRIBUTE,
  createDocxZoomController,
  type DocxZoomController,
} from "./zoom-controller";

/** The document root a DocxEditor provides (UNI-957): scope + its root element. */
function ScopedRoot({ children, testId }: { children: ReactNode; testId?: string }) {
  const [scope] = useState(createDocxDocumentScope);
  return (
    <DocxDocumentScopeProvider scope={scope}>
      <div data-testid={testId} ref={(node) => { scope.root.current = node; }}>{children}</div>
    </DocxDocumentScopeProvider>
  );
}

function Fixture({ controller, version = 1 }: { controller: DocxZoomController; version?: number }) {
  return (
    <ScopedRoot testId="docx-editor">
      <div data-testid="docx-canvas">
        <DocxViewChrome controller={controller} />
        <div data-testid="docx-document-surface">
          <div className="doc-zoom" key={version}>
            <div className="page-wrap">
              <div className="doc-page">
                <h1>One</h1>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScopedRoot>
  );
}

function zoomElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="docx-document-surface"] .doc-zoom');
  if (!element) throw new Error("doc-zoom element missing");
  return element;
}

function paintGeometry(): void {
  const element = zoomElement();
  element.style.setProperty("--page-w", "816px");
  element.style.setProperty("--page-h", "1056px");
  element.style.setProperty("--page-pad", "96px 96px 96px 96px");
}

describe("DocxViewChrome", () => {
  it("attaches the controller to the mounted surface and clears it on unmount", () => {
    const controller = createDocxZoomController();
    const view = render(<Fixture controller={controller} />);
    const element = zoomElement();

    expect(element).toHaveAttribute(DOCX_ZOOM_DATA_ATTRIBUTE, "");
    expect(element.style.getPropertyValue(DOCX_ZOOM_CSS_VAR)).toBe("1");

    view.unmount();
    expect(element).not.toHaveAttribute(DOCX_ZOOM_DATA_ATTRIBUTE);
    expect(element.style.getPropertyValue(DOCX_ZOOM_CSS_VAR)).toBe("");
    controller.dispose();
  });

  it("draws no ruler until the pagination geometry lands, then follows it and the zoom", async () => {
    const controller = createDocxZoomController();
    render(<Fixture controller={controller} />);
    expect(screen.queryByTestId("docx-ruler")).toBeNull();

    act(() => {
      paintGeometry();
    });
    expect(await screen.findByTestId("docx-ruler")).toHaveStyle({ width: "816px" });

    act(() => {
      controller.setPercent(125);
    });
    expect(screen.getByTestId("docx-ruler")).toHaveStyle({ width: "1020px" });
    controller.dispose();
  });

  it("re-attaches when the surface element is replaced", async () => {
    const controller = createDocxZoomController();
    const view = render(<Fixture controller={controller} />);
    const first = zoomElement();

    view.rerender(<Fixture controller={controller} version={2} />);
    await waitFor(() => {
      const next = zoomElement();
      expect(next).not.toBe(first);
      expect(next.style.getPropertyValue(DOCX_ZOOM_CSS_VAR)).toBe("1");
    });
    expect(first.style.getPropertyValue(DOCX_ZOOM_CSS_VAR)).toBe("");
    controller.dispose();
  });
});
