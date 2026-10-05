import { describe, expect, it } from "vitest";
import { pptxEditorCapabilities } from "./pptx-editor-capabilities";

const none = { open: false, textEdit: false, transform: false, edit: false, printPort: null };

describe("pptxEditorCapabilities", () => {
  it("disables every unbound command with an i18n reason key, never a raw sentence", () => {
    const caps = pptxEditorCapabilities(undefined, none);
    for (const id of ["open", "edit-text", "edit-shape-image", "export-pdf", "speaker-notes", "animations", "charts", "tables"] as const) {
      const cap = caps[id];
      expect(typeof cap === "object" && cap.status).toBe("unavailable");
      expect(typeof cap === "object" ? cap.reason : "").toMatch(/^office\.pptx\.reasons\./);
    }
  });

  it("makes the panel commands available once an edit channel exists", () => {
    const caps = pptxEditorCapabilities(undefined, { ...none, edit: true });
    for (const id of ["speaker-notes", "animations", "charts", "tables"] as const) expect(caps[id]).toEqual({ status: "available" });
  });

  it("keeps a host-supplied capability over the derived one", () => {
    const caps = pptxEditorCapabilities({ charts: { status: "readonly" } }, { ...none, edit: true });
    expect(caps.charts).toEqual({ status: "readonly" });
  });
});
