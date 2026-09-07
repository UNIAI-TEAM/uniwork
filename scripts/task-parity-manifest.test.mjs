import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const path = new URL("../docs/parity/tasks-work-management.json", import.meta.url);
const generator = fileURLToPath(new URL("./generate-task-parity-manifest.mjs", import.meta.url));
const execFile = promisify(execFileCallback);
const capabilityIDs = [
  "capability:tasks.agent_runs",
  "capability:tasks.squads",
  "capability:tasks.vcs",
  "capability:tasks.local_workdir",
  "capability:desktop.host",
  "capability:mobile.host",
];

test("Tasks parity manifest pins and classifies the complete baseline", async () => {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.baseline_commit, "3d37828e9");
  assert.equal(manifest.entries.length, 1531);
  assert.equal(
    createHash("sha256").update(JSON.stringify(manifest.entries)).digest("hex"),
    "837cbe773093ecfa374b9d66fd571ee7d103dbaa8183710f692af6af8b66b09f",
  );

  const sources = manifest.entries.map((entry) => entry.source_path);
  const sourceEntries = manifest.entries.filter((entry) => entry.kind !== "capability");
  const capabilities = manifest.entries.filter((entry) => entry.kind === "capability");
  assert.equal(sourceEntries.length, 1525);
  assert.deepEqual(capabilities.map((entry) => entry.source_path), capabilityIDs);
  assert.equal(new Set(sources).size, sources.length);
  for (const entry of manifest.entries) {
    assert.match(entry.source_path, /\S/);
    assert.match(entry.target_path, /\S/);
    assert.equal(entry.target_path.toLowerCase().includes(manifest.source_product.toLowerCase()), false);
    assert.equal(entry.target_path.toLowerCase().includes("issue"), false);
    assert.ok(["source", "route", "test", "locale", "capability"].includes(entry.kind));
    assert.ok(["ported", "adapted", "stubbed"].includes(entry.disposition));
    assert.equal(entry.verification_state, "pending");
    assert.equal("completion_evidence" in entry, false);
    assert.equal("verification_evidence" in entry, false);
    assert.equal(entry.owner_issue, "UNI-426");
  }

  for (const route of [
    "apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx",
    "apps/web/app/[workspaceSlug]/(dashboard)/my-issues/page.tsx",
    "apps/web/app/[workspaceSlug]/(dashboard)/projects/page.tsx",
  ]) {
    assert.ok(sources.includes(route), `missing route ${route}`);
  }
  for (const [sourcePath, targetPath] of [
    [
      "apps/mobile/data/mutations/issues.ts",
      "apps/mobile/data/mutations/tasks.ts",
    ],
    [
      "apps/web/app/[workspaceSlug]/(dashboard)/issues/[id]/page.tsx",
      "apps/web/app/[workspaceSlug]/(dashboard)/tasks/[id]/page.tsx",
    ],
    [
      "packages/core/issue-statuses/hooks.ts",
      "packages/core/task-statuses/hooks.ts",
    ],
  ]) {
    assert.equal(manifest.entries.find((entry) => entry.source_path === sourcePath)?.target_path, targetPath);
  }
  assert.equal(manifest.entries.some((entry) => entry.disposition === "stubbed"), true);
});

test("Task parity generator emits a byte-stable manifest from a fixed Git fixture", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "task-parity-manifest-"));
  t.after(() => rm(fixtureRoot, { force: true, recursive: true }));

  async function addFile(relativePath, content) {
    const file = join(fixtureRoot, relativePath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }

  await execFile("git", ["init", "--quiet", fixtureRoot]);
  await execFile("git", ["-C", fixtureRoot, "config", "user.email", "test@example.com"]);
  await execFile("git", ["-C", fixtureRoot, "config", "user.name", "Task Parity Test"]);
  await addFile("packages/core/issues/hooks.ts", "export const Issue = 'issue';\n");
  await addFile("packages/fixture-brand/issue.ts", "export const Issue = 'brand';\n");
  await addFile("apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx", "export default function Page() {}\n");
  await addFile("server/internal/issue-agent-task.go", "package internal\n");
  await execFile("git", ["-C", fixtureRoot, "add", "."]);
  await execFile("git", ["-C", fixtureRoot, "commit", "--quiet", "-m", "fixture"]);
  const { stdout } = await execFile("git", ["-C", fixtureRoot, "rev-parse", "HEAD"]);
  const baseline = stdout.trim();
  const first = join(fixtureRoot, "first.json");
  const second = join(fixtureRoot, "second.json");
  const args = [generator, "--source-root", fixtureRoot, "--baseline", baseline, "--source-brand", "fixture-brand"];

  await execFile(process.execPath, [...args, "--output", first]);
  await execFile(process.execPath, [...args, "--output", second]);

  assert.equal(await readFile(first, "utf8"), await readFile(second, "utf8"));
  const generated = JSON.parse(await readFile(first, "utf8"));
  assert.equal(generated.baseline_commit, baseline);
  assert.deepEqual(generated.entries.map((entry) => entry.source_path), [
    "apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx",
    "packages/core/issues/hooks.ts",
    "packages/fixture-brand/issue.ts",
    "server/internal/issue-agent-task.go",
    ...capabilityIDs,
  ]);
  assert.equal(generated.entries.find((entry) => entry.source_path === "packages/fixture-brand/issue.ts")?.target_path, "packages/uniwork/task.ts");
  assert.equal(generated.entries.find((entry) => entry.source_path === "server/internal/issue-agent-task.go")?.disposition, "stubbed");
});
