// The find feature's public surface: the chrome-slot adapter the shell mounts,
// the schema extension that publishes the live editor, and the open/close
// commands (A9's Ctrl+F binding calls `toggleDocxFind`). Engine internals stay
// in their modules; only tests import them directly.
export { DocxFindPanel } from "./docx-find-panel";
export type { DocxFindPanelProps } from "./find-panel";
export { DocxFindExtension, getDocxFindEditor, subscribeDocxFindEditor } from "./find-extension";
export { closeDocxFind, isDocxFindOpen, subscribeDocxFind, toggleDocxFind } from "./find-store";
