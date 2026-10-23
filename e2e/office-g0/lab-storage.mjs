// DOC-003 lab storage (UNI-667): real-path containment, per-view grants and
// atomic same-directory writes for the lab HTTP server.
//
// This module is the only place the lab touches the filesystem, so the
// containment rules live in one file and are unit-testable without HTTP:
//
//   * READ containment is realpath based. A path is inside a root when its real
//     location (junctions and symlinks resolved) sits under the real location of
//     that root. A lexical prefix check is never trusted on its own.
//   * WRITE containment adds an explicit write-root allowlist built from the
//     per-view directories. Fixtures, the prepared source and the renderer builds
//     are readable but are not write roots at all.
//   * Every view owns its own working copy and output root under the lab dir and
//     its own grant set. Opening a path grants it to that view only; another view
//     cannot read, save or target it until the lab control plane grants it.
//   * Writes are staged in the destination directory, flushed and then renamed
//     over the target, so a failing write leaves the previous output untouched and
//     a cross-volume rename is impossible.
//
// Node 22 built-ins only. No production imports.

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

/** Every failure the lab reports to a caller: a stable code plus a message. */
export class LabProtocolError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'LabProtocolError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  /** The single JSON error envelope every lab route returns. */
  toEnvelope() {
    const envelope = { ok: false, error: this.code, message: this.message };
    if (this.details !== undefined) envelope.details = this.details;
    return envelope;
  }
}

/** Windows and macOS compare paths case-insensitively (NTFS and APFS fold case). */
const CASE_FOLD = process.platform === 'win32' || process.platform === 'darwin';
const BACKSLASH = String.fromCharCode(92);

export const sha256 = (data, encoding = 'hex') =>
  createHash('sha256').update(data).digest(encoding);

/**
 * The real location of a path. When the path does not exist yet, the nearest
 * existing ancestor is resolved instead and the remaining segments are appended,
 * so a to-be-created file under a junction is still compared against the
 * junction's real target rather than its lexical name.
 */
