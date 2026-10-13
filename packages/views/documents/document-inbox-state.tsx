"use client";

import { useEffect, useRef } from "react";
import { CircleX, FolderX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@uniwork/ui/components/ui/empty";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { K } from "./document-comments-keys";

/** Why a document opened from the Inbox cannot show (S15 rows 1-2, UNI-1389). */
export type DocumentInboxStateReason = "gone" | "no_access";

/**
 * The page-level S15 message for a document link that came from the Inbox
 * (it names `?comment=`): the sentence is the page heading and takes focus
 * when the page loads, and "Back to Inbox" is the next stop for Tab. It
 * replaces the page, so nothing of the document is shown.
 */
export function DocumentInboxState({ reason, className }: { reason: DocumentInboxStateReason; className?: string }) {
  const { t } = useTranslation();
  const workspace = useOptionalWorkspace()?.workspace;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [reason]);
  const inboxHref = workspace ? paths.workspace(workspace.organization_slug, workspace.slug).inbox() : null;
  return (
    <Empty role="alert" className={cn("rounded-none border-0 px-6 py-16", className)} data-document-inbox-state={reason}>
      <EmptyHeader>
        <IconTile icon={reason === "gone" ? FolderX : CircleX} size="lg" tone={reason === "gone" ? "muted" : "destructive"} />
        <EmptyTitle ref={headingRef} tabIndex={-1} className="text-title">
          {t(reason === "gone" ? K.inboxDocGone : K.inboxDocNoAccess)}
        </EmptyTitle>
      </EmptyHeader>
      {inboxHref ? (
        <EmptyContent className="mt-1 flex-row justify-center">
          <AppLink href={inboxHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t(K.inboxBack)}
          </AppLink>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
