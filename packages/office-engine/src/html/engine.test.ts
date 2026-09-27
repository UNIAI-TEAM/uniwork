import { sha256Hex } from "@uniwork/office-contracts";
import { describe, expect, it } from "vitest";
import { fakeHtmlUpstream, fakeStore, PNG_BYTES, utf8 } from "../assets/test-fakes";
import { createHtmlEngine } from "./engine";

const CSS = utf8("body{color:red}");

async function manifest(documentPath: string, files: Record<string, [Uint8Array, string]>) {
  const entries = [];
  for (const [key, [bytes, media_type]] of Object.entries(files)) {
    entries.push({ key, sha256: await sha256Hex(bytes), byte_length: bytes.length, media_type, origin: "imported" as const });
  }
  return { version: 1 as const, document_path: documentPath, entries };
}

describe("html engine", () => {
  it("edits through upstream patch sets against the session revision", async () => {
    const html = createHtmlEngine({ upstream: fakeHtmlUpstream() });
    const { document_model_ref: ref } = html.createBlank({ document_id: "H1" });
    expect(html.isEmpty(ref)).toBe(true);
    const text = "<!doctype html><p>Xin chào</p>";
    html.applyPatchSet(ref, { patches: [{ from: 0, to: 0, text }], baseVersion: 0, origin: "manual", label: "type" });
    expect(html.snapshot(ref)).toMatchObject({ text, revision: 1 });
    expect(html.isEmpty(ref)).toBe(false);
    expect(html.parseMap(ref).version).toBe(1);
    expect(html.parseMap(ref)).toBe(html.parseMap(ref));

    await expect(async () =>
      html.applyPatchSet(ref, { patches: [], baseVersion: 0, origin: "ai", label: "stale" }),
    ).rejects.toMatchObject({ code: "base_version_mismatch", fields: { reason: "patch_stale" } });
    expect(() =>
      html.applyPatchSet(ref, { patches: [{ from: 0, to: 999, text: "" }], baseVersion: 1, origin: "ai", label: "x" }),
    ).toThrow(expect.objectContaining({ code: "invalid_transition" }));
    expect(html.applyPatchSet(ref, { patches: [], baseVersion: 1, origin: "format", label: "noop" }).revision).toBe(1);
  });

  it("saves and reopens twice, carrying stylesheet and image bytes", async () => {
    const html = createHtmlEngine({ upstream: fakeHtmlUpstream() });
    const m = await manifest("index.html", { "css/site.css": [CSS, "text/css"], "img/a b.png": [PNG_BYTES, "image/png"] });
    const store = fakeStore("H1", { "css/site.css": CSS, "img/a b.png": PNG_BYTES });
    const source = `<link rel="stylesheet" href="css/site.css"><img src="img/a%20b.png" alt="Ảnh">`;
    let outcome = await html.open({ bytes: utf8(source), format: "html", document_id: "H1", asset_manifest: m });
    if (outcome.outcome !== "opened") throw new Error("open");
    let ref = outcome.document_model_ref;
    for (const line of ["<p>Lần một</p>", "<p>Lần hai</p>"]) {
      const snap = html.snapshot(ref);
      html.applyPatchSet(ref, {
        patches: [{ from: snap.text.length, to: snap.text.length, text: line }],
        baseVersion: snap.revision,
        origin: "manual",
        label: "append",
      });
      await html.save(ref, store);
      const last = store.published.at(-1)!;
      outcome = await html.open({ bytes: last.text_bytes, format: "html", document_id: "H1", asset_manifest: last.manifest });
      if (outcome.outcome !== "opened") throw new Error("reopen");
      ref = outcome.document_model_ref;
    }
    expect(html.snapshot(ref).text).toBe(source + "<p>Lần một</p><p>Lần hai</p>");
    expect(store.committed.get("H1")!.get("css/site.css")).toEqual(CSS);
    expect(store.committed.get("H1")!.get("img/a b.png")).toEqual(PNG_BYTES);
  });

  it("rebases CSS and image references on save-as", async () => {
    const html = createHtmlEngine({ upstream: fakeHtmlUpstream() });
    const m = await manifest("site/pages/p.html", { "site/theme/bg.png": [PNG_BYTES, "image/png"] });
    const store = fakeStore("H1", { "site/theme/bg.png": PNG_BYTES });
    const source = `<div style="background:url(../theme/bg.png)"></div>`;
    const outcome = await html.open({ bytes: utf8(source), format: "html", document_id: "H1", asset_manifest: m });
    if (outcome.outcome !== "opened") throw new Error("open");
    await html.saveAs(outcome.document_model_ref, { target_document_id: "H2", target_document_path: "copy.html", ...store });
    expect(new TextDecoder().decode(store.published[0]!.text_bytes)).toBe(`<div style="background:url(&quot;assets/bg.png&quot;)"></div>`);
    expect(store.committed.get("H2")!.get("assets/bg.png")).toEqual(PNG_BYTES);
  });

  it("carries an image only upstream found, and fails save-as loudly when it cannot rewrite it", async () => {
    const hidden = (text: string) => (text.includes("HIDDEN") ? ["../hidden.png"] : []);
    const html = createHtmlEngine({ upstream: fakeHtmlUpstream({ extraImages: hidden }) });
    const m = await manifest("pages/p.html", { "hidden.png": [PNG_BYTES, "image/png"] });
    const store = fakeStore("H1", { "hidden.png": PNG_BYTES });
    const outcome = await html.open({ bytes: utf8("<p>HIDDEN</p>"), format: "html", document_id: "H1", asset_manifest: m });
    if (outcome.outcome !== "opened") throw new Error("open");
    expect(html.snapshot(outcome.document_model_ref).references).toEqual(["../hidden.png"]);
    await html.save(outcome.document_model_ref, store);
    expect(store.staged).toEqual(["hidden.png"]);
    await expect(
      html.saveAs(outcome.document_model_ref, { target_document_id: "H2", target_document_path: "p.html", ...store }),
    ).rejects.toMatchObject({ code: "commit_failed", fields: { reason: "asset_rewrite_unverified" } });
    expect(store.published).toHaveLength(1);
    html.close(outcome.document_model_ref);
  });
});