export function realPathFor(target) {
  const absolute = resolve(target);
  let probe = absolute;
  const tail = [];
  for (;;) {
    try {
      const real = realpathSync(probe);
      return tail.length > 0 ? join(real, ...tail) : real;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
    const parent = dirname(probe);
    if (parent === probe) return absolute;
    tail.unshift(basename(probe));
    probe = parent;
  }
}

/** True when `target` resolves to `root` or to a path under it. */
export function isContainedWithin(root, target, { caseFold = CASE_FOLD } = {}) {
  const left = realPathFor(root);
  const right = realPathFor(target);
  const a = caseFold ? left.toLowerCase() : left;
  const b = caseFold ? right.toLowerCase() : right;
  if (b === a) return true;
  return b.startsWith(a.endsWith(sep) ? a : a + sep);
}

/**
 * The lab roots and the only path authority in the lab. Read roots are explicit:
 * the renderer builds, the lab dir and, when configured, the fixture dir and the
 * prepared source dir. Write roots are the per-view directories plus the four
 * legacy lab dirs, and nothing else.
 */
/**
 * isContainedWithin's boundary without resolving the root: the caller owns the authority
 * string. Needed here, or a junction at the root itself re-blesses itself.
 */
function isLexicallyWithin(root, target, { caseFold = CASE_FOLD } = {}) {
  const a = caseFold ? root.toLowerCase() : root;
  const b = caseFold ? target.toLowerCase() : target;
  if (b === a) return true;
  return b.startsWith(a.endsWith(sep) ? a : a + sep);
}

export class LabRoots {
  constructor({ labDir, buildsDir, fixturesDir = null, sourceDir = null } = {}) {
    if (!labDir || !buildsDir) throw new Error('lab roots: labDir and buildsDir are required');
    this.lab = resolve(labDir);
    this.builds = resolve(buildsDir);
    this.fixtures = fixturesDir ? resolve(fixturesDir) : null;
    this.source = sourceDir ? resolve(sourceDir) : null;
    this.readRoots = [this.builds, this.lab];
    if (this.fixtures) this.readRoots.push(this.fixtures);
    if (this.source) this.readRoots.push(this.source);
    this.viewsRoot = join(this.lab, 'views');
    this.inDir = join(this.lab, 'in');
    this.outDir = join(this.lab, 'out');
    this.tmpDir = join(this.lab, 'tmp');
    this.untitledDir = join(this.lab, 'untitled');
    this.writeRoots = [this.viewsRoot, this.inDir, this.outDir, this.tmpDir, this.untitledDir];
  }

  /** Creates the lab-owned directories; safe to call repeatedly. */
  ensureSync() {
    const dirs = [this.lab, this.viewsRoot, this.inDir, this.outDir, this.tmpDir, this.untitledDir];
    for (const dir of dirs) mkdirSync(dir, { recursive: true });
    // Resolved ONCE: requireNativeOutput joins the view segment onto THIS string, so a
    // junction at <out>/<viewId> cannot redirect the authority (S9).
    this.outDirReal = realPathFor(this.outDir);
    return this;
  }

  /** Root that contains `target` for a read, or null. */
  readRootFor(target) {
    return this.readRoots.find((root) => isContainedWithin(root, target)) ?? null;
  }

  /** Root that contains `target` for a write, or null. */
  writeRootFor(target) {
    return this.writeRoots.find((root) => isContainedWithin(root, target)) ?? null;
  }

  /** Resolves a read target to its real path or throws `path_outside_lab`. */
  requireRead(target) {
    if (typeof target !== 'string' || target.length === 0) {
      throw new LabProtocolError('path_required', 'a path string is required');
    }
    if (!this.readRootFor(target)) {
      throw new LabProtocolError(
        'path_outside_lab',
        'path resolves outside every readable lab root: ' + String(target),
      );
    }
    return realPathFor(target);
  }

  /**
   * Resolves a write target to its real path or throws. Fixtures, the prepared
   * source and the renderer builds are excluded because they are not write roots,
   * and a junction that escapes the lab is caught by the realpath comparison.
   */
  requireWrite(target) {
    const resolved = this.requireRead(target);
    if (!this.writeRootFor(resolved)) {
      throw new LabProtocolError(
        'write_root_forbidden',
        'path is readable but is not a lab write root (fixtures, source and builds stay immutable): ' +
          String(target),
      );
    }
    return resolved;
  }
}

/** Reads a whole file into a Buffer, converting IO failures to a lab error. */
export async function readFileBytes(filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      throw new LabProtocolError('not_a_file', 'not a regular file: ' + String(filePath));
    }
    return await readFile(filePath);
  } catch (error) {
    if (error instanceof LabProtocolError) throw error;
    if (error.code === 'ENOENT') {
      throw new LabProtocolError('path_not_found', 'no such file: ' + String(filePath));
    }
    throw new LabProtocolError('read_failed', 'read failed: ' + String(error.message ?? error));
  }
}

/**
 * Writes `data` next to `targetPath` as a unique staged file that is flushed and
 * then renamed over the target. The previous target survives any failure before
 * the rename, and the rename cannot cross a volume because the staging file
 * shares the destination directory.
 */
export async function writeFileAtomic(targetPath, data, { fileMode = 0o600 } = {}) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const staging = join(dir, '.lab-stage-' + randomUUID());
  let handle = null;
  try {
    handle = await open(staging, 'wx', fileMode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(staging, targetPath);
    await fsyncDirectory(dir);
    return { path: targetPath, bytes: bytes.length, sha256: sha256(bytes) };
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // the original failure is the one worth reporting
      }
    }
    try {
      await rm(staging, { force: true });
    } catch {
      // staging may never have been created
    }
    throw error;
  }
}

/**
 * Flushes a directory entry so a rename survives a crash where the platform
 * supports it. Windows refuses to fsync a directory handle; the rename itself is
 * still atomic there and that limit is reported rather than papered over.
 */
export async function fsyncDirectory(dir) {
  let handle = null;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
    return true;
  } catch {
    return false;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // nothing else to release
      }
    }
  }
}

/** Strips every path separator and traversal out of a caller-supplied name. */
export function sanitizeName(value, fallback = 'untitled') {
  const raw = String(value ?? '').split(BACKSLASH).join('/');
  const base = raw.slice(raw.lastIndexOf('/') + 1);
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[.]+/, '');
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Appends an extension when the sanitized name does not already carry it. */
export function withExtension(name, ext) {
  const safe = sanitizeName(name);
  if (!ext) return safe;
  return safe.toLowerCase().endsWith(ext.toLowerCase()) ? safe : safe + ext;
}

