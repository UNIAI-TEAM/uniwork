import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { applyVerificationOverlay } from "./generate-task-parity-manifest.mjs";

const path = new URL("../docs/parity/tasks-work-management.json", import.meta.url);
const overlayPath = new URL("../docs/parity/tasks-work-management.slice1-verification.json", import.meta.url);
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
const pendingKeys = [
  "disposition",
  "kind",
  "owner_issue",
  "source_path",
  "target_path",
  "verification_state",
];
const verifiedKeys = [
  "disposition",
  "evidence_commit",
  "evidence_path",
  "kind",
  "owner_issue",
  "source_path",
  "target_path",
  "verification_state",
];

test("Tasks parity manifest pins and classifies the complete baseline", async () => {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const overlay = JSON.parse(await readFile(overlayPath, "utf8"));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.baseline_commit, "3d37828e9");
  assert.equal(manifest.entries.length, 1531);
  assert.equal(overlay.schema_version, 1);
  assert.equal(overlay.owner_issue, "UNI-495");
  assert.deepEqual(
    overlay.entries.map((entry) => entry.source_path).sort(),
    [...capabilityIDs].sort(),
  );

  const sources = manifest.entries.map((entry) => entry.source_path);
  const sourceEntries = manifest.entries.filter((entry) => entry.kind !== "capability");
  const capabilities = manifest.entries.filter((entry) => entry.kind === "capability");
  assert.equal(sourceEntries.length, 1525);
  assert.deepEqual(capabilities.map((entry) => entry.source_path), capabilityIDs);
  assert.equal(new Set(sources).size, sources.length);

  const verifiedSources = new Set(overlay.entries.map((entry) => entry.source_path));
  for (const entry of overlay.entries) {
    assert.equal(entry.verification_state, "verified");
    assert.match(entry.evidence_path, /\S/);
    assert.match(entry.evidence_commit, /^[0-9a-f]{7,40}$/);
  }

  for (const entry of manifest.entries) {
    assert.match(entry.source_path, /\S/);
    assert.match(entry.target_path, /\S/);
    assert.equal(entry.target_path.toLowerCase().includes(manifest.source_product.toLowerCase()), false);
    assert.equal(entry.target_path.toLowerCase().includes("issue"), false);
    assert.ok(["source", "route", "test", "locale", "capability"].includes(entry.kind));
    assert.ok(["ported", "adapted", "stubbed"].includes(entry.disposition));
    assert.equal(entry.owner_issue, "UNI-426");
    if (verifiedSources.has(entry.source_path)) {
      assert.deepEqual(Object.keys(entry).sort(), verifiedKeys);
      assert.equal(entry.verification_state, "verified");
      assert.match(entry.evidence_path, /\S/);
      assert.match(entry.evidence_commit, /^[0-9a-f]{7,40}$/);
    } else {
      assert.deepEqual(Object.keys(entry).sort(), pendingKeys);
      assert.equal(entry.verification_state, "pending");
    }
  }
  assert.equal(
    createHash("sha256").update(JSON.stringify(manifest.entries)).digest("hex"),
    "9985eb3b4d0e097d6d592607553b4328dd3ed19a354bb0db3756c633881819c1",
  );

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
  assert.equal(generated.entries.every((entry) => entry.verification_state === "pending"), true);
});

test("slice-1 verification overlay marks only owned capability entries", async () => {
  const overlay = JSON.parse(await readFile(overlayPath, "utf8"));
  const pending = {
    source_path: "packages/core/issues/hooks.ts",
    target_path: "packages/core/tasks/hooks.ts",
    kind: "source",
    disposition: "adapted",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const capability = {
    source_path: "capability:tasks.vcs",
    target_path: "capability:tasks.vcs",
    kind: "capability",
    disposition: "stubbed",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const merged = applyVerificationOverlay([pending, capability], overlay);
  assert.equal(merged[0].verification_state, "pending");
  assert.equal(merged[0].evidence_path, undefined);
  assert.equal(merged[1].verification_state, "verified");
  assert.equal(merged[1].evidence_path, "server/internal/workcapability/catalogue.go");
  assert.equal(merged[1].evidence_commit, "017d8be7a9e83eab6ba0009379cf6c5cdddecd12");
});
