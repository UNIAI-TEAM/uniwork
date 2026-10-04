// apps/web/platform/office/preview-inspector.ts — the UniWork-owned inspector
// script injected into the HTML editor's VISUAL-EDIT preview frame (ADR 0026,
// user decision 2026-10-04 option (a)).
//
// This is the ONE place the preview runs a script that UniWork wrote. It exists
// only because a sandboxed frame without allow-same-origin cannot be inspected
// from the parent: the frame must report its own selection and geometry. Every
// other G3-D2 invariant is unchanged, and the script below is bounded by four
// rules the module enforces on itself:
//
//   * It is product code in this repo, never read from the document. The
//     document's own scripts are removed by the gate before this is injected
//     (preview-gate.ts stripScripts), so the frame's only script is this one.
//   * It reads nothing but the DOM it renders: no cookies, no storage, no
//     network, no timers that fetch. The tests pin that by scanning the source.
//   * It keeps the port and the nonce in a closure - nothing is attached to
//     window or document, so nothing in the document can reach them.
//   * It carries the per-render nonce as an attribute, never in its body, and
//     it refuses every command whose nonce does not match the one the parent
//     handed it at init. The parent validates the other direction with zod.
//
// The wire protocol is declared once here and BOTH sides are generated or
// checked from these constants, so a new message type cannot land on one side
// only: the script's allowlists are built from the arrays below, and the zod
// schemas are derived from the same names.

import { z } from "zod";

/** Messages the inspector may send to the parent. */
export const INSPECTOR_FRAME_MESSAGE_TYPES = [
  "ready",
  "resize",
  "select",
  "hover",
  "rect",
  "text-edit-commit",
] as const;
export type InspectorFrameMessageType = (typeof INSPECTOR_FRAME_MESSAGE_TYPES)[number];

/** Commands the parent may send to the inspector. */
export const INSPECTOR_COMMAND_TYPES = ["select", "hover", "begin-text-edit", "cancel-text-edit"] as const;
export type InspectorCommandType = (typeof INSPECTOR_COMMAND_TYPES)[number];

/** Bounds shared with the parent schema: a frame cannot make the parent store
 * an unbounded height, rect or text. */
export const INSPECTOR_MAX_HEIGHT = 1_000_000;
export const INSPECTOR_MAX_RECT = 10_000_000;
export const INSPECTOR_MAX_TEXT = 100_000;
const MAX_SID = 2 ** 31 - 1;

/** The per-render nonce format. The CSP nonce and the inspector attribute are
 * the same value; anything else is refused at mount, never guessed. */
const NONCE_RE = /^[0-9a-f]{32}$/;

export function isInspectorNonce(value: unknown): value is string {
  return typeof value === "string" && NONCE_RE.test(value);
}

/** Generate a nonce, or throw: a platform that cannot produce randomness must
 * fail closed rather than render a frame with a predictable nonce. */
export function createInspectorNonce(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("inspector nonce source is unavailable");
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Assert a caller-supplied nonce; the message names the value, never the rule. */
export function assertInspectorNonce(value: unknown): string {
  if (!isInspectorNonce(value)) throw new Error("visual-edit nonce must be 32 lowercase hex characters");
  return value;
}

const sid = z.number().int().positive().max(MAX_SID);
const bounded = z.number().finite().min(-INSPECTOR_MAX_RECT).max(INSPECTOR_MAX_RECT);

/** Every inbound frame message. strictObject: an extra key (a URL, a path, a
 * field a later ADR adds) makes the whole message invalid instead of riding
 * along, which is the same fail-closed rule the plain bridge uses. */
export const inspectorInboundSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ready"), nonce: z.string() }),
  z.strictObject({ type: z.literal("resize"), nonce: z.string(), height: z.number().finite().nonnegative().max(INSPECTOR_MAX_HEIGHT) }),
  z.strictObject({ type: z.literal("select"), nonce: z.string(), sid: sid.nullable() }),
  z.strictObject({ type: z.literal("hover"), nonce: z.string(), sid: sid.nullable() }),
  z.strictObject({
    type: z.literal("rect"),
    nonce: z.string(),
    sid,
    rect: z.strictObject({ x: bounded, y: bounded, width: z.number().finite().nonnegative().max(INSPECTOR_MAX_RECT), height: z.number().finite().nonnegative().max(INSPECTOR_MAX_RECT) }),
  }),
  z.strictObject({ type: z.literal("text-edit-commit"), nonce: z.string(), sid, text: z.string().max(INSPECTOR_MAX_TEXT) }),
]);
export type InspectorInbound = z.infer<typeof inspectorInboundSchema>;

