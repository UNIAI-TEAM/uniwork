# Đồng bộ issue UniAI sang UniWork — Implementation Plan

> **Trạng thái:** in-progress — spec `docs/superpowers/specs/2026-10-21-uniai-uniwork-issue-sync-design.md` đã chốt và đã sửa sau review 2026-10-21; chưa triển khai.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một lệnh Node đọc issue dự án UniWork trên UniAI và tạo hoặc sửa task UniWork tương ứng, rồi chạy lại an toàn mỗi 15 phút.

**Architecture:** Hàm thuần ở `map.mjs` và `order.mjs` quyết định tiêu đề, hash, comment, thứ tự cha–con. `sync.mjs` xuất `syncRun(deps)` và nhận UniAI cùng UniWork đã giả được trong test. `main` chỉ nối CLI `uniai` và `fetch`. Autopilot không nằm trong code.

**Tech Stack:** Node 22, `node:test`, `node:crypto`, không thêm dependency.

**Spec:** `docs/superpowers/specs/2026-10-21-uniai-uniwork-issue-sync-design.md`

## Global Constraints

- Nguồn UniAI: workspace `uni2026`, project `57602a20-04e8-4c08-abd5-415ccd882e05`. Đích UniWork là `workspace_id` và `project_id` trong `scripts/uniai-sync/config.json`, không gắn cứng.
- Tiêu đề task là `UNI-423: {tiêu đề gốc}` trừ khi tiêu đề gốc đã bắt đầu bằng đúng mã và dấu `:` (`UNI-423:`). `UNI-4230` không tính là đã có mã `UNI-423`. Trần 500 ký tự Unicode, giữ mã.
- Mô tả task tối đa 16.000 ký tự Unicode. Phần dư một comment `<!-- uniai-description-overflow -->`, viết một lần.
- Trạng thái chỉ `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`. Khóa khác thì issue đó lỗi.
- Mức ưu tiên `none`, `low`, `medium`, `high`, `urgent`.
- Metadata `uniwork_task` và `uniwork_sync`. Không dùng custom property. CLI không có lệnh `property`.
- Comment đọc với `--full`. `deleted_at` khác rỗng thì bỏ khỏi hash và không đăng.
- Email lệch: `tranthihien.attt@gmail.com` → `hien.tran.vietants@gmail.com`, `12345mmmin@gmail.com` → `longthldz@gmail.com`, `bavinh2803@gmail.com` → `vinhnba2803.work@gmail.com`. So khớp không phân biệt hoa thường.
- MCP dưới 100 lần gọi mỗi phút. 401 dừng cả vòng và không ghi hash của issue đang làm. Issue khác đã ghi hash thì giữ.
- Hai task trùng đúng tiêu đề đã gắn mã thì không gắn, không tạo thêm.
- Không sửa server UniAI. Không xóa task. Không sửa hoặc xóa comment đã đăng.

---

### Task 1: Hàm thuần cho tiêu đề, hash, comment

**Files:**
- Create: `scripts/uniai-sync/map.mjs`
- Test: `scripts/uniai-sync/sync.test.mjs`

**Interfaces:**
- Consumes: không
- Produces:
  - `taskTitle(identifier: string, title: string): string`
  - `syncHash(issue, comments): string` — SHA-256 hex
  - `descriptionParts(description: string): { body: string, overflow: string }`
  - `commentBody({ id, name, agent, email, content }): string`
  - `assigneeNote({ id, name, agent, email }): string`
  - `mapAssignee(issue, people, agents, uniworkByEmail): { assigneeId: string | null, note: { id, name, agent, email } | null }`
  - `EMAIL_REMAP`, `STATUSES`, `DESC_LIMIT = 16000`, `TITLE_LIMIT = 500`, `COMMENT_LIMIT = 20000`

`people` là `Map` khóa `user_id`. `agents` là `Map` khóa id agent. `uniworkByEmail` là `Map` khóa email chữ thường → `{ user_id }`.

- [ ] **Step 1: Write the failing test**

