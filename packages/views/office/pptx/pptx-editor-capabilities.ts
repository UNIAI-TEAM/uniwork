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
import { pptxPrintCapability, type PptxPrintPort } from "./print";

type CapabilityInput = PptxCommandCapability | "available" | "readonly" | "unavailable" | "unknown";

export interface PptxEditorChannels {
  open: boolean;
  textEdit: boolean;
  transform: boolean;
  /** A generic edit channel (host onApplyEdit or the handle's edit port). */
  edit: boolean;
  printPort: PptxPrintPort | null;
}

/** Commands whose ribbon item opens a panel bound to the generic edit channel. */
export const PPTX_PANEL_COMMANDS = ["speaker-notes", "animations", "charts", "tables"] as const satisfies readonly PptxCommandId[];

const AVAILABLE: PptxCommandCapability = { status: "available" };

function withReasonKey(capability: PptxCommandCapability, reasonKey: string): PptxCommandCapability {
  return capability.status === "available" ? capability : { ...capability, reason: reasonKey };
}

function printCapability(port: PptxPrintPort | null): PptxCommandCapability {
  const capability = withReasonKey(pptxPrintCapability(port), "office.pptx.reasons.export_pdf_unbound");
  return capability.status === "available" ? capability : { ...capability, hidden: true };
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
    "edit-text": channels.textEdit
      ? capabilities?.["edit-text"] ?? AVAILABLE
      : { status: "unavailable", reason: "office.pptx.reasons.edit_text_unbound", hidden: true },
    "edit-shape-image": channels.transform
      ? capabilities?.["edit-shape-image"] ?? AVAILABLE
      : { status: "unavailable", reason: "office.pptx.reasons.transform_unbound", hidden: true },
    // C1: the print/PDF commands report what the bound port can actually do; with
    // no surface to print from they are hidden (R2-6), not shown dead.
    "export-pdf": capabilities?.["export-pdf"] ?? printCapability(channels.printPort),
    print: capabilities?.print ?? printCapability(channels.printPort),
  };
}
