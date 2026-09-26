// DOC-003 engine host: XLSX session routes on the native sidecar + xlsx-gateway.
//
// The renderer surface keeps the upstream shapes:
//   select/workbook open -> WorkbookFile-like {sessionId, sha256, sheets, ...}
//   recalc -> {cells:[{sheetId,row,column,formatted,number?,isError?,isFormula}]}
//   save   -> {canceled:false,file:{...},touchedEntries} and the touched entries
//   close  -> void
// A save must carry at least one real edit; an empty edit list is refused rather
// than reported as a successful no-op save. Failed saves keep the session open and
// dirty. The produced bytes are written to a private candidate, reopened by the
// real sidecar, and only then published once onto the named output, so a
// verification failure leaves the previous good output untouched.
import { basename } from "node:path";
import type { HostContext, RouteMap } from "./engine-host-context.mts";
import {
  EngineRequestError,
  optionalArray,
  optionalString,
  requireArray,
  requireString,
} from "./engine-host-context.mts";
import {
  EnginePathError,
  containExisting,
  containedChild,
  ensureDir,
  hasReparseComponent,
  isUnder,
} from "./engine-paths.mts";
import {
  copyWorkbookMetadata,
  sidecarBinaryPath,
  type XlsxGatewayCellEdit,
  type XlsxSession,
} from "./engine-xlsx.mts";

interface WorkbookSessionState {
  session: XlsxSession;
  dirty: boolean;
  savedPath?: string;
  savedTouched: readonly string[];
}

