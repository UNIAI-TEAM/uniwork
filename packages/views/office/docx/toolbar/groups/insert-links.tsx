"use client";

import { Link as LinkIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { copyLinkHref, openLinkHref } from "../../links/link-actions";
import { LinkChip } from "../../links/link-chip";
import type { DocxLinkSeed } from "../../links/link-commands";
import { LinkDialog } from "../../links/link-dialog";
import type { DocxToolbarGroupContext } from "../types";

/** A4: while the caret sits inside a link the group shows the chip (open,
 * copy, edit, unlink); otherwise the insert button opens the dialog. The
 * dialog is driven by the command runtime's linkSeed/applyLink/removeLink, so
 * this group never touches the editor directly. */
export function InsertLinksGroup({ format, commands, readOnly }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [seed, setSeed] = useState<DocxLinkSeed | null>(null);
  const activeLink = format?.activeLink ?? null;
  const editable = !readOnly && !!commands;
  const openDialog = () => {
    if (commands) setSeed(commands.linkSeed());
  };

  return (
    <>
      {activeLink ? (
        <LinkChip
          href={activeLink.href}
          readOnly={!editable}
          onOpen={openLinkHref}
          onCopy={(href) => void copyLinkHref(href)}
          onEdit={openDialog}
          onRemove={() => commands?.removeLink()}
        />
      ) : (
        <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.links.insertTitle")} disabled={!editable} onClick={openDialog}>
          <LinkIcon aria-hidden />
        </Button>
      )}
      <LinkDialog
        open={seed !== null}
        onOpenChange={(next) => {
          if (!next) setSeed(null);
        }}
        initial={seed?.link ?? null}
        selectionText={seed?.selectionText ?? ""}
        readOnly={!editable}
        onSubmit={(value) => {
          commands?.applyLink(value);
          setSeed(null);
        }}
        onRemove={() => {
          commands?.removeLink();
          setSeed(null);
        }}
      />
    </>
  );
}
