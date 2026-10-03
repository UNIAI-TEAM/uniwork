import type { PdfOpsBridgeOptions } from "../ops-bridge";

export interface PdfInkInput {
  pageIndex: number;
  points: { x: number; y: number }[];
  color: [number, number, number];
  width: number;
}

export interface PdfInkEngineOperation {
  op: "addDrawing";
  attributes: { drawing: { pageIndex: number; kind: "ink"; geometry: { points: { x: number; y: number }[] }; color: [number, number, number]; width: number } };
}

export interface PdfInkOperationProvider {
  addInk(input: PdfInkInput): Promise<void> | void;
}

export interface PdfInkOperationSubmitter {
  submit(operations: readonly PdfInkEngineOperation[]): Promise<void> | void;
}

export type PdfInkProviderOptions = Pick<PdfOpsBridgeOptions, "pageOrder">;
