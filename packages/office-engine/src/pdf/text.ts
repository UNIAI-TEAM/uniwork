// Top-level text edit operations — ported verbatim from office-upstream
// apps/pdf/src/main/text-edit.ts: applyTextEdits (content-stream rewrite of
// matched runs), applyTextInserts (new text objects), validateTextEdits
// (dry-run matching), verifyTextEdits (read-back on saved bytes).
import type {
  TextEditFailure,
  TextEditInput,
  TextEditValidation,
  TextInsertFailure,
  TextInsertInput,
} from './types.ts'
import type { Pdfium } from './pdfium.ts'
import {
  chainPdfium,
  FPDF_FONT_TRUETYPE,
  FPDF_FONT_TYPE1,
  FPDF_PAGEOBJ_TEXT,
  loadPdfium,
  saveDoc,
  withDocument,
} from './pdfium.ts'
import {
  canReuseFont,
  collectTextObjects,
  joinRows,
  matchBounds,
  matchEdit,
  readingOrder,
  utf16Ptr,
} from './text-match.ts'
import type { PageTextObj } from './text-match.ts'
import { norm } from './text-fold.ts'
import {
  faceIsBold,
  fillColorOf,
  readStroke,
  renderedEm,
  resolveRebuildFont,
  strokeObject,
  syntheticBoldWidth,
} from './font-resolve.ts'
import { isTruetype } from './font-locate.ts'
import { LINE_GAP, matchCharColors } from './text-plan.ts'
import type { Rgb } from './text-plan.ts'
import { rebuildRun, relabelOpenTypeFontFiles } from './text-build.ts'
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))

export interface TextEditsResult {
  bytes: Uint8Array
  /** Edits that could not be applied; everything else is in `bytes`. One stale edit
      must not block the whole save (it used to make every save fail until removed). */
  skipped: TextEditFailure[]
}

/** Rewrite page content streams per the edits and return the new document bytes plus
    the edits that no longer match the document (skipped, reported to the caller). */
export function applyTextEdits(
  bytes: Uint8Array,
  edits: TextEditInput[],
): Promise<TextEditsResult> {
  return chainPdfium(() => applyTextEditsInner(bytes, edits))
}


/** Dry-run matching for pending edits (no mutation). Lets the renderer reject a bad edit
    when it is made (not at save) and cover the matched run's real ink in the preview. */
export function validateTextEdits(
  bytes: Uint8Array,
  edits: TextEditInput[],
): Promise<TextEditValidation[]> {
  return chainPdfium(() => validateTextEditsInner(bytes, edits))
}
function groupByPage(
  m: Pdfium,
  doc: number,
  edits: TextEditInput[],
  outOfRange: (edit: TextEditInput) => void,
): Map<number, TextEditInput[]> {
  const pageCount = m._FPDF_GetPageCount(doc)
  const byPage = new Map<number, TextEditInput[]>()
  for (const e of edits) {
    if (e.pageIndex < 0 || e.pageIndex >= pageCount) {
      outOfRange(e)
      continue
    }
    byPage.set(e.pageIndex, [...(byPage.get(e.pageIndex) ?? []), e])
  }
  return byPage
}

