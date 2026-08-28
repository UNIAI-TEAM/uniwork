"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getMeeting, resolveInviteLink } from "@uniwork/core/api/endpoints/meetings";
import { useAuthStore } from "@uniwork/core/auth";
import { useJoinMeeting } from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";
import { AppLink, useNavigation } from "../navigation";

export function MeetingPublicInviteView({ linkId, secret }: { linkId: string; secret: string }) {
  const { t } = useTranslation();
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
    return <p className="p-8 text-muted-foreground">{t("common.loading")}</p>;
  }
  if (state === "expired") {
    return <p className="p-8 text-muted-foreground">{t("meetings.publicInviteExpired")}</p>;
  }
  if (state === "error") {
    return <p className="p-8 text-muted-foreground">{t("common.error")}</p>;
  }

  const loginHref = `${paths.login()}?next=${encodeURIComponent(paths.meetingInvite(linkId))}`;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-md flex-col gap-4 p-4 sm:p-8">
      <h1 className="text-pretty text-title font-semibold text-foreground">{t("meetings.publicInviteTitle")}</h1>
      <p className="text-body text-foreground">{title}</p>
      <p className="text-label tabular-nums text-muted-foreground">
        {new Date(startsAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
      </p>
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
