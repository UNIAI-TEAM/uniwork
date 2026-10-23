// Font resolution for rebuilt runs — ported verbatim from office-upstream
// apps/pdf/src/main/text-edit.ts, with the bundled-font index (this repo's
// assets/fonts, grafted in sfnt.ts) standing in for a machine's installed
// fonts. The engine container ships no system fonts, so the bundled OFL
// faces are what make rebuilds possible there.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bundledFontDir } from './pdfium.ts'
import { fontCoversText } from './font-cmap.ts'
import { findFontCovering, findSystemFont, isTruetype } from './font-locate.ts'
import { identityCffCharset, subsetTtf } from './font-subset.ts'
import type { Pdfium } from './pdfium.ts'
import {
  FPDF_FONT_TRUETYPE,
  FPDF_LINEJOIN_ROUND,
  FPDF_TEXTRENDERMODE_FILL_STROKE,
  FPDF_TEXTRENDERMODE_FILL_STROKE_CLIP,
} from './pdfium.ts'
import type { TextEditInput } from './types.ts'
import { SYNTHETIC_BOLD_STROKE_EM } from './types.ts'
/** Fallback font files for rebuilt runs, tried first; must be single-face sfnt (no .ttc).
    arialuni.ttf only exists where legacy Office installed it — modern Windows relies on
    the system-face lookup below (inserted text has no original font to inherit, so a
    missing fallback used to fail EVERY Insert Text save on Windows). */
const FALLBACK_FONT_PATHS = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  'C:\\Windows\\Fonts\\arialuni.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]

/** [PostScript name, family] fallbacks resolved through the installed-font index
    (which extracts single faces from .ttc collections). Latin faces lead so plain
    Latin text keeps a neutral look; CJK/Hangul faces follow and win only when the
    text needs their coverage (each candidate is coverage-gated). */
const FALLBACK_SYSTEM_FACES: readonly (readonly [string, string])[] = [
  ['ArialMT', 'Arial'],
  ['SegoeUI', 'Segoe UI'],
  ['Helvetica', 'Helvetica'],
  ['MicrosoftYaHei', 'Microsoft YaHei'],
  ['SimSun', 'SimSun'],
  ['PingFangSC-Regular', 'PingFang SC'],
  ['HiraginoSans-W3', 'Hiragino Sans'],
  ['YuGothic-Regular', 'Yu Gothic'],
  ['MSGothic', 'MS Gothic'],
  ['MalgunGothic', 'Malgun Gothic'],
  ['AppleSDGothicNeo-Regular', 'Apple SD Gothic Neo'],
  ['NotoSansCJKsc-Regular', 'Noto Sans CJK SC'],
  ['DejaVuSans', 'DejaVu Sans'],
  ['LiberationSans-Regular', 'Liberation Sans'],
]

const fallbackPathCache = new Map<string, Buffer | null>()

function readFallbackPath(p: string): Buffer | null {
  let bytes = fallbackPathCache.get(p)
  if (bytes === undefined) {
    try {
      bytes = readFileSync(p)
    } catch {
      bytes = null
    }
    fallbackPathCache.set(p, bytes)
  }
  return bytes
}

/** First fallback face whose cmap covers `drawn`; when no curated candidate does,
    scan the whole installed-font index — the browser preview resolves per-char
    fallback across every installed font, so text the user already SEES must find
    an embeddable face too. Null only when nothing monochrome covers the text
    (color-emoji faces display but cannot embed as PDF text). */
function fallbackFontFor(drawn: string): Buffer | null {
  for (const p of FALLBACK_FONT_PATHS) {
    const bytes = readFallbackPath(p)
    if (bytes && fontCoversText(bytes, drawn)) return bytes
  }
  for (const [ps, family] of FALLBACK_SYSTEM_FACES) {
    const bytes = findSystemFont(ps, family)
    if (bytes && fontCoversText(bytes, drawn)) return bytes
  }
  return findFontCovering(drawn)
}

type EditFontStyle = 'regular' | 'bold' | 'italic' | 'bolditalic'

