import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import { exportDocumentPage, getPageExportFormats } from "./documents-page-export";

describe("exportDocumentPage", () => {
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

  it("posts the format and answers the bytes with the server's file name", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("PK", {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": "attachment; filename=\"Bien ban hop.docx\"; filename*=UTF-8''Bi%C3%AAn%20b%E1%BA%A3n%20h%E1%BB%8Dp.docx",
        },
      }),
    );
    const out = await exportDocumentPage("d/1", "docx");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d%2F1/export");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ format: "docx" });
    expect(out.filename).toBe("Biên bản họp.docx");
    expect(out.blob.size).toBe(2);
  });

  it("answers no file name when the browser cannot read one", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("%PDF-", { status: 200 }));
    await expect(exportDocumentPage("d1", "pdf")).resolves.toMatchObject({ filename: null });
  });

  it("surfaces a refusal as an ApiError with its code", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "page_export_not_page", message: "x" } }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const err = await exportDocumentPage("d1", "pdf").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("page_export_not_page");
  });

  it("degrades a malformed error body to an ApiError instead of throwing a parse error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    const err = await exportDocumentPage("d1", "docx").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
  });

  it("getPageExportFormats reads the formats this deployment renders (follow-6)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ formats: ["docx", "pdf"] }));
    expect(await getPageExportFormats("d/1")).toEqual(["docx", "pdf"]);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d%2F1/export");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("getPageExportFormats keeps only formats it knows and answers null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ formats: ["pdf", "odt", 3] }));
    expect(await getPageExportFormats("d1")).toEqual(["pdf"]);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ formats: "docx" }));
    expect(await getPageExportFormats("d1")).toBeNull();
  });
});
