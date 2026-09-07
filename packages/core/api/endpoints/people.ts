import { z } from "zod";
import {
  DepartmentSchema,
  PersonSchema,
  ActorSchema,
  type Actor,
  type Department,
  type DepartmentInput,
  type PeopleFilters,
  type Person,
  type ProfileInput,
} from "../../types/people";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const PeopleListResponse = z.object({
  people: z.array(PersonSchema),
  next_cursor: z.string().optional(),
  total_active: z.number().default(0),
});
const PersonResponse = z.object({ person: PersonSchema, reports: z.array(ActorSchema).default([]) });
const DepartmentsResponse = z.object({ departments: z.array(DepartmentSchema) });
const DepartmentResponse = z.object({ department: DepartmentSchema });

export interface PeoplePage {
  people: Person[];
  next_cursor?: string;
  total_active: number;
}

export interface PersonDetail {
  person: Person | null;
  reports: Actor[];
}

const EMPTY_PAGE: PeoplePage = { people: [], total_active: 0 };

function peopleQuery(filters: PeopleFilters, cursor?: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function listPeople(orgSlug: string, filters: PeopleFilters, cursor?: string): Promise<PeoplePage> {
  const raw = await request(
    `/api/v1/orgs/${encodeURIComponent(orgSlug)}/people${peopleQuery(filters, cursor)}`,
  );
  return parseWithFallback<PeoplePage>(raw, PeopleListResponse, EMPTY_PAGE, {
    endpoint: "GET /api/v1/orgs/{org}/people",
  });
}

export async function getPerson(orgSlug: string, userId: string): Promise<PersonDetail> {
  const raw = await request(
    `/api/v1/orgs/${encodeURIComponent(orgSlug)}/people/${encodeURIComponent(userId)}`,
  );
  return parseWithFallback<PersonDetail>(raw, PersonResponse, { person: null, reports: [] }, {
    endpoint: "GET /api/v1/orgs/{org}/people/{userID}",
  });
}

export async function updateProfile(
  orgSlug: string,
  userId: string,
  body: ProfileInput,
): Promise<PersonDetail> {
  const raw = await request(
    `/api/v1/orgs/${encodeURIComponent(orgSlug)}/people/${encodeURIComponent(userId)}/profile`,
    { method: "PATCH", body },
  );
  return parseWithFallback<PersonDetail>(raw, PersonResponse, { person: null, reports: [] }, {
    endpoint: "PATCH /api/v1/orgs/{org}/people/{userID}/profile",
  });
}

/**
 * The CSV export is a browser navigation, not a fetch: the response is a file
 * the browser saves, and the session cookie travels with it. Callers put this
 * on an `<a href>` rather than reading it into memory.
 */
export function exportPeopleUrl(orgSlug: string, apiUrl: string): string {
  return `${apiUrl}/api/v1/orgs/${encodeURIComponent(orgSlug)}/people.csv`;
}

export async function listDepartments(orgSlug: string, includeArchived = false): Promise<Department[]> {
  const suffix = includeArchived ? "?include_archived=true" : "";
  const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgSlug)}/departments${suffix}`);
  return parseWithFallback<{ departments: Department[] }>(raw, DepartmentsResponse, { departments: [] }, {
    endpoint: "GET /api/v1/orgs/{org}/departments",
  }).departments;
}

export async function createDepartment(orgSlug: string, body: DepartmentInput): Promise<Department | null> {
  const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgSlug)}/departments`, {
    method: "POST",
    body,
  });
  return parseWithFallback<{ department: Department } | null>(raw, DepartmentResponse, null, {
    endpoint: "POST /api/v1/orgs/{org}/departments",
  })?.department ?? null;
}

export async function updateDepartment(
  orgSlug: string,
  departmentId: string,
  body: DepartmentInput,
): Promise<Department | null> {
  const raw = await request(
    `/api/v1/orgs/${encodeURIComponent(orgSlug)}/departments/${encodeURIComponent(departmentId)}`,
    { method: "PATCH", body },
  );
  return parseWithFallback<{ department: Department } | null>(raw, DepartmentResponse, null, {
    endpoint: "PATCH /api/v1/orgs/{org}/departments/{departmentId}",
  })?.department ?? null;
}

export async function archiveDepartment(orgSlug: string, departmentId: string): Promise<Department | null> {
  const raw = await request(
    `/api/v1/orgs/${encodeURIComponent(orgSlug)}/departments/${encodeURIComponent(departmentId)}/archive`,
    { method: "POST" },
  );
  return parseWithFallback<{ department: Department } | null>(raw, DepartmentResponse, null, {
    endpoint: "POST /api/v1/orgs/{org}/departments/{departmentId}/archive",
  })?.department ?? null;
}

export async function reorderDepartments(orgSlug: string, ids: string[]): Promise<Department[]> {
  const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgSlug)}/departments/order`, {
    method: "PUT",
    body: { ids },
  });
  return parseWithFallback<{ departments: Department[] }>(raw, DepartmentsResponse, { departments: [] }, {
    endpoint: "PUT /api/v1/orgs/{org}/departments/order",
  }).departments;
}
