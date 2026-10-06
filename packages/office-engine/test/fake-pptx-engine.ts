// Fake PPTX engine + op executor for adapter tests — a deterministic JSON
// convention implementing the seam subset the adapter uses.
//
// openPptx: decode + marker check ('not a valid zip' / 'not a pptx' errors
//   mirror the shapes the adapter maps to failure classes)
// savePptx:  re-serialize the deck deterministically
// commitSaved/reparseDeck: tracked so tests can assert two-save semantics
// runTxn:    executor-faithful — dry-run plan validates without mutating;
//            atomic isolation snapshots and restores on any apply failure;
//            result shape {applied, dryRun?, plan?, records?, failures?}
// Master/layout parts (B6 wire): a part is archive text carrying its fake
//   element tree (makeFakeMasterXml); parseMasterPart reads it, and the five
//   part-addressed vendored ops (target.part) rewrite that text in place, so
//   an edit survives savePptx -> reopen exactly like the real archive does.
// Wave A/B + format/notes/header-footer/media op cases live in the sibling
// ./fake-pptx-op-cases.ts (the max-lines split); the core cases stay here.
import type {
  OpenedPptxLike,
  PptxElementLike,
  PptxEngineFunctions,
  PptxMasterPartLike,
  PptxOp,
  PptxOpFailure,
  PptxOpRecord,
  PptxOpsFunctions,
  PptxParagraphLike,
  PptxRenderPort,
  PptxSlideLike,
  PptxTxnRequest,
  PptxTxnResult,
} from "../src/pptx";
import { FAKE_PPTX_MAGIC, makeFakePptxBytes } from "./fake-pptx-fixtures";

import { applyWaveOp, nextSeq, resolveElement, resolveSlide, validateWaveOp } from "./fake-pptx-op-cases";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface FakePptxPackage {
  magic: string;
  size?: { cx: number; cy: number };
  slides: Array<Record<string, unknown>>;
  layouts?: Array<{ name: string; path: string }>;
  entries?: Record<string, string>;
  sections?: Array<{ id: string; name: string; slideIndices: number[] }>;
  notes?: Record<string, string>;
  comments?: Record<string, Array<Record<string, unknown>>>;
  headerFooter?: Record<string, unknown>;
}

function decode(bytes: Uint8Array): FakePptxPackage {
  // PK-headed container → strip the magic and read the fake package JSON.
  const hasZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const payload = hasZip ? bytes.subarray(4) : bytes;
  let pkg: FakePptxPackage;
  try {
    pkg = JSON.parse(decoder.decode(payload)) as FakePptxPackage;
  } catch {
    throw new Error("Corrupted zip: invalid central directory");
  }
  if (!pkg || pkg.magic !== FAKE_PPTX_MAGIC) {
    throw new Error("not a pptx: missing ppt/presentation.xml");
  }
  return pkg;
}

/** Decode the fake package — accepts PK-headed container or bare payload. */
export function decodeFakePptx(bytes: Uint8Array): FakePptxPackage {
  return decode(bytes);
}

export const FAKE_MASTER_PART = "ppt/slideMasters/slideMaster1.xml";
export const FAKE_LAYOUT_PART = "ppt/slideLayouts/slideLayout1.xml";

/** Fixture override for a deck with one master (title, body, logo) and one
 * layout (title): the standard kitchen-sink entries plus fake master/layout
 * part text and the master's layout rel, as parsed by parseMasterPart. */
/** Real-shaped master/layout XML (cSld + spTree + txStyles) for the part-XML
 * master edits (T01), which rewrite the part text itself. */
export const XML_MASTER =
  '<p:sldMaster xmlns:a="a" xmlns:p="p"><p:cSld name="Office Theme"><p:spTree>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>' +
  '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Date Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph type="dt" idx="10"/></p:nvPr></p:nvSpPr><p:spPr/>' +
  '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>' +
  '</p:spTree></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>' +
  '<p:bodyStyle><a:lvl1pPr/></p:bodyStyle><p:otherStyle/></p:txStyles></p:sldMaster>';
export const XML_LAYOUT =
  '<p:sldLayout xmlns:a="a" xmlns:p="p"><p:cSld name="Title Slide"><p:spTree>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/>' +
  '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>';