Tạo `scripts/uniai-sync/sync.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  assigneeNote,
  commentBody,
  descriptionParts,
  mapAssignee,
  syncHash,
  taskTitle,
  DESC_LIMIT,
  TITLE_LIMIT,
} from "./map.mjs";

test("taskTitle prefixes the key once and cuts at 500 runes", () => {
  assert.equal(taskTitle("UNI-423", "Sửa cổng"), "UNI-423: Sửa cổng");
  assert.equal(taskTitle("UNI-423", "UNI-423: Sửa cổng"), "UNI-423: Sửa cổng");
  assert.equal(taskTitle("UNI-423", "UNI-4230: khác"), "UNI-423: UNI-4230: khác");
  const long = taskTitle("UNI-423", "à".repeat(600));
  assert.equal([...long].length, TITLE_LIMIT);
  assert.ok(long.startsWith("UNI-423: "));
});

test("syncHash ignores deleted comments and comment text", () => {
  const issue = {
    title: "A",
    description: "",
    status: "todo",
    priority: "none",
    start_date: null,
    due_date: null,
    assignee_id: "",
    labels: [{ name: "uw-backend" }, { name: "phase-C" }],
    parent_issue_id: "",
  };
  const live = [{ id: "c2", content: "một" }, { id: "c1", content: "hai" }];
  const edited = [{ id: "c2", content: "đổi" }, { id: "c1", content: "hai" }];
  const withDeleted = [...live, { id: "c3", content: "x", deleted_at: "2026-01-01T00:00:00Z" }];
  assert.equal(syncHash(issue, live), syncHash(issue, edited));
  assert.equal(syncHash(issue, live), syncHash(issue, withDeleted));
  assert.notEqual(syncHash(issue, live), syncHash({ ...issue, status: "done" }, live));
});

test("description overflow is the tail after 16000 runes", () => {
  const text = "à".repeat(DESC_LIMIT + 5);
  const parts = descriptionParts(text);
  assert.equal([...parts.body].length, DESC_LIMIT);
  assert.equal(parts.overflow, "à".repeat(5));
  assert.equal(descriptionParts("ngắn").overflow, "");
});

test("comment body keeps the marker and the author line", () => {
  const body = commentBody({
    id: "c1",
    name: "An",
    agent: false,
    email: "hien.tran.vietants@gmail.com",
    content: "xin chào",
  });
  assert.ok(body.startsWith("<!-- uniai-comment:c1 -->\n"));
  assert.ok(body.includes("An (hien.tran.vietants@gmail.com)"));
  assert.ok(body.endsWith("xin chào"));
  const agent = commentBody({ id: "c2", name: "LEVI", agent: true, email: null, content: "x" });
  assert.match(agent, /LEVI \(agent\)/);
  const huge = commentBody({ id: "c3", name: "An", agent: false, email: "a@b.c", content: "à".repeat(30000) });
  assert.equal([...huge].length, 20000);
  assert.ok(huge.startsWith("<!-- uniai-comment:c3 -->\n"));
});

test("assignee note names the UniAI person or agent", () => {
  assert.match(
    assigneeNote({ id: "a1", name: "LEVI", agent: true, email: null }),
    /<!-- uniai-assignee:a1 -->\nUniWork giao issue này cho LEVI\.\n/,
  );
  assert.match(
    assigneeNote({ id: "u1", name: "Hiền", agent: false, email: "hien.tran.vietants@gmail.com" }),
    /UniWork giao issue này cho Hiền \(hien.tran.vietants@gmail.com\)\./,
  );
});

test("mapAssignee applies the three email pairs and leaves agents unassigned", () => {
  const people = new Map([
    ["user-hien", { name: "Hiền", email: "tranthihien.attt@gmail.com" }],
    ["user-stranger", { name: "Lạ", email: "la@example.com" }],
  ]);
  const agents = new Map([["agent-1", { name: "LEVI" }]]);
  const uniwork = new Map([["hien.tran.vietants@gmail.com", { user_id: "uw-hien" }]]);
  assert.deepEqual(
    mapAssignee({ assignee_id: "user-hien", assignee_type: "member" }, people, agents, uniwork),
    { assigneeId: "uw-hien", note: null },
  );
  const stranger = mapAssignee(
    { assignee_id: "user-stranger", assignee_type: "member" },
    people,
    agents,
    uniwork,
  );
  assert.equal(stranger.assigneeId, null);
  assert.equal(stranger.note.name, "Lạ");
  const agent = mapAssignee({ assignee_id: "agent-1", assignee_type: "agent" }, people, agents, uniwork);
  assert.equal(agent.assigneeId, null);
  assert.equal(agent.note.agent, true);
  assert.equal(agent.note.name, "LEVI");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/uniai-sync/sync.test.mjs`

Expected: FAIL, không tìm thấy `./map.mjs`.

- [ ] **Step 3: Write minimal implementation**

Tạo `scripts/uniai-sync/map.mjs`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/uniai-sync/sync.test.mjs`

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/uniai-sync/map.mjs scripts/uniai-sync/sync.test.mjs
git commit -m "test(scripts): map UniAI issue fields onto UniWork task text"
```

### Task 2: Thứ tự cha–con và vòng

**Files:**
- Create: `scripts/uniai-sync/order.mjs`
- Modify: `scripts/uniai-sync/sync.test.mjs`

