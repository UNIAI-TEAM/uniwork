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
}

/** The slice of @sentry/react-native this module calls; data/sentry.ts adapts the SDK to it. */
export interface ReportSink {
  captureException(error: unknown, context: { tags: Record<string, string>; extra?: Record<string, unknown> }): void;
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

/** An HTTP status on an ApiError-shaped error (duck-typed: api.ts imports this module's users). */
function statusOf(error: unknown): number | undefined {
  if (!(error instanceof Error) || error.name !== "ApiError") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/**
 * What is not a bug and would only drown the real ones: the network being
 * down or slow (status 0, an abort), and any 4xx — the server answered a
 * request it judged wrong, and the screen already says so. A 5xx and every
 * error that is not an ApiError are reported.
 */
export function isExpectedError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  const status = statusOf(error);
  return status !== undefined && status < 500;
}

export function reportError(error: unknown, context: ReportContext): void {
  if (!sink || (!context.force && isExpectedError(error))) return;
  const tags: Record<string, string> = { source: context.source, ...context.tags };
  const status = statusOf(error);
  if (status !== undefined) tags.http_status = String(status);
  sink.captureException(error instanceof Error ? error : new Error(String(redactText(String(error)))), {
    tags,
    extra: redactData(context.extra),
  });
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
