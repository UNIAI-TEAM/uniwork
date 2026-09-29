// Text comparison/fold machinery — ported verbatim from office-upstream
// apps/pdf/src/main/text-edit.ts. Engine-extracted text and caller-supplied
// oldText disagree on compatibility codepoints (radical-block variants,
// synthesized spaces, NFKC folds); every match and splice goes through these
// folds so both sides land on the same key.
import { foldRadicals } from './radicals.ts'
export const norm = (s: string) => foldRadicals(s).normalize('NFKC').replace(/\s+/g, '')

/** NFKC-fold `raw` keeping maps from each folded unit back to its source char's start
    and end index. Whitespace runs collapse to one ' ' unit when keepSpaces, else
    disappear. */
export function foldMap(
  raw: string,
  keepSpaces = false,
): { units: string[]; idx: number[]; end: number[] } {
  const units: string[] = []
  const idx: number[] = []
  const end: number[] = []
  let i = 0
  let inWs = false
  for (const ch of raw) {
    if (/\s/.test(ch)) {
      if (keepSpaces && !inWs) {
        units.push(' ')
        idx.push(i)
        end.push(i + ch.length)
      }
      inWs = true
    } else {
      inWs = false
      for (const u of foldRadicals(ch).normalize('NFKC')) {
        if (/\s/.test(u)) continue
        units.push(u)
        idx.push(i)
        end.push(i + ch.length)
      }
    }
    i += ch.length
  }
  idx.push(raw.length)
  return { units, idx, end }
}

/** Splice the user's replacement into the engine's own text: the untouched prefix and
    suffix keep the engine's original codepoints (writing back pdf.js-extracted variants
    would silently transliterate unedited text), only the changed middle comes from
    newText as typed. Boundary whitespace retained on both sides follows the engine —
    a renderer-synthesized gap space must not become a real space in the rebuilt run.
    Precondition: norm(engineRaw) === norm(oldText). */
export function spliceIntoEngine(engineRaw: string, oldText: string, newText: string): string {
  const oldK = foldMap(oldText, true)
  const newK = foldMap(newText, true)
  const eng = foldMap(engineRaw)
  // Common prefix/suffix of old vs new in space-keeping folded units
  let p = 0
  const maxP = Math.min(oldK.units.length, newK.units.length)
  while (p < maxP && oldK.units[p] === newK.units[p]) p++
  let s = 0
  const maxS = maxP - p
  while (
    s < maxS &&
    oldK.units[oldK.units.length - 1 - s] === newK.units[newK.units.length - 1 - s]
  )
    s++
  // Multi-line replacements (block reflow) must not take the plain prefix/suffix cut:
  // the retained regions would come from the engine join, which has no '\n's and no
  // separator chars between joined line objects, so the reflow's line breaks (and
  // Latin between-line spaces) would vanish and rebuildRun would draw one overflowing
  // line. Rebuild line by line instead.
  if (newText.includes('\n')) return spliceLines(engineRaw, eng, newK, p, s, newText)
  const nonSpace = (units: string[]) => units.filter((u) => u !== ' ').length
  // Map retained counts onto the engine's space-free fold; back off while a cut would
  // split a raw char whose fold expanded to several units (ligatures)
  for (;;) {
    const np = nonSpace(oldK.units.slice(0, p))
    const ns = nonSpace(oldK.units.slice(oldK.units.length - s))
    const splitsEng =
      (np > 0 && eng.idx[np] === eng.idx[np - 1]) ||
      (ns > 0 && eng.idx[eng.units.length - ns] === eng.idx[eng.units.length - ns - 1])
    const splitsNew =
      (p > 0 && newK.idx[p] === newK.idx[p - 1]) ||
      (s > 0 && newK.idx[newK.units.length - s] === newK.idx[newK.units.length - s - 1])
    if (!splitsEng && !splitsNew) {
      // Retained boundary space (present in old and new alike): cut past it on the
      // engine side so the engine's own spacing survives, and start the typed middle
      // after new's copy of it. A non-space boundary cuts right at the char edge.
      const prefixEndsSpace = p > 0 && oldK.units[p - 1] === ' '
      const suffixStartsSpace = s > 0 && oldK.units[oldK.units.length - s] === ' '
      const engPrefixEnd = p === 0 ? 0 : prefixEndsSpace ? eng.idx[np]! : eng.end[np - 1]!
      const engSuffixStart =
        s === 0
          ? engineRaw.length
          : suffixStartsSpace || ns === 0
            ? eng.end[eng.units.length - ns - 1]!
            : eng.idx[eng.units.length - ns]!
      return (
        engineRaw.slice(0, engPrefixEnd) +
        newText.slice(newK.idx[p]!, newK.idx[newK.units.length - s]!) +
        engineRaw.slice(engSuffixStart)
      )
    }
    if (p > 0) p--
    else if (s > 0) s--
    else return newText
  }
}

/** Per-line splice for multi-line replacements: each line of newText whose folded
    units all sit inside the retained prefix/suffix is rebuilt from the engine's own
    codepoints, every other line stays as typed. `p`/`s` are the unit counts of the
    old↔new common prefix/suffix from spliceIntoEngine. */
