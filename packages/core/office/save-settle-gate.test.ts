import { afterEach, describe, expect, it, vi } from "vitest";
import { createSaveSettleGate } from "./save-settle-gate";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** A base-relative editor: a Save rebases it, so a snapshot is only valid
 *  under the base that held while it was read. */
function journal() {
  let base = 1;
  let edits = 0;
  return {
    edit: () => { edits += 1; },
    rebase: () => { base += 1; edits = 0; },
    get base() { return base; },
    read: () => ({ base, edits }),
  };
}

describe("save settle gate", () => {
  it("captures at once when no Save is in flight", async () => {
    const gate = createSaveSettleGate();
    const doc = journal();
    doc.edit();
    const written = await gate.capture(async () => doc.read(), (snapshot) => ({ snapshot, base: doc.base }));
    expect(written).toEqual({ snapshot: { base: 1, edits: 1 }, base: 1 });
  });

  it("waits for an in-flight Save and captures after its rebase", async () => {
    const gate = createSaveSettleGate();
    const doc = journal();
    doc.edit(); doc.edit();
    const commit = deferred();
    const saving = gate.run(async () => { await commit.promise; doc.rebase(); });
    doc.edit();
    const checkpoint = gate.capture(async () => doc.read(), (snapshot) => ({ snapshot, base: doc.base }));
    commit.resolve();
    await saving;
    await expect(checkpoint).resolves.toEqual({ snapshot: { base: 2, edits: 0 }, base: 2 });
  });

  it("re-captures when a Save starts and settles inside a slow capture (no event-loop timing)", async () => {
    const gate = createSaveSettleGate();
    const doc = journal();
    doc.edit(); doc.edit();
    const digest = deferred();
    let captures = 0;
    const checkpoint = gate.capture(async () => {
      captures += 1;
      const read = doc.read();
      // The first capture's digest outlives the whole Save below.
      if (captures === 1) await digest.promise;
      return read;
    }, (snapshot) => ({ snapshot, base: doc.base }));
    await gate.run(async () => { doc.rebase(); });
    doc.edit();
    digest.resolve();
    await expect(checkpoint).resolves.toEqual({ snapshot: { base: 2, edits: 1 }, base: 2 });
    expect(captures).toBe(2);
  });

  it("re-captures when a Save is still in flight as the capture resolves", async () => {
    const gate = createSaveSettleGate();
    const doc = journal();
    doc.edit();
    const digest = deferred();
    const commit = deferred();
    let captures = 0;
    const checkpoint = gate.capture(async () => {
      captures += 1;
      const read = doc.read();
      if (captures === 1) await digest.promise;
      return read;
    }, (snapshot) => ({ snapshot, base: doc.base }));
    const saving = gate.run(async () => { await commit.promise; doc.rebase(); });
    digest.resolve();
    await Promise.resolve();
    commit.resolve();
    await saving;
    await expect(checkpoint).resolves.toEqual({ snapshot: { base: 2, edits: 0 }, base: 2 });
    expect(captures).toBe(2);
  });

  it("runs the write synchronously after the last consistency check", async () => {
    const gate = createSaveSettleGate();
    let started = false;
    const order: string[] = [];
    const checkpoint = gate.capture(async () => "snapshot", (snapshot) => {
      order.push(`write:${snapshot}`);
      started = true;
    });
    void Promise.resolve().then(() => order.push("microtask"));
    await checkpoint;
    expect(started).toBe(true);
    expect(order[0]).toBe("write:snapshot");
  });

  it("settles Saves that overlap and keeps a checkpoint waiting for the last one", async () => {
    const gate = createSaveSettleGate();
    const first = deferred();
    const second = deferred();
    const a = gate.run(() => first.promise);
    const b = gate.run(() => second.promise);
    let written = false;
    const checkpoint = gate.capture(async () => 1, () => { written = true; });
    first.resolve();
    await a;
    await Promise.resolve();
    expect(written).toBe(false);
    second.resolve();
    await b;
    await checkpoint;
    expect(written).toBe(true);
  });

  it("releases waiting checkpoints when a Save throws", async () => {
    const gate = createSaveSettleGate();
    const commit = deferred();
    const saving = gate.run(async () => { await commit.promise; throw new Error("commit_failed"); });
    const checkpoint = gate.capture(async () => "after", (snapshot) => snapshot);
    commit.resolve();
    await expect(saving).rejects.toThrow("commit_failed");
    await expect(checkpoint).resolves.toBe("after");
  });

  it("propagates a capture error to the caller", async () => {
    const gate = createSaveSettleGate();
    await expect(gate.capture(async () => { throw new Error("disposed"); }, () => undefined)).rejects.toThrow("disposed");
  });
});

