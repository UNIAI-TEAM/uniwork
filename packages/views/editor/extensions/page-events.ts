/**
 * Bubbling DOM events the page editor raises for the surface that owns the
 * work: the document view flushes its autosave on a save request, the page
 * toolbar opens its link popover on a link request. The editor knows neither.
 *
 * Kept apart from `page-shortcuts.ts` so the document view can listen without
 * pulling Tiptap into the chunk it loads the editor lazily to avoid.
 */
export const PAGE_SAVE_REQUEST_EVENT = "uniwork:page-save-request";
export const PAGE_LINK_REQUEST_EVENT = "uniwork:page-link-request";
