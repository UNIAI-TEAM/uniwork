import { z } from "zod";
import {
  ProjectResourceSchema,
  ProjectSchema,
  type Project,
  type ProjectResource,
} from "../../types/project";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const ProjectListResponse = z.object({
  projects: z.array(ProjectSchema),
  total: z.number(),
});
const ProjectResponse = z.object({ project: ProjectSchema });
const ResourceListResponse = z.object({
  resources: z.array(ProjectResourceSchema),
  total: z.number(),
});
const ResourceResponse = z.object({ resource: ProjectResourceSchema });

export type ProjectList = z.infer<typeof ProjectListResponse>;
export type ProjectResourceList = z.infer<typeof ResourceListResponse>;

export interface CreateProjectBody {
  title: string;
  description?: string;
  icon?: string | null;
  status?: string;
  priority?: string;
  lead_type?: string | null;
  lead_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  resources?: Array<{
    resource_type: string;
    resource_ref: unknown;
    label?: string | null;
    position?: number;
  }>;
}

export interface PutProjectBody {
  revision?: number;
  title?: string;
  description?: string;
  icon?: string | null;
  status?: string;
  priority?: string;
  lead_type?: string | null;
  lead_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
}

export interface CreateProjectResourceBody {
  resource_type: string;
  resource_ref: unknown;
  label?: string | null;
  position?: number;
}

export interface PutProjectResourceBody {
  resource_ref?: unknown;
  label?: string | null;
  position?: number;
}

const enc = encodeURIComponent;

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function listProjects(
  workspaceId: string,
  opts: { status?: string; priority?: string } = {},
): Promise<ProjectList> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/projects${qs(opts)}`);
  return parseWithFallback(raw, ProjectListResponse, { projects: [], total: 0 }, {
    endpoint: "GET /api/v1/workspaces/{ws}/projects",
  });
}

export async function searchProjects(
  workspaceId: string,
  opts: { q?: string; include_closed?: boolean; limit?: number; offset?: number } = {},
): Promise<ProjectList> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/projects/search${qs(opts)}`,
  );
  return parseWithFallback(raw, ProjectListResponse, { projects: [], total: 0 }, {
    endpoint: "GET /api/v1/workspaces/{ws}/projects/search",
  });
}

export async function createProject(
  workspaceId: string,
  body: CreateProjectBody,
): Promise<Project | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/projects`, {
    method: "POST",
    body,
  });
  return parseWithFallback<{ project: Project } | null>(raw, ProjectResponse, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/projects",
  })?.project ?? null;
}

export async function getProject(
  workspaceId: string,
  projectId: string,
): Promise<Project | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/projects/${enc(projectId)}`,
  );
  return parseWithFallback<{ project: Project } | null>(raw, ProjectResponse, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/projects/{id}",
  })?.project ?? null;
}

export async function putProject(
  workspaceId: string,
  projectId: string,
  body: PutProjectBody,
  opts?: { ifMatch?: string },
): Promise<Project | null> {
  const headers: Record<string, string> = {};
  if (opts?.ifMatch) headers["If-Match"] = opts.ifMatch;
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/projects/${enc(projectId)}`,
    { method: "PUT", body, headers },
  );
  return parseWithFallback<{ project: Project } | null>(raw, ProjectResponse, null, {
    endpoint: "PUT /api/v1/workspaces/{ws}/projects/{id}",
  })?.project ?? null;
}

export async function deleteProject(workspaceId: string, projectId: string): Promise<void> {
  await request(`/api/v1/workspaces/${enc(workspaceId)}/projects/${enc(projectId)}`, {
    method: "DELETE",
  });
}

export async function listProjectResources(
  workspaceId: string,
  projectId: string,
): Promise<ProjectResourceList> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/projects/${enc(projectId)}/resources`,
  );
  return parseWithFallback(raw, ResourceListResponse, { resources: [], total: 0 }, {
    endpoint: "GET /api/v1/workspaces/{ws}/projects/{id}/resources",
  });
}

export async function createProjectResource(
  workspaceId: string,
  projectId: string,
  body: CreateProjectResourceBody,
): Promise<ProjectResource | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/projects/${enc(projectId)}/resources`,
    { method: "POST", body },
  );
  return parseWithFallback<{ resource: ProjectResource } | null>(raw, ResourceResponse, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/projects/{id}/resources",
  })?.resource ?? null;
}

export async function putProjectResource(
  workspaceId: string,
  projectId: string,
  resourceId: string,
  body: PutProjectResourceBody,
): Promise<ProjectResource | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/projects/${enc(projectId)}/resources/${enc(resourceId)}`,
    { method: "PUT", body },
  );
  return parseWithFallback<{ resource: ProjectResource } | null>(raw, ResourceResponse, null, {
    endpoint: "PUT /api/v1/workspaces/{ws}/projects/{id}/resources/{resourceID}",
  })?.resource ?? null;
}

export async function deleteProjectResource(
  workspaceId: string,
  projectId: string,
  resourceId: string,
): Promise<void> {
  await request(
    `/api/v1/workspaces/${enc(workspaceId)}/projects/${enc(projectId)}/resources/${enc(resourceId)}`,
    { method: "DELETE" },
  );
}