/** What the parent may send. Validated before the message leaves the app, so
 * a malformed command is dropped at the source rather than at the frame. */
export const inspectorCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("select"), nonce: z.string(), sid: sid.nullable() }),
  z.strictObject({ type: z.literal("hover"), nonce: z.string(), sid: sid.nullable() }),
  z.strictObject({ type: z.literal("begin-text-edit"), nonce: z.string(), sid }),
  z.strictObject({ type: z.literal("cancel-text-edit"), nonce: z.string() }),
]);
export type InspectorCommandWire = z.infer<typeof inspectorCommandSchema>;
/** The caller-facing command: the session adds the nonce. */
export type InspectorCommand =
  | { type: "select"; sid: number | null }
  | { type: "hover"; sid: number | null }
  | { type: "begin-text-edit"; sid: number }
  | { type: "cancel-text-edit" };

/** Validate a caller command and stamp it with the session nonce, or null. */
export function sealInspectorCommand(command: InspectorCommand, nonce: string): InspectorCommandWire | null {
  const parsed = inspectorCommandSchema.safeParse({ ...command, nonce });
  return parsed.success ? parsed.data : null;
}

/**
 * The inspector source, minus the nonce (which travels as an attribute). The
 * allowlists are interpolated from the protocol constants above so the frame
 * and the parent cannot drift; a type added to one array reaches both sides.
 * It reads no cookies, no storage and no network: only the DOM it renders.
 */
