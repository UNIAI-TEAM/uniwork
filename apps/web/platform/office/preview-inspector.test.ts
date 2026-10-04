import { describe, expect, it, vi } from "vitest";
import {
  INSPECTOR_COMMAND_TYPES,
  INSPECTOR_FRAME_MESSAGE_TYPES,
  INSPECTOR_SCRIPT_BODY,
  assertInspectorNonce,
  createInspectorNonce,
  injectInspector,
  inspectorCommandSchema,
  inspectorInboundSchema,
  isInspectorNonce,
  sealInspectorCommand,
} from "./preview-inspector";

const NONCE = "0".repeat(31) + "1";

describe("inspector nonce", () => {
  it("accepts only 32 lowercase hex characters", () => {
    expect(isInspectorNonce(NONCE)).toBe(true);
    for (const bad of ["", "abc", "0".repeat(31), "0".repeat(33), "A".repeat(32), "0".repeat(31) + "g", "0".repeat(31) + " ", "0".repeat(31) + "\n"]) {
      expect(isInspectorNonce(bad)).toBe(false);
      expect(() => assertInspectorNonce(bad)).toThrow();
    }
  });

  it("generates a valid nonce, or throws when the platform has no randomness", () => {
    expect(isInspectorNonce(createInspectorNonce())).toBe(true);
    const original = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
      expect(() => createInspectorNonce()).toThrow("inspector nonce source is unavailable");
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });
});

describe("inspector source is UniWork-owned and self-contained", () => {
  it("carries no cookie, storage, network, eval or window escape", () => {
    // The whole security claim of the injected script is that it reads only
    // the DOM it renders. Pin each forbidden capability by name.
    for (const forbidden of [
      "document.cookie", "localStorage", "sessionStorage", "indexedDB",
      "fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon",
      "importScripts", "new Function", "eval(", "postMessage({", "window.parent", "top.location", "window.top",
    ]) {
      expect(INSPECTOR_SCRIPT_BODY).not.toContain(forbidden);
    }
    // The only network-shaped call is the port it was handed, and the only
    // global it touches is `parent` for the init source check.
    expect(INSPECTOR_SCRIPT_BODY).toContain("e.source!==parent");
    expect(INSPECTOR_SCRIPT_BODY).toContain("P.postMessage");
  });

  it("builds its allowlists from the shared protocol constants", () => {
    for (const type of INSPECTOR_FRAME_MESSAGE_TYPES) expect(INSPECTOR_SCRIPT_BODY).toContain('"' + type + '"');
    for (const type of INSPECTOR_COMMAND_TYPES) expect(INSPECTOR_SCRIPT_BODY).toContain('"' + type + '"');
  });

  it("puts the nonce in the attribute, never in the body", () => {
    expect(INSPECTOR_SCRIPT_BODY).not.toContain(NONCE);
    const out = injectInspector("<p>x</p>", NONCE);
    expect(out).toContain('<script nonce="' + NONCE + '">' + INSPECTOR_SCRIPT_BODY + "</script>");
  });
});

describe("injectInspector runs after the gate", () => {
  it("appends the inspector to <head>, after the CSP meta", () => {
    const gated = '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'nonce-x\'"></head><body><p>x</p></body></html>';
    const out = injectInspector(gated, NONCE);
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(out).toContain('<script nonce="' + NONCE + '">');
    const meta = out.indexOf("Content-Security-Policy");
    const script = out.indexOf("<script");
    expect(meta).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(meta);
    // The document body is untouched.
    expect(out).toContain("<p>x</p>");
  });

  it("fails closed when the injection does not survive serialisation", () => {
    const real = DOMParser.prototype.parseFromString;
    let calls = 0;
    vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(function (this: DOMParser, text: string, type: DOMParserSupportedType) {
      calls++;
      // The verification re-parse (third call) loses the script.
      return real.call(this, calls === 2 ? "<html><head></head><body></body></html>" : text, type);
    });
    expect(() => injectInspector("<p>x</p>", NONCE)).toThrow(/did not survive serialisation/);
  });

  it("rejects a malformed nonce before it can reach a policy or a tag", () => {
    expect(() => injectInspector("<p>x</p>", "bad")).toThrow();
  });
});

describe("inspector wire schemas (parent side)", () => {
  it("accepts each declared frame message and rejects an extra key", () => {
    const valid = [
      { type: "ready", nonce: NONCE },
      { type: "resize", nonce: NONCE, height: 12 },
      { type: "select", nonce: NONCE, sid: 3 },
      { type: "select", nonce: NONCE, sid: null },
      { type: "hover", nonce: NONCE, sid: 3 },
      { type: "rect", nonce: NONCE, sid: 3, rect: { x: 0, y: 1, width: 2, height: 3 } },
      { type: "text-edit-commit", nonce: NONCE, sid: 3, text: "hi" },
    ];
    for (const message of valid) expect(inspectorInboundSchema.safeParse(message).success, JSON.stringify(message)).toBe(true);
    expect(inspectorInboundSchema.safeParse({ type: "ready", nonce: NONCE, url: "https://evil.example" }).success).toBe(false);
    expect(inspectorInboundSchema.safeParse({ type: "rect", nonce: NONCE, sid: 3, rect: { x: 0, y: 1, width: 2, height: 3, extra: 1 } }).success).toBe(false);
    expect(inspectorInboundSchema.safeParse({ type: "rect", nonce: NONCE, sid: 3, rect: { x: 0, y: 1, width: -2, height: 3 } }).success).toBe(false);
    expect(inspectorInboundSchema.safeParse({ type: "navigate", nonce: NONCE }).success).toBe(false);
    expect(inspectorInboundSchema.safeParse({ type: "text-edit-commit", nonce: NONCE, sid: 0, text: "x" }).success).toBe(false);
    expect(inspectorInboundSchema.safeParse({ type: "text-edit-commit", nonce: NONCE, sid: 1, text: "x".repeat(100_001) }).success).toBe(false);
  });

  it("seals a command with the session nonce and refuses a bad one", () => {
    expect(sealInspectorCommand({ type: "select", sid: 5 }, NONCE)).toEqual({ type: "select", nonce: NONCE, sid: 5 });
    expect(sealInspectorCommand({ type: "cancel-text-edit" }, NONCE)).toEqual({ type: "cancel-text-edit", nonce: NONCE });
    expect(sealInspectorCommand({ type: "select", sid: 5 }, "not-a-nonce")).toEqual({ type: "select", nonce: "not-a-nonce", sid: 5 });
    expect(sealInspectorCommand({ type: "select", sid: -1 }, NONCE)).toBeNull();
    expect(sealInspectorCommand({ type: "begin-text-edit", sid: 2 ** 40 }, NONCE)).toBeNull();
    // The command schema rejects an extra key too.
    expect(inspectorCommandSchema.safeParse({ type: "select", nonce: NONCE, sid: 1, url: "x" }).success).toBe(false);
  });
});
