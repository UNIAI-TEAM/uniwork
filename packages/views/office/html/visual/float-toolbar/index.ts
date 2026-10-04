// @uniwork/views HTML visual float toolbar (H6). A pure, flag-gated contextual
// toolbar anchored to the H5 selection; every action is an injected callback so
// this module never edits the document itself.
export { HtmlFloatToolbar, type HtmlFloatToolbarCommands, type HtmlFloatToolbarProps, type HtmlFloatToolbarState } from "./float-toolbar";
export { FLOAT_TOOLBAR_GAP, FLOAT_TOOLBAR_MIN_HEIGHT, floatAnchor, renderableRect, selectionBox, type CanvasBox, type HtmlFloatAnchor } from "./geometry";
