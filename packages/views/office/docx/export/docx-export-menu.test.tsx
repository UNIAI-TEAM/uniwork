import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocxCommandRuntime } from "../commands";
import { chooseItem } from "../../../test/menu-interactions";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DocxExportGroup } from "./docx-export-menu";

function runtime(): DocxCommandRuntime {
  return {
    docxExportReady: true,
    printDocx: vi.fn(() => true),
    exportDocxHtml: vi.fn(() => "<html></html>"),
    downloadDocxHtml: vi.fn(() => true),
  } as unknown as DocxCommandRuntime;
}

function renderGroup(options: { commands?: DocxCommandRuntime; ready?: boolean } = {}) {
  const commands = "commands" in options ? options.commands : runtime();
  const props: DocxToolbarGroupContext = {
    editor: {} as DocxToolbarGroupContext["editor"],
    coordinator: {} as DocxToolbarGroupContext["coordinator"],
    format: { docxExportReady: options.ready ?? true } as unknown as DocxToolbarGroupContext["format"],
    commands,
    selection: null,
    readOnly: false,
    saving: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
  render(<DocxExportGroup {...props} />);
  return { commands };
}

async function openMenu() {
  fireEvent.click(screen.getByTestId("docx-export-menu"));
  return screen.findByRole("menu");
}

describe("DocxExportGroup", () => {
  it("disables the entry without a command runtime", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByTestId("docx-export-menu")).toBeDisabled();
  });

  it("disables the entry while no document is open", () => {
    renderGroup({ ready: false });
    expect(screen.getByTestId("docx-export-menu")).toBeDisabled();
  });

  it("prints from the menu", async () => {
    const { commands } = renderGroup();
    const menu = await openMenu();
    await chooseItem(menu, "In", "mouse");
    expect(commands?.printDocx).toHaveBeenCalledTimes(1);
  });

  it("downloads the standalone HTML from the menu", async () => {
    const { commands } = renderGroup();
    const menu = await openMenu();
    await chooseItem(menu, "Xuất HTML", "mouse");
    expect(commands?.downloadDocxHtml).toHaveBeenCalledWith("tài liệu", "Tài liệu");
  });

  it("opens the PDF guidance dialog and routes its print action", async () => {
    const { commands } = renderGroup();
    const menu = await openMenu();
    await chooseItem(menu, "Xuất PDF", "mouse");
    expect(screen.getByTestId("docx-export-pdf-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("docx-export-pdf-print"));
    expect(commands?.printDocx).toHaveBeenCalledTimes(1);
  });
});
