import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { handleDesktopEngineCall, releaseRetainedPdfs, retainedPdfStatsForTests } from "../src/desktop/pdf-host";
import { loadedPdfKeyForTests, releaseLoadedPdf } from "../src/desktop/pdf-render";

const FIXTURES = fileURLToPath(new URL("../../../docs/office/g0/fixtures/files/pdf/", import.meta.url));
const b64 = (name: string) => new Uint8Array(readFileSync(FIXTURES + name));
const SESSION = "session_1234";
const STALE = { ok: false, error: { kind: "handle", status: "unknown" } };

/** Wait for every queued pdfium turn (a release is queued, not immediate). */
const settlePdfium = (): Promise<void> => releaseLoadedPdf("pdf_settle_only");

const openRetained = async (extra: Record<string, unknown> = {}, name = "pdf-text-editable.pdf"): Promise<string> => {
  const result = await handleDesktopEngineCall({ operation: "open", handle: "doc", sessionGeneration: SESSION, args: { data: b64(name), retain: true, ...extra } });
  if (!result.ok || result.operation !== "open" || !result.pdfHandle) throw new Error("open did not retain");
  return result.pdfHandle;
};

const render = (pdfHandle: string, extra: Record<string, unknown> = {}) =>
  handleDesktopEngineCall({ operation: "render", handle: "doc", sessionGeneration: SESSION, args: { pdfHandle, pageIndex: 0, scale: 0.2, ...extra } });

afterEach(async () => {
  releaseRetainedPdfs();
  await settlePdfium();
});

describe("retained PDFs belong to one renderer load", () => {
  it("frees every document and password when the renderer load ends, and its handles answer stale", async () => {
    const plain = await openRetained();
    await openRetained({ surface: "surface-b", password: "    " }, "pdf-password-4spaces.pdf");
    expect(retainedPdfStatsForTests()).toMatchObject({ documents: 2, withPassword: 1 });
    releaseRetainedPdfs();
    expect(retainedPdfStatsForTests()).toEqual({ documents: 0, bytes: 0, withPassword: 0 });
    await expect(render(plain)).resolves.toEqual(STALE);
    // The next load opens and renders as usual.
    await expect(render(await openRetained())).resolves.toMatchObject({ ok: true, operation: "render" });
  });

  it("keeps nothing for an open that was still in flight when the load ended", async () => {
    const pending = handleDesktopEngineCall({ operation: "open", handle: "doc", sessionGeneration: SESSION, args: { data: b64("pdf-text-editable.pdf"), retain: true } });
    releaseRetainedPdfs();
    await expect(pending).resolves.toEqual(STALE);
    expect(retainedPdfStatsForTests().documents).toBe(0);
  });
});

describe("retained PDFs are keyed by surface instance", () => {
  it("lets two surfaces of one document keep their own handle without evicting each other", async () => {
    const older = await openRetained({ surface: "surface-old" });
    const newer = await openRetained({ surface: "surface-new" });
    expect(retainedPdfStatsForTests().documents).toBe(2);
    await expect(render(older, { surface: "surface-old" })).resolves.toMatchObject({ ok: true });
    await expect(render(newer, { surface: "surface-new" })).resolves.toMatchObject({ ok: true });
    // A surface cannot use or close the other's document.
    await expect(render(older, { surface: "surface-new" })).resolves.toEqual(STALE);
    await handleDesktopEngineCall({ operation: "close", handle: "doc", sessionGeneration: SESSION, args: { pdfHandle: newer, surface: "surface-old" } });
    expect(retainedPdfStatsForTests().documents).toBe(2);
  });

  it("refuses a malformed surface id", async () => {
    await expect(openRetained({ surface: 7 })).rejects.toMatchObject({ code: "engine_input_missing" });
    await expect(openRetained({ surface: "s".repeat(129) })).rejects.toMatchObject({ code: "engine_input_missing" });
  });
});

describe("closing and reading a retained PDF", () => {
  it("refuses a close that names no handle and keeps the owner's live document", async () => {
    const pdfHandle = await openRetained();
    await expect(handleDesktopEngineCall({ operation: "close", handle: "doc", sessionGeneration: SESSION, args: {} })).rejects.toMatchObject({ name: "DesktopEngineCallError", code: "engine_input_missing" });
    await expect(render(pdfHandle)).resolves.toMatchObject({ ok: true });
  });

  it("refuses a read that carries both a handle and bytes", async () => {
    const pdfHandle = await openRetained();
    await expect(render(pdfHandle, { data: b64("pdf-text-editable.pdf") })).rejects.toMatchObject({ code: "engine_input_missing" });
  });
});

