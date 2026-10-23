// Text-object collection and edit matching — ported verbatim from
// office-upstream apps/pdf/src/main/text-edit.ts. Collects the page's text
// objects with engine-side bounds, splits same-baseline runs into z-layers,
// then matches an edit's (rect, oldText) against them.
import type { TextEditInput, TextEditValidation } from './types.ts'
import type { Pdfium } from './pdfium.ts'
import { FPDF_PAGEOBJ_TEXT } from './pdfium.ts'
import { foldMap, mergeEngineCodepoints, norm, spliceIntoEngine } from './text-fold.ts'
import { editStyleRuns } from './text-plan.ts'
import { chainLayers } from './x-layers.ts'
export interface PageTextObj {
  obj: number
  index: number
  text: string
  font: number
  /** [x1, y1, x2, y2] */
  bounds: [number, number, number, number]
}

export function collectTextObjects(m: Pdfium, page: number, textPage: number): PageTextObj[] {
  const out: PageTextObj[] = []
  const bl = m._malloc(4)
  const bb = m._malloc(4)
  const br = m._malloc(4)
  const bt = m._malloc(4)
  const count = m._FPDFPage_CountObjects(page)
  for (let i = 0; i < count; i++) {
    const obj = m._FPDFPage_GetObject(page, i)
    if (m._FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) continue
    // Two-pass read: FPDFTextObj_GetText's length argument and return value are BYTES
    // including the 2-byte NUL terminator, and a too-small buffer is left untouched
    // (not truncated) — a fixed buffer would silently yield garbage for long runs
    const len = m._FPDFTextObj_GetText(obj, textPage, 0, 0)
    let text = ''
    if (len > 2) {
      const buf = m._malloc(len)
      m._FPDFTextObj_GetText(obj, textPage, buf, len)
      text = Buffer.from(m.HEAPU8.buffer, buf, len - 2).toString('utf16le')
      m._free(buf)
    }
    if (!m._FPDFPageObj_GetBounds(obj, bl, bb, br, bt)) continue
    out.push({
      obj,
      index: i,
      text,
      font: m._FPDFTextObj_GetFont(obj),
      bounds: [m.HEAPF32[bl >> 2]!, m.HEAPF32[bb >> 2]!, m.HEAPF32[br >> 2]!, m.HEAPF32[bt >> 2]!],
    })
  }
  for (const p of [bl, bb, br, bt]) m._free(p)
  return out
}

type Rect = readonly [number, number, number, number]

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0])
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1])
  return w > 0 && h > 0 ? w * h : 0
}

/** Overlap area ÷ object area; edits address whole objects, so partial bleed from
    neighboring lines must not capture them */
const overlapRatio = (o: Rect, r: Rect) =>
  overlapArea(o, r) / Math.max((o[2] - o[0]) * (o[3] - o[1]), 1e-6)

/** Overlap area ÷ edit-rect area: how much of the edited span sits inside the object */
const rectCoverage = (o: Rect, r: Rect) =>
  overlapArea(o, r) / Math.max((r[2] - r[0]) * (r[3] - r[1]), 1e-6)

export function utf16Ptr(m: Pdfium, str: string): number {
  const bytes = Buffer.from(`${str}\0`, 'utf16le')
  const p = m._malloc(bytes.length)
  m.HEAPU8.set(bytes, p)
  return p
}

/** SetText re-encodes against the object's existing font. Only safe when the replacement
    is ASCII and every char is provably in the embedded subset (i.e. already drawn somewhere
    with the same font). CJK subset CID fonts fail even for in-subset chars (broken cmaps),
    so anything non-ASCII always goes the rebuild path. Style overrides, alignment offsets
    and multi-line replacements also rebuild: they need new objects (or a new matrix), not
    just re-encoded text. */
