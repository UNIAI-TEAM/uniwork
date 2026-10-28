// The one door to crash reporting. Everything that wants Sentry
// to know about an error or a step goes through here; data/sentry.ts installs
// the SDK as the sink at boot, and only when a DSN is configured. Without a
// sink every call is a no-op, so the app, the tests and a build without
// Sentry behave the same. Every string is redacted (lib/redact.ts) before it
// reaches the sink, whatever the SDK's own beforeSend does after.
import { isBuildFault, ProviderSheetError } from "@/lib/provider-sheet-error";
import { redactData, redactText } from "@/lib/redact";
import { issuePaths, SchemaMismatchError } from "@/lib/schema-mismatch";

export type ReportLevel = "debug" | "info" | "warning" | "error" | "fatal";

export interface ReportContext {
  /** Where it was caught: "query", "mutation", "boundary:root", "push"… — a tag to group by. */
  source: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  /** Report even an error that reads as expected (a boundary always does). */
  force?: boolean;
  /** Server error codes the caller turns into its own words (lib/account-deletion.ts…): an answer, not drift. */
  handledCodes?: readonly string[];
  /** One issue per what this names, not per stack (an ApiError's endpoint grouping wins). */
  fingerprint?: string[];
  /** The level, over the one the error's class gives (a fallback the screen lived with is a warning). */
  level?: ReportLevel;
}

interface CaptureContext {
  tags: Record<string, string>;
  extra?: Record<string, unknown>;
  level: ReportLevel;
  /** Groups a server's answer by endpoint and status, not by the one stack every ApiError shares. */
  fingerprint?: string[];
}

/** The slice of @sentry/react-native this module calls; data/sentry.ts adapts the SDK to it. */
export interface ReportSink {
  captureException(error: unknown, context: CaptureContext): void;
  addBreadcrumb(breadcrumb: { category: string; message: string; level: ReportLevel; data?: Record<string, unknown> }): void;
  setUser(id: string | null): void;
  setTag(key: string, value: string): void;
}

let sink: ReportSink | null = null;

export function installReportSink(next: ReportSink | null): void {
  sink = next;
}

export function isReporting(): boolean {
  return sink !== null;
}

interface ApiErrorShape {
  status: number;
  code?: string;
  /** "<METHOD> <route>" with ids as {id} (lib/redact.ts › endpointShape). */
  endpoint?: string;
}

/** The fields of an ApiError-shaped error (duck-typed: api.ts imports this module's users). */
function apiErrorOf(error: unknown): ApiErrorShape | undefined {
  if (!(error instanceof Error) || error.name !== "ApiError") return undefined;
  const status: unknown = Reflect.get(error, "status");
  if (typeof status !== "number") return undefined;
  const endpoint: unknown = Reflect.get(error, "endpoint");
  const body: unknown = Reflect.get(error, "body");
  const envelope: unknown = body !== null && typeof body === "object" ? Reflect.get(body, "error") : undefined;
  const code: unknown = envelope !== null && typeof envelope === "object" ? Reflect.get(envelope, "code") : undefined;
  return { status, code: typeof code === "string" ? code : undefined, endpoint: typeof endpoint === "string" ? endpoint : undefined };
}

/**
 * The auth transport's error (data/auth/transport.ts: the sign-in doors, sign-in screens' commands), duck-typed too:
 * its code, and the HTTP status when the server answered at all.
 */
function transportErrorOf(error: unknown): { code: string; status?: number } | undefined {
  if (!(error instanceof Error) || error.name !== "TransportError") return undefined;
  const code: unknown = Reflect.get(error, "code");
  const status: unknown = Reflect.get(error, "status");
  return { code: typeof code === "string" ? code : "", ...(typeof status === "number" ? { status } : {}) };
}

/**
 * A command the server turned down for good once it was delivered (a queued
 * reaction or vote it refused): the screen says so, and the queue that met the
 * refusal already logged it. Thrown to reject the screen's promise, never a bug.
 */
export class RefusedError extends Error {
  override name = "RefusedError";
}

/**
 * The server's answers a correct client meets in normal use: no network or a
 * timeout (0), a session that ended (401), a permission or a row that is gone
 * (403, 404, 410), a deadline (408) and a rate limit (429). The screen says so.
 */
const EXPECTED_STATUSES: ReadonlySet<number> = new Set([0, 401, 403, 404, 408, 410, 429]);

export type ErrorClass = "expected" | "contract" | "bug";

/**
 * What an error says about the app. Expected: the network, an abort, a
 * RefusedError, an expected status, or a 4xx whose code the caller handles.
 * Contract: any other 4xx (400, 409, 413, 415, 422…) — the server judged the
 * request itself wrong, which after a server change is drift between the two;
 * reported at warning level, grouped by endpoint, so it shows on a dashboard
 * before people report it. Bug: a 5xx and every other error.
 */
