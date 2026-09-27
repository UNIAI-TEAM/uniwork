import { describe, expect, it } from "vitest";
import { createBrowserOfficeEngine } from "../src/browser/index";
import { createDesktopOfficeEngine } from "../src/desktop/index";
import { createNodeOfficeEngine } from "../src/node/index";
import { createOfficeEngine } from "../src/index";
import type { HostIpcPort } from "@uniwork/office-contracts";
import { HostCapabilityRefusal } from "@uniwork/office-contracts";
import { createFakeEngineTransport } from "./fake-transport";

// Refusal-path coverage: every transport maps a raw failure into the named
// typed surface, and never invents a success.

function throwingIpc(error: unknown, captured?: { channel: string }[]): HostIpcPort {
  return {
    async call(channel: string) {
      captured?.push({ channel });
      throw error;
    },
    send() {},
    subscribe() {
      return () => {};
    },
  };
}

const validSubmit = {
  request_id: "r",
  operation: "open" as const,
  format: "docx" as const,
  deadline_ms: 30000,
  payload: {
    input_bytes: "aGVsbG8=",
    input_checksum: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    input_length: 5,
    base_revision: 1,
    base_version_id: "v",
  },
};

describe("transport refusal mapping", () => {
  it("browser: a raw transport failure becomes a 'failed' refusal", async () => {
    const engine = createBrowserOfficeEngine({ ipc: throwingIpc(new Error("boom")) });
    await expect(engine.submit(validSubmit)).rejects.toMatchObject({
      name: "HostCapabilityRefusal",
      channel: "engine:submit",
      reason: "failed",
    });
  });

  it("browser: a typed refusal from the host passes through unchanged", async () => {
    const refusal = new HostCapabilityRefusal("engine:submit", "policy", "refused by policy");
    const engine = createBrowserOfficeEngine({ ipc: throwingIpc(refusal) });
    await expect(engine.submit(validSubmit)).rejects.toBe(refusal);
  });

  it("browser: cancel routes through the cancel channel and maps failures", async () => {
    const engine = createBrowserOfficeEngine({ ipc: throwingIpc(new Error("ipc closed")) });
    await expect(engine.cancel("JOB1", "user_closed")).rejects.toMatchObject({
      name: "HostCapabilityRefusal",
      channel: "engine:cancel",
      reason: "failed",
    });
  });

  it("desktop: submit failure becomes a 'failed' refusal; typed refusals pass through", async () => {
    const engine = createDesktopOfficeEngine({ ipc: throwingIpc(new Error("transport down")) });
    await expect(engine.submit(validSubmit)).rejects.toMatchObject({
      name: "HostCapabilityRefusal",
      reason: "failed",
    });
    const refusal = new HostCapabilityRefusal("engine:submit", "unbound");
    const engine2 = createDesktopOfficeEngine({ ipc: throwingIpc(refusal) });
    await expect(engine2.submit(validSubmit)).rejects.toBe(refusal);
  });

  it("desktop: cancel failure maps to a 'failed' refusal", async () => {
    const engine = createDesktopOfficeEngine({ ipc: throwingIpc(new Error("closed")) });
    await expect(engine.cancel("JOB1")).rejects.toMatchObject({
      name: "HostCapabilityRefusal",
      channel: "engine:cancel",
      reason: "failed",
    });
  });

  it("node: cancel on an unreachable host maps to engine_crashed", async () => {
    const engine = createNodeOfficeEngine({
      baseUrl: "http://engine.local",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    await expect(engine.cancel("JOB1")).rejects.toMatchObject({
      name: "EngineBoundaryError",
      code: "engine_crashed",
      retryable: true,
    });
  });

  it("node: cancel returning non-JSON maps to engine_result_invalid", async () => {
    const engine = createNodeOfficeEngine({
      baseUrl: "http://engine.local",
      fetchImpl: (async () => new Response("<html>", { status: 200 })) as typeof fetch,
    });
    await expect(engine.cancel("JOB1")).rejects.toMatchObject({
      name: "EngineBoundaryError",
      code: "engine_result_invalid",
    });
  });

  it("facade: cancel returns the projected result", async () => {
    const engine = createOfficeEngine({ transport: createFakeEngineTransport() });
    const result = await engine.cancel("JOB9", "user_closed");
    expect(result.job_id).toBe("JOB9");
    expect(result.state).toBe("cancelled");
  });

  it("facade: convert/export refuse by name at G0 (error envelope -> typed error)", async () => {
    const transport = createFakeEngineTransport({ boundOperations: ["capability", "open", "edit", "serialize", "cancel", "convert"] });
    const engine = createOfficeEngine({ transport });
    await expect(
      engine.submit({
        request_id: "r",
        operation: "convert",
        format: "docx",
        deadline_ms: 30000,
        payload: { source_version_id: "V1", target_format: "pdf" },
      }),
    ).rejects.toMatchObject({ name: "EngineBoundaryError", code: "unsupported_operation" });
  });

  it("facade: a leaking engine result raises instead of emitting it", async () => {
    const transport = createFakeEngineTransport({
      results: {
        open: {
          job_id: "J1",
          state: "completed",
          operation: "open",
          document_model_ref: "engine-session:J1",
          // A schema-retained field whose VALUE leaks a host path - the
          // projection must refuse to emit it.
          warnings: [{ code: "fonts_substituted", detail: "missing /home/worker/fonts/serif.ttf" }],
        },
      },
    });
    const engine = createOfficeEngine({ transport });
    await expect(engine.submit(validSubmit)).rejects.toThrowError(/leak|violation/i);
  });
});
