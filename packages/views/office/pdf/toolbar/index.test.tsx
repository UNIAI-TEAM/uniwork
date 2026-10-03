import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { PDF_COMMANDS } from "../pdf-command-map";
import { PdfToolbarShell, type PdfToolbarCommand } from "./index";

const command = (id: PdfToolbarCommand["id"], label?: string, onExecute = vi.fn()): PdfToolbarCommand => ({ id, label: label ?? id, onExecute });

describe("PdfToolbarShell", () => {
  it("renders the five ribbon tabs and changes tabs with keyboard navigation", async () => {
    render(<PdfToolbarShell commands={[command(PDF_COMMANDS.annotations, "Annotate")]} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    expect(screen.getByTestId("pdf-toolbar-shell")).toHaveAttribute("data-active-tab", "home");

    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(screen.getByTestId("pdf-toolbar-shell")).toHaveAttribute("data-active-tab", "annotate");
    expect(screen.getByRole("button", { name: "Annotate" })).toBeInTheDocument();

    await setLocale("en");
    expect(screen.getByRole("tab", { name: "Home" })).toBeInTheDocument();
  });

  it("moves excess commands into an accessible More menu", () => {
    const onExecute = vi.fn();
    render(
      <PdfToolbarShell
        maxVisibleCommands={1}
        commands={[command(PDF_COMMANDS.undo, "Undo", onExecute), command(PDF_COMMANDS.redo, "Redo", onExecute), command(PDF_COMMANDS.save, "Save", onExecute)]}
      />,
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Redo" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pdf-toolbar-more"));
    expect(screen.getByRole("menuitem", { name: "Redo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Save" }));
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it("routes command clicks and supports controlled tabs", () => {
    const onExecute = vi.fn();
    const onTabChange = vi.fn();
    render(<PdfToolbarShell activeTab="edit" onTabChange={onTabChange} commands={[command(PDF_COMMANDS.editText, "Edit text", onExecute)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit text" }));
    expect(onExecute).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("pdf-toolbar-tab-pages"));
    expect(onTabChange).toHaveBeenCalledWith("pages");
    expect(screen.getByTestId("pdf-toolbar-shell")).toHaveAttribute("data-active-tab", "edit");
  });
});
