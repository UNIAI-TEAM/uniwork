// Cloud-only test-only diagnostics. Never imported on the host.
import { inspect, types } from "node:util";
import { runInThisContext } from "node:vm";

const NativeArrayBuffer = Buffer.alloc(0).buffer.constructor;
const NativeUint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;
const NativeError = runInThisContext("Error");
export function diagnosticLog(label: string, value: unknown): void {
  console.error("XLSX_DIAGNOSTIC_PROBE " + label + " case=" + ((globalThis as any).__xlsxFailureCase ?? "suite-startup"));
  console.error(inspect(value, { depth: null, maxArrayLength: null, maxStringLength: null, breakLength: 120, customInspect: false }));
}
export function diagnosticError(label: string, error: any): void {
  const seen = new Set();
  function fields(e: any): any {
    if (e === null || typeof e !== "object") return e;
    if (seen.has(e)) return "[circular cause]";
    seen.add(e);
    const out: any = { constructor: e.constructor?.name, tag: Object.prototype.toString.call(e),
      instanceOfGlobalError: e instanceof Error, instanceOfNativeError: e instanceof NativeError,
      instanceOfDOMException: typeof DOMException !== "undefined" && e instanceof DOMException };
    for (const key of ["name", "message", "stack", "code", "reason", "kind", "retryable", "errorClass", "status", "action", "ambiguous", "state"])
      if (typeof e[key] === "string" || typeof e[key] === "number" || typeof e[key] === "boolean") out[key] = e[key];
    out.causePresent = "cause" in e;
    out.cause = "cause" in e ? fields(e.cause) : undefined;
    if (Array.isArray(e.errors)) out.errors = e.errors.map(fields);
    return out;
  }
  diagnosticLog(label, fields(error));
}
function bufferIdentity(value: any): any {
  return { constructor: value?.constructor?.name, tag: Object.prototype.toString.call(value),
    instanceOfGlobalArrayBuffer: value instanceof ArrayBuffer,
    instanceOfNativeArrayBuffer: value instanceof NativeArrayBuffer,
    instanceOfGlobalUint8Array: value instanceof Uint8Array,
    instanceOfNativeUint8Array: value instanceof NativeUint8Array,
    globalIsView: ArrayBuffer.isView(value), nativeIsArrayBuffer: types.isArrayBuffer(value),
    nativeIsTypedArray: types.isTypedArray(value),
    bufferConstructor: value?.buffer?.constructor?.name,
    bufferInstanceOfGlobalArrayBuffer: value?.buffer instanceof ArrayBuffer,
    bufferInstanceOfNativeArrayBuffer: value?.buffer instanceof NativeArrayBuffer };
}
export function installDiagnosticCrypto(): () => void {
  const subtle = globalThis.crypto.subtle as any;
  const undo: (() => void)[] = [];
  diagnosticLog("realm", { globalArrayBufferIsNative: ArrayBuffer === NativeArrayBuffer,
    globalUint8ArrayIsNative: Uint8Array === NativeUint8Array, globalErrorIsNative: Error === NativeError });
  for (const method of ["digest", "encrypt", "decrypt", "generateKey", "wrapKey", "unwrapKey", "importKey", "exportKey"]) {
    const descriptor = Object.getOwnPropertyDescriptor(subtle, method);
    const original = subtle[method];
    Object.defineProperty(subtle, method, { configurable: true, writable: true, value: function (...args: any[]) {
      const context: any = { method };
      if (method === "digest") context.data = bufferIdentity(args[1]);
      if (method === "encrypt" || method === "decrypt") {
        context.algorithm = { name: args[0]?.name, iv: bufferIdentity(args[0]?.iv), additionalData: bufferIdentity(args[0]?.additionalData) };
        context.data = bufferIdentity(args[2]);
      }
      function fail(error: any): never { diagnosticLog("crypto.arguments", context); diagnosticError("crypto.original", error); throw error; }
      try { return Reflect.apply(original, this, args).catch(fail); } catch (error) { return fail(error); }
    } });
    undo.push(() => { if (descriptor) Object.defineProperty(subtle, method, descriptor); else delete subtle[method]; });
  }
  return () => { for (const restore of undo.reverse()) restore(); };
}
