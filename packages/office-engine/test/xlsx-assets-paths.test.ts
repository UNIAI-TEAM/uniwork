// Resolution of the staged xlsx gateway bundle and sidecar binary.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { xlsxGatewayArtifactPath, xlsxSidecarPath } from "../src/node/xlsx-assets";

const SIDECAR = process.platform === "win32" ? "xlsx-sidecar.exe" : "xlsx-sidecar";
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "uw-xlsx-assets-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("xlsx asset resolution", () => {
  it("finds the gateway bundle and the sidecar in the explicit directory", () => {
    writeFileSync(join(dir, "xlsx-gateway.mjs"), "export {};");
    writeFileSync(join(dir, SIDECAR), "bin");
    expect(xlsxGatewayArtifactPath(dir)).toBe(join(dir, "xlsx-gateway.mjs"));
    expect(xlsxSidecarPath(dir)).toBe(join(dir, SIDECAR));
  });

  it("resolves the gateway without the sidecar (recalc fails closed later, a probe does not)", () => {
    writeFileSync(join(dir, "xlsx-gateway.mjs"), "export {};");
    expect(xlsxGatewayArtifactPath(dir)).toBe(join(dir, "xlsx-gateway.mjs"));
    expect(() => xlsxSidecarPath(dir)).toThrowError(expect.objectContaining({ code: "engine_incompatible" }));
  });

  it("refuses as engine_incompatible when nothing is staged, naming the missing file", () => {
    const empty = join(dir, "empty");
    expect(() => xlsxGatewayArtifactPath(empty)).toThrowError(expect.objectContaining({ code: "engine_incompatible" }));
    try {
      xlsxSidecarPath(empty);
      expect.unreachable();
    } catch (error) {
      expect(JSON.stringify((error as { detail?: unknown }).detail ?? error)).toContain(SIDECAR);
    }
  });

  it("ignores an empty explicit directory and an absent one", () => {
    expect(() => xlsxGatewayArtifactPath("")).toThrowError(expect.objectContaining({ code: "engine_incompatible" }));
    expect(() => xlsxSidecarPath(undefined)).toThrowError(expect.objectContaining({ code: "engine_incompatible" }));
  });
});
