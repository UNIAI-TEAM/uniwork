import { sha256Hex, toProductCapabilities, type CapabilityEntry } from "@uniwork/office-contracts";
import { describe, expect, it } from "vitest";
import { fakeMarkdownUpstream, fakeStore, PNG_BYTES, utf8, type FakeStore } from "../assets/test-fakes";
import { createMarkdownEngine, findFrontmatter } from "./engine";

const engine = () => createMarkdownEngine({ upstream: fakeMarkdownUpstream() });

async function openRef(md: ReturnType<typeof engine>, bytes: Uint8Array, extra: Record<string, unknown> = {}) {
  const outcome = await md.open({ bytes, format: "md", document_id: "D1", ...extra });
  if (outcome.outcome !== "opened") throw new Error("open failed: " + outcome.failure_class);
  return outcome.document_model_ref;
}

async function reopen(md: ReturnType<typeof engine>, store: FakeStore, documentId: string) {
  const last = store.published.at(-1)!;
  const outcome = await md.open({ bytes: last.text_bytes, format: "md", document_id: documentId, asset_manifest: last.manifest });
  if (outcome.outcome !== "opened") throw new Error("reopen failed");
  return outcome.document_model_ref;
}

describe("markdown engine", () => {
  it("creates a blank document and saves it with no assets", async () => {
    const md = engine();
    const { document_model_ref: ref } = md.createBlank({ document_id: "D1" });
    const out = await md.serialize({ document_model_ref: ref, format: "md" });
    expect(out.bytes).toHaveLength(0);
    const store = fakeStore("D1");
    await md.save(ref, store);
    expect(store.published[0]!.manifest).toEqual({ version: 1, document_path: "document.md", entries: [] });
  });

  it("edits, saves and reopens twice with Vietnamese text and a spaced image path", async () => {
    const md = engine();
    const store = fakeStore("D1");
    let ref = md.createBlank({ document_id: "D1" }).document_model_ref;

    const asset = await md.addAsset(ref, { name: "ảnh chụp màn hình.png", bytes: PNG_BYTES });
    expect(asset).toEqual({ key: "assets/ảnh chụp màn hình.png", reference: "assets/ảnh chụp màn hình.png" });
    const first = "# Báo cáo tuần\n\nĐã hoàn thành việc kiểm thử.\n\n![Ảnh](<" + asset.reference + ">)\n";
    md.replaceText(ref, first);
    await md.save(ref, store);

    ref = await reopen(md, store, "D1");
    const snap1 = md.snapshot(ref);
    expect(snap1.text).toBe(first);
    expect(snap1.manifest.entries.map((e) => e.key)).toEqual(["assets/ảnh chụp màn hình.png"]);
    expect(store.committed.get("D1")!.get("assets/ảnh chụp màn hình.png")).toEqual(PNG_BYTES);

    const second = snap1.text + "\nThêm dòng thứ hai: ưu tiên cao — ổn định.\n";
    md.replaceText(ref, second);
    await md.save(ref, store);
    ref = await reopen(md, store, "D1");
    expect(md.snapshot(ref).text).toBe(second);
    expect(new TextDecoder().decode(store.published[1]!.text_bytes)).toBe(second);
    // The second save re-staged the committed image from the host, not from memory.
    expect(store.reads).toContain("assets/ảnh chụp màn hình.png");
    expect(store.committed.get("D1")!.get("assets/ảnh chụp màn hình.png")).toEqual(PNG_BYTES);
  });

  it("round-trips untouched bytes exactly: BOM, CRLF, NFD and frontmatter", async () => {
    const md = engine();
    const source = "---\r\ntitle: Kế hoạch\r\n---\r\n# Tiếu đề\r\n";
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(source)]);
    const ref = await openRef(md, bytes);
    const out = await md.serialize({ document_model_ref: ref, format: "md" });
    expect(out.bytes).toEqual(bytes);
    expect(out.checksum).toBe(await sha256Hex(bytes));
    expect(md.frontmatter(ref)).toEqual({ start: 0, end: source.indexOf("# ") });
  });

  it("preserves GFM tables, fenced code, raw HTML blocks and comments when editing elsewhere", async () => {
    const md = engine();
    const source = "---\ntitle: Keep\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst value = \"keep\";\n```\n\n<div data-keep=\"yes\">raw</div>\n<!-- comment -->\n";
    const ref = await openRef(md, utf8(source));
    md.replaceText(ref, source + "edited elsewhere\n");
    const out = await md.serialize({ document_model_ref: ref, format: "md" });
    expect(new TextDecoder().decode(out.bytes)).toBe(source + "edited elsewhere\n");
  });

  it("reports corrupted and oversized input as named open failures, never a blank", async () => {
    const md = engine();
    await expect(md.open({ bytes: new Uint8Array([0xc3, 0x28]), format: "md", document_id: "D1" })).resolves.toMatchObject({
      outcome: "failed",
      failure_class: "corrupted",
      document_id: "D1",
    });
    const big = new Uint8Array(64 * 1024 * 1024 + 1);
    await expect(md.open({ bytes: big, format: "md", document_id: "D1" })).resolves.toMatchObject({ failure_class: "too_large" });
  });

  it("does not publish, and keeps the session, when an asset fails after text serialisation", async () => {
    const md = engine();
    const store = fakeStore("D1");
    const ref = md.createBlank({ document_id: "D1" }).document_model_ref;
    const { reference } = await md.addAsset(ref, { name: "a.png", bytes: PNG_BYTES });
    md.replaceText(ref, "![a](" + reference + ")\n");
    const before = md.snapshot(ref);
    store.failStage = () => true;
    await expect(md.save(ref, store)).rejects.toMatchObject({ code: "commit_failed", fields: { reason: "asset_stage_failed" } });
    expect(store.published).toHaveLength(0);
    expect(md.snapshot(ref)).toEqual(before);
    // Retry after the fault clears: the session still holds the image bytes.
    store.failStage = undefined;
    await md.save(ref, store);
    expect(store.published).toHaveLength(1);
    expect(store.committed.get("D1")!.get("assets/a.png")).toEqual(PNG_BYTES);
  });

  it("treats the editor's imageSources as a hint, never as authority", async () => {
    const md = engine();
    const store = fakeStore("D1");
    const ref = md.createBlank({ document_id: "D1" }).document_model_ref;
    const result = md.acceptEditorText(ref, { text: "no images\n", imageSources: ["../../etc/passwd", "assets/x.png"] });
    expect(result.ignored_image_sources).toBe(2);
    await md.save(ref, store);
    expect(store.reads).toEqual([]);
    expect(store.staged).toEqual([]);
  });

  it("rebases save-as: rewrites only what would escape, keeps the rest byte-identical", async () => {
    const md = engine();
    const logo = PNG_BYTES;
    const local = new Uint8Array([...PNG_BYTES, 9]);
    const store = fakeStore("D1", { "shared/logo png.png": logo, "notes/assets/x.png": local });
    const manifest = {
      version: 1,
      document_path: "notes/a.md",
      entries: [
        { key: "shared/logo png.png", sha256: await sha256Hex(logo), byte_length: logo.length, media_type: "image/png", origin: "imported" },
        { key: "notes/assets/x.png", sha256: await sha256Hex(local), byte_length: local.length, media_type: "image/png", origin: "owned" },
      ],
    };
    const text = "Logo ![l](<../shared/logo png.png>) và ![x](assets/x.png) — ```\n![c](../shared/logo png.png)\n```\n";
    const ref = await openRef(md, utf8(text), { asset_manifest: manifest });
    const { report } = await md.saveAs(ref, { target_document_id: "D2", target_document_path: "b.md", ...store });

    const saved = new TextDecoder().decode(store.published[0]!.text_bytes);
    expect(saved).toBe(text.replace("<../shared/logo png.png>", "<assets/logo png.png>"));
    expect(report.manifest.document_path).toBe("b.md");
    expect(report.manifest.entries.map((e) => e.key).sort()).toEqual(["assets/logo png.png", "assets/x.png"]);
    expect(store.committed.get("D2")!.get("assets/logo png.png")).toEqual(logo);
    expect(store.committed.get("D2")!.get("assets/x.png")).toEqual(local);
    expect(md.snapshot(ref).document_id).toBe("D2");
  });

  it("keeps the authored text on save-as when every reference still resolves", async () => {
    const md = engine();
    const store = fakeStore("D1");
    const ref = md.createBlank({ document_id: "D1", document_path: "notes/a.md" }).document_model_ref;
    const { reference } = await md.addAsset(ref, { name: "x.png", bytes: PNG_BYTES });
    md.replaceText(ref, "![x](" + reference + ")\n");
    await md.saveAs(ref, { target_document_id: "D2", target_document_path: "other/b.md", ...store });
    expect(new TextDecoder().decode(store.published[0]!.text_bytes)).toBe("![x](assets/x.png)\n");
    expect(store.published[0]!.manifest.entries[0]!.key).toBe("other/assets/x.png");
  });

  it("advertises the replay-proven rows and keeps conversion unsupported", async () => {
    const result = (await engine().capability("md")) as { capabilities: CapabilityEntry[] };
    const product = toProductCapabilities(result.capabilities);
    for (const op of ["open", "edit", "serialize"]) {
      expect(product.find((c) => c.operation === op)).toMatchObject({ supported: true, evidence_level: "proven" });
    }
    for (const op of ["convert", "export"]) expect(product.find((c) => c.operation === op)?.supported).toBe(false);
  });


  it("refuses another format and unknown sessions by name", async () => {
    const md = engine();
    await expect(md.capability("docx")).rejects.toMatchObject({ name: "HostCapabilityRefusal", reason: "unsupported" });
    expect(() => md.snapshot("md-session:nope")).toThrow(expect.objectContaining({ code: "not_found" }));
    const ref = md.createBlank({ document_id: "D1" }).document_model_ref;
    md.close(ref);
    expect(() => md.snapshot(ref)).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});

describe("findFrontmatter", () => {
  it.each([
    ["---\na: 1\n---\nbody", 13],
    ["---\n---\n", 8],
    ["---\na: 1\n...\n", 13],
  ])("finds %j", (text, end) => {
    expect(findFrontmatter(text)).toEqual({ start: 0, end });
  });
  it("ignores unterminated or non-leading blocks", () => {
    expect(findFrontmatter("---\na: 1\n")).toBeNull();
    expect(findFrontmatter("text\n---\na\n---\n")).toBeNull();
  });
});
