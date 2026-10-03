"use client";

// C3 (UNI-924): the Review tab's Protect group — one button that opens the
// protection/security panel. The group owns no engine access: every action is
// a command on the protect area (commands/protect.ts), so the panel cannot
// reach bytes or the session directly.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DocxProtectPanel } from "./docx-protect-panel";

export function ReviewProtectGroup({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
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
        onClick={() => setOpen(true)}
        data-testid="docx-protect-open"
      >
        <Lock aria-hidden />
        <span className="hidden sm:inline">{t("office.docx.protect.open")}</span>
      </Button>
      {available ? (
        <DocxProtectPanel
          open={open}
          onOpenChange={setOpen}
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
