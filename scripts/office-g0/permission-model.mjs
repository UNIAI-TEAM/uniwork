// permission-model.mjs — DOC-005 (UNI-669) ACL and conversion-permission helpers.
// Node 22 built-ins only. No I/O, no product imports.
//
// The harness ACL is modeled (in-memory), and that label stays on every
// artifact. What this module fixes is what the model was computing, not how the
// ACL is stored:
//
//   1. A conversion that preserves the source's complete ACL must not turn the
//      converter into a manage holder. The earlier model granted the creator
//      manage on its own conversion, which is an EDIT -> MANAGE elevation: a
//      person with edit on a shared document could mint a copy they fully
//      control and quietly widen their own rights. Rights flow from the source.
//   2. A Work Product copy keeps delegating to the same owner (C-01 §13) with no
//      second door. This module never writes a document-level ACL for such a copy.
//   3. Conversion provenance is explicit: sourceVersion is the version the copy
//      was actually made from, and the source revision/version/version-count are
//      unchanged by the copy.
//
// A level is exactly one of the four primitive strings below. LEVEL_RANK is a
// plain object, so a bare LEVEL_RANK[value] would also answer inherited
// Object.prototype keys ("toString", "constructor", "__proto__") and would
// coerce non-string keys (["view"] -> "view"). Every read of a rank goes through
// rankOf(), which requires an own, primitive-string key: "view" (rank 0) is
// valid, and no other value is.

/** Ordered so a caller can compare levels without hard-coding strings. */
export const LEVELS = ["view", "comment", "edit", "manage"];
export const LEVEL_RANK = Object.freeze(Object.fromEntries(LEVELS.map((level, index) => [level, index])));

/**
 * The rank of a protocol level, or undefined when the value is not one.
 *
 * Own-property plus primitive-string checks are what make "view" (rank 0) a
 * valid level and every inherited name, array, object, String object or number
 * invalid.
 */
const rankOf = (level) =>
  typeof level === "string" && Object.hasOwn(LEVEL_RANK, level) ? LEVEL_RANK[level] : undefined;

/**
 * True only when the held level and the floor are both real levels and the held
 * level ranks at least as high. An invalid operand on either side returns false
 * rather than throwing, so a malformed value can never grant access and cannot
 * be turned into a grant by wrapping the call in a try/catch.
 */
export function levelAtLeast(level, floor) {
  const heldRank = rankOf(level);
  const floorRank = rankOf(floor);
  if (heldRank === undefined || floorRank === undefined) return false;
  return heldRank >= floorRank;
}

/**
 * A map of accountId -> level that can answer "who may do this" without the
 * caller reaching into storage. Kept tiny on purpose: this is modeled ACL state,
 * not a permission service.
 */
export function createAcl() {
  const map = new Map();
  return {
    set(accountId, level) {
      // Validate BEFORE touching the map: a refused level must leave every
      // existing grant exactly as it was.
      if (rankOf(level) === undefined) throw new TypeError("unknown level: " + level);
      map.set(accountId, level);
      return level;
    },
    delete(accountId) {
      map.delete(accountId);
    },
    get(accountId) {
      return map.get(accountId) ?? null;
    },
    has(accountId, floor) {
      return levelAtLeast(map.get(accountId), floor);
    },
    /** Membership snapshot, so a runner can assert the complete carried ACL. */
    entries() {
      return [...map.entries()]
        .map(([accountId, level]) => ({ accountId, level }))
        .sort((a, b) => a.accountId.localeCompare(b.accountId));
    },
    size() {
      return map.size;
    },
  };
}

/**
 * The ACL a converted copy starts life with, given the source ACL.
 *
 * - A plain Document copies the source's grants verbatim. The converter is
 *   included only if the source already gave them a level; the copy never adds a
 *   level the source did not have, so no edit -> manage elevation is possible.
 * - A Work Product document carries NO document ACL: access keeps flowing through
 *   the single owner delegation (C-01 §13), so the copy cannot open a second door.
 *
 * Returns a plain, sorted array so a runner can assert "complete source ACL,
 * exactly" rather than "contains at least".
 */
export function carriedAcl({ sourceOwnerKind, sourceAclEntries }) {
  if (sourceOwnerKind === "work_product") return [];
  return [...sourceAclEntries]
    .map(({ accountId, level }) => ({ accountId, level }))
    .sort((a, b) => a.accountId.localeCompare(b.accountId));
}

/**
 * True when the carried ACL would grant the converter more than the source did.
 *
 * Semantics, kept explicit and conservative:
 * - No carried level (null/undefined) is never an elevation: the copy simply
 *   carries no grant for that account.
 * - A carried level with no source level is an elevation: the copy cannot hand
 *   out a right the source never had.
 * - An unrankable level on either side cannot be proven a non-elevation, so it
 *   reports true (fail closed) rather than silently allowing a value the ACL
 *   itself would refuse.
 */
export function isElevation({ sourceLevel, carriedLevel }) {
  if (carriedLevel === null || carriedLevel === undefined) return false;
  const carriedRank = rankOf(carriedLevel);
  if (carriedRank === undefined) return true;
  if (sourceLevel === null || sourceLevel === undefined) return true;
  const sourceRank = rankOf(sourceLevel);
  if (sourceRank === undefined) return true;
  return carriedRank > sourceRank;
}
