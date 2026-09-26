// DOC-003 lab engine host: lab-contained paths, immutable snapshots, staged writes.
//
// Document bytes are only read from or written to the lab tree. The prepared
// GenOffice source tree is a code/module root for this host, never a document
// root: no engine route may open, snapshot or overwrite a file under it.
//
// Every candidate path is realpath-resolved and every existing component is
// checked for a reparse point (a Windows junction or a symlink), so a link
// inside the lab cannot smuggle a read or write outside it. Writes stage a
// same-directory temp file and rename it into place, so a failed or cancelled
// operation leaves the previous output untouched.
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

export class EnginePathError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EnginePathError";
    this.code = code;
  }
}

export const sha256 = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

const fold = (value: string): string => (process.platform === "win32" ? value.toLowerCase() : value);

/** Lexical containment: used for values this host constructs, never alone. */
export function isUnder(root: string, target: string): boolean {
  const rootPath = fold(resolve(root));
  const targetPath = fold(resolve(target));
  return targetPath === rootPath || targetPath.startsWith(rootPath + sep);
}

const realOrNull = (path: string): string | null => {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  };
};

/** True when any existing component below root is a junction or symlink. */
export function hasReparseComponent(root: string, target: string): boolean {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  const rel = relative(rootPath, targetPath);
  if (rel === "") return false;
  let current = rootPath;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if (!existsSync(current)) return false;
    let info;
    try {
      info = lstatSync(current);
    } catch {
      return false;
    }
    if (info.isSymbolicLink()) return true;
  }
  return false;
}

/** Resolve an existing file and prove it lives inside root, without following links. */
export function containExisting(root: string, target: string, code = "outside_root"): string {
  const rootPath = resolve(root);
  if (!existsSync(rootPath)) {
    throw new EnginePathError("root_missing", "configured root does not exist: " + rootPath);
  }
  const realRoot = realOrNull(rootPath) ?? rootPath;
  const candidate = resolve(target);
  if (hasReparseComponent(realRoot, candidate)) {
    throw new EnginePathError("reparse_point", "refusing to follow a link inside the lab: " + candidate);
  }
  const realTarget = realOrNull(candidate);
  if (!realTarget) throw new EnginePathError("not_found", "no such file: " + candidate);
  if (!isUnder(realRoot, realTarget)) {
    throw new EnginePathError(code, "path outside the lab root: " + candidate);
  }
  if (hasReparseComponent(realRoot, realTarget)) {
    throw new EnginePathError("reparse_point", "target resolves through a link: " + candidate);
  }
  return realTarget;
}

/** One safe file name: no separators, no traversal, no drive prefix. */
export function safeName(name: string): string {
  const value = String(name ?? "");
  if (value === "" || value === "." || value === "..") {
    throw new EnginePathError("bad_name", "unsafe file name: " + JSON.stringify(value));
  }
  if (value.includes("/") || value.includes("\\") || value.includes(":")) {
    throw new EnginePathError("bad_name", "file name must not carry a path: " + value);
  }
  if (basename(value) !== value) {
    throw new EnginePathError("bad_name", "file name must be a basename: " + value);
  }
  return value;
}

/** Join a contained directory with one safe name; the only write-path factory. */
export function containedChild(directory: string, name: string): string {
  return join(directory, safeName(name));
}

export async function ensureDir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return path;
}

export async function readContained(root: string, target: string): Promise<Buffer> {
  return readFile(containExisting(root, target, "outside_read_root"));
}

/** Atomic same-directory replace: stage a temp file, then rename it into place. */
export async function atomicWrite(
  directory: string,
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  const target = containedChild(directory, name);
  await ensureDir(directory);
  const temp = join(directory, "." + safeName(name) + "." + randomUUID() + ".tmp");
  try {
    await writeFile(temp, bytes);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  return target;
}

export interface SnapshotResult {
  path: string;
  name: string;
  bytes: number;
  hash: string;
}

/** Copy a lab file into a private session directory; that copy is the only input. */
export async function snapshotCopy(
  sessionDir: string,
  sourcePath: string,
  name?: string,
): Promise<SnapshotResult> {
  await ensureDir(sessionDir);
  const target = containedChild(sessionDir, name ?? basename(sourcePath));
  await copyFile(sourcePath, target);
  const bytes = await readFile(target);
  return { path: target, name: basename(target), bytes: bytes.length, hash: sha256(bytes) };
}

export interface FileStat {
  path: string;
  bytes: number;
  hash: string;
}

export async function statFile(path: string): Promise<FileStat> {
  const info = await stat(path);
  const bytes = await readFile(path);
  return { path, bytes: info.size, hash: sha256(bytes) };
}