async function applyTextEditsInner(
  bytes: Uint8Array,
  edits: TextEditInput[],
): Promise<TextEditsResult> {
  const m = await loadPdfium()
  const skipped: TextEditFailure[] = []
  const skip = (edit: TextEditInput, reason: string) =>
    skipped.push({ pageIndex: edit.pageIndex, oldText: edit.oldText, reason })

  return withDocument(m, bytes, async (doc) => {
    const byPage = groupByPage(m, doc, edits, (e) => skip(e, 'page does not exist'))
    let appliedTotal = 0
    let embeddedCff = false
    for (const [pageIndex, pageEdits] of byPage) {
      const page = m._FPDF_LoadPage(doc, pageIndex)
      if (!page) throw new Error(`could not load page ${pageIndex + 1}`)
      const textPage = m._FPDFText_LoadPage(page)
      try {
        const objects = collectTextObjects(m, page, textPage)
        // Two edits resolving to the same object would double-remove it; first claim wins
        const claimed = new Set<number>()
        const planned: {
          edit: TextEditInput
          matches: PageTextObj[]
          newText: string
          whole: boolean
        }[] = []
        for (const edit of pageEdits) {
          const res = matchEdit(objects, edit)
          if ('reason' in res) {
            skip(edit, res.reason)
          } else if (res.matches.some((t) => claimed.has(t.obj))) {
            skip(edit, 'overlaps another pending text edit')
          } else {
            for (const t of res.matches) claimed.add(t.obj)
            planned.push({ edit, ...res })
          }
        }
        // Descending object order keeps pending InsertObjectAtIndex targets valid
        planned.sort((a, b) => b.matches[0]!.index - a.matches[0]!.index)
        let applied = 0
        for (const { edit, matches, newText, whole } of planned) {
          // Pure move: translate the matched objects in page space and keep every
          // glyph as it is — no font resolution, no rebuild. Only a whole match may
          // move (a fragment's container carries surrounding text that must stay put).
          if (edit.translate) {
            if (!whole) {
              skip(edit, 'the text block cannot be moved as one unit')
              continue
            }
            const [dx, dy] = edit.translate
            for (const t of matches) m._FPDFPageObj_Transform(t.obj, 1, 0, 0, 1, dx, dy)
            applied++
            continue
          }
          // Deletion: an empty (or whitespace-only) planned replacement removes the
          // matched objects outright — no font resolution, nothing to rebuild
          if (newText.trim() === '') {
            for (const t of matches) {
              m._FPDFPage_RemoveObject(page, t.obj)
              m._FPDFPageObj_Destroy(t.obj)
            }
            applied++
            continue
          }
          // A fragment match rewrites its whole container run; the paragraph position
          // overrides would drag the container's surrounding text to the block corner
          const eff = whole
            ? edit
            : { ...edit, origin: undefined, lineLeading: undefined, lineXOffsets: undefined }
          try {
            if (canReuseFont(eff, newText, matches, objects, whole)) {
              const obj = matches[0]!.obj
              const textPtr = utf16Ptr(m, newText)
              const ok = m._FPDFText_SetText(obj, textPtr)
              m._free(textPtr)
              if (!ok) throw new Error('FPDFText_SetText failed')
              if (eff.newBold && !faceIsBold(m, matches[0]!.font) && !readStroke(m, obj)) {
                strokeObject(m, obj, fillColorOf(m, obj), syntheticBoldWidth(renderedEm(m, obj)))
              }
            } else {
              embeddedCff =
                (await rebuildRun(m, doc, page, eff, matches, newText, textPage)) || embeddedCff
            }
            applied++
          } catch (err) {
            skip(edit, errMsg(err))
          }
        }
        if (applied > 0 && !m._FPDFPage_GenerateContent(page)) {
          throw new Error(`could not regenerate page ${pageIndex + 1}`)
        }
        appliedTotal += applied
      } finally {
        m._FPDFText_ClosePage(textPage)
        m._FPDF_ClosePage(page)
      }
    }
    // Nothing applied → return the input bytes untouched (skip the pdfium round-trip)
    if (appliedTotal === 0) return { bytes, skipped }
    const saved = saveDoc(m, doc)
    return { bytes: embeddedCff ? await relabelOpenTypeFontFiles(saved) : saved, skipped }
  })
}

