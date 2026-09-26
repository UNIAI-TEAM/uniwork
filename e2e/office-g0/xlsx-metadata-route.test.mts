// DOC-003 (UNI-667) XLSX open/route metadata-contract regression (r26 correction TWO).
//
// No browser, no build, no prepared-source import: this drives the REAL
// createXlsxEngine dependency-injection seam (injected sidecar client + gateway)
// and the REAL createXlsxRoutes route family over real lab paths, so the producer
// boundary under test is the one that ships.
//
// The gateway fake WRITES real bytes into the test's private temp root, so the
// engine's own readFile(candidate) and rename(candidate, outPath) execute the real
// path instead of a logged no-op. Every sidecar open gets its OWN client object and
// its OWN sessionId, so client/session rebinding and old-client cleanup are
// observable rather than assumed.
//
// Pins:
//   T1 a real, rich, NON-DEFAULT workbook/sheet payload survives open and the route
//      response unchanged (entryCount/activeTab/styles/dxfStyles/visuals/definedNames
//      and per-sheet dimensions, view flags, widths, non-empty defaulted arrays and
//      optional metadata).
//   T2 the thin {id,name} shape that produced the browser map failure is refused by
//      name, never padded into a plausible success.
//   T3 an out-of-contract REQUIRED field is refused by name and the sidecar is
//      released, with no session bound.
//   T4 ONLY the three upstream-defaulted arrays may be OMITTED, and they materialize
//      as empty arrays; no other absent required field is silently invented.
//   T5 a save rebinds the session to the REOPENED metadata of a DISTINCT client and
//      sessionId, survives on the new live client, cleans up only the old one, and
//      preserves the renderer identity and the input-snapshot ownership.
//   T6 an explicit null for a schema-defaulted array is a NAMED refusal (only an
//      OMITTED member defaults); real non-empty arrays are retained.
//   T7 malformed workbook / sheet item / reopened payloads are NAMED errors, never
//      TypeError; a failed verification preserves the previous good output and
//      session and stops only the acquired next client.
//   T8 metadata ownership is asserted in two focused cases: an emitted payload
//      never aliases stored session state and mutating it cannot reach the
//      session (T8a); the sidecar's response object is not stored state, a
//      post-open response mutation cannot reach either session, retention does
//      not mutate the sidecar's object, and sibling sessions stay isolated (T8b).
//   T9 a reopened payload whose metadata is otherwise VALID but whose sessionId
//      is missing or blank still fails the save by name (the verifiedSessionIdOf
//      path), preserving the previous good output and session.
//
//   node <prepared-engine-source>/node_modules/tsx/dist/cli.mjs --test e2e/office-g0/xlsx-metadata-route.test.mts

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createPaths } from "./engine-host-context.mts";
import { sha256, snapshotCopy } from "./engine-paths.mts";
import {
  createXlsxEngine,
  type XlsxGatewayLike,
  type XlsxOpenedWorkbook,
  type XlsxSidecarLike,
} from "./engine-xlsx.mts";
import { createXlsxRoutes } from "./engine-xlsx-routes.mts";
import type { HostContext } from "./engine-host-context.mts";

type Json = Record<string, unknown>;

const SESSION_OPEN = "11111111-1111-4111-8111-111111111111";
const SESSION_REOPENED = "22222222-2222-4222-8222-222222222222";

/**
 * A bounds-checked indexed read. The repo builds with noUncheckedIndexedAccess,
 * so items[i] is T | undefined. Each fixture array-element read in the test
 * bodies goes through this helper, which fails loudly instead of letting an
 * undefined element be read as if it were a real fixture value. (r26 correction
 * TWO: this helper was referenced 29 times in the r25 candidate - 25 bare
 * at(...) call sites plus 4 ...at(...) spreads - but was never defined there;
 * node --check could not detect that, because it parses a file without
 * resolving identifiers.)
 */
function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    assert.fail('expected an element at index ' + index);
  }
  return value;
}

/**
 * A PARTIAL required-field check over the upstream workbookFileSchema
 * (bootstrap-source/apps/sheets/src/shared/desktop-api.ts:62-293, 701-771).
 *
 * This is deliberately NOT a full upstream schema validation. It checks the
 * container kinds and the selected required scalars/arrays this repair emits, and
 * it does NOT model the nested style/visual/table/pivot schemas, the .strict()
 * unknown-key rules or the optional members. It is a violation LIST so a failure
 * names what the producer actually omitted; a clean list means "the fields this
 * test pins are present and of the right kind", not "the payload would pass the
 * full upstream parse".
 */
const SHEET_REQUIRED = [
  "id", "name", "rowCount", "columnCount", "columnWidths", "hidden", "tabColor",
  "showGridLines", "freeze", "defaultRowHeight", "defaultColumnWidth",
  "tables", "comments", "pivotRanges",
];
const SHEET_DEFAULTED_ARRAYS = ["pivotTables", "sparklines", "cellImages"];
const WORKBOOK_REQUIRED_ARRAYS = ["styles", "dxfStyles", "visuals", "definedNames"];

function partialContractViolations(workbook: unknown): string[] {
  const bad: string[] = [];
  if (workbook === null || typeof workbook !== "object") return ["workbook is not an object"];
  const record = workbook as Json;
  for (const key of WORKBOOK_REQUIRED_ARRAYS) {
    if (!Array.isArray(record[key])) bad.push("workbook." + key + " is not an array");
  }
  for (const key of ["entryCount", "activeTab"]) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      bad.push("workbook." + key + " is not a non-negative integer");
    }
  }
  const sheets = record.sheets;
  if (!Array.isArray(sheets) || sheets.length === 0) {
    bad.push("workbook.sheets is not a non-empty array");
    return bad;
  }
  sheets.forEach((sheet: unknown, index: number) => {
    if (sheet === null || typeof sheet !== "object") {
      bad.push("sheets[" + index + "] is not an object");
      return;
    }
    const row = sheet as Json;
    for (const key of SHEET_REQUIRED) {
      if (!(key in row)) bad.push("sheets[" + index + "]." + key + " is missing");
    }
    if (typeof row.rowCount !== "number" || !Number.isInteger(row.rowCount) || row.rowCount < 1) {
      bad.push("sheets[" + index + "].rowCount is not a positive integer");
    }
    if (typeof row.columnCount !== "number" || !Number.isInteger(row.columnCount) || row.columnCount < 1) {
      bad.push("sheets[" + index + "].columnCount is not a positive integer");
    }
    for (const key of SHEET_DEFAULTED_ARRAYS) {
      if (!(key in row)) bad.push("sheets[" + index + "]." + key + " is missing (defaulted upstream)");
      else if (!Array.isArray(row[key])) bad.push("sheets[" + index + "]." + key + " is not an array");
    }
  });
  return bad;
}

