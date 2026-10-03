// DOCX adapter lane (G2-03): engine seam, session model, password intents,
// asset oracle, and the contract adapter surface.
export * from "./engine";
export * from "./model";
// B7 field surface: the TOC line/caption builders and their payload types —
// the editor lays out the same field XML it later saves.
export * from "./fields";
// B9 shape surface: the basic shape paragraph builder (OOXML fragment +
// display) the editor inserts as a docProtected genXml node.
export * from "./shapes";
export * from "./password";
export * from "./protection";
export * from "./assets";
export * from "./adapter";
export * from "./vendor";
