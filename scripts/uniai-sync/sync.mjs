import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { loadConfig } from "./config.mjs";
import { prepareConfig, publicRefreshMessage } from "./tokens.mjs";
import { attachmentIdsIn, collectAttachmentIds, rewriteAttachmentUrls } from "./files.mjs";
import { createLock } from "./lock.mjs";
import {
  COMMENT_LIMIT,
  EMAIL_REMAP,
  STATUSES,
  assigneeNote,
  commentBody,
  descriptionParts,
  mapAssignee,
  syncHash,
  taskTitle,
} from "./map.mjs";
import { orderIssues } from "./order.mjs";

const OVERFLOW_MARKER = "<!-- uniai-description-overflow -->";
const COMMENT_MARKER = /<!-- uniai-comment:(\S+) -->/;

class IssueFailure extends Error {}

function cut(value, limit) {
  return Array.from(value).slice(0, limit).join("");
}

function commentAuthor(comment, people, agents) {
  if (comment.author_type === "agent") {
    const agent = agents.get(comment.author_id);
    return { name: agent?.name || comment.author_id, agent: true, email: null };
  }
  const person = people.get(comment.author_id);
  const email = (person?.email ?? "").trim().toLowerCase();
  return {
    name: person?.name || comment.author_id,
    agent: false,
    email: EMAIL_REMAP.get(email) || email || "unknown",
  };
}

function wantedFields(issue) {
  const { body } = descriptionParts(issue.description);
  return {
    title: taskTitle(issue.identifier, issue.title),
    description: body,
    status: issue.status,
    priority: issue.priority,
    start_date: issue.start_date || null,
    due_date: issue.due_date || null,
  };
}

function diffTask(current, want, labelIds) {
  const patch = {};
  if (current.title !== want.title) patch.title = want.title;
  if (current.description_truncated || (current.description ?? "") !== want.description) {
    patch.description = want.description;
  }
  if (current.status !== want.status) patch.status = want.status;
  if (current.priority !== want.priority) patch.priority = want.priority;
  for (const key of ["start_date", "due_date", "assignee_id", "parent_task_id"]) {
    if ((current[key] || null) !== want[key]) patch[key] = want[key];
  }
  const have = (current.labels ?? []).map((label) => label.id);
  const add = labelIds.filter((id) => !have.includes(id));
  const remove = have.filter((id) => !labelIds.includes(id));
  if (add.length > 0) patch.add_label_ids = add;
  if (remove.length > 0) patch.remove_label_ids = remove;
  return patch;
}

export async function syncRun(deps) {
  const { config, uniai, uniwork, lock } = deps;
  if (lock && !lock.tryAcquire()) return { code: 0, lines: ["already running"] };
  try {
    return await run(config, uniai, uniwork);
  } finally {
    if (lock) lock.release();
  }
}

