"use client";

import { ImagePlus, Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { DocxToolbarGroupContext } from "../types";

/** A1-owned pre-wave surface: the table and image commands stay visible but
 * pending until A10 (table) and B1 (image) land their real UI. */
export function InsertPendingGroup(_props: DocxToolbarGroupContext) {
  const { t } = useTranslation();

  return (
    <>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.commands.table")} aria-disabled="true" title={t("office.docx.capabilityPending")}>
        <Table2 aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.commands.image")} aria-disabled="true" title={t("office.docx.capabilityPending")}>
        <ImagePlus aria-hidden />
      </Button>
    </>
  );
}
