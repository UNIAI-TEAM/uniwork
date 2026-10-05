// Replay-stable element refs for the host pptx edit journal (UNI-927 W12).
//
// Every element id the vendored engine hands out is session-scoped: parsing
// mints uid('sp') from a module counter, inserts mint spnew_<n>_<time>, and
// any whole-slide reparse (tables, charts, groups, links, ...) renames every
// element on that slide. A journal that stores caller ids therefore cannot be
// replayed onto a reopened base: the first element-targeted entry misses.
//
// What IS stable is structure: replaying the same entries onto the same base
// bytes rebuilds the same deck shape, so the element an entry targeted sits
// at the same (slide, tree path) right before that entry runs, on the first
// apply and on every replay. `annotatePptxReplayRefs` records that position
// for each element-id field the moment the entry first applies (`__refs`, a
// field-path -> "slide:i/j" map carried inside the flat journal entry, so the
// snapshot, its fingerprint and draft recovery stay one flat edit list), and
// `resolvePptxReplayRefs` turns each position back into the live id of the
// deck being replayed, stripping `__refs` before the engine sees the edit.
//
// Section GUIDs (rename/remove/move_section) are not covered: add_section
// mints a random GUID and no host reads sections yet; a stale section id
// refuses on replay and the runtime poisons the session (loud, not silent).
import { PptxEngineError } from "./engine";
import type { PptxEdit } from "./model";

/** The journal-entry field that carries the recorded positions. */
const PPTX_REPLAY_REFS_KEY = "__refs";

/** Typed refusal code of a host runtime whose replay failed after the engine
 * session was swapped: the model no longer matches the journal, so every
 * later edit, history move, restore and save refuses with it. */
export const PPTX_SESSION_DIVERGED = "pptx_session_diverged";

/** Fields whose string values (or string-array values) are element ids. */
const ELEMENT_ID_KEYS = new Set(["elementId", "elementIds", "groupId", "sourceId"]);
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

interface ReplayElement {
  id?: string;
  children?: ReplayElement[];
}

/** The deck shape the refs walk: slides of (possibly grouped) elements. */
export interface PptxReplayDeck {
  slides: ReadonlyArray<{ elements?: ReplayElement[] }>;
}

type Visit = (path: string, value: string) => void;

function visitElementIds(value: unknown, path: string, visit: Visit): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitElementIds(item, path ? `${path}.${index}` : String(index), visit));
    return;
  }
  if (!value || typeof value !== "object" || value instanceof Uint8Array) return;
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (key === PPTX_REPLAY_REFS_KEY) continue;
    const at = path ? `${path}.${key}` : key;
    if (ELEMENT_ID_KEYS.has(key) && typeof field === "string") visit(at, field);
    else if (ELEMENT_ID_KEYS.has(key) && Array.isArray(field)) {
      field.forEach((item, index) => {
        if (typeof item === "string") visit(`${at}.${index}`, item);
      });
    } else visitElementIds(field, at, visit);
  }
}

/** live element id -> "slide:i/j" position, depth-first through groups. */
function indexDeck(deck: PptxReplayDeck): Map<string, string> {
  const index = new Map<string, string>();
  const walk = (elements: readonly ReplayElement[] | undefined, prefix: string): void => {
    (elements ?? []).forEach((element, position) => {
      const token = prefix + String(position);
      if (typeof element.id === "string" && !index.has(element.id)) index.set(element.id, token);
      if (Array.isArray(element.children)) walk(element.children, token + "/");
    });
  };
  deck.slides.forEach((slide, slideIndex) => walk(slide.elements, `${slideIndex}:`));
  return index;
}

function resolveToken(deck: PptxReplayDeck, token: string): string | undefined {
  const match = /^(\d+):(\d+(?:\/\d+)*)$/.exec(token);
  if (!match) return undefined;
  let elements = deck.slides[Number(match[1])]?.elements;
  let element: ReplayElement | undefined;
  for (const step of (match[2] as string).split("/")) {
    element = elements?.[Number(step)];
    if (!element) return undefined;
    elements = element.children;
  }
  return typeof element?.id === "string" ? element.id : undefined;
}

function refusal(code: string, message: string): PptxEngineError {
  return new PptxEngineError(code, message);
}

