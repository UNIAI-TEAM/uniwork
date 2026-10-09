import { describe, expect, it, vi } from "vitest";
import { createOfficeFrameApi, docsFrameSrc, type DocsFrameCall } from "./docs-frame-api";
import { OFFICE_MODULES } from "./docs-frame-protocol";
import { officeFrameSrc, officeModuleForFormat, officeModuleSpec } from "./office-modules";

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

  it("grants a new module nothing until its worker enables it", () => {
    for (const m of OFFICE_MODULES.filter((x) => x !== "docs")) expect(officeModuleSpec(m).grant).toEqual({});
  });
});

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

  it("has no server PDF export outside docs (the frame prints in place)", () => {
    expect(createOfficeFrameApi("pdf").export).toBeUndefined();
    expect(createOfficeFrameApi("docs").export).toBeTypeOf("function");
  });
});