**Interfaces:**
- Consumes: không
- Produces: `orderIssues(issues): { order: string[], cycles: string[] }`
  - `order` là id cha trước con, không chứa id nằm trong vòng.
  - `cycles` là mọi id thuộc một vòng, mỗi id một lần.

- [ ] **Step 1: Write the failing test**

Thêm vào `scripts/uniai-sync/sync.test.mjs`:

```js
import { orderIssues } from "./order.mjs";

test("orderIssues puts parents first and reports only the cycle", () => {
  const issues = [
    { id: "child", parent_issue_id: "parent" },
    { id: "parent", parent_issue_id: null },
    { id: "a", parent_issue_id: "b" },
    { id: "b", parent_issue_id: "a" },
    { id: "tail", parent_issue_id: "a" },
  ];
  const got = orderIssues(issues);
  assert.deepEqual(got.cycles.sort(), ["a", "b"]);
  assert.ok(got.order.indexOf("parent") < got.order.indexOf("child"));
  assert.ok(got.order.includes("tail"));
  assert.ok(!got.order.includes("a"));
  assert.ok(!got.order.includes("b"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/uniai-sync/sync.test.mjs`

Expected: FAIL, không tìm thấy `./order.mjs`. Sáu test của Task 1 vẫn PASS.

- [ ] **Step 3: Write minimal implementation**

Tạo `scripts/uniai-sync/order.mjs`:

```js
export function orderIssues(issues) {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const cycles = new Set();
  const done = new Set();

  function walk(id, stack) {
    if (!byId.has(id) || done.has(id)) return;
    const at = stack.indexOf(id);
    if (at !== -1) {
      for (const item of stack.slice(at)) cycles.add(item);
      return;
    }
    stack.push(id);
    const parent = byId.get(id).parent_issue_id;
    if (parent) walk(parent, stack);
    stack.pop();
    done.add(id);
  }

  for (const issue of issues) walk(issue.id, []);

  const indegree = new Map();
  const children = new Map();
  for (const issue of issues) {
    if (cycles.has(issue.id)) continue;
    indegree.set(issue.id, 0);
    children.set(issue.id, []);
  }
  for (const issue of issues) {
    if (cycles.has(issue.id)) continue;
    const parent = issue.parent_issue_id;
    if (parent && indegree.has(parent)) {
      indegree.set(issue.id, indegree.get(issue.id) + 1);
      children.get(parent).push(issue.id);
    }
  }
  const queue = [...indegree.keys()].filter((id) => indegree.get(id) === 0);
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const child of children.get(id)) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }
  return { order, cycles: [...cycles] };
}
```

Vòng `a → b → a` được đánh dấu khi `walk` gặp lại id trong `stack`. Cha ngoài tập issue không nằm trong `cycles` và không tăng bậc của con.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/uniai-sync/sync.test.mjs`

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/uniai-sync/order.mjs scripts/uniai-sync/sync.test.mjs
git commit -m "test(scripts): order UniAI issues parents before children"
```

### Task 3: Cấu hình và khóa chạy

**Files:**
- Create: `scripts/uniai-sync/config.example.json`
- Create: `scripts/uniai-sync/lock.mjs`
- Modify: `scripts/uniai-sync/sync.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: không
- Produces:
  - `loadConfig(env, readFile): { uniaiProjectId, origin, workspaceId, projectId, mcpToken, sessionToken }`
  - `createLock(fs, pid, isAlive): { tryAcquire(): boolean, release(): void }`
  - File khóa mặc định khi chạy thật: `scripts/uniai-sync/.sync.lock`

- [ ] **Step 1: Write the failing test**

Thêm vào `scripts/uniai-sync/sync.test.mjs`:

```js
import { createLock } from "./lock.mjs";
import { loadConfig } from "./config.mjs";

test("loadConfig reads the example shape and the two tokens", () => {
  const files = new Map([
    ["scripts/uniai-sync/config.json", JSON.stringify({
      uniai_project_id: "57602a20-04e8-4c08-abd5-415ccd882e05",
      uniwork_origin: "https://uniwork.example",
      uniwork_workspace_id: "ws",
      uniwork_project_id: "prj",
    })],
  ]);
  const cfg = loadConfig(
    { UNIWORK_MCP_TOKEN: "uwm_at_x", UNIWORK_SESSION_TOKEN: "sess" },
    (path) => files.get(path),
  );
  assert.equal(cfg.workspaceId, "ws");
  assert.equal(cfg.mcpToken, "uwm_at_x");
  assert.equal(cfg.sessionToken, "sess");
  assert.equal(cfg.origin, "https://uniwork.example");
});

