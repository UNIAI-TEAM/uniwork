import { expect, type Page } from "@playwright/test";

/**
 * API seeding for task specs. The web app talks to the API with a bearer token
 * held in memory, so the spec borrows it from the page's own requests — and the
 * API origin with it, which differs between local worktrees and CI.
 */
export interface SeedAuth {
  /** API origin, e.g. `http://localhost:8080`. */
  api: string;
  /** The `authorization` header value the page sends. */
  auth: string;
  wsId: string;
}

export interface SeededTask {
  id: string;
  title: string;
  number: number;
  /** Set on a child created by `withChildrenEvery`. */
  parentId?: string;
}

const WORKSPACE_REQUEST = /^(https?:\/\/[^/]+)\/api\/v1\/workspaces\/([0-9A-HJKMNP-TV-Z]{26})(?:\/|$|\?)/;

/**
 * Reloads the page and reads the first authenticated workspace API request.
 * Call it on a workspace route (e.g. /tasks).
 */
export async function captureAuth(page: Page): Promise<SeedAuth> {
  const request = page.waitForRequest(
    (req) => WORKSPACE_REQUEST.test(req.url()) && Boolean(req.headers()["authorization"]),
    { timeout: 30_000 },
  );
  await page.reload();
  const req = await request;
  const match = WORKSPACE_REQUEST.exec(req.url());
  if (!match) throw new Error(`unexpected workspace request ${req.url()}`);
  return { api: match[1], wsId: match[2], auth: req.headers()["authorization"] };
}

async function post<T>(page: Page, a: SeedAuth, path: string, data: unknown): Promise<T> {
  const res = await page.request.post(`${a.api}/api/v1/workspaces/${a.wsId}${path}`, {
    headers: { authorization: a.auth, "content-type": "application/json" },
    data,
  });
  if (!res.ok()) {
    throw new Error(`POST ${path} failed: HTTP ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function createTask(
  page: Page,
  a: SeedAuth,
  body: { title: string; priority?: string; project_id?: string; parent_task_id?: string },
): Promise<{ id: string; number: number }> {
  const { task } = await post<{ task: { id: string; number: number } }>(page, a, "/tasks", body);
  expect(task.id).toBeTruthy();
  return task;
}

/**
 * Creates `n` root tasks, oldest first, titled `Việc NNN` where NNN is a
 * scrambled index — creation order and title order disagree, so a title sort
 * is observable. `withChildrenEvery: k` gives roots 0, k, 2k… one child each
 * (`Con NNN`, created right after its parent); `projectIds` are assigned round
 * robin with every third root left without a project. Returns roots and
 * children in creation order.
 */
export async function seedTasks(
  page: Page,
  a: SeedAuth,
  n: number,
  opts: { withChildrenEvery?: number; projectIds?: string[] } = {},
): Promise<SeededTask[]> {
  const seeded: SeededTask[] = [];
  const projects = opts.projectIds ?? [];
  for (let i = 0; i < n; i += 1) {
    // 47 is coprime with any n that is not a multiple of 47: titles stay unique.
    const code = String((i * 47) % n).padStart(3, "0");
    const title = `Việc ${code}`;
    const slot = projects.length > 0 ? i % (projects.length + 1) : projects.length;
    const project_id = slot < projects.length ? projects[slot] : undefined;
    const root = await createTask(page, a, {
      title,
      ...(i === 0 ? { priority: "urgent" } : {}),
      ...(project_id ? { project_id } : {}),
    });
    seeded.push({ id: root.id, title, number: root.number });
    if (opts.withChildrenEvery && i % opts.withChildrenEvery === 0) {
      const childTitle = `Con ${code}`;
      const child = await createTask(page, a, { title: childTitle, parent_task_id: root.id });
      seeded.push({ id: child.id, title: childTitle, number: child.number, parentId: root.id });
    }
  }
  return seeded;
}

export async function createProject(page: Page, a: SeedAuth, title: string): Promise<string> {
  const { project } = await post<{ project: { id: string } }>(page, a, "/projects", {
    title,
    status: "planned",
    priority: "none",
  });
  return project.id;
}

/** A select property whose option values are `opt-<index>`, labelled by `options`. */
export async function createSelectProperty(
  page: Page,
  a: SeedAuth,
  name: string,
  options: string[],
): Promise<{ id: string; optionIds: string[] }> {
  const optionIds = options.map((_, index) => `opt-${index}`);
  const { property } = await post<{ property: { id: string } }>(page, a, "/task-properties", {
    name,
    type: "select",
    config: { options: options.map((label, index) => ({ value: optionIds[index], label })) },
  });
  return { id: property.id, optionIds };
}