export const INSPECTOR_SCRIPT_BODY = [
  "(function(){",
  "var P=null,N='',SEL=null,HOV=null,EDIT=null,SAVE=null;",
  "var FRAME=" + JSON.stringify(INSPECTOR_FRAME_MESSAGE_TYPES) + ";",
  "var CMD=" + JSON.stringify(INSPECTOR_COMMAND_TYPES) + ";",
  "function send(t,x){if(!P)return;var m={nonce:N,type:t};for(var k in x)m[k]=x[k];try{P.postMessage(m)}catch(e){}}",
  "function num(el){var v=el.getAttribute&&el.getAttribute('data-sid');if(v===null||!/^[1-9][0-9]{0,9}$/.test(v))return null;var d=parseInt(v,10);return d>0?d:null}",
  "function sid(el){for(var n=el;n&&n.nodeType===1;n=n.parentNode){var d=num(n);if(d!==null)return d}return null}",
  "function el(d){if(d===null)return null;var all=document.querySelectorAll('[data-sid]');for(var i=0;i<all.length;i++){if(num(all[i])===d)return all[i]}return null}",
  "function mark(e,color){if(e&&e.style)e.style.outline=color?('2px solid '+color):''}",
  "function rect(e){var r=e.getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height}}",
  "function pick(d){var e=el(d);mark(SEL,'');SEL=e;if(!e)return;mark(e,'#2563eb');send('select',{sid:d});send('rect',{sid:d,rect:rect(e)})}",
  "function hover(d){var e=el(d);if(HOV&&HOV!==SEL)mark(HOV,'');HOV=e;if(e&&e!==SEL)mark(e,'#93c5fd');send('hover',{sid:d})}",
  "function commit(){if(!EDIT)return;var e=EDIT,before=SAVE;EDIT=null;SAVE=null;e.removeAttribute('contenteditable');",
  "var text=(e.textContent||'').replace(/\\s+/g,' ').trim();if(before!==null)e.textContent=before;send('text-edit-commit',{sid:sid(e),text:text})}",
  "function begin(d){var e=el(d);if(!e)return;if(EDIT)commit();EDIT=e;SAVE=e.textContent;e.setAttribute('contenteditable','true');try{e.focus()}catch(x){}}",
  "function cancel(){if(!EDIT)return;var e=EDIT,before=SAVE;EDIT=null;SAVE=null;e.removeAttribute('contenteditable');if(before!==null)e.textContent=before}",
  "function onCommand(m){if(!P||!m||typeof m!=='object'||m.nonce!==N||CMD.indexOf(m.type)===-1)return;",
  "if(m.type==='select')pick(m.sid===null?null:m.sid);else if(m.type==='hover')hover(m.sid===null?null:m.sid);",
  "else if(m.type==='begin-text-edit')begin(m.sid);else if(m.type==='cancel-text-edit')cancel()}",
  "function onClick(e){if(!P)return;var d=sid(e.target);if(d===null)return;e.preventDefault();pick(d)}",
  "function onOver(e){if(!P||EDIT)return;hover(sid(e.target))}",
  "function onOut(e){if(EDIT&&(EDIT===e.target||EDIT.contains(e.target)))commit()}",
  "function onKey(e){if(!EDIT)return;if(e.key==='Escape'){e.preventDefault();cancel()}else if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();commit()}}",
  "function onScroll(){if(SEL)send('rect',{sid:sid(SEL),rect:rect(SEL)})}",
  "function onInit(e){if(P||e.source!==parent||!e.ports||!e.ports[0]||!e.data)return;",
  "if(e.data.type!=='uniwork-preview:init'||typeof e.data.nonce!=='string'||!/^[0-9a-f]{32}$/.test(e.data.nonce))return;",
  "P=e.ports[0];N=e.data.nonce;P.onmessage=function(ev){onCommand(ev.data)};",
  "document.addEventListener('click',onClick,true);document.addEventListener('mouseover',onOver,true);",
  "document.addEventListener('focusout',onOut,true);document.addEventListener('keydown',onKey,true);",
  "addEventListener('scroll',onScroll,true);",
  "send('ready');var r=function(){send('resize',{height:document.documentElement.scrollHeight})};",
  "if(typeof ResizeObserver==='function')new ResizeObserver(r).observe(document.documentElement);r()}",
  "addEventListener('message',onInit)",
  "})();",
].join("");

/**
 * Insert the inspector into an ALREADY-GATED copy. Runs after gatePreviewCopy,
 * so the document's own scripts are gone and cannot be mistaken for this one;
 * the script is appended to <head>, which is after the CSP <meta> the engine
 * wrote, so the nonce policy applies to it. Fails closed (throws) when the
 * copy has no parsed document to attach to rather than guessing a position.
 */
export function injectInspector(gatedHtml: string, nonce: string): string {
  assertInspectorNonce(nonce);
  const parser = new DOMParser();
  const doc = parser.parseFromString(gatedHtml, "text/html");
  const script = doc.createElement("script");
  script.setAttribute("nonce", nonce);
  script.textContent = INSPECTOR_SCRIPT_BODY;
  // <head> always exists in a parsed HTML document; appendChild is what places
  // the script after the CSP <meta> the engine wrote.
  doc.head.appendChild(script);
  // Mirror preview-gate.ts serialise(): always no-quirks with the standards
  // doctype, so the frame parses the injected copy the same way.
  const html = "<!DOCTYPE html>" + doc.documentElement.outerHTML;
  // Prove the injection survived: exactly one script, carrying our nonce. A
  // copy where it did not is refused (fail closed) rather than shipped.
  const check = parser.parseFromString(html, "text/html");
  const scripts = check.querySelectorAll("script");
  if (scripts.length !== 1 || scripts[0]?.getAttribute("nonce") !== nonce) {
    throw new Error("inspector injection did not survive serialisation");
  }
  return html;
}
