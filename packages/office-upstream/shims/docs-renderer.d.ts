import type { Extensions, JSONContent } from "@tiptap/core";

export interface RendererRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  [key: string]: unknown;
}
export interface RendererBlock {
  type: string;
  docxIndex: number | null;
  hidden?: boolean;
  runs?: RendererRun[];
  [key: string]: unknown;
}
export interface RendererGeneratedBlock {
  type: "paragraph" | "heading" | "listItem";
  runs: RendererRun[];
  [key: string]: unknown;
}
export interface RendererParsed {
  blocks: RendererBlock[];
  [key: string]: unknown;
}
export const editorExtensions: Extensions;
export function blocksToPmDoc(blocks: RendererBlock[], sections?: unknown[], options?: { legacyTableIndent?: boolean }): JSONContent;
export function pmDocOptions(parsed: { compatibilityMode?: number }): { legacyTableIndent?: boolean };
export function inlineToRuns(content: JSONContent[]): RendererRun[];
export function pmNodeToGeneratedBlock(node: JSONContent): RendererGeneratedBlock;
export function pmDocToSavePlan(doc: JSONContent, originalBlocks: RendererBlock[]): { saveBlocks: unknown[]; changedCount: number; deletedCount: number; [key: string]: unknown };
export function parseDocx(bytes: Uint8Array, options?: Record<string, unknown>): Promise<RendererParsed>;
export function saveDocx(parsed: RendererParsed, blocks: unknown[], options?: Record<string, unknown>): Promise<Uint8Array>;
