import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocxCommandRuntime } from "../commands";
import { InsertLinksGroup } from "../toolbar/groups/insert-links";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import type { DocxLinkSeed, DocxLinkTarget } from "./index";
import { createDocxDocumentScope } from "../editor-store";

const ACTIVE: DocxLinkTarget = { from: 1, to: 6, href: "https://uniwork.vn", rId: null, text: "UniWork", tooltip: null };

function runtime(seed: DocxLinkSeed): DocxCommandRuntime {
  return {
    linkSeed: vi.fn(() => seed),
    applyLink: vi.fn(() => true),
    removeLink: vi.fn(() => true),
  } as unknown as DocxCommandRuntime;
}

function renderGroup(
  options: { seed?: DocxLinkSeed; activeLink?: DocxLinkTarget; readOnly?: boolean; commands?: DocxCommandRuntime } = {},
) {
  const seed = options.seed ?? { link: null, selectionText: "UniWork" };
  const commands = "commands" in options ? options.commands : runtime(seed);
  const props: DocxToolbarGroupContext = {
    docScope: createDocxDocumentScope(),
    editor: {} as unknown as DocxToolbarGroupContext["editor"],
    coordinator: {} as unknown as DocxToolbarGroupContext["coordinator"],
    format: options.activeLink ? ({ activeLink: options.activeLink } as unknown as DocxToolbarGroupContext["format"]) : null,
    commands,
    selection: null,
    readOnly: options.readOnly ?? false,
    saving: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
  render(<InsertLinksGroup {...props} />);
  return { commands };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InsertLinksGroup", () => {
  it("opens the insert dialog pre-filled from the selection and applies the link", () => {
    const { commands } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Chèn liên kết" }));
    expect(screen.getByTestId("docx-link-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("docx-link-text")).toHaveValue("UniWork");
    fireEvent.change(screen.getByTestId("docx-link-url"), { target: { value: "https://uniwork.vn" } });
    fireEvent.click(screen.getByTestId("docx-link-submit"));
    expect(commands?.applyLink).toHaveBeenCalledWith({ href: "https://uniwork.vn", text: "UniWork", tooltip: null });
    expect(screen.queryByTestId("docx-link-dialog")).not.toBeInTheDocument();
  });

  it("shows the chip inside a link and edits it through the dialog", () => {
    const seed: DocxLinkSeed = { link: ACTIVE, selectionText: "" };
    const { commands } = renderGroup({ seed, activeLink: ACTIVE });
    expect(screen.getByTestId("docx-link-chip-href")).toHaveTextContent("https://uniwork.vn");
    fireEvent.click(screen.getByRole("button", { name: "Sửa liên kết" }));
    expect(screen.getByTestId("docx-link-url")).toHaveValue("https://uniwork.vn");
    expect(screen.getByTestId("docx-link-text")).toHaveValue("UniWork");
    fireEvent.change(screen.getByTestId("docx-link-text"), { target: { value: "UniWork site" } });
    fireEvent.click(screen.getByTestId("docx-link-submit"));
    expect(commands?.applyLink).toHaveBeenCalledWith({ href: "https://uniwork.vn", text: "UniWork site", tooltip: null });
  });

  it("unlinks through the chip", () => {
    const { commands } = renderGroup({ seed: { link: ACTIVE, selectionText: "" }, activeLink: ACTIVE });
    fireEvent.click(screen.getByRole("button", { name: "Bỏ liên kết" }));
    expect(commands?.removeLink).toHaveBeenCalledTimes(1);
  });

  it("opens an allowlisted chip target in a new tab", () => {
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    renderGroup({ seed: { link: ACTIVE, selectionText: "" }, activeLink: ACTIVE });
    fireEvent.click(screen.getByRole("button", { name: "Mở liên kết" }));
    expect(spy).toHaveBeenCalledWith("https://uniwork.vn", "_blank", "noopener,noreferrer");
  });

  it("never opens a hostile scheme from the chip", () => {
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    const hostile: DocxLinkTarget = { ...ACTIVE, href: "javascript:alert(1)" };
    renderGroup({ seed: { link: hostile, selectionText: "" }, activeLink: hostile });
    fireEvent.click(screen.getByRole("button", { name: "Mở liên kết" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("disables insert without a command runtime", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByRole("button", { name: "Chèn liên kết" })).toBeDisabled();
  });

  it("disables insert on a read-only document", () => {
    renderGroup({ readOnly: true });
    expect(screen.getByRole("button", { name: "Chèn liên kết" })).toBeDisabled();
  });

  it("keeps Open and Copy live while Edit and Remove disable on a read-only document", () => {
    renderGroup({ seed: { link: ACTIVE, selectionText: "" }, activeLink: ACTIVE, readOnly: true });
    expect(screen.getByRole("button", { name: "Mở liên kết" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sao chép liên kết" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sửa liên kết" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bỏ liên kết" })).toBeDisabled();
  });
});
