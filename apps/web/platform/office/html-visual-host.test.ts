import { describe, expect, it, vi } from "vitest";
import { createHtmlEngine, type HtmlUpstream, type UpstreamPatchSet } from "@uniwork/office-engine/html";
import { buildHtmlParseMap } from "./html-parse-map";
import { createHtmlVisualEditHost } from "./html-visual-host";

const upstream: HtmlUpstream = {
  buildParseMap: (text, version, previous) => buildHtmlParseMap(text, version, previous ?? null),
  validatePatchSet: (set, currentVersion) => (set.baseVersion === currentVersion ? null : { kind: "stale", baseVersion: set.baseVersion, currentVersion }),
  applyPatches: (text, patches) => [...patches].sort((a, b) => a.from - b.from || a.to - b.to).reverse().reduce((out, patch) => out.slice(0, patch.from) + patch.text + out.slice(patch.to), text),
  isDocEmpty: (text) => text.trim() === "",
  extractDocumentImageSources: () => [],
};

const SOURCE = "<main><p>One</p><p>Two</p></main>";

async function open() {
  const engine = createHtmlEngine({ upstream });
  const outcome = await engine.open({ bytes: new TextEncoder().encode(SOURCE), format: "html", document_id: "d" });
  if (outcome.outcome !== "opened") throw new Error("open failed");
  const ref = outcome.document_model_ref;
  // The text handle's setText: writes the engine like the real handle does.
  const setText = vi.fn((next: string) => void engine.replaceText(ref, next));
  let current: string | null = ref;
  const host = createHtmlVisualEditHost({ engine, ref: () => current, setText, upstream });
  return { engine, ref, host, setText, close: () => { current = null; } };
}

function set(base: number, patches: UpstreamPatchSet["patches"]): UpstreamPatchSet {
  return { patches, baseVersion: base, origin: "inspector", label: "t" };
}

describe("web visual-edit host", () => {
  it("serves the real parse map and the engine revision", async () => {
    const { engine, ref, host } = await open();
    const map = host.parseMap(SOURCE);
    expect(map.elements.map((element) => element.tag)).toEqual(["main", "p", "p"]);
    expect(map).toBe(engine.parseMap(ref));
    expect(host.revision()).toBe(engine.snapshot(ref).revision);
  });

  it("parses a text the engine has not seen yet instead of reusing an old map", async () => {
    const { host } = await open();
    expect(host.parseMap("<p>x</p>").elements.map((element) => element.tag)).toEqual(["p"]);
  });

  it("applies a patch set through the text handle's setText, not around it", async () => {
    const { engine, ref, host, setText } = await open();
    host.applyPatchSet(set(host.revision(), [{ from: 9, to: 12, text: "Uno" }]));
    expect(setText).toHaveBeenCalledWith("<main><p>Uno</p><p>Two</p></main>");
    expect(engine.snapshot(ref).text).toBe("<main><p>Uno</p><p>Two</p></main>");
  });

  it("rejects a stale patch set, an out-of-bounds one and an overlapping one", async () => {
    const { host, setText } = await open();
    const base = host.revision();
    expect(() => host.applyPatchSet(set(base + 1, [{ from: 0, to: 0, text: "x" }]))).toThrow(/stale/);
    expect(() => host.applyPatchSet(set(base, [{ from: 0, to: 999, text: "x" }]))).toThrow(/bounds/);
    expect(() => host.applyPatchSet(set(base, [{ from: 0, to: 5, text: "x" }, { from: 3, to: 8, text: "y" }]))).toThrow(/overlap/);
    expect(setText).not.toHaveBeenCalled();
  });

  it("refuses to act when the document is not open", async () => {
    const { host, close } = await open();
    close();
    expect(() => host.revision()).toThrow(/not open/);
  });
});
