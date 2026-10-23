/* global process, fetch */
// Artifact collector for the G7-03a fault-injection harness (UNI-1380).
//
// Reads a document's version list through the public route
// GET /api/v1/documents/{documentID}/versions (server/internal/handler/router/documents.go)
// and writes `server-versions.json` into a target directory.
// The bearer token is read from `FAULT_API_TOKEN` in the environment and is
// refused on argv so it never appears in process listings or command ledgers.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { harnessPaths, isMainModule } from "../harness/lib.mjs";

export const VERSIONS_ROUTE_TEMPLATE = "/api/v1/documents/{documentID}/versions";
export const SERVER_VERSIONS_FILENAME = "server-versions.json";

/** `server-versions.json` of a case that never read a document (BLOCKED before the first request). */
export const EMPTY_SERVER_VERSIONS = Object.freeze({
  document_id: null,
  documentId: null,
  readAt: null,
  head: Object.freeze({ revision: null }),
  versions: Object.freeze([]),
  next_cursor: null,
});

const FORBIDDEN_ARGV_TOKEN_FLAGS = new Set([
  "--token",
  "--api-token",
  "--auth",
  "--authorization",
  "--bearer",
]);

function redactSecrets(text) {
  return String(text ?? "")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
    .replace(/("(?:access_token|refresh_token|launch_ticket|ticket|token|password)"\s*:\s*)"[^"]*"/gi, '$1"<redacted>"');
}

/**
 * Builds the path for `GET /api/v1/documents/{documentID}/versions`.
 */
export function documentVersionsPath(documentId, cursor = "") {
  const id = String(documentId ?? "").trim();
  if (!id) {
    throw new Error("collectServerVersions requires a non-empty documentId");
  }
  const basePath = `/api/v1/documents/${encodeURIComponent(id)}/versions`;
  if (!cursor) return basePath;
  return `${basePath}?cursor=${encodeURIComponent(cursor)}`;
}

/**
 * Reads the full version list of `documentId` from `apiOrigin` through
 * `GET /api/v1/documents/{documentID}/versions`, following `next_cursor` pages,
 * and the document's head revision (`readAt`, `head: {revision}`).
 */
export async function collectServerVersions({ apiOrigin, token, documentId } = {}) {
  const cleanOrigin = String(apiOrigin ?? "").trim().replace(/\/+$/, "");
  if (!cleanOrigin) {
    throw new Error("collectServerVersions requires apiOrigin");
  }
  const cleanToken = String(token ?? "").trim();
  if (!cleanToken) {
    throw new Error("collectServerVersions requires token (set FAULT_API_TOKEN)");
  }
  const cleanDocId = String(documentId ?? "").trim();
  if (!cleanDocId) {
    throw new Error("collectServerVersions requires documentId");
  }

  const versions = [];
  const seenCursors = new Set();
  let cursor = "";

  for (;;) {
    const path = documentVersionsPath(cleanDocId, cursor);
    const response = await fetch(`${cleanOrigin}${path}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${cleanToken}`,
        accept: "application/json",
      },
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `GET ${path} -> ${response.status}: ${redactSecrets(bodyText).slice(0, 200)}`,
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new Error(`GET ${path} -> ${response.status}: response is not valid JSON`);
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.versions)) {
      throw new Error(`GET ${path} -> ${response.status}: response is missing versions[]`);
    }
    versions.push(...parsed.versions);

    const nextCursor =
      typeof parsed.next_cursor === "string" && parsed.next_cursor.trim() !== ""
        ? parsed.next_cursor.trim()
        : "";
    if (!nextCursor) break;
    if (seenCursors.has(nextCursor)) {
      throw new Error(`GET ${path}: server repeated pagination cursor`);
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  const head = await readDocumentHead({ origin: cleanOrigin, token: cleanToken, documentId: cleanDocId });
  return {
    document_id: cleanDocId,
    documentId: cleanDocId,
    readAt: new Date().toISOString(),
    head,
    versions,
    next_cursor: null,
  };
}

/**
 * The document's head revision through `GET /api/v1/documents/{documentID}`
 * (`{document: {revision}}`, a decimal string). Best effort: the version list is
 * the evidence, so an unreadable head (the document is archived, the read is
 * refused) is reported as `{revision: null, error}` and never fails a case.
 */