export function classifyError(error: unknown, handledCodes: readonly string[] = []): ErrorClass {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "RefusedError")) return "expected";
  // Google's or Apple's own sheet: the person's phone or network, unless this build is at fault.
  if (error instanceof ProviderSheetError) return isBuildFault(error) ? "bug" : "expected";
  const transport = transportErrorOf(error);
  if (transport) {
    // No answer, or an answer the screen turns into its own words; one it could not read is a bug, as below.
    if (transport.code === "network" || transport.code === "timeout" || handledCodes.includes(transport.code)) return "expected";
    if (transport.status === undefined || transport.status >= 500) return "bug";
    return EXPECTED_STATUSES.has(transport.status) ? "expected" : "contract";
  }
  const api = apiErrorOf(error);
  if (!api || api.status >= 500) return "bug";
  if (EXPECTED_STATUSES.has(api.status)) return "expected";
  return api.code !== undefined && handledCodes.includes(api.code) ? "expected" : "contract";
}

export function reportError(error: unknown, context: ReportContext): void {
  if (!sink) return;
  const kind = classifyError(error, context.handledCodes);
  if (!context.force && kind === "expected") return;
  const tags: Record<string, string> = { source: context.source, ...context.tags };
  const api = apiErrorOf(error);
  if (api) tags.http_status = String(api.status);
  if (api?.code) tags.error_code = api.code;
  if (api?.endpoint) tags.endpoint = api.endpoint;
  const transport = transportErrorOf(error);
  if (transport?.code) tags.error_code = transport.code;
  if (transport?.status) tags.http_status = String(transport.status);
  // An answer the app could not read: by endpoint, with where it differed (paths and codes, never the body).
  const mismatch = error instanceof SchemaMismatchError ? error : undefined;
  if (mismatch) tags.endpoint = mismatch.endpoint;
  sink.captureException(error instanceof Error ? error : new Error(String(redactText(String(error)))), {
    tags,
    // One line: redactData flattens arrays.
    extra: redactData(mismatch ? { ...context.extra, issues: mismatch.issues.map((i) => `${i.path} ${i.code}`).join(", ") } : context.extra),
    level: context.level ?? (kind === "contract" && !context.force ? "warning" : "error"),
    ...(api?.endpoint
      ? { fingerprint: ["api-error", api.endpoint, String(api.status), api.code ?? ""] }
      : mismatch
        ? { fingerprint: ["schema-mismatch", mismatch.endpoint] }
        : context.fingerprint
          ? { fingerprint: context.fingerprint }
          : {}),
  });
}

/** The logger @uniwork/core/api/schema calls (its `Logger`, structurally: core's logger module is not on the allowlist). */
interface SchemaLogger {
  debug(message: string, ...data: unknown[]): void;
  info(message: string, ...data: unknown[]): void;
  warn(message: string, ...data: unknown[]): void;
  error(message: string, ...data: unknown[]): void;
}

const driftReported = new Set<string>();

/**
 * What parseWithFallback fell back on (data/boot.ts installs it with setSchemaLogger): a response the app could not
 * read, reported at warning level by endpoint and paths, once per endpoint per run (a breadcrumb after that). The
 * line's `received` (the whole body) and the issues' messages are dropped: they quote tenant data. Core only warns;
 * the other levels report alike, should it ever use them.
 */
function reportSchemaDrift(_message: string, data?: unknown): void {
  const endpointField: unknown = data !== null && typeof data === "object" ? Reflect.get(data, "endpoint") : undefined;
  const endpoint = typeof endpointField === "string" ? endpointField : "unknown";
  if (driftReported.has(endpoint)) {
    breadcrumb("schema", "response fell back", "warning", { endpoint });
    return;
  }
  driftReported.add(endpoint);
  const issues: unknown = data !== null && typeof data === "object" ? Reflect.get(data, "issues") : undefined;
  reportError(new SchemaMismatchError(endpoint, issuePaths(issues)), { source: "schema", level: "warning" });
}

export const schemaDriftLogger: SchemaLogger = {
  debug: reportSchemaDrift,
  info: reportSchemaDrift,
  warn: reportSchemaDrift,
  error: reportSchemaDrift,
};

/**
 * The catch handler of a call whose failure the caller lives with — the one
 * replacement for a silent `.catch(() => undefined)`, which lint forbids. The
 * failure always leaves a breadcrumb (scope, what failed, the error's name
 * and status), so the next crash report shows it. With "report" it also goes
 * through reportError, which still drops what is expected (offline, a 401…):
 * use it for a server call or anything whose failure is a fault. "breadcrumb"
 * is for cosmetic native calls (a haptic, the splash, a share sheet) whose
 * failure is never actionable.
 */
export function bestEffort(scope: string, what: string, mode: "report" | "breadcrumb"): (error: unknown) => undefined {
  return (error) => {
    const api = apiErrorOf(error);
    breadcrumb(scope, what, "warning", { error: error instanceof Error ? error.name : typeof error, ...(api ? { status: api.status } : {}) });
    if (mode === "report") reportError(error, { source: scope, extra: { what } });
    return undefined;
  };
}

/** A step on the way to a crash: kept by the SDK and sent with the next report only. */
export function breadcrumb(category: string, message: string, level: ReportLevel = "info", data?: Record<string, unknown>): void {
  sink?.addBreadcrumb({ category, message: String(redactText(message)), level, data: redactData(data) });
}

/** The opaque user id only (never email or name); null on sign-out. */
export function setReportUser(id: string | null): void {
  sink?.setUser(id);
}

export function setReportTag(key: string, value: string): void {
  sink?.setTag(key, value);
}
