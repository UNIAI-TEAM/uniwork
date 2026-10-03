// DOCX adapter lane (G2-03): engine seam, session model, password intents,
// asset oracle, and the contract adapter surface.
export * from "./engine";
// B8 chart surface: the insert spec types and their typed refusals, split out
// of the seam file to keep engine.ts inside the 500-line budget.
export * from "./chart";
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
