"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getMeeting,
  resolveInviteLink,
} from "@uniwork/core/api/endpoints/meetings";
import { useAuthStore } from "@uniwork/core/auth";
import { useJoinMeeting } from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { CalendarDays, Clock, Link2Off, ShieldAlert } from "lucide-react";
import { Logo } from "@uniwork/ui/brand";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageState } from "../layout/collection-page";
import { meetingLocale } from "./meeting-datetime";
import { toast } from "sonner";
import { AppLink, useNavigation } from "../navigation";

/** Where the invite page parks the link secret so the room route can pick it up. */
export function inviteSecretStorageKey(linkId: string): string {
  return `uw.meeting-invite.${linkId}`;
}

type State = "loading" | "ok" | "expired" | "invalid" | "denied" | "waiting";

function formatInviteTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { dateStyle: "full", timeStyle: "short" });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-md flex-col gap-6 p-4 sm:p-8">
      <Logo variant="lockup" size={22} />
      {children}
    </main>
  );
}

export function MeetingPublicInviteView({
  linkId,
  secret,
}: {
  linkId: string;
  secret: string;
}) {
  const { t, i18n } = useTranslation();
  const nav = useNavigation();
  const user = useAuthStore((s) => s.user);
  const { data: workspaces } = useWorkspaces();
  const join = useJoinMeeting();
  const [state, setState] = useState<State>("loading");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [meetingId, setMeetingId] = useState("");

  useEffect(() => {
    void resolveInviteLink(linkId, secret).then((res) => {
      if (!res) {
        setState("invalid");
        return;
      }
      setTitle(res.title);
      setStartsAt(res.starts_at);
      setMeetingId(res.meeting_id ?? "");
      setState(res.expired ? "expired" : "ok");
    });
  }, [linkId, secret]);

  useEffect(() => {
    if (title) document.title = `${title} · ${t("auth.wordmark")}`;
  }, [title, t]);

  if (state === "loading") {
    return (
      <Shell>
        <div aria-busy className="flex flex-col gap-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-9 w-full" />
        </div>
      </Shell>
    );
  }
  if (state === "expired") {
    return (
      <Shell>
        <CollectionPageState
          icon={Link2Off}
          role="status"
          title={t("meetings.publicInviteExpired")}
          description={t("meetings.publicInviteExpiredHint")}
        />
      </Shell>
    );
  }
  if (state === "invalid") {
    return (
      <Shell>
        <CollectionPageState
          icon={Link2Off}
          role="status"
          title={t("meetings.publicInviteInvalid")}
          description={t("meetings.publicInviteInvalidHint")}
        />
      </Shell>
    );
  }
  if (state === "denied") {
    return (
      <Shell>
        <CollectionPageState
          icon={ShieldAlert}
          role="status"
          title={t("meetings.denied")}
          description={t("meetings.publicInviteExpiredHint")}
        />
      </Shell>
    );
  }
  if (state === "waiting") {
    return (
      <Shell>
        <CollectionPageState
          icon={Clock}
          role="status"
          title={t("meetings.waitingApproval")}
          description={t("meetings.requestSent")}
        />
      </Shell>
    );
  }

  const loginHref = `${paths.login()}?next=${encodeURIComponent(paths.meetingInvite(linkId))}`;
  const when = formatInviteTime(startsAt, meetingLocale(i18n.language));

  return (
    <Shell>
      <div className="flex flex-col gap-4">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <CalendarDays aria-hidden className="size-5" />
        </span>
        <div>
          <p className="text-caption text-muted-foreground">
            {t("meetings.publicInviteTitle")}
          </p>
          <h1 className="mt-1 text-pretty text-title font-semibold text-foreground">
            {title}
          </h1>
          {when ? (
            <p className="mt-1 text-label tabular-nums text-muted-foreground">
              {when}
            </p>
          ) : null}
        </div>
        {user && meetingId ? (
          <Button
            variant="brand"
            className="h-11"
            disabled={join.isPending}
            onClick={() =>
              join.mutate(
                { meetingId, invite_link_id: linkId, secret },
                {
                  onSuccess: async (d) => {
                    if (d?.decision === "DENY") {
                      setState("denied");
                      return;
                    }
                    if (
                      d?.decision === "WAITING_APPROVAL" ||
                      d?.decision === "WAITING_FOR_HOST"
                    ) {
                      setState("waiting");
                      return;
                    }
                    // Members get the workspace room; everyone else the public one.
                    const meeting = await getMeeting(meetingId).catch(
                      () => null,
                    );
                    const ws = (workspaces ?? []).find(
                      (w) => w.id === meeting?.workspace_id,
                    );
                    nav.push(
                      ws
                        ? paths
                            .workspace(ws.organization_slug, ws.slug)
                            .room(meetingId)
                        : paths.meetingInviteRoom(linkId),
                    );
                  },
                  onError: () => toast.error(t("common.error")),
                },
              )
            }
          >
            {t("meetings.publicInviteJoin")}
          </Button>
        ) : (
          <Button
            variant="brand"
            className="h-11"
            render={<AppLink href={loginHref} />}
          >
            {t("meetings.publicInviteLogin")}
          </Button>
        )}
      </div>
    </Shell>
  );
}
