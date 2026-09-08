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
const slice2OverlayPath = new URL("../docs/parity/tasks-work-management.slice2-verification.json", import.meta.url);
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
const slice2ApiSources = [
  "packages/core/api/client.ts",
  "packages/core/api/schemas.ts",
  "packages/core/issue-statuses/mutations.ts",
  "packages/core/issue-statuses/queries.ts",
  "packages/core/issue-views/mutations.ts",
  "packages/core/issue-views/queries.ts",
  "packages/core/issues/batch.ts",
  "packages/core/issues/cache-coordinator.ts",
  "packages/core/issues/mutations.ts",
  "packages/core/issues/queries.ts",
  "packages/core/projects/mutations.ts",
  "packages/core/projects/queries.ts",
  "server/internal/handler/issue.go",
  "server/internal/handler/issue_table_query.go",
  "server/internal/handler/issue_view.go",
  "server/internal/handler/project.go",
  "server/internal/service/issue.go",
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
  const slice2Overlay = JSON.parse(await readFile(slice2OverlayPath, "utf8"));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.baseline_commit, "3d37828e9");
  assert.equal(manifest.entries.length, 1531);
  assert.equal(overlay.schema_version, 1);
  assert.equal(overlay.owner_issue, "UNI-495");
  assert.deepEqual(
    overlay.entries.map((entry) => entry.source_path).sort(),
    [...capabilityIDs].sort(),
  );
  assert.equal(slice2Overlay.schema_version, 1);
  assert.equal(slice2Overlay.owner_issue, "UNI-497");
  assert.deepEqual(
    slice2Overlay.entries.map((entry) => entry.source_path).sort(),
    [...slice2ApiSources].sort(),
  );

  const sources = manifest.entries.map((entry) => entry.source_path);
  const sourceEntries = manifest.entries.filter((entry) => entry.kind !== "capability");
  const capabilities = manifest.entries.filter((entry) => entry.kind === "capability");
  assert.equal(sourceEntries.length, 1525);
  assert.deepEqual(capabilities.map((entry) => entry.source_path), capabilityIDs);
  assert.equal(new Set(sources).size, sources.length);

  const verifiedSources = new Set([
    ...overlay.entries.map((entry) => entry.source_path),
    ...slice2Overlay.entries.map((entry) => entry.source_path),
  ]);
  for (const entry of [...overlay.entries, ...slice2Overlay.entries]) {
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
    "a14b32387144fd9ab7dfe482ec3fe3ad5d4aaca43b68df6f14f421478c7d107c",
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

test("slice-2 verification overlay marks only owned API entries", async () => {
  const overlay = JSON.parse(await readFile(slice2OverlayPath, "utf8"));
  const pending = {
    source_path: "apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx",
    target_path: "apps/web/app/[workspaceSlug]/(dashboard)/tasks/page.tsx",
    kind: "route",
    disposition: "adapted",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const api = {
    source_path: "packages/core/api/client.ts",
    target_path: "packages/core/api/client.ts",
    kind: "source",
    disposition: "adapted",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
  const merged = applyVerificationOverlay([pending, api], overlay);
  assert.equal(merged[0].verification_state, "pending");
  assert.equal(merged[0].evidence_path, undefined);
  assert.equal(merged[1].verification_state, "verified");
  assert.equal(merged[1].evidence_path, "docs/parity/tasks-api-client-core-routes.json");
  assert.equal(merged[1].evidence_commit, "eacfb8e90dbe017adeb200d4e284a4f4a051262a");
});
