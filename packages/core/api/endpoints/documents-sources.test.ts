import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  documentSourceDownloadPath,
  downloadDocumentSource,
  listDocumentSources,
  saveDocumentSource,
} from "./documents-sources";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const docBody = () => ({
  id: "d1",
  organization_id: "o1",
  workspace_id: "w1",
  parent_id: null,
  kind: "file",
  title: "Hợp đồng",
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
});

const item = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  source: "chat",
  parent: { kind: "chat_channel", id: "c1", title: "general" },
  name: "hop-dong.docx",
  mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  extension: "docx",
  size_bytes: 2048,
  updated_at: "2026-09-27T09:00:00Z",
  owner: { id: "u1", kind: "human", name: "An" },
  can_open_in_app: true,
  can_save: true,
  ...over,
});

describe("documents-sources endpoints", () => {
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

  it("listDocumentSources sends the filters and parses the page", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [item()], next_cursor: "c2" }));
    const out = await listDocumentSources("w1", {
      source: "chat",
      type: "docx",
      q: "hợp đồng",
      cursor: "c1",
      limit: 50,
    });
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    const u = new URL(String(url));
    expect(u.pathname).toBe("/api/v1/workspaces/w1/documents/sources");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      source: "chat",
      type: "docx",
      q: "hợp đồng",
      cursor: "c1",
      limit: "50",
    });
    expect(out.items[0]?.parent.kind).toBe("chat_channel");
    expect(out.items[0]?.can_save).toBe(true);
    expect(out.next_cursor).toBe("c2");
  });

  it("listDocumentSources has no query string without filters", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [], next_cursor: null }));
    await listDocumentSources("w1");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/sources",
    );
  });

  it("fills defaults for missing optional fields", async () => {
    const bare = { id: "s2", source: "task", parent: { kind: "task", id: "t1", title: "T" }, name: "a.bin" };
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [bare] }));
    const out = await listDocumentSources("w1");
    expect(out.items[0]).toMatchObject({
      size_bytes: 0,
      owner: null,
      can_open_in_app: false,
      can_save: false,
      mime_type: "",
      extension: "",
      parent: { message_id: "" },
    });
  });

  it("parses chat parent message_id for deep links", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        items: [item({ parent: { kind: "chat_channel", id: "c1", title: "general", message_id: "m1" } })],
      }),
    );
    const out = await listDocumentSources("w1");
    expect(out.items[0]?.parent.message_id).toBe("m1");
  });

  it("carries the chat message a file was sent in on its parent", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ items: [item({ parent: { kind: "chat_dm", id: "r1", title: "An", message_id: "m9" } })] }),
    );
    const out = await listDocumentSources("w1");
    expect(out.items[0]?.parent).toEqual({ kind: "chat_dm", id: "r1", title: "An", message_id: "m9" });
  });

  it.each([
    { label: "missing", parent: { kind: "task", id: "t1", title: "T" } },
    { label: "a number", parent: { kind: "chat_dm", id: "r1", title: "An", message_id: 7 } },
    { label: "null", parent: { kind: "chat_dm", id: "r1", title: "An", message_id: null } },
  ])("degrades a message_id that is $label to an empty string", async ({ parent }) => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [item({ parent })] }));
    const out = await listDocumentSources("w1");
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.parent.message_id).toBe("");
  });

  it("keeps lenient enum parsing: unknown source/parent kind still parse", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ items: [item({ source: "future", parent: { kind: "future_parent", id: "x", title: "X" } })] }),
    );
    const out = await listDocumentSources("w1");
    expect(out.items).toHaveLength(1);
  });

  it.each([
    { nope: true },
    { items: "x" },
    { items: [{ id: "s1" }] },
    { items: [item({ can_save: "yes" })] },
    null,
    [],
    "str",
  ])(
    "listDocumentSources throws on malformed %#",
    async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(listDocumentSources("w1")).rejects.toThrow("document_sources_invalid");
    },
  );

  it("download path + bytes", async () => {
    expect(documentSourceDownloadPath("w1", "s 1")).toBe(
      "/api/v1/workspaces/w1/documents/sources/s%201/download",
    );
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const blob = await downloadDocumentSource("w1", "s1");
    expect(blob.size).toBe(3);
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/sources/s1/download",
    );
  });

  it("saveDocumentSource posts parent_id/title with the idempotency header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody() }, 201));
    const out = await saveDocumentSource(
      "w1",
      "s1",
      { parent_id: null, title: "Hợp đồng" },
      { idempotencyKey: "k1" },
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents/sources/s1/save");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("k1");
    expect(JSON.parse(String(init?.body))).toEqual({ parent_id: null, title: "Hợp đồng" });
    expect(out?.id).toBe("d1");
  });

  it.each([{ nope: true }, { document: "x" }, null, [], "str"])(
    "saveDocumentSource resolves null on %#",
    async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body, 201));
      expect(await saveDocumentSource("w1", "s1", {})).toBeNull();
    },
  );
});
