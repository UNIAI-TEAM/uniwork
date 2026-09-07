import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  archiveDepartment,
  createDepartment,
  exportPeopleUrl,
  getPerson,
  listDepartments,
  listPeople,
  reorderDepartments,
  updateDepartment,
  updateProfile,
} from "./people";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const validPerson = {
  user_id: "u1",
  display_name: "Nguyễn Văn An",
  email: "an@acme.vn",
  org_role: "member",
  status: "active",
};

const validDepartment = { id: "d1", name: "Kỹ thuật" };

describe("people endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("listPeople puts every filter in the query string and defaults the optional fields", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ people: [validPerson], total_active: 1 }));
    const page = await listPeople("acme", { q: "an", department_id: "d1", status: "" }, "cur");
    expect(page.people[0]!.title).toBe("");
    expect(page.people[0]!.phone_visible).toBe(false);
    expect(page.total_active).toBe(1);
    const url = String(vi.mocked(fetch).mock.calls[0]![0]);
    expect(url).toContain("/api/v1/orgs/acme/people?");
    expect(url).toContain("q=an");
    expect(url).toContain("department_id=d1");
    expect(url).toContain("cursor=cur");
    // An empty filter is dropped rather than sent as an empty value.
    expect(url).not.toContain("status=");
  });

  it("listPeople degrades to an empty page on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ people: [{ user_id: 7 }] }));
    await expect(listPeople("acme", {})).resolves.toEqual({ people: [], total_active: 0 });
  });

  it("listPeople lets an unknown role or status through", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ people: [{ ...validPerson, org_role: "auditor", status: "archived" }], total_active: 1 }),
    );
    const page = await listPeople("acme", {});
    expect(page.people[0]!.org_role).toBe("auditor");
  });

  it("getPerson returns a null person instead of throwing on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ person: { user_id: 1 } }));
    await expect(getPerson("acme", "u1")).resolves.toEqual({ person: null, reports: [] });
  });

  it("getPerson returns the profile with its reports", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ person: validPerson, reports: [{ id: "u2", kind: "human", display_name: "B" }] }),
    );
    const detail = await getPerson("acme", "u1");
    expect(detail.person?.user_id).toBe("u1");
    expect(detail.reports).toHaveLength(1);
  });

  it("updateProfile degrades instead of throwing on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ person: null }));
    await expect(updateProfile("acme", "u1", { title: "Kỹ sư" })).resolves.toEqual({
      person: null,
      reports: [],
    });
    expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({ method: "PATCH" });
  });

  it("exportPeopleUrl is a plain URL the browser can navigate to", () => {
    expect(exportPeopleUrl("acme", "http://api.test")).toBe("http://api.test/api/v1/orgs/acme/people.csv");
  });

  it("listDepartments returns [] on a malformed response and defaults member_count", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ departments: [validDepartment] }));
    const list = await listDepartments("acme");
    expect(list[0]!.member_count).toBe(0);

    vi.mocked(fetch).mockResolvedValueOnce(json({ departments: [{ id: 1 }] }));
    await expect(listDepartments("acme")).resolves.toEqual([]);
  });

  it("listDepartments asks for archived rows only when told to", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ departments: [] }));
    await listDepartments("acme", true);
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("include_archived=true");
  });

  it("createDepartment, updateDepartment and archiveDepartment return null on a malformed response", async () => {
    for (const call of [
      () => createDepartment("acme", { name: "Kỹ thuật" }),
      () => updateDepartment("acme", "d1", { name: "Công nghệ" }),
      () => archiveDepartment("acme", "d1"),
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(json({ department: { id: 1 } }));
      await expect(call()).resolves.toBeNull();
    }
  });

  it("reorderDepartments returns [] on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ departments: [{ id: 1 }] }));
    await expect(reorderDepartments("acme", ["d1"])).resolves.toEqual([]);
  });
});
