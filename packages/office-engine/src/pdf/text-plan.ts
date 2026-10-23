// Per-char style planning and the keep-plan that decides which matched text
// objects survive a rebuild untouched — ported verbatim from office-upstream
// apps/pdf/src/main/text-edit.ts.
import type { TextEditInput } from './types.ts'
import { SYNTHETIC_BOLD_STROKE_EM } from './types.ts'
import type { Pdfium } from './pdfium.ts'
import { foldMap } from './text-fold.ts'
import { indexOfUnits, readingOrder } from './text-match.ts'
import type { PageTextObj } from './text-match.ts'
/** Extra leading between stacked lines, multiple of the font size (matches the preview CSS) */
export const LINE_GAP = 1.2

export type Rgb = readonly [number, number, number]

/** Selection-level style of one planned char; every field absent = inherit the
    whole-edit override (newColor / newFont / newFontSize / newBold / newItalic),
    which in turn inherits the original run. */
export interface RunStyle {
  color?: Rgb
  font?: string
  size?: number
  bold?: boolean
  italic?: boolean
}

/** Identity key for segmentation — style objects are compared by value, not reference
    (overlaying preserved colors under user runs builds fresh objects per char) */
const styleKeyOf = (s: RunStyle | null): string =>
  s
    ? [
        s.color ? s.color.join(',') : '',
        s.font ?? '',
        s.size ?? '',
        s.bold === undefined ? '' : s.bold ? 1 : 0,
        s.italic === undefined ? '' : s.italic ? 1 : 0,
      ].join('|')
    : ''

/** True when the style needs its own face or size — such chars can never ride on a
    kept (merely translated) object; only pure fill overrides can. */
const styledBeyondColor = (s: RunStyle | null): boolean =>
  !!s &&
  (s.font !== undefined || s.size !== undefined || s.bold !== undefined || s.italic !== undefined)

/** The edit's selection-level runs: styleRuns, or legacy colorRuns from older senders */
export const editStyleRuns = (
  edit: Pick<TextEditInput, 'colorRuns' | 'styleRuns'>,
): NonNullable<TextEditInput['styleRuns']> | undefined => edit.styleRuns ?? edit.colorRuns

/** Per-code-unit segment styles for the engine's planned text, aligned from the user's
    newText through the NFKC fold: the splice swaps unedited codepoints back to engine
    variants and a fragment match wraps container text around the replacement, so raw
    offsets do not transfer. null = no run styling applies (or unalignable — the caller
    degrades to a uniform rebuild). */
export function plannedCharStyles(
  edit: Pick<TextEditInput, 'newText' | 'colorRuns' | 'styleRuns'>,
  plannedText: string,
): (RunStyle | null)[] | null {
  const runs = editStyleRuns(edit)
  if (!runs || runs.length === 0) return null
  const user = foldMap(edit.newText)
  const planned = foldMap(plannedText)
  const off = indexOfUnits(planned.units, user.units)
  if (off < 0) return null
  // One style object per run so same-run chars group by reference too
  const styles = runs.map((r): RunStyle => ({
    color: r.color,
    font: r.font,
    size: r.size,
    bold: r.bold,
    italic: r.italic,
  }))
  const styleAt = (i: number): RunStyle | null => {
    for (const [ri, r] of runs.entries()) if (i >= r.start && i < r.end) return styles[ri]!
    return null
  }
  const out: (RunStyle | null)[] = new Array<RunStyle | null>(plannedText.length).fill(null)
  for (let u = 0; u < user.units.length; u++) {
    const s = styleAt(user.idx[u]!)
    if (!s) continue
    const p = u + off
    for (let k = planned.idx[p]!; k < planned.end[p]!; k++) out[k] = s
  }
  // Whitespace carries no ink and no fold unit: attach it to the preceding char's
  // segment so a styled word keeps its trailing space
  for (let k = 1; k < out.length; k++) {
    if (out[k] === null && plannedText[k] !== '\n' && /\s/.test(plannedText[k]!)) {
      out[k] = out[k - 1]!
    }
  }
  return out.some((s) => s !== null) ? out : null
}

/** Per-code-unit fill colors of `targetText` inherited from the matched objects.
    The rebuild removes and repaints every matched object, so colors an earlier
    edit saved into the run (selection colors = one object per color) must ride
    along or the next edit silently flattens them to the anchor color. Alignment
    is by folded unit rank: the planned text keeps the engine's units for the
    unchanged head and tail, so common prefix/suffix units pair 1:1 with the
    engine's and inherit their object's color; the edited middle stays null (the
    base color, or the user's explicit runs overlaid by the caller). null when
    the matches all share one fill — nothing worth preserving. */
