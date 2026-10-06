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
/** The attribute the stamp writes: the name carries the session nonce, so a document cannot guess it. */
const SID = `data-sid-${NONCE}`;

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

// --- The injected script, executed -----------------------------------------
//
// jsdom never runs a script added to a document, so the body is executed in a
// simulated frame: the harness supplies `parent`, `addEventListener`,
// `document` and a fake port. This proves the frame SIDE of the protocol - the
// nonce check, the command allowlist and the messages it emits - which a
// source scan alone cannot. `new Function` appears only in this test, to run
// the exact string the frame receives; the shipped module evaluates nothing.

interface InspectorFrame {
  sent: Array<Record<string, unknown>>;
  port: MessagePort;
  /** The exact object the script sees as `parent` (identity matters). */
  parent: object;
  /** The rendered frame document root the script queries. */
  root: HTMLElement;
  command(message: unknown): void;
  emit(type: string, event: unknown): void;
  hasListener(type: string): boolean;
}

function runInspector(html: string): InspectorFrame {
  const sent: Array<Record<string, unknown>> = [];
  const port = { postMessage: (message: Record<string, unknown>) => sent.push(message) } as unknown as MessagePort;
  const windowListeners = new Map<string, Array<(event: unknown) => void>>();
  const docListeners = new Map<string, Array<(event: unknown) => void>>();
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const frameDocument = {
    documentElement: { scrollHeight: 111 },
    querySelectorAll: (selector: string) => holder.querySelectorAll(selector),
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      docListeners.set(type, [...(docListeners.get(type) ?? []), handler]);
    },
  };
  const parent = { frame: "parent" };
  const run = new Function("parent", "addEventListener", "document", "ResizeObserver", INSPECTOR_SCRIPT_BODY);
  run(
    parent,
    (type: string, handler: (event: unknown) => void) => {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), handler]);
    },
    frameDocument,
    undefined,
  );
  return {
    sent,
    port,
    parent,
    root: holder,
    command(message) {
      const onmessage = (port as unknown as { onmessage?: (e: { data: unknown }) => void }).onmessage;
      onmessage?.({ data: message });
    },
    emit(type, event) {
      for (const handler of windowListeners.get(type) ?? []) handler(event);
      for (const handler of docListeners.get(type) ?? []) handler(event);
    },
    hasListener(type) {
      return (docListeners.get(type) ?? []).length > 0;
    },
  };
}

const INIT = { type: "uniwork-preview:init", nonce: NONCE };

