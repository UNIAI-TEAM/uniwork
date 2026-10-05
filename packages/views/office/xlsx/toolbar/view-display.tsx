"use client";

import { Grid3X3, Rows3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { gridlinesCommandParams, headerSizeCommands, XLSX_GRIDLINES_COMMAND } from "../view/display";
import { useViewEcho } from "./view-echo";
import { XLSX_SMALL_BUTTON_CLASS, XlsxGroupBody, XlsxGroupRow, XlsxGroupRows } from "./group-layout";
import type { XlsxToolbarGroupProps } from "./types";

/** View > display: the gridlines and row/column header toggles. Both are
 *  view-state only - allowlisted view commands, no journal and no save path -
 *  so read-only mounts keep them enabled; the renderer's own command gate
 *  decides whether it can run them. The port exposes no view-state read, so
 *  the pressed state is an echo owned by the TOOLBAR (`viewEcho`), which keeps
 *  it honest across ribbon tab switches (only the active tab's groups stay
 *  mounted). */
export function XlsxViewDisplayGroup({ commands, viewEcho }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const echo = useViewEcho(viewEcho);
  const blocked = !commands || undefined;

  const toggleGridlines = () => {
    if (!commands) return;
    const next = !echo.gridlines;
    void commands.execute(XLSX_GRIDLINES_COMMAND, gridlinesCommandParams(next));
    echo.setGridlines(next);
  };
  const toggleHeaders = () => {
    if (!commands) return;
    const next = !echo.headers;
    for (const command of headerSizeCommands(next)) void commands.execute(command.id, command.params);
    echo.setHeaders(next);
  };

  return (
    <XlsxGroupBody>
      <XlsxGroupRows>
        <XlsxGroupRow>
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            className={XLSX_SMALL_BUTTON_CLASS}
            aria-label={t("office.xlsx.view.gridlines")}
            title={t("office.xlsx.view.gridlines")}
            aria-pressed={echo.gridlines}
            aria-disabled={blocked}
            onClick={toggleGridlines}
          >
            <Grid3X3 aria-hidden />
            {t("office.xlsx.view.gridlines")}
          </Button>
        </XlsxGroupRow>
        <XlsxGroupRow>
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            className={XLSX_SMALL_BUTTON_CLASS}
            aria-label={t("office.xlsx.view.headers")}
            title={t("office.xlsx.view.headers")}
            aria-pressed={echo.headers}
            aria-disabled={blocked}
            onClick={toggleHeaders}
          >
            <Rows3 aria-hidden />
            {t("office.xlsx.view.headers")}
          </Button>
        </XlsxGroupRow>
      </XlsxGroupRows>
    </XlsxGroupBody>
  );
}
