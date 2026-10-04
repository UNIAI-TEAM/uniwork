"use client";

// C3 (UNI-924): the Review tab's Protect group. W-H adds a typed ribbon button:
// it opens the protection/security panel, the same command the old toolbar
// entry ran. The group owns no engine access: every action is a command on the
// protect area (commands/protect.ts). The panel is mounted by the toolbar-level
// `RibbonDialogHosts` (F7) so folding the group cannot destroy it; the kept
// sr-only trigger is an anchor only (F9).
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { RibbonItem } from "../../ribbon";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DocxProtectPanel } from "./docx-protect-panel";
import { createRibbonOpenStore, registerRibbonDialogHost, ribbonHostItem, useRibbonOpen } from "../toolbar/groups/ribbon-open-store";

/** Shared open state of the protection panel. */
const protectPanel = createRibbonOpenStore();

/** The typed ribbon items for the Review > protect group. */
export function reviewProtectRibbonItems({ format, commands }: DocxToolbarGroupContext): readonly RibbonItem[] {
  const available = !!format?.docxProtection && commands !== undefined;
  return [
    {
      kind: "button",
      id: "review-protect",
      labelKey: "office.docx.protect.open",
      tooltipKey: available ? "office.docx.protect.open" : "office.docx.protect.unavailable",
      icon: Lock,
      size: "large",
      collapseAs: "small",
      disabled: !available,
      onExecute: () => protectPanel.open(),
    },
    ribbonHostItem("review-protect-host", "office.docx.toolbar.groups.protect"),
  ];
}

/** Review > Protect: the typed items live on the registry entry; this component
 * owns the panel and is mounted by `RibbonDialogHosts`. */
export function ReviewProtectGroup({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [open] = useRibbonOpen(protectPanel);
  const state = format?.docxProtection ?? null;
  const available = state !== null && commands !== undefined;
  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        disabled={!available}
        title={available ? undefined : t("office.docx.protect.unavailable")}
        aria-label={t("office.docx.protect.open")}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onClick={() => protectPanel.open()}
        data-testid="docx-protect-open"
      >
        <Lock aria-hidden />
      </Button>
      {available ? (
        <DocxProtectPanel
          open={open}
          onOpenChange={protectPanel.set}
          state={state}
          readOnly={readOnly}
          saving={saving}
          onSetProtection={(protection) => commands.setDocxProtection(protection)}
          onSetWriteProtection={(writeProtection) => commands.setDocxWriteProtection(writeProtection)}
        />
      ) : null}
    </>
  );
}

registerRibbonDialogHost("review-protect-host", ReviewProtectGroup);