describe("inspector script runtime (frame side)", () => {
  it("ignores an init from anything but the parent, or with a bad nonce or type", () => {
    const frame = runInspector(`<p ${SID}="1">x</p>`);
    frame.emit("message", { data: INIT, source: { not: "parent" }, ports: [frame.port] });
    frame.emit("message", { data: { type: "uniwork-preview:init", nonce: "bad" }, source: frame.parent, ports: [frame.port] });
    frame.emit("message", { data: { type: "other", nonce: NONCE }, source: frame.parent, ports: [frame.port] });
    frame.emit("message", { data: INIT, source: frame.parent, ports: [] });
    expect(frame.sent).toEqual([]);
    expect(frame.hasListener("click")).toBe(false);
  });

  it("takes the port once, reports ready and resize, and ignores a second init", () => {
    const frame = runInspector(`<p ${SID}="1">x</p>`);
    frame.emit("message", { data: INIT, source: frame.parent, ports: [frame.port] });
    frame.emit("message", { data: INIT, source: frame.parent, ports: [frame.port] });
    expect(frame.sent).toEqual([
      { nonce: NONCE, type: "ready" },
      { nonce: NONCE, type: "resize", height: 111 },
    ]);
    for (const type of ["click", "mouseover", "focusout", "keydown"]) expect(frame.hasListener(type)).toBe(true);
  });

  it("answers a select command with select + rect, and refuses a wrong nonce or type", () => {
    const frame = runInspector(`<p ${SID}="7">x</p>`);
    frame.emit("message", { data: INIT, source: frame.parent, ports: [frame.port] });
    frame.sent.length = 0;
    frame.command({ type: "select", nonce: "wrong", sid: 7 });
    frame.command({ type: "navigate", nonce: NONCE });
    expect(frame.sent).toEqual([]);
    frame.command({ type: "select", nonce: NONCE, sid: 7 });
    expect(frame.sent.map((m) => m.type)).toEqual(["select", "rect"]);
    expect(frame.sent[0]).toEqual({ nonce: NONCE, type: "select", sid: 7 });
    expect(frame.sent[1]).toMatchObject({ nonce: NONCE, type: "rect", sid: 7 });
    // A null selection clears without a rect.
    frame.sent.length = 0;
    frame.command({ type: "select", nonce: NONCE, sid: null });
    expect(frame.sent).toEqual([{ nonce: NONCE, type: "select", sid: null }]);
  });

  it("maps a click to the nearest data-sid", () => {
    const frame = runInspector(`<div ${SID}="3"><span id="s1-inner">t</span></div>`);
    frame.emit("message", { data: INIT, source: frame.parent, ports: [frame.port] });
    frame.sent.length = 0;
    const inner = frame.root.querySelector("#s1-inner")!;
    frame.emit("click", { target: inner, preventDefault: () => undefined });
    expect(frame.sent.map((m) => m.type)).toEqual(["select", "rect"]);
    expect(frame.sent[0]).toMatchObject({ nonce: NONCE, sid: 3 });
    // A click with no data-sid ancestor is ignored.
    frame.sent.length = 0;
    frame.emit("click", { target: frame.root, preventDefault: () => undefined });
    expect(frame.sent).toEqual([]);
  });

  it("reports hover and commits a text edit with the element's text", () => {
    const frame = runInspector(`<p ${SID}="9">hello world</p>`);
    frame.emit("message", { data: INIT, source: frame.parent, ports: [frame.port] });
    frame.sent.length = 0;
    frame.emit("mouseover", { target: frame.root.querySelector(`[${SID}="9"]`) });
    expect(frame.sent).toEqual([{ nonce: NONCE, type: "hover", sid: 9 }]);
    frame.sent.length = 0;
    frame.command({ type: "begin-text-edit", nonce: NONCE, sid: 9 });
    expect(frame.sent).toEqual([]);
    frame.emit("focusout", { target: frame.root.querySelector(`[${SID}="9"]`) });
    expect(frame.sent).toHaveLength(1);
    expect(frame.sent[0]).toMatchObject({ nonce: NONCE, type: "text-edit-commit", sid: 9, text: "hello world" });
  });

  it("begin-text-edit makes the element editable, takes frame focus and puts the caret in it", () => {
    document.body.innerHTML = "";
    const frame = runInspector(`<p ${SID}="9">hello</p>`);
    document.body.appendChild(frame.root);
    frame.emit("message", { data: INIT, source: frame.parent, ports: [frame.port] });
    const p = frame.root.querySelector<HTMLElement>(`[${SID}="9"]`)!;
    const windowFocus = vi.spyOn(globalThis, "focus").mockImplementation(() => undefined);
    frame.command({ type: "begin-text-edit", nonce: NONCE, sid: 9 });
    expect(p.getAttribute("contenteditable")).toBe("true");
    expect(windowFocus).toHaveBeenCalled();
    expect(document.activeElement).toBe(p);
    expect(window.getSelection()?.anchorNode && p.contains(window.getSelection()!.anchorNode)).toBe(true);
    windowFocus.mockRestore();
  });

  it("a double-click selects the element and starts the edit; a click inside the edit does not re-select", () => {
    const frame = runInspector(`<div ${SID}="3"><span ${SID.replace("1", "1")}-x="1">t</span></div><p ${SID}="4">hi</p>`);
    frame.emit("message", { data: INIT, source: frame.parent, ports: [frame.port] });
    frame.sent.length = 0;
    const p = frame.root.querySelector<HTMLElement>(`[${SID}="4"]`)!;
    frame.emit("dblclick", { target: p, preventDefault: () => undefined });
    expect(frame.sent.map((m) => m.type)).toEqual(["select", "rect"]);
    expect(p.getAttribute("contenteditable")).toBe("true");
    frame.sent.length = 0;
    frame.emit("click", { target: p, preventDefault: () => undefined });
    expect(frame.sent).toEqual([]);
  });

  it("never makes html, head or body editable", () => {
    const frame = runInspector(`<body ${SID}="2">x</body>`);
    frame.emit("message", { data: INIT, source: frame.parent, ports: [frame.port] });
    const el = frame.root.querySelector<HTMLElement>(`[${SID}="2"]`) ?? frame.root;
    frame.command({ type: "begin-text-edit", nonce: NONCE, sid: 2 });
    expect(el.getAttribute("contenteditable")).toBeNull();
  });

  it("sends a hover only when the resolved sid changes (FE-M4)", () => {
    const frame = runInspector(`<div ${SID}="3"><span id="in">t</span></div>`);
    frame.emit("message", { data: INIT, source: frame.parent, ports: [frame.port] });
    frame.sent.length = 0;
    const inner = frame.root.querySelector("#in")!;
    const outer = frame.root.querySelector(`[${SID}="3"]`)!;
    // Two mouseovers that resolve to the same sid emit one message, not two.
    frame.emit("mouseover", { target: inner });
    frame.emit("mouseover", { target: outer });
    expect(frame.sent).toEqual([{ nonce: NONCE, type: "hover", sid: 3 }]);
    frame.sent.length = 0;
    // Leaving the element (null) is a change; repeating it is not.
    frame.emit("mouseover", { target: frame.root });
    frame.emit("mouseover", { target: frame.root });
    expect(frame.sent).toEqual([{ nonce: NONCE, type: "hover", sid: null }]);
    frame.sent.length = 0;
    // Returning to the element is a change again.
    frame.emit("mouseover", { target: outer });
    expect(frame.sent).toEqual([{ nonce: NONCE, type: "hover", sid: 3 }]);
  });

  it("clamps data-sid to the parent schema's bound (SEC F8)", () => {
    const frame = runInspector(`<p ${SID}="2147483647">max</p><p ${SID}="2147483648">over</p>`);
    frame.emit("message", { data: INIT, source: frame.parent, ports: [frame.port] });
    frame.sent.length = 0;
    frame.emit("click", { target: frame.root.querySelector(`[${SID}="2147483647"]`), preventDefault: () => undefined });
    expect(frame.sent[0]).toMatchObject({ nonce: NONCE, type: "select", sid: 2147483647 });
    frame.sent.length = 0;
    // One past the cap is treated as no sid, so nothing is reported - matching
    // the parent schema, which would drop such a message anyway.
    frame.emit("click", { target: frame.root.querySelector(`[${SID}="2147483648"]`), preventDefault: () => undefined });
    expect(frame.sent).toEqual([]);
  });

  it("reads only the nonce-named attribute: a document's own data-sid, or another nonce's, names nothing", () => {
    const other = "data-sid-" + "f".repeat(32);
    const frame = runInspector(`<p data-sid="1" id="plain">a</p><p ${other}="2" id="other">b</p><p ${SID}="3" id="mine">c</p>`);
    frame.emit("message", { data: INIT, source: frame.parent, ports: [frame.port] });
    frame.sent.length = 0;
    frame.emit("click", { target: frame.root.querySelector("#plain"), preventDefault: () => undefined });
    frame.emit("click", { target: frame.root.querySelector("#other"), preventDefault: () => undefined });
    expect(frame.sent).toEqual([]);
    // A command naming the forged sid finds no element either.
    frame.command({ type: "select", nonce: NONCE, sid: 1 });
    expect(frame.sent).toEqual([{ nonce: NONCE, type: "select", sid: null }]);
    frame.sent.length = 0;
    frame.emit("click", { target: frame.root.querySelector("#mine"), preventDefault: () => undefined });
    expect(frame.sent[0]).toMatchObject({ type: "select", sid: 3 });
  });

  it("leaves the element's markup exactly as it was after an unchanged text edit or a cancel", () => {
    const frame = runInspector(`<p ${SID}="4" id="p">Intro <b>bold</b> and <a href="/x">link</a></p>`);
    frame.emit("message", { data: INIT, source: frame.parent, ports: [frame.port] });
    const p = frame.root.querySelector("#p")!;
    const before = p.innerHTML;
    frame.command({ type: "begin-text-edit", nonce: NONCE, sid: 4 });
    frame.emit("focusout", { target: p });
    expect(frame.sent.at(-1)).toMatchObject({ type: "text-edit-commit", sid: 4, text: "Intro bold and link" });
    expect(p.innerHTML).toBe(before);
    expect(p.hasAttribute("contenteditable")).toBe(false);
    frame.command({ type: "begin-text-edit", nonce: NONCE, sid: 4 });
    frame.emit("keydown", { key: "Escape", preventDefault: () => undefined });
    expect(p.innerHTML).toBe(before);
  });
});
