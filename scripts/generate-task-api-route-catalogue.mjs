import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1]) throw new Error(`missing ${name}`);
  return argv[index + 1];
}

function normalizeSourcePath(raw) {
  let path = raw.split("?")[0];
  path = path
    .replace(/\$\{encodeURIComponent\(([^)]+)\)\}/g, "{$1}")
    .replace(/\$\{([^}]+)\}/g, "{$1}")
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
  // Drop optional-query appendages glued to the path (`/cancel${query}` →
  // `/cancel{query}`). Those are not path segments.
  path = path.replace(/\{[^}/]*query[^}/]*\}$/i, "");
  path = path.replace(/\{([^}]+)\}/g, (_, name) => {
    const cleaned = name.replace(/Id$/i, "ID").replace(/id$/i, "ID");
    const map = {
      id: "id",
      issueID: "taskID",
      issueId: "taskID",
      taskID: "taskID",
      taskId: "taskID",
      workspaceID: "workspaceID",
      workspaceId: "workspaceID",
      commentID: "commentID",
      commentId: "commentID",
      anchorCommentID: "commentID",
      anchorCommentId: "commentID",
      projectID: "projectID",
      projectId: "projectID",
      labelID: "labelID",
      labelId: "labelID",
      propertyID: "propertyID",
      propertyId: "propertyID",
      resourceID: "resourceID",
      resourceId: "resourceID",
      connectionID: "connectionID",
      connectionId: "connectionID",
      quickActionID: "quickActionID",
      quickActionId: "quickActionID",
      itemType: "itemType",
      itemID: "itemID",
      itemId: "itemID",
    };
    if (map[name]) return `{${map[name]}}`;
    if (map[cleaned]) return `{${map[cleaned]}}`;
    if (name === "id" || cleaned === "ID") return "{id}";
    return `{${cleaned}}`;
  });
  // Collapse accidental double braces / broken templates from incomplete literals.
  if (path.includes("${") || path.includes("`")) return null;
  return path;
}

function renameIssueToTask(path) {
  return path
    .replaceAll("/issue-statuses", "/task-statuses")
    .replaceAll("/issue-view-preferences", "/task-view-preferences")
    .replaceAll("/issue-views", "/task-views")
    .replaceAll("/sub-issues", "/sub-tasks")
    .replaceAll("/sub-issue-preview", "/sub-task-preview")
    .replaceAll("/issues", "/tasks")
    .replaceAll("{issueID}", "{taskID}")
    .replaceAll("{issueId}", "{taskID}");
}

