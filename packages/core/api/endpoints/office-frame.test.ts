import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import { createOfficeFrameClient, mintOfficeFrameToken } from "./office-frame";

const docId = "01J8X4DOC0N1P2Q3R4S5T6U7";
const token = {
  token: "oft1.payload.sig",
  token_type: "Bearer",
  expires_at: "2026-10-08T10:10:00Z",
  expires_in: 600,
  document_id: docId,
  workspace_id: "01J8X4WS0N1P2Q3R4S5T6U7V8",
  organization_id: "01J8X4ORGN1P2Q3R4S5T6U7V8",
  can_edit: true,
};
const document = {
  document_id: docId,
  workspace_id: token.workspace_id,
  organization_id: token.organization_id,
  title: "Kế hoạch.docx",
  revision: "41",
  can_edit: true,
  file: {
    file_id: "f1", version_id: "v1", version: 3, filename: "ke-hoach.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes: 12, checksum_sha256: "abc",
  },
  download_url: `/api/v1/office-frame/documents/${docId}/content?version=3`,
  updated_at: "2026-10-08T10:00:00Z",
};
const upload = { upload_id: "01J8X4FILEN1P2Q3R4S5T6U7V8", checksum_sha256: "abc", size_bytes: 12, claim_expires_at: "2026-10-09T10:00:00Z" };
const asset = {
  asset_id: "01J8X4AST0N1P2Q3R4S5T6U7V8", document_id: docId, mime_type: "image/png", size_bytes: 10,
  url: `/api/v1/office-frame/documents/${docId}/assets/01J8X4AST0N1P2Q3R4S5T6U7V8?sig=ofa1.x.y`, expires_at: "2026-10-08T10:10:00Z",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const malformed = [{ nope: true }, null, [], "malformed", { ...document, revision: 41 }];

describe("Office Docs frame endpoints", () => {
  beforeEach(() => {
    setAccessToken("session-token");
    configureRuntime({ apiUrl: "http://api.test" });
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
    resetRuntimeConfig();
  });

  it("mints with the session and parses the token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(token, 201));
    await expect(mintOfficeFrameToken(docId)).resolves.toEqual(token);
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe(`http://api.test/api/v1/documents/${docId}/office/frame-token`);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer session-token");
  });

  it("tells a flag-off mint (403 feature_disabled) from a missing document (404)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "feature_disabled", message: "feature is disabled" } }, 403));
    await expect(mintOfficeFrameToken(docId)).rejects.toMatchObject({ status: 403, code: "feature_disabled" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "not_found", message: "not found" } }, 404));
    await expect(mintOfficeFrameToken(docId)).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("parses the AI grant and reads a drifted one as off", async () => {
    const grant = { ai: true, web_search: true, image_search: false, image_generation: true };
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...token, ai: grant }, 201));
    await expect(mintOfficeFrameToken(docId)).resolves.toMatchObject({ ai: grant });
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...token, ai: { ai: "yes", web_search: 1 } }, 201));
    await expect(mintOfficeFrameToken(docId)).resolves.toMatchObject({
      token: token.token, ai: { ai: false, web_search: false, image_search: false, image_generation: false },
    });
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...token, ai: "on" }, 201));
    const minted = await mintOfficeFrameToken(docId);
    expect(minted?.token).toBe(token.token);
    expect(minted?.ai).toBeUndefined();
  });

  it("degrades a malformed mint answer to null", async () => {
    for (const body of [{ nope: true }, null, [], "malformed", { ...token, expires_in: "600" }]) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body, 201));
      await expect(mintOfficeFrameToken(docId)).resolves.toBeNull();
    }
  });

  it("sends only the frame token, never cookies, on every frame call", async () => {
    const f = vi.fn<typeof fetch>();
    const client = createOfficeFrameClient({ getToken: () => "oft1.frame", fetch: f, apiUrl: "http://frame.test" });
    f.mockResolvedValueOnce(json(document));
    await expect(client.open(docId)).resolves.toEqual(document);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(String(url)).toBe(`http://frame.test/api/v1/office-frame/documents/${docId}`);
    expect(init?.credentials).toBe("omit");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer oft1.frame");
  });

  it("parses the Markdown/HTML assets map and reads a drifted one as absent", async () => {
    const f = vi.fn<typeof fetch>();
    const client = createOfficeFrameClient({ getToken: () => "oft1.frame", fetch: f, apiUrl: "" });
    const assets = { "assets/a.png": asset.url, "style.css": `/api/v1/office-frame/documents/${docId}/linked/01J8X4DOC1N1P2Q3R4S5T6U7?sig=ofl1.x.y` };
    f.mockResolvedValueOnce(json({ ...document, module: "html", assets }));
    await expect(client.open(docId)).resolves.toMatchObject({ assets });
    for (const drifted of [["a.png"], "a.png", { "a.png": 3 }, { "": "/x" }]) {
      f.mockResolvedValueOnce(json({ ...document, assets: drifted }));
      const opened = await client.open(docId);
      expect(opened?.document_id).toBe(docId);
      expect(opened?.assets).toBeUndefined();
    }
  });

  it("runs the save flow and surfaces a conflict as a 409 ApiError", async () => {
    const f = vi.fn<typeof fetch>();
    const client = createOfficeFrameClient({ getToken: () => "oft1.frame", fetch: f, apiUrl: "" });
    f.mockResolvedValueOnce(json(upload, 201));
    await expect(client.upload(docId, new Blob(["x"]), "ke-hoach.docx", "k1")).resolves.toEqual(upload);
    expect((f.mock.calls[0]?.[1]?.headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");
    expect(f.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);

    f.mockResolvedValueOnce(json({ ...document, revision: "42" }));
    await expect(client.commit(docId, { upload_id: upload.upload_id, base_revision: "41" }, "k2")).resolves.toMatchObject({ revision: "42" });
    expect(JSON.parse(String(f.mock.calls[1]?.[1]?.body))).toEqual({ upload_id: upload.upload_id, base_revision: "41" });

    f.mockResolvedValueOnce(json({ error: { code: "document_version_conflict", message: "stale", fields: { current_revision: "43" } } }, 409));
    const err = await client.commit(docId, { upload_id: upload.upload_id, base_revision: "41" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "document_version_conflict", fields: { current_revision: "43" } });
  });

  it("reads bytes only from frame routes", async () => {
    const f = vi.fn<typeof fetch>();
    const client = createOfficeFrameClient({ getToken: () => "oft1.frame", fetch: f, apiUrl: "" });
    f.mockResolvedValueOnce(new Response("docx-bytes"));
    await expect((await client.content(document.download_url)).text()).resolves.toBe("docx-bytes");
    await expect(client.content("https://evil.test/x")).rejects.toBeInstanceOf(ApiError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("parses recents and image answers", async () => {
    const f = vi.fn<typeof fetch>();
    const client = createOfficeFrameClient({ getToken: () => "oft1.frame", fetch: f, apiUrl: "" });
    f.mockResolvedValueOnce(json({ items: [{ document_id: docId, title: "a.docx", updated_at: "2026-10-08T10:00:00Z" }] }));
    await expect(client.recents(docId, 5)).resolves.toEqual({ items: [{ document_id: docId, title: "a.docx", updated_at: "2026-10-08T10:00:00Z" }] });
    expect(String(f.mock.calls[0]?.[0])).toBe(`/api/v1/office-frame/documents/${docId}/recents?limit=5`);
    f.mockResolvedValueOnce(json(asset, 201));
    await expect(client.uploadAsset(docId, new Blob(["p"]), "a.png")).resolves.toEqual(asset);
    f.mockResolvedValueOnce(json({ items: [{ asset_id: asset.asset_id, url: asset.url, expires_at: asset.expires_at }] }));
    await expect(client.signAssets(docId, [asset.asset_id])).resolves.toEqual({ items: [{ asset_id: asset.asset_id, url: asset.url, expires_at: asset.expires_at }] });
    expect(JSON.parse(String(f.mock.calls[2]?.[1]?.body))).toEqual({ asset_ids: [asset.asset_id] });
  });

  it("degrades every malformed frame answer instead of throwing", async () => {
    const f = vi.fn<typeof fetch>();
    const client = createOfficeFrameClient({ getToken: () => "oft1.frame", fetch: f, apiUrl: "" });
    for (const body of malformed) {
      f.mockResolvedValueOnce(json(body));
      await expect(client.open(docId)).resolves.toBeNull();
      f.mockResolvedValueOnce(json(body));
      await expect(client.upload(docId, new Blob(["x"]), "a.docx")).resolves.toBeNull();
      f.mockResolvedValueOnce(json(body));
      await expect(client.commit(docId, { upload_id: "u", base_revision: "1" })).resolves.toBeNull();
      f.mockResolvedValueOnce(json(body));
      await expect(client.recents(docId)).resolves.toEqual({ items: [] });
      f.mockResolvedValueOnce(json(body));
      await expect(client.uploadAsset(docId, new Blob(["x"]), "a.png")).resolves.toBeNull();
      f.mockResolvedValueOnce(json(body));
      await expect(client.signAssets(docId, ["a"])).resolves.toEqual({ items: [] });
    }
    // A non-JSON success body degrades too.
    f.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    await expect(client.open(docId)).resolves.toBeNull();
  });

  describe("exportPdf", () => {
    const pdf = (body = "%PDF-1.7 bytes", type = "application/pdf") => new Response(body, { status: 200, headers: { "Content-Type": type } });
    const setup = () => {
      const f = vi.fn<typeof fetch>();
      return { f, client: createOfficeFrameClient({ getToken: () => "oft1.frame", fetch: f, apiUrl: "http://frame.test" }) };
    };

    it("posts the live docx as 'file' with the frame token and an Idempotency-Key, and returns the PDF bytes", async () => {
      const { f, client } = setup();
      f.mockResolvedValueOnce(pdf());
      const out = await client.exportPdf(docId, { file: new Blob(["docx"]) }, "k-exp");
      expect(new TextDecoder().decode(out!)).toBe("%PDF-1.7 bytes");
      const [url, init] = f.mock.calls[0] ?? [];
      expect(String(url)).toBe(`http://frame.test/api/v1/office-frame/documents/${docId}/export/pdf`);
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("omit");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer oft1.frame");
      expect(headers["Idempotency-Key"]).toBe("k-exp");
      expect(headers["Content-Type"]).toBeUndefined();
      const form = init?.body as FormData;
      expect(form.get("file")).toBeInstanceOf(Blob);
      expect(form.get("version")).toBeNull();
    });

    it("asks for a stored version when there are no live bytes", async () => {
      const { f, client } = setup();
      f.mockResolvedValueOnce(pdf()).mockResolvedValueOnce(pdf());
      await client.exportPdf(docId, { version: 3 });
      await client.exportPdf(docId, {});
      const first = f.mock.calls[0]?.[1]?.body as FormData;
      const second = f.mock.calls[1]?.[1]?.body as FormData;
      expect([first.get("version"), first.get("file")]).toEqual(["3", null]);
      expect([...second.keys()]).toEqual([]);
    });

    it("degrades a 200 that is not a PDF (wrong type or wrong bytes) to null", async () => {
      const { f, client } = setup();
      f.mockResolvedValueOnce(pdf("%PDF-1.7", "application/json"))
        .mockResolvedValueOnce(pdf("<html>oops</html>"))
        .mockResolvedValueOnce(pdf(""));
      for (let i = 0; i < 3; i += 1) await expect(client.exportPdf(docId, {})).resolves.toBeNull();
    });

    it("rejects 501, 504 and 413 as ApiErrors carrying status and code", async () => {
      const { f, client } = setup();
      f.mockResolvedValueOnce(json({ error: { code: "unsupported_operation", message: "no renderer" } }, 501))
        .mockResolvedValueOnce(new Response("gateway timeout", { status: 504 }))
        .mockResolvedValueOnce(json({ error: { code: "payload_too_large", message: "big" } }, 413));
      await expect(client.exportPdf(docId, {})).rejects.toMatchObject({ status: 501, code: "unsupported_operation" });
      await expect(client.exportPdf(docId, {})).rejects.toMatchObject({ status: 504, code: "internal" });
      await expect(client.exportPdf(docId, {})).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
    });
  });
});
