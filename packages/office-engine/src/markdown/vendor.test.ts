// The binding surface over stub upstream modules; the real vendored source is
// proven by test/replay/g2-06-replay.mjs against the build tree.
import { describe, expect, it } from "vitest";
import { bindHtmlUpstream, type UpstreamHtmlModules } from "../html/vendor";
import { bindMarkdownUpstream } from "./vendor";

describe("bindMarkdownUpstream", () => {
  it("forwards the vendored functions", () => {
    const bound = bindMarkdownUpstream({
      extractMarkdownImageSources: (md) => (md.includes("![") ? ["a.png"] : []),
      rewriteMarkdownImageSources: (md, rewrites) => md.replace("a.png", rewrites.get("a.png") ?? "a.png"),
    });
    expect(bound.extractMarkdownImageSources("![x](a.png)")).toEqual(["a.png"]);
    expect(bound.rewriteMarkdownImageSources("![x](a.png)", new Map([["a.png", "b.png"]]))).toBe("![x](b.png)");
  });

  it("refuses an incompatible module at bind time and malformed results at call time", () => {
    expect(() => bindMarkdownUpstream({ extractMarkdownImageSources: () => [] } as never)).toThrow(
      expect.objectContaining({ code: "engine_incompatible" }),
    );
    const bad = bindMarkdownUpstream({
      extractMarkdownImageSources: () => [1] as never,
      rewriteMarkdownImageSources: () => 7 as never,
    });
    expect(() => bad.extractMarkdownImageSources("x")).toThrow(expect.objectContaining({ code: "engine_result_invalid" }));
    expect(() => bad.rewriteMarkdownImageSources("x", new Map())).toThrow(expect.objectContaining({ code: "engine_result_invalid" }));
  });
});

const goodHtml = (): UpstreamHtmlModules => ({
  parseMap: { buildParseMap: (_t, version) => ({ version, elements: [], bySid: new Map(), errorCount: 0 }) },
  patch: {
    validatePatchSet: (set, current) => (set.baseVersion === current ? null : { kind: "stale", baseVersion: set.baseVersion, currentVersion: current }),
    applyPatches: (text, patches) => patches.reduce((t, p) => t.slice(0, p.from) + p.text + t.slice(p.to), text),
  },
  blank: { isDocEmpty: (text) => text.trim() === "" },
  assets: { extractDocumentImageSources: () => ["a.png"] },
});

describe("bindHtmlUpstream", () => {
  it("forwards the vendored functions", () => {
    const bound = bindHtmlUpstream(goodHtml());
    expect(bound.buildParseMap("<p>x</p>", 3).version).toBe(3);
    expect(bound.validatePatchSet({ patches: [], baseVersion: 1, origin: "manual", label: "x" }, 2, 0)).toMatchObject({ kind: "stale" });
    expect(bound.applyPatches("ab", [{ from: 1, to: 1, text: "X" }])).toBe("aXb");
    expect(bound.isDocEmpty("  ")).toBe(true);
    expect(bound.extractDocumentImageSources("<img src=a.png>")).toEqual(["a.png"]);
  });

  it.each([
    ["parseMap", { parseMap: undefined }],
    ["patch", { patch: { validatePatchSet: () => null } }],
    ["blank", { blank: {} }],
    ["assets", { assets: {} }],
  ])("refuses a module set missing %s", (_name, patch) => {
    expect(() => bindHtmlUpstream({ ...goodHtml(), ...(patch as object) } as UpstreamHtmlModules)).toThrow(
      expect.objectContaining({ code: "engine_incompatible" }),
    );
  });

  it("refuses malformed results", () => {
    const bad = bindHtmlUpstream({
      parseMap: { buildParseMap: () => ({}) as never },
      patch: { validatePatchSet: () => null, applyPatches: () => 1 as never },
      blank: { isDocEmpty: () => "yes" as never },
      assets: { extractDocumentImageSources: () => "a" as never },
    });
    expect(() => bad.buildParseMap("x", 0)).toThrow(expect.objectContaining({ code: "engine_result_invalid" }));
    expect(() => bad.applyPatches("x", [])).toThrow(expect.objectContaining({ code: "engine_result_invalid" }));
    expect(bad.isDocEmpty("x")).toBe(false);
    expect(() => bad.extractDocumentImageSources("x")).toThrow(expect.objectContaining({ code: "engine_result_invalid" }));
  });
});
