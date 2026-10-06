import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gatewayStaleness } from "./xlsx-patched-gateway";

const sha = (text: string) => createHash("sha256").update(text).digest("hex").toUpperCase();

function fixture(opts: { patches: Record<string, string>; applied?: { patch: string; sha256: string }[]; provenanceDetail?: string; noRecord?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "gw-stale-"));
  const patchesDir = join(dir, "patches");
  mkdirSync(patchesDir);
  for (const [name, body] of Object.entries(opts.patches)) writeFileSync(join(patchesDir, name), body);
  const provenancePath = join(dir, "provenance.json");
  writeFileSync(provenancePath, JSON.stringify({ fileCount: 3, upstream: { pinnedCommit: "0123456789abcdef" } }));
  const recordPath = join(dir, "build-record.json");
  if (!opts.noRecord) {
    const applied = opts.applied ?? Object.entries(opts.patches).map(([patch, body]) => ({ patch, sha256: sha(body) }));
    writeFileSync(recordPath, JSON.stringify({ patchesApplied: applied, steps: [{ step: "provenance", detail: opts.provenanceDetail ?? "3 files match 0123456789ab" }] }));
  }
  return { patchesDir, recordPath, provenancePath };
}

describe("gatewayStaleness", () => {
  const patches = { "0001-a.patch": "a", "0002-b.patch": "b" };

  it("is empty for a matching record", () => {
    expect(gatewayStaleness(fixture({ patches }))).toEqual([]);
  });

  it("names a patch whose content changed", () => {
    const applied = [{ patch: "0001-a.patch", sha256: sha("a") }, { patch: "0002-b.patch", sha256: sha("old") }];
    expect(gatewayStaleness(fixture({ patches, applied })).join()).toContain("0002-b.patch changed");
  });

  it("flags a new and a removed patch", () => {
    const applied = [{ patch: "0001-a.patch", sha256: sha("a") }, { patch: "0009-gone.patch", sha256: sha("x") }];
    const problems = gatewayStaleness(fixture({ patches, applied })).join();
    expect(problems).toContain("0002-b.patch is not in the built bundle");
    expect(problems).toContain("0009-gone.patch, which no longer exists");
  });

  it("flags a different order", () => {
    const applied = [{ patch: "0002-b.patch", sha256: sha("b") }, { patch: "0001-a.patch", sha256: sha("a") }];
    expect(gatewayStaleness(fixture({ patches, applied })).join()).toContain("order");
  });

  it("flags a changed upstream pin and a missing record", () => {
    expect(gatewayStaleness(fixture({ patches, provenanceDetail: "3 files match ffffffffffff" })).join()).toContain("provenance changed");
    expect(gatewayStaleness(fixture({ patches, noRecord: true })).join()).toContain("no build record");
  });
});
