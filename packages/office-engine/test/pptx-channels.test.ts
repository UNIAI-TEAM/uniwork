// host:slides-edit-transform / host:slides-edit-text channel tests (ADR 0021
// QĐ6.3): the channel is implemented end-to-end — contract-validated gesture
// → real setTransform op on the session deck → updated RenderSlide — and an
// unbound render port produces a typed refusal BEFORE any mutation, never a
// fabricated slide.
import { describe, expect, it } from "vitest";
import { HostCapabilityRefusal } from "@uniwork/office-contracts";
import { createPptxAdapter, elementText, EMU_PER_PX_96, PPTX_HOST_CHANNELS, type PptxHostChannel } from "../src/pptx";
import { createFakePptxEngine, createFakePptxOps, createFakePptxRender } from "./fake-pptx-engine";
import { makeFakePptxBytes } from "./fake-pptx-fixtures";

const boundDeck = async () => {
  const adapter = createPptxAdapter({ engine: createFakePptxEngine(), ops: createFakePptxOps(), render: createFakePptxRender() });
  const out = await adapter.open({ bytes: makeFakePptxBytes(), format: "pptx", document_id: "deck-ch" });
  if (out.outcome !== "opened") throw new Error("open failed");
  return { adapter, ref: out.document_model_ref };
};

const unboundDeck = async () => {
  const adapter = createPptxAdapter({ engine: createFakePptxEngine(), ops: createFakePptxOps() });
  const out = await adapter.open({ bytes: makeFakePptxBytes(), format: "pptx", document_id: "deck-ub" });
  if (out.outcome !== "opened") throw new Error("open failed");
  return { adapter, ref: out.document_model_ref };
};

