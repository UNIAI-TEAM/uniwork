import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import process from "node:process";
import { generateReleaseInventory, scanEe } from "./release-inventory.mjs";

test("release inventory copies provenance, notices, fonts and a clean ee scan", async () => {
  const parent = join(process.cwd(), ".uniwork-dev");
  await mkdir(parent, { recursive: true });
  const output = await mkdtemp(join(parent, "office-inventory-test-"));
  try {
    const result = await generateReleaseInventory({ outputDirectory: output });
    assert.deepEqual(result.inventory.eeScan, { clean: true, matches: [] });
    assert.equal(result.inventory.source.pinnedCommit, "09485f884dc845cf3bf27fb7edfe489f9d457aad");
    assert.ok(result.inventory.patches.length >= 2);
    assert.ok(result.inventory.dependencies.some((dependency) => dependency.name === "electron"));
    assert.ok(result.inventory.fontRedistribution.length >= 1);
    const notices = await readFile(join(output, "THIRD-PARTY-NOTICES.txt"), "utf8");
    assert.match(notices, /resolved production dependency tree/);
    assert.doesNotMatch(notices, /UNKNOWN/);
    assert.match(notices, /zod@/);
    assert.match(notices, /MIT License|Copyright/);
    assert.match(await readFile(join(output, "LICENSE"), "utf8"), /Apache License/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("ee scan walks tracked sources but never a Go cache, dependencies or build output", async () => {
  const root = await mkdtemp(join(tmpdir(), "office-ee-scan-"));
  try {
    for (const directory of [".go-cache/3f/ee", ".go-tmp/ee", "node_modules/pkg/ee", "dist/ee", "packages/a/dist/ee", ".git/ee", ".next/ee", "src/clean"]) {
      await mkdir(join(root, directory), { recursive: true });
      await writeFile(join(root, directory, "file.txt"), "x");
    }
    assert.deepEqual(await scanEe(root), []);
    await mkdir(join(root, "packages", "feature", "ee"), { recursive: true });
    await writeFile(join(root, "packages", "feature", "ee", "license.txt"), "x");
    await writeFile(join(root, "ee"), "a file named ee is a path part too");
    assert.deepEqual(await scanEe(root), ["ee", "packages/feature/ee/license.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
