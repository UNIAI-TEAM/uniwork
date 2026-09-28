// The object rebuild — ported verbatim from office-upstream
// apps/pdf/src/main/text-edit.ts. Rebuilds a matched run: keeps untouched
// head/tail objects (translated, not redrawn), redraws the edited middle with
// resolved fonts and per-segment styles, then fixes up the page.
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import type { TextEditInput } from './types.ts'
import type { Pdfium } from './pdfium.ts'
import {
  FPDF_FONT_TRUETYPE,
  FPDF_FONT_TYPE1,
  FPDF_PAGEOBJ_TEXT,
  FPDF_TEXTRENDERMODE_FILL_STROKE_CLIP,
} from './pdfium.ts'
import { isTruetype } from './font-locate.ts'
import {
  resolveRebuildFont,
  readStroke,
  strokeObject,
  syntheticBoldWidth,
} from './font-resolve.ts'
import {
  buildKeepPlan,
  matchCharColors,
  overlayStyles,
  plannedCharStyles,
  PreserveAbort,
  segmentLine,
  LINE_GAP,
} from './text-plan.ts'
import type { KeepPlanObj, Rgb, RunStyle } from './text-plan.ts'
import { utf16Ptr } from './text-match.ts'
import type { PageTextObj } from './text-match.ts'
export async function rebuildRun(
  m: Pdfium,
  doc: number,
  page: number,
  edit: TextEditInput,
  matches: PageTextObj[],
  newText: string,
  textPage: number,
): Promise<boolean> {
  const anchor = matches.reduce((a, b) => (b.bounds[0] < a.bounds[0] ? b : a))
  const matPtr = m._malloc(24)
  const sizePtr = m._malloc(4)
  const colPtr = m._malloc(16)
  const widthPtr = m._malloc(4)
  try {
    m._FPDFPageObj_GetMatrix(anchor.obj, matPtr)
    let matrix = Array.from(m.HEAPF32.subarray(matPtr >> 2, (matPtr >> 2) + 6))
    let fontSize = edit.fontSize
    if (m._FPDFTextObj_GetFontSize(anchor.obj, sizePtr)) fontSize = m.HEAPF32[sizePtr >> 2]!
    if (edit.newFontSize !== undefined && edit.newFontSize > 0) fontSize = edit.newFontSize
    if (edit.origin) {
      // Paragraph rebuild: the renderer measured wrap width, leading and x offsets
      // in PDF user space, so write in user space too — identity matrix at the
      // origin and the renderer's effective size. The anchor's own matrix may carry
      // scale (Tf ~ 1 conventions), which would re-scale the user-space leading and
      // offsets and spread lines apart.
      matrix = [1, 0, 0, 1, edit.origin[0], edit.origin[1]]
      fontSize =
        edit.newFontSize !== undefined && edit.newFontSize > 0 ? edit.newFontSize : edit.fontSize
    }
    const hasColor = m._FPDFPageObj_GetFillColor(
      anchor.obj,
      colPtr,
      colPtr + 4,
      colPtr + 8,
      colPtr + 12,
    )
    const color: readonly [number, number, number, number] = edit.newColor
      ? [edit.newColor[0], edit.newColor[1], edit.newColor[2], 255]
      : hasColor
        ? ([0, 4, 8, 12].map((off) => m.HEAPU8[colPtr + off]!) as [number, number, number, number])
        : [0, 0, 0, 255]
    // Some producers (Chrome print) leave the object's fill alpha reading as 0 while
    // the glyphs render opaque (the RGB part reads fine). Inheriting that raw 0 drew
    // the rebuilt run fully transparent — visible text must never become invisible.
    if (color[3] === 0) (color as [number, number, number, number])[3] = 255

    // Colors already in the matched run survive underneath the user's selection
    // styles; an explicit whole-edit newColor means "repaint uniformly" and wins.
    const keepColors = edit.newColor ? null : matchCharColors(m, matches, newText)
    const charStyles = overlayStyles(keepColors, plannedCharStyles(edit, newText), newText)

    // Object-preserving mode. Whole-edit face/size/style overrides mean "restyle
    // everything" and take the full-redraw path; so does a rotated/skewed matrix
    // (the cursor walk below only models horizontal text). Selection-level style
    // runs are fine: buildKeepPlan redraws any object their ranges touch.
    const styleOverride =
      edit.newFontSize !== undefined || edit.newFont !== undefined || edit.newBold || edit.newItalic
    const axisAligned =
      Math.abs(matrix[1]!) < 1e-4 && Math.abs(matrix[2]!) < 1e-4 && matrix[0]! > 0 && matrix[3]! > 0
    const keeps =
      !styleOverride && axisAligned
        ? buildKeepPlan(m, textPage, matches, newText, charStyles, edit.newColor, edit)
        : null
    // Subset the rebuild font to the non-kept text only: requiring coverage for
    // kept glyphs (e.g. Type3 PUA codepoints) would fail edits that never touch them
    const redrawOnly = (): string => {
      if (!keeps) return newText
      const parts: string[] = []
      let k = 0
      for (const kp of [...keeps].sort((a, b) => a.startK - b.startK)) {
        parts.push(newText.slice(k, kp.startK))
        k = kp.endK
      }
      parts.push(newText.slice(k))
      return parts.join('')
    }

    let font = 0
    let fontSynth = false
    let anyCff = false
    const loadFont = async (
      styleEdit: TextEditInput,
      text: string,
    ): Promise<{ font: number; synth: boolean }> => {
      const { bytes: fontBytes, syntheticBold } = await resolveRebuildFont(
        m,
        anchor.font,
        styleEdit,
        text.trim() ? text : 'x',
      )
      const fontPtr = m._malloc(fontBytes.length)
      m.HEAPU8.set(fontBytes, fontPtr)
      const f = m._FPDFText_LoadFont(
        doc,
        fontPtr,
        fontBytes.length,
        isTruetype(fontBytes) ? FPDF_FONT_TRUETYPE : FPDF_FONT_TYPE1,
        1,
      )
      m._free(fontPtr)
      if (!f) throw new Error('FPDFText_LoadFont failed')
      anyCff = anyCff || !isTruetype(fontBytes)
      return { font: f, synth: syntheticBold }
    }
    const loadRebuild = async (text: string) => {
      ;({ font, synth: fontSynth } = await loadFont(edit, text))
    }
    const inherited = readStroke(m, anchor.obj)
    await loadRebuild(keeps ? redrawOnly() : newText)

    // Effective face/size of a segment style: explicit run fields over the whole-edit
    // overrides (which rebuildFontBytes resolves against the original run)
    const faceOf = (s: RunStyle | null) => ({
      font: s?.font ?? edit.newFont,
      bold: s?.bold ?? !!edit.newBold,
      italic: s?.italic ?? !!edit.newItalic,
    })
    const faceKeyOf = (s: RunStyle | null) => {
      const f = faceOf(s)
      return `${f.font ?? ''}|${f.bold ? 1 : 0}|${f.italic ? 1 : 0}`
    }
    const baseFaceKey = faceKeyOf(null)
    const sizeOf = (s: RunStyle | null) => (s?.size !== undefined && s.size > 0 ? s.size : fontSize)

    // One extra font per distinct non-base face among the styled chars, subset to
    // exactly the text that face draws (styled ranges are never kept, so the set is
    // known up front and survives a PreserveAbort re-load of the base font)
    const styleFonts = new Map<string, { font: number; synth: boolean }>()
    if (charStyles) {
      const byFace = new Map<string, { style: RunStyle; text: string }>()
      for (let k = 0; k < newText.length; k++) {
        const s = charStyles[k] ?? null
        if (!s) continue
        const fk = faceKeyOf(s)
        if (fk === baseFaceKey) continue
        const e = byFace.get(fk)
        if (e) e.text += newText[k]!
        else byFace.set(fk, { style: s, text: newText[k]! })
      }
      for (const [fk, { style, text }] of byFace) {
        const face = faceOf(style)
        styleFonts.set(
          fk,
          await loadFont(
            { ...edit, newFont: face.font, newBold: face.bold, newItalic: face.italic },
            text,
          ),
        )
      }
    }
    const fontFor = (s: RunStyle | null): number => styleFonts.get(faceKeyOf(s))?.font ?? font
    const synthFor = (s: RunStyle | null): boolean =>
      styleFonts.get(faceKeyOf(s))?.synth ?? fontSynth

    // Advance of one codepoint in text-space pt, measured with the face and size that
    // will draw it (same unicode→charcode mapping FPDFText_SetText uses)
    const advancePt = (cp: number, s: RunStyle | null): number | null =>
      m._FPDFFont_GetGlyphWidth(fontFor(s), cp, 1, widthPtr)
        ? m.HEAPF32[widthPtr >> 2]! * sizeOf(s)
        : null

    const lineHeight = edit.lineLeading ?? fontSize * LINE_GAP
    const [baseX, baseY] = edit.origin ?? [matrix[4]!, matrix[5]!]
    const newObjs: number[] = []
    const moves: { obj: number; dx: number; dy: number; color: Rgb | null }[] = []
    // Per new object: the kept object preceding it in text order (0 = none), so
    // redrawn fragments can be inserted next to their kept neighbors — otherwise
    // stream-order extraction (copy/paste, pdftotext) reads jumbled text
    const segAnchors: number[] = []
    let lastKeptObj = 0

    const makeSeg = (text: string, x: number, y: number, style: RunStyle | null) => {
      const newObj = m._FPDFPageObj_CreateTextObj(doc, fontFor(style), sizeOf(style))
      const textPtr = utf16Ptr(m, text)
      const ok = m._FPDFText_SetText(newObj, textPtr)
      m._free(textPtr)
      if (!ok) {
        m._FPDFPageObj_Destroy(newObj)
        throw new Error('FPDFText_SetText failed on rebuilt object')
      }
      const lineMatrix = [...matrix]
      lineMatrix[4] = x
      lineMatrix[5] = y
      m.HEAPF32.set(lineMatrix, matPtr >> 2)
      m._FPDFPageObj_SetMatrix(newObj, matPtr)
      const c: readonly [number, number, number, number] = style?.color
        ? [style.color[0], style.color[1], style.color[2], 255]
        : color
      m._FPDFPageObj_SetFillColor(newObj, c[0], c[1], c[2], c[3])
      const emPt = sizeOf(style) * Math.hypot(matrix[0]!, matrix[1]!)
      if (synthFor(style)) strokeObject(m, newObj, c, syntheticBoldWidth(emPt))
      else if (inherited?.sameAsFill)
        strokeObject(m, newObj, c, syntheticBoldWidth(emPt), inherited.mode)
      else if (inherited) strokeObject(m, newObj, inherited.color, inherited.width, inherited.mode)
      newObjs.push(newObj)
      segAnchors.push(lastKeptObj)
    }

    // Full redraw: one text object per line (several when selection styles split
    // it), stepping down one leading per line from the anchor baseline or origin
    const buildRedraw = () => {
      let lineStart = 0
      for (const [lineIdx, line] of newText.split('\n').entries()) {
        const lineStyles = charStyles ? charStyles.slice(lineStart, lineStart + line.length) : null
        lineStart += line.length + 1
        if (!line) continue
        const drop = lineIdx * lineHeight
        for (const seg of segmentLine(line, lineStyles, advancePt)) {
          if (!seg.text) continue
          // Segment offset is a text-space advance: map it through the matrix's x axis
          const segX = seg.xPt
          makeSeg(
            seg.text,
            baseX + (edit.lineXOffsets?.[lineIdx] ?? 0) + matrix[0]! * segX - matrix[2]! * drop,
            baseY + matrix[1]! * segX - matrix[3]! * drop,
            seg.style,
          )
        }
      }
    }

    // Preserving build: walk each output line with a page-space cursor — kept
    // objects become translations to the cursor, edited stretches are drawn with
    // the rebuild font. Consecutive kept objects carry their ORIGINAL spacing, so
    // untouched (even justified) text keeps its exact layout.
    const buildPreserved = (plan: KeepPlanObj[]) => {
      const sorted = [...plan].sort((a, b) => a.startK - b.startK)
      let ki = 0
      let lineStart = 0
      // Advances/leadings are text-space (Tf) values; map through the matrix's
      // axis scales to walk in page space (scale 1 for origin edits)
      const xScale = matrix[0]!
      const advOf = (ch: string, s: RunStyle | null): number => {
        const a = advancePt(ch.codePointAt(0)!, s)
        if (a !== null) return a * xScale
        if (/\s/.test(ch)) return sizeOf(s) * xScale * 0.28
        throw new PreserveAbort()
      }
      for (const [lineIdx, line] of newText.split('\n').entries()) {
        const lineEnd = lineStart + line.length
        const baseline = baseY - lineIdx * lineHeight * matrix[3]!
        let cursor = baseX + (edit.lineXOffsets?.[lineIdx] ?? 0)
        let prev: { keep: KeepPlanObj; placedX: number } | null = null
        let k = lineStart
        while (k < lineEnd) {
          const keep = ki < sorted.length && sorted[ki]!.startK === k ? sorted[ki]! : null
          if (keep) {
            if (
              prev &&
              Math.abs(keep.origY - prev.keep.origY) < 0.5 &&
              keep.origX > prev.keep.origX &&
              /^\s*$/.test(newText.slice(prev.keep.endK, keep.startK))
            ) {
              cursor = prev.placedX + (keep.origX - prev.keep.origX)
            }
            moves.push({
              obj: keep.src.obj,
              dx: cursor - keep.origX,
              dy: baseline - keep.origY,
              color: keep.color,
            })
            lastKeptObj = keep.src.obj
            prev = { keep, placedX: cursor }
            cursor += keep.advW
            k = keep.endK
            ki++
            continue
          }
          const runEnd = ki < sorted.length ? Math.min(sorted[ki]!.startK, lineEnd) : lineEnd
          if (runEnd <= k) throw new PreserveAbort()
          const runText = newText.slice(k, runEnd)
          if (runText.trim()) {
            const runStyles = charStyles ? charStyles.slice(k, runEnd) : null
            for (const seg of segmentLine(runText, runStyles, advancePt)) {
              if (!seg.text.trim()) continue
              makeSeg(seg.text, cursor + seg.xPt * xScale, baseline, seg.style)
            }
            prev = null
          }
          let cu = k
          for (const ch of runText) {
            cursor += advOf(ch, charStyles?.[cu] ?? null)
            cu += ch.length
          }
          k = runEnd
        }
        lineStart = lineEnd + 1
      }
      if (ki !== sorted.length) throw new PreserveAbort()
    }

    // All new objects are built before anything is removed or moved, so a failure
    // here leaves the page untouched (the edit is then skipped, not half-applied).
    try {
      if (keeps) {
        try {
          buildPreserved(keeps)
        } catch (err) {
          if (!(err instanceof PreserveAbort)) throw err
          for (const o of newObjs) m._FPDFPageObj_Destroy(o)
          newObjs.length = 0
          moves.length = 0
          segAnchors.length = 0
          lastKeptObj = 0
          // The redraw-only subset lacks the kept glyphs; the fallback draws them
          await loadRebuild(newText)
          buildRedraw()
        }
      } else {
        buildRedraw()
      }
    } catch (err) {
      for (const o of newObjs) m._FPDFPageObj_Destroy(o)
      throw err
    }

    const kept = new Set(moves.map((v) => v.obj))
    for (const v of moves) {
      m._FPDFPageObj_GetMatrix(v.obj, matPtr)
      m.HEAPF32[(matPtr >> 2) + 4] = m.HEAPF32[(matPtr >> 2) + 4]! + v.dx
      m.HEAPF32[(matPtr >> 2) + 5] = m.HEAPF32[(matPtr >> 2) + 5]! + v.dy
      m._FPDFPageObj_SetMatrix(v.obj, matPtr)
      if (v.color) {
        // a synthetic-bold stroke tracks the fill: recolor both (read before the fill changes)
        const st = readStroke(m, v.obj)
        m._FPDFPageObj_SetFillColor(v.obj, v.color[0]!, v.color[1]!, v.color[2]!, 255)
        if (st?.sameAsFill)
          m._FPDFPageObj_SetStrokeColor(v.obj, v.color[0]!, v.color[1]!, v.color[2]!, 255)
      }
    }
    const removed = matches.filter((t) => !kept.has(t.obj))
    for (const t of removed) {
      m._FPDFPage_RemoveObject(page, t.obj)
      m._FPDFPageObj_Destroy(t.obj)
    }
    if (kept.size > 0 && newObjs.length > 0 && m._FPDFPage_InsertObjectAtIndex) {
      // Keep the content stream in reading order: each redrawn fragment goes right
      // after its kept predecessor (anchorless fragments lead the run). Indices are
      // post-removal; groups insert back-to-front so earlier anchors stay valid.
      const idxOf = new Map<number, number>()
      const count = m._FPDFPage_CountObjects(page)
      for (let i = 0; i < count; i++) idxOf.set(m._FPDFPage_GetObject(page, i), i)
      const runStart = Math.min(
        ...matches.filter((t) => kept.has(t.obj)).map((t) => idxOf.get(t.obj) ?? 0),
      )
      const groups: { at: number; objs: number[] }[] = []
      for (const [i, newObj] of newObjs.entries()) {
        const anchor = segAnchors[i]!
        const at = anchor && idxOf.has(anchor) ? idxOf.get(anchor)! + 1 : runStart
        const g = groups[groups.length - 1]
        if (g && g.at === at) g.objs.push(newObj)
        else groups.push({ at, objs: [newObj] })
      }
      groups.sort((a, b) => b.at - a.at)
      for (const g of groups) {
        for (const [j, newObj] of g.objs.entries()) {
          m._FPDFPage_InsertObjectAtIndex(page, newObj, g.at + j)
        }
      }
    } else {
      // Full redraw: insert where the removed run began — the run's minimum index
      // is the only position still valid after the removals shift everything else
      const insertAt = removed.length > 0 ? Math.min(...removed.map((t) => t.index)) : -1
      for (const [i, newObj] of newObjs.entries()) {
        if (insertAt >= 0 && m._FPDFPage_InsertObjectAtIndex) {
          m._FPDFPage_InsertObjectAtIndex(page, newObj, insertAt + i)
        } else {
          m._FPDFPage_InsertObject(page, newObj)
        }
      }
    }
    return anyCff
  } finally {
    for (const p of [matPtr, sizePtr, colPtr, widthPtr]) m._free(p)
  }
}