test("createLock refuses a live pid and replaces a dead one", () => {
  const disk = new Map();
  const fs = {
    readFileSync: (path) => {
      if (!disk.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return disk.get(path);
    },
    writeFileSync: (path, value) => disk.set(path, value),
    unlinkSync: (path) => disk.delete(path),
  };
  const first = createLock(fs, () => 11, () => true);
  assert.equal(first.tryAcquire(), true);
  const second = createLock(fs, () => 22, () => true);
  assert.equal(second.tryAcquire(), false);
  const third = createLock(fs, () => 33, () => false);
  assert.equal(third.tryAcquire(), true);
  assert.equal(disk.get("scripts/uniai-sync/.sync.lock"), "33");
  third.release();
  assert.equal(disk.has("scripts/uniai-sync/.sync.lock"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/uniai-sync/sync.test.mjs`

Expected: FAIL, không tìm thấy `./config.mjs`.

- [ ] **Step 3: Write minimal implementation**

Tạo `scripts/uniai-sync/config.example.json`:

```json
{
  "uniai_project_id": "57602a20-04e8-4c08-abd5-415ccd882e05",
  "uniwork_origin": "https://uniwork.example",
  "uniwork_workspace_id": "",
  "uniwork_project_id": ""
}
```

Tạo `scripts/uniai-sync/config.mjs`:

```js
export function loadConfig(env, readFile, path = "scripts/uniai-sync/config.json") {
  const file = JSON.parse(readFile(path));
  return {
    uniaiProjectId: file.uniai_project_id,
    origin: String(file.uniwork_origin).replace(/\/$/, ""),
    workspaceId: file.uniwork_workspace_id,
    projectId: file.uniwork_project_id,
    mcpToken: env.UNIWORK_MCP_TOKEN ?? "",
    sessionToken: env.UNIWORK_SESSION_TOKEN ?? "",
  };
}
```

Tạo `scripts/uniai-sync/lock.mjs`:

```js
const PATH = "scripts/uniai-sync/.sync.lock";

export function createLock(fs, pid, isAlive, path = PATH) {
  return {
    tryAcquire() {
      try {
        const owner = String(fs.readFileSync(path)).trim();
        if (owner && isAlive(Number(owner))) return false;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      fs.writeFileSync(path, String(pid()));
      return true;
    },
    release() {
      fs.unlinkSync(path);
    },
  };
}
```

Thêm vào `.gitignore`, sau khối `.env`:

```
scripts/uniai-sync/config.json
scripts/uniai-sync/.sync.lock
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/uniai-sync/sync.test.mjs`

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/uniai-sync/config.example.json scripts/uniai-sync/config.mjs scripts/uniai-sync/lock.mjs scripts/uniai-sync/sync.test.mjs .gitignore
git commit -m "test(scripts): load the UniWork sync config and take a pid lock"
```

### Task 4: Vòng đồng bộ

**Files:**
- Create: `scripts/uniai-sync/sync.mjs`
- Modify: `scripts/uniai-sync/sync.test.mjs`
- Modify: `scripts/check.sh` (dòng `node --test` có `scripts/app-dev-env.test.mjs`)

**Interfaces:**
- Consumes: `taskTitle`, `syncHash`, `descriptionParts`, `commentBody`, `assigneeNote`, `mapAssignee`, `STATUSES` từ `map.mjs`; `orderIssues` từ `order.mjs`; `createLock` từ `lock.mjs`; `loadConfig` từ `config.mjs`.
- Produces: `syncRun(deps): Promise<{ code: number, lines: string[] }>`
  - `deps.uniai.listIssues(projectId)`
  - `deps.uniai.listComments(issueId)` — đã là kết quả của `--full`
  - `deps.uniai.listMembers()` → `{ user_id, email, name }[]`
  - `deps.uniai.listAgents()` → `{ id, name }[]`
  - `deps.uniai.setMetadata(issueId, key, value)`
  - `deps.uniwork.listMembers()` → `{ user_id, email }[]`
  - `deps.uniwork.listLabels()` / `createLabel(name)` → `{ id, name }[]` hoặc `{ id, name }`
  - `deps.uniwork.queryTasks()` → mọi task của project, `{ id, title }[]`
  - `deps.uniwork.getTask(id)` → task MCP, có `revision`, `title`, `description`, `description_truncated`, `status`, `priority`, `assignee_id`, `start_date`, `due_date`, `parent_task_id`, `labels: { id, name }[]`
  - `deps.uniwork.createTask(args)` → `{ id }`
  - `deps.uniwork.updateTask(args)` → ném `Error` với `code === "revision_conflict"` khi cần
  - `deps.uniwork.listTaskComments(id)` → `{ id, body }[]`
  - `deps.uniwork.addComment({ task_id, body, reply_to })` → `{ id }`
  - `deps.uniwork` ném `Error` với `code === "unauthorized"` khi HTTP 401
  - `deps.config` là object `loadConfig` trả về
  - `deps.lock` tùy chọn, cùng dạng `createLock`

- [ ] **Step 1: Write the failing test**

Thêm vào cuối `scripts/uniai-sync/sync.test.mjs` các test dưới. Dùng helper `world()` trong cùng file.

```js
import { syncRun } from "./sync.mjs";

function world(issues, comments = {}) {
  const mcp = [];
  const metadata = new Map();
  const tasks = [];
  const commentsByTask = new Map();
  let seq = 0;
  const uniworkMembers = [
    { user_id: "uw-hien", email: "hien.tran.vietants@gmail.com" },
  ];
  const labels = [];
  return {
    mcp,
    metadata,
    tasks,
    deps: {
      config: {
        uniaiProjectId: "57602a20-04e8-4c08-abd5-415ccd882e05",
        origin: "https://uniwork.example",
        workspaceId: "ws",
        projectId: "prj",
        mcpToken: "uwm_at_x",
        sessionToken: "sess",
      },
      lock: { tryAcquire: () => true, release: () => {} },
      uniai: {
        listIssues: async () => issues,
        listComments: async (id) => comments[id] ?? [],
        listMembers: async () => [
          { user_id: "user-hien", email: "tranthihien.attt@gmail.com", name: "Hiền" },
        ],
        listAgents: async () => [{ id: "agent-1", name: "LEVI" }],
        setMetadata: async (id, key, value) => {
          const row = metadata.get(id) ?? {};
          row[key] = value;
          metadata.set(id, row);
        },
      },
      uniwork: {
        listMembers: async () => uniworkMembers,
        listLabels: async () => labels,
        createLabel: async (name) => {
          const row = { id: `label-${name}`, name };
          labels.push(row);
          return row;
        },
        queryTasks: async () => tasks.map((task) => ({ id: task.id, title: task.title })),
        getTask: async (id) => tasks.find((task) => task.id === id),
        createTask: async (args) => {
          mcp.push(["create_task", args]);
          const task = { id: `task-${++seq}`, revision: 1, labels: [], description_truncated: false, ...args };
          tasks.push(task);
          commentsByTask.set(task.id, []);
          return { id: task.id };
        },
        updateTask: async (args) => {
          mcp.push(["update_task", args]);
          const task = tasks.find((item) => item.id === args.task_id);
          if (task.failRevision) {
            task.failRevision = false;
            const error = new Error("revision_conflict");
            error.code = "revision_conflict";
            throw error;
          }
          Object.assign(task, args, { revision: task.revision + 1 });
          return { id: task.id };
        },
        listTaskComments: async (id) => commentsByTask.get(id) ?? [],
        addComment: async (args) => {
          mcp.push(["add_comment", args]);
          const row = { id: `c-${++seq}`, body: args.body };
          commentsByTask.get(args.task_id).push(row);
          return { id: row.id };
        },
      },
    },
  };
}

function issue(partial) {
  return {
    title: "Việc",
    description: "",
    status: "todo",
    priority: "none",
    start_date: null,
    due_date: null,
    assignee_id: "",
    assignee_type: "",
    labels: [],
    parent_issue_id: null,
    metadata: {},
    ...partial,
  };
}

test("sync creates a parent before a child and stores metadata before comments", async () => {
  const box = world(
    [
      issue({ id: "child", identifier: "UNI-2", parent_issue_id: "parent" }),
      issue({ id: "parent", identifier: "UNI-1", title: "Cha" }),
    ],
    { parent: [{ id: "note-1", author_id: "user-hien", author_type: "member", content: "đã xem", created_at: "2026-01-01T00:00:00Z" }] },
  );
  const order = [];
  const create = box.deps.uniwork.createTask;
  box.deps.uniwork.createTask = async (args) => {
    order.push(args.title);
    return create(args);
  };
  const setMetadata = box.deps.uniai.setMetadata;
  box.deps.uniai.setMetadata = async (id, key, value) => {
    if (key === "uniwork_task") order.push(`meta:${id}`);
    return setMetadata(id, key, value);
  };
  const add = box.deps.uniwork.addComment;
  box.deps.uniwork.addComment = async (args) => {
    order.push("comment");
    return add(args);
  };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  assert.ok(order.indexOf("UNI-1: Cha") < order.indexOf("meta:parent"));
  assert.ok(order.indexOf("meta:parent") < order.indexOf("comment"));
  assert.ok(order.indexOf("UNI-1: Cha") < order.indexOf("UNI-2: Việc"));
  assert.ok(box.mcp.some((call) => call[0] === "add_comment" && String(call[1].body).includes("uniai-comment:note-1")));
  assert.ok(box.mcp.some((call) => call[0] === "add_comment" && String(call[1].body).includes("Hiền (hien.tran.vietants@gmail.com)")));
});

test("a second run with the same hash does not call update_task", async () => {
  const box = world([issue({ id: "only", identifier: "UNI-10", title: "Một" })]);
  await syncRun(box.deps);
  box.mcp.length = 0;
  box.deps.uniai.listIssues = async () => [
    issue({ id: "only", identifier: "UNI-10", title: "Một", metadata: box.metadata.get("only"), updated_at: "2099-01-01T00:00:00Z" }),
  ];
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  assert.deepEqual(box.mcp, []);
});

test("an agent assignee is empty and commented once", async () => {
  const box = world([
    issue({ id: "ag", identifier: "UNI-11", assignee_id: "agent-1", assignee_type: "agent" }),
  ]);
  await syncRun(box.deps);
  await syncRun(box.deps);
  const notes = box.mcp.filter((call) => call[0] === "add_comment" && String(call[1].body).includes("uniai-assignee:"));
  assert.equal(notes.length, 1);
  assert.match(notes[0][1].body, /UniWork giao issue này cho LEVI\./);
  assert.equal(box.tasks[0].assignee_id, undefined);
});

test("a child waits until the parent has a task id", async () => {
  const box = world([issue({ id: "child", identifier: "UNI-2", parent_issue_id: "missing-parent" })]);
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.equal(box.tasks.length, 0);
  assert.match(result.lines.join("\n"), /missing-parent/);
});

test("an unknown status fails that issue and continues", async () => {
  const box = world([
    issue({ id: "bad", identifier: "UNI-3", status: "triage" }),
    issue({ id: "good", identifier: "UNI-4", title: "Được" }),
  ]);
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.equal(box.tasks.length, 1);
  assert.equal(box.tasks[0].title, "UNI-4: Được");
});

test("title recovery attaches the only exact title and refuses two", async () => {
  const box = world([issue({ id: "one", identifier: "UNI-5", title: "Lạc" })]);
  box.tasks.push({ id: "already", title: "UNI-5: Lạc", revision: 4, labels: [], description: "", status: "todo", priority: "none" });
  box.deps.uniwork.queryTasks = async () => box.tasks.map((task) => ({ id: task.id, title: task.title }));
  await syncRun(box.deps);
  assert.equal(box.metadata.get("one").uniwork_task, "already");
  assert.equal(box.mcp.filter((call) => call[0] === "create_task").length, 0);

  const two = world([issue({ id: "two", identifier: "UNI-6", title: "Đôi" })]);
  two.tasks.push(
    { id: "a", title: "UNI-6: Đôi", revision: 1, labels: [] },
    { id: "b", title: "UNI-6: Đôi", revision: 1, labels: [] },
  );
  const result = await syncRun(two.deps);
  assert.equal(result.code, 1);
  assert.equal(two.mcp.filter((call) => call[0] === "create_task").length, 0);
  assert.equal(two.metadata.has("two"), false);
});

test("revision_conflict retries once", async () => {
  const box = world([issue({ id: "rev", identifier: "UNI-7", title: "Cũ" })]);
  await syncRun(box.deps);
  box.tasks[0].failRevision = true;
  box.mcp.length = 0;
  box.deps.uniai.listIssues = async () => [
    issue({ id: "rev", identifier: "UNI-7", title: "Mới", metadata: box.metadata.get("rev") }),
  ];
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  assert.equal(box.mcp.filter((call) => call[0] === "update_task").length, 2);
  assert.equal(box.tasks[0].title, "UNI-7: Mới");
});

test("401 stops the run and does not write the hash", async () => {
  const box = world([
    issue({ id: "first", identifier: "UNI-8", title: "Trước" }),
    issue({ id: "second", identifier: "UNI-9", title: "Sau" }),
  ]);
  box.deps.uniwork.createTask = async () => {
    const error = new Error("unauthorized");
    error.code = "unauthorized";
    throw error;
  };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.equal(box.metadata.has("first"), false);
  assert.equal(box.metadata.has("second"), false);
});

test("a cycle is reported and creates nothing in the cycle", async () => {
  const box = world([
    issue({ id: "a", identifier: "UNI-20", parent_issue_id: "b" }),
    issue({ id: "b", identifier: "UNI-21", parent_issue_id: "a" }),
  ]);
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.equal(box.tasks.length, 0);
  assert.match(result.lines.join("\n"), /cycle/);
});

test("description overflow is commented once", async () => {
  const box = world([
    issue({ id: "long", identifier: "UNI-22", description: "à".repeat(16005) }),
  ]);
  await syncRun(box.deps);
  await syncRun(box.deps);
  const overflows = box.mcp.filter((call) => call[0] === "add_comment" && String(call[1].body).includes("uniai-description-overflow"));
  assert.equal(overflows.length, 1);
  assert.equal([...box.tasks[0].description].length, 16000);
});

test("a held lock exits 0 and does not list issues", async () => {
  const box = world([issue({ id: "x", identifier: "UNI-23" })]);
  let listed = 0;
  box.deps.uniai.listIssues = async () => {
    listed += 1;
    return [];
  };
  box.deps.lock = { tryAcquire: () => false, release: () => {} };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  assert.equal(listed, 0);
  assert.match(result.lines.join("\n"), /already running/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/uniai-sync/sync.test.mjs`

Expected: FAIL, không tìm thấy `./sync.mjs`. Các test Task 1–3 vẫn PASS.

- [ ] **Step 3: Write minimal implementation**

Tạo `scripts/uniai-sync/sync.mjs` với `syncRun` làm đúng các việc sau, theo thứ tự:

1. `lock.tryAcquire()` sai thì trả `{ code: 0, lines: ["already running"] }`. `finally` gọi `release()` chỉ khi acquire thành công.
2. `listMembers` của cả hai phía, `listAgents`, `listLabels`. Email UniWork đưa vào `Map` chữ thường. Hai nhãn cùng tên thì ghi nhận để issue nào cần tên đó bị lỗi `duplicate label`.
3. `listIssues`. Comment từng issue qua `listComments`. `orderIssues`.
4. Với mỗi id trong `cycles`, thêm dòng `cycle <id>` và đánh dấu lỗi. Không tạo task cho id đó.
5. Với mỗi id trong `order`:
   - `status` không thuộc `STATUSES` → dòng `bad status <id>`, sang issue sau.
   - Cha có `parent_issue_id` không thuộc tập issue → dòng `parent outside <parent>`, mã lỗi, không tạo.
   - Cha nằm trong `cycles` → dòng `cycle parent <id>`, tính là lỗi, không tạo. Cha thuộc tập issue nhưng chưa có `uniwork_task` vì cha lỗi ở vòng này → dòng `waiting <id>`, không tính thêm lỗi. Test "child waits" dùng cha `missing-parent` không có trong tập, nên đó là lỗi `parent outside`, `code` 1, không tạo task.
   - Hash trùng `metadata.uniwork_sync` và đã có `uniwork_task` → bỏ qua, không gọi `update_task`.
   - Chưa có `uniwork_task`: `queryTasks()`, giữ task có `title` đúng bằng `taskTitle`. 0 task thì `createTask` rồi `setMetadata(id, "uniwork_task", id mới)` trước mọi `addComment`. 1 task thì chỉ ghi metadata. Từ 2 task thì dòng `duplicate title <identifier>`, không ghi metadata.
   - `getTask`. So với giá trị muốn ghi. Khác thì `updateTask` kèm `revision`. `revision_conflict` thì `getTask` lại và `updateTask` đúng một lần nữa. Lần thứ hai vẫn ném thì dòng `revision <id>` và không ghi hash.
   - `assignee_id` muốn gán là `mapAssignee(...).assigneeId`. `null` thì gửi `null` khi update, và bỏ field khi create. Nhãn: tạo thiếu bằng `createLabel`. Create gửi `label_ids`. Update gửi `add_label_ids` và `remove_label_ids`.
   - Comment sống, sort `created_at` rồi `id`. Bỏ qua body đã chứa `<!-- uniai-comment:<id> -->`. `reply_to` lấy từ comment UniWork của cha nếu cha còn trong tập comment sống và đã đăng. Cha đã xóa thì đăng không `reply_to`.
   - Note assignee và overflow chỉ khi marker chưa có trong comment UniWork.
   - Hết comment cần đăng thì `setMetadata(id, "uniwork_sync", hash)`.
6. `unauthorized` thoát vòng ngay, không ghi hash của issue đang làm. `code` 1.
7. Còn dòng lỗi thì `code` 1, không thì 0. Dòng cuối gồm số tạo, số sửa, số bỏ qua.
8. `main` đọc config bằng `readFileSync`, dựng lock bằng `createLock` với `process.pid` và `process.kill(pid, 0)`, gọi CLI:

```text
uniai issue list --project <uniaiProjectId> --output json --limit 100 --offset <n>
uniai issue comment list <id> --full --output json
uniai workspace member list --output json
uniai agent list --output json
uniai issue metadata set <id> --key <key> --type string --value <value>
```

Lật `issue list` đến khi trang ngắn hơn 100. MCP là `POST <origin>/mcp`, body `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}`, header `Authorization: Bearer <mcpToken>`, `Content-Type: application/json`, `Accept: application/json`. Kết quả là JSON trong `result.content[0].text`. `result.isError` và chữ `revision_conflict` thành `error.code`. HTTP 401 thành `error.code = "unauthorized"`. Trước mỗi lần MCP, nếu đã đủ 100 lần trong 60 giây thì `await` phần giây còn lại. REST dùng `UNIWORK_SESSION_TOKEN`:

```text
GET  <origin>/api/v1/workspaces/<workspaceId>/members
GET  <origin>/api/v1/workspaces/<workspaceId>/task-labels
POST <origin>/api/v1/workspaces/<workspaceId>/task-labels
POST <origin>/api/v1/workspaces/<workspaceId>/tasks/query
GET  <origin>/api/v1/tasks/<taskId>/comments
```

`tasks/query` body `{ "project_id": "<projectId>", "limit": 200, "offset": <n> }` đến khi `offset >= total`.

`identifier` thiếu thì dùng `id` không được. Issue list thật luôn có `identifier`. Test phải truyền `identifier`.

Cuối file:

```js
import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, lines } = await main();
  for (const line of lines) console.log(line);
  process.exit(code);
}
```

Trong `scripts/check.sh`, ngay sau `scripts/app-dev-env.test.mjs` trên lệnh `node --test`, thêm `scripts/uniai-sync/sync.test.mjs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/uniai-sync/sync.test.mjs`

Expected: PASS, mọi test trong file, gồm 9 test của Task 1–3 và các test vòng đồng bộ của Task 4.

- [ ] **Step 5: Commit**

```bash
git add scripts/uniai-sync/sync.mjs scripts/uniai-sync/sync.test.mjs scripts/check.sh
git commit -m "feat(scripts): sync UniAI issues into UniWork tasks"
```

### Task 5: Đối chiếu với spec

**Files:**
- Modify: `scripts/uniai-sync/sync.test.mjs` chỉ khi Step 1 phát hiện một ca spec chưa có test

**Interfaces:**
- Consumes: `syncRun` của Task 4
- Produces: không có API mới

- [ ] **Step 1: Walk the spec**

Đối từng dòng spec với một assert đang có. Ca chưa có thì thêm test rồi sửa `sync.mjs` cho xanh, không nới assert:

| Spec | Test |
| --- | --- |
| Tiêu đề, cắt 500, không nuốt `UNI-4230` | `taskTitle prefixes` |
| Hash bỏ comment đã xóa và không đổi khi sửa nội dung | `syncHash ignores` |
| Mô tả dư một lần | `description overflow` |
| Ba email, agent, người lạ | `mapAssignee` và `an agent assignee` |
| Cha trước con, metadata trước comment | `sync creates a parent` |
| Hash trùng không `update_task` | `a second run` |
| Cha ngoài dự án | `a child waits` |
| Trạng thái lạ, issue sau vẫn tạo | `an unknown status` |
| Một tiêu đề thì gắn, hai tiêu đề thì dừng | `title recovery` |
| `revision_conflict` một lần | `revision_conflict retries once` |
| 401 không ghi hash, không sang issue sau | `401 stops` |
| Vòng cha | `a cycle` |
| Khóa pid | `a held lock` |
| Nhãn tạo khi thiếu, tên trùng thì lỗi issue đó | thêm nếu chưa có: một issue nhãn `uw-backend` gọi `createLabel` một lần; hai label cùng tên trong `listLabels` thì issue đó `code` 1 và không `create_task` |
| Reply: cha comment đã xóa thì không `reply_to`; cha chưa đăng thì chưa ghi hash | thêm nếu chưa có |

- [ ] **Step 2: Run the suite**

Run: `node --test scripts/uniai-sync/sync.test.mjs`

Expected: PASS.

- [ ] **Step 3: Commit chỉ nếu Step 1 sửa file**

```bash
git add scripts/uniai-sync/sync.mjs scripts/uniai-sync/sync.test.mjs
git commit -m "test(scripts): cover label and comment reply rules of the UniAI sync"
```

Không có diff thì không commit.

## Self-review đã làm khi viết plan

- Spec §3–§7 có task: map (Task 1), thứ tự (Task 2), khóa và config (Task 3), vòng MCP/REST/metadata (Task 4), lỗ nhãn và reply (Task 5).
- Autopilot, grant MCP và phiên là việc người làm ở spec §8, không có task code.
- CLI `property` không được gọi. Metadata key là `uniwork_task` và `uniwork_sync`.
- `tasks/query` không gửi trường search.