function spliceLines(
  engineRaw: string,
  eng: ReturnType<typeof foldMap>,
  newK: ReturnType<typeof foldMap>,
  p: number,
  s: number,
  newText: string,
): string {
  // The engine fold keeps no spaces, so every unit is non-space and the engine's
  // non-space unit count matches oldText's (norm-equality precondition)
  const E = eng.units.length
  const nsPos: number[] = [] // newK unit index of each non-space unit, by rank
  for (let k = 0; k < newK.units.length; k++) if (newK.units[k] !== ' ') nsPos.push(k)
  const N = nsPos.length
  const out: string[] = []
  let k = 0 // walking unit cursor in newK
  let rank = 0 // non-space units consumed so far
  let off = 0 // raw offset of the current line in newText
  for (const line of newText.split('\n')) {
    const lineEnd = off + line.length
    // Skip the collapsed whitespace unit of the preceding '\n' (attributed to neither line)
    while (k < newK.units.length && newK.idx[k]! < off) {
      if (newK.units[k] !== ' ') rank++
      k++
    }
    const kStart = k
    const g1 = rank
    while (k < newK.units.length && newK.idx[k]! < lineEnd) {
      if (newK.units[k] !== ' ') rank++
      k++
    }
    const g2 = rank
    off = lineEnd + 1
    const inPrefix = k <= p
    const inSuffix = kStart >= newK.units.length - s
    if (g2 === g1 || (!inPrefix && !inSuffix)) {
      out.push(line)
      continue
    }
    // Prefix units map 1:1 onto engine ranks; suffix units sit `E - N` ranks later
    const shift = inPrefix ? 0 : E - N
    out.push(engineLineText(engineRaw, eng, nsPos, g1 + shift, g2 + shift, g1) ?? line)
  }
  return out.join('\n')
}

/** Engine-raw text for engine unit ranks [e1, e2); null when the line boundary would
    split a raw char whose fold expanded to several units (ligatures). `g1` is the
    new-text rank of e1, used to restore spaces the engine's line join ran together. */
function engineLineText(
  engineRaw: string,
  eng: ReturnType<typeof foldMap>,
  nsPos: number[],
  e1: number,
  e2: number,
  g1: number,
): string | null {
  if (e1 > 0 && eng.idx[e1]! < eng.end[e1 - 1]!) return null
  if (e2 < eng.units.length && eng.idx[e2]! < eng.end[e2 - 1]!) return null
  let out = ''
  for (let e = e1; e < e2; e++) {
    if (e > e1) {
      if (eng.idx[e]! < eng.end[e - 1]!) continue // same raw char (fold expansion)
      const gap = engineRaw.slice(eng.end[e - 1]!, eng.idx[e]!)
      out += gap
      // The new text separates these units but the engine join put nothing between
      // them (adjacent line objects): a reflow moved a word across the old break, so
      // restore the space the visual line break used to stand for
      const g = g1 + (e - e1)
      if (!/\s/.test(gap) && nsPos[g]! - nsPos[g - 1]! > 1) out += ' '
    }
    out += engineRaw.slice(eng.idx[e]!, eng.end[e]!)
  }
  return out
}

/** Rebuild a paragraph replacement keeping the engine's own codepoints for the
    unchanged head and tail. spliceIntoEngine keeps the engine's raw text (per-line
    for multi-line replacements) — right for single-run edits, wrong for paragraphs:
    engine text joined across a block's objects carries no spaces or breaks at line
    seams, so an unchanged head/tail would collapse the reflowed lines and glue seam
    words together. Here newText's whitespace and '\n' structure survive in full;
    only the non-space codepoints of the unchanged units are swapped back to the
    engine's (Kangxi-radical extraction variants must not be written back).
    Precondition: norm(engineRaw) === norm(oldText). */
export function mergeEngineCodepoints(engineRaw: string, oldText: string, newText: string): string {
  const oldU = foldMap(oldText)
  const newU = foldMap(newText)
  const eng = foldMap(engineRaw)
  if (eng.units.length !== oldU.units.length) return newText
  let p = 0
  const maxP = Math.min(oldU.units.length, newU.units.length)
  while (p < maxP && oldU.units[p] === newU.units[p]) p++
  let s = 0
  const maxS = maxP - p
  while (
    s < maxS &&
    oldU.units[oldU.units.length - 1 - s] === newU.units[newU.units.length - 1 - s]
  )
    s++
  // Back off boundaries that would split a raw char whose fold expanded to several
  // units (ligatures): emitting the engine's whole glyph for a partially-retained
  // unit span would keep an extra letter or drop a typed one
  const splits = (fm: ReturnType<typeof foldMap>, i: number) =>
    i > 0 && i < fm.units.length && fm.idx[i]! < fm.end[i - 1]!
  while (p > 0 && (splits(eng, p) || splits(newU, p))) p--
  while (s > 0 && (splits(eng, eng.units.length - s) || splits(newU, newU.units.length - s))) s--
  const total = newU.units.length
  const engShift = eng.units.length - total
  let out = ''
  let k = 0
  let engEnd = 0
  for (const ch of newText) {
    if (/\s/.test(ch)) {
      out += ch
      continue
    }
    const m = [...ch.normalize('NFKC')].filter((u) => !/\s/.test(u)).length
    if (m === 0) {
      out += ch
      continue
    }
    const inPrefix = k + m <= p
    const inSuffix = k >= total - s
    if (inPrefix || inSuffix) {
      const at = inPrefix ? k : k + engShift
      const rawStart = eng.idx[at]!
      const rawEnd = eng.end[at + m - 1]!
      // Overlap guard: an engine ligature spans several units; emit its raw char once
      out += engineRaw.slice(Math.max(rawStart, engEnd), rawEnd)
      engEnd = Math.max(engEnd, rawEnd)
    } else {
      out += ch
    }
    k += m
  }
  return out
}

