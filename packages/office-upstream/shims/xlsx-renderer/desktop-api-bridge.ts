// UNI-957 (review r1 m5): the vendored sheets modules read the genoffice host
// port off the single global `window.desktopApi` and pass the workbook's
// `sessionId` with every call. A renderer page can mount several workbooks at
// once (the desktop keeps inactive tabs mounted), so the bridge must not be
// "last mount wins": one stable global dispatches each call to the host of
// the workbook whose session asked, and whatever owned the global before the
// first mount gets it back when the last workbook goes away.

interface SessionInput {
  sessionId: string;
}

/** The host calls the bridge forwards (structurally the controller's host). */
export interface DesktopApiBridgeHost {
  readRange(input: SessionInput & { sheetId: string; range: { startRow: number; endRow: number; startColumn: number; endColumn: number } }): Promise<unknown>;
  readFormulas?(input: SessionInput & { sheetId: string }): Promise<unknown>;
  recalcWorkbook?(input: unknown): Promise<unknown>;
}

type DesktopApi = Record<string, unknown>;

const hostsBySession = new Map<string, DesktopApiBridgeHost>();
let installed: { api: DesktopApi; previous: unknown } | null = null;

function hostFor(input: unknown): DesktopApiBridgeHost {
  const sessionId = (input as Partial<SessionInput> | null)?.sessionId;
  const host = typeof sessionId === "string" ? hostsBySession.get(sessionId) : undefined;
  // A call for a workbook that is no longer mounted never reaches another one.
  if (!host) throw new Error(`xlsx_renderer_session_unbound:${String(sessionId)}`);
  return host;
}

function forward<T>(run: () => Promise<T>): Promise<T> {
  try {
    return run();
  } catch (error) {
    return Promise.reject(error);
  }
}

function createApi(): DesktopApi {
  return {
    readWorkbookRange: (input: Parameters<DesktopApiBridgeHost["readRange"]>[0]) => forward(() => hostFor(input).readRange(input)),
    readWorkbookFormulas: (input: SessionInput & { sheetId: string }) =>
      forward(() => hostFor(input).readFormulas?.(input) ?? Promise.resolve({ cells: [] })),
    recalcWorkbook: (input: unknown) => forward(() => hostFor(input).recalcWorkbook?.(input) ?? Promise.resolve({ cells: [], cached: false })),
    // Visuals are outside this slice's render scope; the vendored callers get
    // a typed empty answer, never a fabricated image.
    readLocalImage: () => Promise.resolve(null),
    fetchImage: () => Promise.resolve(null),
    closeWorkbook: () => Promise.resolve(),
  };
}

/** Routes `window.desktopApi` calls for `sessionId` to `host` until the
 *  returned release runs. */
export function registerDesktopApiSession(sessionId: string, host: DesktopApiBridgeHost): () => void {
  const globalObject = globalThis as unknown as { desktopApi?: unknown };
  if (!installed) {
    installed = { api: createApi(), previous: globalObject.desktopApi };
    globalObject.desktopApi = installed.api;
  }
  hostsBySession.set(sessionId, host);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (hostsBySession.get(sessionId) === host) hostsBySession.delete(sessionId);
    if (hostsBySession.size > 0 || !installed) return;
    if (globalObject.desktopApi === installed.api) globalObject.desktopApi = installed.previous;
    installed = null;
  };
}
