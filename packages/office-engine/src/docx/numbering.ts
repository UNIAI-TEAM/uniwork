// B5 (UNI-924): the numbering-part edits a DOCX save carries. The vendored
// writer appends newDefs (a new abstractNum + w:num) and restartNums (a w:num
// over an EXISTING abstractNum with w:lvlOverride start overrides) to
// word/numbering.xml; this module owns the pending list and the oracles that
// keep a malformed or colliding entry out of the part. Split out of model.ts,
// which is at the 500-line budget.
import {
  DocxEngineError,
  type DocxNewNumberingDef,
  type DocxNumberingDef,
  type DocxNumberingLevelSpec,
  type DocxNumberingOptions,
  type DocxRestartNumbering,
} from "./engine";

/** Word's list levels: w:ilvl 0..8. */
const MAX_NUMBERING_LEVEL = 8;
const NUMERIC_NUM_ID = /^\d+$/;

/** numId oracle: the writer interpolates the id into a w:numId attribute and
 * Word resolves w:numPr against it, so it must be a numeric string (blank.ts:23
 * assigns 1/2; a new list starts above the part's max). */
function requireNumberingNumId(numId: unknown, what: string): asserts numId is string {
  if (typeof numId !== "string" || !NUMERIC_NUM_ID.test(numId)) {
    throw new DocxEngineError("bad_numbering_def", what + " needs a numeric numId, got " + String(numId));
  }
}

/** Level oracle: the writer renders these fields straight into w:lvl, so a
 * non-finite indent or a blank format would corrupt the part. */
function requireNumberingLevel(level: DocxNumberingLevelSpec, at: number, what: string): void {
  if (!level || typeof level !== "object") {
    throw new DocxEngineError("bad_numbering_level", what + " level " + at + " needs an object");
  }
  if (typeof level.numFmt !== "string" || level.numFmt.length === 0) {
    throw new DocxEngineError("bad_numbering_level", what + " level " + at + " needs a numFmt");
  }
  if (typeof level.lvlText !== "string" || level.lvlText.length === 0) {
    throw new DocxEngineError("bad_numbering_level", what + " level " + at + " needs lvlText");
  }
  if (!Number.isFinite(level.indentLeft) || level.indentLeft < 0) {
    throw new DocxEngineError("bad_numbering_level", what + " level " + at + " needs a non-negative indentLeft");
  }
  if (level.hanging !== undefined && !Number.isFinite(level.hanging)) {
    throw new DocxEngineError("bad_numbering_level", what + " level " + at + " hanging must be finite");
  }
  if (level.start !== undefined && (!Number.isInteger(level.start) || level.start < 1)) {
    throw new DocxEngineError("bad_numbering_level", what + " level " + at + " start must be a positive integer");
  }
}

function requireNumberingLevels(levels: DocxNumberingLevelSpec[], what: string): void {
  if (!Array.isArray(levels) || levels.length === 0 || levels.length > MAX_NUMBERING_LEVEL + 1) {
    throw new DocxEngineError("bad_numbering_levels", what + " needs 1-" + String(MAX_NUMBERING_LEVEL + 1) + " levels");
  }
  levels.forEach((level, at) => requireNumberingLevel(level, at, what));
}

function cloneNewNumberingDef(def: DocxNewNumberingDef): DocxNewNumberingDef {
  return { numId: def.numId, kind: def.kind, ...(def.levels ? { levels: def.levels.map((level) => ({ ...level })) } : {}) };
}

function cloneRestartNumbering(restart: DocxRestartNumbering): DocxRestartNumbering {
  return { numId: restart.numId, abstractNumId: restart.abstractNumId, startOverrides: { ...restart.startOverrides } };
}

/** The session's pending numbering-part edits (one instance per open model;
 * rebase replaces it with a fresh one over the new parse). */
export class DocxNumberingEdits {
  private newDefs: DocxNewNumberingDef[] = [];
  private restartNums: DocxRestartNumbering[] = [];

  /** `part` is the open parse's own definition map — the collision/target
   * oracle. undefined when the document carries no numbering part yet. */
  constructor(private part: ReadonlyMap<string, DocxNumberingDef> | undefined) {}

