"use client";

import { useState } from "react";
import { Pi } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { EquationDialog } from "../../insert/equation-dialog";
import { SymbolPicker } from "../../insert/symbol-picker";
import type { DocxToolbarGroupContext } from "../types";

/**
 * Insert tab > Symbols group (task A11): the symbol picker inserts a glyph at
 * the caret as text, the equation button opens the LaTeX dialog whose result
 * becomes the vendored inline math node. Both are disabled on a read-only
 * document or while a save is in flight.
 */
export function InsertSymbolsGroup({ commands, readOnly, saving }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [equationOpen, setEquationOpen] = useState(false);
  const blocked = readOnly || saving || !commands;

  return (
    <>
      <SymbolPicker disabled={blocked} onPick={(char) => commands?.insertSymbol(char)} />
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        disabled={blocked}
        aria-label={t("office.docx.toolbar.insert.equation")}
        data-testid="docx-equation-open"
        onClick={() => setEquationOpen(true)}
      >
        <Pi aria-hidden />
        <span className="text-label">{t("office.docx.toolbar.insert.equation")}</span>
      </Button>
      <EquationDialog
        open={equationOpen}
        onOpenChange={setEquationOpen}
        readOnly={blocked}
        onInsert={(latex) => {
          commands?.insertEquation(latex);
          setEquationOpen(false);
        }}
      />
    </>
  );
}