export function matchCharColors(
  m: Pdfium,
  matches: PageTextObj[],
  targetText: string,
): (Rgb | null)[] | null {
  if (matches.length < 2) return null
  const colPtr = m._malloc(16)
  const byKey = new Map<string, Rgb>()
  const colorOf = new Map<PageTextObj, Rgb | null>()
  try {
    for (const t of matches) {
      if (!m._FPDFPageObj_GetFillColor(t.obj, colPtr, colPtr + 4, colPtr + 8, colPtr + 12)) {
        colorOf.set(t, null)
        continue
      }
      const rgb = [0, 4, 8].map((off) => m.HEAPU8[colPtr + off]!) as unknown as Rgb
      const key = rgb.join(',')
      // Canonical instance per RGB so segmentLine's reference grouping merges
      // adjacent same-color spans that came from different objects
      const c = byKey.get(key) ?? rgb
      byKey.set(key, c)
      colorOf.set(t, c)
    }
  } finally {
    m._free(colPtr)
  }
  if (byKey.size <= 1) return null
  const engUnits: string[] = []
  const engColors: (Rgb | null)[] = []
  for (const t of readingOrder(matches)) {
    const units = foldMap(t.text).units
    const c = colorOf.get(t) ?? null
    for (const u of units) {
      engUnits.push(u)
      engColors.push(c)
    }
  }
  const tgt = foldMap(targetText)
  let p = 0
  const maxP = Math.min(tgt.units.length, engUnits.length)
  while (p < maxP && tgt.units[p] === engUnits[p]) p++
  let s = 0
  const maxS = maxP - p
  while (s < maxS && tgt.units[tgt.units.length - 1 - s] === engUnits[engUnits.length - 1 - s]) s++
  const shift = engUnits.length - tgt.units.length
  const out: (Rgb | null)[] = new Array<Rgb | null>(targetText.length).fill(null)
  let any = false
  for (let u = 0; u < tgt.units.length; u++) {
    const c = u < p ? engColors[u]! : u >= tgt.units.length - s ? engColors[u + shift]! : null
    if (!c) continue
    for (let k = tgt.idx[u]!; k < tgt.end[u]!; k++) out[k] = c
    any = true
  }
  return any ? out : null
}

/** User selection styles overlaid on the run's own preserved colors (a styled range
    without an explicit color keeps the preserved fill underneath); whitespace joins
    the preceding char's segment (it carries no ink of its own). */
export function overlayStyles(
  baseColors: (Rgb | null)[] | null,
  over: (RunStyle | null)[] | null,
  text: string,
): (RunStyle | null)[] | null {
  if (!baseColors && !over) return null
  const out: (RunStyle | null)[] = new Array<RunStyle | null>(text.length).fill(null)
  const colorOnly = new Map<Rgb, RunStyle>()
  for (let k = 0; k < text.length; k++) {
    const b = baseColors?.[k] ?? null
    const o = over?.[k] ?? null
    if (o) {
      out[k] = o.color === undefined && b ? { ...o, color: b } : o
    } else if (b) {
      let s = colorOnly.get(b)
      if (!s) colorOnly.set(b, (s = { color: b }))
      out[k] = s
    }
  }
  for (let k = 1; k < out.length; k++) {
    if (out[k] === null && text[k] !== '\n' && /\s/.test(text[k]!)) out[k] = out[k - 1]!
  }
  return out.some((s) => s !== null) ? out : null
}

export interface LineSeg {
  text: string
  style: RunStyle | null
  /** Text-space x of the segment start in PDF pt (each preceding segment measured
      with its own face and size) */
  xPt: number
}

/** Split one rebuilt line at style boundaries, positioning each segment by the advance
    of the text before it. `advancePt` measures one codepoint in text-space pt with the
    face and size that will actually draw it — from the loaded PDFium font, not the raw
    font bytes: embedded subsets routinely strip cmap/hmtx, which made a bytes-parsing
    measurement fail and silently discard the selection styling. A char that still
    cannot be measured degrades to a single base-style segment — a uniform line beats
    guessed positions. */
export function segmentLine(
  line: string,
  styles: (RunStyle | null)[] | null,
  advancePt: (cp: number, style: RunStyle | null) => number | null,
): LineSeg[] {
  const whole: LineSeg[] = [{ text: line, style: null, xPt: 0 }]
  if (!styles) return whole
  // Group per codepoint (advances count surrogate pairs once) by per-code-unit style
  const groups: { text: string; style: RunStyle | null; key: string }[] = []
  let cu = 0
  for (const ch of line) {
    const s = styles[cu] ?? null
    const key = styleKeyOf(s)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.text += ch
    else groups.push({ text: ch, style: s, key })
    cu += ch.length
  }
  if (groups.length <= 1) {
    return groups.length ? groups.map((g) => ({ text: g.text, style: g.style, xPt: 0 })) : whole
  }
  const segs: LineSeg[] = []
  let x = 0
  for (const g of groups) {
    segs.push({ text: g.text, style: g.style, xPt: x })
    for (const ch of g.text) {
      const a = advancePt(ch.codePointAt(0)!, g.style)
      if (a === null) return whole
      x += a
    }
  }
  return segs
}

