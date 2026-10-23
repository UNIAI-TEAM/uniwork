import { describe, expect, it } from "vitest";
import {
  HOST_CONTRACT_CHANNELS,
  HostCapabilityRefusal,
  slidesEditTransformRequestSchema,
} from "./index.ts";

// The host adapter contract: ADR 0021's host:slides-edit-transform channel is
// owned (not a typed refusal), and a missing capability is a typed refusal -
// never silent, never fabricated.

describe("host:slides-edit-transform", () => {
  it("is a first-class contract channel", () => {
    expect(HOST_CONTRACT_CHANNELS).toContain("host:slides-edit-transform");
  });

  it("validates the renderer-owned transform payload", () => {
    const parsed = slidesEditTransformRequestSchema.parse({
      slideIndex: 2,
      sourceId: "el-7",
      xPx: 10,
      yPx: 20,
      wPx: 300,
      hPx: 150,
      rotationDeg: 15,
      fitWidthPx: null,
      groupId: null,
    });
    expect(parsed.slideIndex).toBe(2);
    expect(parsed.rotationDeg).toBe(15);
  });

  it("rejects a payload missing the transform vector", () => {
    expect(() =>
      slidesEditTransformRequestSchema.parse({ slideIndex: 0, sourceId: "el-1" }),
    ).toThrow();
  });
});

describe("HostCapabilityRefusal", () => {
  it("is a typed refusal with a named channel and reason", () => {
    const refusal = new HostCapabilityRefusal(
      "host:slides-edit-transform",
      "unbound",
      "the pptx-edit-transform engine op is not bound on this host",
    );
    expect(refusal.channel).toBe("host:slides-edit-transform");
    expect(refusal.reason).toBe("unbound");
    expect(refusal.toJSON()).toMatchObject({
      kind: "host_refusal",
      channel: "host:slides-edit-transform",
      reason: "unbound",
    });
  });

  it("can carry the engine boundary code that caused it", () => {
    const refusal = new HostCapabilityRefusal(
      "host:docs-save",
      "failed",
      "engine refused the write",
      "engine_crashed",
    );
    expect(refusal.engine_error).toBe("engine_crashed");
    expect(refusal.toJSON().engine_error).toBe("engine_crashed");
  });

  it("keeps a clean caller message on the wire", () => {
    const refusal = new HostCapabilityRefusal("host:docs-save", "unbound", "save op is not bound");
    expect(refusal.toJSON().message).toBe("save op is not bound");
  });

  it("replaces a caller message that names a host path or key", () => {
    const refusal = new HostCapabilityRefusal(
      "host:docs-save",
      "failed",
      "cannot write C:\\work\\out.docx - denied",
    );
    expect(refusal.toJSON().message).toBe("host:docs-save refused: failed");
    expect(JSON.stringify(refusal.toJSON())).not.toContain("C:\\work");
  });
});
