"use client";

import { Grid3X3, Rows3 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { gridlinesCommandParams, headerSizeCommands, XLSX_GRIDLINES_COMMAND } from "../view/display";
import type { XlsxToolbarGroupProps } from "./types";

/** View > display: the gridlines and row/column header toggles. Both are
 *  view-state only — allowlisted view commands, no journal and no save path —
 *  so read-only mounts keep them enabled; the renderer's own command gate
 *  decides whether it can run them. The pressed state is a local echo: the
 *  port exposes no view-state read. */
export function XlsxViewDisplayGroup({ commands }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [gridlines, setGridlines] = useState(true);
  const [headers, setHeaders] = useState(true);
  const blocked = !commands || undefined;

  const toggleGridlines = () => {
    if (!commands) return;
    const next = !gridlines;
    commands.execute(XLSX_GRIDLINES_COMMAND, gridlinesCommandParams(next));
    setGridlines(next);
  };
  const toggleHeaders = () => {
    if (!commands) return;
    const next = !headers;
    for (const command of headerSizeCommands(next)) commands.execute(command.id, command.params);
    setHeaders(next);
  };

  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.view.gridlines")}
        aria-pressed={gridlines}
        aria-disabled={blocked}
        onClick={toggleGridlines}
      >
        <Grid3X3 aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.view.headers")}
        aria-pressed={headers}
        aria-disabled={blocked}
        onClick={toggleHeaders}
      >
        <Rows3 aria-hidden />
      </Button>
    </>
  );
}
