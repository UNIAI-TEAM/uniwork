// @uniwork/views HTML visual inline edit (H8). The bridge that turns the H5
// selection's toolbar actions and the S1 inspector's text-edit commit into H3
// ops applied through the caller's engine port. Flag-gated on the H5 flag.
//
// The barrel re-exports the host-facing surface plus the pure op/validation
// helpers its tests exercise; nothing here is dead surface.
export { useHtmlInlineEdit, type HtmlInlineEditCommands, type HtmlInlineEditController, type HtmlInlineEditPort, type InlineEditInspector } from "./bridge";
export { moveSelectionOp, resizeSelectionOp, textEditOp, type ResizeInput } from "./ops";
export { clampResizeValue, INLINE_MAX_TEXT, parseTextEditCommit, type InlineTextCommit } from "./model";