/**
 * The rich, deliberately NON-DEFAULT payload the sidecar returns. Every call
 * builds fresh nested objects, so a case can vary one thing at a time and no two
 * cases share a reference. `overrides` replaces members.
 */
function richMetadata(overrides: Json = {}): Json & { sheets: Json[] } {
  const sheets: Json[] = [
    {
      id: "sheet-1",
      name: "Data",
      rowCount: 4096,
      columnCount: 64,
      sourceXmlBytes: 51234,
      columnWidths: [
        { startColumn: 0, endColumn: 3, width: 22.5, hidden: false, outlineLevel: 2, collapsed: true, styleIndex: 3 },
      ],
      defaultRowHeight: 21.5,
      defaultRowHeightFixed: true,
      defaultColumnWidth: 9.75,
      baseColumnWidth: 8,
      freeze: { frozenColumns: 1, frozenRows: 2 },
      hidden: false,
      tabColor: "#00B050",
      showGridLines: false,
      showFormulas: true,
      showRowColHeaders: false,
      rightToLeft: true,
      zoomScale: 150,
      tables: [
        {
          range: { startRow: 0, startColumn: 0, endRow: 9, endColumn: 3 },
          headerRowCount: 1,
          showRowStripes: true,
          showColumnStripes: false,
          name: "Sales",
        },
      ],
      comments: [{ row: 4, column: 1, author: "QA", text: "check" }],
      pivotRanges: [{ startRow: 20, startColumn: 0, endRow: 30, endColumn: 3 }],
      pivotTables: [
        {
          path: "xl/pivotTables/pivotTable1.xml",
          cachePath: "xl/pivotCache/pivotCacheDefinition1.xml",
          outputRef: "A20",
          firstDataCol: 0,
          rowGrandTotals: false,
          rowKinds: "dstd",
        },
      ],
      sparklines: [{ type: "line", cells: [{ cell: "D5", sourceRef: "Data!A1:C1" }] }],
      cellImages: [{ id: "img-1", row: 6, column: 2 }],
      printArea: "Data!$A$1:$D$40",
      printTitles: "Data!$1:$1",
      hasScopedDefinedNames: true,
    },
    {
      id: "sheet-2",
      name: "Chart Data",
      rowCount: 128,
      columnCount: 12,
      columnWidths: [],
      defaultRowHeight: null,
      defaultColumnWidth: null,
      freeze: null,
      hidden: true,
      tabColor: null,
      showGridLines: true,
      tables: [],
      comments: [],
      pivotRanges: [],
      // The three schema-defaulted arrays are PRESENT (and non-empty where the
      // fixture means to show retention) so every sheet of this shared fixture is
      // complete for partialContractViolations. T4 removes them explicitly to prove
      // the omission-default, and T6 supplies an explicit null to prove refusal;
      // leaving them absent here made T9 fail its own setup before the engine ran.
      pivotTables: [],
      sparklines: [{ type: "column", cells: [{ cell: "B2", sourceRef: "Data!A1:B2" }] }],
      cellImages: [{ id: "img-2", row: 2, column: 1 }],
    },
  ];
  const base: Json = {
    sessionId: SESSION_OPEN,
    name: "g0-compatibility-edit.xlsx",
    entryCount: 137,
    activeTab: 1,
    styles: [
      {
        bold: true, italic: false, underline: false, strikethrough: false, wrapText: false,
        diagonalUp: false, diagonalDown: false, fontColor: "#C00000", numberFormat: "0.00%",
      },
    ],
    dxfStyles: [
      {
        bold: false, italic: true, underline: false, strikethrough: false, wrapText: true,
        diagonalUp: false, diagonalDown: false, fillColor: "#FFF2CC",
      },
    ],
    visuals: [
      {
        id: "vis-1", sheetId: "sheet-2", kind: "chart", anchor: {},
        chart: { chartTypes: ["column"], title: "Revenue", series: [] },
      },
    ],
    definedNames: [{ name: "TaxRate", formula: "Data!$B$2", sheetIndex: 1 }],
    themeColors: [
      "#FFFFFF", "#000000", "#E7E6E6", "#44546A", "#4472C4", "#ED7D31",
      "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47", "#0563C1", "#954F72",
    ],
    sheets,
  };
  const merged: Json = { ...base, ...overrides };
  return merged as Json & { sheets: Json[] };
}

interface OpenObservation {
  clientId: string;
  path: string;
  sessionId: string;
}

interface SidecarSeen {
  opens: OpenObservation[];
  reads: string[];
  closes: string[];
  stops: string[];
}

/**
 * A sidecar factory that answers with a chosen payload and records which CLIENT
 * performed each open, read, close and stop. Every call to createClient returns a
 * brand-new object, so a rebinding is observable as a different clientId rather
 * than inferred from a shared fake.
 */