async function run(config, uniai, uniwork) {
  const lines = [];
  let failed = false;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  let uniaiMembers;
  let agentRows;
  let uniworkMembers;
  let labelRows;
  try {
    [uniaiMembers, agentRows, uniworkMembers, labelRows] = await Promise.all([
      uniai.listMembers(),
      uniai.listAgents(),
      uniwork.listMembers(),
      uniwork.listLabels(),
    ]);
  } catch (error) {
    if (error.code === "unauthorized") {
      return { code: 1, lines: ["unauthorized"] };
    }
    const status = error.status ? ` HTTP ${error.status}` : "";
    return { code: 1, lines: [`startup failed${status}: ${error.message}`] };
  }
  const people = new Map(uniaiMembers.map((row) => [row.user_id, row]));
  const agents = new Map(agentRows.map((row) => [row.id, row]));
  const uniworkByEmail = new Map(
    uniworkMembers.map((row) => [String(row.email ?? "").toLowerCase(), row]),
  );
  const labelIdsByName = new Map();
  const duplicateLabels = new Set();
  for (const label of labelRows) {
    if (labelIdsByName.has(label.name)) duplicateLabels.add(label.name);
    else labelIdsByName.set(label.name, label.id);
  }

  let issues;
  try {
    issues = await uniai.listIssues(config.uniaiProjectId);
  } catch (error) {
    if (error.code === "unauthorized") return { code: 1, lines: ["unauthorized"] };
    return { code: 1, lines: [`list issues failed: ${error.message}`] };
  }
  const commentsByIssue = new Map();
  const unreadable = new Set();
  for (const issue of issues) {
    try {
      commentsByIssue.set(issue.id, await uniai.listComments(issue.id));
    } catch (error) {
      if (error.code === "unauthorized") return { code: 1, lines: [...lines, "unauthorized"] };
      failed = true;
      unreadable.add(issue.id);
      lines.push(`error ${issue.id}: ${error.message}`);
    }
  }
  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  const { order, cycles } = orderIssues(issues);
  const cycleIds = new Set(cycles);
  for (const id of cycles) {
    lines.push(`cycle ${id}`);
    failed = true;
  }

  const taskIds = new Map();
  for (const issue of issues) {
    if (issue.metadata?.uniwork_task) taskIds.set(issue.id, issue.metadata.uniwork_task);
  }
  const skippedIds = new Set();
  const reviving = new Set();

  let projectTasks = null;
  async function findByTitle(title) {
    projectTasks ??= await uniwork.queryTasks();
    return projectTasks.filter((task) => task.title === title);
  }

  async function labelIdsFor(issue) {
    const ids = [];
    for (const label of issue.labels ?? []) {
      if (duplicateLabels.has(label.name)) throw new IssueFailure(`duplicate label ${label.name}`);
      if (!labelIdsByName.has(label.name)) {
        const row = await uniwork.createLabel(label.name);
        labelIdsByName.set(label.name, row.id);
      }
      ids.push(labelIdsByName.get(label.name));
    }
    return ids;
  }

  async function updateOnce(taskId, want, labelIds, current) {
    const patch = diffTask(current, want, labelIds);
    if (Object.keys(patch).length === 0) return { changed: false, note: "" };
    const result = await uniwork.updateTask({ task_id: taskId, revision: current.revision, ...patch });
    return { changed: true, note: String(result?.note ?? "") };
  }

  async function updateTask(taskId, want, labelIds) {
    let current = await uniwork.getTask(taskId);
    try {
      return await updateOnce(taskId, want, labelIds, current);
    } catch (error) {
      if (error.code !== "revision_conflict") throw error;
    }
    current = await uniwork.getTask(taskId);
    return updateOnce(taskId, want, labelIds, current);
  }

  async function postComments(issue, taskId, existing, note, overflow, liveComments) {
    const posted = new Map();
    const bodies = existing.map((row) => String(row.body ?? ""));
    existing.forEach((row) => {
      const hit = COMMENT_MARKER.exec(String(row.body ?? ""));
      if (hit) posted.set(hit[1], row.id);
    });
    const add = async (body, replyTo) => {
      const args = { task_id: taskId, body };
      if (replyTo) args.reply_to = replyTo;
      return uniwork.addComment(args);
    };

    if (note) {
      const marker = `<!-- uniai-assignee:${note.id} -->`;
      if (!bodies.some((body) => body.includes(marker))) await add(assigneeNote(note));
    }
    if (overflow && !bodies.some((body) => body.includes(OVERFLOW_MARKER))) {
      await add(cut(`${OVERFLOW_MARKER}\n${overflow}`, COMMENT_LIMIT));
    }

    const liveIds = new Set(liveComments.map((comment) => comment.id));
    let pending = liveComments.filter((comment) => !posted.has(comment.id));
    while (pending.length > 0) {
      const next = [];
      for (const comment of pending) {
        const parent = comment.parent_id;
        const waits = parent && liveIds.has(parent) && !posted.has(parent);
        if (waits) {
          next.push(comment);
          continue;
        }
        const author = commentAuthor(comment, people, agents);
        const body = commentBody({ id: comment.id, ...author, content: comment.content });
        const row = await add(body, parent && liveIds.has(parent) ? posted.get(parent) : undefined);
        posted.set(comment.id, row.id);
      }
      if (next.length === pending.length) break;
      pending = next;
    }
    return pending;
  }

  async function processIssue(issue) {
    if (!STATUSES.has(issue.status)) throw new IssueFailure(`bad status ${issue.id}`);
    const parentIssue = issue.parent_issue_id;
    if (parentIssue) {
      if (!issueById.has(parentIssue)) throw new IssueFailure(`parent outside ${parentIssue}`);
      if (cycleIds.has(parentIssue)) throw new IssueFailure(`cycle parent ${issue.id}`);
      if (!taskIds.has(parentIssue)) {
        lines.push(`waiting ${issue.id}`);
        return;
      }
    }

    const liveComments = (commentsByIssue.get(issue.id) ?? [])
      .filter((comment) => !comment.deleted_at)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
    const hash = syncHash(issue, commentsByIssue.get(issue.id) ?? []);
    if (issue.metadata?.uniwork_sync === hash && taskIds.has(issue.id)) {
      skipped += 1;
      skippedIds.add(issue.id);
      await copyFiles(issue, taskIds.get(issue.id), liveComments);
      return;
    }

    const labelIds = await labelIdsFor(issue);
    const { assigneeId, note } = mapAssignee(issue, people, agents, uniworkByEmail);
    const want = {
      ...wantedFields(issue),
      assignee_id: assigneeId,
      parent_task_id: parentIssue ? taskIds.get(parentIssue) : null,
    };
    const { overflow } = descriptionParts(issue.description);

    let taskId = taskIds.get(issue.id);
    let fresh = false;
    let partial = "";
    if (!taskId) {
      const matches = await findByTitle(want.title);
      if (matches.length > 1) throw new IssueFailure(`duplicate title ${issue.identifier}`);
      if (matches.length === 1) {
        taskId = matches[0].id;
      } else {
        const args = {
          project_id: config.projectId,
          title: want.title,
          description: want.description,
          status: want.status,
          priority: want.priority,
          label_ids: labelIds,
        };
        if (want.start_date) args.start_date = want.start_date;
        if (want.due_date) args.due_date = want.due_date;
        if (want.assignee_id) args.assignee_id = want.assignee_id;
        if (want.parent_task_id) args.parent_task_id = want.parent_task_id;
        let made;
        try {
          made = await uniwork.createTask(args);
        } catch (error) {
          // The stored parent id belongs to another workspace. Drop it and create the parent here.
          if (!isMissingTask(error) || !parentIssue) throw error;
          await reviveParent(parentIssue);
          const recovered = taskIds.get(parentIssue);
          if (!recovered) throw error;
          args.parent_task_id = recovered;
          made = await uniwork.createTask(args);
        }
        taskId = made.id;
        partial = String(made.note ?? "");
        fresh = true;
        created += 1;
      }
      await uniai.setMetadata(issue.id, "uniwork_task", taskId);
      taskIds.set(issue.id, taskId);
    }

    if (!fresh) {
      try {
        const result = await updateTask(taskId, want, labelIds);
        if (result.changed) updated += 1;
        partial = result.note;
      } catch (error) {
        if (error.code === "revision_conflict") throw new IssueFailure(`revision ${issue.id}`);
        throw error;
      }
    }

    if (partial) throw new IssueFailure(`partial ${issue.id}: ${partial}`);

    const existing = fresh ? [] : await uniwork.listTaskComments(taskId);
    const waiting = await postComments(issue, taskId, existing, note, overflow, liveComments);
    if (waiting.length > 0) {
      lines.push(`waiting comment ${issue.id}`);
      return;
    }
    await copyFiles(issue, taskId, liveComments);
    await uniai.setMetadata(issue.id, "uniwork_sync", hash);
  }

  function storedFiles(issue) {
    try {
      const parsed = JSON.parse(issue.metadata?.uniwork_files ?? "");
      if (parsed && parsed.map && typeof parsed.map === "object") return parsed;
    } catch {
      // A missing or broken record means the files still need copying.
    }
    return { map: {}, clean: false };
  }

  async function rememberFiles(issue, map, clean) {
    const record = JSON.stringify({ map, clean });
    await uniai.setMetadata(issue.id, "uniwork_files", record);
    if (!issue.metadata) issue.metadata = {};
    issue.metadata.uniwork_files = record;
  }

  async function copyFiles(issue, taskId, liveComments) {
    const sourceIds = collectAttachmentIds(issue, liveComments);
    if (sourceIds.length === 0 || !taskId) return;
    const stored = storedFiles(issue);
    if (stored.clean && sourceIds.every((id) => stored.map[id])) return;

    const map = { ...stored.map };
    let uploaded = false;
    for (const id of sourceIds) {
      if (map[id]) continue;
      const file = await uniai.downloadAttachment(id);
      const saved = await uniwork.uploadAttachment(taskId, file, "task_attachment");
      map[id] = saved.id;
      uploaded = true;
    }
    if (uploaded) await rememberFiles(issue, map, false);

    const current = await uniwork.getTask(taskId);
    const source = descriptionParts(issue.description).body;
    const basis = current?.description_truncated ? source : (current?.description ?? "");
    if (attachmentIdsIn(basis).length > 0) {
      const rewritten = rewriteAttachmentUrls(basis, map);
      if (rewritten !== (current?.description ?? "")) {
        await uniwork.updateTask({ task_id: taskId, revision: current.revision, description: rewritten });
      }
    }
    const comments = await uniwork.listTaskComments(taskId);
    for (const row of comments) {
      if (attachmentIdsIn(row.body).length === 0) continue;
      const body = rewriteAttachmentUrls(row.body ?? "", map);
      if (body !== (row.body ?? "")) await uniwork.updateComment(row.id, body);
    }
    await rememberFiles(issue, map, true);
  }

  function isMissingTask(error) {
    return error instanceof Error && error.message === "not found or not accessible";
  }

  async function forgetStoredTask(issue) {
    taskIds.delete(issue.id);
    if (issue.metadata) {
      delete issue.metadata.uniwork_task;
      delete issue.metadata.uniwork_sync;
    }
    await uniai.deleteMetadata(issue.id, "uniwork_task");
    await uniai.deleteMetadata(issue.id, "uniwork_sync");
  }

  async function reviveParent(parentId) {
    if (reviving.has(parentId)) throw new Error("not found or not accessible");
    const parent = issueById.get(parentId);
    if (!parent) throw new Error("not found or not accessible");
    reviving.add(parentId);
    try {
      await forgetStoredTask(parent);
      if (skippedIds.delete(parentId)) skipped -= 1;
      await processIssue(parent);
    } finally {
      reviving.delete(parentId);
    }
  }

  for (const id of order) {
    if (unreadable.has(id)) continue;
    const issue = issueById.get(id);
    try {
      await processIssue(issue);
    } catch (error) {
      failed = true;
      if (error.code === "unauthorized") {
        lines.push(`unauthorized ${issue.id}`);
        break;
      }
      lines.push(error instanceof IssueFailure ? error.message : `error ${issue.id}: ${error.message}`);
    }
  }

  lines.push(`created ${created}, updated ${updated}, skipped ${skipped}`);
  return { code: failed ? 1 : 0, lines };
}