describe("save settle gate: bounded wait (a Save that never settles)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("writes under the base bound at enqueue once the wait runs out", async () => {
    vi.useFakeTimers();
    const gate = createSaveSettleGate({ maxWaitMs: 10_000 });
    const doc = journal();
    doc.edit();
    // The Save's request never answers: no settle, no rebase.
    void gate.run(() => new Promise<void>(() => undefined));
    doc.edit();
    let written: { snapshot: { base: number; edits: number }; base: number } | undefined;
    const checkpoint = gate.capture(async () => doc.read(), (snapshot) => { written = { snapshot, base: doc.base }; return written; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(written).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await expect(checkpoint).resolves.toEqual({ snapshot: { base: 1, edits: 2 }, base: 1 });
  });

  it("re-captures a timed-out capture that straddles the Save's rebase, even while the Save still hangs", async () => {
    vi.useFakeTimers();
    const gate = createSaveSettleGate({ maxWaitMs: 10 });
    const doc = journal();
    doc.edit(); doc.edit();
    const network = deferred();
    // The write is confirmed and the editor rebases; what follows (a context
    // refresh, a retry) never answers.
    void gate.run(async () => {
      await network.promise;
      gate.markRebase();
      doc.rebase();
      await new Promise<void>(() => undefined);
    });
    doc.edit();
    const digest = deferred();
    let captures = 0;
    let written: { snapshot: { base: number; edits: number }; base: number } | undefined;
    const checkpoint = gate.capture(async () => {
      captures += 1;
      const read = doc.read();
      if (captures === 1) await digest.promise;
      return read;
    }, (snapshot) => { written = { snapshot, base: doc.base }; return written; });
    await vi.advanceTimersByTimeAsync(10);
    expect(captures).toBe(1);
    // The rebase lands while the first (pre-rebase) capture is still digesting.
    network.resolve();
    await vi.advanceTimersByTimeAsync(0);
    doc.edit();
    digest.resolve();
    await vi.advanceTimersByTimeAsync(0);
    // The pre-rebase journal is never written under the moved base; the retake is.
    await expect(checkpoint).resolves.toEqual({ snapshot: { base: 2, edits: 1 }, base: 2 });
    expect(captures).toBe(2);
    expect(written).toEqual({ snapshot: { base: 2, edits: 1 }, base: 2 });
  });

  it("bounds the wait after a mark: a Save that hangs past its rebase holds a capture only for the bound", async () => {
    vi.useFakeTimers();
    const gate = createSaveSettleGate({ maxWaitMs: 10 });
    void gate.run(async () => { gate.markRebase(); await new Promise<void>(() => undefined); });
    let written = false;
    const checkpoint = gate.capture(async () => 1, () => { written = true; });
    await vi.advanceTimersByTimeAsync(9);
    expect(written).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await checkpoint;
    expect(written).toBe(true);
  });

  it("re-captures across either edge of an async rebase step", async () => {
    vi.useFakeTimers();
    const gate = createSaveSettleGate({ maxWaitMs: 10 });
    const doc = journal();
    doc.edit();
    const step = deferred();
    void gate.run(async () => {
      await gate.rebase(async () => { await step.promise; doc.rebase(); });
      await new Promise<void>(() => undefined);
    });
    const digest = deferred();
    let captures = 0;
    const checkpoint = gate.capture(async () => {
      captures += 1;
      if (captures === 1) await digest.promise;
      return doc.read();
    }, (snapshot) => ({ snapshot, base: doc.base }));
    // The bound runs out mid-step; this capture straddles the step's end.
    await vi.advanceTimersByTimeAsync(10);
    expect(captures).toBe(1);
    step.resolve();
    await vi.advanceTimersByTimeAsync(0);
    digest.resolve();
    await expect(checkpoint).resolves.toEqual({ snapshot: { base: 2, edits: 0 }, base: 2 });
    expect(captures).toBe(2);
  });

  it("leaves no parked waiter behind once each capture's bound runs out", async () => {
    vi.useFakeTimers();
    const gate = createSaveSettleGate({ maxWaitMs: 10 });
    void gate.run(() => new Promise<void>(() => undefined));
    const checkpoints = [1, 2, 3].map((value) => gate.capture(async () => value, (snapshot) => snapshot));
    expect(gate.parkedCaptures()).toBe(3);
    await vi.advanceTimersByTimeAsync(10);
    await expect(Promise.all(checkpoints)).resolves.toEqual([1, 2, 3]);
    expect(gate.parkedCaptures()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a parked capture's timer as soon as the Save settles", async () => {
    vi.useFakeTimers();
    const gate = createSaveSettleGate({ maxWaitMs: 10_000 });
    const commit = deferred();
    const saving = gate.run(() => commit.promise);
    const digest = deferred();
    const checkpoint = gate.capture(async () => { await digest.promise; return "after"; }, (snapshot) => snapshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    commit.resolve();
    await saving;
    await vi.advanceTimersByTimeAsync(0);
    // The capture is still digesting, but its bound no longer runs.
    expect(vi.getTimerCount()).toBe(0);
    digest.resolve();
    await expect(checkpoint).resolves.toBe("after");
  });

  it("releases parked captures and their timers at dispose", async () => {
    vi.useFakeTimers();
    const gate = createSaveSettleGate({ maxWaitMs: 10_000 });
    void gate.run(() => new Promise<void>(() => undefined));
    let disposed = false;
    const checkpoint = gate.capture(async () => 1, () => { if (disposed) throw new Error("editor_disposed"); return 1; });
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.parkedCaptures()).toBe(1);
    disposed = true;
    gate.dispose();
    await expect(checkpoint).rejects.toThrow("editor_disposed");
    expect(gate.parkedCaptures()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