describe("re-opening a retained PDF by handle", () => {
  it("re-probes an encrypted document by its live handle without the password and keeps it", async () => {
    const first = await openRetained({ password: "    " }, "pdf-password-4spaces.pdf");
    const second = await openRetained({ pdfHandle: first }, "pdf-password-4spaces.pdf");
    expect(second).not.toBe(first);
    expect(retainedPdfStatsForTests()).toMatchObject({ documents: 1, withPassword: 1 });
    await expect(render(second)).resolves.toMatchObject({ ok: true, operation: "render" });
    await expect(render(first)).resolves.toEqual(STALE);
  });

  it("lends no password from a handle the caller does not own", async () => {
    const owned = await openRetained({ surface: "surface-a", password: "    " }, "pdf-password-4spaces.pdf");
    await expect(handleDesktopEngineCall({ operation: "open", handle: "doc", sessionGeneration: SESSION, args: { data: b64("pdf-password-4spaces.pdf"), retain: true, pdfHandle: owned, surface: "surface-b" } }))
      .resolves.toEqual({ ok: false, error: { kind: "password", status: "required" } });
    await expect(handleDesktopEngineCall({ operation: "open", handle: "doc", sessionGeneration: SESSION, args: { data: b64("pdf-password-4spaces.pdf"), retain: true, pdfHandle: "pdf_unknown" } }))
      .resolves.toEqual({ ok: false, error: { kind: "password", status: "required" } });
  });
});

describe("one loaded pdfium document per retained handle", () => {
  it("keeps the rendered handle's document loaded and draws the same pixels as an inline render", async () => {
    const pdfHandle = await openRetained();
    const inline = await handleDesktopEngineCall({ operation: "render", handle: "doc", args: { data: b64("pdf-text-editable.pdf"), pageIndex: 0, scale: 0.2 } });
    expect(loadedPdfKeyForTests()).toBeNull();
    const first = await render(pdfHandle);
    expect(loadedPdfKeyForTests()).toBe(pdfHandle);
    const second = await render(pdfHandle);
    const text = await handleDesktopEngineCall({ operation: "text", handle: "doc", sessionGeneration: SESSION, args: { pdfHandle, pageIndex: 0 } });
    expect(first).toEqual(inline);
    expect(second).toEqual(inline);
    expect(text).toMatchObject({ ok: true, operation: "text" });
    expect(loadedPdfKeyForTests()).toBe(pdfHandle);
  });

  it("follows the most recently rendered handle and frees it on close", async () => {
    const one = await openRetained({ surface: "one" });
    const two = await openRetained({ surface: "two" });
    await render(one, { surface: "one" });
    await render(two, { surface: "two" });
    expect(loadedPdfKeyForTests()).toBe(two);
    await handleDesktopEngineCall({ operation: "close", handle: "doc", sessionGeneration: SESSION, args: { pdfHandle: two, surface: "two" } });
    await settlePdfium();
    expect(loadedPdfKeyForTests()).toBeNull();
  });

  it("frees the loaded document when its handle is evicted by a newer open of the owner", async () => {
    const first = await openRetained();
    await render(first);
    await openRetained();
    await settlePdfium();
    expect(loadedPdfKeyForTests()).toBeNull();
  });

  it("frees the loaded document before an edit turn and before an open turn", async () => {
    const pdfHandle = await openRetained();
    await render(pdfHandle);
    const edit = handleDesktopEngineCall({ operation: "edit", handle: "doc", args: { data: b64("pdf-text-editable.pdf"), edits: [] } });
    await settlePdfium();
    expect(loadedPdfKeyForTests()).toBeNull();
    await edit;
    await render(pdfHandle);
    expect(loadedPdfKeyForTests()).toBe(pdfHandle);
    const open = handleDesktopEngineCall({ operation: "open", handle: "doc-other", args: { data: b64("pdf-text-editable.pdf") } });
    await settlePdfium();
    expect(loadedPdfKeyForTests()).toBeNull();
    await open;
  });

  it("frees the loaded documents when the renderer load ends", async () => {
    await render(await openRetained());
    releaseRetainedPdfs();
    await settlePdfium();
    expect(loadedPdfKeyForTests()).toBeNull();
  });
});
