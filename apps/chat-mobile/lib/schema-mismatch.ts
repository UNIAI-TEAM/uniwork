// A server answer the app could not read: drift between the build and the server. It names the endpoint and where
// the answer differed (paths and zod codes), never a value: a zod issue's message and the received body quote tenant
// data (workspace names, messages, people), which never reaches a log or a crash report.
import { isRecord } from "./unknown-shape";

interface SchemaIssue {
  /** Dotted path into the answer, indexes included ("workspaces.0.id"). */
  path: string;
  /** zod's issue code ("invalid_type"…), or "unknown". */
  code: string;
}

export class SchemaMismatchError extends Error {
  override name = "SchemaMismatchError";
  /** "<METHOD> <route>" as the endpoint calls it. */
  readonly endpoint: string;
  readonly issues: readonly SchemaIssue[];
  constructor(endpoint: string, issues: readonly SchemaIssue[]) {
    const where = issues.map((issue) => `${issue.path} ${issue.code}`).join(", ");
    super(`API response failed schema validation: ${endpoint}${where ? ` (${where})` : ""}`);
    this.endpoint = endpoint;
    this.issues = issues;
  }
}

const segment = (key: unknown): string => (typeof key === "string" || typeof key === "number" ? String(key) : "?");

/** zod's issues (or anything shaped like them) as paths and codes only. */
export function issuePaths(issues: unknown): SchemaIssue[] {
  if (!Array.isArray(issues)) return [];
  return issues.map((issue) => {
    const path = isRecord(issue) && Array.isArray(issue.path) ? issue.path.map(segment).join(".") : "";
    const code = isRecord(issue) && typeof issue.code === "string" ? issue.code : "unknown";
    return { path, code };
  });
}
