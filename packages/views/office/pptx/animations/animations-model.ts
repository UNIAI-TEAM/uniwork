// B5ui (UNI-927) - pure helpers for the Animations pane.
//
// The pane's own row type plus the ordering / step-numbering / seconds logic,
// kept out of the component so every rule is unit-testable without a DOM. The
// effect and trigger vocabularies come from the B5e module (PPTX_ANIM_EFFECTS /
// PPTX_ANIM_TRIGGERS), never re-declared here.

import {
  PPTX_ANIM_EFFECTS,
  PPTX_ANIM_TRIGGERS,
  type PptxAnimEffect,
  type PptxAnimTrigger,
} from "@uniwork/office-engine/pptx";

/** One row of the pane: the effect, its start trigger and its timing. The
 * source element is not part of a row - the pane adds rows to the current
 * selection, so the target travels beside the list, not inside every entry. */
export interface PptxAnimationEntry {
  effect: PptxAnimEffect;
  trigger: PptxAnimTrigger;
  durationMs: number;
  delayMs: number;
}

/** The animation classes the vendored engine groups effects into
 * (pptx-engine/src/animation.ts animClassOf). */
export type PptxAnimClass = "entrance" | "emphasis" | "exit" | "path";

export function isPptxAnimEffect(value: unknown): value is PptxAnimEffect {
  return typeof value === "string" && (PPTX_ANIM_EFFECTS as readonly string[]).includes(value);
}

export function isPptxAnimTrigger(value: unknown): value is PptxAnimTrigger {
  return typeof value === "string" && (PPTX_ANIM_TRIGGERS as readonly string[]).includes(value);
}

/** A read-back effect/trigger that is not a known kind resolves to the safest
 * member instead of an unlabelled row. */
export function resolveEffect(value: unknown): PptxAnimEffect {
  return isPptxAnimEffect(value) ? value : "fade";
}

export function resolveTrigger(value: unknown): PptxAnimTrigger {
  return isPptxAnimTrigger(value) ? value : "onClick";
}

/** The vendored default duration per effect (animation-ops.ts defaultDuration):
 * appear/disappear are instant, the slow effects run 2 s, pulse/teeter 1 s and
 * everything else 0.5 s. */
export function animDefaultDurationMs(effect: PptxAnimEffect): number {
  if (effect === "appear" || effect === "disappear") return 0;
  if (effect === "spin" || effect === "grow" || effect === "bounce" || effect === "motionPath") return 2000;
  if (effect === "pulse" || effect === "teeter") return 1000;
  return 500;
}

/** The class an effect belongs to (entrance / emphasis / exit / motion path),
 * mirroring the vendored animClassOf. */
export function animEffectClass(effect: PptxAnimEffect): PptxAnimClass {
  switch (effect) {
    case "appear":
    case "fade":
    case "flyIn":
    case "wipe":
    case "wipeDown":
    case "splitIn":
    case "bounce":
    case "flipIn":
    case "zoom":
      return "entrance";
    case "pulse":
    case "spin":
    case "grow":
    case "teeter":
      return "emphasis";
    case "motionPath":
      return "path";
    default:
      return "exit";
  }
}

/**
 * Step numbers for the list, 1-based. "On click" starts a new step; "with
 * previous" / "after previous" share the previous step, so they carry null (the
 * row shows no number) - the same reading the genoffice pane uses.
 */
export function animStepNumbers(entries: readonly PptxAnimationEntry[]): (number | null)[] {
  const out: (number | null)[] = [];
  let step = 0;
  for (const entry of entries) {
    if (entry.trigger === "onClick") step += 1;
    out.push(entry.trigger === "onClick" ? step : null);
  }
  return out;
}

/** Move one entry to another index; out-of-range or a no-op returns a copy, so
 * the caller can always commit the result. */
export function moveEntry<T>(entries: readonly T[], from: number, to: number): T[] {
  const next = [...entries];
  if (from === to || from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Remove the entry at `index`; an out-of-range index is a no-op copy. */
export function removeEntryAt<T>(entries: readonly T[], index: number): T[] {
  if (index < 0 || index >= entries.length) return [...entries];
  return entries.filter((_, i) => i !== index);
}

/** Seconds -> ms for the duration/delay fields. Non-negative finite only;
 * everything else is invalid and must not reach the edit channel. */
export type PptxSecondsParse = { kind: "ms"; ms: number } | { kind: "invalid" };

export function parseSecondsToMs(text: string): PptxSecondsParse {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { kind: "invalid" };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return { kind: "invalid" };
  return { kind: "ms", ms: Math.round(value * 1000) };
}

/** ms -> the seconds text a field shows: 500 -> "0.5", 2000 -> "2". */
export function msToSecondsText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0";
  return String(Number((ms / 1000).toFixed(3)));
}

/** i18n key (under office.pptx.animations) for one effect's label. */
export function animEffectLabelKey(effect: PptxAnimEffect): string {
  return "effect." + effect;
}

/** i18n key for one trigger's label. */
export function animTriggerLabelKey(trigger: PptxAnimTrigger): string {
  return "trigger." + trigger;
}

/** i18n key for one class badge. */
export function animClassLabelKey(cls: PptxAnimClass): string {
  return "class." + cls;
}