/** Font files for the user-selectable rebuild fonts by style, first readable wins
    (single-face sfnt only) */
const EDIT_FONT_PATHS: Record<string, Record<EditFontStyle, string[]>> = {
  arial: {
    regular: [
      '/System/Library/Fonts/Supplemental/Arial.ttf',
      'C:\\Windows\\Fonts\\arial.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ],
    bold: [
      '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
      'C:\\Windows\\Fonts\\arialbd.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    ],
    italic: [
      '/System/Library/Fonts/Supplemental/Arial Italic.ttf',
      'C:\\Windows\\Fonts\\ariali.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf',
    ],
    bolditalic: [
      '/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf',
      'C:\\Windows\\Fonts\\arialbi.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf',
    ],
  },
  times: {
    regular: [
      '/System/Library/Fonts/Supplemental/Times New Roman.ttf',
      'C:\\Windows\\Fonts\\times.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
    ],
    bold: [
      '/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf',
      'C:\\Windows\\Fonts\\timesbd.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf',
    ],
    italic: [
      '/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf',
      'C:\\Windows\\Fonts\\timesi.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf',
    ],
    bolditalic: [
      '/System/Library/Fonts/Supplemental/Times New Roman Bold Italic.ttf',
      'C:\\Windows\\Fonts\\timesbi.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSerif-BoldItalic.ttf',
    ],
  },
  courier: {
    regular: [
      '/System/Library/Fonts/Supplemental/Courier New.ttf',
      'C:\\Windows\\Fonts\\cour.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
    ],
    bold: [
      '/System/Library/Fonts/Supplemental/Courier New Bold.ttf',
      'C:\\Windows\\Fonts\\courbd.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf',
    ],
    italic: [
      '/System/Library/Fonts/Supplemental/Courier New Italic.ttf',
      'C:\\Windows\\Fonts\\couri.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationMono-Italic.ttf',
    ],
    bolditalic: [
      '/System/Library/Fonts/Supplemental/Courier New Bold Italic.ttf',
      'C:\\Windows\\Fonts\\courbi.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationMono-BoldItalic.ttf',
    ],
  },
}

/** Bundled faces for edit-font ids the container cannot source from the OS.
    'noto' is always resolvable — the OFL Noto Sans faces ship in the package
    assets (and the image's UNIWORK_PDF_ASSETS dir), Vietnamese coverage
    included. Italic styles fall back to Regular (no italic face bundled). */
const BUNDLED_EDIT_FONTS: Record<string, Partial<Record<EditFontStyle, string>>> = {
  noto: { regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf' },
}

const editFontCache = new Map<string, Buffer | null>()

function loadEditFont(id: string, style: EditFontStyle = 'regular'): Buffer | null {
  const key = `${id}#${style}`
  let cached = editFontCache.get(key)
  if (cached === undefined) {
    cached = null
    const bundledName = BUNDLED_EDIT_FONTS[id]?.[style] ?? BUNDLED_EDIT_FONTS[id]?.regular
    if (bundledName) {
      const dir = bundledFontDir()
      if (dir) {
        try {
          cached = readFileSync(join(dir, bundledName))
        } catch {
          /* fall through to OS paths */
        }
      }
    }
    if (!cached) {
      for (const p of EDIT_FONT_PATHS[id]?.[style] ?? []) {
        try {
          cached = readFileSync(p)
          break
        } catch {
          /* try next */
        }
      }
    }
    editFontCache.set(key, cached)
  }
  return cached
}

/** Edit-font ids that resolve to a readable font file on this machine */
function listEditFonts(): string[] {
  return [...new Set([...Object.keys(EDIT_FONT_PATHS), ...Object.keys(BUNDLED_EDIT_FONTS)])].filter(
    (id) => loadEditFont(id) !== null,
  )
}

/** Can this machine draw `text` into the PDF at all? Mirrors rebuildFontBytes'
    resolution for an insert (the chosen edit font, else any fallback face), so the
    renderer can reject an undrawable insert at confirm time instead of at save. */
function canDrawText(text: string, font?: string, bold = false, italic = false): boolean {
  const drawn = text.replace(/\n/g, '')
  if (font) {
    const style: EditFontStyle =
      bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'regular'
    for (const s of style === 'regular' ? (['regular'] as const) : ([style, 'regular'] as const)) {
      const bytes = loadEditFont(font, s)
      if (bytes && fontCoversText(bytes, drawn)) return true
    }
  }
  return fallbackFontFor(drawn) !== null
}

/** Whitespace-insensitive, radical- and NFKC-folded comparison key. pdf.js and pdfium
    disagree on compatibility codepoints — some fonts' cmaps yield radical-block
    codepoints (Kangxi U+2F00, which NFKC decomposes, and the Radicals Supplement
    U+2E80, which it does not) where pdfium extracts unified ideographs — and on
    synthesized spaces; both engines' text must land on the same key or every
    whole-line match fails on such documents. */
const readHeapU32 = (m: Pdfium, ptr: number) =>
  m.HEAPU8[ptr]! +
  m.HEAPU8[ptr + 1]! * 0x100 +
  m.HEAPU8[ptr + 2]! * 0x10000 +
  m.HEAPU8[ptr + 3]! * 0x1000000

/** Decoded font-program bytes of an embedded font, null when not embedded/readable */
function embeddedFontData(m: Pdfium, font: number): Buffer | null {
  if (!font || !m._FPDFFont_GetIsEmbedded(font)) return null
  const lenPtr = m._malloc(4)
  try {
    if (!m._FPDFFont_GetFontData(font, 0, 0, lenPtr)) return null
    const len = readHeapU32(m, lenPtr)
    if (!len) return null
    const buf = m._malloc(len)
    try {
      if (!m._FPDFFont_GetFontData(font, buf, len, lenPtr)) return null
      return Buffer.from(m.HEAPU8.subarray(buf, buf + len))
    } finally {
      m._free(buf)
    }
  } finally {
    m._free(lenPtr)
  }
}

/** UTF-8 string via a two-pass FPDFFont_Get*Name call (returned length includes the NUL) */
function fontString(m: Pdfium, read: (buf: number, len: number) => number): string {
  const len = read(0, 0)
  if (len <= 1) return ''
  const buf = m._malloc(len)
  try {
    read(buf, len)
    return Buffer.from(m.HEAPU8.subarray(buf, buf + len - 1)).toString()
  } finally {
    m._free(buf)
  }
}

/** Rebuild font plus whether bold must be synthesized by stroking. A bold toggle on
    "keep original" never swaps the face: the same glyphs with a thin same-color
    stroke keep every advance, so the surrounding layout survives (a bold face file
    reflows the line). Only an explicit edit-font choice loads a real bold variant. */
export async function resolveRebuildFont(
  m: Pdfium,
  font: number,
  edit: TextEditInput,
  newText: string,
): Promise<{ bytes: Buffer; syntheticBold: boolean }> {
  const drawn = newText.replace(/\n/g, '')
  // The run's own face being bold only matters when that face is kept
  const wantBold = !!edit.newBold && (!!edit.newFont || !(font && faceIsBold(m, font)))
  const done = (bytes: Buffer) => ({ bytes, syntheticBold: wantBold })
  const style: EditFontStyle =
    edit.newFont && wantBold && edit.newItalic
      ? 'bolditalic'
      : edit.newFont && wantBold
        ? 'bold'
        : edit.newItalic
          ? 'italic'
          : 'regular'
  if (edit.newFont) {
    // Style variant first, base face as the degrade (never fail the edit over style)
    for (const s of style === 'regular' ? (['regular'] as const) : ([style, 'regular'] as const)) {
      const chosen = loadEditFont(edit.newFont, s)
      if (chosen && fontCoversText(chosen, drawn)) {
        const gotBold = s === 'bold' || s === 'bolditalic'
        return { bytes: await subsetTtf(chosen, drawn), syntheticBold: wantBold && !gotBold }
      }
    }
  } else if (font) {
    if (style !== 'regular') {
      // Style override on "keep original": the embedded subset is the base face, so
      // ask the installed index for the family's matching variant — appending the
      // style word to the PS name merges with any tokens it already carries
      const ps = fontString(m, (b, l) => m._FPDFFont_GetBaseFontName(font, b, l)).replace(
        /^[A-Z]{6}\+/,
        '',
      )
      const family = fontString(m, (b, l) => m._FPDFFont_GetFamilyName(font, b, l))
      if (ps || family) {
        // The combined query merges inherited and requested tokens; when the combined
        // face is missing they tie, and the ranker may hand back the original face —
        // a silent no-op for the toggle. Detect that (byte-equal to the plain-PS
        // lookup) and retry with the requested style alone, so the user's latest
        // toggle wins over the run's inherited style.
        let sys = findSystemFont(`${ps}-${style}`, family)
        const original = findSystemFont(ps, family)
        // A run whose face already carries the requested style makes the combined
        // lookup legitimately return that face — that is a hit, not a no-op
        const psTokens = (ps.toLowerCase().match(/bolditalic|bold|italic|oblique/g) ?? []).flatMap(
          (t) => (t === 'bolditalic' ? ['bold', 'italic'] : t === 'oblique' ? ['italic'] : [t]),
        )
        const wanted = style === 'bolditalic' ? ['bold', 'italic'] : [style]
        const alreadyStyled = wanted.every((t) => psTokens.includes(t))
        if (!alreadyStyled && sys && original && sys.equals(original)) {
          const stripped = ps.replace(/bolditalic|bold|italic|oblique/gi, '')
          const alt = findSystemFont(`${stripped}-${style}`, family)
          sys = alt && !alt.equals(original) ? alt : null
        }
        if (sys && fontCoversText(sys, drawn)) {
          try {
            return done(identityCffCharset(await subsetTtf(sys, drawn)))
          } catch {
            /* charset not rewritable: degrade to the base face below */
          }
        }
      }
    }
    const embedded = embeddedFontData(m, font)
    // Already a subset: re-subsetting a GID-remapped face buys nothing and risks breakage.
    // Bare-CFF font programs (FontFile3 without an sfnt wrapper) have no cmap and fail
    // the coverage check, falling through to the name lookup.
    if (embedded && fontCoversText(embedded, drawn)) {
      try {
        return done(identityCffCharset(embedded))
      } catch {
        /* charset not rewritable: try the installed face instead */
      }
    }
    const ps = fontString(m, (b, l) => m._FPDFFont_GetBaseFontName(font, b, l)).replace(
      /^[A-Z]{6}\+/,
      '',
    )
    const family = fontString(m, (b, l) => m._FPDFFont_GetFamilyName(font, b, l))
    if (ps || family) {
      const sys = findSystemFont(ps, family)
      if (sys && fontCoversText(sys, drawn)) {
        try {
          return done(identityCffCharset(await subsetTtf(sys, drawn)))
        } catch {
          /* charset not rewritable: fall back */
        }
      }
    }
  }
  const fallback = fallbackFontFor(drawn)
  // No face covers the text (emoji, rare CJK extensions — or a machine with none of
  // the fallback fonts): embedding missing glyphs would fail read-back verification
  // and block the whole save — reject this one edit instead (it is reported as
  // skipped with this reason, everything else saves)
  if (!fallback) {
    throw new Error('the replacement contains characters no available font can draw')
  }
  const sub = await subsetTtf(fallback, drawn)
  try {
    // CFF-flavored fallbacks (e.g. PingFang) need the charset rewrite for viewer
    // compat; a no-op for TrueType faces
    return done(identityCffCharset(sub))
  } catch {
    // TrueType subsets never needed the rewrite, so the raw subset is safe. A CFF
    // subset without it can save fine yet render BLANK in viewers that resolve CID
    // through the charset (Acrobat) — reject this edit (reported as skipped with
    // this reason) instead of embedding bytes that look saved but display nothing.
    if (isTruetype(sub)) return done(sub)
    throw new Error('the fallback font for this text could not be embedded')
  }
}

/** The run's own face already carries weight (by PostScript name): stroking it again
    would over-embolden, and a bold toggle on it is a no-op today as well */
export function faceIsBold(m: Pdfium, font: number): boolean {
  const ps = fontString(m, (b, l) => m._FPDFFont_GetBaseFontName(font, b, l))
  return /bold|black|heavy|semibold|demibold|extrabold|ultrabold/i.test(ps)
}

/** Stroke attributes carried over from the edited run, so a re-edit of a synthetic-bold
    run (or an authored outline) keeps its look. `sameAsFill` = the stroke tracked the
    fill color, so a recolor moves both. */
export interface InheritedStroke {
  mode: number
  color: readonly [number, number, number, number]
  width: number
  sameAsFill: boolean
}

export function readStroke(m: Pdfium, obj: number): InheritedStroke | null {
  const mode = m._FPDFTextObj_GetTextRenderMode(obj)
  if (mode !== FPDF_TEXTRENDERMODE_FILL_STROKE && mode !== FPDF_TEXTRENDERMODE_FILL_STROKE_CLIP)
    return null
  const ptr = m._malloc(36)
  try {
    if (!m._FPDFPageObj_GetStrokeColor(obj, ptr, ptr + 4, ptr + 8, ptr + 12)) return null
    const color = [0, 4, 8, 12].map((o) => m.HEAPU8[ptr + o]!) as [number, number, number, number]
    const width = m._FPDFPageObj_GetStrokeWidth(obj, ptr + 16) ? m.HEAPF32[(ptr + 16) >> 2]! : 0
    const hasFill = m._FPDFPageObj_GetFillColor(obj, ptr + 20, ptr + 24, ptr + 28, ptr + 32)
    const sameAsFill = !!hasFill && [20, 24, 28].every((o, i) => m.HEAPU8[ptr + o] === color[i])
    return { mode, color, width, sameAsFill }
  } finally {
    m._free(ptr)
  }
}

/** Fill+stroke the glyphs: bold without touching the face or the advances */
export function strokeObject(
  m: Pdfium,
  obj: number,
  color: readonly [number, number, number, number],
  width: number,
  mode = FPDF_TEXTRENDERMODE_FILL_STROKE,
): void {
  m._FPDFTextObj_SetTextRenderMode(obj, mode)
  m._FPDFPageObj_SetStrokeColor(obj, color[0], color[1], color[2], color[3])
  m._FPDFPageObj_SetStrokeWidth(obj, width)
  m._FPDFPageObj_SetLineJoin(obj, FPDF_LINEJOIN_ROUND)
}

/** `emPt` = rendered em in page units (font size × matrix scale) */
export const syntheticBoldWidth = (emPt: number) => emPt * SYNTHETIC_BOLD_STROKE_EM

export function fillColorOf(m: Pdfium, obj: number): readonly [number, number, number, number] {
  const ptr = m._malloc(16)
  try {
    if (!m._FPDFPageObj_GetFillColor(obj, ptr, ptr + 4, ptr + 8, ptr + 12)) return [0, 0, 0, 255]
    const c = [0, 4, 8, 12].map((o) => m.HEAPU8[ptr + o]!) as [number, number, number, number]
    if (c[3] === 0) c[3] = 255
    return c
  } finally {
    m._free(ptr)
  }
}

export function renderedEm(m: Pdfium, obj: number): number {
  const ptr = m._malloc(24)
  try {
    const size = m._FPDFTextObj_GetFontSize(obj, ptr) ? m.HEAPF32[ptr >> 2]! : 1
    if (!m._FPDFPageObj_GetMatrix(obj, ptr)) return size
    return size * Math.hypot(m.HEAPF32[ptr >> 2]!, m.HEAPF32[(ptr >> 2) + 1]!)
  } finally {
    m._free(ptr)
  }
}

