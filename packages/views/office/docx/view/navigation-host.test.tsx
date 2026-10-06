// UNI-924 A6-wire: the navigation host reads the rendered document's top-level
// headings, keeps the outline fresh while the pane is open and scrolls the very
// heading element the clicked item was extracted from.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { createDocxDocumentScope, DocxDocumentScopeProvider } from "../editor-store";
import { DocxNavigationHost } from "./navigation-host";

/** The document root a DocxEditor provides (UNI-957): scope + its root element. */
function ScopedRoot({ children, testId }: { children: ReactNode; testId?: string }) {
  const [scope] = useState(createDocxDocumentScope);
  return (
    <DocxDocumentScopeProvider scope={scope}>
      <div data-testid={testId} ref={(node) => { scope.root.current = node; }}>{children}</div>
    </DocxDocumentScopeProvider>
  );
}

function Fixture({ onClose }: { onClose?: () => void } = {}) {
  return (
    <ScopedRoot testId="docx-editor">
      <div data-testid="docx-document-surface">
        <div className="doc-zoom">
          <div className="page-wrap">
            <div className="doc-page" data-testid="doc-page">
              <h1>One</h1>
              <p>body</p>
              <h2>One A</h2>
              <h1>Two</h1>
            </div>
          </div>
        </div>
      </div>
      <DocxNavigationHost onClose={onClose} />
    </ScopedRoot>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DocxNavigationHost", () => {
  it("lists the rendered headings with their nesting", () => {
    render(<Fixture />);
    const items = screen.getAllByRole("treeitem");
    expect(items.map((item) => item.textContent)).toEqual(["One", "One A", "Two"]);
    expect(screen.getByRole("treeitem", { name: "One A" })).toHaveAttribute("aria-level", "2");
  });

  it("scrolls the clicked heading element", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    render(<Fixture />);
    fireEvent.click(screen.getByRole("treeitem", { name: "One A" }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("picks up headings added after mount", async () => {
    render(<Fixture />);
    const page = screen.getByTestId("doc-page");
    act(() => {
      const heading = document.createElement("h3");
      heading.textContent = "Three";
      page.appendChild(heading);
    });
    await waitFor(() => expect(screen.getByRole("treeitem", { name: "Three" })).toBeInTheDocument());
  });

  it("refreshes the label when heading text changes", async () => {
    render(<Fixture />);
    const page = screen.getByTestId("doc-page");
    act(() => {
      (page.querySelector("h1")?.firstChild as Text).textContent = "Uno";
    });
    await waitFor(() => expect(screen.getByRole("treeitem", { name: "Uno" })).toBeInTheDocument());
  });

  it("shows the empty state when the rendered document has no headings", () => {
    render(
      <ScopedRoot>
        <div data-testid="docx-document-surface">
          <div className="doc-page" data-testid="plain-doc-page">
            <p>body</p>
          </div>
        </div>
        <DocxNavigationHost />
      </ScopedRoot>,
    );
    expect(screen.getByTestId("docx-navigation-empty")).toBeInTheDocument();
  });

  it("ignores a .doc-page outside the mounted surface", () => {
    render(
      <ScopedRoot>
        <div className="doc-page">
          <h1>Other editor</h1>
        </div>
        <DocxNavigationHost />
      </ScopedRoot>,
    );
    expect(screen.getByTestId("docx-navigation-empty")).toBeInTheDocument();
  });

  it("forwards the close affordance", () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Đóng ngăn điều hướng" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