/** The kitchen-sink deck plus XML_MASTER / XML_LAYOUT at the fake part paths. */
export function xmlMasterFixture(): Parameters<typeof makeFakePptxBytes>[0] {
  const base = fakeMasterFixture() ?? {};
  return { ...base, entries: { ...(base.entries ?? {}), [FAKE_MASTER_PART]: XML_MASTER, [FAKE_LAYOUT_PART]: XML_LAYOUT } };
}

export function fakeMasterFixture(): Parameters<typeof makeFakePptxBytes>[0] {
  const offset = (x: number, y: number, cx: number, cy: number) => ({ offset: { x, y, cx, cy }, rot: 0 });
  const master: PptxElementLike[] = [
    {
      id: "m_title",
      type: "shape",
      placeholder: "title",
      transform: offset(457200, 205740, 8229600, 857250),
      fill: { type: "solid", color: "#112233CC" },
      text: { paragraphs: [{ runs: [{ text: "Click to edit Master title style" }] }] },
    },
    { id: "m_body", type: "text", placeholder: "body", transform: offset(457200, 1200150, 8229600, 3394472), text: { paragraphs: [] } },
    { id: "m_logo", type: "picture", transform: offset(8000000, 4500000, 800000, 400000) },
  ];
  const layout: PptxElementLike[] = [
    {
      id: "l_title",
      type: "shape",
      placeholder: "ctrTitle",
      transform: offset(685800, 1597819, 7772400, 1102519),
      text: { paragraphs: [{ runs: [{ text: "Layout title" }] }] },
    },
  ];
  return {
    entries: {
      ...(decodeFakePptx(makeFakePptxBytes()).entries ?? {}),
      [FAKE_MASTER_PART]: makeFakeMasterXml("Office Theme", master),
      "ppt/slideMasters/_rels/slideMaster1.xml.rels":
        '<Relationships><Relationship Id="rId1" Type="http://x/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
      [FAKE_LAYOUT_PART]: makeFakeMasterXml("Title Slide", layout, "p:sldLayout"),
    },
  };
}

function toSlide(raw: Record<string, unknown>, i: number): PptxSlideLike {
  return {
    id: (raw.id as string) ?? "s_" + (i + 1),
    ...(typeof raw.bodyPrefix === "string" ? { bodyPrefix: raw.bodyPrefix } : {}),
    // The real slide model has no `hidden` field: hiding patches `show="0"` onto the <p:sld> tag.
    ...(raw.hidden === true ? { bodyPrefix: patchSlideHidden(raw.bodyPrefix as string | undefined, true) } : {}),
    elements: (raw.elements as PptxElementLike[]) ?? [],
  };
}

const SLD_OPEN = /<p:sld\b[^>]*>/;

/** Mirrors the vendored patchSlideHiddenXml; a slide with no bodyPrefix gets a bare <p:sld>. */
function patchSlideHidden(bodyPrefix: string | undefined, hidden: boolean): string {
  const prefix = bodyPrefix ?? "<p:sld>";
  const open = SLD_OPEN.exec(prefix);
  if (!open) return prefix;
  let tag = open[0].replace(/\s+show="[^"]*"/, "");
  if (hidden) tag = `${tag.slice(0, -1)} show="0">`;
  return prefix.slice(0, open.index) + tag + prefix.slice(open.index + open[0].length);
}

const FAKE_PART_RE = /<!--fake-part:([\s\S]*?)-->/;

/** Archive text of a fake master/layout part: the real-looking `<p:cSld name>`
 * (what listMasterPartInfos reads) plus the fake element tree. Elements follow
 * the vendored parsed shape (transform.offset in EMU, Fill objects). */
export function makeFakeMasterXml(name: string, elements: PptxElementLike[], root = "p:sldMaster"): string {
  return (
    "<" + root + '><p:cSld name="' + name + '"/><!--fake-part:' + JSON.stringify({ elements }) + "--></" + root + ">"
  );
}

const readPartElements = (text: string | undefined): PptxElementLike[] | null => {
  const raw = text ? FAKE_PART_RE.exec(text)?.[1] : undefined;
  return raw === undefined ? null : (JSON.parse(raw) as { elements: PptxElementLike[] }).elements;
};

