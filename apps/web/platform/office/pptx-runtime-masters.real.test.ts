/** @vitest-environment node */
// UNI-939 T01 (B6) - slide master / layout edits on the REAL vendored engine
// (nothing mocked: @uniwork/office-upstream/pptx-renderer is the generated
// artifact, rebuilt with parseMasterPart). Each edit runs through the web
// runtime, survives undo/redo (reopen + journal replay), and is re-read from
// the saved bytes with the engine's own master parser.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openPptx, parseMasterPart } from "@uniwork/office-upstream/pptx-renderer";
import { listMasterPartInfos, type OpenedPptxLike, type PptxEdit } from "@uniwork/office-engine/pptx";
import { createWebPptxSessionRuntime } from "./pptx-runtime";

// vitest runs with cwd = apps/web.
const fixture = () => new Uint8Array(readFileSync(resolve(process.cwd(), "../../docs/office/g0/fixtures/files/slides/pptx-standard-business.pptx")));

type Archive = { readText(path: string): string | null };
const archiveOf = (opened: unknown): Archive => (opened as { archive: Archive }).archive;
const placeholders = (opened: unknown, part: string): string[] =>
  (((parseMasterPart(archiveOf(opened), part) as { elements?: Array<{ placeholder?: string }> } | null)?.elements ?? [])
    .map((element) => element.placeholder ?? "")
    .filter(Boolean));

async function openRuntime() {
  const runtime = createWebPptxSessionRuntime({ documentId: "masters" });
  const result = await runtime.open({ bytes: fixture(), documentId: "masters" });
  if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("fixture did not open: " + String(result.message));
  return { runtime, ref: result.document_model_ref };
}

describe("web PPTX runtime on the real engine - slide master edits (T01)", () => {
  it("lists real master/layout parts and elements through the rebuilt parser", async () => {
    const { runtime, ref } = await openRuntime();
    const parts = runtime.masterParts!(ref);
    expect(parts[0]?.kind).toBe("master");
    expect(parts.some((part) => part.kind === "layout")).toBe(true);
    const elements = runtime.masterElements!(ref, parts[0]!.partPath);
    expect(elements.length).toBeGreaterThan(0);
    expect(elements.some((element) => element.placeholder === "title")).toBe(true);
    await runtime.release(ref);
  }, 60_000);

  it("renames a layout, adds and removes placeholders, sets the title text style, and re-reads them from the saved bytes", async () => {
    const { runtime, ref } = await openRuntime();
    const parts = runtime.masterParts!(ref);
    const master = parts.find((part) => part.kind === "master")!.partPath;
    const layout = parts.find((part) => part.kind === "layout")!.partPath;
    const before = placeholders(await openPptx(fixture()), layout);

    const edits: PptxEdit[] = [
      { op: "master_rename", part: layout, name: "Renamed by UniWork" },
      { op: "master_add_placeholder", part: layout, placeholder: "pic", xPx: 40, yPx: 40, wPx: 200, hPx: 120 },
      { op: "master_set_text_style", part: master, placeholder: "title", sizePt: 37, bold: true, color: "#123456" },
    ];
    for (const edit of edits) await runtime.edit(ref, [edit]);
    expect(runtime.masterParts!(ref).find((part) => part.partPath === layout)?.name).toBe("Renamed by UniWork");
    expect(runtime.masterElements!(ref, layout).some((element) => element.placeholder === "pic")).toBe(true);

    // Remove one placeholder by slot and one by its parsed element id.
    await runtime.edit(ref, [{ op: "master_remove_placeholder", part: layout, placeholder: "pic" }]);
    const removable = runtime.masterElements!(ref, master).find((element) => element.placeholder === "dt" || element.placeholder === "ftr");
    if (removable) await runtime.edit(ref, [{ op: "master_delete_element", part: master, elementId: removable.id }]);

    // Id-addressed vendored ops resolve the durable "e_<cNvPr>" id across parses.
    const title = runtime.masterElements!(ref, master).find((element) => element.placeholder === "title")!;
    expect(title.id).toMatch(/^e_\d+$/);
    await runtime.edit(ref, [{ op: "master_edit_text", part: master, elementId: title.id, paragraphs: [{ runs: [{ text: "Master heading" }] }] }]);
    await runtime.edit(ref, [{ op: "master_set_fill", part: master, elementId: title.id, fill: "#ABCDEF" }]);

    // Undo + redo replay the whole journal on a reopened base.
    expect(await runtime.undo(ref)).toBe(true);
    expect(await runtime.redo(ref)).toBe(true);

    const value = runtime.snapshot(ref);
    const out = await runtime.serialize(ref, { snapshot: { generation: value.revision, fingerprint: "fp", value } });
    const reopened = (await openPptx(out.bytes)) as unknown as OpenedPptxLike;
    const savedParts = listMasterPartInfos(reopened);
    expect(savedParts.find((part) => part.partPath === layout)?.name).toBe("Renamed by UniWork");
    expect(placeholders(reopened, layout)).toEqual(before);
    if (removable) expect(placeholders(reopened, master)).not.toContain(removable.placeholder);
    const savedTitle = (parseMasterPart(archiveOf(reopened), master) as { elements: Array<{ placeholder?: string; text?: { paragraphs?: Array<{ runs?: Array<{ text?: string }> }> } }> }).elements.find((element) => element.placeholder === "title");
    expect(savedTitle?.text?.paragraphs?.[0]?.runs?.map((run) => run.text).join("")).toBe("Master heading");
    const masterXml = archiveOf(reopened).readText(master) ?? "";
    expect(masterXml).toContain('<a:srgbClr val="ABCDEF"/>');
    expect(masterXml).toMatch(/<p:titleStyle>[\s\S]*?<a:defRPr\b[^>]*\ssz="3700"[^>]*\sb="1"|<p:titleStyle>[\s\S]*?<a:defRPr\b[^>]*\sb="1"[^>]*\ssz="3700"/);
    expect(masterXml).toContain('<a:srgbClr val="123456"/>');
    await runtime.release(ref);
  }, 60_000);
});
