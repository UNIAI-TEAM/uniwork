// Wire protocol between the Electron main process and the engine host child
// (a utilityProcess). The unbounded local engines (xlsx gateway, pdfium) run in
// the child so a V8 heap exhaustion kills only that process, never the window
// host. One request in, one response out, correlated by id. Payloads are
// structured-cloned, so binary stays a Uint8Array end to end (never base64).

export type EngineHostRequestKind = "xlsx-open" | "xlsx-edit" | "pdf-call";

export interface EngineHostRequest {
  readonly id: number;
  readonly kind: EngineHostRequestKind;
  readonly payload: unknown;
}

export type EngineHostResponse =
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: { readonly name: string; readonly message: string; readonly code?: string } };

/** The typed code main answers for every request in flight when the child dies
 *  (OOM kill, crash, non-zero exit). `shared/memory.ts` treats it as an
 *  allocation failure, so it reaches the renderer as file_insufficient_memory. */
export const ENGINE_HOST_INSUFFICIENT_MEMORY = "insufficient_memory";

/** The slice of a child process the supervisor needs; Electron's
 *  UtilityProcess satisfies it, tests inject a fake. */
export interface EngineHostChild {
  postMessage(message: EngineHostRequest): void;
  on(event: "message", listener: (message: unknown) => void): void;
  on(event: "exit", listener: (code: number | null) => void): void;
  kill(): void;
}

export type EngineHostSpawner = () => EngineHostChild;
