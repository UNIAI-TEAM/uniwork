/** @vitest-environment jsdom */
import { Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";
import { expect, it } from "vitest";

function sanitizedFailure(error: unknown) {
  const failure = error as { name?: unknown; code?: unknown };
  const name = typeof failure?.name === "string" && /^(Error|TypeError|DOMException|OperationError|DataError|InvalidAccessError|NotSupportedError|SyntaxError)$/.test(failure.name) ? failure.name : "unknown";
  const code = typeof failure?.code === "number" ? failure.code : typeof failure?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(failure.code) ? failure.code : "unknown";
  return { name, code };
}

// This is a host-realm diagnostic, not a browser acceptance or crypto adapter.
// Use synthetic bytes, real WebCrypto and exactly one changed argument per case.
// Print only outcomes and prototype identity, never arguments, keys or messages.
it.each(["iv", "additionalData", "plaintext"] as const)("compares native and jsdom BufferSource for %s", async (argument) => {
  const nativeIv = Buffer.alloc(12);
  const nativeAad = Buffer.from([2]);
  const nativePlaintext = Buffer.from([1]);
  const key = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const nativeAlgorithm = { name: "AES-GCM", iv: nativeIv, additionalData: nativeAad };
  try {
    const ciphertext = await webcrypto.subtle.encrypt(nativeAlgorithm, key, nativePlaintext);
    const restored = await webcrypto.subtle.decrypt(nativeAlgorithm, key, ciphertext);
    expect([...new Uint8Array(restored)]).toEqual([1]);
  } catch (error) {
    console.info("draft-crypto-realm-control", { argument, operation: "native_roundtrip", outcome: "refused", ...sanitizedFailure(error) });
    throw new Error("Native WebCrypto round-trip control failed");
  }
  const nativeInput = argument === "iv" ? nativeIv : argument === "additionalData" ? nativeAad : nativePlaintext;
  // Match the provider's bufferSource slice without converting to another realm.
  const jsdomBytes = new Uint8Array(nativeInput);
  const jsdomBuffer = jsdomBytes.buffer.slice(jsdomBytes.byteOffset, jsdomBytes.byteOffset + jsdomBytes.byteLength);
  const algorithm = {
    name: "AES-GCM",
    iv: argument === "iv" ? jsdomBuffer : nativeIv,
    additionalData: argument === "additionalData" ? jsdomBuffer : nativeAad,
  };
  let outcome: "accepted" | "refused" = "accepted";
  let failure: ReturnType<typeof sanitizedFailure> | undefined;
  try {
    await webcrypto.subtle.encrypt(algorithm, key, argument === "plaintext" ? jsdomBuffer : nativePlaintext);
  } catch (error) {
    outcome = "refused";
    failure = sanitizedFailure(error);
  }
  console.info("draft-crypto-realm-control", {
    argument, operation: "encrypt", native: "roundtrip_pass", jsdom: outcome,
    sameArrayBufferPrototype: Object.getPrototypeOf(jsdomBuffer) === Object.getPrototypeOf(nativeInput.buffer),
    globalSubtleIsNode: globalThis.crypto.subtle === webcrypto.subtle,
    ...failure,
  });
});
