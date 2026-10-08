import type { DesktopEngineCall, DesktopEngineCallResult } from "@uniwork/office-engine/desktop";
import type { LocalXlsxEngine } from "../xlsx-engine";
import { ENGINE_HOST_INSUFFICIENT_MEMORY } from "./protocol";

/** Test seam for the out-of-memory message: with this set to `1` in an
 *  unpackaged launch, the first local engine job (a PDF engine call or a local
 *  XLSX open/edit) fails once the way a catchable allocation failure in the
 *  engine child does, without exhausting any memory. A packaged build never
 *  reads it, whatever the environment says. */
const FORCE_MEMORY_FAILURE_ENV = "UNIWORK_OFFICE_FORCE_OOM";

export interface ForcedMemoryFailureOptions {
  readonly packaged: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}

interface LocalEngines {
  readonly xlsx: LocalXlsxEngine;
  readonly pdfCall: (call: DesktopEngineCall) => Promise<DesktopEngineCallResult>;
}

/** The child relays a caught allocation failure as its own name and message
 *  plus the typed code, so invoke shows "RangeError: Array buffer allocation failed". */
function allocationFailure(): Error {
  return Object.assign(new RangeError("Array buffer allocation failed"), { code: ENGINE_HOST_INSUFFICIENT_MEMORY });
}

/** The engines unchanged, or (unpackaged, seam set) wrapped so the first job fails once. */
export function withForcedMemoryFailure<T extends LocalEngines>(engines: T, options: ForcedMemoryFailureOptions | undefined): T {
  if (!options || options.packaged || options.env[FORCE_MEMORY_FAILURE_ENV] !== "1") return engines;
  let armed = true;
  const once = <A extends unknown[], R>(job: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    if (!armed) return job(...args);
    armed = false;
    throw allocationFailure();
  };
  return { ...engines, pdfCall: once((call: DesktopEngineCall) => engines.pdfCall(call)), xlsx: { open: once((bytes: Uint8Array) => engines.xlsx.open(bytes)), edit: once((bytes: Uint8Array, edits: readonly unknown[]) => engines.xlsx.edit(bytes, edits)) } };
}
