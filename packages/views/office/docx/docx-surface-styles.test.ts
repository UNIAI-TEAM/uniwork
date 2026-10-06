// T-01 (UNI-823 g3-04c): the vendored renderer sheet must be mounted once per
// document and the surface must mirror the upstream hierarchy the sheet keys
// on (.docx-surface > .workspace[.page-dark] > .editor-scroll > .doc-zoom >
// .page-wrap > .doc-page), so tables, list markers and the dark colour twins
// are actually painted instead of a plain, unstyled surface.
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { createDocxAdapter, type DocxBlock, type DocxEngineFunctions, type DocxParsed, type DocxSaveBlock } from "@uniwork/office-engine/docx";
import { DOCX_RENDERER_STYLE_ELEMENT_ID, installDocxRendererStyles } from "@uniwork/office-upstream/docs-renderer-editor";
import { createDocxTiptapHandle } from "./use-docx-tiptap-handle";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

function fakeEngine(): DocxEngineFunctions {
  return {
    async parseDocx(bytes) {
      const { blocks } = JSON.parse(decoder.decode(bytes.subarray(ZIP_MAGIC.length))) as { blocks: Array<Record<string, unknown>> };
      const withIndex: DocxBlock[] = blocks.map((b, i) => ({ ...b, type: String(b.type), docxIndex: i }) as DocxBlock);
      return { blocks: withIndex };
    },
    async saveDocx(parsed: DocxParsed, finalBlocks: DocxSaveBlock[]) {
      const out: Array<Record<string, unknown>> = [];
      for (const plan of finalBlocks) if (plan.kind === "original") out.push({ type: "paragraph", runs: [{ text: "kept" }] });
      for (const plan of finalBlocks) if (plan.kind === "generated") out.push({ type: plan.block.type, runs: plan.block.runs });
      for (const b of parsed.blocks) if (b.hidden) out.push(b as unknown as Record<string, unknown>);
      const payload = encoder.encode(JSON.stringify({ blocks: out }));
      const bytes = new Uint8Array(ZIP_MAGIC.length + payload.length);
      bytes.set(ZIP_MAGIC);
      bytes.set(payload, ZIP_MAGIC.length);
      return bytes;
    },
  };
}

function fixtureBytes(blocks: Array<Record<string, unknown>>): Uint8Array {
  const payload = encoder.encode(JSON.stringify({ blocks }));
  const bytes = new Uint8Array(ZIP_MAGIC.length + payload.length);
  bytes.set(ZIP_MAGIC);
  bytes.set(payload, ZIP_MAGIC.length);
  return bytes;
}

async function openHandle() {
  const adapter = createDocxAdapter({ engine: fakeEngine() });
  const handle = createDocxTiptapHandle({
    adapter,
    documentId: "doc-surface",
    readBytes: async () => fixtureBytes([{ type: "paragraph", runs: [{ text: "surface" }] }]),
  });
  await handle.open();
  return handle;
}

describe("DOCX renderer stylesheet (T-01)", () => {
  it("mounts the scoped renderer sheet exactly once", () => {
    installDocxRendererStyles();
    installDocxRendererStyles();
    const styles = document.querySelectorAll(`#${DOCX_RENDERER_STYLE_ELEMENT_ID}`);
    expect(styles).toHaveLength(1);
    const css = styles[0]?.textContent ?? "";
    // The stylesheet reaches the shim minified by the browser build.
    expect(css).toMatch(/@scope\(\.docx-surface\)/);
    expect(css).toContain(".doc-table");
    expect(css).toContain(".page-dark");
    expect(css).toContain(".dark .docx-surface");
    expect(css).not.toContain(":root");
  });

  it("renders the upstream surface hierarchy with the editor root as .doc-page", async () => {
    const handle = await openHandle();
    const surface = handle.renderSurface?.();
    if (surface === null || surface === undefined) throw new Error("docx_surface_missing");
    const view = render(surface as ReactElement);
    try {
      const root = view.container.querySelector(".docx-surface");
      expect(root).not.toBeNull();
      const pageWrap = root?.querySelector(":scope > .workspace > .editor-scroll > .doc-zoom.view-print > .page-wrap");
      expect(pageWrap).not.toBeNull();
      const scroll = root?.querySelector<HTMLElement>(":scope > .workspace > .editor-scroll");
      expect(scroll?.style.backgroundColor).toBe("var(--office-canvas)");
      expect(scroll?.style.backgroundAttachment).toBe("local");
      // TipTap's EditorContent renders one wrapper div around the ProseMirror
      // root (upstream mounts it the same way: <EditorContent editor={editor} />)
      // and .doc-page comes from editorProps on the ProseMirror element.
      expect(pageWrap?.querySelector(".doc-page.ProseMirror")).not.toBeNull();
      expect(root?.querySelector(".workspace.page-dark")).toBeNull();
    } finally {
      view.unmount();
    }
    await handle.dispose();
  });

  it("carries the page-dark class when the host theme class is set", async () => {
    const handle = await openHandle();
    const surface = handle.renderSurface?.();
    if (surface === null || surface === undefined) throw new Error("docx_surface_missing");
    document.documentElement.classList.add("dark");
    const view = render(surface as ReactElement);
    try {
      expect(view.container.querySelector(".docx-surface > .workspace.page-dark")).not.toBeNull();
    } finally {
      view.unmount();
      document.documentElement.classList.remove("dark");
    }
    await handle.dispose();
  });
});
