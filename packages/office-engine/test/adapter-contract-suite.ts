import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import type { OfficeEngine } from "../src/index";
import { HostCapabilityRefusal } from "@uniwork/office-contracts";

/** sha256 of zero bytes: convert envelopes now carry the measured source
    tuple, so a refusal test needs a valid one. */
const EMPTY_SHA256 = createHash("sha256").digest("hex");

// The shared adapter contract suite (task brief: "a shared adapter contract
// suite"). Every runtime entry point runs it against ITS OWN transport wired
// to the fake engine; a fake adapter itself never ships - the suite exists so
// each runtime proves the same contract behaviours:
//
//   1. capability answers honest evidence levels (pending never supported)
//   2. a failed job surfaces the typed error, never silent success
//   3. an unbound operation is a typed refusal, not a fabricated result
//   4. a completed result is projected publicly - no authority/storage fields
//   5. the fingerprint is deterministic for identical decisive input

export function runOfficeEngineContractSuite(name: string, factory: () => OfficeEngine): void {
  it(`${name}: capability demotes pending proof`, async () => {
    const engine = factory();
    const result = await engine.capability("docx");
    for (const entry of result.capabilities) {
      if (entry.supported) expect(entry.evidence_level).toBe("proven");
    }
    const serialize = result.capabilities.find((c) => c.operation === "serialize");
    expect(serialize?.evidence_level).toBe("pending");
    expect(serialize?.supported).toBe(false);
  });

  it(`${name}: a failed job surfaces the typed boundary error`, async () => {
    const engine = factory();
    await expect(
      engine.submit({
        request_id: "req-fail",
        operation: "edit",
        format: "docx",
        deadline_ms: 30000,
        payload: { edits: [] },
      }),
    ).rejects.toMatchObject({ name: "EngineBoundaryError" });
  });

  it(`${name}: an unbound operation is a typed refusal, not a fabricated result`, async () => {
    const engine = factory();
    await expect(
      engine.submit({
        request_id: "req-unbound",
        operation: "convert",
        format: "docx",
        deadline_ms: 30000,
        payload: {
          source_version_id: "V1",
          target_format: "pdf",
          input_bytes: "",
          input_checksum: EMPTY_SHA256,
          input_length: 0,
        },
      }),
    ).rejects.toBeInstanceOf(HostCapabilityRefusal);
  });

  it(`${name}: a completed result carries no authority or storage fields`, async () => {
    const engine = factory();
    const result = await engine.submit({
      request_id: "req-ser",
      operation: "serialize",
      format: "docx",
      deadline_ms: 30000,
      payload: { document_model_ref: "engine-session:J1" },
    });
    expect(result.state).toBe("completed");
    expect(result.output_object_key).toBeUndefined();
    expect(result.output_checksum).toBeDefined();
  });

  it(`${name}: the fingerprint is deterministic for identical decisive input`, async () => {
    const engine = factory();
    const input = {
      operation: "open" as const,
      format: "docx" as const,
      deadline_ms: 30000,
      payload: { base_revision: 12, base_version_id: "01J8Z0V0000000000000000A" },
    };
    const a = await engine.fingerprint({ ...input, request_id: "r1" });
    const b = await engine.fingerprint({ ...input, request_id: "r2" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
}