/** PDFium's FPDF_FONT_TYPE1 load path files a CFF-flavored sfnt under /FontFile — the
    Type1-program slot — which poppler/mupdf/Acrobat reject (blank glyphs). Relabel such
    programs as /FontFile3 with Subtype /OpenType (PDF 1.6), the correct slot for them.
    Only descriptors whose embedded program actually starts with the OTTO tag are touched,
    so genuine Type1 fonts from the original document pass through untouched. */
export async function relabelOpenTypeFontFiles(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  let touched = false
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue
    if (obj.get(PDFName.of('Type')) !== PDFName.of('FontDescriptor')) continue
    const ff = obj.get(PDFName.of('FontFile'))
    if (!ff) continue
    const stream = doc.context.lookup(ff)
    if (!(stream instanceof PDFRawStream)) continue
    let program: Uint8Array
    try {
      program = decodePDFRawStream(stream).decode()
    } catch {
      continue
    }
    if (Buffer.from(program.subarray(0, 4)).toString('latin1') !== 'OTTO') continue
    obj.delete(PDFName.of('FontFile'))
    obj.set(PDFName.of('FontFile3'), ff)
    stream.dict.set(PDFName.of('Subtype'), PDFName.of('OpenType'))
    touched = true
  }
  return touched ? doc.save({ useObjectStreams: false }) : bytes
}

