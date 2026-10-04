import type { PdfDrawingType } from "../types";
import type { PdfOpsBridgeOptions } from "../ops-bridge";

export type { PdfDrawingType };

export interface PdfDrawingInput {
  pageIndex: number;
  kind: PdfDrawingType | "ink";
  geometry: PdfDrawingGeometry;
  color: [number, number, number];
  width: number;
  fill?: [number, number, number];
}

export type PdfDrawingGeometry =
  | { rect: { x: number; y: number; width: number; height: number } }
  | { start: { x: number; y: number }; end: { x: number; y: number } }
  | { points: { x: number; y: number }[] };

export interface PdfDrawingEngineOperation {
  op: "addDrawing";
  attributes: { drawing: PdfDrawingInput };
}

export interface PdfDrawingOperationProvider {
  addDrawing(input: PdfDrawingInput): Promise<void> | void;
}

export interface PdfDrawingOperationSubmitter {
  submit(operations: readonly PdfDrawingEngineOperation[]): Promise<void> | void;
}

export type PdfDrawingProviderOptions = Pick<PdfOpsBridgeOptions, "pageOrder">;
