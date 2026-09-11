import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1]) throw new Error(`missing ${name}`);
  return argv[index + 1];
}

function optionAll(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== name) continue;
    if (!argv[i + 1]) throw new Error(`missing ${name}`);
    values.push(argv[i + 1]);
    i += 1;
  }
  return values;
}

export function applyVerificationOverlay(entries, overlay) {
  if (!overlay) return entries;
  const bySource = new Map(overlay.entries.map((entry) => [entry.source_path, entry]));
  return entries.map((entry) => {
    const verified = bySource.get(entry.source_path);
    if (!verified) return entry;
    if (verified.verification_state !== "verified") {
      throw new Error(`overlay for ${entry.source_path} must be verified`);
    }
    if (!verified.evidence_path || !verified.evidence_commit) {
      throw new Error(`overlay for ${entry.source_path} needs evidence_path and evidence_commit`);
    }
    return {
      ...entry,
      verification_state: "verified",
      evidence_path: verified.evidence_path,
      evidence_commit: verified.evidence_commit,
    };
  });
}

export async function generateTaskParityManifest(argv = process.argv) {
  const sourceRoot = option(argv, "--source-root");
  const baseline = option(argv, "--baseline");
  const output = option(argv, "--output");
  const sourceProduct = option(argv, "--source-brand");
  const verificationOverlayPaths = optionAll(argv, "--verification-overlay");
  const resolved = execFileSync("git", ["-C", sourceRoot, "rev-parse", baseline], { encoding: "utf8" }).trim();
  if (!resolved.startsWith(baseline)) throw new Error(`baseline resolved to ${resolved}`);

  const tracked = execFileSync("git", ["-C", sourceRoot, "ls-tree", "-r", "--name-only", baseline], {
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean);

  const pathMatch = /^(packages\/(core\/(issues|issue-statuses|projects)|views\/(issues|my-issues|projects|locales\/[^/]+\/(issues|my-issues|projects)\.json))|apps\/web\/app\/\[workspaceSlug\]\/\(dashboard\)\/(issues|my-issues|projects)|apps\/mobile\/.*(issue|project)|server\/.*(issue|project)|e2e\/issues\.spec\.ts)/;
  const contentMatch = /(@[^/]+\/(issues|issue-statuses|projects)|\/(issues|my-issues|projects)(\/|\")|Issue|Project)/;

  function contentAt(path) {
    return execFileSync("git", ["-C", sourceRoot, "show", `${baseline}:${path}`], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  }

  function targetPath(path) {
    return path
      .replaceAll(sourceProduct, "uniwork")
      .replaceAll("my-issues", "my-tasks")
      .replaceAll("issue-statuses", "task-statuses")
      .replaceAll("issues", "tasks")
      .replaceAll("issue", "task");
  }

  function kind(path) {
    if (/\.test\.|\.spec\.|\/testdata\//.test(path)) return "test";
    if (/\/locales\//.test(path)) return "locale";
    if (/\/app\/.*page\.tsx$/.test(path)) return "route";
    return "source";
  }

  const selected = tracked.filter((path) => {
    if (pathMatch.test(path)) return true;
    if (!/\.(go|sql|ts|tsx|json)$/.test(path)) return false;
    try { return contentMatch.test(contentAt(path)); } catch { return false; }
  });

  const stubPathPattern = /(agent-task|agent_task|squad|pull-request|pull_request|github|daemon|workdir)/i;
  let entries = selected.sort().map((sourcePath) => {
    return {
      source_path: sourcePath,
      target_path: targetPath(sourcePath),
      kind: kind(sourcePath),
      disposition: stubPathPattern.test(sourcePath) ? "stubbed" : "adapted",
      verification_state: "pending",
      owner_issue: "UNI-426",
    };
  });

  for (const capability of ["tasks.agent_runs", "tasks.squads", "tasks.vcs", "tasks.local_workdir", "desktop.host", "mobile.host"]) {
    entries.push({
      source_path: `capability:${capability}`,
      target_path: `capability:${capability}`,
      kind: "capability",
      disposition: "stubbed",
      verification_state: "pending",
      owner_issue: "UNI-426",
    });
  }

  for (const verificationOverlayPath of verificationOverlayPaths) {
    const overlay = JSON.parse(await readFile(resolve(verificationOverlayPath), "utf8"));
    entries = applyVerificationOverlay(entries, overlay);
  }

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({
    schema_version: 1,
    baseline_commit: baseline,
    source_product: sourceProduct,
    generated_at: "2026-09-07",
    entries,
  }, null, 2)}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  await generateTaskParityManifest(process.argv);
}
