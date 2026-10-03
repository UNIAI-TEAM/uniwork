// The find feature's public surface: the chrome-slot adapter the shell mounts,
// the schema extension that publishes the live editor, and the open/close
// commands (A9's Ctrl+F binding calls `openDocxFind`/`toggleDocxFind`). Engine
// internals stay in their modules; only tests import them directly.
// The adapter's props are `Pick<DocxToolbarGroupContext, "readOnly">`; it takes
// no other props, so no props type is re-exported here.
export { DocxFindPanel } from "./docx-find-panel";
export { DocxFindExtension, getDocxFindEditor, subscribeDocxFindEditor } from "./find-extension";
export { closeDocxFind, isDocxFindOpen, openDocxFind, subscribeDocxFind, toggleDocxFind } from "./find-store";
