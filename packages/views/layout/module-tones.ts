import type { Tint } from "@uniwork/ui/components/common/icon-tile";

/**
 * One tint per module, read by the sidebar, page headers and empty states so
 * a module keeps its colour everywhere it appears. Tints identify; they do
 * not report state (see PRODUCT.md › Design Principles).
 */
export const MODULE_TONES = {
  inbox: "blue",
  tasks: "green",
  my_tasks: "green",
  projects: "teal",
  meetings: "violet",
  chat: "blue",
  people: "pink",
  documents: "orange",
  calendar: "yellow",
} as const satisfies Record<string, Tint>;

export type ModuleKey = keyof typeof MODULE_TONES;

export function moduleTone(module: ModuleKey): Tint {
  return MODULE_TONES[module];
}
