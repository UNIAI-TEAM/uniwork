// Fake PPTX wave-A/B op cases (UNI-927): the validate/apply tables for the
// format/arrange, notes/comments, header-footer and media vendored ops, split
// out of fake-pptx-engine.ts so both modules stay under the 500-line bound
// (eslint max-lines, skipBlankLines + skipComments). The engine's single
// runTxn executor stays the one harness: it routes each op here first and
// falls back to its own core-op cases. Deterministic JSON-convention effects.

import type {
  OpenedPptxLike,
  PptxElementLike,
  PptxOp,
  PptxOpRecord,
  PptxSlideLike,
} from "../src/pptx";

let newElementSeq = 100;

/** Next fake id number; shared with the engine's core cases so minted ids stay unique. */
export const nextSeq = (): number => newElementSeq++;

export function resolveSlide(opened: OpenedPptxLike, op: PptxOp): { index: number; slide: PptxSlideLike } {
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

export function resolveElement(opened: OpenedPptxLike, op: PptxOp): { slide: PptxSlideLike; el: PptxElementLike } {
  const { slide } = resolveSlide(opened, op);
  const id = op.target?.el;
  const el = slide.elements.find((x) => x.id === id);
  if (!el) throw new Error('op "' + op.op + '": no element "' + id + '"');
  return { slide, el };
}

export function applyWaveOp(opened: OpenedPptxLike, op: PptxOp): PptxOpRecord | undefined {
  switch (op.op) {
    // Wave A/B (UNI-927) -- deterministic JSON-convention effects.
    case "applyTheme":
      opened.__theme = op.name;
      return { op, after: op.name };
    case "setSlideSize":
      (opened.deck as { size?: unknown }).size = { cx: op.cx, cy: op.cy };
      return { op, after: { cx: op.cx, cy: op.cy } };
    case "setSlideLayout": {
      const { slide } = resolveSlide(opened, op);
      slide.layout = op.layout;
      return { op, after: op.layout };
    }
    case "setBackground": {
      const { index } = resolveSlide(opened, op);
      const backgrounds = (opened.__backgrounds as Record<number, unknown>) ?? {};
      backgrounds[index] = op;
      opened.__backgrounds = backgrounds;
      return { op, after: { slide: index } };
    }
    case "setTransition": {
      const { index } = resolveSlide(opened, op);
      const transitions = (opened.__transitions as Record<number, unknown>) ?? {};
      transitions[index] = op.kind;
      opened.__transitions = transitions;
      return { op, after: op.kind };
    }
    case "setAdvanceTime": {
      const { index } = resolveSlide(opened, op);
      const times = (opened.__advanceTimes as Record<number, unknown>) ?? {};
      times[index] = op.ms;
      opened.__advanceTimes = times;
      return { op, after: op.ms };
    }
    case "addTable": {
      const { slide } = resolveSlide(opened, op);
      const el: PptxElementLike = {
        id: "new_" + nextSeq(),
        type: "table",
        transform: { offset: op.offset as { x: number; y: number; cx: number; cy: number } },
      };
      slide.elements.push(el);
      return { op, created: [el.id] };
    }
    case "addChart": {
      const { slide } = resolveSlide(opened, op);
      const el: PptxElementLike = {
        id: "new_" + nextSeq(),
        type: "chart",
        transform: { offset: op.offset as { x: number; y: number; cx: number; cy: number } },
      };
      slide.elements.push(el);
      return { op, created: [el.id] };
    }
    case "setTableCell":
    case "setTableRowHeight":
    case "setTableColWidth":
    case "setTableCellAnchor":
    case "setTableStyle":
      resolveElement(opened, op);
      return { op, after: { el: (op.target as { el?: string }).el } };
    case "setFont":
    case "setParagraphFormat":
      resolveElement(opened, op);
      return { op, after: { el: (op.target as { el?: string }).el } };
    case "addAnimation":
      resolveElement(opened, op);
      return { op, after: { el: (op.target as { el?: string }).el } };
    case "removeAnimation":
      if (op.seq !== undefined) resolveSlide(opened, op);
      else resolveElement(opened, op);
      return { op };
    case "reorderAnimation":
    case "setAnimations":
      resolveSlide(opened, op);
      return { op, after: { slide: (op.target as { slide?: number }).slide } };
    case "tableMerge":
    case "tableStructure": {
      const { el } = resolveElement(opened, op);
      return { op, after: { elementId: el.id } };
    }
    case "setChart":
      resolveElement(opened, op);
      return { op, after: op.patch };
    case "setLink":
      resolveElement(opened, op);
      return { op, after: op.link };
    case "findReplace": {
      const find = String(op.find ?? "");
      const replace = String(op.replace ?? "");
      if (find) {
        for (const slide of opened.deck.slides) {
          for (const el of slide.elements) {
            for (const paragraph of el.text?.paragraphs ?? []) {
              for (const run of paragraph.runs ?? []) {
                if (typeof run.text === "string") run.text = run.text.split(find).join(replace);
              }
            }
          }
        }
      }
      return { op, after: { find, replace } };
    }
    case "addSection": {
      const sections =
        (opened.__sections as Array<{ id: string; name: string; slideIndices: number[] }> | undefined) ?? [];
      const id = "{sec-" + nextSeq() + "}";
      sections.push({ id, name: String(op.name ?? ""), slideIndices: [Number(op.atSlideIndex ?? 0)] });
      opened.__sections = sections;
      return { op, after: { id } };
    }
    case "renameSection": {
      const sections = (opened.__sections as Array<{ id: string; name: string }> | undefined) ?? [];
      const section = sections.find((s) => s.id === op.id);
      if (section) section.name = String(op.name ?? "");
      return { op, after: { id: op.id } };
    }
    case "removeSection": {
      const sections = (opened.__sections as Array<{ id: string }> | undefined) ?? [];
      opened.__sections = sections.filter((s) => s.id !== op.id);
      return { op };
    }
    case "moveSection": {
      const sections = (opened.__sections as Array<{ id: string }> | undefined) ?? [];
      const from = sections.findIndex((s) => s.id === op.id);
      const to = op.dir === "up" ? from - 1 : from + 1;
      if (from >= 0 && to >= 0 && to < sections.length) {
        const [moved] = sections.splice(from, 1);
        sections.splice(to, 0, moved as { id: string });
      }
      return { op, after: op.dir };
    }
    case "setSections":
      opened.__sections = JSON.parse(JSON.stringify(op.sections ?? [])) as unknown[];
      return { op, after: op.sections };
    // Format/arrange (A4e), notes/comments (A5e), header/footer (B7e),
    // media (B8e) -- deterministic JSON-convention effects.
    case "setFill": {
      const { el } = resolveElement(opened, op);
      el.fill = op.fill;
      return { op, after: { el: el.id } };
    }
    case "setStroke": {
      const { el } = resolveElement(opened, op);
      el.stroke = op.stroke;
      return { op, after: { el: el.id } };
    }
    case "setEffects": {
      const { el } = resolveElement(opened, op);
      el.effects = op.effects;
      return { op, after: { el: el.id } };
    }
    case "setShapeGeometry": {
      const { el } = resolveElement(opened, op);
      el.prst = op.prst;
      return { op, after: { el: el.id } };
    }
    case "setShapeAdjust": {
      const { el } = resolveElement(opened, op);
      el.adjust = op.adjust;
      return { op, after: { el: el.id } };
    }
    case "ungroupElement": {
      const { el } = resolveElement(opened, op);
      el.type = "shape";
      el.ungrouped = true;
      return { op, after: { el: el.id } };
    }
    case "addConnector": {
      const { slide } = resolveSlide(opened, op);
      const el: PptxElementLike = { id: "cxn_" + nextSeq(), type: "connector", stCxn: op.from, endCxn: op.to, kind: op.kind ?? "straight" };
      slide.elements.push(el);
      return { op, created: [el.id] };
    }
    case "groupElements": {
      const { slide } = resolveSlide(opened, op);
      const els = (op.els as string[]) ?? [];
      const el: PptxElementLike = { id: "grp_" + nextSeq(), type: "group", members: els };
      slide.elements.push(el);
      return { op, created: [el.id] };
    }
    case "flipElements": {
      const { slide } = resolveSlide(opened, op);
      for (const id of (op.els as string[]) ?? []) {
        const el = slide.elements.find((x) => x.id === id);
        if (el) el.flip = op.axis;
      }
      return { op, after: { axis: op.axis } };
    }
    case "setTextAnchor": {
      const { el } = resolveElement(opened, op);
      el.anchor = op.anchor;
      return { op, after: { el: el.id } };
    }
    case "setTextBodyProps": {
      const { el } = resolveElement(opened, op);
      el.bodyProps = op.props;
      return { op, after: { el: el.id } };
    }
    case "alignElements": {
      const { slide } = resolveSlide(opened, op);
      for (const id of (op.els as string[]) ?? []) {
        const el = slide.elements.find((x) => x.id === id);
        if (el) el.aligned = op.mode;
      }
      return { op, after: { mode: op.mode } };
    }
    case "distributeElements": {
      const { slide } = resolveSlide(opened, op);
      for (const id of (op.els as string[]) ?? []) {
        const el = slide.elements.find((x) => x.id === id);
        if (el) el.distributed = op.axis;
      }
      return { op, after: { axis: op.axis } };
    }
    case "setNotes": {
      const { index } = resolveSlide(opened, op);
      const notes = (opened.__notes as Record<string, string>) ?? {};
      notes[String(index)] = String(op.text ?? "");
      opened.__notes = notes;
      return { op, after: { slide: index } };
    }
    case "addComment": {
      const { index } = resolveSlide(opened, op);
      const comments = (opened.__comments as Record<string, Array<Record<string, unknown>>>) ?? {};
      const list = comments[String(index)] ?? [];
      const ref = { authorId: 1, idx: list.length, author: op.author, text: op.text };
      list.push(ref);
      comments[String(index)] = list;
      opened.__comments = comments;
      return { op, after: ref };
    }
    case "deleteComment": {
      const { index } = resolveSlide(opened, op);
      const comments = (opened.__comments as Record<string, Array<Record<string, unknown>>>) ?? {};
      const list = comments[String(index)] ?? [];
      comments[String(index)] = list.filter((c) => !(c.authorId === op.authorId && c.idx === op.idx));
      opened.__comments = comments;
      return { op, after: { slide: index } };
    }
    case "applyHeaderFooter":
      opened.__headerFooter = op.settings as Record<string, unknown>;
      return { op, after: op.settings };
    case "insertSlidePptx": {
      const slides = opened.deck.slides;
      const at = typeof op.at === "number" ? op.at : slides.length;
      const inserted: PptxSlideLike = { id: "s_ins_" + nextSeq(), elements: [] };
      if (op.replace === true && at < slides.length) slides.splice(at, 1, inserted);
      else slides.splice(Math.max(0, Math.min(slides.length, at)), 0, inserted);
      return { op, created: [inserted.id as string], after: { index: at } };
    }
    case "addMedia": {
      const { slide } = resolveSlide(opened, op);
      const el: PptxElementLike = {
        id: "new_" + nextSeq(),
        type: "media",
        mediaKind: op.kind,
        transform: { offset: op.offset as { x: number; y: number; cx: number; cy: number } },
      };
      slide.elements.push(el);
      return { op, created: [el.id] };
    }
    case "addSmartArt": {
      const { slide } = resolveSlide(opened, op);
      const el: PptxElementLike = {
        id: "new_" + nextSeq(),
        type: "smartart",
        layout: op.layout,
        items: op.items,
        transform: { offset: op.offset as { x: number; y: number; cx: number; cy: number } },
      };
      slide.elements.push(el);
      return { op, created: [el.id] };
    }
    case "addModel3d": {
      const { slide } = resolveSlide(opened, op);
      const el: PptxElementLike = {
        id: "new_" + nextSeq(),
        type: "model3d",
        transform: { offset: op.offset as { x: number; y: number; cx: number; cy: number } },
      };
      slide.elements.push(el);
      return { op, created: [el.id] };
    }
    default:
      return undefined;
  }
}

export function validateWaveOp(opened: OpenedPptxLike, op: PptxOp): boolean {
  switch (op.op) {
    // Wave A/B (UNI-927): deck-level + slide-scoped kinds need no target check.
    case "applyTheme":
    case "setSlideSize":
    case "findReplace":
    case "addSection":
    case "renameSection":
    case "removeSection":
    case "moveSection":
    case "setSections":
      break;
    case "setBackground":
    case "setTransition":
    case "setAdvanceTime":
    case "setSlideLayout":
      resolveSlide(opened, op);
      break;
    case "addTable":
    case "addChart":
      resolveSlide(opened, op);
      if (!op.offset) throw new Error('op "' + op.op + '" needs "offset"');
      break;
    case "setTableCell":
    case "tableMerge":
    case "tableStructure":
    case "setTableRowHeight":
    case "setTableColWidth":
    case "setTableCellAnchor":
    case "setTableStyle":
    case "setChart":
    case "setLink":
      resolveElement(opened, op);
      break;
    case "setFont":
    case "setParagraphFormat":
    case "addAnimation":
      resolveElement(opened, op);
      break;
    case "removeAnimation":
      if (op.seq !== undefined) resolveSlide(opened, op);
      else resolveElement(opened, op);
      break;
    case "reorderAnimation":
    case "setAnimations":
      resolveSlide(opened, op);
      break;
    // Format/arrange (A4e), notes/comments (A5e), header/footer (B7e),
    // media (B8e).
    case "setFill":
    case "setStroke":
    case "setEffects":
    case "setShapeGeometry":
    case "setShapeAdjust":
    case "ungroupElement":
    case "setTextAnchor":
    case "setTextBodyProps":
      resolveElement(opened, op);
      break;
    case "addConnector":
    case "groupElements":
    case "flipElements":
    case "alignElements":
    case "distributeElements":
    case "setNotes":
    case "addComment":
    case "deleteComment":
      resolveSlide(opened, op);
      break;
    case "applyHeaderFooter":
      break;
    case "insertSlidePptx":
      if (!op.source || typeof (op.source as { slideXml?: unknown }).slideXml !== "string") {
        throw new Error('op "insertSlidePptx" needs a source with slideXml');
      }
      break;
    case "addMedia":
    case "addSmartArt":
    case "addModel3d":
      resolveSlide(opened, op);
      if (!op.offset) throw new Error('op "' + op.op + '" needs "offset"');
      break;
    default:
      return false;
  }
  return true;
}
