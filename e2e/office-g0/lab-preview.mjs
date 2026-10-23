// DOC-003 HTML preview (UNI-667): a per-view preview buffer, an isolated
// preview surface and a read-only preview identifier.
//
// Why it is a separate module
// ---------------------------
// Upstream (apps/html) serves the preview copy from an `html-preview://` scheme
// inside Electron. The lab has no Electron, so the same contract is re-homed on
// an isolated lab origin:
//
//   * the preview document is the *preview copy* of the buffer, never the saved
//     source: `buildPreviewDocument` adds the asset `<base>` only to the copy;
//   * the identifier is a server-minted, read-only preview token, never the app
//     session id, and it is not carried in the app API;
//   * the frame stays in the existing opaque sandbox (no `allow-same-origin`), so
//     the document's own scripts run with an opaque origin and cannot reach the
//     app API, the app session or the top origin;
//   * a version is stored before the update is acknowledged, so a reload cannot
//     publish stale content.
//
// The preview asset route confines every relative asset to the opened document's
// own directory grant and resolves it through the same realpath containment the
// rest of the lab uses.

import { extname } from 'node:path';
import { LabProtocolError, readFileBytes } from './lab-storage.mjs';

/** MIME map for the lab's static and preview assets, shared with the server. */
export const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.cjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.wasm', 'application/wasm'],
  ['.pdf', 'application/pdf'],
  ['.bcmap', 'application/octet-stream'],
  ['.pfb', 'application/octet-stream'],
]);

/** MIME for a path, defaulting to octet-stream so a font is never sniffed as HTML. */
export const mimeFor = (filePath) => MIME.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream';

/**
 * The preview copy of the document: the buffer text with a `<base>` pointing at
 * the document's own preview asset prefix, unless the author declared one. The
 * saved source never contains it. Mirrors upstream `buildPreviewDocument`.
 */
