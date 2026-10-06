import { describe, expect, it } from "vitest";
import { isAllocationFailure } from "../../shared/memory";
import type { EngineHostChild, EngineHostRequest, EngineHostResponse } from "./protocol";
import { engineHostHeapMegabytes, createRemotePdfCall, createRemoteXlsxEngine } from "./remote";
import { serveEngineHost, type EngineHostHandlers } from "./serve";
import { createEngineHostClient } from "./supervisor";

/** A child wired straight to serveEngineHost, so a request really crosses the
 *  protocol both ways. crash() simulates an OOM kill: exit with requests unanswered. */
class FakeChild implements EngineHostChild {
  readonly requests: EngineHostRequest[] = [];
  killed = false;
  private messageListener: (message: unknown) => void = () => undefined;
  private exitListener: (code: number | null) => void = () => undefined;
  private serverListener: (event: { data: unknown }) => void = () => undefined;
  constructor(handlers: EngineHostHandlers) {
    serveEngineHost({ postMessage: (response: EngineHostResponse) => queueMicrotask(() => this.messageListener(response)), on: (_event, listener) => { this.serverListener = listener; } }, handlers);
  }
  postMessage(message: EngineHostRequest): void { this.requests.push(message); this.serverListener({ data: message }); }
  on(event: "message" | "exit", listener: never): void {
    if (event === "message") this.messageListener = listener;
    else this.exitListener = listener;
  }
  kill(): void { this.killed = true; }
  crash(code = 134): void { this.exitListener(code); }
}

const never = (): Promise<unknown> => new Promise(() => undefined);

function setup(handlers: Partial<EngineHostHandlers> = {}) {
  const children: FakeChild[] = [];
  const full: EngineHostHandlers = { "xlsx-open": never, "xlsx-edit": never, "pdf-call": never, ...handlers };
  const client = createEngineHostClient(() => { const child = new FakeChild(full); children.push(child); return child; });
  return { children, client };
}

describe("engine host protocol", () => {
  it("round-trips a binary request and a binary response", async () => {
    const { client, children } = setup({
      "xlsx-edit": async (payload) => {
        const { bytes } = payload as { bytes: Uint8Array };
        return { bytes: Uint8Array.from(bytes, (byte) => byte + 1), checksum: "sha256:x" };
      },
    });
    const result = await createRemoteXlsxEngine(client).edit(new Uint8Array([1, 2, 3]), []);
    expect([...result.bytes]).toEqual([1, 2, 3].map((byte) => byte + 1));
    expect(children).toHaveLength(1);
  });

  it("keeps a handler's error name, message and code", async () => {
    const { client } = setup({ "pdf-call": async () => { throw Object.assign(new Error("password wall"), { name: "PdfError", code: "pdf_x" }); } });
    await expect(createRemotePdfCall(client)({ operation: "open", handle: "h", args: {} })).rejects.toMatchObject({ name: "PdfError", message: "password wall", code: "pdf_x" });
  });

  it("types a catchable allocation failure in the child as insufficient_memory", async () => {
    const { client } = setup({ "xlsx-open": async () => { throw new RangeError("Array buffer allocation failed"); } });
    const failure = await createRemoteXlsxEngine(client).open(new Uint8Array(1)).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "insufficient_memory" });
    expect(isAllocationFailure(failure)).toBe(true);
  });

  it("answers an unknown request kind with a typed refusal", async () => {
    const { client } = setup();
    const call = client.call("nope" as never, {});
    await expect(call).rejects.toMatchObject({ code: "engine_operation_unsupported" });
  });
});

describe("engine host supervisor", () => {
  it("answers every pending request insufficient_memory when the child dies mid-request, and main survives", async () => {
    const { client, children } = setup();
    const open = createRemoteXlsxEngine(client).open(new Uint8Array(1));
    const pdf = createRemotePdfCall(client)({ operation: "open", handle: "h", args: {} });
    const settled = Promise.allSettled([open, pdf]);
    children[0]!.crash(134);
    const results = await settled;
    for (const result of results) {
      expect(result.status).toBe("rejected");
      const reason = (result as PromiseRejectedResult).reason;
      expect(reason).toMatchObject({ code: "insufficient_memory" });
      expect(isAllocationFailure(reason)).toBe(true);
    }
  });

  it("treats a clean exit with a request in flight as a failure too", async () => {
    const { client, children } = setup();
    const open = createRemoteXlsxEngine(client).open(new Uint8Array(1));
    children[0]!.crash(0);
    await expect(open).rejects.toMatchObject({ code: "insufficient_memory" });
  });

  it("restarts the child lazily on the next request", async () => {
    const { client, children } = setup({ "pdf-call": async () => ({ ok: true }) });
    const first = client.call("xlsx-open", { bytes: new Uint8Array(1) }).catch((error: unknown) => error);
    children[0]!.crash();
    await first;
    expect(children).toHaveLength(1);
    await expect(client.call("pdf-call", {})).resolves.toEqual({ ok: true });
    expect(children).toHaveLength(2);
    // A late exit from the dead child must not fail the new child's requests.
    children[0]!.crash();
    await expect(client.call("pdf-call", {})).resolves.toEqual({ ok: true });
    expect(children).toHaveLength(2);
  });

  it("does not spawn until the first request", () => {
    const { children } = setup();
    expect(children).toHaveLength(0);
  });

  it("answers insufficient_memory when the child cannot be reached", async () => {
    const client = createEngineHostClient(() => { throw new Error("spawn failed"); });
    await expect(client.call("pdf-call", {})).rejects.toMatchObject({ code: "insufficient_memory" });
  });

  it("dispose kills the child and fails what is pending", async () => {
    const { client, children } = setup();
    const pending = client.call("xlsx-open", {});
    client.dispose();
    await expect(pending).rejects.toMatchObject({ code: "insufficient_memory" });
    expect(children[0]!.killed).toBe(true);
  });
});

describe("engineHostHeapMegabytes", () => {
  it("gives the child three quarters of physical memory, never under 2 GiB", () => {
    expect(engineHostHeapMegabytes(16 * 1024 ** 3)).toBe(12288);
    expect(engineHostHeapMegabytes(1024 ** 3)).toBe(2048);
  });
});
