// @uniwork/views HTML visual float toolbar (H6). A pure, flag-gated contextual
// toolbar anchored to the H5 selection; every action is an injected callback so
// this module never edits the document itself.
//
// The barrel re-exports only what a host mounts. The geometry helpers and the
// props/state types stay on their own modules (imported directly by the
// component and its tests) so this list carries no unused surface.
export { HtmlFloatToolbar, textColourValue, type HtmlFloatToolbarCommands } from "./float-toolbar";
export { colourEdit, deleteEdit, duplicateEdit, fontSizeEdit, isDocumentStructure, toggleMarkEdit } from "./actions";
