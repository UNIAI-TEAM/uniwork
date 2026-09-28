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
import type {
  OpenedPptxLike,
  PptxElementLike,
  PptxEngineFunctions,
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
import { FAKE_PPTX_MAGIC } from "./fake-pptx-fixtures";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface FakePptxPackage {
  magic: string;
  size?: { cx: number; cy: number };
  slides: Array<Record<string, unknown>>;
  layouts?: Array<{ name: string; path: string }>;
  entries?: Record<string, string>;
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

function toSlide(raw: Record<string, unknown>, i: number): PptxSlideLike {
  return {
    id: (raw.id as string) ?? "s_" + (i + 1),
    ...(raw.hidden === true ? { hidden: true } : {}),
    elements: (raw.elements as PptxElementLike[]) ?? [],
  };
}

let newElementSeq = 100;

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
  };
}

// ── fake runTxn ────────────────────────────────────────────────────────────

function resolveSlide(opened: OpenedPptxLike, op: PptxOp): { index: number; slide: PptxSlideLike } {
  const ref = op.target?.slide;
  const slides = opened.deck.slides;
  if (typeof ref === "string") {
    const index = slides.findIndex((s) => s.id === ref);
    if (index < 0) throw new Error('op "' + op.op + '": no slide "' + ref + '"');
    return { index, slide: slides[index] as PptxSlideLike };
  }
  if (typeof ref !== "number") {
    throw new Error('op "' + op.op + '" needs target.slide');
  }
  const slide = slides[ref];
  if (!slide) {
    throw new Error('op "' + op.op + '": slide index ' + ref + " is out of range");
  }
  return { index: ref, slide };
}

function resolveElement(opened: OpenedPptxLike, op: PptxOp): { slide: PptxSlideLike; el: PptxElementLike } {
  const { slide } = resolveSlide(opened, op);
  const id = op.target?.el;
  const el = slide.elements.find((x) => x.id === id);
  if (!el) throw new Error('op "' + op.op + '": no element "' + id + '"');
  return { slide, el };
}

function applyOp(opened: OpenedPptxLike, op: PptxOp): PptxOpRecord {
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
        id: "new_" + newElementSeq++,
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
        id: "new_" + newElementSeq++,
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
      slide.hidden = op.hidden === true;
      return { op, after: slide.hidden };
    }
    case "duplicateSlide": {
      const { index, slide } = resolveSlide(opened, op);
      const copy = JSON.parse(JSON.stringify(slide)) as PptxSlideLike;
      copy.id = "s_dup_" + newElementSeq++;
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
      const s: PptxSlideLike = { id: "s_" + newElementSeq++, elements: [] };
      opened.deck.slides.splice(index + 1, 0, s);
      return { op, created: [s.id as string] };
    }
    case "addSlideWithLayout": {
      const slides = opened.deck.slides;
      const index = op.target?.slide !== undefined ? resolveSlide(opened, op).index : slides.length - 1;
      const s: PptxSlideLike = { id: "s_" + newElementSeq++, elements: [], layout: op.layout };
      slides.splice(index + 1, 0, s);
      return { op, created: [s.id as string] };
    }
    default:
      throw new Error('op "' + op.op + '": unknown op in fake executor');
  }
}

function validateOp(opened: OpenedPptxLike, op: PptxOp): void {
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