/** One original text object the rebuild keeps (translated, not redrawn) */
export interface KeepPlanObj {
  src: PageTextObj
  /** Code-unit range in newText this object's characters cover */
  startK: number
  endK: number
  /** Advance width in page units (sum of the chars' loose boxes) */
  advW: number
  /** Original baseline origin of the first char (page space) */
  origX: number
  origY: number
  /** Fill override for the whole object; null = keep its own fill */
  color: Rgb | null
}

/** Signal to abandon the object-preserving build and fall back to a full redraw */
export class PreserveAbort extends Error {}

/** Detect whitespace edits at the boundaries of the user's change. The keep-plan
    alignment works on space-free folded units, so a space-only edit (deleting the
    gap in "phon e") changes no unit at all: every object would land in the common
    prefix/suffix, be kept verbatim, and be re-placed at its original spacing —
    silently undoing the edit (space chars the objects carry would survive too).
    Diff old/new with spaces kept; when the first (last) divergence sits on a space
    unit, report how many non-space units before (after) it may still be kept — one
    less than the full common run, so the glyph adjacent to the edited seam is
    redrawn, which closes/opens the gap and drops any removed space chars.
    Returns null when the texts are identical or no boundary touches whitespace. */
function wsEditClamp(
  oldText: string,
  newText: string,
): { headNS: number | null; tailNS: number | null } | null {
  const o = foldMap(oldText, true)
  const n = foldMap(newText, true)
  let pw = 0
  const maxPw = Math.min(o.units.length, n.units.length)
  while (pw < maxPw && o.units[pw] === n.units[pw]) pw++
  if (pw === o.units.length && pw === n.units.length) return null
  let sw = 0
  const maxSw = maxPw - pw
  while (sw < maxSw && o.units[o.units.length - 1 - sw] === n.units[n.units.length - 1 - sw]) sw++
  // Boundary units come from the diverging window only. A pure insertion leaves one
  // side's window empty (pw + sw covers it entirely); indexing that side would read
  // a RETAINED unit — a space in the unchanged prefix/suffix then faked a
  // "whitespace edit" and clamped the seam-adjacent glyph into the redraw, which
  // fails outright when that glyph is undrawable (PUA icon runs).
  const winUnit = (fm: { units: string[] }, i: number): string | undefined =>
    pw < fm.units.length - sw ? fm.units[i] : undefined
  const headWs = winUnit(o, pw) === ' ' || winUnit(n, pw) === ' '
  const tailWs =
    winUnit(o, o.units.length - 1 - sw) === ' ' || winUnit(n, n.units.length - 1 - sw) === ' '
  if (!headWs && !tailWs) return null
  const nonSpace = (units: string[], from: number, to: number) => {
    let c = 0
    for (let i = from; i < to; i++) if (units[i] !== ' ') c++
    return c
  }
  return {
    headNS: headWs ? nonSpace(o.units, 0, pw) - 1 : null,
    tailNS: tailWs ? nonSpace(o.units, o.units.length - sw, o.units.length) - 1 : null,
  }
}

/**
 * Which matched objects can survive the rebuild untouched. A full redraw flattens
 * mixed weights/faces into one located font — unrecoverable for Chrome-print docs
 * whose per-glyph Type3 fonts carry no metadata to even detect bold from. So align
 * the objects against the rebuilt text by folded unit rank and keep every object
 * whose characters all sit in the unchanged head/tail and land on one output line;
 * kept objects are merely translated, only the edited middle is redrawn. Geometry
 * comes from the pre-edit text page (char → object, loose-box advances).
 */