function isWorkManagementSource(path) {
  if (/^\/api\/(issues|issue-statuses|issue-views|issue-view-preferences)(\/|$)/.test(path)) return true;
  if (/^\/api\/(projects|labels|properties|comments|attachments|pins)(\/|$)/.test(path)) return true;
  if (/^\/api\/assignee-frequency$/.test(path)) return true;
  if (/\/vcs\//.test(path)) return true;
  if (/^\/api\/tasks\//.test(path)) return true; // AgentRun cancel/retry — stubbed
  return false;
}

function classify(path) {
  const p = path.toLowerCase();
  if (
    /task-runs|pull-requests|\/vcs\/|\/usage$|\/rerun$|\/active-task$|\/tasks\/\{taskid\}\/cancel|retry-source-context|quick-actions/.test(
      p,
    )
  ) {
    return { group: "stub", disposition: "stubbed" };
  }
  if (/\/table\//.test(p)) return { group: "table", disposition: "adapted" };
  if (/task-statuses|task-labels|\/labels|task-properties|\/properties/.test(p)) {
    return { group: "catalog", disposition: "adapted" };
  }
  if (/task-views|task-view-preferences|\/pins/.test(p)) {
    return { group: "views", disposition: "adapted" };
  }
  if (/\/projects/.test(p)) return { group: "projects", disposition: "adapted" };
  if (/\/comments|\/reactions|\/subscribers|\/subscribe|\/unsubscribe|\/attachments|\/timeline/.test(p)) {
    return { group: "collaboration", disposition: "adapted" };
  }
  if (/my-tasks|assignee-frequency/.test(p)) return { group: "my_tasks", disposition: "adapted" };
  return { group: "tasks", disposition: "adapted" };
}

function mapTargetPath(sourcePath) {
  let renamed = renameIssueToTask(sourcePath);

  // Catalog labels/properties → UniWork task-* names under workspace.
  renamed = renamed
    .replace(/^\/api\/labels(\/|$)/, "/api/task-labels$1")
    .replace(/^\/api\/properties(\/|$)/, "/api/task-properties$1");

  if (renamed === "/api/assignee-frequency") {
    return "/api/v1/workspaces/{workspaceID}/assignee-frequency";
  }

  // Global comment routes stay global.
  if (renamed.startsWith("/api/comments")) {
    return `/api/v1${renamed.slice("/api".length)}`.replace("{id}", "{commentID}");
  }

  // Attachments stay global by id.
  if (renamed.startsWith("/api/attachments")) {
    return `/api/v1${renamed.slice("/api".length)}`.replace("{id}", "{attachmentID}");
  }

  // Already workspace-scoped in Multica (e.g. VCS).
  if (renamed.startsWith("/api/workspaces/")) {
    return `/api/v1${renamed.slice("/api".length)}`
      .replace("/workspaces/{id}/", "/workspaces/{workspaceID}/")
      .replace("/workspaces/{workspaceId}/", "/workspaces/{workspaceID}/");
  }

  // Task-by-id resources (and AgentRun /api/tasks/...) stay under /api/v1/tasks/{taskID}/...
  if (/^\/api\/tasks\/\{/.test(renamed)) {
    return `/api/v1${renamed.slice("/api".length)}`.replace("{id}", "{taskID}");
  }

  // Workspace-scoped collections and nested collection helpers.
  const workspaceCollections = [
    "/api/tasks",
    "/api/task-statuses",
    "/api/task-labels",
    "/api/task-properties",
    "/api/task-views",
    "/api/task-view-preferences",
    "/api/projects",
    "/api/pins",
  ];
  for (const prefix of workspaceCollections) {
    if (renamed === prefix || renamed.startsWith(`${prefix}/`) || renamed.startsWith(`${prefix}?`)) {
      const rest = renamed.slice("/api".length); // /tasks...
      return `/api/v1/workspaces/{workspaceID}${rest}`.replace("{id}", rest.startsWith("/projects") ? "{projectID}" : "{id}");
    }
  }

  return `/api/v1${renamed.slice("/api".length)}`;
}

function extractRoutes(clientSource) {
  const pairs = new Map();

  for (const match of clientSource.matchAll(/endpoint:\s*"((?:GET|POST|PUT|PATCH|DELETE)\s+\/api\/[^"]+)"/g)) {
    const [method, ...pathParts] = match[1].split(/\s+/);
    const rawPath = pathParts.join(" ").replace(/\s*\(.*\)$/, "");
    const normalized = normalizeSourcePath(rawPath);
    if (!normalized || !isWorkManagementSource(normalized)) continue;
    pairs.set(`${method} ${normalized}`, { method, source_path: normalized });
  }

  const fetchRe = /this\.fetch(?:<[^>]+>)?\(\s*([^,)]+)(?:,\s*\{([^}]*)\})?/g;
  let m;
  while ((m = fetchRe.exec(clientSource)) !== null) {
    const arg = m[1].trim();
    const opts = m[2] || "";
    let method = "GET";
    const methodMatch = opts.match(/method:\s*"(\w+)"/);
    if (methodMatch) method = methodMatch[1].toUpperCase();
    let rawPath = null;
    if ((arg.startsWith("`") || arg.startsWith('"') || arg.startsWith("'")) && arg.includes("/api/")) {
      rawPath = arg.slice(1, -1);
    } else if (arg === "path") {
      const window = clientSource.slice(Math.max(0, m.index - 500), m.index);
      const pathLit = window.match(/(?:const|let)\s+path\s*=\s*[`'"]([^`'"]+)[`'"]/);
      if (pathLit) rawPath = pathLit[1];
    }
    if (!rawPath) continue;
    const normalized = normalizeSourcePath(rawPath);
    if (!normalized || !isWorkManagementSource(normalized)) continue;
    pairs.set(`${method} ${normalized}`, { method, source_path: normalized });
  }

  return [...pairs.values()];
}

export function buildCatalogue({ baseline, clientSource }) {
  const routes = [];
  const seenTargets = new Set();

  for (const { method, source_path } of extractRoutes(clientSource)) {
    const target_path = mapTargetPath(source_path);
    if (!target_path.startsWith("/api/v1/")) continue;
    if (target_path.toLowerCase().includes("multica")) continue;
    if (target_path.toLowerCase().includes("/issues")) continue;

    const key = `${method} ${target_path}`;
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);

    const { group, disposition } = classify(target_path);
    routes.push({ method, source_path, target_path, group, disposition });
  }

  // Ensure My Tasks surface exists even when Multica only filters listIssues.
  const myKey = "GET /api/v1/workspaces/{workspaceID}/my-tasks";
  if (![...seenTargets].includes(myKey)) {
    routes.push({
      method: "GET",
      source_path: "/api/issues",
      target_path: "/api/v1/workspaces/{workspaceID}/my-tasks",
      group: "my_tasks",
      disposition: "adapted",
    });
  }

  routes.sort((a, b) => {
    const ak = `${a.method} ${a.target_path}`;
    const bk = `${b.method} ${b.target_path}`;
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });

  return {
    schema_version: 1,
    baseline_commit: baseline,
    routes,
  };
}

export async function generateTaskApiRouteCatalogue(argv = process.argv) {
  const sourceRoot = option(argv, "--source-root");
  const baseline = option(argv, "--baseline");
  const output = option(argv, "--output");

  const resolved = execFileSync("git", ["-C", sourceRoot, "rev-parse", baseline], { encoding: "utf8" }).trim();
  if (!resolved.startsWith(baseline)) throw new Error(`baseline resolved to ${resolved}`);

  const clientSource = execFileSync(
    "git",
    ["-C", sourceRoot, "show", `${baseline}:packages/core/api/client.ts`],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );

  const catalogue = buildCatalogue({ baseline, clientSource });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(catalogue, null, 2)}\n`);
  return catalogue;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  await generateTaskApiRouteCatalogue(process.argv);
}
