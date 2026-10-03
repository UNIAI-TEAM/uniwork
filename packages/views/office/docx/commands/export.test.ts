import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { createDocxCommandRuntime } from "./index";
import { createExportCommands } from "./export";

const DOC = {
  type: "doc",
  content: [{ type: "docParagraph", attrs: {}, content: [{ type: "text", text: "Hello" }] }],
};

function stubEditor(overrides: Partial<Editor> = {}): Editor {
  return {
    isDestroyed: false,
    getJSON: () => DOC,
    ...overrides,
  } as unknown as Editor;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("createExportCommands", () => {
  it("reports readiness only for a live editor", () => {
    const area = createExportCommands({ getEditor: () => stubEditor() });
    expect(area.readState(stubEditor())).toEqual({ docxExportReady: true });
    expect(area.readState(stubEditor({ isDestroyed: true } as Partial<Editor>))).toEqual({ docxExportReady: false });
    expect(area.readState(null)).toEqual({ docxExportReady: false });
  });

  it("serializes the live document to standalone HTML", () => {
    const area = createExportCommands({ getEditor: () => stubEditor() });
    const html = area.commands.exportDocxHtml("Tài liệu");
    expect(html).toContain("<article class=\"docx-export\"");
    expect(html).toContain("<p>Hello</p>");
    expect(html).toContain("<title>Tài liệu</title>");
  });

  it("returns null when no document is open", () => {
    const area = createExportCommands({ getEditor: () => null });
    expect(area.commands.exportDocxHtml()).toBeNull();
    expect(area.commands.downloadDocxHtml("document")).toBe(false);
    expect(area.commands.printDocx()).toBe(false);
  });

  it("prints through the browser dialog when a surface is mounted", () => {
    const surface = document.createElement("div");
    surface.setAttribute("data-testid", "docx-document-surface");
    document.body.appendChild(surface);
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const area = createExportCommands({ getEditor: () => stubEditor() });
    expect(area.commands.printDocx()).toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("downloads the serialized file through a blob", () => {
    const captured: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      captured.push(this);
    });
    const url = URL as typeof URL & { createObjectURL: (blob: Blob) => string; revokeObjectURL: (value: string) => void };
    const createObjectURL = vi.fn(() => "blob:docx-export");
    const revokeObjectURL = vi.fn();
    url.createObjectURL = createObjectURL;
    url.revokeObjectURL = revokeObjectURL;
    try {
      const area = createExportCommands({ getEditor: () => stubEditor() });
      expect(area.commands.downloadDocxHtml("tài liệu", "Tài liệu")).toBe(true);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:docx-export");
      expect(captured).toHaveLength(1);
      expect(captured[0]?.download).toBe("tài liệu.html");
    } finally {
      delete (url as { createObjectURL?: unknown }).createObjectURL;
      delete (url as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });
});

describe("export command wiring", () => {
  it("composes into the command runtime with its own format state", () => {
    const runtime = createDocxCommandRuntime(() => stubEditor(), { areas: [createExportCommands] });
    expect(runtime.getState().docxExportReady).toBe(true);
    expect(typeof runtime.exportDocxHtml).toBe("function");
    expect(typeof runtime.downloadDocxHtml).toBe("function");
    expect(typeof runtime.printDocx).toBe("function");
  });

  it("reports not ready through the runtime without a document", () => {
    const runtime = createDocxCommandRuntime(() => null, { areas: [createExportCommands] });
    expect(runtime.getState().docxExportReady).toBe(false);
  });
});