const execFileAsync = promisify(execFile);
const PAGE = 100;
const UNIAI_ATTEMPTS = 3;
const UNIAI_TIMEOUT_CAP_MS = 60_000;

export function isUniaiTimeout(error) {
  const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString("utf8") : String(error?.stderr ?? "");
  return `${error?.message ?? ""}\n${stderr}`.includes("Request timed out");
}

// A bare integer is seconds, matching the CLI. Values above 60s are capped:
// a hung `issue comment list` was blocking for the whole budget, then succeeding
// immediately on a later attempt.
export function boundedUniaiTimeout(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  let ms;
  if (/^\d+$/.test(value)) {
    ms = Number(value) * 1000;
  } else {
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
    if (!match) return value;
    const amount = Number(match[1]);
    const unit = match[2];
    ms = unit === "ms" ? amount : unit === "s" ? amount * 1000 : unit === "m" ? amount * 60_000 : amount * 3_600_000;
  }
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms > UNIAI_TIMEOUT_CAP_MS) return "60s";
  if (/^\d+$/.test(value)) return `${value}s`;
  return value;
}

export async function withUniaiRetries(run, { attempts = UNIAI_ATTEMPTS, pause = async () => {} } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !isUniaiTimeout(error)) throw error;
      await pause(attempt);
    }
  }
}

