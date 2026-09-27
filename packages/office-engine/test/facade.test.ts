import { describe, expect, it } from "vitest";
import { createOfficeEngine } from "../src/index";
import { EngineContractViolation } from "@uniwork/office-contracts";
import { createFakeEngineTransport } from "./fake-transport";
import { runOfficeEngineContractSuite } from "./adapter-contract-suite";

describe("office engine facade", () => {
  runOfficeEngineContractSuite("facade+fake-transport", () =>
    createOfficeEngine({ transport: createFakeEngineTransport() }),
  );

  it("rejects a malformed envelope before the transport sees it", async () => {
    const submitted: Record<string, unknown>[] = [];
    const engine = createOfficeEngine({ transport: createFakeEngineTransport({ submitted }) });
    await expect(
      engine.submit({
        request_id: "r",
        operation: "open",
        format: "docx",
        deadline_ms: 30000,
        payload: { output_object_key: "office/evil", base_revision: 1, base_version_id: "v" },
      }),
    ).rejects.toMatchObject({ name: "EngineContractViolation", rule: "unknown_field" });
    expect(submitted).toHaveLength(0);
  });

  it("injects contract identity into the envelope", async () => {
    const submitted: Record<string, unknown>[] = [];
    const engine = createOfficeEngine({ transport: createFakeEngineTransport({ submitted }) });
    await engine.submit({
      request_id: "req-open",
      operation: "capability",
      format: "xlsx",
      payload: {},
    });
    expect(submitted[0]).toMatchObject({
      contract_version: "uniwork-office-engine-contract/1",
      protocol_version: 1,
      operation: "capability",
      format: "xlsx",
    });
  });

  it("fails when the transport returns a schema-broken result", async () => {
    const engine = createOfficeEngine({
      transport: createFakeEngineTransport({
        results: { open: { job_id: "J", state: "completed", operation: "open" } },
      }),
    });
    await expect(
      engine.submit({
        request_id: "req-open",
        operation: "open",
        format: "docx",
        deadline_ms: 30000,
        payload: {
          input_bytes: "aGVsbG8=",
          input_checksum: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          input_length: 5,
          base_revision: 1,
          base_version_id: "v",
        },
      }),
    ).rejects.toThrow();
  });

  it("cancel without a transport cancel is a typed refusal", async () => {
    const engine = createOfficeEngine({
      transport: { submit: async () => ({}) },
    });
    await expect(engine.cancel("JOB1")).rejects.toThrowError(/does not implement cancel/);
    await expect(engine.cancel("JOB1")).rejects.toMatchObject({ name: "HostCapabilityRefusal" });
  });

  it("a malformed request is a contract violation, not a boundary error", async () => {
    const engine = createOfficeEngine({ transport: createFakeEngineTransport() });
    await expect(
      engine.submit({
        request_id: "r",
        operation: "open",
        format: "docx",
        deadline_ms: 30000,
        payload: { surprise: 1 },
      }),
    ).rejects.toBeInstanceOf(EngineContractViolation);
  });
});