/**
 * Splits a URL-relative asset path into safe, decoded path segments, or throws.
 * This is the only place an asset URL path becomes a filesystem name, so every
 * absolute, drive, UNC, NUL, scheme-ish, `.`/`..` and percent-encoded traversal
 * (`%2e%2e%2f`) shape is refused here rather than being normalised away.
 */
export function assetRelativeSegments(relative) {
  if (typeof relative !== 'string' || relative.length === 0) {
    throw new LabProtocolError('path_required', 'an asset path is required');
  }
  const raw = relative.split(BACKSLASH).join('/');
  if (raw.includes('\0')) {
    throw new LabProtocolError('invalid_input', 'asset path contains a NUL byte');
  }
  if (raw.startsWith('/')) {
    throw new LabProtocolError('path_outside_lab', 'asset path must be relative: ' + relative);
  }
  if (/^[a-zA-Z]:/.test(raw)) {
    throw new LabProtocolError('path_outside_lab', 'asset path must not carry a drive: ' + relative);
  }
  const segments = [];
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue;
    let decoded;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw new LabProtocolError('invalid_input', 'asset path segment is not valid percent-encoding');
    }
    if (decoded === '' || decoded === '.') continue;
    if (decoded === '..' || decoded.includes('/') || decoded.includes(BACKSLASH) || decoded.includes('\0')) {
      throw new LabProtocolError('path_outside_lab', 'asset path must not traverse: ' + relative);
    }
    segments.push(decoded);
  }
  if (segments.length === 0) {
    throw new LabProtocolError('path_required', 'asset path has no file name');
  }
  return segments;
}

/**
 * One server-owned view: an immutable input, its own working copy, its own
 * output root and its own grant set. A caller never supplies a view id, a grant
 * or a destination; it only names an app and, optionally, a fixture to open.
 */
export class ViewSessions {
  constructor({ roots, apps, makeToken, makeId }) {
    if (!roots) throw new Error('view sessions: roots are required');
    this.roots = roots;
    this.apps = new Set(apps ?? []);
    this.makeToken = makeToken ?? (() => randomUUID());
    this.makeId = makeId ?? (() => 'view-' + randomUUID());
    this.byId = new Map();
  }

