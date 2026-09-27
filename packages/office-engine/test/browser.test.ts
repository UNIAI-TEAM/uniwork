import { describe, expect, it } from "vitest";
import {
  ENGINE_SUBMIT_CHANNEL,
  createBrowserOfficeEngine,
  type BrowserTransportOptions,
} from "../src/browser/index";
import type { HostIpcPort } from "@uniwork/office-contracts";
import { HostCapabilityRefusal } from "@uniwork/office-contracts";
import { createFakeEngineTransport } from "./fake-transport";
import { runOfficeEngineContractSuite } from "./adapter-contract-suite";

// The browser entry is exercised against a fake IPC port that forwards to the
// fake engine transport - fakes only exist in these unit tests.

function fakeIpc(): { ipc: HostIpcPort; calls: { channel: string; body: unknown }[] } {
  const engine = createFakeEngineTransport();
  const calls: { channel: string; body: unknown }[] = [];
  return {
    calls,
    ipc: {
      async call(channel: string, body: unknown) {
        calls.push({ channel, body });
        if (channel === "engine:submit") return engine.submit(body as Record<string, unknown>);
        if (channel === "engine:cancel") {
          return engine.cancel!((body as { job_id: string }).job_id);
        }
        throw new HostCapabilityRefusal(channel, "unsupported", "channel not bound");
      },
      send() {},
      subscribe() {
        return () => {};
      },
    },
  };
}

const factory = (overrides: Partial<BrowserTransportOptions> = {}) =>
  createBrowserOfficeEngine({ ipc: fakeIpc().ipc, ...overrides });

describe("browser engine transport", () => {
  runOfficeEngineContractSuite("browser", () => factory());

  it("routes envelopes through the host IPC port on the submit channel", async () => {
    const { ipc, calls } = fakeIpc();
    const engine = createBrowserOfficeEngine({ ipc });
    await engine.submit({
      request_id: "r1",
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
    });
    expect(calls[0]?.channel).toBe(ENGINE_SUBMIT_CHANNEL);
    expect((calls[0]?.body as { operation: string }).operation).toBe("open");
  });

  it("surfaces an unbound channel as a typed refusal", async () => {
    const ipc: HostIpcPort = {
      call: async () => {
        throw new HostCapabilityRefusal("engine:submit", "unbound", "no engine bound");
      },
      send() {},
      subscribe() {
        return () => {};
      },
    };
    const engine = createBrowserOfficeEngine({ ipc });
    await expect(
      engine.submit({
        request_id: "r",
        operation: "capability",
        format: "docx",
        payload: {},
      }),
    ).rejects.toMatchObject({ name: "HostCapabilityRefusal", reason: "unbound" });
  });
});