export function createFakePptxEngine(): PptxEngineFunctions & { commitCalls: number; committedBase?: string } {
  const state = { commitCalls: 0, committedBase: undefined as string | undefined };
  return {
    get commitCalls() {
      return state.commitCalls;
    },
    get committedBase() {
      return state.committedBase;
    },
    async openPptx(bytes: Uint8Array): Promise<OpenedPptxLike> {
      const pkg = decode(bytes);
      const slides = pkg.slides.map(toSlide);
      const entries = new Map<string, unknown>(Object.entries(pkg.entries ?? {}));
      return {
        deck: { size: pkg.size, slides },
        archive: {
          entries,
          readText: (path: string) => entries.get(path) as string | undefined,
        },
        __layouts: pkg.layouts ?? [],
        __sections: pkg.sections ?? [],
        __notes: pkg.notes ?? {},
        __comments: pkg.comments ?? {},
        __headerFooter: pkg.headerFooter ?? {},
      };
    },
    async savePptx(opened: OpenedPptxLike): Promise<Uint8Array> {
      const entries: Record<string, string> = {};
      if (opened.archive?.entries instanceof Map) {
        for (const [k, v] of opened.archive.entries) entries[k] = String(v);
      }
      const payload = encoder.encode(
        JSON.stringify({
          magic: FAKE_PPTX_MAGIC,
          size: opened.deck.size,
          slides: opened.deck.slides,
          layouts: (opened.__layouts as unknown[]) ?? [],
          sections: (opened.__sections as unknown[]) ?? [],
          notes: (opened.__notes as Record<string, string>) ?? {},
          comments: (opened.__comments as Record<string, unknown[]>) ?? {},
          headerFooter: (opened.__headerFooter as Record<string, unknown>) ?? {},
          entries,
        }),
      );
      const out = new Uint8Array(4 + payload.length);
      out.set([0x50, 0x4b, 0x03, 0x04]);
      out.set(payload, 4);
      return out;
    },
    commitSaved(opened: OpenedPptxLike): void {
      state.commitCalls += 1;
      state.committedBase = JSON.stringify(opened.deck.slides);
    },
    reparseDeck(opened: OpenedPptxLike): OpenedPptxLike {
      return JSON.parse(JSON.stringify(opened)) as OpenedPptxLike;
    },
    listSlideLayouts(): Array<{ name: string; path: string }> {
      return [{ name: "Title Slide", path: "ppt/slideLayouts/slideLayout1.xml" }];
    },
    parseMasterPart(archive: unknown, partPath: string): PptxMasterPartLike | null {
      const elements = readPartElements((archive as { readText?(p: string): string | undefined }).readText?.(partPath));
      return elements ? { path: partPath, elements } : null;
    },
  };
}

// ── fake runTxn ────────────────────────────────────────────────────────────

/** Part-addressed ops (registry.ts allowPart): resolve part + element like
 * resolvePart/resolveElement, refuse with the executor's guided message. */
function resolvePartElement(opened: OpenedPptxLike, op: PptxOp): { part: string; text: string; elements: PptxElementLike[]; el: PptxElementLike } {
  const part = op.target?.part as string;
  const text = opened.archive?.readText?.(part);
  const elements = readPartElements(text);
  if (!text || !elements) throw new Error('op "' + op.op + '": no master/layout part "' + part + '".');
  const el = elements.find((x) => x.id === op.target?.el);
  if (!el) {
    throw new Error(
      'op "' + op.op + '": no element ' + String(op.target?.el) + " on part " + part + ". Available: [" + elements.map((x) => x.id).join(", ") + "]",
    );
  }
  const textual = el.type === "text" || el.type === "shape";
  if ((op.op === "setText" || op.op === "setFill") && !textual) {
    throw new Error('op "' + op.op + '": element "' + el.id + '" is not a text/shape element.');
  }
  return { part, text, elements, el };
}

function applyPartOp(opened: OpenedPptxLike, op: PptxOp): PptxOpRecord {
  const { part, text, elements, el } = resolvePartElement(opened, op);
  let next = elements;
  switch (op.op) {
    case "setText":
      el.text = { paragraphs: op.paragraphs as PptxParagraphLike[] };
      break;
    case "setTransform": {
      const box = op.box as { x: number; y: number; cx: number; cy: number };
      el.transform = { offset: { ...box }, rot: ((op.rotDeg as number) ?? 0) * 60000 };
      break;
    }
    case "setFill": {
      const fill = op.fill;
      el.fill = fill === "none" ? { type: "none" } : typeof fill === "string" ? { type: "solid", color: fill } : { type: "gradient", ...(fill as object) };
      break;
    }
    case "setStroke":
      if (op.stroke === null) delete el.stroke;
      else el.stroke = op.stroke;
      break;
    case "deleteElement":
      next = elements.filter((x) => x.id !== el.id);
      break;
    default:
      throw new Error('op "' + op.op + '" does not accept a part target (allowPart is off).');
  }
  (opened.archive!.entries as Map<string, unknown>).set(
    part,
    text.replace(FAKE_PART_RE, () => "<!--fake-part:" + JSON.stringify({ elements: next }) + "-->"),
  );
  return { op, after: { part, el: el.id } };
}

