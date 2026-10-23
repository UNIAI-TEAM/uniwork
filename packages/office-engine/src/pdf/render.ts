// Page/image rasterization — split out of image.ts (the 500-line rule):
// renderImagePng (one image object → PNG), renderPageRegionPng (clipped page
// render with exclusion rects/annots) and verifyImageEdits (read-back that a
// baked image paints inside its rect). All in-memory; nothing writes back.
import type { Pdfium } from './pdfium.ts'
import { chainPdfium, FPDF_BITMAP_BGRA, loadPdfium, withDocument } from './pdfium.ts'
import { encodeBgraToPng } from './codec.ts'
import { collectObjects, matchImage, type Rect, type PageObj } from './image.ts'
import type {
  ImageEditFailure,
  ImageEditInput,
  PageRenderRequest,
} from './types.ts'
const RENDER_MAX_PX = 2400

/** Render one existing image object to PNG (base64) for the renderer's ghost preview.
    GetRenderedBitmap rasterizes at the object's on-page size (~1px per pt), so pixel
    edits pass scale > 1: the object matrix is enlarged before rendering (in-memory
    document only — nothing is written back) to keep the baked source sharp. */
export function renderImagePng(
  bytes: Uint8Array,
  pageIndex: number,
  rect: Rect,
  scale = 1,
): Promise<string | null> {
  return chainPdfium(async () => {
    const m = await loadPdfium()
    return withDocument(m, bytes, async (doc) => {
      const page = m._FPDF_LoadPage(doc, pageIndex)
      if (!page) return null
      try {
        const target = matchImage(collectObjects(m, page), rect)
        if (!target) return null
        const side = Math.max(
          target.bounds[2] - target.bounds[0],
          target.bounds[3] - target.bounds[1],
        )
        const k = Math.min(Math.max(1, scale), side > 0 ? RENDER_MAX_PX / side : 1)
        if (k > 1) m._FPDFPageObj_Transform(target.obj, k, 0, 0, k, 0, 0)
        const bmp = m._FPDFImageObj_GetRenderedBitmap(doc, page, target.obj)
        if (!bmp) return null
        try {
          const w = m._FPDFBitmap_GetWidth(bmp)
          const h = m._FPDFBitmap_GetHeight(bmp)
          const stride = m._FPDFBitmap_GetStride(bmp)
          const buf = m._FPDFBitmap_GetBuffer(bmp)
          if (!w || !h || !buf) return null
          const tight = Buffer.alloc(w * h * 4)
          for (let row = 0; row < h; row++) {
            tight.set(
              m.HEAPU8.subarray(buf + row * stride, buf + row * stride + w * 4),
              row * w * 4,
            )
          }
          const png = encodeBgraToPng(tight, w, h)
          return png.toString('base64')
        } finally {
          m._FPDFBitmap_Destroy(bmp)
        }
      } finally {
        m._FPDF_ClosePage(page)
      }
    })
  })
}

/**
 * Live-preview render: rasterize a page region with the given image objects removed
 * (in memory only — the file is untouched). The renderer patches the region over its
 * PDF.js canvas so a moved/resized/deleted image disappears immediately instead of
 * lingering until save. Unmatched rects are skipped fail-soft.
 */
export function renderPageRegionPng(
  bytes: Uint8Array,
  request: PageRenderRequest,
): Promise<string | null> {
  const {
    pageIndex,
    excludeRects = [],
    excludeAnnots,
    clip,
    pxWidth,
    rotate = 0,
  } = request
  return chainPdfium(async () => {
    const m = await loadPdfium()
    return withDocument(m, bytes, async (doc) => {
      const page = m._FPDF_LoadPage(doc, pageIndex)
      if (!page) return null
      try {
        for (const rect of excludeRects) {
          const target = matchImage(collectObjects(m, page), rect)
          if (target && m._FPDFPage_RemoveObject(page, target.obj)) {
            m._FPDFPageObj_Destroy(target.obj)
          }
        }
        if (excludeAnnots && excludeAnnots.length > 0) {
          const { removeMatchingAnnots } = await import('./annots.ts')
          removeMatchingAnnots(m, page, excludeAnnots)
        }
        // Page size in display orientation (pdfium already applies /Rotate; the
        // unsaved delta passed as quarter turns swaps the axes again when odd)
        const baseW = m._FPDF_GetPageWidthF(page)
        const baseH = m._FPDF_GetPageHeightF(page)
        const turns = ((rotate % 4) + 4) % 4
        const dispW = turns % 2 === 1 ? baseH : baseW
        const dispH = turns % 2 === 1 ? baseW : baseH
        if (clip.width <= 0 || clip.height <= 0 || pxWidth <= 0) return null
        const k = pxWidth / clip.width
        const w = Math.max(1, Math.round(pxWidth))
        const h = Math.max(1, Math.round(clip.height * k))
        const bufPtr = m._malloc(w * h * 4)
        const bmp = m._FPDFBitmap_CreateEx(w, h, FPDF_BITMAP_BGRA, bufPtr, w * 4)
        if (!bmp) {
          m._free(bufPtr)
          return null
        }
        try {
          m._FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xffffffff)
          // With annots excluded the clip must keep drawing the surviving annotations
          // (FPDF_ANNOT); image-only previews keep the historical annotation-free render
          const flags = excludeAnnots && excludeAnnots.length > 0 ? 1 /* FPDF_ANNOT */ : 0
          m._FPDF_RenderPageBitmap(
            bmp,
            page,
            Math.round(-clip.x * k),
            Math.round(-clip.y * k),
            Math.round(dispW * k),
            Math.round(dispH * k),
            turns,
            flags,
          )
          const tight = Buffer.from(m.HEAPU8.subarray(bufPtr, bufPtr + w * h * 4))
          const png = encodeBgraToPng(tight, w, h)
          return png.toString('base64')
        } finally {
          m._FPDFBitmap_Destroy(bmp)
          m._free(bufPtr)
        }
      } finally {
        m._FPDF_ClosePage(page)
      }
    })
  })
}

/**
 * Read-back verification on the final saved bytes (pageIndex already remapped to the
 * final document): inserts and transforms must be findable at their target rect.
 * Deletes are not re-checked — RemoveObject's status is verified at apply time, and a
 * second identical image at the same bounds would read as a false failure.
 */
export function verifyImageEdits(
  bytes: Uint8Array,
  edits: { pageIndex: number; rect: Rect }[],
): Promise<{ pageIndex: number; reason: string }[]> {
  return chainPdfium(async () => {
    const m = await loadPdfium()
    return withDocument(m, bytes, async (doc) => {
      const failures: { pageIndex: number; reason: string }[] = []
      const pageCount = m._FPDF_GetPageCount(doc)
      const byPage = new Map<number, Rect[]>()
      for (const e of edits) {
        if (e.pageIndex < 0 || e.pageIndex >= pageCount) {
          failures.push({ pageIndex: e.pageIndex, reason: 'page missing from saved output' })
          continue
        }
        byPage.set(e.pageIndex, [...(byPage.get(e.pageIndex) ?? []), e.rect])
      }
      for (const [pageIndex, rects] of byPage) {
        const page = m._FPDF_LoadPage(doc, pageIndex)
        if (!page) {
          for (const _ of rects)
            failures.push({ pageIndex, reason: 'page unreadable in saved output' })
          continue
        }
        try {
          const objects = collectObjects(m, page)
          for (const rect of rects) {
            if (!matchImage(objects, rect)) {
              failures.push({ pageIndex, reason: 'image missing from saved output' })
            }
          }
        } finally {
          m._FPDF_ClosePage(page)
        }
      }
      return failures
    })
  })
}