export function buildPreviewDocument(text, baseHref) {
  const source = String(text ?? '');
  if (!baseHref || /<base\s/i.test(source)) return source;
  const tag = '<base href="' + baseHref.replace(/"/g, '%22') + '">';
  const head = /<head(?:\s[^>]*)?>/i.exec(source);
  if (head) {
    const at = head.index + head[0].length;
    return source.slice(0, at) + tag + source.slice(at);
  }
  const html = /<html(?:\s[^>]*)?>/i.exec(source);
  if (html) {
    const at = html.index + html[0].length;
    return source.slice(0, at) + tag + source.slice(at);
  }
  return tag + source;
}

/** The exact upstream meta-CSP token the HTML app entry pins for its preview frame. */
export const HTML_PREVIEW_FRAME_TOKEN = 'html-preview:';

/**
 * The runtime token root the preview document resolves relative assets under.
 * The asset route serves <tokenRoot>assets/dot.png once, because the fixture
 * authors "assets/dot.png": a ".../<token>/assets/" root would double the prefix.
 */
export function previewTokenBase(previewOrigin, token) {
  return String(previewOrigin).replace(/\/+$/, '') + '/' + token + '/';
}

/**
 * Translates ONLY the exact html-preview: frame-src token of the single
 * Content-Security-Policy meta into the runtime preview origin. Validation
 * happens first; the replacement is then a byte-exact splice at the token's own
 * offset, so every other byte of the document and of the CSP is preserved -
 * separators, spacing, newlines, directive order and case are untouched.
 *
 * Named refusals: html_preview_csp_missing (no CSP meta),
 * html_preview_csp_ambiguous (more than one CSP meta),
 * html_preview_csp_unsupported (no quoted content, no frame-src directive, more
 * than one frame-src directive, or a frame-src that is not exactly the one
 * expected html-preview: token). Never a silent skip.
 */
export function translateHtmlPreviewFrameSrc(html, previewOrigin) {
  const source = String(html ?? '');
  const metas = [...source.matchAll(/<meta\b[^>]*>/gi)].filter((match) =>
    /http-equiv\s*=\s*("|')?content-security-policy\1/i.test(match[0]),
  );
  if (metas.length === 0) {
    throw new LabProtocolError(
      'html_preview_csp_missing',
      'the html entry has no Content-Security-Policy meta to translate',
    );
  }
  if (metas.length > 1) {
    throw new LabProtocolError(
      'html_preview_csp_ambiguous',
      'the html entry has ' + metas.length + ' Content-Security-Policy metas',
      { metas: metas.length },
    );
  }
  const metaMatch = metas[0];
  const meta = metaMatch[0];
  const contentMatch = /\bcontent\s*=\s*("|')([\s\S]*?)\1/i.exec(meta);
  if (!contentMatch) {
    throw new LabProtocolError(
      'html_preview_csp_unsupported',
      'the Content-Security-Policy meta has no quoted content attribute',
    );
  }
  const content = contentMatch[2];
  // Split the policy at ";" into directive segments, keeping each segment's own
  // offset. Whitespace around a directive - spaces, tabs, and the newline the
  // independent probe uses - is valid CSP syntax, so a segment is matched with
  // leading whitespace allowed. Directive order, spacing and newlines are all
  // kept because only the token span is ever rewritten.
  const segments = [];
  let cursor = 0;
  for (const part of content.split(';')) {
    segments.push({ start: cursor, text: part });
    cursor += part.length + 1;
  }
  const frameSrcSegments = segments.filter((segment) => {
    const name = /^[ \t\r\n]*([A-Za-z-]+)/.exec(segment.text);
    return name !== null && name[1].toLowerCase() === 'frame-src';
  });
  if (frameSrcSegments.length === 0) {
    throw new LabProtocolError(
      'html_preview_csp_unsupported',
      'the Content-Security-Policy has no frame-src directive to translate',
    );
  }
  if (frameSrcSegments.length > 1) {
    // Within ONE CSP policy a later duplicate directive is ignored: the first
    // frame-src wins (CSP3). Independently enforced policies are multiple metas or
    // headers, which are already refused above as html_preview_csp_ambiguous. So a
    // duplicate frame-src is first-wins/undefined-for-this-lab, not a second AND-ed
    // policy; rather than guess which token to splice, refuse. (Behavior unchanged.)
    throw new LabProtocolError(
      'html_preview_csp_unsupported',
      'the Content-Security-Policy has ' + frameSrcSegments.length + ' frame-src directives',
      { frameSrc: frameSrcSegments.length },
    );
  }
  const segment = frameSrcSegments[0];
  const nameMatch = /^[ \t\r\n]*frame-src(?![A-Za-z-])/i.exec(segment.text);
  if (!nameMatch) {
    throw new LabProtocolError(
      'html_preview_csp_unsupported',
      'the frame-src directive name is not exactly frame-src: ' + segment.text,
    );
  }
  const values = segment.text
    .slice(nameMatch[0].length)
    .split(/[ \t\r\n]+/)
    .filter((value) => value.length > 0);
  if (values.length !== 1 || values[0] !== HTML_PREVIEW_FRAME_TOKEN) {
    throw new LabProtocolError(
      'html_preview_csp_unsupported',
      'the frame-src directive is not exactly the expected ' + HTML_PREVIEW_FRAME_TOKEN +
        ' token: ' + segment.text.trim(),
    );
  }
  // Byte-exact splice at the token span: the quoted content value offset inside
  // the meta, plus the segment offset and the token offset inside the segment.
  const valueAt = contentMatch.index + contentMatch[0].length - content.length - 1;
  const tokenAt =
    metaMatch.index +
    valueAt +
    segment.start +
    segment.text.indexOf(HTML_PREVIEW_FRAME_TOKEN, nameMatch[0].length);
  return (
    source.slice(0, tokenAt) +
    previewOrigin +
    source.slice(tokenAt + HTML_PREVIEW_FRAME_TOKEN.length)
  );
}


/**
 * CSP for the preview surface. Deliberate, not disabled: the document may run
 * its own scripts and load relative assets from the document grant, and nothing
 * else. `connect-src 'none'` is what stops a preview script from reaching the
 * lab API even before the opaque sandbox does, and `frame-ancestors` pins the
 * only parent allowed to embed it.
 */
export function previewCsp(labOrigin, assetBase = null) {
  const imgSources = ['data:', 'blob:'];
  // The preview document stays in the opaque sandbox (no allow-same-origin), so
  // 'self' can never match its own origin. Only the current token's exact asset
  // prefix on the runtime preview origin lets a relative fixture image load.
  if (assetBase) imgSources.push(assetBase);
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval'",
    "style-src 'unsafe-inline'" + (assetBase ? ' ' + assetBase : ''),
    'img-src ' + imgSources.join(' '),
    'font-src data:',
    "connect-src 'none'",
    "media-src data: blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    'frame-ancestors ' + labOrigin,
  ].join('; ');
}

/** The CSP the lab sets on the renderer builds it serves (never removed, only tightened). */
export function appCsp(labOrigin, previewOrigin = labOrigin) {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'self' " + previewOrigin,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Per-view preview buffers. Each view has one entry keyed by view id, and the
 * preview token is a separate read-only identifier, so publishing a buffer never
 * touches the app session identity.
 */
export class PreviewBuffers {
  constructor() {
    this.byViewId = new Map();
    this.byToken = new Map();
  }

  /** Binds a fresh buffer to a view; called once, when the server opens the view. */
  register(session) {
    const entry = {
      viewId: session.viewId,
      token: session.previewToken,
      version: 0,
      text: '',
      updatedAt: null,
    };
    this.byViewId.set(session.viewId, entry);
    this.byToken.set(entry.token, entry);
    return entry;
  }

  /**
   * Stores a new buffer and returns the version. The version only moves forward,
   * so a reload served after the ack can never publish an older buffer.
   */
  publish(viewId, text) {
    const entry = this.byViewId.get(viewId);
    if (!entry) throw new LabProtocolError('unknown_view', 'no preview buffer for view ' + String(viewId));
    entry.version += 1;
    entry.text = String(text ?? '');
    entry.updatedAt = new Date().toISOString();
    return { version: entry.version, updatedAt: entry.updatedAt };
  }

  /**
   * Removes a view's buffer and drops its token from both maps, so a closed view
   * stops serving instead of leaving the last buffer readable by token.
   */
  close(viewId) {
    const entry = this.byViewId.get(viewId);
    if (!entry) return false;
    this.byViewId.delete(viewId);
    this.byToken.delete(entry.token);
    return true;
  }

  /** The buffer for a preview token, or null when the token is unknown. */
  byPreviewToken(token) {

    return this.byToken.get(token) ?? null;
  }
}

/**
 * Resolves a preview request path to bytes.
 *
 * The document is served from the view's stored preview buffer. A relative asset
 * is resolved against the opened document's directory through the view's read
 * grant, so a `../` escape or another view's directory is refused by the same
 * containment check as every other lab read.
 */
export function createPreviewResponder({ previews, sessions, labOrigin, previewOrigin = labOrigin }) {
  return async function respondPreview(token, relPath) {
    const entry = previews.byPreviewToken(token);
    if (!entry) {
      throw new LabProtocolError('unknown_preview', 'no preview for this token');
    }
    const relative = String(relPath ?? '').replace(/^\/+/, '');
    if (relative === '' || relative === 'index.html') {
      return {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          // Only this token's own asset prefix on the runtime preview origin is
          // added to img-src and style-src; all other directives are unchanged.
          'content-security-policy': previewCsp(labOrigin, previewTokenBase(previewOrigin, token)),
          'x-content-type-options': 'nosniff',
        },
        body: Buffer.from(entry.text, 'utf8'),
      };
    }
    const session = sessions.requireView(entry.viewId);
    const base = session.sourcePath ? session.sourceDir : session.workingDir;
    const target = base ? base + '/' + relative : relative;
    const real = sessions.requireReadGrant(session.viewId, target);
    const bytes = await readFileBytes(real);
    return {
      status: 200,
      headers: {
        'content-type': mimeFor(real),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; connect-src 'none'",
      },
      body: bytes,
    };
  };
}
