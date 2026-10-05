"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { parseA1Reference, scrollCommandParams, selectionCommandParams, XLSX_SCROLL_TO_CELL_COMMAND, XLSX_SET_SELECTIONS_COMMAND } from "../view/goto";
import { XlsxGroupBody, XlsxGroupRow, XlsxGroupRows } from "./group-layout";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";

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
    fireCommand(commands, XLSX_SET_SELECTIONS_COMMAND, selectionCommandParams(range));
    fireCommand(commands, XLSX_SCROLL_TO_CELL_COMMAND, scrollCommandParams(range));
  };

  return (
    <form className="h-full" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <XlsxGroupBody>
        <XlsxGroupRows>
          <XlsxGroupRow>
            <Input
              className="h-6 w-28 px-1 text-caption"
              value={reference}
              placeholder={t("office.xlsx.view.goto.placeholder")}
              aria-label={t("office.xlsx.view.goto.label")}
              title={t("office.xlsx.view.goto.label")}
              aria-invalid={invalid || undefined}
              disabled={blocked}
              onChange={(event) => { setReference(event.target.value); setInvalid(false); }}
            />
            <Button type="submit" variant="toolbar" size="sm" className="h-6 px-1.5" aria-disabled={blocked}>
              {t("office.xlsx.view.goto.go")}
            </Button>
          </XlsxGroupRow>
          {invalid ? (
            <span role="alert" className="text-caption text-destructive">
              {t("office.xlsx.view.goto.invalid")}
            </span>
          ) : null}
        </XlsxGroupRows>
      </XlsxGroupBody>
    </form>
  );
}