async function readDocumentHead({ origin, token, documentId }) {
  const path = `/api/v1/documents/${encodeURIComponent(documentId)}`;
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const text = await response.text();
    if (!response.ok) return { revision: null, error: `GET ${path} -> ${response.status}` };
    const revision = JSON.parse(text)?.document?.revision;
    return typeof revision === "string" && revision ? { revision } : { revision: null, error: `GET ${path}: no document.revision` };
  } catch (error) {
    return { revision: null, error: `GET ${path}: ${redactSecrets(error?.message)}`.slice(0, 200) };
  }
}

function apiOriginFromRunDir(runDir) {
  if (!runDir) return "";
  const envFile = harnessPaths(runDir).envFile;
  if (!existsSync(envFile)) return "";
  const text = readFileSync(envFile, "utf8");
  return /^API_ORIGIN=(.*)$/m.exec(text)?.[1]?.trim() ?? "";
}

/**
 * Parses CLI arguments for `collect.mjs`, rejecting any token flag on argv.
 */
export function parseCollectArgs(argv = [], env = process.env) {
  let apiOrigin = "";
  let documentId = "";
  let outDir = "";
  let runDir = "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (FORBIDDEN_ARGV_TOKEN_FLAGS.has(flagName.toLowerCase())) {
      throw new Error("collect.mjs refuses token on argv; pass FAULT_API_TOKEN in the environment");
    }
    if (arg === "--api-origin" || arg === "--origin" || arg === "--target") {
      apiOrigin = String(argv[++i] ?? "").trim();
    } else if (arg.startsWith("--api-origin=") || arg.startsWith("--origin=") || arg.startsWith("--target=")) {
      apiOrigin = arg.slice(arg.indexOf("=") + 1).trim();
    } else if (arg === "--document-id" || arg === "--document" || arg === "--doc") {
      documentId = String(argv[++i] ?? "").trim();
    } else if (arg.startsWith("--document-id=") || arg.startsWith("--document=") || arg.startsWith("--doc=")) {
      documentId = arg.slice(arg.indexOf("=") + 1).trim();
    } else if (arg === "--out-dir" || arg === "--out" || arg === "--dir") {
      outDir = String(argv[++i] ?? "").trim();
    } else if (arg.startsWith("--out-dir=") || arg.startsWith("--out=") || arg.startsWith("--dir=")) {
      outDir = arg.slice(arg.indexOf("=") + 1).trim();
    } else if (arg === "--run-dir") {
      runDir = String(argv[++i] ?? "").trim();
    } else if (arg.startsWith("--run-dir=")) {
      runDir = arg.slice(arg.indexOf("=") + 1).trim();
    } else if (!arg.startsWith("-") && !outDir) {
      outDir = arg.trim();
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }

  const effectiveRunDir = runDir || env.HARNESS_RUN_DIR?.trim() || "";
  const resolvedOrigin =
    apiOrigin || env.FAULT_API_ORIGIN?.trim() || env.API_ORIGIN?.trim() || apiOriginFromRunDir(effectiveRunDir);
  const resolvedDocId = documentId || env.FAULT_DOCUMENT_ID?.trim() || "";
  const resolvedOutDir = outDir || effectiveRunDir;
  const token = env.FAULT_API_TOKEN?.trim() || "";

  if (!token) {
    throw new Error("missing FAULT_API_TOKEN environment variable");
  }
  if (!resolvedOrigin) {
    throw new Error("missing --api-origin <origin> (or API_ORIGIN / --run-dir)");
  }
  if (!resolvedDocId) {
    throw new Error("missing --document-id <id> (or FAULT_DOCUMENT_ID)");
  }
  if (!resolvedOutDir) {
    throw new Error("missing --out-dir <dir>");
  }

  return {
    apiOrigin: resolvedOrigin,
    documentId: resolvedDocId,
    outDir: resolvedOutDir,
    token,
  };
}

/**
 * Fetches the document's version list and writes `server-versions.json` into `outDir`.
 */
export async function writeServerVersions({ apiOrigin, token, documentId, outDir }) {
  const payload = await collectServerVersions({ apiOrigin, token, documentId });
  const targetDir = resolve(outDir);
  mkdirSync(targetDir, { recursive: true });
  const filePath = join(targetDir, SERVER_VERSIONS_FILENAME);
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { filePath, payload };
}

if (isMainModule({ moduleUrl: import.meta.url })) {
  (async () => {
    const args = parseCollectArgs(process.argv.slice(2), process.env);
    const { filePath } = await writeServerVersions(args);
    process.stdout.write(`${filePath}\n`);
  })().catch((error) => {
    process.stderr.write(`collect.mjs: ${redactSecrets(error.message)}\n`);
    process.exit(1);
  });
}
