"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { DriveTaskProposal } from "@uniwork/core/drive";
import { DriveProposalReviewProvider } from "../drive-task-proposal-popover";
import { DriveProposalReviewDialog } from "./drive-proposal-review-dialog";

export interface DriveProposalReviewHostProps {
  workspaceId: string;
  children: ReactNode;
}

/**
 * Provides W6's `DriveProposalReviewProvider` handler for the workspace shell
 * and mounts the W7 `DriveProposalReviewDialog` when `open(proposal)` is called.
 */
export function DriveProposalReviewHost({
  workspaceId,
  children,
}: DriveProposalReviewHostProps) {
  const [activeProposal, setActiveProposal] = useState<DriveTaskProposal | null>(null);
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback((proposal: DriveTaskProposal) => {
    setActiveProposal(proposal);
    setOpen(true);
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setActiveProposal(null);
    }
  }, []);

  return (
    <DriveProposalReviewProvider onOpen={handleOpen}>
      {children}
      {open && activeProposal ? (
        <DriveProposalReviewDialog
          workspaceId={workspaceId}
          open={open}
          onOpenChange={handleOpenChange}
          proposal={activeProposal}
        />
      ) : null}
    </DriveProposalReviewProvider>
  );
}
