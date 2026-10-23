// Text-insert path — split out of text.ts (the 500-line module rule). Holds
// TextInsertsResult, textInsertAxes and applyTextInserts; everything else
// about text objects lives in text.ts / text-match.ts / text-build.ts.
import type { TextEditInput, TextInsertFailure, TextInsertInput } from './types.ts'
import {
  chainPdfium,
  FPDF_FONT_TRUETYPE,
  FPDF_FONT_TYPE1,
  loadPdfium,
  saveDoc,
  withDocument,
} from './pdfium.ts'
import { utf16Ptr } from './text-match.ts'
import { LINE_GAP } from './text-plan.ts'
import { relabelOpenTypeFontFiles } from './text-build.ts'
import {
  resolveRebuildFont,
  strokeObject,
  syntheticBoldWidth,
} from './font-resolve.ts'
import { isTruetype } from './font-locate.ts'
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))
export interface TextInsertsResult {
  bytes: Uint8Array
  skipped: TextInsertFailure[]
}

/** Text-space axes that keep inserted glyphs upright after the page's final /Rotate. */
function textInsertAxes(rotate = 0): readonly [number, number, number, number] {
  switch (((rotate % 360) + 360) % 360) {
    case 90:
      return [0, 1, -1, 0]
    case 180:
      return [-1, 0, 0, -1]
    case 270:
      return [0, -1, 1, 0]
    default:
      return [1, 0, 0, 1]
  }
}

/** Insert new searchable text objects without matching/removing existing page content. */
export function applyTextInserts(
  bytes: Uint8Array,
  inserts: TextInsertInput[],
): Promise<TextInsertsResult> {
  return chainPdfium(async () => {
    const m = await loadPdfium()
    const skipped: TextInsertFailure[] = []
    return withDocument(m, bytes, async (doc) => {
      const pageCount = m._FPDF_GetPageCount(doc)
      let appliedTotal = 0
      let embeddedCff = false
      const byPage = new Map<number, { input: TextInsertInput; editIndex: number }[]>()
      inserts.forEach((input, editIndex) => {
        if (input.pageIndex < 0 || input.pageIndex >= pageCount) {
          skipped.push({ editIndex, pageIndex: input.pageIndex, reason: 'page does not exist' })
          return
        }
        byPage.set(input.pageIndex, [...(byPage.get(input.pageIndex) ?? []), { input, editIndex }])
      })
      for (const [pageIndex, pageInserts] of byPage) {
        const page = m._FPDF_LoadPage(doc, pageIndex)
        if (!page) throw new Error(`could not load page ${pageIndex + 1}`)
        let applied = 0
        try {
          for (const { input, editIndex } of pageInserts) {
            const text = input.text.trim()
            if (!text) {
              skipped.push({ editIndex, pageIndex, reason: 'empty inserted text' })
              continue
            }
            const pseudoEdit: TextEditInput = {
              pageIndex,
              rect: [input.origin[0], input.origin[1], input.origin[0], input.origin[1]],
              oldText: '',
              newText: input.text,
              fontSize: input.fontSize,
              newFontSize: input.fontSize,
              newColor: input.color,
              newFont: input.font,
              newBold: input.bold,
              newItalic: input.italic,
            }
            const created: number[] = []
            let font = 0
            try {
              const { bytes: fontBytes, syntheticBold } = await resolveRebuildFont(
                m,
                0,
                pseudoEdit,
                input.text,
              )
              const fontPtr = m._malloc(fontBytes.length)
              m.HEAPU8.set(fontBytes, fontPtr)
              font = m._FPDFText_LoadFont(
                doc,
                fontPtr,
                fontBytes.length,
                isTruetype(fontBytes) ? FPDF_FONT_TRUETYPE : FPDF_FONT_TYPE1,
                1,
              )
              m._free(fontPtr)
              if (!font) throw new Error('FPDFText_LoadFont failed')
              const matrixPtr = m._malloc(24)
              try {
                const leading = input.lineLeading ?? input.fontSize * LINE_GAP
                const [a, b, c, d] = textInsertAxes(input.rotate)
                for (const [lineIndex, line] of input.text.split('\n').entries()) {
                  if (!line) continue
                  const obj = m._FPDFPageObj_CreateTextObj(doc, font, input.fontSize)
                  const textPtr = utf16Ptr(m, line)
                  const ok = m._FPDFText_SetText(obj, textPtr)
                  m._free(textPtr)
                  if (!ok) {
                    m._FPDFPageObj_Destroy(obj)
                    throw new Error('FPDFText_SetText failed on inserted object')
                  }
                  const offset = input.lineXOffsets?.[lineIndex] ?? 0
                  const drop = lineIndex * leading
                  m.HEAPF32.set(
                    [
                      a,
                      b,
                      c,
                      d,
                      input.origin[0] + a * offset - c * drop,
                      input.origin[1] + b * offset - d * drop,
                    ],
                    matrixPtr >> 2,
                  )
                  m._FPDFPageObj_SetMatrix(obj, matrixPtr)
                  m._FPDFPageObj_SetFillColor(
                    obj,
                    input.color[0],
                    input.color[1],
                    input.color[2],
                    255,
                  )
                  if (syntheticBold)
                    strokeObject(
                      m,
                      obj,
                      [input.color[0], input.color[1], input.color[2], 255],
                      syntheticBoldWidth(input.fontSize),
                    )
                  created.push(obj)
                }
              } finally {
                m._free(matrixPtr)
              }
              for (const obj of created) m._FPDFPage_InsertObject(page, obj)
              embeddedCff = !isTruetype(fontBytes) || embeddedCff
              applied++
            } catch (err) {
              for (const obj of created) m._FPDFPageObj_Destroy(obj)
              skipped.push({ editIndex, pageIndex, reason: errMsg(err) })
            }
          }
          if (applied > 0 && !m._FPDFPage_GenerateContent(page)) {
            throw new Error(`could not regenerate page ${pageIndex + 1}`)
          }
          appliedTotal += applied
        } finally {
          m._FPDF_ClosePage(page)
        }
      }
      if (appliedTotal === 0) return { bytes, skipped }
      const saved = saveDoc(m, doc)
      return { bytes: embeddedCff ? await relabelOpenTypeFontFiles(saved) : saved, skipped }
    })
  })
}
