// Folder limits shared by every client screen (folders contract v1.0,
// docs/superpowers/specs/2026-10-13-documents-folders-addendum.md §4). The
// server owns the rule; the client copies the signed values so it can refuse
// a move or a name before the request and say why. The server constant
// `maxDocumentDepth` lands with FD-03: re-prove TREE_MAX_LEVEL against it
// when it merges.

/** Deepest tree level (FD-D2); a root document counts as level one. */
export const TREE_MAX_LEVEL = 20;

/** Longest folder title, in characters (FD-D3). */
export const FOLDER_TITLE_MAX = 255;

/** Longest page or file title, in characters (FD-D3). */
export const DOCUMENT_TITLE_MAX = 500;
