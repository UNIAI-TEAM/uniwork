"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getMeeting, resolveInviteLink } from "@uniwork/core/api/endpoints/meetings";
import { useAuthStore } from "@uniwork/core/auth";
import { useJoinMeeting } from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { CalendarDays, Link2Off } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageState } from "../layout/collection-page";
import { meetingLocale } from "./meeting-datetime";
import { toast } from "sonner";
import { AppLink, useNavigation } from "../navigation";

export function MeetingPublicInviteView({ linkId, secret }: { linkId: string; secret: string }) {
  const { t, i18n } = useTranslation();
  const nav = useNavigation();
  const user = useAuthStore((s) => s.user);
  const { data: workspaces } = useWorkspaces();
  const join = useJoinMeeting();
  const [state, setState] = useState<"loading" | "ok" | "expired" | "error">("loading");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [meetingId, setMeetingId] = useState("");

  useEffect(() => {
    void resolveInviteLink(linkId, secret).then((res) => {
      if (!res) {
        setState("error");
        return;
      }
      setTitle(res.title);
      setStartsAt(res.starts_at);
      setMeetingId(res.meeting_id ?? "");
      setState(res.expired ? "expired" : "ok");
    });
  }, [linkId, secret]);

  if (state === "loading") {
    return (
      <div aria-busy className="mx-auto flex w-full min-w-0 max-w-md flex-col gap-4 p-4 sm:p-8">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-40" />
      </div>
    );
  }
  if (state === "expired") {
    return <CollectionPageState icon={Link2Off} role="status" title={t("meetings.publicInviteExpired")} description={t("meetings.publicInviteExpiredHint")} />;
  }
  if (state === "error") {
    return <CollectionPageState icon={Link2Off} tone="destructive" role="alert" title={t("common.error")} />;
  }

  const loginHref = `${paths.login()}?next=${encodeURIComponent(paths.meetingInvite(linkId))}`;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-md flex-col gap-4 p-4 sm:p-8">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <CalendarDays aria-hidden className="size-5" />
      </span>
      <div>
        <p className="text-caption text-muted-foreground">{t("meetings.publicInviteTitle")}</p>
        <h1 className="mt-1 text-pretty text-title font-semibold text-foreground">{title}</h1>
        <p className="mt-1 text-label tabular-nums text-muted-foreground">
          {new Date(startsAt).toLocaleString(meetingLocale(i18n.language), { dateStyle: "full", timeStyle: "short" })}
        </p>
      </div>
      {user && meetingId ? (
        <Button
          disabled={join.isPending}
          onClick={() =>
            join.mutate(
              { meetingId, invite_link_id: linkId, secret },
              {
                onSuccess: async (d) => {
                  if (d?.decision === "DENY") {
                    toast.error(t("meetings.denied"));
                    return;
                  }
                  const meeting = await getMeeting(meetingId);
                  const ws = (workspaces ?? []).find((w) => w.id === meeting?.workspace_id);
                  if (ws) nav.push(paths.workspace(ws.organization_slug, ws.slug).room(meetingId));
                },
                onError: () => toast.error(t("common.error")),
              },
            )
          }
        >
          {t("meetings.publicInviteJoin")}
        </Button>
      ) : (
        <Button render={<AppLink href={loginHref} />}>{t("meetings.publicInviteLogin")}</Button>
      )}
    </div>
  );
}
