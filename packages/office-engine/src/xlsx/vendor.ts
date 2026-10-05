// XLSX vendored-engine binding — maps the packages/office-upstream build
// artifact (dist/xlsx-gateway.mjs, produced by scripts/office/build-upstream.mjs
// over the PATCHED scratch tree — patch 0001 fixes cellXfs dedupe) onto the
// seam in ./engine. The module object arrives already resolved (the node
// entry or the replay driver performs the dynamic import), so this file stays
// free of Node/fs/canvas and the browser boundary holds.
//
// Upstream surface bound here (pinned 09485f88 + patch 0001):
//   dist/xlsx-gateway.mjs -> readBasicWorkbook / inventoryXlsx /
//     createBufferEntrySource / applyCellEditsToXlsx /
//     assertOnlyTouchedEntriesChanged
import { EngineBoundaryError } from "@uniwork/office-contracts";
import type {
  XlsxCellEdit,
  XlsxGatewayArguments,
  XlsxGatewayFunctions,
  XlsxImported,
  XlsxMutation,
  XlsxPackageEntry,
  XlsxSheetFormulaValues,
} from "./engine.ts";

/** The xlsx-gateway bundle's export surface (subset this seam consumes). */
export interface UpstreamXlsxGatewayModule {
  readBasicWorkbook(buffer: Uint8Array): Promise<XlsxImported>;
  inventoryXlsx(buffer: Uint8Array): Promise<readonly XlsxPackageEntry[]>;
  createBufferEntrySource(buffer: Uint8Array): Promise<{
    paths(): Promise<readonly string[]>;
    has(path: string): Promise<boolean>;
    readText(path: string): Promise<string>;
  }>;
  applyCellEditsToXlsx(
    source: Uint8Array,
    edits: readonly XlsxCellEdit[],
    structuralOps?: readonly unknown[],
    chartEdits?: readonly unknown[],
    sheetPlan?: unknown,
    filterStates?: readonly unknown[],
    hyperlinkEdits?: readonly unknown[],
    cfStates?: readonly unknown[],
    dvStates?: readonly unknown[],
    sheetProtections?: readonly unknown[],
    definedNamesState?: unknown,
    pageSetupStates?: readonly unknown[],
    noteStates?: readonly unknown[],
    tableAdditions?: readonly unknown[],
    formulaValues?: readonly XlsxSheetFormulaValues[],
  ): Promise<XlsxMutation>;
  assertOnlyTouchedEntriesChanged(mutation: XlsxMutation): void;
}

/** The upstream signatures type their inputs as Buffer; jszip underneath
 *  accepts Uint8Array. On Node hosts hand a zero-copy Buffer view; where
 *  Buffer does not exist (browser/workerd) pass the bytes as-is. */
const toEngineBytes = (bytes: Uint8Array): Uint8Array =>
  typeof Buffer === "undefined"
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const toBytes = (out: Uint8Array): Uint8Array =>
  out instanceof Uint8Array ? new Uint8Array(out.buffer, out.byteOffset, out.byteLength) : out;

function assertMutationShape(mutation: XlsxMutation): void {
  if (
    !mutation ||
    !(mutation.buffer instanceof Uint8Array) ||
    !Array.isArray(mutation.touchedEntries) ||
    !Array.isArray(mutation.removedEntries) ||
    !Array.isArray(mutation.addedEntries) ||
    !Array.isArray(mutation.beforeEntries) ||
    !Array.isArray(mutation.afterEntries)
  ) {
    throw new EngineBoundaryError("engine_result_invalid", {
      detail: "xlsx gateway returned a malformed mutation result",
    });
  }
}

/** Bind the vendored xlsx-gateway artifact to the seam. Missing exports are a
 *  typed boundary error at bind time, not a TypeError mid-save. */
export function bindXlsxGateway(mod: Partial<UpstreamXlsxGatewayModule>): XlsxGatewayFunctions {
  for (const key of [
    "readBasicWorkbook",
    "inventoryXlsx",
    "createBufferEntrySource",
    "applyCellEditsToXlsx",
    "assertOnlyTouchedEntriesChanged",
  ] as const) {
    if (typeof mod[key] !== "function") {
      throw new EngineBoundaryError("engine_incompatible", { detail: "xlsx gateway artifact lacks " + key });
    }
  }
  const gateway = mod as UpstreamXlsxGatewayModule;
  return {
    async readWorkbook(bytes: Uint8Array): Promise<XlsxImported> {
      const imported = await gateway.readBasicWorkbook(toEngineBytes(bytes));
      if (!imported?.snapshot || !Array.isArray(imported.snapshot.sheets)) {
        throw new EngineBoundaryError("engine_result_invalid", { detail: "xlsx gateway returned a malformed snapshot" });
      }
      return imported;
    },
    async inventory(bytes: Uint8Array): Promise<readonly XlsxPackageEntry[]> {
      return gateway.inventoryXlsx(toEngineBytes(bytes));
    },
    async readEntryText(bytes: Uint8Array, path: string): Promise<string | null> {
      const source = await gateway.createBufferEntrySource(toEngineBytes(bytes));
      if (!(await source.has(path))) return null;
      return source.readText(path);
    },
    async readEntriesText(bytes: Uint8Array, paths: readonly string[]): Promise<Readonly<Record<string, string | null>>> {
      const source = await gateway.createBufferEntrySource(toEngineBytes(bytes));
      const out: Record<string, string | null> = {};
      for (const path of paths) {
        out[path] = (await source.has(path)) ? await source.readText(path) : null;
      }
      return out;
    },
    async applyCellEdits(
      source: Uint8Array,
      edits: readonly XlsxCellEdit[],
      formulaValues: readonly XlsxSheetFormulaValues[] = [],
      gatewayArguments: XlsxGatewayArguments = {},
    ): Promise<XlsxMutation> {
      // Positional tail of applyCellEditsToXlsx this lane binds. Each slot's
      // absent/empty default reproduces the pre-arguments call exactly:
      //   structuralOps [], chartEdits [], sheetPlan undefined,
      //   filterStates [], hyperlinkEdits [], cfStates [], dvStates [],
      //   sheetProtections [], definedNamesState null, pageSetupStates [],
      //   noteStates [], tableAdditions [], formulaValues.
      const mutation = await gateway.applyCellEditsToXlsx(
        toEngineBytes(source),
        edits,
        gatewayArguments.structuralOps ?? [],
        gatewayArguments.chartEdits ?? [],
        gatewayArguments.sheetPlan,
        gatewayArguments.filterStates ?? [],
        gatewayArguments.hyperlinkEdits ?? [],
        gatewayArguments.cfStates ?? [],
        gatewayArguments.dvStates ?? [],
        gatewayArguments.sheetProtections ?? [],
        gatewayArguments.definedNamesState ?? null,
        gatewayArguments.pageSetupStates ?? [],
        gatewayArguments.noteStates ?? [],
        gatewayArguments.tableAdditions ?? [],
        formulaValues,
      );
      assertMutationShape(mutation);
      return { ...mutation, buffer: toBytes(mutation.buffer) };
    },
    assertPreserved(mutation: XlsxMutation): void {
      gateway.assertOnlyTouchedEntriesChanged(mutation);
    },
  };
}
