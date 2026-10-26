/**
 * Pure Google Drive file URL parser for paste detection (spec §7.5, QĐ 8).
 *
 * Recognises:
 * - `docs.google.com/{document|spreadsheets|presentation}/d/<id>` (with optional `/u/<n>/`)
 * - `drive.google.com/file/d/<id>` (with optional `/u/<n>/`)
 *
 * With or without `https://` / `http://`, `/edit`, `/view`, query string, or `#` hash.
 * Anything else (folders, `drive.google.com/drive/folders/...`, `open?id=...`,
 * forms, other hosts or schemes) returns `null`.
 */

const FILE_ID_RE = /^[A-Za-z0-9_-]+$/;
const USER_INDEX_RE = /^\d+$/;
const DOCS_KINDS: Record<string, true> = {
  document: true,
  spreadsheets: true,
  presentation: true,
};

function trimUrlCandidate(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("<") && s.endsWith(">")) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

export function parseDriveFileUrl(raw: string): string | null {
  const candidate = trimUrlCandidate(raw);
  if (!candidate) return null;

  let normalized = candidate;
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(normalized);
  if (schemeMatch) {
    const scheme = schemeMatch[1]?.toLowerCase();
    if (scheme !== "https" && scheme !== "http") {
      return null;
    }
  } else if (normalized.startsWith("//")) {
    return null;
  } else {
    normalized = `https://${normalized}`;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }

  if (url.username || url.password || url.port) {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "docs.google.com") {
    return parseDocsSegments(segments);
  }
  if (host === "drive.google.com") {
    return parseDriveFileSegments(segments);
  }
  return null;
}

function stripUserSegment(segments: string[], startIndex: number): number {
  if (
    segments[startIndex] === "u" &&
    segments[startIndex + 1] !== undefined &&
    USER_INDEX_RE.test(segments[startIndex + 1]!)
  ) {
    return startIndex + 2;
  }
  return startIndex;
}

function parseDocsSegments(segments: string[]): string | null {
  let idx = stripUserSegment(segments, 0);
  const kind = segments[idx];
  if (!kind || !DOCS_KINDS[kind]) return null;
  idx = stripUserSegment(segments, idx + 1);
  if (segments[idx] !== "d") return null;
  const fileId = segments[idx + 1];
  if (!fileId || !FILE_ID_RE.test(fileId)) return null;
  return fileId;
}

function parseDriveFileSegments(segments: string[]): string | null {
  let idx = stripUserSegment(segments, 0);
  if (segments[idx] !== "file") return null;
  idx = stripUserSegment(segments, idx + 1);
  if (segments[idx] !== "d") return null;
  const fileId = segments[idx + 1];
  if (!fileId || !FILE_ID_RE.test(fileId)) return null;
  return fileId;
}

const URL_TOKEN_CANDIDATE_RE =
  /(?:https?:\/\/)?(?:docs\.google\.com|drive\.google\.com)\/[^\s<>"'`)\]]+/gi;

const HREF_ATTR_RE = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;

function stripTrailingPunctuation(token: string): string {
  return token.replace(/[.,;:!?)\]}]+$/, "");
}

/**
 * Extracts distinct Google Drive file IDs in order of appearance from pasted
 * `text/plain` and `text/html`.
 */
export function extractDriveFileIdsFromPaste(
  text: string,
  html?: string,
): string[] {
  const seen = new Set<string>();
  const addCandidate = (raw: string) => {
    const id =
      parseDriveFileUrl(raw) ??
      parseDriveFileUrl(stripTrailingPunctuation(raw));
    if (id && !seen.has(id)) {
      seen.add(id);
    }
  };

  if (text) {
    const trimmed = text.trim();
    if (!/\s/.test(trimmed)) {
      addCandidate(trimmed);
    }
    URL_TOKEN_CANDIDATE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_TOKEN_CANDIDATE_RE.exec(text)) !== null) {
      const start = match.index;
      // Reject tokens embedded inside another host or path (e.g. `evil.com/https://docs.google.com/...`
      // or `foo.docs.google.com/...`).
      if (start > 0) {
        const prev = text[start - 1]!;
        if (/[A-Za-z0-9_./:-]/.test(prev)) {
          continue;
        }
      }
      addCandidate(match[0]);
    }
  }

  if (html) {
    HREF_ATTR_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HREF_ATTR_RE.exec(html)) !== null) {
      const href = match[1] ?? match[2];
      if (href) {
        addCandidate(href);
      }
    }
  }

  return Array.from(seen);
}
