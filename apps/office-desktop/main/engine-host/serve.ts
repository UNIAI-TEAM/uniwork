import { isAllocationFailure } from "../../shared/memory";
import { ENGINE_HOST_INSUFFICIENT_MEMORY, type EngineHostRequest, type EngineHostRequestKind, type EngineHostResponse } from "./protocol";

export interface EngineHostPort {
  postMessage(message: EngineHostResponse): void;
  on(event: "message", listener: (event: { readonly data: unknown }) => void): void;
}

export type EngineHostHandlers = Readonly<Record<EngineHostRequestKind, (payload: unknown) => Promise<unknown>>>;

function isRequest(value: unknown): value is EngineHostRequest {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "number" && typeof (value as { kind?: unknown }).kind === "string";
}

/** The child side: run each request on its handler and answer ok/err by id.
 *  Catchable allocation failures keep the typed insufficient_memory code; a
 *  fatal heap exhaustion ends the process and the supervisor answers instead. */
export function serveEngineHost(port: EngineHostPort, handlers: EngineHostHandlers): void {
  port.on("message", ({ data }) => {
    if (!isRequest(data)) return;
    const handler = Object.hasOwn(handlers, data.kind) ? handlers[data.kind] : undefined;
    void (async () => {
      try {
        if (!handler) throw Object.assign(new Error("engine_operation_unsupported"), { code: "engine_operation_unsupported" });
        port.postMessage({ id: data.id, ok: true, result: await handler(data.payload) });
      } catch (error) {
        const fields = (error ?? {}) as { name?: unknown; message?: unknown; code?: unknown };
        const code = isAllocationFailure(error) ? ENGINE_HOST_INSUFFICIENT_MEMORY : typeof fields.code === "string" ? fields.code : undefined;
        port.postMessage({ id: data.id, ok: false, error: { name: typeof fields.name === "string" ? fields.name : "Error", message: typeof fields.message === "string" ? fields.message : "engine host failed", ...(code === undefined ? {} : { code }) } });
      }
    })();
  });
}
