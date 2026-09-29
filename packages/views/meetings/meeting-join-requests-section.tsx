"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@uniwork/ui/components/ui/collapsible";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingJoinRequestRow } from "./meeting-join-request-row";
import { useJoinRequestActions } from "./use-join-request-actions";
import { usePendingJoinRequests } from "./use-pending-join-requests";

export function MeetingJoinRequestsSection({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const { pending, count } = usePendingJoinRequests(meetingId);
  const { approveOne, rejectOne, admitAll, approving, isApproving, isRejecting } = useJoinRequestActions(meetingId);
  const [open, setOpen] = useState(true);

  if (count === 0) return null;

  return (
    <section className="mb-4 shrink-0" aria-labelledby="waiting-admission-heading">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="mb-2 flex items-center gap-2">
          {/* The heading wraps the toggle, never the reverse: a heading inside
              a button stops being a heading for assistive tech. */}
          <h3 id="waiting-admission-heading" className="min-w-0 flex-1 text-body font-medium text-foreground">
            <CollapsibleTrigger className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-surface-hover">
              <ChevronDown
                aria-hidden
                className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
              />
              <span className="min-w-0 flex-1 truncate">{t("meetings.waitingToBeAdmitted")}</span>
              <span className="text-caption font-normal tabular-nums text-muted-foreground">{count}</span>
            </CollapsibleTrigger>
          </h3>
          {count > 1 ? (
            <Button
              type="button"
              variant="successSolid"
              size="sm"
              className="h-8 shrink-0 rounded-full px-3"
              disabled={approving}
              onClick={() => void admitAll(pending)}
            >
              {t("meetings.admitAll")}
            </Button>
          ) : null}
        </div>

        <CollapsibleContent>
          <ul className="space-y-0.5 pb-1">
            {pending.map((r) => (
              <li key={r.id}>
                <MeetingJoinRequestRow
                  request={r}
                  variant="sidebar"
                  approving={isApproving(r.id)}
                  rejecting={isRejecting(r.id)}
                  onApprove={() => approveOne(r.id)}
                  onReject={() => rejectOne(r.id)}
                />
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
