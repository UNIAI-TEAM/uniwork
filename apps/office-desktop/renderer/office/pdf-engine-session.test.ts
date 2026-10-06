import { describe, expect, it, vi } from "vitest";
import { createPdfEngineSession } from "./pdf-engine-session";

const STALE = { ok: false, error: { kind: "handle" } };
const OK = { ok: true };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe("pdf engine session", () => {
  it("runs against the adopted handle without re-opening", async () => {
    const reopen = vi.fn(async () => "pdf_x");
    const session = createPdfEngineSession({ reopen, close: vi.fn(async () => undefined) });
    session.adopt("pdf_1");
    const call = vi.fn(async () => OK);
    await expect(session.run(call)).resolves.toBe(OK);
    expect(call).toHaveBeenCalledWith("pdf_1");
    expect(reopen).not.toHaveBeenCalled();
  });

  it("reports the current handle, none after a failed open or a close", () => {
    const session = createPdfEngineSession({ reopen: async () => "pdf_x", close: vi.fn(async () => undefined) });
    expect(session.current()).toBeNull();
    session.adopt("pdf_1");
    expect(session.current()).toBe("pdf_1");
    session.adopt(undefined);
    expect(session.current()).toBeNull();
    session.adopt("pdf_2");
    session.close();
    expect(session.current()).toBeNull();
  });

  it("does not install a re-open that an adopt overtook, and closes its handle", async () => {
    const pending = deferred<string>();
    const close = vi.fn(async () => undefined);
    const session = createPdfEngineSession({ reopen: () => pending.promise, close });
    const calls: string[] = [];
    const run = session.run(async (pdfHandle) => { calls.push(pdfHandle); return OK; });
    // An edit swapped the bytes while the re-open of the old ones was in flight.
    session.adopt("pdf_new");
    pending.resolve("pdf_old");
    await run;
    expect(calls).toEqual(["pdf_new"]);
    expect(close).toHaveBeenCalledWith("pdf_old");
  });

  it("returns the second stale answer instead of re-opening again", async () => {
    const reopen = vi.fn(async () => `pdf_${reopen.mock.calls.length + 1}`);
    const session = createPdfEngineSession({ reopen, close: vi.fn(async () => undefined) });
    session.adopt("pdf_1");
    await expect(session.run(async () => STALE)).resolves.toBe(STALE);
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it("refuses runs after close and frees a re-open that lands afterwards", async () => {
    const pending = deferred<string>();
    const close = vi.fn(async () => undefined);
    const session = createPdfEngineSession({ reopen: () => pending.promise, close });
    const run = session.run(async () => OK);
    session.close();
    pending.resolve("pdf_late");
    await expect(run).rejects.toThrow("pdf_surface_disposed");
    expect(close).toHaveBeenCalledWith("pdf_late");
    await expect(session.run(async () => OK)).rejects.toThrow("pdf_surface_disposed");
  });

  it("lets a failed re-open be retried by the next run", async () => {
    const reopen = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("pdf_2");
    const session = createPdfEngineSession({ reopen, close: vi.fn(async () => undefined) });
    await expect(session.run(async () => OK)).rejects.toThrow("down");
    await expect(session.run(async () => OK)).resolves.toBe(OK);
    expect(reopen).toHaveBeenCalledTimes(2);
  });
});