  /** Every numId the part will carry after this save: the parse's own
   * definitions plus the session's pending ones. The writer appends raw w:num
   * entries, so a duplicate id would make Word's lookup ambiguous. */
  private takenNumIds(): Set<string> {
    const taken = new Set<string>();
    if (this.part) for (const id of this.part.keys()) taken.add(id);
    for (const def of this.newDefs) taken.add(def.numId);
    for (const restart of this.restartNums) taken.add(restart.numId);
    return taken;
  }

  /** The abstractNum ids the part actually carries — the only legal targets a
   * restart num can point at. */
  private abstractNumIds(): Set<string> {
    const ids = new Set<string>();
    if (this.part) {
      for (const def of this.part.values()) {
        if (typeof def.abstractNumId === "string" && def.abstractNumId.length > 0) ids.add(def.abstractNumId);
      }
    }
    return ids;
  }

  /** Append a brand-new numbering definition: the save assigns the abstractNum
   * id and writes abstractNum + w:num. `levels` (up to nine, array index =
   * w:ilvl) describe a multilevel/bullet/numbering definition; absent means the
   * blank-template style. A non-numeric or already-taken numId is refused. */
  insert(def: DocxNewNumberingDef): void {
    if (!def || typeof def !== "object") {
      throw new DocxEngineError("bad_numbering_def", "insert_numbering_def needs a definition object");
    }
    requireNumberingNumId(def.numId, "insert_numbering_def");
    if (def.kind !== "bullet" && def.kind !== "ordered") {
      throw new DocxEngineError("bad_numbering_kind", "insert_numbering_def kind " + String(def.kind) + " is not bullet/ordered");
    }
    if (def.levels !== undefined) requireNumberingLevels(def.levels, "insert_numbering_def");
    if (this.takenNumIds().has(def.numId)) {
      throw new DocxEngineError("duplicate_num_id", "numId " + def.numId + " already exists in the numbering part");
    }
    this.newDefs.push(cloneNewNumberingDef(def));
  }

  /** Append a restart num: a new w:num over an EXISTING abstractNum with
   * w:lvlOverride/w:startOverride (Word restarts the counters for the new
   * numId; the body items must carry it). An abstractNum the part does not
   * carry is refused — the appended w:num would dangle. */
  restart(restart: DocxRestartNumbering): void {
    if (!restart || typeof restart !== "object") {
      throw new DocxEngineError("bad_numbering_restart", "restart_numbering needs a restart object");
    }
    requireNumberingNumId(restart.numId, "restart_numbering");
    if (typeof restart.abstractNumId !== "string" || restart.abstractNumId.length === 0) {
      throw new DocxEngineError("bad_numbering_restart", "restart_numbering needs an abstractNumId");
    }
    if (this.takenNumIds().has(restart.numId)) {
      throw new DocxEngineError("duplicate_num_id", "numId " + restart.numId + " already exists in the numbering part");
    }
    if (!this.abstractNumIds().has(restart.abstractNumId)) {
      throw new DocxEngineError(
        "unknown_abstract_num",
        "restart_numbering abstractNumId " + restart.abstractNumId + " is not in the numbering part",
      );
    }
    const overrides = restart.startOverrides;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      throw new DocxEngineError("bad_start_override", "restart_numbering needs a startOverrides object");
    }
    for (const [ilvl, value] of Object.entries(overrides)) {
      const level = Number(ilvl);
      if (!Number.isInteger(level) || level < 0 || level > MAX_NUMBERING_LEVEL) {
        throw new DocxEngineError("bad_start_override", "startOverride level " + ilvl + " is outside 0-" + String(MAX_NUMBERING_LEVEL));
      }
      if (!Number.isInteger(value) || value < 1) {
        throw new DocxEngineError("bad_start_override", "startOverride " + ilvl + " must be a positive integer");
      }
    }
    this.restartNums.push(cloneRestartNumbering(restart));
  }

  /** The pending edits as the save's numbering option; undefined while there
   * are none, so an untouched word/numbering.xml stays byte-identical. */
  options(): DocxNumberingOptions | undefined {
    if (this.newDefs.length === 0 && this.restartNums.length === 0) return undefined;
    return { newDefs: this.newDefs.map(cloneNewNumberingDef), restartNums: this.restartNums.map(cloneRestartNumbering) };
  }
}