async function validateTextEditsInner(
  bytes: Uint8Array,
  edits: TextEditInput[],
): Promise<TextEditValidation[]> {
  const m = await loadPdfium()
  return withDocument(m, bytes, async (doc) => {
    const results: TextEditValidation[] = edits.map(() => ({ reason: null }))
    const indexOf = new Map(edits.map((e, i) => [e, i]))
    const byPage = groupByPage(m, doc, edits, (e) => {
      results[indexOf.get(e)!] = { reason: 'page does not exist' }
    })
    for (const [pageIndex, pageEdits] of byPage) {
      const page = m._FPDF_LoadPage(doc, pageIndex)
      if (!page) {
        for (const e of pageEdits)
          results[indexOf.get(e)!] = { reason: `could not load page ${pageIndex + 1}` }
        continue
      }
      const textPage = m._FPDFText_LoadPage(page)
      const colPtr = m._malloc(16)
      try {
        const objects = collectTextObjects(m, page, textPage)
        for (const e of pageEdits) {
          const res = matchEdit(objects, e)
          if ('reason' in res) {
            results[indexOf.get(e)!] = { reason: res.reason }
            continue
          }
          // Same gate the apply path enforces: a move must own its objects outright
          if (e.translate && !res.whole) {
            results[indexOf.get(e)!] = { reason: 'the text block cannot be moved as one unit' }
            continue
          }
          // Fragment edits resolve to their whole container object; covering all of it
          // would blank the surrounding text the preview doesn't redraw. Keep the edit
          // rect's x-span there and take only the ink's vertical extent.
          const b = matchBounds(res.matches)
          const whole = norm(res.matches.map((t) => t.text).join('')) === norm(e.oldText)
          // Colors an earlier edit saved into the run, in oldText offsets: whole
          // matches share oldText's folded units, so ranks map straight across.
          // Editors seed their selection-color state from these so the colors
          // show while editing and the commit repaints them explicitly.
          const kept = whole ? matchCharColors(m, res.matches, e.oldText) : null
          const runs: { start: number; end: number; c: Rgb }[] = []
          if (kept) {
            for (let k = 0; k < kept.length; k++) {
              const c = kept[k]
              if (!c) continue
              const last = runs[runs.length - 1]
              if (last && last.end === k && last.c === c) last.end = k + 1
              else runs.push({ start: k, end: k + 1, c })
            }
          }
          // Base ink of the run (first object in reading order), so the editor can
          // display the document's actual color even when the run is uniform
          const first = readingOrder(res.matches)[0]!
          const baseColor = m._FPDFPageObj_GetFillColor(
            first.obj,
            colPtr,
            colPtr + 4,
            colPtr + 8,
            colPtr + 12,
          )
            ? ([m.HEAPU8[colPtr]!, m.HEAPU8[colPtr + 4]!, m.HEAPU8[colPtr + 8]!] as [
                number,
                number,
                number,
              ])
            : undefined
          results[indexOf.get(e)!] = {
            reason: null,
            bounds: whole ? b : [e.rect[0], b[1], e.rect[2], b[3]],
            colorRuns:
              runs.length > 0
                ? runs.map((r) => ({
                    start: r.start,
                    end: r.end,
                    color: [r.c[0], r.c[1], r.c[2]] as [number, number, number],
                  }))
                : undefined,
            baseColor,
          }
        }
      } finally {
        m._free(colPtr)
        m._FPDFText_ClosePage(textPage)
        m._FPDF_ClosePage(page)
      }
    }
    return results
  })
}

/**
 * Read-back verification: confirm every applied edit's replacement text is actually
 * extractable from the produced bytes. Runs on the final output (after the pdf-lib
 * round-trip), before it reaches disk — a failure aborts the save with the original
 * file untouched and the edits still pending, instead of silently losing work.
 * `pageIndex` here is the edit's page in the *final* document (caller remaps).
 */
export function verifyTextEdits(
  bytes: Uint8Array,
  edits: { pageIndex: number; newText: string }[],
): Promise<{ pageIndex: number; reason: string }[]> {
  return chainPdfium(async () => {
    const m = await loadPdfium()
    return withDocument(m, bytes, async (doc) => {
      const failures: { pageIndex: number; reason: string }[] = []
      const pageCount = m._FPDF_GetPageCount(doc)
      const byPage = new Map<number, string[]>()
      for (const e of edits) {
        if (e.pageIndex < 0 || e.pageIndex >= pageCount) {
          failures.push({ pageIndex: e.pageIndex, reason: 'page missing from saved output' })
          continue
        }
        byPage.set(e.pageIndex, [...(byPage.get(e.pageIndex) ?? []), e.newText])
      }
      for (const [pageIndex, texts] of byPage) {
        const page = m._FPDF_LoadPage(doc, pageIndex)
        if (!page) {
          for (const _ of texts)
            failures.push({ pageIndex, reason: 'page unreadable in saved output' })
          continue
        }
        const textPage = m._FPDFText_LoadPage(page)
        try {
          // NFC on both sides: ToUnicode CMaps canonicalize singleton codepoints (e.g.
          // compatibility ideograph U+F900 extracts as U+8C48) — the glyph on the page is
          // right, only the reverse mapping differs, and that must not abort the save
          const canon = (s: string) => norm(s.normalize('NFC'))
          const objects = collectTextObjects(m, page, textPage)
          const pageText = canon(objects.map((o) => o.text).join(''))
          // The object-preserving rebuild can leave a reflowed line contiguous
          // only visually, not in stream order — accept either
          const visualText = canon(joinRows(objects))
          for (const newText of texts) {
            // Every non-empty line must be extractable (rebuilt runs are one object per line)
            const missing = newText
              .split('\n')
              .map(canon)
              .filter((l) => l.length > 0 && !pageText.includes(l) && !visualText.includes(l))
            if (missing.length > 0) {
              const snippet = missing[0]!.slice(0, 20)
              failures.push({
                pageIndex,
                reason: `replacement text missing from saved output ("${snippet}")`,
              })
            }
          }
        } finally {
          m._FPDFText_ClosePage(textPage)
          m._FPDF_ClosePage(page)
        }
      }
      return failures
    })
  })
}