export function buildKeepPlan(
  m: Pdfium,
  textPage: number,
  matches: PageTextObj[],
  newText: string,
  charStyles: (RunStyle | null)[] | null,
  newColor: Rgb | undefined,
  edit: Pick<TextEditInput, 'oldText' | 'newText'>,
): KeepPlanObj[] | null {
  const charsOf = new Map<number, number[]>(matches.map((t) => [t.obj, []]))
  const total = m._FPDFText_CountChars(textPage)
  for (let i = 0; i < total; i++) {
    charsOf.get(m._FPDFText_GetTextObject(textPage, i))?.push(i)
  }
  const rectPtr = m._malloc(16)
  const xPtr = m._malloc(8)
  const yPtr = m._malloc(8)
  try {
    const ordered = readingOrder(matches)
    const engUnits: string[] = []
    const unitCount: number[] = []
    const geo: ({ origX: number; origY: number; advW: number } | null)[] = []
    for (const t of ordered) {
      const chars = charsOf.get(t.obj) ?? []
      let g: { origX: number; origY: number; advW: number } | null = null
      // The object's page chars must correspond 1:1 to its extracted codepoints,
      // or advance/origin attribution would silently drift. pdfium appends a
      // synthesized space to the extracted text when a layout gap follows the
      // object (the page char list carries only the real chars), so the trimmed
      // form is accepted too — critical for icon glyphs (PUA codepoints no
      // installed font could redraw), which otherwise land in the redraw text
      // and fail the whole edit on font coverage.
      const cpLen = [...t.text].length
      const trimmedCpLen = [...t.text.replace(/\s+$/, '')].length
      if (chars.length > 0 && (chars.length === cpLen || chars.length === trimmedCpLen)) {
        let advW = 0
        for (const ci of chars) {
          if (!m._FPDFText_GetLooseCharBox(textPage, ci, rectPtr)) {
            advW = NaN
            break
          }
          advW += m.HEAPF32[(rectPtr >> 2) + 2]! - m.HEAPF32[rectPtr >> 2]!
        }
        if (Number.isFinite(advW) && m._FPDFText_GetCharOrigin(textPage, chars[0]!, xPtr, yPtr)) {
          g = { origX: m.HEAPF64[xPtr >> 3]!, origY: m.HEAPF64[yPtr >> 3]!, advW }
        }
      }
      geo.push(g)
      const units = foldMap(t.text).units
      unitCount.push(units.length)
      engUnits.push(...units)
    }
    const tgt = foldMap(newText)
    let p = 0
    const maxP = Math.min(tgt.units.length, engUnits.length)
    while (p < maxP && tgt.units[p] === engUnits[p]) p++
    // Whitespace-only boundary edits change no fold unit, so p/s alone would keep
    // (and re-place at original spacing) the very objects whose gap the user edited.
    // Clamp the kept regions past the units adjacent to each whitespace-edited seam;
    // fragment matches align the user's units into the container's fold first (off).
    // The head clamp must land before the suffix scan: a space-only edit leaves the
    // unit sequences identical, p covers everything, and s would be capped at 0.
    const ws = wsEditClamp(edit.oldText, edit.newText)
    const oldUnits = ws ? foldMap(edit.oldText).units : []
    const off = !ws
      ? -1
      : engUnits.length === oldUnits.length
        ? 0
        : indexOfUnits(engUnits, oldUnits)
    if (ws && off >= 0 && ws.headNS !== null) p = Math.min(p, Math.max(0, off + ws.headNS))
    let s = 0
    const maxS = maxP - p
    while (s < maxS && tgt.units[tgt.units.length - 1 - s] === engUnits[engUnits.length - 1 - s])
      s++
    if (ws && off >= 0 && ws.tailNS !== null) {
      const extra = engUnits.length - off - oldUnits.length
      s = Math.min(s, Math.max(0, extra + ws.tailNS))
    }
    const shift = engUnits.length - tgt.units.length
    const out: KeepPlanObj[] = []
    let a = 0
    let prevEnd = -1
    for (const [oi, t] of ordered.entries()) {
      const b = a + unitCount[oi]!
      const g = geo[oi]
      const inPrefix = b <= p
      const inSuffix = a >= engUnits.length - s
      if (g && b > a && (inPrefix || inSuffix)) {
        const ua = inPrefix ? a : a - shift
        const startK = tgt.idx[ua]!
        const endK = tgt.end[(inPrefix ? b : b - shift) - 1]!
        if (startK >= prevEnd && endK > startK && !newText.slice(startK, endK).includes('\n')) {
          // Fill override must be uniform across the object, or it needs a split.
          // Face/size overrides can never apply to a kept object at all — a range
          // styled beyond color always redraws (color = undefined skips the keep).
          let color: Rgb | null | undefined = newColor ?? null
          if (!newColor && charStyles) {
            const colorKey = (k: number) => {
              const c = (charStyles[k] ?? null)?.color
              return c ? c.join(',') : ''
            }
            const first = charStyles[startK] ?? null
            color = first?.color ?? null
            for (let k = startK; k < endK; k++) {
              if (styledBeyondColor(charStyles[k] ?? null) || colorKey(k) !== colorKey(startK)) {
                color = undefined
                break
              }
            }
          }
          if (color !== undefined) {
            out.push({ src: t, startK, endK, advW: g.advW, origX: g.origX, origY: g.origY, color })
            prevEnd = endK
          }
        }
      }
      a = b
    }
    return out.length > 0 ? out : null
  } finally {
    for (const ptr of [rectPtr, xPtr, yPtr]) m._free(ptr)
  }
}

