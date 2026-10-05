import { describe, expect, it } from "vitest";
import { pptxEditorCapabilities } from "./pptx-editor-capabilities";

const none = { open: false, textEdit: false, transform: false, edit: false, printPort: null };

describe("pptxEditorCapabilities", () => {
  it("disables every unbound command with an i18n reason key, never a raw sentence", () => {
    const caps = pptxEditorCapabilities(undefined, none);
    for (const id of ["open", "edit-text", "edit-shape-image", "export-pdf", "animations", "charts", "tables"] as const) {
      const cap = caps[id];
      expect(typeof cap === "object" && cap.status).toBe("unavailable");
      expect(typeof cap === "object" ? cap.reason : "").toMatch(/^office\.pptx\.reasons\./);
    }
  });

  it("makes the panel commands available once an edit channel exists", () => {
    const caps = pptxEditorCapabilities(undefined, { ...none, edit: true });
    for (const id of ["speaker-notes", "animations", "charts", "tables"] as const) expect(caps[id]).toEqual({ status: "available" });
  });

  it("keeps Speaker notes usable on a read-only host: the pane reads, only writing is refused (W9 review F3)", () => {
    expect(pptxEditorCapabilities(undefined, none)["speaker-notes"]).toEqual({ status: "available" });
  });

  it("keeps a host-supplied capability over the derived one", () => {
    const caps = pptxEditorCapabilities({ charts: { status: "readonly" } }, { ...none, edit: true });
    expect(caps.charts).toEqual({ status: "readonly" });
  });
});

describe("pptxEditorCapabilities - commands the host can never run are hidden (R2-6)", () => {
  it("hides open, text, transform and print while their channel is unbound", () => {
    const caps = pptxEditorCapabilities(undefined, none);
    for (const id of ["open", "edit-text", "edit-shape-image", "export-pdf", "print"] as const) {
      expect(caps[id], id).toEqual(expect.objectContaining({ status: "unavailable", hidden: true }));
    }
  });

  it("keeps the state-dependent refusals visible with their reason", () => {
    const caps = pptxEditorCapabilities(undefined, none);
    for (const id of ["animations", "charts", "tables"] as const) {
      expect(caps[id], id).toEqual({ status: "unavailable", reason: "office.pptx.reasons.edit_unbound" });
    }
  });

  it("makes open, text, transform and both print commands available once bound", () => {
    const printPort = { available: true, mode: "browser" as const, print: async () => ({ outcome: "printed" as const, mode: "browser" as const }) };
    const caps = pptxEditorCapabilities(undefined, { open: true, textEdit: true, transform: true, edit: true, printPort });
    for (const id of ["open", "edit-text", "edit-shape-image", "export-pdf", "print"] as const) expect(caps[id], id).toEqual({ status: "available" });
  });

  it("hides print when the port has no surface to print from", () => {
    const printPort = { available: false, mode: "browser" as const, print: async () => ({ outcome: "failed" as const, reason: "x" }) };
    expect(pptxEditorCapabilities(undefined, { ...none, printPort }).print).toEqual(expect.objectContaining({ hidden: true }));
  });

  it("gives print its own reason key, not the PDF export one (X4fix F10)", () => {
    const caps = pptxEditorCapabilities(undefined, none);
    expect(caps.print).toEqual(expect.objectContaining({ reason: "office.pptx.reasons.print_unbound" }));
    expect(caps["export-pdf"]).toEqual(expect.objectContaining({ reason: "office.pptx.reasons.export_pdf_unbound" }));
  });

  it("keeps Text when only the in-place commit channel is bound: runnable over a text selection, disabled with a reason otherwise (X4fix F4)", () => {
    expect(pptxEditorCapabilities(undefined, { ...none, commitText: true, textSelected: true })["edit-text"]).toEqual({ status: "available" });
    expect(pptxEditorCapabilities(undefined, { ...none, commitText: true, textSelected: false })["edit-text"]).toEqual({
      status: "unavailable",
      reason: "office.pptx.reasons.edit_text_select",
    });
  });
});
