import {
  ancestorsOf,
  elementBySid,
  HtmlOpError,
  isDescendant,
  requireElement,
  type HtmlElementEntry,
  type HtmlTarget,
} from "./match";
import type { UpstreamParseMap } from "@uniwork/office-engine/html";

// Where a `move` op puts an element. genoffice's document ops (pinned
// 09485f88) resolve a destination to a single source offset and reject a move
// that would drop an element inside itself; this module is that decision,
// kept out of the op builders so the ribbon and the drag bridge share one
// rule.

/** One end of a move. `before`/`after` place the element next to a sibling;
 * `appendTo` puts it last inside a container. */
export type MoveDestination = { before: HtmlTarget } | { after: HtmlTarget } | { appendTo: HtmlTarget };

/** A resolved destination: the source offset the element text is inserted at,
 * in the ORIGINAL coordinates the patch set is expressed in. */
export interface ResolvedDestination {
  offset: number;
  element: HtmlElementEntry;
}

export type MoveDirection = "up" | "down";

function destinationTarget(destination: MoveDestination): HtmlTarget {
  if ("before" in destination) return destination.before;
  if ("after" in destination) return destination.after;
  return destination.appendTo;
}

export function resolveMoveDestination(map: UpstreamParseMap, destination: MoveDestination): ResolvedDestination {
  const element = requireElement(map, destinationTarget(destination));
  if ("before" in destination) return { offset: element.range[0], element };
  if ("after" in destination) return { offset: element.range[1], element };
  return { offset: element.inner[1], element };
}

/**
 * Reject a move that cannot be expressed as delete + insert without a
 * self-overlap: a destination inside the moved element (or its own subtree)
 * would make the two patches overlap, and a destination at either edge of the
 * element is a no-op that would silently reorder nothing.
 */
export function assertMovable(map: UpstreamParseMap, source: HtmlElementEntry, resolved: ResolvedDestination): void {
  const [from, to] = source.range;
  if (resolved.offset > from && resolved.offset < to) {
    throw new HtmlOpError("invalid_move", "destination is inside the moved element", {
      sid: source.sid,
      offset: resolved.offset,
    });
  }
  if (resolved.offset === from || resolved.offset === to) {
    throw new HtmlOpError("invalid_move", "destination is the moved element's own edge", {
      sid: source.sid,
      offset: resolved.offset,
    });
  }
  if (isDescendant(map, source.sid, resolved.element.sid)) {
    throw new HtmlOpError("invalid_move", "destination is inside the moved element's subtree", {
      sid: source.sid,
      destination_sid: resolved.element.sid,
    });
  }
}

/** The previous/next sibling of `sid`, or null at the edge. */
export function siblingInDirection(map: UpstreamParseMap, sid: number, direction: MoveDirection): HtmlElementEntry | null {
  const element = elementBySid(map, sid);
  if (!element) return null;
  const siblings = map.elements.filter((candidate) => candidate.parentSid === element.parentSid);
  const at = siblings.findIndex((candidate) => candidate.sid === sid);
  if (at === -1) return null;
  const next = direction === "up" ? at - 1 : at + 1;
  return siblings[next] ?? null;
}

/** The destination for a "move up" / "move down" command: before the previous
 * sibling, or after the next one. Null at the edge of the sibling list. */
export function siblingMoveDestination(
  map: UpstreamParseMap,
  sid: number,
  direction: MoveDirection,
): MoveDestination | null {
  const sibling = siblingInDirection(map, sid, direction);
  if (!sibling) return null;
  return direction === "up" ? { before: { sid: sibling.sid } } : { after: { sid: sibling.sid } };
}

/** Ancestor chain of a target, outermost first - the containment check a
 * caller uses before offering a drop zone. */
export function targetAncestors(map: UpstreamParseMap, target: HtmlTarget): HtmlElementEntry[] {
  return ancestorsOf(map, requireElement(map, target).sid);
}
