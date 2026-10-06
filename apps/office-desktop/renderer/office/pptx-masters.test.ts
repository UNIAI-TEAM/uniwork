/** @vitest-environment node */
// UNI-927 B6 (desktop) - the master-part reads follow the slideNotes threading:
// runtime pass-through of the LIVE engine ref, a released-session refusal, and
// the adapter handle's graceful [] when a read is unavailable. The runtime runs
// against the real PptxAdapter/session over the fake engine; the engine's two
// master reads (a sibling lane) are wrapped so this suite pins only the desktop
// wiring and never depends on the master part parser.
import { describe, expect, it, vi } from "vitest";
import type { OpenedPptxLike, PptxTxnRequest } from "@uniwork/office-engine/pptx";
import type { OfficeCapabilityEntry, OfficeIdentity } from "@uniwork/core/office";
import { makeFakePptxBytes } from "../../../../packages/office-engine/test/fake-pptx-fixtures";
import { createDesktopPptxAdapter } from "./pptx-adapter";
import { createWebPptxSessionRuntime, type PptxSessionRuntime } from "./pptx-runtime";

const spy = vi.hoisted(() => ({
  parts: [] as Array<{ ref: string }>,
  elements: [] as Array<{ ref: string; partPath: string }>,
}));

vi.mock("@uniwork/office-engine/pptx", async (importOriginal) => {
  const real = await importOriginal<typeof import("@uniwork/office-engine/pptx")>();
  return {
    ...real,
    createPptxAdapter: (...args: Parameters<typeof real.createPptxAdapter>) => {
      const adapter = real.createPptxAdapter(...args) as unknown as Record<string, unknown>;
      adapter.masterParts = (ref: string) => {
        spy.parts.push({ ref });
        return [{ path: "ppt/slideMasters/slideMaster1.xml", kind: "master", name: "Office Theme" }];
      };
      adapter.masterElements = (ref: string, partPath: string) => {
        spy.elements.push({ ref, partPath });
        return [{ id: "m1", type: "text", label: "Title", box: { x: 1, y: 2, w: 3, h: 4 }, fill: null }];
      };
      return adapter;
    },
  };
});

vi.mock("@uniwork/office-upstream/pptx-renderer", async () => {
  const fakes = await import("../../../../packages/office-engine/test/fake-pptx-engine");
  const engine = fakes.createFakePptxEngine();
  const ops = fakes.createFakePptxOps();
  return {
    openPptx: (bytes: Uint8Array) => engine.openPptx(bytes),
    savePptx: (opened: OpenedPptxLike) => engine.savePptx(opened),
    commitSaved: (opened: OpenedPptxLike) => engine.commitSaved?.(opened),
    reparseDeck: (opened: OpenedPptxLike) => engine.reparseDeck?.(opened) ?? opened,
    listSlideLayouts: (archive: unknown) => engine.listSlideLayouts?.(archive) ?? [],
    runTxn: (opened: OpenedPptxLike, request: PptxTxnRequest) => ops.runTxn(opened, request),
    getSlideNotes: () => "",
    parseMasterPart: () => null,
    buildRenderSlide: () => ({ nodes: [] }),
    HeuristicMetrics: class HeuristicMetrics {},
  };
});

const identity = { documentId: "doc" } as unknown as OfficeIdentity;
const capability = { format: "pptx", operation: "serialize", host: "desktop", status: "available" } as unknown as OfficeCapabilityEntry;

async function openedRuntime(): Promise<{ runtime: PptxSessionRuntime; ref: string }> {
  const runtime = createWebPptxSessionRuntime({ documentId: "doc" });
  const result = await runtime.open({ bytes: makeFakePptxBytes(), documentId: "doc" });
  if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("open failed");
  return { runtime, ref: result.document_model_ref };
}

describe("desktop pptx runtime master reads", () => {
  it("passes the live engine ref and the part path through, and refuses after release", async () => {
    spy.parts.length = 0;
    spy.elements.length = 0;
    const { runtime, ref } = await openedRuntime();
    expect(runtime.masterParts!(ref)).toEqual([{ path: "ppt/slideMasters/slideMaster1.xml", kind: "master", name: "Office Theme" }]);
    expect(runtime.masterElements!(ref, "ppt/slideMasters/slideMaster1.xml")).toHaveLength(1);
    expect(spy.parts).toHaveLength(1);
    expect(spy.elements[0]?.partPath).toBe("ppt/slideMasters/slideMaster1.xml");
    // The engine reads the engine session ref, which the runtime resolves from its own ref.
    expect(spy.parts[0]?.ref).toBeTruthy();
    expect(spy.elements[0]?.ref).toBe(spy.parts[0]?.ref);
    await runtime.release(ref);
    expect(() => runtime.masterParts!(ref)).toThrow("pptx_runtime_not_open");
    expect(() => runtime.masterElements!(ref, "ppt/slideMasters/slideMaster1.xml")).toThrow("pptx_runtime_not_open");
  });
});

describe("desktop pptx adapter master ports", () => {
  const part = { path: "ppt/slideMasters/slideMaster1.xml", kind: "master", name: "Office Theme" };
  const element = { id: "m1", type: "text", label: "Title", box: { x: 1, y: 2, w: 3, h: 4 }, fill: null };

  function fakeRuntime(extra: Partial<PptxSessionRuntime>): PptxSessionRuntime {
    return {
      open: async () => ({ outcome: "opened", document_id: "doc", document_model_ref: "ref-1" }),
      snapshot: () => ({ revision: 0, edits: [] }),
      release: async () => undefined,
      ...extra,
    } as unknown as PptxSessionRuntime;
  }

  it("exposes masterParts/masterElements bound to the open model ref", async () => {
    const calls: string[] = [];
    const runtime = fakeRuntime({
      masterParts: (ref) => { calls.push(`parts:${ref}`); return [part] as never; },
      masterElements: (ref, partPath) => { calls.push(`elements:${ref}:${partPath}`); return [element]; },
    });
    const adapter = createDesktopPptxAdapter({ identity, runtime, readBytes: async () => new Uint8Array(), capability });
    // Before the open there is no model: both reads degrade to [].
    expect(adapter.editor.masterParts()).toEqual([]);
    expect(adapter.editor.masterElements("x")).toEqual([]);
    await adapter.editor.open();
    expect(adapter.editor.masterParts()).toEqual([part]);
    expect(adapter.editor.masterElements("p.xml")).toEqual([element]);
    expect(calls).toEqual(["parts:ref-1", "elements:ref-1:p.xml"]);
    await adapter.editor.dispose();
    expect(adapter.editor.masterParts()).toEqual([]);
    expect(adapter.editor.masterElements("p.xml")).toEqual([]);
  });

  it("returns [] when the runtime predates the reads", async () => {
    const adapter = createDesktopPptxAdapter({ identity, runtime: fakeRuntime({}), readBytes: async () => new Uint8Array(), capability });
    await adapter.editor.open();
    expect(adapter.editor.masterParts()).toEqual([]);
    expect(adapter.editor.masterElements("p.xml")).toEqual([]);
  });
});