function uniaiChildEnv() {
  const timeout = boundedUniaiTimeout(process.env.MULTICA_HTTP_TIMEOUT);
  if (!timeout) return process.env;
  return { ...process.env, MULTICA_HTTP_TIMEOUT: timeout };
}

async function uniaiExec(args) {
  const env = uniaiChildEnv();
  return withUniaiRetries(
    () => execFileAsync("uniai", args, { maxBuffer: 256 * 1024 * 1024, env }),
    { pause: (attempt) => sleep(1000 * attempt) },
  );
}

const MCP_PER_MINUTE = 100;
// The server allows 30 writes a minute per grant (write_rate_limited); stay under it.
const MCP_WRITES_PER_MINUTE = 25;
const MCP_WINDOW_MS = 60_000;
const MCP_RATE_RETRIES = 3;
const WRITE_TOOLS = new Set(["create_task", "update_task", "add_comment"]);

async function uniaiJson(args) {
  const { stdout } = await uniaiExec(args);
  return JSON.parse(stdout);
}

function pickRows(json, ...keys) {
  if (Array.isArray(json)) return json;
  for (const key of keys) if (Array.isArray(json?.[key])) return json[key];
  return [];
}

function makeUniai() {
  return {
    async listIssues(projectId) {
      const all = [];
      for (let offset = 0; ; offset += PAGE) {
        const json = await uniaiJson([
          "issue", "list", "--project", projectId, "--output", "json",
          "--limit", String(PAGE), "--offset", String(offset),
        ]);
        const rows = pickRows(json, "issues", "items", "data");
        all.push(...rows);
        if (rows.length < PAGE) return all;
      }
    },
    async listComments(id) {
      const json = await uniaiJson(["issue", "comment", "list", id, "--full", "--output", "json"]);
      return pickRows(json, "comments", "items", "data");
    },
    async listMembers() {
      const json = await uniaiJson(["workspace", "member", "list", "--output", "json"]);
      return pickRows(json, "members", "items", "data");
    },
    async listAgents() {
      const json = await uniaiJson(["agent", "list", "--output", "json"]);
      return pickRows(json, "agents", "items", "data");
    },
    async setMetadata(id, key, value) {
      await uniaiExec([
        "issue", "metadata", "set", id, "--key", key, "--type", "string", "--value", value,
      ]);
    },
    async deleteMetadata(id, key) {
      await uniaiExec(["issue", "metadata", "delete", id, "--key", key]);
    },
    async downloadAttachment(id) {
      const dir = mkdtempSync(join(tmpdir(), "uniai-file-"));
      try {
        await uniaiExec(["attachment", "download", id, "-o", dir]);
        const names = readdirSync(dir);
        if (names.length === 0) throw new Error(`empty download ${id}`);
        const filename = names[0];
        return { filename, bytes: readFileSync(join(dir, filename)), contentType: "application/octet-stream" };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

function httpError(response, text) {
  if (response.status === 401) {
    return Object.assign(new Error("unauthorized"), { code: "unauthorized" });
  }
  return Object.assign(new Error(`HTTP ${response.status} ${text.slice(0, 200)}`), {
    status: response.status,
  });
}

export function makeUniwork(config, env = {}) {
  const doFetch = env.fetch ?? fetch;
  const now = env.now ?? Date.now;
  const pause = env.sleep ?? ((ms) => sleep(ms));
  const calls = [];
  const writes = [];

  function prune(list, at) {
    while (list.length > 0 && at - list[0] >= MCP_WINDOW_MS) list.shift();
  }

  async function throttle(name) {
    const isWrite = WRITE_TOOLS.has(name);
    for (;;) {
      const at = now();
      prune(calls, at);
      prune(writes, at);
      let wait = 0;
      if (calls.length >= MCP_PER_MINUTE) wait = Math.max(wait, MCP_WINDOW_MS - (at - calls[0]));
      if (isWrite && writes.length >= MCP_WRITES_PER_MINUTE) {
        wait = Math.max(wait, MCP_WINDOW_MS - (at - writes[0]));
      }
      if (wait <= 0) break;
      await pause(wait);
    }
    const at = now();
    calls.push(at);
    if (isWrite) writes.push(at);
  }

  async function mcp(name, args) {
    for (let attempt = 0; ; attempt += 1) {
      await throttle(name);
      const response = await doFetch(`${config.origin}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.mcpToken}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: { workspace_id: config.workspaceId, ...args } },
        }),
      });
      const raw = await response.text();
      if (!response.ok) throw httpError(response, raw);
      const json = JSON.parse(raw);
      if (json.error) throw new Error(json.error.message ?? "mcp error");
      const text = json.result?.content?.[0]?.text ?? "";
      if (json.result?.isError) {
        if (text.startsWith("write_rate_limited:")) {
          if (attempt >= MCP_RATE_RETRIES) throw new Error(text);
          await pause(MCP_WINDOW_MS);
          continue;
        }
        const error = new Error(text);
        if (text.includes("revision_conflict")) error.code = "revision_conflict";
        throw error;
      }
      return JSON.parse(text);
    }
  }

  async function rest(method, path, body) {
    const response = await fetch(`${config.origin}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.sessionToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    if (!response.ok) throw httpError(response, raw);
    return raw ? JSON.parse(raw) : null;
  }

  return {
    async listMembers() {
      return pickRows(await rest("GET", `/api/v1/workspaces/${config.workspaceId}/members`), "members", "items", "data");
    },
    async listLabels() {
      return pickRows(await rest("GET", `/api/v1/workspaces/${config.workspaceId}/task-labels`), "labels", "items", "data");
    },
    async createLabel(name) {
      const json = await rest("POST", `/api/v1/workspaces/${config.workspaceId}/task-labels`, {
        name,
        color: "#6b7280",
        description: "",
      });
      return json?.label ?? json;
    },
    async queryTasks() {
      const all = [];
      for (let offset = 0; ; ) {
        const json = await rest("POST", `/api/v1/workspaces/${config.workspaceId}/tasks/query`, {
          project_id: config.projectId,
          limit: 200,
          offset,
        });
        const rows = pickRows(json, "tasks", "items", "data");
        all.push(...rows);
        offset += rows.length;
        if (rows.length === 0 || offset >= Number(json?.total ?? 0)) return all;
      }
    },
    async getTask(id) {
      const json = await mcp("get_task", { task_id: id });
      return json.task ?? json;
    },
    async createTask(args) {
      const json = await mcp("create_task", args);
      return { id: json.item.id, note: String(json.note ?? json.item?.note ?? "") };
    },
    async updateTask(args) {
      const json = await mcp("update_task", args);
      return { id: json.item?.id ?? args.task_id, note: String(json.note ?? json.item?.note ?? "") };
    },
    async listTaskComments(id) {
      return pickRows(await rest("GET", `/api/v1/tasks/${id}/comments`), "comments", "items", "data");
    },
    async updateComment(id, body) {
      await rest("PUT", `/api/v1/comments/${encodeURIComponent(id)}`, { body });
    },
    async uploadAttachment(taskId, file, purpose) {
      const form = new FormData();
      if (purpose) form.append("purpose", purpose);
      const type = file.contentType || "application/octet-stream";
      form.append("file", new Blob([file.bytes], { type }), file.filename || "file");
      const response = await doFetch(`${config.origin}/api/v1/tasks/${encodeURIComponent(taskId)}/attachments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.sessionToken}`,
          Accept: "application/json",
        },
        body: form,
      });
      const raw = await response.text();
      if (!response.ok) throw httpError(response, raw);
      const json = raw ? JSON.parse(raw) : {};
      const id = json.id ?? json.attachment?.id;
      if (!id) throw new Error("upload missing id");
      return { id };
    },
    async addComment(args) {
      const json = await mcp("add_comment", args);
      return { id: json.item.id };
    },
  };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export async function main() {
  const readFile = (path) => readFileSync(path, "utf8");
  const config = loadConfig(process.env, readFile);
  let ready;
  try {
    ready = await prepareConfig(config, {
      env: process.env,
      home: homedir(),
      readFile,
    });
  } catch (error) {
    return { code: 1, lines: [publicRefreshMessage(error)] };
  }
  const lock = createLock({ readFileSync, writeFileSync, unlinkSync }, () => process.pid, isAlive);
  return syncRun({ config: ready, lock, uniai: makeUniai(), uniwork: makeUniwork(ready) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, lines } = await main();
  for (const line of lines) console.log(line);
  process.exit(code);
}