function sidecarFactory(
  payloadFor: (openNumber: number, clientId: string) => unknown,
): { createClient: () => XlsxSidecarLike; seen: SidecarSeen } {
  const seen: SidecarSeen = { opens: [], reads: [], closes: [], stops: [] };
  let clients = 0;
  const createClient = (): XlsxSidecarLike => {
    clients += 1;
    const clientId = "client-" + clients;
    return {
      async open(path: string): Promise<XlsxOpenedWorkbook> {
        const payload = payloadFor(seen.opens.length + 1, clientId);
        const raw = payload as Record<string, unknown> | null;
        seen.opens.push({
          clientId,
          path,
          sessionId: raw !== null && typeof raw === "object" ? String(raw.sessionId) : "(none)",
        });
        // Hand the payload over RAW: refusing an out-of-contract response is the
        // ENGINE's job, so the fake must not pre-validate it.
        return payload as XlsxOpenedWorkbook;
      },
      async recalcCells(): Promise<{ cells: unknown[] }> {
        return { cells: [] };
      },
      async readRange(): Promise<unknown> {
        seen.reads.push(clientId);
        return { clientId };
      },
      async readFormulaCells(): Promise<{ cells: unknown[] }> {
        return { cells: [{ row: 0, column: 0 }] };
      },
      async close(): Promise<void> {
        seen.closes.push(clientId);
      },
      stop(): void {
        seen.stops.push(clientId);
      },
    };
  };
  return { createClient, seen };
}

interface GatewaySeen {
  writes: { path: string; bytes: number }[];
  asserts: number;
}

/**
 * A gateway that WRITES REAL BYTES to the path it is given. The engine then
 * readFile()s the candidate and rename()s it onto the output, so those two calls
 * exercise the real filesystem path instead of a logged no-op. It still never
 * builds a real zip, so no native tooling is involved.
 */
function gatewayWritingToDisk(): { gateway: XlsxGatewayLike; seen: GatewaySeen } {
  const seen: GatewaySeen = { writes: [], asserts: 0 };
  const gateway: XlsxGatewayLike = {
    async applyCellEditsToXlsx(): Promise<{ buffer: Buffer; touchedEntries: readonly string[] }> {
      return {
        buffer: Buffer.from("PK\u0003\u0004saved-workbook-bytes"),
        touchedEntries: ["xl/worksheets/sheet1.xml"],
      };
    },
    async writeXlsxAtomically(path: string, buffer: Buffer): Promise<void> {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, buffer);
      seen.writes.push({ path, bytes: buffer.length });
    },
    assertOnlyTouchedEntriesChanged(): void {
      seen.asserts += 1;
    },
  };
  return { gateway, seen };
}

function makeLab(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const lab = join(root, "lab");
  mkdirSync(lab, { recursive: true });
  const fixture = join(lab, "g0-compatibility-edit.xlsx");
  writeFileSync(fixture, Buffer.from("PK\u0003\u0004lab-fixture-bytes"));
  return { root, lab, fixture, fixtureBytes: readFileSync(fixture) };
}

/** The real lab paths (real containment + real snapshot copy) around injected deps. */
function labContext(lab: string, engine: unknown): HostContext {
  const engines = { xlsx: Promise.resolve(engine) } as unknown as HostContext["engines"];
  return { ...createPaths(lab), source: lab, prebundle: join(lab, "unused.mjs"), engines };
}

function routeOf(family: ReturnType<typeof createXlsxRoutes>, path: string) {
  const handler = family.routes[path];
  assert.ok(handler, "the route family must expose " + path);
  return handler;
}

/** The candidate/saved-snapshot scratch the engine stages; used to prove cleanup. */
function scratchFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.startsWith(".") && name.endsWith(".xlsx"));
}

