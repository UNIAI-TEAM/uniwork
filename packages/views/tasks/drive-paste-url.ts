/**
 * Pure Google Drive file URL parser for paste detection (spec §7.5, QĐ 8).
 *
 * Recognises:
 * - `docs.google.com/{document|spreadsheets|presentation}/d/<id>` (with optional `/u/<n>/`)
 * - `drive.google.com/file/d/<id>` (with optional `/u/<n>/`)
 *
 * With or without `https://` / `http://`, `/edit`, `/view`, query string, or `#` hash.
 * Anything else (folders, `drive.google.com/drive/folders/...`, `open?id=...`,
 * published-to-web `/d/e/<id>/pub`, forms, ids shorter than `MIN_DRIVE_FILE_ID_LENGTH`,
 * tokens exceeding `MAX_URL_CANDIDATE_LENGTH`, or other hosts/schemes) returns `null`.
 */

/**
 * Minimum character length for a valid Google Drive file ID.
 * Real Google Drive / Docs / Sheets / Slides file IDs are opaque base64url-like
 * identifiers of 25–44+ characters (legacy ~25–28 chars, modern v3 ~33–44 chars).
 * Requiring ≥ 20 characters safely accepts all real Drive file IDs while
 * rejecting single-letter path markers like `/d/e/...` (published-to-web) and
 * short accidental path segments.
 */
const MIN_DRIVE_FILE_ID_LENGTH = 20;

/**
 * Maximum candidate URL token length inspected during paste parsing.
 * Normal Drive URLs are well under 500 characters; capping at 2048 prevents
 * pathological multi-kilobyte tokens from spending CPU in `new URL()` or string scans.
 */
const MAX_URL_CANDIDATE_LENGTH = 2048;

const FILE_ID_RE = /^[A-Za-z0-9_-]+$/;
const USER_INDEX_RE = /^\d+$/;
const DOCS_KINDS: Record<string, true> = {
  document: true,
  spreadsheets: true,
  presentation: true,
};
const TRAILING_PUNCTUATION: Record<string, true> = {
  ".": true,
  ",": true,
  ";": true,
  ":": true,
  "!": true,
  "?": true,
  ")": true,
  "]": true,
  "}": true,
};

function trimUrlCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length > MAX_URL_CANDIDATE_LENGTH) {
    return "";
  }
  let s = trimmed;
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

function isValidDriveFileId(fileId: string | undefined): fileId is string {
  return (
    typeof fileId === "string" &&
    fileId.length >= MIN_DRIVE_FILE_ID_LENGTH &&
    FILE_ID_RE.test(fileId)
  );
}

function parseDocsSegments(segments: string[]): string | null {
  let idx = stripUserSegment(segments, 0);
  const kind = segments[idx];
  if (!kind || !DOCS_KINDS[kind]) return null;
  idx = stripUserSegment(segments, idx + 1);
  if (segments[idx] !== "d") return null;
  const fileId = segments[idx + 1];
  // Reject published-to-web URLs (`/document/d/e/<pubId>/pub`) explicitly as
  // well as enforcing the minimum file ID length.
  if (fileId === "e" || !isValidDriveFileId(fileId)) return null;
  return fileId;
}

function parseDriveFileSegments(segments: string[]): string | null {
  let idx = stripUserSegment(segments, 0);
  if (segments[idx] !== "file") return null;
  idx = stripUserSegment(segments, idx + 1);
  if (segments[idx] !== "d") return null;
  const fileId = segments[idx + 1];
  if (fileId === "e" || !isValidDriveFileId(fileId)) return null;
  return fileId;
}

const URL_TOKEN_CANDIDATE_RE =
  /(?:https?:\/\/)?(?:docs\.google\.com|drive\.google\.com)\/[^\s<>"'`)\]]+/gi;

const HREF_ATTR_RE = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;

function stripTrailingPunctuation(token: string): string {
  let end = token.length;
  while (end > 0 && TRAILING_PUNCTUATION[token[end - 1]!]) {
    end--;
  }
  return end === token.length ? token : token.slice(0, end);
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
    if (raw.length > MAX_URL_CANDIDATE_LENGTH) return;
    const stripped = stripTrailingPunctuation(raw);
    const id =
      parseDriveFileUrl(raw) ??
      (stripped !== raw ? parseDriveFileUrl(stripped) : null);
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