  /** Creates the session, copies the fixture in and grants both paths. */
  async open({ app, path = null } = {}) {
    if (!this.apps.has(app)) {
      throw new LabProtocolError('unknown_app', 'unknown lab app: ' + String(app));
    }
    const viewId = this.makeId();
    const viewDir = join(this.roots.viewsRoot, viewId);
    const workingDir = join(viewDir, 'input');
    const outputDir = join(viewDir, 'out');
    // The engine host publishes under <lab>/out/<viewId> (engine-host-context.mts outDir).
    // Derived from the viewId this server just minted, never from a caller/engine path; one
    // directory per view, never lab/out, never lab.
    const nativeOutDir = join(this.roots.outDir, viewId);
    await mkdir(workingDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    const session = {
      viewId,
      app,
      createdAt: new Date().toISOString(),
      viewDir,
      workingDir,
      outputDir,
      sourcePath: null,
      sourceReal: null,
      sourceName: null,
      sourceHash: null,
      sourceBytes: 0,
      sourceDir: null,
      workingPath: null,
      savePath: null,
      previewToken: this.makeToken(),
      readGrants: new Set(),
      // workingDir/outputDir are the lab's own save surface; nativeOutDir is the engine's
      // publication directory for THIS view; all three are server-derived. No read grant is
      // added: a reopen is authorized by opening the published file, not by widening reads.
      writeGrants: new Set([workingDir, outputDir, nativeOutDir]),
      nativeOutDir,
      output: null,
      dirty: false,
    };
    this.byId.set(viewId, session);
    // The view's working directory is readable, including blank sessions.
    session.readGrants.add(workingDir);

    if (path !== null && path !== undefined) {
      const source = this.roots.requireRead(path);
      const bytes = await readFileBytes(source);
      const name = basename(source);
      const workingCopy = join(workingDir, name);
      const written = await writeFileAtomic(workingCopy, bytes);
      session.sourcePath = String(path);
      // The real location of the immutable input, kept so the original download
      // can never be changed by a later save of the working copy.
      session.sourceReal = source;
      session.sourceName = name;
      session.sourceHash = written.sha256;
      session.sourceBytes = bytes.length;
      session.workingPath = workingCopy;
      session.readGrants.add(source);
      session.readGrants.add(workingCopy);
      // The document's own directory is part of the same read grant, so a
      // relative asset the document already references stays readable while a
      // sibling directory still is not. Upstream allows exactly this much.
      session.sourceDir = dirname(source);
      session.readGrants.add(session.sourceDir);
      session.savePath = workingCopy;
    }
    return session;
  }

  requireView(viewId) {
    const session = typeof viewId === 'string' ? this.byId.get(viewId) : undefined;
    if (!session) {
      throw new LabProtocolError('unknown_view', 'no lab view for id ' + String(viewId));
    }
    return session;
  }

  /** Like `requireView`, but also enforces that the caller's app matches. */
  requireViewFor(viewId, app) {
    const session = this.requireView(viewId);
    if (app && session.app !== app) {
      throw new LabProtocolError(
        'wrong_view',
        'view ' + session.viewId + ' belongs to app ' + session.app + ', not ' + String(app),
      );
    }
    return session;
  }

  /** The other view whose directory contains `realPath`, when there is one. */
  otherViewOwning(session, realPath) {
    for (const [viewId, other] of this.byId) {
      if (viewId === session.viewId) continue;
      if (isContainedWithin(other.viewDir, realPath)) return other;
    }
    return null;
  }

  /** Lab-control grant: the only way a path outside the working copy opens. */
  authorizeRead(viewId, target) {
    const session = this.requireView(viewId);
    const real = this.roots.requireRead(target);
    session.readGrants.add(real);
    return real;
  }

  /** Lab-control write grant for one existing path under a lab write root. */
  authorizeWrite(viewId, target) {
    const session = this.requireView(viewId);
    const real = this.roots.requireWrite(target);
    session.writeGrants.add(real);
    return real;
  }

  /**
   * A granted read target, realpath-verified and view-scoped.
   *
   * A grant is an exact file OR a directory the target resolves inside. A file
   * grant is never a prefix: it can never cover another path. A directory grant
   * (the opened document's own directory, or the view's working directory) covers
   * the files inside it the way upstream `resolveSafeRelativeImagePath` does: a
   * relative asset such as `assets/dot.png`, but nothing that resolves outside
   * the directory through `..`, a junction or a symlink.
   *
   * A grant is checked before the cross-view refusal, because a fresh session that
   * reopens a saved document holds a real grant on the directory that produced it
   * (its own `sourceDir`) and on the opened file itself; refusing those would break
   * the documented reopen cycle. Everything else inside another view's directory
   * stays refused, and an ungranted cross-view read still fails as
   * `path_not_granted`.
   */
  requireReadGrant(viewId, target) {
    const session = this.requireView(viewId);
    if (typeof target !== 'string' || target.length === 0) {
      throw new LabProtocolError('path_required', 'a path string is required');
    }
    const real = this.roots.requireRead(target);
    const granted = session.readGrants.has(real) || this.directoryGrantFor(session, real) !== null;
    if (granted) {
      if (!this.openedSourceAllows(session, real)) this.assertNotOtherView(session, real);
      return real;
    }
    throw new LabProtocolError(
      'path_not_granted',
      'this view has no read grant for ' + String(target) +
        '; opening a path does not grant it (lab control must authorize it)',
    );
  }

  /**
   * True when `realPath` is the document this session opened, or lives in that
   * document's own directory. Those two things are what opening a path grants, so
   * they may legitimately cross views when a saved output is reopened.
   */
  openedSourceAllows(session, realPath) {
    for (const root of [session.sourceReal, session.sourceDir]) {
      if (root && isContainedWithin(root, realPath)) return true;
    }
    return false;
  }

  /**
   * The real path of one view-scoped image asset, resolved from the URL-relative
   * path the renderer emitted. The absolute location is built from the decoded
   * segments under the session's own document directory (then its working
   * directory), so the result is a realpath-contained, granted file and never an
   * arbitrary path or another view's file.
   */
  requireReadAsset(viewId, relative) {
    const session = this.requireView(viewId);
    const segments = assetRelativeSegments(relative);
    const bases = [];
    if (session.sourceDir) bases.push(session.sourceDir);
    if (session.workingDir && session.workingDir !== session.sourceDir) bases.push(session.workingDir);
    for (const base of bases) {
      const candidate = join(base, ...segments);
      try {
        return this.requireReadGrant(viewId, candidate);
      } catch (error) {
        if (error instanceof LabProtocolError && error.code === 'path_not_granted') continue;
        throw error;
      }
    }
    throw new LabProtocolError(
      'path_not_granted',
      'this view has no readable asset at ' + String(relative),
      { relative },
    );
  }

  /** Another view's path is refused even when this view holds a directory grant. */
  assertNotOtherView(session, realPath) {
    const other = this.otherViewOwning(session, realPath);
    if (other) {
      throw new LabProtocolError(
        'wrong_view',
        'path belongs to view ' + other.viewId + ' and is not granted to ' + session.viewId,
      );
    }
  }

  /**
   * The granted directory whose real location contains `realPath`, or null. The
   * target must be an existing regular file, so a directory grant is not a prefix
   * that admits a name which has not been created yet.
   */
  directoryGrantFor(session, realPath) {
    for (const grant of session.readGrants) {
      if (grant === realPath) continue;
      if (!isContainedWithin(grant, realPath)) continue;
      try {
        if (!statSync(realPath).isFile()) continue;
      } catch {
        continue;
      }
      return grant;
    }
    return null;
  }

  /**
   * A granted write target. Requires a lab write root AND a per-view grant, so an
   * arbitrary lab path or another view's output is rejected even though the lab
   * owns it.
   */
  requireWriteGrant(viewId, target) {
    const session = this.requireView(viewId);
    if (typeof target !== 'string' || target.length === 0) {
      throw new LabProtocolError('path_required', 'a write path string is required');
    }
    const real = this.roots.requireWrite(target);
    const other = this.otherViewOwning(session, real);
    if (other) {
      throw new LabProtocolError(
        'wrong_view',
        'path belongs to view ' + other.viewId + ' and cannot be written by ' + session.viewId,
      );
    }
    const granted = [...session.writeGrants].some((root) => isContainedWithin(root, real));
    if (!granted) {
      throw new LabProtocolError(
        'write_not_granted',
        'this view has no write grant for ' + String(target),
      );
    }
    return real;
  }

  /** The view's default destination for a new or unnamed document. */
  /**
   * The published native output of THIS view, or a named error. Authority = the canonical leaf
   * <once-resolved lab/out>/<server-minted viewId>, compared LEXICALLY against the
   * realpath-verified target, so the root is never re-resolved and a junction at the whole
   * nativeOutDir cannot re-bless itself. The ordinary requireWriteGrant then refuses the
   * pre-save working copy, views/<id>/out, another view's output, the rest of lab/out, anything
   * outside lab and a junction resolving OUT of the view dir. The view id comes from the
   * session; no caller/engine path supplies the authority. Never mutates.
   */
  requireNativeOutput(viewId, target) {
    const session = this.requireView(viewId);
    if (typeof target !== 'string' || target.length === 0) {
      throw new LabProtocolError('path_required', 'a published path string is required');
    }
    const real = this.roots.requireRead(target);
    const canonicalNativeOutDir = join(
      this.roots.outDirReal ?? realPathFor(this.roots.outDir),
      session.viewId,
    );
    if (!isLexicallyWithin(canonicalNativeOutDir, real)) {
      throw new LabProtocolError(
        'not_native_output',
        'the published path is not this view native output directory: ' + String(target),
      );
    }
    return this.requireWriteGrant(viewId, target);
  }

  defaultTarget(session, name) {
    return join(session.outputDir, sanitizeName(name ?? 'untitled'));
  }
}

/** Reads a whole text file with an explicit encoding, as a bare string. */
export async function readTextFile(filePath, encoding = 'utf8') {
  const bytes = await readFileBytes(filePath);
  return bytes.toString(encoding);
}

/** Writes text bytes atomically (used by tests to seed a previous output). */
export async function seedFile(targetPath, data) {
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, data);
  return targetPath;
}
