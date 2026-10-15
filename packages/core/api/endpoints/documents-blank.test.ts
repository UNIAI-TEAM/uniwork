import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { BLANK_DOCUMENT_FORMATS, createBlankDocumentFile } from "./documents-blank";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const docBody = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  organization_id: "o1",
  workspace_id: "w1",
  parent_id: null,
  kind: "file",
  title: "Bảng tính",
  visibility: "workspace",
  revision: "1",
  current_version: 1,
  position: 0,
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u1",
  updated_by_kind: "human",
  created_at: "2026-09-27T09:00:00Z",
  updated_at: "2026-09-27T09:00:00Z",
  ...over,
});

describe("documents-blank endpoint", () => {
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

  it("lists the six formats", () => {
    expect([...BLANK_DOCUMENT_FORMATS].sort()).toEqual(["docx", "html", "md", "pdf", "pptx", "xlsx"]);
  });

  it("posts format/title/parent_id with the idempotency header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody() }, 201));
    const out = await createBlankDocumentFile(
      "w 1",
      { format: "xlsx", title: "Bảng tính", parent_id: "p1" },
      { idempotencyKey: "k1" },
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w%201/documents/files/blank");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("k1");
    expect(JSON.parse(String(init?.body))).toEqual({ format: "xlsx", title: "Bảng tính", parent_id: "p1" });
    expect(out?.id).toBe("d1");
  });

  it("sends visibility restricted in the body and sends none when it is not given (DOC-02)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ visibility: "restricted" }) }, 201));
    const out = await createBlankDocumentFile("w1", { format: "docx", title: "t", visibility: "restricted" });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toEqual({
      format: "docx",
      title: "t",
      visibility: "restricted",
    });
    expect(out?.visibility).toBe("restricted");
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody() }, 201));
    await createBlankDocumentFile("w1", { format: "docx", title: "t" });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).not.toHaveProperty("visibility");
  });

  it("resolves null when the returned visibility drifted to a non-string", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ visibility: 7 }) }, 201));
    expect(await createBlankDocumentFile("w1", { format: "docx", title: "t", visibility: "restricted" })).toBeNull();
  });

  it("omits the header without a key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody() }, 201));
    await createBlankDocumentFile("w1", { format: "md", title: "t" });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBeNull();
  });

  it.each([{ nope: true }, { document: "x" }, null, [], "str"])("resolves null on %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body, 201));
    expect(await createBlankDocumentFile("w1", { format: "docx", title: "t" })).toBeNull();
  });

  it("still parses a drifted kind enum", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ kind: "future_kind" }) }, 201));
    expect((await createBlankDocumentFile("w1", { format: "docx", title: "t" }))?.id).toBe("d1");
  });
});
