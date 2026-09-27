import { describe, expect, it } from "vitest";
import { createNodeOfficeEngine, nodeSha256Hex, type NodeTransportOptions } from "../src/node/index";
import { createHash } from "node:crypto";
import { createFakeEngineTransport } from "./fake-transport";
import { runOfficeEngineContractSuite } from "./adapter-contract-suite";

// The node entry: synchronous hashing plus the HTTP transport, exercised
// against an injected fetch bound to the fake engine transport.

function fakeFetch(): typeof fetch {
  const engine = createFakeEngineTransport();
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const result = String(url).endsWith("/cancel")
      ? await engine.cancel!(body.job_id, body.reason)
      : await engine.submit(body);
    return new Response(JSON.stringify(result), { status: 200 });
  }) as typeof fetch;
}

const factory = (overrides: Partial<NodeTransportOptions> = {}) =>
  createNodeOfficeEngine({ baseUrl: "http://engine.local", fetchImpl: fakeFetch(), ...overrides });

describe("node engine transport", () => {
  runOfficeEngineContractSuite("node", () => factory());

  it("nodeSha256Hex matches node:crypto", () => {
    const bytes = new TextEncoder().encode("hello");
    expect(nodeSha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("an unreachable host maps to engine_crashed, never silent success", async () => {
    const dead = createNodeOfficeEngine({
      baseUrl: "http://engine.local",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    await expect(
      dead.submit({
        request_id: "r",
        operation: "capability",
        format: "docx",
        payload: {},
      }),
    ).rejects.toMatchObject({ name: "EngineBoundaryError", code: "engine_crashed", retryable: true });
  });

  it("a non-JSON answer maps to engine_result_invalid", async () => {
    const weird = createNodeOfficeEngine({
      baseUrl: "http://engine.local",
      fetchImpl: (async () => new Response("<html>", { status: 200 })) as typeof fetch,
    });
    await expect(
      weird.submit({
        request_id: "r",
        operation: "capability",
        format: "docx",
        payload: {},
      }),
    ).rejects.toMatchObject({ name: "EngineBoundaryError", code: "engine_result_invalid" });
  });
});
