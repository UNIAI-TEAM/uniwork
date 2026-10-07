/**
 * What each PPTX command can actually do on this editor surface (UNI-927 W5).
 *
 * Pure: the editor passes which channels the host bound and gets the capability
 * overrides for the command map. A command whose panel writes the deck
 * (animations, charts, tables) is available exactly when an edit channel exists;
 * without one it stays disabled with an i18n reason key, never a raw sentence.
 * Speaker notes are read-capable (W9 review F3, same class as comments): the
 * command always opens/closes the pane, which shows its own read-only state.
 */
import type { PptxCommandCapability, PptxCommandId } from "./command-map";
import type { OfficePrintPort } from "../print";
import { pptxPrintCapability } from "./print";

type CapabilityInput = PptxCommandCapability | "available" | "readonly" | "unavailable" | "unknown";

export interface PptxEditorChannels {
  open: boolean;
  /** The host's no-selection text seam (`onTextEdit`). */
  textEdit: boolean;
  /** The in-place text commit channel (`onCommitText`): Text runs over a selected text element. */
  commitText?: boolean;
  /** The current selection is a text element the in-place editor can open on. */
  textSelected?: boolean;
  transform: boolean;
  /** A generic edit channel (host onApplyEdit or the handle's edit port). */
  edit: boolean;
  printPort: OfficePrintPort | null;
  /** A print run is in flight: Print and Export PDF show disabled until it settles. */
  printPending?: boolean;
}

/** Commands whose ribbon item opens a panel bound to the generic edit channel. */
export const PPTX_PANEL_COMMANDS = ["speaker-notes", "animations", "charts", "tables"] as const satisfies readonly PptxCommandId[];

const AVAILABLE: PptxCommandCapability = { status: "available" };

function withReasonKey(capability: PptxCommandCapability, reasonKey: string): PptxCommandCapability {
  return capability.status === "available" ? capability : { ...capability, reason: reasonKey };
}

/** Text runs through the host seam, or through the in-place editor once a text
 *  element is selected (disabled with a reason until then); with neither
 *  channel the host can never run it, so it is hidden. */
function editTextCapability(channels: PptxEditorChannels): PptxCommandCapability {
  if (channels.textEdit || (channels.commitText && channels.textSelected)) return AVAILABLE;
  if (channels.commitText) return { status: "unavailable", reason: "office.pptx.reasons.edit_text_select" };
  return { status: "unavailable", reason: "office.pptx.reasons.edit_text_unbound", hidden: true };
}

export function pptxEditorCapabilities(
  capabilities: Partial<Record<PptxCommandId, CapabilityInput>> | undefined,
  channels: PptxEditorChannels,
): Partial<Record<PptxCommandId, CapabilityInput>> {
  const panelCommands: Partial<Record<PptxCommandId, CapabilityInput>> = {};
  for (const id of PPTX_PANEL_COMMANDS) {
    const usable = channels.edit || id === "speaker-notes";
    panelCommands[id] = capabilities?.[id] ?? (usable ? AVAILABLE : { status: "unavailable", reason: "office.pptx.reasons.edit_unbound" });
  }
  return {
    ...capabilities,
    ...panelCommands,
    open: channels.open
      ? capabilities?.open ?? AVAILABLE
      : { status: "unavailable", reason: "office.pptx.reasons.open_shell", hidden: true },
    "edit-text": editTextCapability(channels).status === "available"
      ? capabilities?.["edit-text"] ?? AVAILABLE
      : editTextCapability(channels),
    "edit-shape-image": channels.transform
      ? capabilities?.["edit-shape-image"] ?? AVAILABLE
      : { status: "unavailable", reason: "office.pptx.reasons.transform_unbound", hidden: true },
    // C1: the print/PDF commands report what the bound port can actually do; with
    // no surface to print from they are hidden (R2-6), not shown dead.
    "export-pdf": capabilities?.["export-pdf"] ?? pptxPrintCapability(channels.printPort, "office.pptx.reasons.export_pdf_unbound", channels.printPending),
    print: capabilities?.print ?? pptxPrintCapability(channels.printPort, "office.pptx.reasons.print_unbound", channels.printPending),
  };
}
