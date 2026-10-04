"use client";

// C3 (UNI-924): the Review tab's Protect group. W-H adds a typed ribbon button:
// it opens the protection/security panel, the same command the old toolbar
// entry ran. The group owns no engine access: every action is a command on the
// protect area (commands/protect.ts). A zero-width host item keeps this
// component (which mounts the panel) mounted next to the typed button.
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { RibbonItem } from "../../ribbon";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DocxProtectPanel } from "./docx-protect-panel";
import { createRibbonOpenStore, ribbonHostItem, useRibbonOpen } from "../toolbar/groups/ribbon-open-store";

/** Shared open state of the protection panel. */
const protectPanel = createRibbonOpenStore();

/** The typed ribbon items for the Review > protect group. */
export function reviewProtectRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const { format, commands } = context;
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
    ribbonHostItem("review-protect-host", "office.docx.toolbar.groups.protect", ReviewProtectGroup, context),
  ];
}

/** Review > Protect: the typed items live on the registry entry; this component
 * keeps the panel mount and stays exported for direct use. */
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

ReviewProtectGroup.ribbonItems = reviewProtectRibbonItems;




