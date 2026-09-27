import { sha256Hex } from "@uniwork/office-contracts";
import { describe, expect, it } from "vitest";
import type { AssetManifest } from "./manifest";
import { saveWithAssets } from "./save";
import { fakeStore, PNG_BYTES, utf8 } from "./test-fakes";

const SVG = utf8('<svg xmlns="http://www.w3.org/2000/svg"/>');
const UNKNOWN = new Uint8Array([0, 1, 2, 3]);

async function manifestFor(files: Record<string, [Uint8Array, string, "owned" | "imported"]>): Promise<AssetManifest> {
  const entries = [];
  for (const [key, [bytes, media_type, origin]] of Object.entries(files)) {
    entries.push({ key, sha256: await sha256Hex(bytes), byte_length: bytes.byteLength, media_type, origin });
  }
  return { version: 1, document_path: "document.md", entries };
}

async function setup() {
  const manifest = await manifestFor({
    "assets/a.png": [PNG_BYTES, "image/png", "owned"],
    "assets/logo.svg": [SVG, "image/svg+xml", "owned"],
    "assets/blob.bin": [UNKNOWN, "application/octet-stream", "owned"],
    "assets/unused.png": [PNG_BYTES, "image/png", "owned"],
    "assets/imported.dat": [UNKNOWN, "application/octet-stream", "imported"],
  });
  const store = fakeStore("D1", {
    "assets/a.png": PNG_BYTES,
    "assets/logo.svg": SVG,
    "assets/blob.bin": UNKNOWN,
    "assets/unused.png": PNG_BYTES,
    "assets/imported.dat": UNKNOWN,
  });
  const references = ["assets/a.png", "assets/logo.svg", "assets/blob.bin", "../../etc/passwd", "C:\\x.png", "assets/gone.png"];
  const input = {
    text_bytes: utf8("# Tiêu đề\n"),
    references,
    manifest,
    pending: new Map<string, Uint8Array>(),
    source: store.source,
    staging: store.staging,
    hash: sha256Hex,
    publish: (i: Parameters<typeof store.publish>[0]) => store.publish(i),
  };
  return { store, input };
}

const publishOf = (store: ReturnType<typeof fakeStore>) => (i: Omit<Parameters<typeof store.publish>[0], "document_id">) =>
  store.publish({ ...i, document_id: "D1" });

describe("saveWithAssets", () => {
  it("stages every needed byte - SVG and unknown included - before one publish", async () => {
    const { store, input } = await setup();
    const { report } = await saveWithAssets({ ...input, publish: publishOf(store) });
    expect(store.published).toHaveLength(1);
    expect(store.staged.sort()).toEqual(["assets/a.png", "assets/blob.bin", "assets/imported.dat", "assets/logo.svg"]);
    expect(report.manifest.entries.map((e) => e.key).sort()).toEqual(store.staged);
    // owned + unreferenced is dropped; imported + unreferenced is carried.
    expect(report.manifest.entries.some((e) => e.key === "assets/unused.png")).toBe(false);
    expect(report.dangling_count).toBe(1);
    expect(report.refused.sort()).toEqual(["absolute_path", "traversal"]);
    expect(store.published[0]!.text_sha256).toBe(await sha256Hex(input.text_bytes));
  });

  it("never reads a refused reference from the host", async () => {
    const { store, input } = await setup();
    await saveWithAssets({ ...input, publish: publishOf(store) });
    expect(store.reads.every((k) => !k.includes("..") && !k.includes(":") && !k.startsWith("/"))).toBe(true);
    expect(store.reads).not.toContain("etc/passwd");
  });

  it.each([
    ["a read failure", (s: ReturnType<typeof fakeStore>) => (s.failRead = (k) => k === "assets/logo.svg"), "commit_failed", "asset_read_failed"],
    ["a staging failure", (s: ReturnType<typeof fakeStore>) => (s.failStage = (k) => k === "assets/blob.bin"), "commit_failed", "asset_stage_failed"],
    ["corrupted bytes", (s: ReturnType<typeof fakeStore>) => (s.corruptRead = (k) => k === "assets/a.png"), "upload_checksum_mismatch", "asset_checksum_mismatch"],
  ])("does not publish after %s", async (_name, inject, code, reason) => {
    const { store, input } = await setup();
    inject(store);
    const error = await saveWithAssets({ ...input, publish: publishOf(store) }).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "EngineBoundaryError", code, fields: { reason } });
    expect(store.published).toHaveLength(0);
    // The host's error text (which may name a host path) is not forwarded.
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it("does not publish when staging answers without a receipt", async () => {
    const { store, input } = await setup();
    const staging = { stage: async () => ({ staged_id: "" }) };
    await expect(saveWithAssets({ ...input, staging, publish: publishOf(store) })).rejects.toMatchObject({
      fields: { reason: "asset_stage_failed" },
    });
    expect(store.published).toHaveLength(0);
  });

  it("prefers session bytes over committed bytes", async () => {
    const { store, input } = await setup();
    store.failRead = (k) => k === "assets/a.png";
    await saveWithAssets({ ...input, pending: new Map([["assets/a.png", PNG_BYTES]]), publish: publishOf(store) });
    expect(store.reads).not.toContain("assets/a.png");
    expect(store.published).toHaveLength(1);
  });
});