/** Copy `target` with the string at `segments` replaced by `id`, cloning only
 * along the path. A path that does not end on an existing string is a
 * malformed (e.g. hand-edited draft) entry and refuses. */
function withId(target: unknown, segments: readonly string[], id: string, path: string): unknown {
  const [head, ...rest] = segments;
  if (head === undefined || FORBIDDEN_SEGMENTS.has(head) || !target || typeof target !== "object") {
    throw refusal("pptx_replay_refs_invalid", "replay ref path " + path + " does not address an element id");
  }
  const container = target as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(container, head)) {
    throw refusal("pptx_replay_refs_invalid", "replay ref path " + path + " does not address an element id");
  }
  const current = container[head];
  let next: unknown;
  if (rest.length === 0) {
    if (typeof current !== "string") {
      throw refusal("pptx_replay_refs_invalid", "replay ref path " + path + " does not address an element id");
    }
    next = id;
  } else {
    next = withId(current, rest, id, path);
  }
  if (Array.isArray(container)) {
    const copy = [...container];
    copy[Number(head)] = next;
    return copy;
  }
  return { ...container, [head]: next };
}

function stripRefs(entry: PptxEdit): { edit: PptxEdit; refs: unknown } {
  const { [PPTX_REPLAY_REFS_KEY]: refs, ...edit } = entry as PptxEdit & { [PPTX_REPLAY_REFS_KEY]?: unknown };
  return { edit: edit as PptxEdit, refs };
}

/**
 * Record, for every element-id field of `edit`, where that element sits in
 * `deck` (the deck the edit is about to apply to). Ids the deck does not hold
 * are left unrecorded: the engine refuses them on the first apply anyway.
 * Returns the edit unchanged (minus any caller-sent `__refs`) when it names
 * no element.
 */
export function annotatePptxReplayRefs(deck: PptxReplayDeck, edit: PptxEdit): PptxEdit {
  const { edit: bare } = stripRefs(edit);
  const index = indexDeck(deck);
  const refs: Record<string, string> = {};
  visitElementIds(bare, "", (path, value) => {
    const token = index.get(value);
    if (token !== undefined) refs[path] = token;
  });
  if (Object.keys(refs).length === 0) return bare;
  return { ...bare, [PPTX_REPLAY_REFS_KEY]: refs } as unknown as PptxEdit;
}

/**
 * The engine-ready edit for one journal entry on `deck`: every recorded
 * position becomes the id the element carries in this deck, and `__refs` is
 * dropped. An entry without refs (no element fields, or a draft written
 * before refs existed) passes through as is. A position this deck does not
 * hold refuses with `pptx_replay_ref_unresolved`.
 */
export function resolvePptxReplayRefs(deck: PptxReplayDeck, entry: PptxEdit): PptxEdit {
  const { edit, refs } = stripRefs(entry);
  if (refs === undefined) return edit;
  if (!refs || typeof refs !== "object" || Array.isArray(refs)) {
    throw refusal("pptx_replay_refs_invalid", "journal entry carries malformed replay refs");
  }
  let out: unknown = edit;
  for (const [path, token] of Object.entries(refs as Record<string, unknown>)) {
    if (typeof token !== "string") throw refusal("pptx_replay_refs_invalid", "replay ref " + path + " is not a position");
    const id = resolveToken(deck, token);
    if (id === undefined) {
      throw refusal("pptx_replay_ref_unresolved", "replay ref " + path + " -> " + token + " has no element in the replayed deck");
    }
    out = withId(out, path.split("."), id, path);
  }
  return out as PptxEdit;
}

/** The poison a host runtime records when a post-swap replay failed. */
export function pptxSessionDivergedError(cause: unknown): PptxEngineError {
  const reason = cause instanceof Error ? (cause as Partial<PptxEngineError>).code ?? cause.message : String(cause);
  const error = refusal(PPTX_SESSION_DIVERGED, "pptx session diverged from its edit journal (replay failed: " + reason + "); reopen the document");
  (error as { cause?: unknown }).cause = cause;
  return error;
}

/** True for the runtime's diverged-session refusal. */
export function isPptxSessionDiverged(error: unknown): boolean {
  return error instanceof PptxEngineError && error.code === PPTX_SESSION_DIVERGED;
}
