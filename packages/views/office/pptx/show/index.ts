"use client";

/**
 * Slide-show surface barrel (C2, UNI-927).
 *
 * The show and the presenter view are views over the editor's existing session:
 * the caller owns the index, the deck model and the rendition, and reports the
 * exit. Nothing here imports the editor or the shared chrome.
 */
export { PptxSlideShow, type PptxSlideShowProps } from "./pptx-slide-show";
export { PptxPresenterView, type PptxPresenterViewProps } from "./pptx-presenter-view";
export {
  applyShowNavAction,
  clampSlideIndex,
  formatElapsedClock,
  isShowNavNoop,
  resolveShowNavAction,
  type PptxShowNavAction,
} from "./show-nav";
export {
  PPTX_SHOW_I18N,
  pptxShowResources,
  registerPptxShowI18n,
  type PptxShowI18nEntry,
} from "./show-i18n";
export { presenterNextSlideContent, presenterSlideContent } from "./presenter-rendition";
