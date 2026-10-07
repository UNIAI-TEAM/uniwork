import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
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

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}

async function put(root, file, text = "x") {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

test("ee scan covers exactly what git would ship: ignored caches are skipped, cache-named sources are not", async () => {
  const root = await mkdtemp(join(tmpdir(), "office-ee-scan-"));
  try {
    git(root, "init", "-q");
    await put(root, ".gitignore", ".go-cache/\n.go-tmp/\nnode_modules/\ndist/\n.next/\n");
    for (const file of [".go-cache/3f/ee/file.txt", ".go-tmp/ee/file.txt", "node_modules/pkg/ee/file.txt", "dist/ee/file.txt", "packages/a/.next/ee/file.txt", "src/clean/file.txt"]) await put(root, file);
    assert.deepEqual(await scanEe(root), []);

    await put(root, "packages/feature/ee/license.txt");
    await put(root, "ee", "a file named ee is a path part too");
    assert.deepEqual(await scanEe(root), ["ee", "packages/feature/ee/license.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ee scan still catches an ee path under a directory that is only NAMED like a cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "office-ee-scan-"));
  try {
    git(root, "init", "-q");
    await put(root, ".gitignore", "dist/\n.go-cache/\n");
    // Untracked but not ignored: a source directory that merely shares a cache's name.
    await put(root, "packages/lib/coverage/ee/a.ts");
    await put(root, "packages/lib/.go-tmp/ee/b.ts");
    await put(root, "test-results/ee/c.ts");
    // Force-added although the ignore rule hides it: git ships it.
    await put(root, "dist/ee/forced.ts");
    git(root, "add", "-f", "dist/ee/forced.ts");
    // Ignored and untracked: never shipped.
    await put(root, ".go-cache/ee/d.ts");
    assert.deepEqual(await scanEe(root), ["dist/ee/forced.ts", "packages/lib/.go-tmp/ee/b.ts", "packages/lib/coverage/ee/a.ts", "test-results/ee/c.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ee scan fails loudly when git cannot list the checkout", async () => {
  const root = await mkdtemp(join(tmpdir(), "office-ee-scan-"));
  try {
    await assert.rejects(scanEe(join(root, "missing")), /ee scan/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
