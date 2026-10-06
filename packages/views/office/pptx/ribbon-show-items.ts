/**
 * Slide Show tab commands (UNI-927 W5, F-05): the audience show from the first
 * visible slide or from the current one, and the presenter console. Pure data
 * for the shared ribbon; the editor owns the show state.
 */
import { MonitorPlay, Play, Presentation } from "lucide-react";
import type { RibbonItem } from "../ribbon";

export interface PptxShowGroupOptions {
  /** False when the deck has no slide: every item disabled with the reason. */
  canShow: boolean;
  onFromStart: () => void;
  onFromCurrent: () => void;
  onPresenterView: () => void;
}

export function pptxShowGroupItems({ canShow, onFromStart, onFromCurrent, onPresenterView }: PptxShowGroupOptions): RibbonItem[] {
  const disabled = !canShow;
  const guard = (run: () => void) => () => { if (!disabled) run(); };
  const common = { disabled, ...(disabled ? { tooltipKey: "office.pptx.no_slides" } : {}) };
  return [
    { kind: "button", id: "show-from-start", labelKey: "office.pptx.show_menu.from_start", icon: Play, size: "large", ...common, onExecute: guard(onFromStart) },
    { kind: "button", id: "show-from-current", labelKey: "office.pptx.show_menu.from_current", icon: MonitorPlay, size: "small", ...common, onExecute: guard(onFromCurrent) },
    { kind: "button", id: "show-presenter-view", labelKey: "office.pptx.show_menu.presenter_view", icon: Presentation, size: "small", ...common, onExecute: guard(onPresenterView) },
  ];
}
