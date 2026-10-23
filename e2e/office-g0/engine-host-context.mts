// DOC-003 lab engine host: shared request/context types for the route modules.
//
// Three roots stay apart here. The prepared GenOffice source tree is a MODULE
// root: engines are imported from it and it is never a document root. The lab
// tree is the only root a document may be read from or written to, and every
// write lands in the staged output directory of the view that asked for it.
// Nothing in this module touches the filesystem itself.
import { join } from "node:path";
import {
  EnginePathError,
  atomicWrite,
  containExisting,
  ensureDir,
  hasReparseComponent,
  isUnder,
  readContained,
  safeName,
  sha256,
} from "./engine-paths.mts";
import type { PdfEngine } from "./engine-pdf.mts";
import type { PptxEngine } from "./engine-pptx.mts";
import type { XlsxEngine } from "./engine-xlsx.mts";
import type { DocxEngine } from "./engine-docx.mts";

/** A request the host refused or failed to serve; the code reaches the client. */
export class EngineRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EngineRequestError";
    this.code = code;
  }
}

export const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new EngineRequestError("bad_input", field + " must be a non-empty string");
  }
  return value;
};

export const optionalString = (value: unknown, field: string): string | undefined =>
  value === undefined || value === null ? undefined : requireString(value, field);

export const requireNumber = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new EngineRequestError("bad_input", field + " must be a finite number");
  }
  return value;
};

export const optionalNumber = (value: unknown, field: string): number | undefined =>
  value === undefined || value === null ? undefined : requireNumber(value, field);

export const optionalArray = <T,>(value: unknown, field: string): T[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new EngineRequestError("bad_input", field + " must be an array");
  }
  return value as T[];
};

export const requireArray = <T,>(value: unknown, field: string): T[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new EngineRequestError("bad_input", field + " must be a non-empty array");
  }
  return value as T[];
};

/** Every document path must be an existing file inside the lab, links resolved. */
export const makeLabFile =
  (lab: string) =>
  (target: unknown): string => {
    if (typeof target !== "string" || target.length === 0) {
      throw new EngineRequestError("bad_path", "a lab path string is required");
    }
    return containExisting(lab, target, "outside_lab");
  };

/** Per-view staging directories inside the lab; nothing is ever written elsewhere. */
export interface HostPaths {
  lab: string;
  /** Validate a supplied view id as one safe segment before engine/dir work. */
  requireViewId(viewId: unknown): string;
  outDir(viewId: string): string;
  /**
   * Create and prove this view's own output directory before a route hands the
   * engine a target inside it. The engine's atomic writers stage a temp file
   * BESIDE the target, so a target whose directory does not exist yet fails with
   * a bare ENOENT instead of a named refusal. Containment is checked before the
   * directory is created and the created directory is proven contained after.
   */
  ensureOutDir(viewId: string): Promise<string>;
  sessionDir(viewId: string): string;
  labFile(target: unknown): string;
  read(target: unknown): Promise<Buffer>;
  stage(viewId: string, name: string, bytes: Uint8Array): Promise<string>;
  sha256(data: Uint8Array | string): string;
}

/** One view id is one safe path segment: no separators, no traversal, no drive. */
const viewSegment = (viewId: unknown): string => {
  try {
    return safeName(requireString(viewId, "viewId"));
  } catch (error) {
    if (error instanceof EnginePathError) {
      throw new EngineRequestError(
        "bad_view_id",
        "viewId must be one safe path segment: " + JSON.stringify(String(viewId)),
      );
    }
    throw error;
  }
};

export function createPaths(lab: string): HostPaths {
  const labFile = makeLabFile(lab);
  return {
    lab,
    // A route that requires a viewId validates it here, before starting an
    // engine or creating a directory; ping/read-file never need one.
    requireViewId: (viewId) => viewSegment(viewId),
    // viewId is validated before any output or session directory is created, so
    // "../outside" or an absolute/drive-prefixed name cannot escape the lab.
    outDir: (viewId) => join(lab, "out", viewSegment(viewId)),
    // The only directory a route may create for the engine's own write path. The
    // view id is validated first (one safe segment), the lexical containment and
    // any existing reparse component are refused BEFORE mkdir, and the created
    // directory is re-proven contained before the engine may write into it.
    ensureOutDir: async (viewId) => {
      const dir = join(lab, "out", viewSegment(viewId));
      try {
        if (!isUnder(lab, dir)) {
          throw new EnginePathError(
            "outside_write_root",
            "path outside the lab root: " + dir,
          );
        }
        if (hasReparseComponent(lab, dir)) {
          throw new EnginePathError(
            "reparse_point",
            "refusing to follow a link inside the lab: " + dir,
          );
        }
        await ensureDir(dir);
        containExisting(lab, dir, "outside_write_root");
      } catch (error) {
        if (error instanceof EnginePathError) {
          throw new EngineRequestError(error.code, error.message);
        }
        throw error;
      }
      return dir;
    },
    sessionDir: (viewId) => join(lab, "tmp", viewSegment(viewId)),
    labFile,
    read: (target) => readContained(lab, labFile(target)),
    stage: async (viewId, name, bytes) => {
      const dir = join(lab, "out", viewSegment(viewId));
      await ensureDir(dir);
      return atomicWrite(dir, name, bytes);
    },
    sha256,
  };
}

export type EngineName = "pdf" | "pptx" | "xlsx" | "docx";

/** Engines a request actually started; close() may await only these. */
export interface StartedEngine {
  name: EngineName;
  promise: Promise<unknown>;
}

/** Engines are created once per process; each loads on its first property access. */
export interface EngineBundle {
  readonly pdf: Promise<PdfEngine>;
  readonly pptx: Promise<PptxEngine>;
  readonly xlsx: Promise<XlsxEngine>;
  readonly docx: Promise<DocxEngine>;
}

export interface HostContext extends HostPaths {
  source: string;
  prebundle: string;
  engines: EngineBundle;
}

export type RouteHandler = (input: Record<string, unknown>) => Promise<unknown>;
export type RouteMap = Record<string, RouteHandler>;

/** A route family that owns per-view sessions, closed by /engine/session-close. */
export interface SessionRoutes {
  routes: RouteMap;
  closeSession(viewId: string): Promise<boolean>;
  closeAll(): Promise<void>;
}

export { EnginePathError, sha256 };
