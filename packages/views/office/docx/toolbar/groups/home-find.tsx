"use client";

import { useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { isDocxFindOpen, subscribeDocxFind, toggleDocxFind } from "../../find/find-store";
import type { DocxToolbarGroupContext } from "../types";

/** Find & replace entry: toggles the panel the shell mounts beside the document
 * (find/docx-find-panel.tsx). Ctrl+F belongs to A9's shortcut map; its `find`
 * entry binds `toggleDocxFind` from find/find-store.ts. */
export function HomeFindGroup(_props: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const open = useSyncExternalStore(subscribeDocxFind, isDocxFindOpen, isDocxFindOpen);

  return (
    <Button
      type="button"
      variant="toolbar"
      size="icon-sm"
      aria-label={t("office.docx.find.label")}
      aria-pressed={open}
      data-testid="docx-find-toggle"
      onClick={toggleDocxFind}
    >
      <Search aria-hidden />
    </Button>
  );
}
