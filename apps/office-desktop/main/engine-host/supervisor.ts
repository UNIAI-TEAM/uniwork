import { ENGINE_HOST_INSUFFICIENT_MEMORY, type EngineHostChild, type EngineHostRequestKind, type EngineHostResponse, type EngineHostSpawner } from "./protocol";

export interface EngineHostClient {
  call(kind: EngineHostRequestKind, payload: unknown): Promise<unknown>;
  /** Stop the child, if any; pending requests answer insufficient_memory. */
  dispose(): void;
}

function memoryError(): Error {
  return Object.assign(new Error(ENGINE_HOST_INSUFFICIENT_MEMORY), { name: "EngineHostExitError", code: ENGINE_HOST_INSUFFICIENT_MEMORY });
}

function isResponse(value: unknown): value is EngineHostResponse {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "number" && typeof (value as { ok?: unknown }).ok === "boolean";
}

/** Supervise one lazily spawned engine host child. If it exits while requests
 *  are in flight (heap OOM, crash), every one of them is answered with the
 *  typed insufficient_memory error, the dead child is forgotten, and the next
 *  request spawns a fresh one. Main itself never goes down with the child. */
export function createEngineHostClient(spawn: EngineHostSpawner): EngineHostClient {
  type Pending = { resolve(value: unknown): void; reject(error: Error): void };
  let child: EngineHostChild | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const failAll = (): void => {
    const waiting = [...pending.values()];
    pending.clear();
    for (const entry of waiting) entry.reject(memoryError());
  };

  const ensureChild = (): EngineHostChild => {
    if (child) return child;
    const fresh = spawn();
    child = fresh;
    fresh.on("message", (message) => {
      if (child !== fresh || !isResponse(message)) return;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(Object.assign(new Error(message.error.message), { name: message.error.name, ...(message.error.code === undefined ? {} : { code: message.error.code }) }));
    });
    fresh.on("exit", () => {
      // A stale child's exit must not fail the replacement's requests.
      if (child !== fresh) return;
      child = null;
      failAll();
    });
    return fresh;
  };

  return {
    call(kind, payload) {
      return new Promise<unknown>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        try {
          ensureChild().postMessage({ id, kind, payload });
        } catch (error) {
          pending.delete(id);
          // A child that cannot even be reached counts as a dead one.
          child = null;
          reject(error instanceof Error && (error as { code?: unknown }).code === ENGINE_HOST_INSUFFICIENT_MEMORY ? error : memoryError());
        }
      });
    },
    dispose() {
      const dying = child;
      child = null;
      failAll();
      dying?.kill();
    },
  };
}
