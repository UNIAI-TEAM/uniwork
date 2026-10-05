"use client";

/**
 * Slide-show surface barrel (C2, UNI-927).
 *
 * The show and the presenter view are views over the editor's existing session:
 * the caller owns the index, the deck model and the rendition, and reports the
 * exit. Nothing here imports the editor or the shared chrome.
 */

export { PptxPresenterView } from "./pptx-presenter-view";

export { presenterNextSlideContent, presenterSlideContent } from "./presenter-rendition";
