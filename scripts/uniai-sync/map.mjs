import { createHash } from "node:crypto";

export const DESC_LIMIT = 16000;
export const TITLE_LIMIT = 500;
export const COMMENT_LIMIT = 20000;

export const STATUSES = new Set([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
]);

export const EMAIL_REMAP = new Map([
  ["tranthihien.attt@gmail.com", "hien.tran.vietants@gmail.com"],
  ["12345mmmin@gmail.com", "longthldz@gmail.com"],
  ["bavinh2803@gmail.com", "vinhnba2803.work@gmail.com"],
]);

function runes(value) {
  return Array.from(value ?? "");
}

export function taskTitle(identifier, title) {
  const prefix = `${identifier}: `;
  const raw = title.startsWith(prefix) ? title : `${prefix}${title}`;
  const chars = runes(raw);
  if (chars.length <= TITLE_LIMIT) return raw;
  return chars.slice(0, TITLE_LIMIT).join("");
}

export function descriptionParts(description) {
  const chars = runes(description ?? "");
  return {
    body: chars.slice(0, DESC_LIMIT).join(""),
    overflow: chars.slice(DESC_LIMIT).join(""),
  };
}

function cut(value, limit) {
  const chars = runes(value);
  return chars.length <= limit ? chars.join("") : chars.slice(0, limit).join("");
}

export function commentBody({ id, name, agent, email, content }) {
  const who = agent ? `${name} (agent)` : `${name} (${email})`;
  const header = `<!-- uniai-comment:${id} -->\n${who}\n\n`;
  return cut(header + (content ?? ""), COMMENT_LIMIT);
}

export function assigneeNote({ id, name, agent, email }) {
  const line = agent || !email
    ? `UniWork giao issue này cho ${name}.`
    : `UniWork giao issue này cho ${name} (${email}).`;
  return `<!-- uniai-assignee:${id} -->\n${line}\n`;
}

export function syncHash(issue, comments) {
  const labels = (issue.labels ?? []).map((label) => label.name).sort();
  const commentIds = (comments ?? [])
    .filter((comment) => !comment.deleted_at)
    .map((comment) => comment.id)
    .sort();
  const canonical = JSON.stringify({
    title: issue.title ?? "",
    description: issue.description ?? "",
    status: issue.status ?? "",
    priority: issue.priority ?? "",
    start_date: issue.start_date ?? "",
    due_date: issue.due_date ?? "",
    assignee_id: issue.assignee_id ?? "",
    labels,
    parent_issue_id: issue.parent_issue_id ?? "",
    comment_ids: commentIds,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function mapAssignee(issue, people, agents, uniworkByEmail) {
  if (!issue.assignee_id) return { assigneeId: null, note: null };
  if (issue.assignee_type === "agent") {
    const agent = agents.get(issue.assignee_id);
    return {
      assigneeId: null,
      note: { id: issue.assignee_id, name: agent?.name || issue.assignee_id, agent: true, email: null },
    };
  }
  const person = people.get(issue.assignee_id);
  const email = (person?.email ?? "").trim().toLowerCase();
  const mapped = EMAIL_REMAP.get(email) || email;
  const hit = mapped ? uniworkByEmail.get(mapped) : undefined;
  if (hit) return { assigneeId: hit.user_id, note: null };
  return {
    assigneeId: null,
    note: {
      id: issue.assignee_id,
      name: person?.name || issue.assignee_id,
      agent: false,
      email: mapped || null,
    },
  };
}
