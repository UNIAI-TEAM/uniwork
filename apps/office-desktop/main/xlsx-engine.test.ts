import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGED_XLSX_ASSETS_DIRECTORY, resolveLocalXlsxAssetsDir } from "./xlsx-engine";

// R3-2 (DESKTOP-XLSX): the packaged win-unpacked build shipped no xlsx assets,
// so a local .xlsx open died with EngineBoundaryError: engine_incompatible.
// The packaged build now stages resources/xlsx-assets and the main process
// resolves it from process.resourcesPath - NOT an env var the user must set.

const roots: string[] = [];
function resourcesWithStagedAssets(): string {
  const root = mkdtempSync(join(tmpdir(), "uniwork-xlsx-resources-"));
  roots.push(root);
  mkdirSync(join(root, PACKAGED_XLSX_ASSETS_DIRECTORY), { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resolveLocalXlsxAssetsDir", () => {
  it("resolves the staged packaged dir from the Electron resources path with no env var", () => {
    const resourcesPath = resourcesWithStagedAssets();
    expect(resolveLocalXlsxAssetsDir({ resourcesPath, envAssetsDir: undefined })).toBe(join(resourcesPath, PACKAGED_XLSX_ASSETS_DIRECTORY));
  });

  it("lets an explicit dev dir (UNIWORK_XLSX_ASSETS) win over the packaged dir", () => {
    const resourcesPath = resourcesWithStagedAssets();
    expect(resolveLocalXlsxAssetsDir({ resourcesPath, envAssetsDir: "D:/dev/xlsx-assets" })).toBe("D:/dev/xlsx-assets");
  });

  it("treats a blank env value as unset", () => {
    const resourcesPath = resourcesWithStagedAssets();
    expect(resolveLocalXlsxAssetsDir({ resourcesPath, envAssetsDir: "   " })).toBe(join(resourcesPath, PACKAGED_XLSX_ASSETS_DIRECTORY));
  });

  it("returns undefined when nothing was staged, so the engine reports its typed failure", () => {
    const empty = mkdtempSync(join(tmpdir(), "uniwork-xlsx-empty-"));
    roots.push(empty);
    expect(resolveLocalXlsxAssetsDir({ resourcesPath: empty, envAssetsDir: undefined })).toBeUndefined();
  });

  it("returns undefined for an unpackaged run with no explicit dir", () => {
    expect(resolveLocalXlsxAssetsDir({ resourcesPath: undefined, envAssetsDir: undefined })).toBeUndefined();
    expect(resolveLocalXlsxAssetsDir()).toBeUndefined();
  });
});