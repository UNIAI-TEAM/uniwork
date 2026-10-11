import { describe, expect, it, vi } from "vitest";
import { createOfficeFrameApi, docsFrameSrc, type DocsFrameCall } from "./docs-frame-api";
import { OFFICE_MODULES } from "./docs-frame-protocol";
import { officeFrameSrc, officeModuleForFormat, officeModuleSpec, officeModuleTooLarge } from "./office-modules";

const API = "http://api.test";
const DOC = {
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", title: "Deck", revision: "7", can_edit: true, module: "slides",
  file: { file_id: "f-1", version_id: "v-3", version: 3, filename: "Deck.pptx", mime_type: "application/zip", size_bytes: 4, checksum_sha256: "abc" },
  download_url: "/api/v1/office-frame/documents/doc-1/content?version=3",
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const call = (): DocsFrameCall => ({ workspaceId: "ws-1", documentId: "doc-1", token: "frame-tok", signal: new AbortController().signal });

describe("office module table", () => {
  it("names one flag and one format per module, as the server does", () => {
    expect(OFFICE_MODULES.map((m) => [m, officeModuleSpec(m).flag, officeModuleSpec(m).format])).toEqual([
      ["docs", "office_docs_web", "docx"],
      ["pdf", "office_pdf_web", "pdf"],
      ["markdown", "office_markdown_web", "md"],
      ["html", "office_html_web", "html"],
      ["slides", "office_slides_web", "pptx"],
      ["sheets", "office_sheets_web", "xlsx"],
    ]);
  });

  it("maps formats to modules, and nothing for a format no frame opens", () => {
    expect(officeModuleForFormat("pptx")).toBe("slides");
    expect(officeModuleForFormat("md")).toBe("markdown");
    expect(officeModuleForFormat("xls")).toBeNull();
    expect(officeModuleForFormat(null)).toBeNull();
  });

  it("serves each module from its own directory; the docs URL is unchanged", () => {
    expect(officeFrameSrc("sheets", "1.2.0-abc")).toBe("/office-frame/sheets/1.2.0-abc/index.html");
    expect(docsFrameSrc("1.0.0")).toBe("/office-frame/docs/1.0.0/index.html");
  });

  it("grants each module what its frame implements: no recents, attachments or server PDF export outside docs; images for markdown/html", () => {
    expect(officeModuleSpec("pdf").grant).toEqual({ save: true, saveAs: true, print: true });
    expect(officeModuleSpec("markdown").grant).toEqual({ save: true, saveAs: true, print: true, exportHtml: true, images: true });
    expect(officeModuleSpec("html").grant).toEqual({ save: true, saveAs: true, print: true, exportHtml: true, images: true });
    expect(officeModuleSpec("slides").grant).toEqual({ save: true, saveAs: true, print: true });
    expect(officeModuleSpec("sheets").grant).toEqual({ save: true, saveAs: true, print: true });
  });

  it("caps Sheets at 10 MiB of stored xlsx and no other module", () => {
    expect(officeModuleTooLarge("sheets", 10 * 1024 * 1024)).toBe(false);
    expect(officeModuleTooLarge("sheets", 10 * 1024 * 1024 + 1)).toBe(true);
    expect(officeModuleTooLarge("sheets", undefined)).toBe(false);
    expect(OFFICE_MODULES.filter((m) => officeModuleSpec(m).maxBytes !== undefined)).toEqual(["sheets"]);
    expect(officeModuleTooLarge("docs", 1e12)).toBe(false);
  });

  it("sends a view-only slides user to the G3 host, every other module keeps the frame", () => {
    expect(OFFICE_MODULES.filter((m) => officeModuleSpec(m).viewOnlyInG3)).toEqual(["slides"]);
  });
});

// Ids of the signed routes, ULID-shaped as the server issues them (the host accepts nothing else).
const ROUTE = "/api/v1/office-frame/documents/01J8X4DOC0N1P2Q3R4S5T6U7V8";
const ASSET = "01J8X4AST0N1P2Q3R4S5T6U7V8";
const SIBLING = "01J8X4LNK0N1P2Q3R4S5T6U7V8";

describe("createOfficeFrameApi for a module", () => {
  it("saves the module's own bytes under the stored name", async () => {
    const seen: RequestInit[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = `${init.method ?? "GET"} ${String(input).slice(API.length)}`;
      seen.push(init);
      if (path === "GET /api/v1/office-frame/documents/doc-1") return json(DOC);
      if (path === "POST /api/v1/office-frame/documents/doc-1/uploads") return json({ upload_id: "up-1", checksum_sha256: "x", size_bytes: 4, claim_expires_at: "2026-10-08T11:00:00Z" });
      if (path === "POST /api/v1/office-frame/documents/doc-1/versions/commit") return json({ ...DOC, revision: "8" });
      throw new Error(`unexpected ${path}`);
    }) as unknown as typeof globalThis.fetch;
    const result = await createOfficeFrameApi("slides", { apiUrl: API, fetch }).save({ fileId: "doc-1", data: new ArrayBuffer(4), etag: "7" }, call());
    expect(result).toMatchObject({ ok: true, file: { etag: "8" } });
    const file = (seen[1]?.body as FormData).get("file") as File;
    expect(file.name).toBe("Deck.pptx");
    expect(file.type).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
  });

  it("hands a Markdown/HTML frame the signed frame routes of its relative references, and nothing else", async () => {
    const asset = `${ROUTE}/assets/${ASSET}?sig=ofa1.x.y`;
    const linked = `${ROUTE}/linked/${SIBLING}?sig=ofl1.x.y`;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).slice(API.length);
      if (path === "/api/v1/office-frame/documents/doc-1") {
        return json({ ...DOC, module: "html", assets: { "assets/a.png": asset, "style.css": linked, "evil.png": "https://evil.test/x.png" } });
      }
      return new Response("<p>x</p>");
    }) as unknown as typeof globalThis.fetch;
    const opened = await createOfficeFrameApi("html", { apiUrl: API, fetch }).open({ fileId: "doc-1" }, call());
    expect(opened.assets).toEqual({ "assets/a.png": asset, "style.css": linked });

    const plain = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/doc-1") ? json({ ...DOC, module: "markdown" }) : new Response("# x")) as unknown as typeof globalThis.fetch;
    expect(await createOfficeFrameApi("markdown", { apiUrl: API, fetch: plain }).open({ fileId: "doc-1" }, call())).not.toHaveProperty("assets");
  });

  it("uploads a pasted Markdown/HTML picture as a document asset under the frame's name", async () => {
    const seen: { path: string; init: RequestInit }[] = [];
    const url = `${ROUTE}/assets/${ASSET}?sig=ofa1.x.y`;
    const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      seen.push({ path: `${init.method ?? "GET"} ${String(input).slice(API.length)}`, init });
      return new Response(JSON.stringify({
        asset_id: "01J8X4AST0N1P2Q3R4S5T6U7V8", document_id: "doc-1", mime_type: "image/png", size_bytes: 3, url, expires_at: "2026-10-10T11:00:00Z",
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof globalThis.fetch;
    const api = createOfficeFrameApi("markdown", { apiUrl: API, fetch });
    const name = "image-20261010-101530-k3f9.png";
    await expect(api.uploadImage?.({ fileId: "doc-1", name, mimeType: "image/png", data: new Uint8Array([1, 2, 3]).buffer }, call()))
      .resolves.toEqual({ imageId: "01J8X4AST0N1P2Q3R4S5T6U7V8", url });
    expect(seen[0]?.path).toBe("POST /api/v1/office-frame/documents/doc-1/assets");
    const file = (seen[0]?.init.body as FormData).get("file") as File;
    expect(file.name).toBe(name);
    expect(file.type).toBe("image/png");
    expect((seen[0]?.init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^frame-image-/);
    // Another document's id is refused before a round trip.
    await expect(api.uploadImage?.({ fileId: "doc-2", name, mimeType: "image/png", data: new ArrayBuffer(1) }, call())).rejects.toMatchObject({ code: "forbidden" });
    expect(seen).toHaveLength(1);
  });

  it("fails an upload whose answer is malformed or not a frame route", async () => {
    for (const body of [{ nope: true }, { asset_id: "a", document_id: "doc-1", mime_type: "image/png", size_bytes: 1, url: "https://evil.test/x", expires_at: "2026-10-10T11:00:00Z" }]) {
      const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 201 })) as unknown as typeof globalThis.fetch;
      await expect(createOfficeFrameApi("html", { apiUrl: API, fetch }).uploadImage?.({ name: "a.png", mimeType: "image/png", data: new ArrayBuffer(1) }, call()))
        .rejects.toMatchObject({ code: "internal" });
    }
  });

  it("has an image upload only where the grant says so (markdown, html)", () => {
    expect(OFFICE_MODULES.filter((m) => createOfficeFrameApi(m).uploadImage)).toEqual(["markdown", "html"]);
  });

  it("resolves relative paths into signed frame routes: only what was asked, only frame routes (A1b)", async () => {
    const asset = `${ROUTE}/assets/${ASSET}?sig=ofa1.x.y`;
    const linked = `${ROUTE}/linked/${SIBLING}?sig=ofl1.x.y`;
    const seen: { path: string; body: unknown; auth: string | undefined }[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      seen.push({ path: `${init.method} ${String(input).slice(API.length)}`, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization });
      return json({ items: [
        { path: "assets/a.png", url: asset, expires_at: "2026-10-10T11:00:00Z" },
        { path: "./new.svg", url: linked, expires_at: "2026-10-10T11:00:00Z" },
        { path: "not-asked.png", url: asset, expires_at: "2026-10-10T11:00:00Z" },
        { path: "evil.png", url: "https://evil.test/x.png", expires_at: "2026-10-10T11:00:00Z" },
        { path: "up.png", url: "/api/v1/office-frame/documents/../x/assets/y?sig=a", expires_at: "2026-10-10T11:00:00Z" },
      ] });
    }) as unknown as typeof globalThis.fetch;
    const api = createOfficeFrameApi("markdown", { apiUrl: API, fetch });
    const paths = ["assets/a.png", "./new.svg", "evil.png", "up.png", "gone.png"];
    await expect(api.resolveAssets?.({ fileId: "doc-1", paths }, call())).resolves.toEqual({ assets: { "assets/a.png": asset, "./new.svg": linked } });
    expect(seen).toEqual([{ path: "POST /api/v1/office-frame/documents/doc-1/assets/resolve", body: { paths }, auth: "Bearer frame-tok" }]);
    // Another document's id is refused before a round trip.
    await expect(api.resolveAssets?.({ fileId: "doc-2", paths: ["a.png"] }, call())).rejects.toMatchObject({ code: "forbidden" });
    expect(seen).toHaveLength(1);
  });

  it("degrades to no URLs when the resolve answer is malformed, and fails on an API error", async () => {
    const malformed = vi.fn(async () => json({ items: "nope" })) as unknown as typeof globalThis.fetch;
    await expect(createOfficeFrameApi("html", { apiUrl: API, fetch: malformed }).resolveAssets?.({ paths: ["a.png"] }, call())).resolves.toEqual({ assets: {} });
    const denied = vi.fn(async () => new Response(JSON.stringify({ error: { code: "not_found", message: "no" } }), { status: 404 })) as unknown as typeof globalThis.fetch;
    await expect(createOfficeFrameApi("html", { apiUrl: API, fetch: denied }).resolveAssets?.({ paths: ["a.png"] }, call())).rejects.toMatchObject({ code: "not_found" });
  });

  it("has a resolve request only where relative paths exist (markdown, html)", () => {
    expect(OFFICE_MODULES.filter((m) => createOfficeFrameApi(m).resolveAssets)).toEqual(["markdown", "html"]);
  });

  it("has no server PDF export outside docs (the frame prints in place)", () => {
    expect(createOfficeFrameApi("pdf").export).toBeUndefined();
    expect(createOfficeFrameApi("docs").export).toBeTypeOf("function");
  });
});
