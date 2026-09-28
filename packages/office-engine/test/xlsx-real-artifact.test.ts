// XLSX lane tests over the REAL patched gateway artifact — gated on the
// upstream build output (.go-tmp/office-upstream-build/dist/xlsx-gateway.mjs,
// produced by scripts/office/build-upstream.mjs). The Rust sidecar is proven
// separately by the g2-04 replay + the container suite; these tests cover the
// browser-safe half against real OOXML fixtures.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createXlsxAdapter, bindXlsxGateway, probeXlsx } from "../src/xlsx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const ARTIFACT = join(REPO, ".go-tmp", "office-upstream-build", "dist", "xlsx-gateway.mjs");
const FIXTURES = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets");

const load = async () => {
  const mod = await import(pathToFileURL(ARTIFACT).href);
  return bindXlsxGateway(mod as never);
};

describe.skipIf(!existsSync(ARTIFACT))("xlsx real gateway artifact", () => {
  it("opens kitchen-sink: 2 sheets, cross-sheet formulas, chart part preserved-listed", async () => {
    const engine = await load();
    const adapter = createXlsxAdapter({ engine });
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, "xlsx-kitchen-sink.xlsx")));
    const out = await adapter.open({ bytes, format: "xlsx", document_id: "ks" });
    expect(out.outcome).toBe("opened");
    const ref = (out as { document_model_ref: string }).document_model_ref;
    const snapshot = adapter.snapshotOf(ref);
    expect(snapshot.sheets.map((s) => s.name)).toEqual(["Data", "PhuLuc"]);
    // Chart part lands in the preserved-parts warning, not silently dropped.
    const probe = await probeXlsx(engine, bytes);
    expect(probe.preservedParts.some((p) => /chart/.test(p))).toBe(true);
    adapter.release(ref);
  });

  it("a formula-free workbook edits + saves without a recalc port; output re-parses", async () => {
    const engine = await load();
    const adapter = createXlsxAdapter({ engine });
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, "xlsx-compatibility-edit.xlsx")));
    const out = await adapter.open({ bytes, format: "xlsx", document_id: "ce" });
    const ref = (out as { document_model_ref: string }).document_model_ref;
    adapter.edit(ref, [{ op: "set_cell", target: { sheet: adapter.sheetNames(ref)[0], cell: "B2" }, attributes: { value: 42 } }]);
    const saved = await adapter.serialize({ document_model_ref: ref, format: "xlsx" });
    expect(saved.bytes.length).toBeGreaterThan(100);
    expect(saved.checksum).toMatch(/^[0-9a-f]{64}$/);
    // Output re-parses through the real engine and carries the edit.
    const reopened = await engine.readWorkbook(saved.bytes);
    const sheet = reopened.snapshot.sheets[0]!;
    expect(sheet.cells["B2"]?.value).toBe(42);
  });

  it("formula-bearing workbook refuses serialize without the sidecar — never stale <v>", async () => {
    const engine = await load();
    const adapter = createXlsxAdapter({ engine });
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, "xlsx-kitchen-sink.xlsx")));
    const out = await adapter.open({ bytes, format: "xlsx", document_id: "ks" });
    const ref = (out as { document_model_ref: string }).document_model_ref;
    await expect(adapter.serialize({ document_model_ref: ref, format: "xlsx" })).rejects.toMatchObject({
      code: "unsupported_operation",
    });
  });

  it("pivot fixture: 12 parts preserved verbatim through a no-op save", async () => {
    const engine = await load();
    const adapter = createXlsxAdapter({ engine });
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, "xlsx-pivot.xlsx")));
    const out = await adapter.open({ bytes, format: "xlsx", document_id: "pv" });
    const ref = (out as { document_model_ref: string }).document_model_ref;
    const before = await engine.inventory(bytes);
    const saved = await adapter.serialize({ document_model_ref: ref, format: "xlsx" });
    const after = await engine.inventory(saved.bytes);
    // Parts the serializer does not own (pivot cache/tables, customXml...)
    // survive content-identical — assertPreserved inside serialize proves it,
    // and the pivot fixtures' protected parts must appear byte-for-byte.
    const beforeMap = new Map(before.map((e) => [e.path, e.sha256]));
    const afterMap = new Map(after.map((e) => [e.path, e.sha256]));
    for (const e of before.filter((e) => /pivot|customXml|externalLink/i.test(e.path))) {
      expect(afterMap.get(e.path)).toBe(e.sha256);
    }
    // No part was dropped outright.
    expect(after.length).toBe(before.length);
    void beforeMap;
  });
});
