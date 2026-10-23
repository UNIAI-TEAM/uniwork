import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  downloadPublicDocument,
  downloadPublicDocumentAsset,
  getPublicDocument,
  publicDocumentAssetPath,
  publicDocumentDownloadPath,
} from "./documents-public";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const pageBody = (over: Record<string, unknown> = {}) => ({
  document: { title: "Công khai", kind: "page", content: { type: "doc" }, ...over },
});

const malformedBodies = [
  { nope: true },
  { document: "x" },
  { document: { kind: "page" } },
  null,
  [],
  "str",
];

describe("documents-public endpoints", () => {
  beforeEach(() => {
    // The public routes need no session; the token is the credential.
    setAccessToken(null);
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("getPublicDocument reads by token without an Authorization header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(pageBody()));
    const out = await getPublicDocument("tok/1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/public/documents/tok%2F1");
    expect(new Headers(init?.headers).get("Authorization")).toBeNull();
    expect(out?.title).toBe("Công khai");
    expect(out?.kind).toBe("page");
  });

  it("a file view carries the download path", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        document: {
          title: "Tệp",
          kind: "file",
          download_url: "/api/v1/public/documents/t1/download",
        },
      }),
    );
    const out = await getPublicDocument("t1");
    expect(out?.download_url).toBe("/api/v1/public/documents/t1/download");
  });

  it("path builders encode the token and asset id", () => {
    expect(publicDocumentDownloadPath("tok/1")).toBe("/api/v1/public/documents/tok%2F1/download");
    expect(publicDocumentAssetPath("tok/1", "a 2")).toBe(
      "/api/v1/public/documents/tok%2F1/assets/a%202",
    );
  });

  it("the blob fetchers hit the public paths", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2])))
      .mockResolvedValueOnce(new Response(new Uint8Array([3])));
    const file = await downloadPublicDocument("t1");
    expect(file.size).toBe(2);
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/public/documents/t1/download",
    );
    const asset = await downloadPublicDocumentAsset("t1", "a1");
    expect(asset.size).toBe(1);
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe(
      "http://api.test/api/v1/public/documents/t1/assets/a1",
    );
  });

  it.each(malformedBodies)("getPublicDocument degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getPublicDocument("t1")).resolves.toBeNull();
  });
});
