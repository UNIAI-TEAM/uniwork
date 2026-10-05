import type { PdfCanvasPage, PdfPageRenderService } from "../canvas";

export interface PdfOutlineItem {
  id: string;
  title: string;
  page: number;
  level?: number;
  children?: readonly PdfOutlineItem[];
}

export type PdfZoomMode = "manual" | "fit-width" | "fit-page";

export interface PdfViewProps {
  pages: readonly PdfCanvasPage[];
  renderer: PdfPageRenderService;
  outline?: readonly PdfOutlineItem[];
  initialZoom?: number;
  zoom?: number;
  currentPage?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  onZoomChange?: (zoom: number, mode: PdfZoomMode) => void;
  onPageChange?: (page: number) => void;
  onOutlineSelect?: (item: PdfOutlineItem) => void;
  className?: string;
}
