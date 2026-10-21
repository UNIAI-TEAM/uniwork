// The one door to crash reporting (audit P0-2). Everything that wants Sentry
// to know about an error or a step goes through here; data/sentry.ts installs
// the SDK as the sink at boot, and only when a DSN is configured. Without a
// sink every call is a no-op, so the app, the tests and a build without
// Sentry behave the same. Every string is redacted (lib/redact.ts) before it
// reaches the sink, whatever the SDK's own beforeSend does after.
import { redactData, redactText } from "@/lib/redact";

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
  sink.captureException(error instanceof Error ? error : new Error(String(redactText(String(error)))), {
    tags,
    extra: redactData(context.extra),
    level: kind === "contract" && !context.force ? "warning" : "error",
    ...(api?.endpoint ? { fingerprint: ["api-error", api.endpoint, String(api.status), api.code ?? ""] } : {}),
  });
}

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