function applyOp(opened: OpenedPptxLike, op: PptxOp): PptxOpRecord {
  if (op.target?.part !== undefined) return applyPartOp(opened, op);
  const wave = applyWaveOp(opened, op);
  if (wave !== undefined) return wave;
  switch (op.op) {
    case "setText": {
      const { el } = resolveElement(opened, op);
      el.text = { paragraphs: op.paragraphs as PptxParagraphLike[] };
      return { op, after: { el: el.id } };
    }
    case "setTransform": {
      const { el } = resolveElement(opened, op);
      const box = op.box as { x: number; y: number; cx: number; cy: number };
      el.transform = { offset: { x: box.x, y: box.y, cx: box.cx, cy: box.cy }, rot: (op.rotDeg as number) ?? 0 };
      return { op, after: { ...box } };
    }
    case "addElement": {
      const { slide } = resolveSlide(opened, op);
      const el: PptxElementLike = {
        id: "new_" + nextSeq(),
        type: op.kind === "textbox" ? "text" : "shape",
        transform: { offset: op.offset as { x: number; y: number; cx: number; cy: number } },
      };
      if (op.paragraphs) el.text = { paragraphs: op.paragraphs as PptxParagraphLike[] };
      slide.elements.push(el);
      return { op, created: [el.id] };
    }
    case "addPicture": {
      const { slide } = resolveSlide(opened, op);
      if (!["png", "jpg", "jpeg", "gif", "bmp", "webp", "tif"].includes(String(op.ext))) {
        return { op };
      }
      const el: PptxElementLike = {
        id: "new_" + nextSeq(),
        type: "picture",
        transform: { offset: op.offset as { x: number; y: number; cx: number; cy: number } },
      };
      slide.elements.push(el);
      return { op, created: [el.id] };
    }
    case "replacePicture": {
      const { el } = resolveElement(opened, op);
      if (el.type !== "picture") throw new Error('op "replacePicture": element "' + el.id + '" is not a picture.');
      el.src = "ppt/media/replaced." + String(op.ext);
      return { op, after: { el: el.id } };
    }
    case "deleteElement": {
      const { slide, el } = resolveElement(opened, op);
      slide.elements = slide.elements.filter((x) => x.id !== el.id);
      return { op, before: { type: el.type } };
    }
    case "reorderElement": {
      const { slide, el } = resolveElement(opened, op);
      const dir = String(op.dir);
      const idx = slide.elements.indexOf(el);
      if (!["front", "back", "forward", "backward"].includes(dir)) {
        throw new Error('op "reorderElement" needs "dir"');
      }
      slide.elements.splice(idx, 1);
      const at = dir === "front" ? slide.elements.length : dir === "back" ? 0 : dir === "forward" ? idx + 1 : idx - 1;
      slide.elements.splice(Math.max(0, Math.min(slide.elements.length, at)), 0, el);
      return { op, after: dir };
    }
    case "moveSlide": {
      const { index } = resolveSlide(opened, op);
      const to = op.to as number;
      const slides = opened.deck.slides;
      const [s] = slides.splice(index, 1);
      slides.splice(Math.max(0, Math.min(slides.length, to)), 0, s as PptxSlideLike);
      return { op, after: to };
    }
    case "setHidden": {
      const { slide } = resolveSlide(opened, op);
      slide.bodyPrefix = patchSlideHidden(slide.bodyPrefix as string | undefined, op.hidden === true);
      return { op, after: op.hidden === true };
    }
    case "duplicateSlide": {
      const { index, slide } = resolveSlide(opened, op);
      const copy = JSON.parse(JSON.stringify(slide)) as PptxSlideLike;
      copy.id = "s_dup_" + nextSeq();
      opened.deck.slides.splice(index + 1, 0, copy);
      return { op, created: [copy.id as string] };
    }
    case "deleteSlide": {
      const { index } = resolveSlide(opened, op);
      opened.deck.slides.splice(index, 1);
      return { op };
    }
    case "addBlankSlide": {
      const { index } = resolveSlide(opened, op);
      const s: PptxSlideLike = { id: "s_" + nextSeq(), elements: [] };
      opened.deck.slides.splice(index + 1, 0, s);
      return { op, created: [s.id as string] };
    }
    case "addSlideWithLayout": {
      const slides = opened.deck.slides;
      const index = op.target?.slide !== undefined ? resolveSlide(opened, op).index : slides.length - 1;
      const s: PptxSlideLike = { id: "s_" + nextSeq(), elements: [], layout: op.layout };
      slides.splice(index + 1, 0, s);
      return { op, created: [s.id as string] };
    }
    default:
      throw new Error('op "' + op.op + '": unknown op in fake executor');
  }
}

