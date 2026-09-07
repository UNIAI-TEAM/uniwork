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
  const { approveOne, rejectOne, admitAll, approving, rejecting } = useJoinRequestActions(meetingId);
  const [open, setOpen] = useState(true);

  if (count === 0) return null;

  return (
    <section className="mb-4 shrink-0" aria-labelledby="waiting-admission-heading">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="mb-2 flex items-center gap-2">
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-muted/40">
            <ChevronDown
              aria-hidden
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
            />
            <h3 id="waiting-admission-heading" className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
              {t("meetings.waitingToBeAdmitted")}
            </h3>
            <span className="text-caption tabular-nums text-muted-foreground">{count}</span>
          </CollapsibleTrigger>
          {count > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 text-brand hover:text-brand"
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
                  approving={approving}
                  rejecting={rejecting}
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