describe("host:slides-edit-transform", () => {
  it("applies the gesture and answers the updated RenderSlide", async () => {
    const { adapter, ref } = await boundDeck();
    const slide = await adapter.dispatchHostChannel(ref, "host:slides-edit-transform", {
      slideIndex: 0,
      sourceId: "s1",
      xPx: 120,
      yPx: 60,
      wPx: 300,
      hPx: 150,
      rotationDeg: 30,
      fitWidthPx: 960,
    });
    // RenderSlide = the updated slide projection with the moved element
    const el = (slide.elements as Array<{ id: string; offset: { x: number; y: number; cx: number; cy: number } }>).find(
      (e) => e.id === "s1",
    );
    expect(el?.offset).toEqual({ x: 120 * EMU_PER_PX_96, y: 60 * EMU_PER_PX_96, cx: 300 * EMU_PER_PX_96, cy: 150 * EMU_PER_PX_96 });
    // and the held model carries the same state — the channel edits the deck
    const model = adapter.sessionOf(ref).model;
    expect(model.opened.deck.slides[0]?.elements.find((e) => e.id === "s1")?.transform?.rot).toBe(30);
  });

  it("falls back to the session fitWidth when the request omits it", async () => {
    const { adapter, ref } = await boundDeck();
    await adapter.dispatchHostChannel(ref, "host:slides-edit-transform", {
      slideIndex: 0,
      sourceId: "s1",
      xPx: 10,
      yPx: 10,
      wPx: 96,
      hPx: 96,
    });
    const el = adapter.sessionOf(ref).model.opened.deck.slides[0]?.elements.find((e) => e.id === "s1");
    // session fitWidth = 960 → scale 1 → 96px = 96*9525
    expect(el?.transform?.offset.cx).toBe(96 * EMU_PER_PX_96);
  });

  it("a schema-broken body refuses 'failed' without mutating", async () => {
    const { adapter, ref } = await boundDeck();
    const before = JSON.stringify(adapter.sessionOf(ref).model.opened.deck.slides);
    const error = await adapter
      .dispatchHostChannel(ref, "host:slides-edit-transform", { slideIndex: "zero", sourceId: "s1" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostCapabilityRefusal);
    expect((error as HostCapabilityRefusal).reason).toBe("failed");
    expect(JSON.stringify(adapter.sessionOf(ref).model.opened.deck.slides)).toBe(before);
  });

  it("unbound render => typed 'unbound' refusal BEFORE any mutation", async () => {
    const { adapter, ref } = await unboundDeck();
    const before = JSON.stringify(adapter.sessionOf(ref).model.opened.deck.slides);
    const error = await adapter
      .dispatchHostChannel(ref, "host:slides-edit-transform", {
        slideIndex: 0,
        sourceId: "s1",
        xPx: 1,
        yPx: 1,
        wPx: 10,
        hPx: 10,
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostCapabilityRefusal);
    expect((error as HostCapabilityRefusal).reason).toBe("unbound");
    expect((error as HostCapabilityRefusal).channel).toBe("host:slides-edit-transform");
    expect(JSON.stringify(adapter.sessionOf(ref).model.opened.deck.slides)).toBe(before);
    expect(adapter.sessionOf(ref).model.dirty).toBe(false);
  });
});

describe("host:slides-edit-text", () => {
  it("applies setText and answers the updated RenderSlide", async () => {
    const { adapter, ref } = await boundDeck();
    await adapter.dispatchHostChannel(ref, "host:slides-edit-text", {
      slideIndex: 0,
      sourceId: "t1",
      paragraphs: [{ runs: [{ text: "CHANNEL-EDITED" }] }],
    });
    const el = adapter.sessionOf(ref).model.opened.deck.slides[0]?.elements.find((e) => e.id === "t1");
    expect(elementText(el)).toBe("CHANNEL-EDITED");
  });

  it("unbound render => 'unbound' refusal, deck untouched", async () => {
    const { adapter, ref } = await unboundDeck();
    const before = JSON.stringify(adapter.sessionOf(ref).model.opened.deck.slides);
    const error = await adapter
      .dispatchHostChannel(ref, "host:slides-edit-text", { slideIndex: 0, sourceId: "t1", paragraphs: [{ runs: [{ text: "x" }] }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostCapabilityRefusal);
    expect((error as HostCapabilityRefusal).reason).toBe("unbound");
    expect(JSON.stringify(adapter.sessionOf(ref).model.opened.deck.slides)).toBe(before);
  });
});

describe("channel dispatch", () => {
  it("the declared channel list is exactly what dispatch routes", async () => {
    const { adapter, ref } = await boundDeck();
    // Every declared channel has a handler: a schema-broken body reaches the
    // handler and refuses 'failed' — never the 'unsupported' fallthrough.
    const channels: readonly PptxHostChannel[] = PPTX_HOST_CHANNELS;
    expect(channels).toEqual(["host:slides-edit-transform", "host:slides-edit-text"]);
    for (const channel of channels) {
      const error = await adapter.dispatchHostChannel(ref, channel, { bogus: true }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HostCapabilityRefusal);
      expect((error as HostCapabilityRefusal).reason).toBe("failed");
      // and the capability row advertises the same list
    }
    const cap = (await adapter.capability("pptx")) as { channels: string[] };
    expect(cap.channels).toEqual([...PPTX_HOST_CHANNELS]);
  });

  it("a channel the adapter does not own refuses 'unsupported' by name", async () => {
    const { adapter, ref } = await boundDeck();
    const error = await adapter.dispatchHostChannel(ref, "host:docs-save", { dataBase64: "AA==" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostCapabilityRefusal);
    expect((error as HostCapabilityRefusal).reason).toBe("unsupported");
    expect((error as HostCapabilityRefusal).channel).toBe("host:docs-save");
  });

  it("an unknown session ref fails not_found before channel logic", async () => {
    const { adapter } = await boundDeck();
    await expect(
      adapter.dispatchHostChannel("pptx-session-zzz", "host:slides-edit-transform", { slideIndex: 0, sourceId: "s1", xPx: 1, yPx: 1, wPx: 1, hPx: 1 }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
