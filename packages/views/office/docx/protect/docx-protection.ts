// C3 (UNI-924): the protection model the Review ▸ Protect panel and the
// command area share. The engine seam hands `unknown` shapes, so the reader
// accepts only the records the vendored parse actually produces (anything
// else reads as "no state", never as a guessed one) and the comparators keep
// an unchanged apply a no-op.
import type { DocProtection, WriteProtection } from "@uniwork/office-engine/docx";

/** One pending protection edit: a present key replaces that tag on the next
 * save, null removes it, an absent key keeps the document's own value. Plain
 * JSON — it rides the draft snapshot. */
export interface DocxProtectionEdit {
  protection?: DocProtection | null;
  writeProtection?: WriteProtection | null;
}

/** The effective protection state the panel renders. */
export interface DocxProtectionSnapshot {
  protection: DocProtection | null;
  writeProtection: WriteProtection | null;
  /** A pending edit will reach the next save. */
  pending: boolean;
}

/** Word's w:edit values the panel offers (ST_ProtectionType subset). */
export const DOCX_PROTECTION_MODES = ["readOnly", "comments", "trackedChanges", "forms"] as const;
export type DocxProtectionMode = (typeof DOCX_PROTECTION_MODES)[number];

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

/** A parse-produced restriction (upstream parseProtection), or null when the
 * record is not one the engine produces. */
export function protectionFromParsed(value: unknown): DocProtection | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.edit !== "string" || raw.edit.length === 0) return null;
  if (typeof raw.enforced !== "boolean") return null;
  const protection: DocProtection = { edit: raw.edit, enforced: raw.enforced };
  const hash = optionalString(raw.hash);
  const salt = optionalString(raw.salt);
  const spinCount = optionalInteger(raw.spinCount);
  const algorithmSid = optionalInteger(raw.algorithmSid);
  if (hash !== undefined) protection.hash = hash;
  if (salt !== undefined) protection.salt = salt;
  if (spinCount !== undefined) protection.spinCount = spinCount;
  if (algorithmSid !== undefined) protection.algorithmSid = algorithmSid;
  return protection;
}

/** A parse-produced password-to-modify (upstream parseWriteProtection), or
 * null when the tag carried neither a recommendation nor a hash. */
export function writeProtectionFromParsed(value: unknown): WriteProtection | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.recommended !== undefined && typeof raw.recommended !== "boolean") return null;
  const writeProtection: WriteProtection = {};
  if (raw.recommended === true) writeProtection.recommended = true;
  const hash = optionalString(raw.hash);
  const salt = optionalString(raw.salt);
  const spinCount = optionalInteger(raw.spinCount);
  const algorithmSid = optionalInteger(raw.algorithmSid);
  if (hash !== undefined) writeProtection.hash = hash;
  if (salt !== undefined) writeProtection.salt = salt;
  if (spinCount !== undefined) writeProtection.spinCount = spinCount;
  if (algorithmSid !== undefined) writeProtection.algorithmSid = algorithmSid;
  if (writeProtection.recommended !== true && writeProtection.hash === undefined) return null;
  return writeProtection;
}

/** Read both protection tags off an open parse. */
export function protectionStateFromParsed(parsed: unknown): {
  protection: DocProtection | null;
  writeProtection: WriteProtection | null;
} {
  const source = (parsed ?? {}) as Record<string, unknown>;
  return {
    protection: protectionFromParsed(source.protection),
    writeProtection: writeProtectionFromParsed(source.writeProtection),
  };
}

/** Equality over the save-relevant fields. */
export function protectionEquals(left: DocProtection | null, right: DocProtection | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.edit === right.edit &&
    left.enforced === right.enforced &&
    left.hash === right.hash &&
    left.salt === right.salt &&
    left.spinCount === right.spinCount &&
    left.algorithmSid === right.algorithmSid
  );
}

export function writeProtectionEquals(left: WriteProtection | null, right: WriteProtection | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.recommended === right.recommended &&
    left.hash === right.hash &&
    left.salt === right.salt &&
    left.spinCount === right.spinCount &&
    left.algorithmSid === right.algorithmSid
  );
}

export interface DocxRestrictionSummary {
  mode: string;
  /** The mode is one the panel can label; unknown values render verbatim. */
  known: boolean;
  enforced: boolean;
  passwordProtected: boolean;
}

export function restrictionSummary(protection: DocProtection | null): DocxRestrictionSummary | null {
  if (!protection) return null;
  return {
    mode: protection.edit,
    known: (DOCX_PROTECTION_MODES as readonly string[]).includes(protection.edit),
    enforced: protection.enforced,
    passwordProtected: protection.hash !== undefined,
  };
}

export interface DocxModifySummary {
  recommended: boolean;
  passwordProtected: boolean;
}

export function modifySummary(writeProtection: WriteProtection | null): DocxModifySummary | null {
  if (!writeProtection) return null;
  return {
    recommended: writeProtection.recommended === true,
    passwordProtected: writeProtection.hash !== undefined,
  };
}