function validateOp(opened: OpenedPptxLike, op: PptxOp): void {
  if (op.target?.part !== undefined) {
    if (!["setText", "setTransform", "setFill", "setStroke", "deleteElement"].includes(op.op)) {
      throw new Error('op "' + op.op + '" does not accept a part target (allowPart is off).');
    }
    resolvePartElement(opened, op);
    return;
  }
  if (validateWaveOp(opened, op)) return;
  switch (op.op) {
    case "setText":
    case "setTransform":
    case "replacePicture":
    case "deleteElement":
    case "reorderElement":
      resolveElement(opened, op);
      break;
    case "addElement":
      resolveSlide(opened, op);
      if (!op.kind) throw new Error('op "addElement" needs "kind"');
      if (!op.offset) throw new Error('op "addElement" needs "offset"');
      break;
    case "addPicture":
      resolveSlide(opened, op);
      if (!op.bytes) throw new Error('op "addPicture" needs "bytes"');
      break;
    case "moveSlide":
    case "setHidden":
    case "duplicateSlide":
    case "deleteSlide":
    case "addBlankSlide":
      resolveSlide(opened, op);
      break;
    case "addSlideWithLayout":
      if (!op.layout && op.layout !== 0) throw new Error('op "addSlideWithLayout" needs "layout"');
      break;
    default:
      throw new Error('op "' + op.op + '": unknown op in fake executor');
  }
}

export function createFakePptxOps(): PptxOpsFunctions {
  return {
    runTxn(opened: OpenedPptxLike, req: PptxTxnRequest): PptxTxnResult {
      if (!Array.isArray(req.ops) || req.ops.length === 0) {
        return { applied: false, failures: [{ index: 0, op: { op: "(none)" }, error: "ops must be a non-empty array." }] };
      }
      const planFailures: PptxOpFailure[] = [];
      const plan: string[] = [];
      req.ops.forEach((op, i) => {
        try {
          validateOp(opened, op);
          plan.push(i + " " + op.op);
        } catch (e) {
          planFailures.push({ index: i, op, error: String((e as Error).message) });
        }
      });
      if (req.dryRun) {
        return { applied: false, dryRun: true, plan, ...(planFailures.length ? { failures: planFailures } : {}) };
      }
      const isolation = req.isolation ?? "atomic";
      const snapshot = JSON.parse(JSON.stringify(opened.deck)) as OpenedPptxLike["deck"];
      const records: PptxOpRecord[] = [];
      const failures: PptxOpFailure[] = [...planFailures];
      for (const [i, op] of req.ops.entries()) {
        if (isolation === "per_op" && planFailures.some((f) => f.index === i)) continue;
        try {
          records.push(applyOp(opened, op));
        } catch (e) {
          if (isolation === "atomic") {
            opened.deck = snapshot;
            return {
              applied: false,
              failures: [{ index: i, op, error: String((e as Error).message) + " Nothing was applied (atomic)." }],
            };
          }
          failures.push({ index: i, op, error: String((e as Error).message) });
        }
      }
      return { applied: true, records, ...(failures.length ? { failures } : {}) };
    },
  };
}

/** Fake render port — returns the updated slide projection the channel
 * promises (element ids + offsets as the render surface). */
export function createFakePptxRender(): PptxRenderPort {
  return {
    async buildRenderSlide(opened: OpenedPptxLike, slideIndex: number, fitWidthPx: number) {
      const slide = opened.deck.slides[slideIndex];
      if (!slide) throw new Error("no slide " + slideIndex);
      return {
        slideIndex,
        fitWidthPx,
        elements: slide.elements.map((el) => ({
          id: el.id,
          type: el.type,
          offset: el.transform?.offset ?? null,
        })),
      };
    },
  };
}
