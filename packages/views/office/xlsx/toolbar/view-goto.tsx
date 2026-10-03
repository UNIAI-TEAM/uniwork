"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { parseA1Reference, scrollCommandParams, selectionCommandParams, XLSX_SCROLL_TO_CELL_COMMAND, XLSX_SET_SELECTIONS_COMMAND } from "../view/goto";
import type { XlsxToolbarGroupProps } from "./types";

/** View > go to: an A1 reference input (single cell or range). A valid submit
 *  selects the range through the allowlisted selection view command and
 *  reveals it with the renderer's scroll command; invalid input only shows the
 *  inline message and never touches the selection. */
export function XlsxViewGoToGroup({ commands }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [reference, setReference] = useState("");
  const [invalid, setInvalid] = useState(false);
  const blocked = !commands || undefined;

  const submit = () => {
    if (!commands) return;
    const range = parseA1Reference(reference);
    if (!range) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    commands.execute(XLSX_SET_SELECTIONS_COMMAND, selectionCommandParams(range));
    commands.execute(XLSX_SCROLL_TO_CELL_COMMAND, scrollCommandParams(range));
  };

  return (
    <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <Input
        className="h-7 w-28 px-1 text-caption"
        value={reference}
        placeholder={t("office.xlsx.view.goto.placeholder")}
        aria-label={t("office.xlsx.view.goto.label")}
        aria-invalid={invalid || undefined}
        disabled={blocked}
        onChange={(event) => { setReference(event.target.value); setInvalid(false); }}
      />
      <Button type="submit" variant="toolbar" size="sm" aria-disabled={blocked}>
        {t("office.xlsx.view.goto.go")}
      </Button>
      {invalid ? (
        <span role="alert" className="text-caption text-destructive">
          {t("office.xlsx.view.goto.invalid")}
        </span>
      ) : null}
    </form>
  );
}
