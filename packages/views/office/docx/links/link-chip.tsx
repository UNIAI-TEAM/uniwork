"use client";

import { Copy, ExternalLink, Pencil, Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";

export interface LinkChipProps {
  href: string;
  /** Read-only documents keep Open and Copy reachable; Edit and Remove disable. */
  readOnly?: boolean;
  onOpen: (href: string) => void;
  onCopy: (href: string) => void;
  onEdit: () => void;
  onRemove: () => void;
}

/**
 * The link chip a toolbar group shows while the caret sits inside a link: the
 * URL plus Word's four actions. Presentational — the group owns the dialog and
 * the command calls, so the chip stays usable in a read-only document.
 */
export function LinkChip({ href, readOnly = false, onOpen, onCopy, onEdit, onRemove }: LinkChipProps) {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-w-0 max-w-64 items-center gap-0.5 rounded-control border border-border bg-surface-hover/60 py-0.5 pr-0.5 pl-2"
      role="group"
      aria-label={t("office.docx.links.chipLabel")}
      data-testid="docx-link-chip"
    >
      <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground" title={href} data-testid="docx-link-chip-href">
        {href}
      </span>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.links.open")} onClick={() => onOpen(href)}>
        <ExternalLink aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.links.copy")} onClick={() => onCopy(href)}>
        <Copy aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.links.edit")} disabled={readOnly} onClick={onEdit}>
        <Pencil aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.links.remove")} disabled={readOnly} onClick={onRemove}>
        <Unlink aria-hidden />
      </Button>
    </div>
  );
}
