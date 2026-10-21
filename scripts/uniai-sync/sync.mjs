import { execFile } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { loadConfig } from "./config.mjs";
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

function sameSet(a, b) {
  return a.length === b.length && a.every((item) => b.includes(item));
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
    throw error;
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

  const issues = await uniai.listIssues(config.uniaiProjectId);
  const commentsByIssue = new Map();
  for (const issue of issues) commentsByIssue.set(issue.id, await uniai.listComments(issue.id));
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
    if (Object.keys(patch).length === 0) return false;
    await uniwork.updateTask({ task_id: taskId, revision: current.revision, ...patch });
    return true;
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
        taskId = (await uniwork.createTask(args)).id;
        fresh = true;
        created += 1;
      }
      await uniai.setMetadata(issue.id, "uniwork_task", taskId);
      taskIds.set(issue.id, taskId);
    }

    if (!fresh) {
      try {
        if (await updateTask(taskId, want, labelIds)) updated += 1;
      } catch (error) {
        if (error.code === "revision_conflict") throw new IssueFailure(`revision ${issue.id}`);
        throw error;
      }
    }

    const existing = fresh ? [] : await uniwork.listTaskComments(taskId);
    const waiting = await postComments(issue, taskId, existing, note, overflow, liveComments);
    if (waiting.length > 0) {
      lines.push(`waiting comment ${issue.id}`);
      return;
    }
    await uniai.setMetadata(issue.id, "uniwork_sync", hash);
  }

  for (const id of order) {
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
const MCP_PER_MINUTE = 100;
const MCP_WINDOW_MS = 60_000;

async function uniaiJson(args) {
  const { stdout } = await execFileAsync("uniai", args, { maxBuffer: 256 * 1024 * 1024 });
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
      await execFileAsync("uniai", [
        "issue", "metadata", "set", id, "--key", key, "--type", "string", "--value", value,
      ]);
    },
  };
}

function httpError(response, text) {
  if (response.status === 401) {
    return Object.assign(new Error("unauthorized"), { code: "unauthorized" });
  }
  return new Error(`HTTP ${response.status} ${text.slice(0, 200)}`);
}

function makeUniwork(config) {
  const calls = [];

  async function throttle() {
    for (;;) {
      const now = Date.now();
      while (calls.length > 0 && now - calls[0] >= MCP_WINDOW_MS) calls.shift();
      if (calls.length < MCP_PER_MINUTE) break;
      await sleep(MCP_WINDOW_MS - (now - calls[0]));
    }
    calls.push(Date.now());
  }

  async function mcp(name, args) {
    await throttle();
    const response = await fetch(`${config.origin}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.mcpToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
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
      const error = new Error(text);
      if (text.includes("revision_conflict")) error.code = "revision_conflict";
      throw error;
    }
    return JSON.parse(text);
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
      return { id: json.item.id };
    },
    async updateTask(args) {
      const json = await mcp("update_task", args);
      return { id: json.item?.id ?? args.task_id };
    },
    async listTaskComments(id) {
      return pickRows(await rest("GET", `/api/v1/tasks/${id}/comments`), "comments", "items", "data");
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
  const config = loadConfig(process.env, (path) => readFileSync(path, "utf8"));
  const lock = createLock({ readFileSync, writeFileSync, unlinkSync }, () => process.pid, isAlive);
  return syncRun({ config, lock, uniai: makeUniai(), uniwork: makeUniwork(config) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, lines } = await main();
  for (const line of lines) console.log(line);
  process.exit(code);
}