export function canReuseFont(
  edit: TextEditInput,
  newText: string,
  matches: PageTextObj[],
  all: PageTextObj[],
  whole: boolean,
): boolean {
  if (matches.length !== 1) return false
  if (edit.newFontSize !== undefined || edit.newColor !== undefined || edit.newFont !== undefined)
    return false
  // Selection-level styles split the line into several objects: always rebuild
  const runs = editStyleRuns(edit)
  if (runs && runs.length > 0) return false
  // Centered/right blocks reposition every line: SetText keeps the object's own
  // matrix, so a shorter replacement would stay at the old x instead of re-centering
  if (edit.lineXOffsets !== undefined) return false
  // Italic swaps the face: the object's existing font cannot draw it. Bold on the
  // original face is a stroke on the object itself — but only when the object IS the
  // edited text, else the untouched rest of the container would embolden too
  if (edit.newItalic || (edit.newBold && (edit.newFont || !whole))) return false
  if (!/^[\x20-\x7e]*$/.test(newText)) return false
  const font = matches[0]!.font
  const charset = new Set<string>()
  for (const o of all) if (o.font === font) for (const ch of o.text) charset.add(ch)
  return [...newText].every((ch) => ch === ' ' || charset.has(ch))
}

/** The text objects an edit resolves to, plus the full replacement for them
    (fragment edits expand to the container object's text with the fragment spliced in) */
export interface PlannedMatch {
  matches: PageTextObj[]
  newText: string
  /** True when the matched objects ARE the edited text (not a fragment of a larger
      run); only then may position overrides (origin/lineLeading) be honored */
  whole: boolean
}

/** Split same-baseline objects into z-stacked layers: an earlier multi-line edit that
    overflowed onto the next line leaves two runs drawn over each other, and a whole-line
    rect then captures both. Objects joining one visual line never overlap horizontally,
    so chaining by x-extent recovers the individual layers. */
function xLayers(objs: PageTextObj[]): PageTextObj[][] {
  const sorted = [...objs].sort((a, b) => a.bounds[0] - b.bounds[0])
  const heights = sorted.map((o) => o.bounds[3] - o.bounds[1]).sort((a, b) => a - b)
  const tieMargin = (heights[heights.length >> 1] ?? 0) * 0.5
  const assign = chainLayers(
    sorted.map((o) => ({ left: o.bounds[0], right: o.bounds[2] })),
    tieMargin,
  )
  const layers: PageTextObj[][] = []
  sorted.forEach((o, i) => {
    ;(layers[assign[i]!] ??= []).push(o)
  })
  return layers
}

/** Subarray search over folded units (indexOf on joined strings would return UTF-16
    offsets, which drift from unit offsets on astral codepoints) */
