import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import {
  listTemplateDocuments,
  markDocumentTemplate,
  unmarkDocumentTemplate,
} from "./document-templates";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const docBody = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  organization_id: "o1",
  workspace_id: "w1",
  parent_id: null,
  kind: "file",
  title: "Mẫu hợp đồng",
  visibility: "workspace",
  revision: "3",
  current_version: 1,
  position: 0,
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u1",
  updated_by_kind: "human",
  created_at: "2026-10-27T09:00:00Z",
  updated_at: "2026-10-27T09:00:00Z",
  ...over,
});

const malformedBodies = [{ nope: true }, { document: "x" }, null, [], "str"];

describe("document template endpoints", () => {
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

  it("markDocumentTemplate POSTs the template route with no body by default", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ document: docBody({ template_marked_at: "2026-10-27T10:00:00Z", template_marked_by: "u1" }) }),
    );
    const out = await markDocumentTemplate("d1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/template");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(out?.document.template_marked_at).toBe("2026-10-27T10:00:00Z");
    expect(out?.document.template_marked_by).toBe("u1");
  });

  it("markDocumentTemplate sends widen_to_workspace when confirmed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody() }));
    await markDocumentTemplate("d1", { widenToWorkspace: true });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ widen_to_workspace: true });
  });

  it("markDocumentTemplate surfaces the 409 widen refusal", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "template_widens_visibility", message: "widens" } }, 409),
    );
    const err = await markDocumentTemplate("d1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
  });

  it("unmarkDocumentTemplate DELETEs the template route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody() }));
    const out = await unmarkDocumentTemplate("d1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/template");
    expect(init?.method).toBe("DELETE");
    expect(out?.document.id).toBe("d1");
    expect(out?.document.template_marked_at).toBeUndefined();
  });

  it("listTemplateDocuments reads the workspace templates route with the list query", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ documents: [docBody({ template_marked_at: "2026-10-27T10:00:00Z" })], next_cursor: "n1" }),
    );
    const out = await listTemplateDocuments("w1", { cursor: "c0", limit: 20, types: ["docx", "xlsx"] });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    const u = new URL(String(url));
    expect(u.pathname).toBe("/api/v1/workspaces/w1/documents/templates");
    expect(u.searchParams.get("cursor")).toBe("c0");
    expect(u.searchParams.get("limit")).toBe("20");
    expect(u.searchParams.getAll("type")).toEqual(["docx", "xlsx"]);
    expect(init?.method).toBe("GET");
    expect(out.documents[0]?.template_marked_at).toBe("2026-10-27T10:00:00Z");
    expect(out.next_cursor).toBe("n1");
  });

  it.each(malformedBodies)("mark and unmark degrade %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(markDocumentTemplate("d1")).resolves.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(unmarkDocumentTemplate("d1")).resolves.toBeNull();
  });

  it.each(malformedBodies)("listTemplateDocuments throws document_list_invalid on %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(listTemplateDocuments("w1")).rejects.toThrow("document_list_invalid");
  });
});
