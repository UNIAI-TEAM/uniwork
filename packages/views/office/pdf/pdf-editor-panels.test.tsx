import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfEditorPanels } from "./pdf-editor-panels";
import type { PdfPageBoxOperationProvider } from "./page-box";

function pageBoxProvider(): PdfPageBoxOperationProvider {
  return { setPageBox: vi.fn(async () => undefined), setNUp: vi.fn(async () => undefined) };
}

describe("PdfEditorPanels", () => {
  it("renders nothing while no panel is active", () => {
    render(<PdfEditorPanels activePanel={null} />);
    expect(screen.queryByTestId("pdf-editor-panels")).not.toBeInTheDocument();
  });

  it("renders nothing when the active panel has no props bag", () => {
    render(<PdfEditorPanels activePanel="text" slots={{}} />);
    expect(screen.queryByTestId("pdf-editor-panels")).not.toBeInTheDocument();
  });

  it("mounts the active panel with the shell's own props", () => {
    render(<PdfEditorPanels activePanel="notes" slots={{ notes: { threads: [] } }} />);
    const host = screen.getByTestId("pdf-editor-panels");
    expect(host).toHaveAttribute("data-active-panel", "notes");
    expect(screen.getByTestId("pdf-notes-panel")).toBeInTheDocument();
  });

  it("renders only the active panel even when several props bags are supplied", () => {
    render(
      <PdfEditorPanels
        activePanel="forms"
        slots={{ forms: { fields: [] }, notes: { threads: [] } }}
      />,
    );
    expect(screen.getByTestId("pdf-forms-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-notes-panel")).not.toBeInTheDocument();
  });

  it("asks the shell to clear the active panel from the close control", () => {
    const onActivePanelChange = vi.fn();
    render(
      <PdfEditorPanels
        activePanel="markups"
        onActivePanelChange={onActivePanelChange}
        slots={{ markups: { selection: null, onMarkup: vi.fn() } }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(onActivePanelChange).toHaveBeenCalledWith(null);
  });

  it("mounts modal panels from their own slot and hides them until open", async () => {
    const onOpenChange = vi.fn();
    const pageSize = (open: boolean) => ({ open, pages: [1], provider: pageBoxProvider(), onOpenChange });
    const view = render(<PdfEditorPanels activePanel={null} slots={{ pageSize: pageSize(false) }} />);
    expect(screen.queryByTestId("pdf-page-size-dialog")).not.toBeInTheDocument();
    view.rerender(<PdfEditorPanels activePanel={null} slots={{ pageSize: pageSize(true) }} />);
    expect(await screen.findByTestId("pdf-page-size-dialog")).toBeInTheDocument();
  });
});