export function indexOfUnits(hay: string[], needle: string[]): number {
  if (needle.length === 0) return -1
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/** Joined text of a candidate object set, x-order (how the renderer reads a line) */
const joinX = (objs: PageTextObj[]) =>
  [...objs]
    .sort((a, b) => a.bounds[0] - b.bounds[0])
    .map((o) => o.text)
    .join('')

/** Objects in visual reading order — rows top→bottom (≥50% vertical overlap joins
    a row), x within each row. How a multi-line paragraph edit reads its lines; plain
    x-order interleaves them and stream order is not guaranteed. */
export function readingOrder(objs: PageTextObj[]): PageTextObj[] {
  const sorted = [...objs].sort((a, b) => b.bounds[3] - a.bounds[3])
  const rows: PageTextObj[][] = []
  for (const o of sorted) {
    const row = rows[rows.length - 1]
    const first = row?.[0]
    const overlap = first
      ? Math.min(first.bounds[3], o.bounds[3]) - Math.max(first.bounds[1], o.bounds[1])
      : 0
    if (
      first &&
      overlap >= 0.5 * Math.min(first.bounds[3] - first.bounds[1], o.bounds[3] - o.bounds[1])
    ) {
      row.push(o)
    } else rows.push([o])
  }
  return rows.flatMap((row) => [...row].sort((a, b) => a.bounds[0] - b.bounds[0]))
}

export const joinRows = (objs: PageTextObj[]): string =>
  readingOrder(objs)
    .map((o) => o.text)
    .join('')

/**
 * Text-first rescue: the rect is only a hint here, not a filter. The renderer's rect
 * comes from pdf.js layout boxes, which can sit a few points inside the engine's ink
 * bounds — on a line built from many text objects the edge objects then fail the
 * primary path's ≥50%-containment test and the whole-line join never equals oldText.
 * Instead, order every object merely touching a slightly padded rect by reading order,
 * search their joined folded units for oldText's units, and pick the occurrence whose
 * union bounds best overlap the edit rect (disambiguates repeated text; bleed from
 * neighboring lines falls outside the occurrence and is skipped naturally). The match
 * may start or end mid-object — the uncovered head/tail of the edge objects is kept
 * verbatim around the replacement, like the single-container fragment path.
 */
function matchByText(objects: PageTextObj[], edit: TextEditInput): PlannedMatch | null {
  const target = foldMap(edit.oldText)
  if (target.units.length === 0) return null
  const pad = Math.max(2, edit.fontSize * 0.2)
  const r: Rect = [edit.rect[0] - pad, edit.rect[1] - pad, edit.rect[2] + pad, edit.rect[3] + pad]
  const touching = readingOrder(objects.filter((o) => overlapArea(o.bounds, r) > 0))
  if (touching.length === 0) return null
  const joined = touching.map((o) => o.text).join('')
  const eng = foldMap(joined)
  // Which object each folded unit came from, plus each object's raw span in `joined`
  // (per-object folds concatenate to the joined fold: folding is per-character)
  const objAt: number[] = []
  const rawStartOf: number[] = []
  const rawEndOf: number[] = []
  let rawOff = 0
  for (const [i, o] of touching.entries()) {
    rawStartOf.push(rawOff)
    rawOff += o.text.length
    rawEndOf.push(rawOff)
    for (let k = foldMap(o.text).units.length; k > 0; k--) objAt.push(i)
  }
  let best: { at: number; score: number } | null = null
  let at = indexOfUnits(eng.units, target.units)
  while (at >= 0) {
    const endU = at + target.units.length - 1
    const set = touching.slice(objAt[at]!, objAt[endU]! + 1)
    const b = matchBounds(set)
    const score = overlapArea(b, edit.rect) / Math.max((b[2] - b[0]) * (b[3] - b[1]), 1e-6)
    if (score > 0 && (!best || score > best.score)) best = { at, score }
    const next = indexOfUnits(eng.units.slice(at + 1), target.units)
    at = next < 0 ? -1 : at + 1 + next
  }
  if (!best) return null
  const endU = best.at + target.units.length - 1
  const set = touching.slice(objAt[best.at]!, objAt[endU]! + 1)
  // Raw text the matched objects contribute, and the matched stretch inside it
  const setStart = rawStartOf[objAt[best.at]!]!
  const setEnd = rawEndOf[objAt[endU]!]!
  const setRaw = joined.slice(setStart, setEnd)
  const rawStart = eng.idx[best.at]!
  // End of the last matched unit, not the next unit's start: the gap between them is
  // boundary whitespace belonging to the untouched suffix (see the container path)
  const rawEnd = eng.end[endU]!
  const whole = norm(setRaw) === norm(edit.oldText)
  if (whole) {
    return {
      matches: set,
      newText:
        edit.newText === ''
          ? ''
          : edit.lineLeading !== undefined
            ? mergeEngineCodepoints(setRaw, edit.oldText, edit.newText)
            : spliceIntoEngine(setRaw, edit.oldText, edit.newText),
      whole: true,
    }
  }
  // Paragraph rebuilds position their lines at the block corner (origin/lineLeading);
  // apply strips those overrides from fragment matches, which would rebuild the block
  // at the anchor and drag the edge objects' surrounding text into the block run.
  // Fail closed like before instead of degrading the layout silently.
  if (edit.origin !== undefined || edit.lineLeading !== undefined) return null
  const fragment = spliceIntoEngine(joined.slice(rawStart, rawEnd), edit.oldText, edit.newText)
  return {
    matches: set,
    newText: joined.slice(setStart, rawStart) + fragment + joined.slice(rawEnd, setEnd),
    whole: false,
  }
}

/**
 * Resolve an edit to concrete text objects. Primary rule: objects sitting mostly inside
 * the edit's rect whose joined text equals oldText — tried in content-stream order, then
 * x-order, then per x-layer (stacked runs from an earlier overflowing edit). Fallback for
 * granularity mismatches (pdf.js splits one PDF text object into several spans at column
 * gaps / kerning breaks): a single object containing most of the rect gets the fragment
 * spliced into its text — the whole object is then rewritten, so surrounding text
 * survives with the new content. Last resort is matchByText: a text-first search over
 * objects merely touching the rect, rescuing rects that clip edge objects below the
 * containment threshold. All comparisons are NFKC-folded (norm) and the replacement
 * is spliced against the engine's own text to keep unedited codepoints.
 */
export function matchEdit(objects: PageTextObj[], edit: TextEditInput): PlannedMatch | { reason: string } {
  // A replacement with no printable characters deletes the matched run: normalize
  // whitespace-only forms to '' so the splice helpers (which treat '\n' structurally)
  // never see them and the apply path removes the objects without drawing anything back
  if (edit.newText.trim() === '' && edit.newText !== '') edit = { ...edit, newText: '' }
  const oldKey = norm(edit.oldText)
  const matches = objects.filter((o) => overlapRatio(o.bounds, edit.rect) >= 0.5)
  const candidates: PageTextObj[][] = [matches]
  if (matches.length > 1) candidates.push(...xLayers(matches))
  for (const set of candidates) {
    if (set.length === 0) continue
    const streamJoin = set.map((o) => o.text).join('')
    for (const joined of [streamJoin, joinX(set), joinRows(set)]) {
      if (norm(joined) === oldKey) {
        return {
          matches: set,
          // Paragraph rebuilds keep newText's line/space structure (engine text has
          // none at line seams); single-run edits keep the engine's raw text
          newText:
            edit.newText === ''
              ? ''
              : edit.lineLeading !== undefined
                ? mergeEngineCodepoints(joined, edit.oldText, edit.newText)
                : spliceIntoEngine(joined, edit.oldText, edit.newText),
          whole: true,
        }
      }
    }
  }
  const container = objects
    .map((o) => ({ o, cover: rectCoverage(o.bounds, edit.rect) }))
    .filter((c) => c.cover >= 0.5)
    .sort((a, b) => b.cover - a.cover)[0]?.o
  if (container) {
    const raw = container.text
    const eng = foldMap(raw)
    const target = foldMap(edit.oldText)
    const at = indexOfUnits(eng.units, target.units)
    if (at >= 0) {
      const rawStart = eng.idx[at]!
      // Slice to the END of the last matched unit, not the next unit's start: the gap
      // between them is boundary whitespace that belongs to the untouched suffix. Folding
      // it into the fragment let a style-only edit (oldText === newText) eat the space —
      // spliceIntoEngine's retained suffix is empty then, so the gap survived nowhere.
      const rawEnd = eng.end[at + target.units.length - 1]!
      const fragment = spliceIntoEngine(raw.slice(rawStart, rawEnd), edit.oldText, edit.newText)
      return {
        matches: [container],
        newText: raw.slice(0, rawStart) + fragment + raw.slice(rawEnd),
        whole: false,
      }
    }
  }
  const rescued = matchByText(objects, edit)
  if (rescued) return rescued
  return { reason: 'the edited text could not be located on the page' }
}

export function matchBounds(matches: PageTextObj[]): [number, number, number, number] {
  return matches
    .slice(1)
    .reduce(
      (u, t) => [
        Math.min(u[0], t.bounds[0]),
        Math.min(u[1], t.bounds[1]),
        Math.max(u[2], t.bounds[2]),
        Math.max(u[3], t.bounds[3]),
      ],
      [...matches[0]!.bounds] as [number, number, number, number],
    )
}