test("T1 the real xlsx-open route returns the sidecar's rich metadata, not the thin shape", async () => {
  const { root, lab, fixture } = makeLab("xlsx-metadata-open-");
  const metadata = richMetadata();
  const { createClient, seen } = sidecarFactory(() => metadata);
  const { gateway } = gatewayWritingToDisk();
  const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
  const xlsx = createXlsxRoutes(labContext(lab, engine));
  try {
    const answer = (await routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v1", path: fixture })) as { workbook: Json };
    const workbook = answer.workbook;

    // Against the unchanged producer this FAILS: the thin payload has neither the
    // required arrays nor the per-sheet dimensions. That is the expected RED.
    assert.deepEqual(partialContractViolations(workbook), [],
      "the opened workbook must satisfy the pinned required fields");

    // Not merely present: the real values must survive unmangled.
    assert.equal(workbook.entryCount, 137, "entryCount comes from the sidecar, not a hard-coded 0");
    assert.equal(workbook.activeTab, 1, "activeTab comes from the sidecar, not a hard-coded 0");
    assert.equal((workbook.visuals as unknown[]).length, 1, "visuals are retained");
    assert.equal((workbook.styles as unknown[]).length, 1, "styles are retained");
    assert.equal((workbook.dxfStyles as unknown[]).length, 1, "dxfStyles are retained");
    assert.equal((workbook.definedNames as unknown[]).length, 1, "definedNames are retained");

    const sheets = workbook.sheets as Json[];
    const firstSheet = at(sheets, 0);
    assert.equal(sheets.length, 2, "every sheet is retained, in workbook order");
    assert.equal(firstSheet.name, "Data", "the real sheet name is retained");
    assert.equal(firstSheet.rowCount, 4096, "per-sheet rowCount is retained");
    assert.equal(firstSheet.columnCount, 64, "per-sheet columnCount is retained");
    assert.equal(firstSheet.showGridLines, false, "a false view flag survives (false is not dropped)");
    assert.equal(firstSheet.hidden, false, "hidden is retained");
    assert.equal(at(sheets, 1).hidden, true, "per-sheet hidden stays per sheet");
    assert.deepEqual(firstSheet.columnWidths, at(metadata.sheets, 0).columnWidths,
      "column-width spans survive verbatim");
    assert.equal(firstSheet.printArea, "Data!$A$1:$D$40", "optional print metadata survives");
    assert.equal(firstSheet.hasScopedDefinedNames, true, "the optional scoped-name flag survives");

    // A REAL non-empty defaulted array must be retained, not flattened to [].
    assert.equal((firstSheet.pivotTables as unknown[]).length, 1, "a supplied pivotTables array is retained");
    assert.equal((firstSheet.sparklines as unknown[]).length, 1, "a supplied sparklines array is retained");
    assert.equal((firstSheet.cellImages as unknown[]).length, 1, "a supplied cellImages array is retained");

    // The renderer identity fields keep their meaning; the transport owns viewId.
    const state = xlsx.states.get("v1");
    assert.ok(state, "the open must bind a route session");
    assert.equal(workbook.sessionId, SESSION_OPEN, "the sidecar session id is the renderer session id");
    assert.equal(workbook.name, "g0-compatibility-edit.xlsx", "the renderer name names the opened file");
    assert.equal(workbook.path, state.session.sourcePath, "before a save, path is the open source");
    assert.equal(workbook.fileBytes, state.session.bytes, "fileBytes is the opened snapshot size");
    assert.equal(workbook.readOnly, false, "readOnly keeps its boolean contract");
    assert.equal(typeof workbook.sha256, "string", "the input digest is present");
    assert.equal(workbook.viewId, "v1", "the transport identity is the server-minted view");
    assert.equal(seen.opens.length, 1, "the open used exactly one sidecar session");
    const onlyOpen = at(seen.opens, 0);
    assert.equal(onlyOpen.path, state.session.snapshotPath, "the sidecar opened the session snapshot, not the fixture");
    assert.notEqual(onlyOpen.path, fixture, "the fixture is never handed to the sidecar as the live input");
  } finally {
    await xlsx.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T2 a THIN {id,name} payload is refused, never padded into a plausible success", async () => {
  const { root, lab, fixture } = makeLab("xlsx-metadata-thin-");
  // Exactly the shape the r22 browser session received.
  const metadata = richMetadata({
    entryCount: 0,
    activeTab: 0,
    styles: undefined,
    dxfStyles: undefined,
    visuals: undefined,
    definedNames: undefined,
    sheets: [{ id: "sheet-1", name: "Data" }],
  });
  const { createClient, seen } = sidecarFactory(() => metadata);
  const { gateway } = gatewayWritingToDisk();
  const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
  const xlsx = createXlsxRoutes(labContext(lab, engine));
  try {
    await assert.rejects(
      () => routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v1", path: fixture }),
      (error: unknown) => (error as { code?: string }).code === "open_invalid_response",
      "a thin payload with no rich metadata must be a named refusal",
    );
    assert.equal(xlsx.states.size, 0, "a refused open must not bind a route session");
    assert.equal(await engine.has("v1"), false, "a refused open must not leave an engine session");
    assert.equal(seen.stops.length, 1, "the already-started sidecar is released when the payload is refused");
  } finally {
    await xlsx.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T3 an out-of-contract REQUIRED sheet field is refused BY NAME and releases the sidecar", async () => {
  const { root, lab, fixture } = makeLab("xlsx-metadata-bad-");
  const base = richMetadata();
  const metadata = richMetadata({
    sheets: [{ ...at(base.sheets, 0), rowCount: 0 }, at(base.sheets, 1)],
  });
  const { createClient, seen } = sidecarFactory(() => metadata);
  const { gateway } = gatewayWritingToDisk();
  const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
  const xlsx = createXlsxRoutes(labContext(lab, engine));
  try {
    await assert.rejects(
      () => routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v1", path: fixture }),
      (error: unknown) => {
        const typed = error as { code?: string; message?: string };
        return typed.code === "open_invalid_response" && /rowCount/.test(String(typed.message));
      },
      "an out-of-contract rowCount must be named in the refusal",
    );
    assert.equal(seen.stops.length >= 1, true, "the already-started sidecar is released when the payload is refused");
    assert.equal(xlsx.states.size, 0, "a malformed open must not bind a route session");
  } finally {
    await xlsx.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T4 only the schema-defaulted arrays may be OMITTED; they materialize as empty", async () => {
  const { root, lab, fixture } = makeLab("xlsx-metadata-default-");
  const source = richMetadata();
  // Drop ONLY the three members the upstream schema itself defaults; every other
  // required field stays present. This is the one legitimate omission.
  const sheets = source.sheets.map((sheet: Json) => {
    const rest: Json = { ...sheet };
    for (const key of ["pivotTables", "sparklines", "cellImages"]) delete rest[key];
    return rest;
  });
  const { createClient } = sidecarFactory(() => ({ ...source, sheets }));
  const { gateway } = gatewayWritingToDisk();
  const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
  const xlsx = createXlsxRoutes(labContext(lab, engine));
  try {
    const answer = (await routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v1", path: fixture })) as { workbook: Json };
    const workbook = answer.workbook;
    const rows = workbook.sheets as Json[];
    const row = at(rows, 0);
    // The defaulted arrays are materialized empty, so the renderer always sees an
    // array it can iterate instead of an undefined read.
    assert.deepEqual(row.pivotTables, [], "an omitted defaulted array becomes empty, never undefined");
    assert.deepEqual(row.sparklines, [], "sparklines default to empty");
    assert.deepEqual(row.cellImages, [], "cellImages default to empty");
    assert.deepEqual(partialContractViolations(workbook), [], "the defaulted-omission payload is still valid");
    assert.equal((workbook.visuals as unknown[]).length, 1, "real metadata stays real; nothing is invented");
  } finally {
    await xlsx.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T10 stale renderer cleanup after save preserves the replacement session and other views", async () => {
  const { root, lab, fixture } = makeLab("xlsx-stale-close-");
  const siblingSession = "33333333-3333-4333-8333-333333333333";
  const { createClient, seen } = sidecarFactory((index) => richMetadata({
    sessionId: index === 1 ? SESSION_OPEN : index === 2 ? SESSION_REOPENED : siblingSession,
  }));
  const { gateway } = gatewayWritingToDisk();
  const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
  const family = createXlsxRoutes(labContext(lab, engine));
  const route = (name: string, input: Json) => routeOf(family, "/engine/xlsx-" + name)(input);
  const read = (viewId: string) => route("read-range", {
    viewId, sheetId: "sheet-1",
    range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
  });
  try {
    await route("open", { viewId: "v1", path: fixture });
    await route("save", {
      viewId: "v1", name: "saved.xlsx",
      edits: [{ sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: 9 }],
    });
    await route("open", { viewId: "v2", path: fixture });
    assert.deepEqual(await route("close", { viewId: "v1", sessionId: SESSION_OPEN }), { closed: false });
    assert.deepEqual(await read("v1"), { result: { clientId: "client-2" } },
      "cleanup for the pre-save session cannot close the newly saved session");
    assert.deepEqual(await route("close", { viewId: "v1", sessionId: siblingSession }), { closed: false });
    assert.deepEqual(await read("v2"), { result: { clientId: "client-3" } },
      "a session id is a guard within the view, never authority to close another view");
    assert.deepEqual(seen.stops, ["client-1"], "only the replaced client was stopped");
    assert.deepEqual(await route("close", { viewId: "v1", sessionId: SESSION_REOPENED }), {
      closed: true, sessionId: SESSION_REOPENED,
    });
    assert.equal(await engine.has("v1"), false);
    assert.equal(await engine.has("v2"), true);
    assert.deepEqual(await route("close", { viewId: "v2" }), { closed: true, sessionId: siblingSession },
      "legacy view-only close still closes its own current session");
  } finally {
    await engine.closeAll();
    await family.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T5 a save rebinds to the REOPENED metadata of a DISTINCT client and session, cleaning up only the old one", async () => {
  const { root, lab, fixture, fixtureBytes } = makeLab("xlsx-metadata-save-");
  // First open: the workbook as the user opened it (activeTab 1, 137 entries).
  // Reopened output: a DIFFERENT real shape AND a DIFFERENT session id, so both the
  // metadata rebinding and the session rebinding are observable.
  const opened = richMetadata();
  const reopenedBase = richMetadata();
  const reopened = richMetadata({
    sessionId: SESSION_REOPENED,
    entryCount: 141,
    activeTab: 0,
    sheets: [{ ...at(reopenedBase.sheets, 0), rowCount: 4097 }, at(reopenedBase.sheets, 1)],
  });
  const { createClient, seen } = sidecarFactory((n) => (n === 1 ? opened : reopened));
  const { gateway, seen: gatewaySeen } = gatewayWritingToDisk();
  const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
  const xlsx = createXlsxRoutes(labContext(lab, engine));
  try {
    await routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v1", path: fixture });
    const state = xlsx.states.get("v1");
    assert.ok(state, "the open must bind the route session");
    assert.equal(state.session.metadata.activeTab, 1, "the open metadata describes the opened workbook");
    assert.equal(state.session.metadata.entryCount, 137, "the open entryCount describes the opened workbook");
    assert.equal(state.session.sessionId, SESSION_OPEN, "the open session id is the opened one");
    assert.notEqual(state.session.snapshotPath, fixture, "the session edits its own snapshot, not the fixture");
    assert.deepEqual(readFileSync(state.session.snapshotPath), fixtureBytes, "the snapshot is a faithful copy");

    const saved = (await routeOf(xlsx, "/engine/xlsx-save")({
      viewId: "v1",
      name: "edited-metadata.xlsx",
      edits: [{ sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: "lab edit" }],
    })) as { saved: Json; file: Json };

    // Two opens, each on its OWN client object: the save did not reuse the open client.
    assert.equal(seen.opens.length, 2, "the save reopens the produced bytes in a fresh sidecar session");
    const firstOpen = at(seen.opens, 0);
    const secondOpen = at(seen.opens, 1);
    assert.notEqual(firstOpen.clientId, secondOpen.clientId, "the reopened client is a distinct object");
    assert.equal(secondOpen.sessionId, SESSION_REOPENED, "the reopened payload carries its own session id");
    assert.equal(secondOpen.path, state.session.savedSnapshotPath,
      "the verifier opened the private saved snapshot, not the output or the fixture");
    assert.notEqual(secondOpen.path, fixture, "the verifier never opens the fixture");

    assert.deepEqual(saved.saved.reopenedSheets, ["Data", "Chart Data"], "the reopened sheets are named");
    assert.equal(saved.saved.formulaCells, 1, "the reopened sheet's own formula cells are counted");

    // The published workbook's metadata replaces the pre-save metadata.
    assert.equal(state.session.metadata.activeTab, 0, "activeTab now describes the SAVED workbook");
    assert.equal(state.session.metadata.entryCount, 141, "entryCount now describes the SAVED workbook");
    assert.equal(at(state.session.metadata.sheets, 0).rowCount, 4097,
      "per-sheet dimensions follow the saved bytes");

    // The session is rebound to the NEW identity, and the new client is the live one.
    assert.equal(state.session.sessionId, SESSION_REOPENED, "the session id is the reopened one");
    assert.equal(saved.file.sessionId, SESSION_REOPENED, "the emitted sessionId is the reopened one");
    assert.equal(saved.file.name, "edited-metadata.xlsx", "the file identity names the published output");
    assert.equal(saved.file.path, state.session.savedPath, "path is the published output path");
    assert.deepEqual(partialContractViolations(saved.file), [], "the post-save payload still satisfies the pinned fields");
    assert.equal(saved.file.viewId, "v1", "the transport identity survives the save");
    assert.equal(gatewaySeen.asserts, 1, "the save still asserts only the touched entries changed");

    // The real filesystem path ran: the output holds the saved bytes and the
    // rename consumed the candidate scratch file.
    assert.ok(state.session.savedPath, "the save published an output path");
    assert.deepEqual(readFileSync(state.session.savedPath), Buffer.from("PK\u0003\u0004saved-workbook-bytes"),
      "the published output holds the gateway's real saved bytes");
    assert.equal(scratchFiles(dirname(state.session.savedPath)).length, 0,
      "the candidate scratch file was consumed by the atomic publish");

    // Only the OLD client was released; the NEW live client survives.
    assert.ok(seen.closes.includes("client-1"), "the previous client was closed");
    assert.ok(seen.stops.includes("client-1"), "the previous client was stopped");
    assert.equal(seen.closes.includes("client-2"), false, "the new live client was not closed");
    assert.equal(seen.stops.includes("client-2"), false, "the new live client was not stopped");
    // The session still works: a read reaches the NEW client, not the released one.
    await routeOf(xlsx, "/engine/xlsx-read-range")({
      viewId: "v1",
      sheetId: "sheet-1",
      range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
    });
    assert.ok(seen.reads.includes("client-2"), "the rebound session reads through the new client");
    assert.equal(seen.reads.includes("client-1"), false, "the released client is never used again");

    // The immutable fixture is never written by an open or a save.
    assert.deepEqual(readFileSync(fixture), fixtureBytes, "the fixture is never written");
  } finally {
    await xlsx.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T6 an explicit null for a defaulted array is a NAMED refusal; a real array is retained", async () => {
  // null is NOT the documented omission: upstream only defaults an ABSENT member.
  // Each field gets its OWN lab, fixture and view, because one refusal must not
  // leave state behind for the next. (r25 draft defect: it built one lab and
  // removed that root inside the loop, so iterations 2 and 3 ran against a deleted
  // lab and could not have reached the refusal they claimed to prove.)
  for (const field of ["pivotTables", "sparklines", "cellImages"] as const) {
    const { root, lab, fixture } = makeLab("xlsx-metadata-null-default-");
    const base = richMetadata();
    const metadata = richMetadata({
      sheets: [{ ...at(base.sheets, 0), [field]: null }, at(base.sheets, 1)],
    });
    // The fixture really carries an explicit null for this field, so the refusal
    // below is about null (not about an absent member).
    assert.equal(at(metadata.sheets, 0)[field], null, "the case supplies an explicit null for " + field);
    const { createClient, seen } = sidecarFactory(() => metadata);
    const { gateway } = gatewayWritingToDisk();
    const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
    const xlsx = createXlsxRoutes(labContext(lab, engine));
    try {
      await assert.rejects(
        () => routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v1", path: fixture }),
        (error: unknown) => {
          const typed = error as { code?: string; message?: string };
          return typed.code === "open_invalid_response" && new RegExp(field).test(String(typed.message));
        },
        "an explicit null " + field + " must be a named refusal, not a silent []",
      );
      assert.equal(xlsx.states.size, 0, "a null-defaulted refusal must not bind a session");
      assert.equal(seen.stops.length, 1, "the sidecar is released on a refusal");
    } finally {
      await xlsx.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  }

  // A REAL supplied array is retained, never flattened to [] (the other half of the
  // title). T4 proves the omission-default; this proves real metadata survives.
  {
    const { root, lab, fixture } = makeLab("xlsx-metadata-real-default-");
    const { createClient } = sidecarFactory(() => richMetadata());
    const { gateway } = gatewayWritingToDisk();
    const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
    const xlsx = createXlsxRoutes(labContext(lab, engine));
    try {
      const answer = (await routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v1", path: fixture })) as { workbook: Json };
      const row = at(answer.workbook.sheets as Json[], 0);
      assert.equal((row.pivotTables as unknown[]).length, 1, "a supplied pivotTables array is retained as-is");
      assert.equal((row.sparklines as unknown[]).length, 1, "a supplied sparklines array is retained as-is");
      assert.equal((row.cellImages as unknown[]).length, 1, "a supplied cellImages array is retained as-is");
    } finally {
      await xlsx.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** Every refusal must carry a code and a message; a raw TypeError has neither. */
const namedRefusal = (expectedCode: string, expectInMessage?: string) => (error: unknown) => {
  const typed = error as { code?: string; message?: string; name?: string };
  assert.equal(typed.name, "XlsxEngineError", "a refusal must be the engine's own error, not a TypeError");
  assert.equal(typed.code, expectedCode, "the refusal carries the named code " + expectedCode);
  if (expectInMessage !== undefined) {
    assert.match(String(typed.message), new RegExp(expectInMessage),
      "the refusal names the offending field " + expectInMessage);
  }
  return true;
};

test("T7 malformed workbook, sheet item and reopened payloads are NAMED errors, never TypeError", async () => {
  // (a) A null workbook response: the route must name the refusal, not throw a TypeError.
  {
    const { root, lab, fixture } = makeLab("xlsx-metadata-null-workbook-");
    const { createClient, seen } = sidecarFactory(() => null);
    const { gateway } = gatewayWritingToDisk();
    const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
    const xlsx = createXlsxRoutes(labContext(lab, engine));
    try {
      await assert.rejects(
        () => routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v1", path: fixture }),
        namedRefusal("open_invalid_response"),
        "a null workbook response must be a named refusal",
      );
      assert.equal(xlsx.states.size, 0, "a null workbook response binds no session");
      assert.equal(seen.stops.length, 1, "the sidecar is released for a null workbook response");
    } finally {
      await xlsx.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  }

  // (b) A null ITEM inside the sheets array: refused by name AND position.
  {
    const { root, lab, fixture } = makeLab("xlsx-metadata-null-item-");
    const base = richMetadata();
    const metadata = richMetadata({ sheets: [at(base.sheets, 0), null] });
    const { createClient, seen } = sidecarFactory(() => metadata);
    const { gateway } = gatewayWritingToDisk();
    const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
    const xlsx = createXlsxRoutes(labContext(lab, engine));
    try {
      await assert.rejects(
        () => routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v1", path: fixture }),
        namedRefusal("open_invalid_response", "sheets\\[1\\]"),
        "a null sheet item must be a named refusal naming its position",
      );
      assert.equal(xlsx.states.size, 0, "a malformed sheet list binds no session");
      assert.equal(seen.stops.length, 1, "the sidecar is released for a malformed sheet list");
    } finally {
      await xlsx.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  }

  // (c) A malformed REOPENED payload: the save fails by name, the previous good
  //     output and session survive, and only the acquired next client is stopped.
  {
    const { root, lab, fixture } = makeLab("xlsx-metadata-bad-reopen-");
    const opened = richMetadata();
    const goodReopen = richMetadata({ sessionId: SESSION_REOPENED, entryCount: 141, activeTab: 0 });
    // Third open (the second save's verification) is malformed: no usable metadata.
    const badReopen = { sessionId: "33333333-3333-4333-8333-333333333333", sheets: [{ id: "sheet-1", name: "Data" }] };
    const { createClient, seen } = sidecarFactory((n) => (n === 1 ? opened : n === 2 ? goodReopen : badReopen));
    const { gateway } = gatewayWritingToDisk();
    const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
    const xlsx = createXlsxRoutes(labContext(lab, engine));
    try {
      await routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v1", path: fixture });
      await routeOf(xlsx, "/engine/xlsx-save")({
        viewId: "v1",
        name: "good-output.xlsx",
        edits: [{ sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: "first" }],
      });
      const state = xlsx.states.get("v1");
      assert.ok(state, "the first save keeps the session open");
      const goodPath = state.session.savedPath as string;
      const goodBytes = readFileSync(goodPath);
      assert.deepEqual(goodBytes, Buffer.from("PK\u0003\u0004saved-workbook-bytes"),
        "the first save published the good output");
      const goodSessionId = state.session.sessionId;
      const goodEntryCount = state.session.metadata.entryCount;
      const liveClientId = at(seen.opens, 1).clientId;

      await assert.rejects(
        () => routeOf(xlsx, "/engine/xlsx-save")({
          viewId: "v1",
          name: "good-output.xlsx",
          edits: [{ sheetId: "sheet-1", row: 1, column: 0, writeValue: true, value: "second" }],
        }),
        namedRefusal("save_verify_failed"),
        "a save whose reopened output cannot be described fails by name",
      );

      // The previous good output and session are preserved: nothing was published
      // and nothing was rebound before the verification passed.
      assert.deepEqual(readFileSync(goodPath), goodBytes, "a failed save leaves the previous good output untouched");
      assert.equal(state.session.sessionId, goodSessionId, "a failed save keeps the live session id");
      assert.equal(state.session.metadata.entryCount, goodEntryCount, "a failed save keeps the live metadata");
      assert.equal(state.session.savedPath, goodPath, "a failed save keeps the published path identity");

      // Only the acquired NEXT client is stopped; the live client keeps running.
      const acquired = at(seen.opens, 2).clientId;
      assert.notEqual(acquired, liveClientId, "the failed verification used its own client");
      assert.ok(seen.stops.includes(acquired), "the acquired next client is stopped after a failed verify");
      assert.equal(seen.stops.includes(liveClientId), false, "the live client is not stopped by a failed verify");
      // No scratch candidate is left in the OUTPUT directory. (The failed save also
      // stages a second saved snapshot inside the live session directory; that one is
      // removed in the same cleanup, and the session directory must hold only the ONE
      // legitimate snapshot the successful first save published.)
      assert.equal(scratchFiles(dirname(goodPath)).length, 0,
        "a failed save leaves no candidate scratch in the output directory");
      assert.equal(scratchFiles(dirname(state.session.snapshotPath)).length, 1,
        "a failed save removes its own staged snapshot and keeps only the live one");
    } finally {
      await xlsx.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("T8a an emitted payload never aliases stored session metadata, and mutating it cannot reach the session", async () => {
  const { root, lab, fixture } = makeLab("xlsx-metadata-own-emit-");
  // A fresh sidecar object per open: this case is about the ROUTE payload versus
  // the stored state, so no cross-session sharing is involved.
  const { createClient } = sidecarFactory(() => richMetadata());
  const { gateway } = gatewayWritingToDisk();
  const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
  const xlsx = createXlsxRoutes(labContext(lab, engine));
  try {
    const first = (await routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v1", path: fixture })) as { workbook: Json };
    const v1 = xlsx.states.get("v1");
    assert.ok(v1, "v1 binds a session");

    // The emitted payload is neither the stored object nor its sheets array.
    assert.notEqual(first.workbook, v1.session.metadata, "the emitted payload is not the stored metadata object");
    assert.notEqual(first.workbook.sheets, v1.session.metadata.sheets, "the emitted sheets array is a copy");

    // Record each object's ACTUAL prior state before the mutation below, so the
    // assertions read a value observed here rather than a re-typed constant.
    const storedBefore = {
      entryCount: v1.session.metadata.entryCount,
      sheetRowCount: at(v1.session.metadata.sheets, 0).rowCount,
    };
    assert.deepEqual(storedBefore, { entryCount: 137, sheetRowCount: 4096 },
      "v1 stored state starts at the opened values");

    // Mutating the RETURNED payload must not reach stored state.
    first.workbook.entryCount = 999;
    at(first.workbook.sheets as Json[], 0).rowCount = 99999;
    assert.equal(v1.session.metadata.entryCount, storedBefore.entryCount,
      "mutating the returned payload cannot change stored metadata");
    assert.equal(at(v1.session.metadata.sheets, 0).rowCount, storedBefore.sheetRowCount,
      "mutating a returned sheet cannot change stored sheet state");
  } finally {
    await xlsx.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T8b the sidecar response is not stored state: post-open input mutation and sibling sessions stay isolated", async () => {
  const { root, lab, fixture } = makeLab("xlsx-metadata-own-input-");
  // ONE shared object answers BOTH opens, so any aliasing between the sidecar's own
  // response and stored session state would become visible as cross-talk.
  const shared = richMetadata();
  const { createClient } = sidecarFactory(() => shared);
  const { gateway } = gatewayWritingToDisk();
  const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
  const xlsx = createXlsxRoutes(labContext(lab, engine));
  try {
    const first = (await routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v1", path: fixture })) as { workbook: Json };
    const v1 = xlsx.states.get("v1");
    assert.ok(v1, "v1 binds a session");
    assert.notEqual(v1.session.metadata, shared, "the stored metadata is not the sidecar's own response object");
    assert.notEqual(first.workbook, shared, "the emitted payload is not the sidecar's own response object");

    // The second view is opened BEFORE its state is looked up, so every v2
    // assertion below reads the live session rather than an earlier undefined.
    const second = (await routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v2", path: fixture })) as { workbook: Json };
    const v2 = xlsx.states.get("v2");
    assert.ok(v2, "v2 binds its own session");

    // RETENTION DID NOT MUTATE THE SIDECAR'S OWN OBJECT. This reads the still
    // untouched response BEFORE any manual mutation, so it is not self-satisfying
    // (and nothing is restored here to make a later check pass).
    assert.equal(shared.entryCount, 137, "the sidecar's own response object is not mutated by retention");
    assert.equal(at(shared.sheets as Json[], 0).rowCount, 4096,
      "the sidecar's own sheet object is not mutated by retention");
    assert.equal(second.workbook.entryCount, 137, "the sibling's emitted payload carries the sidecar's values");

    // INPUT-REFERENCE ISOLATION: mutate the sidecar's own response AFTER both opens.
    // Both sessions were copied, so neither stored state may follow.
    shared.entryCount = 4242;
    at(shared.sheets as Json[], 0).rowCount = 5151;
    assert.equal(v1.session.metadata.entryCount, 137,
      "mutating the sidecar's response after open does not change stored metadata");
    assert.equal(at(v1.session.metadata.sheets, 0).rowCount, 4096,
      "mutating the sidecar's response after open does not change stored sheet state");
    assert.equal(v2.session.metadata.entryCount, 137,
      "the sibling session is not changed by mutating the sidecar's response");
    assert.equal(at(v2.session.metadata.sheets, 0).rowCount, 4096,
      "the sibling session's sheets are not changed by mutating the sidecar's response");
    assert.equal(second.workbook.entryCount, 137,
      "the sibling's emitted payload is not changed by mutating the sidecar's response");

    // SIBLING ISOLATION is its own final step: v2's ACTUAL prior state is recorded,
    // THEN v1's stored state is mutated. v1's 1/7 is its own post-mutation value and
    // is asserted as such - it is never compared against the sibling's 137/4096.
    const v2Before = {
      entryCount: v2.session.metadata.entryCount,
      sheetRowCount: at(v2.session.metadata.sheets, 0).rowCount,
    };
    v1.session.metadata.entryCount = 1;
    at(v1.session.metadata.sheets, 0).rowCount = 7;
    assert.equal(v1.session.metadata.entryCount, 1, "the v1 stored mutation really landed");
    assert.equal(at(v1.session.metadata.sheets, 0).rowCount, 7, "the v1 stored sheet mutation really landed");
    assert.equal(v2.session.metadata.entryCount, v2Before.entryCount,
      "a sibling session is unaffected by v1's stored state");
    assert.equal(at(v2.session.metadata.sheets, 0).rowCount, v2Before.sheetRowCount,
      "a sibling session's sheets are its own");
    assert.equal(second.workbook.entryCount, 137, "the sibling's emitted payload stays correct");
  } finally {
    await xlsx.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T9 a VALID metadata reopen with a missing or blank sessionId fails the save by name", async () => {
  // The reopened metadata itself is well formed here, so the refusal can only come
  // from the sessionId validation (verifiedSessionIdOf) rather than from the
  // metadata contract. A malformed thin reopen cannot isolate that path.
  const cases: { label: string; strip: (payload: Json) => Json }[] = [
    { label: "missing sessionId", strip: (payload) => { const copy: Json = { ...payload }; delete copy.sessionId; return copy; } },
    { label: "blank sessionId", strip: (payload) => ({ ...payload, sessionId: "" }) },
  ];
  for (const testCase of cases) {
    const { root, lab, fixture } = makeLab("xlsx-metadata-save-session-id-");
    const opened = richMetadata();
    const goodReopen = richMetadata({ sessionId: SESSION_REOPENED, entryCount: 141, activeTab: 0 });
    // Third open: rich, valid metadata with the sessionId removed or blanked.
    const badIdentity = testCase.strip(richMetadata({ entryCount: 142, activeTab: 0 }));
    const { createClient, seen } = sidecarFactory((n) => (n === 1 ? opened : n === 2 ? goodReopen : badIdentity));
    const { gateway } = gatewayWritingToDisk();
    const engine = createXlsxEngine({ createClient, gateway, sha256, snapshot: snapshotCopy });
    const xlsx = createXlsxRoutes(labContext(lab, engine));
    try {
      // The bad reopen must still be a VIABLE metadata payload, so this case really
      // exercises the identity check rather than the metadata validator.
      assert.deepEqual(partialContractViolations(badIdentity), [],
        "the " + testCase.label + " payload is otherwise contract-valid");

      await routeOf(xlsx, "/engine/xlsx-open")({ viewId: "v1", path: fixture });
      await routeOf(xlsx, "/engine/xlsx-save")({
        viewId: "v1",
        name: "good-output.xlsx",
        edits: [{ sheetId: "sheet-1", row: 0, column: 0, writeValue: true, value: "first" }],
      });
      const state = xlsx.states.get("v1");
      assert.ok(state, "the first save keeps the session open");
      const goodPath = state.session.savedPath as string;
      const goodBytes = readFileSync(goodPath);
      const goodSessionId = state.session.sessionId;
      const goodEntryCount = state.session.metadata.entryCount;
      const liveClientId = at(seen.opens, 1).clientId;

      await assert.rejects(
        () => routeOf(xlsx, "/engine/xlsx-save")({
          viewId: "v1",
          name: "good-output.xlsx",
          edits: [{ sheetId: "sheet-1", row: 1, column: 0, writeValue: true, value: "second" }],
        }),
        namedRefusal("save_verify_failed"),
        "a " + testCase.label + " reopen must fail the save by name",
      );

      // The previous good output and session are preserved.
      assert.deepEqual(readFileSync(goodPath), goodBytes, "the previous good output is untouched");
      assert.equal(state.session.sessionId, goodSessionId, "the live session id is preserved");
      assert.equal(state.session.metadata.entryCount, goodEntryCount, "the live metadata is preserved");
      assert.equal(state.session.savedPath, goodPath, "the published path identity is preserved");

      // Only the acquired next client is stopped; the live client keeps working.
      const acquired = at(seen.opens, 2).clientId;
      assert.notEqual(acquired, liveClientId, "the failed verification used its own client");
      assert.ok(seen.stops.includes(acquired), "the acquired next client is stopped after a failed verify");
      assert.equal(seen.stops.includes(liveClientId), false, "the live client is not stopped by a failed verify");
      assert.equal(scratchFiles(dirname(goodPath)).length, 0,
        "a failed verify leaves no candidate scratch in the output directory");
      assert.equal(scratchFiles(dirname(state.session.snapshotPath)).length, 1,
        "a failed verify removes its own staged snapshot and keeps only the live one");
    } finally {
      await xlsx.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  }
});