export function createXlsxRoutes(ctx: HostContext) {
  const states = new Map<string, WorkbookSessionState>();

  const requireState = (viewId: string): WorkbookSessionState => {
    const state = states.get(viewId);
    if (!state) throw new EngineRequestError("no_session", "no open workbook for view " + viewId);
    return state;
  };

  /**
   * The renderer-facing WorkbookFile. The rich metadata (styles, dxfStyles,
   * visuals, definedNames, entryCount, activeTab and the per-sheet dimensions and
   * view flags) comes from the sidecar via the session, exactly like the native
   * product path; it is not re-narrowed here. Only the route-owned identity
   * fields are added, so the payload the renderer receives satisfies the same
   * workbookFileSchema the preload validates.
   */
  const workbookFileOf = (session: XlsxSession, viewId: string): Record<string, unknown> => ({
    // Emit a fresh copy of the retained metadata, never the stored object itself:
    // a caller that mutates this payload must not reach into live session state.
    ...copyWorkbookMetadata(session.metadata),
    sessionId: session.sessionId,
    // After a successful save the session is rebound to the saved bytes, so the
    // renderer identity names the published output, not the open snapshot.
    name: basename(session.savedPath ?? session.sourcePath),
    path: session.savedPath ?? session.sourcePath,
    sha256: session.sha256,
    fileBytes: session.bytes,
    readOnly: false,
    // The transport-owned identity, kept beside the metadata like the product
    // path; the renderer surface in the lab reaches it through this wrapper.
    viewId,
  });

  const routes: RouteMap = {
    "/engine/xlsx-open": async (input) => {
      // Validate the view id before the sidecar starts or a session dir is made.
      const viewId = ctx.requireViewId(input.viewId);
      const sourcePath = ctx.labFile(input.path);
      const xlsx = await ctx.engines.xlsx;
      const binaryPath = optionalString(input.binaryPath, "binaryPath") ?? sidecarBinaryPath(ctx.source);
      const session = await xlsx.openFile({
        viewId,
        sourcePath,
        sessionDir: ctx.sessionDir(viewId),
        binaryPath,
        locale: optionalString(input.locale, "locale") ?? "en",
      });
      states.set(viewId, { session, dirty: false, savedTouched: [] });
      return { viewId, binaryPath, workbook: workbookFileOf(session, viewId) };
    },

    // Blank workbook: the renderer opens an empty session; it is created from a real
    // fixture copy (no fabricated WorkbookFile) so the session is usable immediately.
    "/engine/xlsx-open-blank": async (input) => {
      const viewId = ctx.requireViewId(input.viewId);
      // A real .xlsx in the lab: the session must be able to read/round-trip it,
      // so the route refuses to fabricate a WorkbookFile with empty sheets.
      const sourcePath = ctx.labFile(requireString(input.blankPath, "blankPath"));
      const xlsx = await ctx.engines.xlsx;
      const session = await xlsx.openFile({
        viewId,
        sourcePath,
        sessionDir: ctx.sessionDir(viewId),
        binaryPath: optionalString(input.binaryPath, "binaryPath") ?? sidecarBinaryPath(ctx.source),
        locale: optionalString(input.locale, "locale") ?? "en",
      });
      states.set(viewId, { session, dirty: false, savedTouched: [] });
      return { viewId, workbook: workbookFileOf(session, viewId) };
    },

    "/engine/xlsx-recalc": async (input) => {
      const state = requireState(requireString(input.viewId, "viewId"));
      const xlsx = await ctx.engines.xlsx;
      const edits = optionalArray<{ sheetId: string; row: number; column: number; input: string }>(
        input.edits,
        "edits",
      );
      const reads = optionalArray<{
        sheetId: string;
        range: { startRow: number; endRow: number; startColumn: number; endColumn: number };
      }>(input.reads, "reads");
      if (edits.length === 0 && reads.length === 0) {
        throw new EngineRequestError("bad_input", "a recalc needs at least one edit or read");
      }
      const result = await xlsx.recalc(state.session, edits, reads);
      if (edits.length > 0) state.dirty = true;
      return { sessionId: state.session.sessionId, cells: result.cells, dirty: state.dirty };
    },

    "/engine/xlsx-read-range": async (input) => {
      const state = requireState(requireString(input.viewId, "viewId"));
      const xlsx = await ctx.engines.xlsx;
      const sheetId = requireString(input.sheetId, "sheetId");
      const range = input.range as
        | { startRow: number; endRow: number; startColumn: number; endColumn: number }
        | undefined;
      if (!range) throw new EngineRequestError("bad_input", "read-range needs a range");
      return { result: await xlsx.readRange(state.session, sheetId, range) };
    },

    "/engine/xlsx-read-formulas": async (input) => {
      const state = requireState(requireString(input.viewId, "viewId"));
      const xlsx = await ctx.engines.xlsx;
      return xlsx.readFormulaCells(state.session, requireString(input.sheetId, "sheetId"));
    },

    "/engine/xlsx-save": async (input) => {
      const viewId = ctx.requireViewId(input.viewId);
      const state = requireState(viewId);
      const xlsx = await ctx.engines.xlsx;
      const edits = requireArray<{
        sheetId: string;
        row: number;
        column: number;
        writeValue: boolean;
        value: string | number | boolean | null;
        formula?: string;
        style?: unknown;
        rich?: unknown;
        styleReset?: boolean;
      }>(input.edits, "edits");
      const name = optionalString(input.name, "name") ?? basename(state.session.sourcePath);
      // Exactly one safe basename inside this view's own output directory. The
      // directory is only created once the lab and every existing component of it
      // are known clean: a name outside the lab, or any junction/symlink component
      // under it, is refused before mkdir, and the created directory is proven
      // contained before any engine write. A traversal/absolute name is bad_name.
      const outDir = ctx.outDir(viewId);
      let outPath: string;
      try {
        outPath = containedChild(outDir, name);
        if (!isUnder(ctx.lab, outDir)) {
          const message = "path outside the lab root: " + outDir;
          throw new EnginePathError("outside_write_root", message);
        }
        if (hasReparseComponent(ctx.lab, outDir)) {
          const message = "refusing to follow a link inside the lab: " + outDir;
          throw new EnginePathError("reparse_point", message);
        }
        await ensureDir(outDir);
        containExisting(ctx.lab, outDir, "outside_write_root");
      } catch (error) {
        if (error instanceof EnginePathError) {
          throw new EngineRequestError(error.code, error.message);
        }
        throw error;
      }
      const formulaValues = optionalArray<{ sheetId: string; row: number; column: number; value: unknown }>(
        input.formulaValues,
        "formulaValues",
      );
      const structuralOps = optionalArray<{ sheetId: string; kind: string }>(input.structuralOps, "structuralOps");
      const gatewayEdits: XlsxGatewayCellEdit[] = edits.map((edit) => ({
        sheetName: xlsx.sheetName(state.session, edit.sheetId),
        row: edit.row,
        column: edit.column,
        writeValue: edit.writeValue,
        cell: { value: edit.value, ...(edit.formula === undefined ? {} : { formula: edit.formula }) },
        ...(edit.style === undefined ? {} : { style: edit.style }),
        ...(edit.rich === undefined ? {} : { rich: edit.rich }),
        ...(edit.styleReset === undefined ? {} : { styleReset: edit.styleReset }),
      }));
      const groupedStructural = [...new Set(structuralOps.map((op) => op.sheetId))].map((sheetId) => ({
        sheetName: xlsx.sheetName(state.session, sheetId),
        ops: structuralOps.filter((op) => op.sheetId === sheetId).map(({ kind, ...rest }) => ({ kind, ...rest })),
      }));
      const groupedFormulaValues = [...new Set(formulaValues.map((v) => v.sheetId))].map((sheetId) => ({
        sheetName: xlsx.sheetName(state.session, sheetId),
        cells: formulaValues
          .filter((value) => value.sheetId === sheetId)
          .map((value) => ({ row: value.row, column: value.column, value: value.value })),
      }));
      const result = await xlsx.save({
        session: state.session,
        outPath,
        edits: gatewayEdits,
        structuralOps: groupedStructural,
        formulaValues: groupedFormulaValues,
      });
      state.dirty = false;
      state.savedPath = result.path;
      state.savedTouched = result.touched;
      return {
        canceled: false,
        touchedEntries: result.touched,
        saved: result,
        file: workbookFileOf(state.session, viewId),
      };
    },

    "/engine/xlsx-close": async (input) => {
      const viewId = requireString(input.viewId, "viewId");
      const expectedSessionId = optionalString(input.sessionId, "sessionId");
      const state = states.get(viewId);
      if (!state) return { closed: false };
      const xlsx = await ctx.engines.xlsx;
      // Save replaces the session before the renderer disposes its old workbook.
      // This id only guards the trusted view; it never selects another view.
      if (states.get(viewId) !== state ||
          (expectedSessionId !== undefined && expectedSessionId !== state.session.sessionId)) {
        return { closed: false };
      }
      const closedSessionId = state.session.sessionId;
      await xlsx.close(viewId);
      if (states.get(viewId) === state && state.session.sessionId === closedSessionId) states.delete(viewId);
      return { closed: true, sessionId: closedSessionId };
    },

    "/engine/xlsx-is-dirty": async (input) => ({
      dirty: requireState(requireString(input.viewId, "viewId")).dirty,
    }),
  };

  const closeSession = async (viewId: string): Promise<boolean> => states.delete(viewId);

  /**
   * Drop every held workbook state on host shutdown. The sidecar sessions are
   * released by the host's started-engine close; clearing local state alone must
   * never start an engine for a host that never opened a workbook.
   */
  const closeAll = async (): Promise<void> => {
    states.clear();
  };

  return { routes, closeSession, closeAll, states };
}
