"use client";

import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { useDocxScopeValue } from "../../editor-store";
import type { DocxToolbarGroupContext } from "../types";

/** Find & replace entry: toggles the panel the shell mounts beside the document
 * (find/docx-find-panel.tsx). The open flag lives in this document's scope. */
export function HomeFindGroup({ docScope: scope }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const open = useDocxScopeValue(scope.find);

  return (
    <Button
      type="button"
      variant="toolbar"
      size="icon-sm"
      aria-label={t("office.docx.find.label")}
      aria-pressed={open}
      data-testid="docx-find-toggle"
      onClick={() => scope.find.set(!scope.find.get())}
    >
      <Search aria-hidden />
    </Button>
  );
}
