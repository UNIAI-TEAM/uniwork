"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isJoinAdmitted, useJoinMeeting } from "@uniwork/core/meetings";
import { getMeeting, resolveInviteLink, type JoinMeetingBody } from "@uniwork/core/api/endpoints/meetings";
import { useAuthStore } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";
import { useNavigation } from "../navigation";
import { MeetingLobbyWSProvider } from "@uniwork/core/realtime";
import { MeetingLobby } from "./meeting-lobby";
import { inviteStorageKey, writeCachedJoinDecision } from "./meeting-invite-session";
import { useLobbyJoinRetry } from "./use-lobby-join-retry";

const LOGIN_REDIRECT_MS = 4000;

function meetingInviteLoginUrl(linkId: string): string {
  return `${paths.login()}?next=${encodeURIComponent(paths.meetingInvite(linkId))}&reason=meeting_invite`;
}

export function MeetingPublicInviteView({ linkId, secret }: { linkId: string; secret: string }) {
  const { t } = useTranslation();
  const nav = useNavigation();
  const authStatus = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const { data: workspaces } = useWorkspaces();
  const { mutate: mutateJoin, isPending: joinPending, error: joinError, data: joinData } = useJoinMeeting();
  const joinOnce = useRef(false);
  const reasonHandled = useRef(false);
  const [state, setState] = useState<"loading" | "ok" | "expired" | "invalid" | "error">("loading");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [lobbyDecision, setLobbyDecision] = useState<string | undefined>();
  const [redirecting, setRedirecting] = useState(false);

  const joinBody = useMemo<JoinMeetingBody>(
    () => ({ invite_link_id: linkId, secret, display_name: user?.display_name }),
    [linkId, secret, user?.display_name],
  );

  const loginHref = meetingInviteLoginUrl(linkId);

  useEffect(() => {
    if (!secret.trim()) {
      setState("invalid");
      return;
    }
    void resolveInviteLink(linkId, secret).then((res) => {
      if (!res) {
        setState("error");
        return;
      }
      setTitle(res.title);
      setStartsAt(res.starts_at);
      setMeetingId(res.meeting_id ?? "");
      if (res.meeting_id) {
        sessionStorage.setItem(inviteStorageKey(linkId, "meetingId"), res.meeting_id);
      }
      sessionStorage.setItem(inviteStorageKey(linkId, "secret"), secret);
      sessionStorage.setItem(inviteStorageKey(linkId, "title"), res.title);
      setState(res.expired ? "expired" : "ok");
    });
  }, [linkId, secret]);

  useEffect(() => {
    if (reasonHandled.current) return;
    const reason = nav.searchParams.get("reason");
    if (!reason) return;
    reasonHandled.current = true;
    if (reason === "left_room") {
      toast.info(t("meetings.publicInviteReturnedLeft"));
    } else if (reason === "login_required") {
      toast.info(t("meetings.publicInviteLoginRequired"));
    }
    nav.replace(paths.meetingInvite(linkId));
  }, [nav, linkId, t]);

  const enterRoom = useCallback(
    async (decision: NonNullable<typeof joinData>) => {
      writeCachedJoinDecision(linkId, decision);
      if (user && meetingId) {
        const meeting = await getMeeting(meetingId);
        const ws = (workspaces ?? []).find((w) => w.id === meeting?.workspace_id);
        if (ws) {
          nav.push(paths.workspace(ws.organization_slug, ws.slug).room(meetingId));
          return;
        }
      }
      nav.push(paths.meetingInviteRoom(linkId));
    },
    [linkId, meetingId, nav, user, workspaces],
  );

  const runJoin = useCallback(() => {
    if (!meetingId || joinPending) return;
    mutateJoin(
      { meetingId, ...joinBody },
      {
        onSuccess: (d) => {
          if (!d) {
            toast.error(t("common.error"));
            return;
          }
          if (d.decision === "DENY") {
            toast.error(t("meetings.denied"));
            return;
          }
          if (isJoinAdmitted(d)) {
            void enterRoom(d);
            return;
          }
          setLobbyDecision(d.decision);
        },
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  }, [enterRoom, joinBody, joinPending, meetingId, mutateJoin, t]);

  useLobbyJoinRetry({
    meetingId,
    decision: lobbyDecision,
    admitted: false,
    hasJoinError: Boolean(joinError),
    onRetry: runJoin,
  });

  useEffect(() => {
    if (state !== "ok" || authStatus !== "authed" || !meetingId || joinOnce.current) return;
    joinOnce.current = true;
    runJoin();
  }, [state, authStatus, meetingId, runJoin]);

  useEffect(() => {
    if (state !== "ok" || authStatus !== "anon") return;
    setRedirecting(true);
    toast.info(t("meetings.publicInviteLoginRequired"));
    const id = window.setTimeout(() => {
      nav.replace(loginHref);
    }, LOGIN_REDIRECT_MS);
    return () => window.clearTimeout(id);
  }, [state, authStatus, loginHref, nav, t]);

  if (state === "loading" || authStatus === "loading") {
    return <p className="p-8 text-muted-foreground">{t("common.loading")}</p>;
  }
  if (state === "invalid") {
    return (
      <div className="mx-auto flex w-full min-w-0 max-w-md flex-col gap-3 p-4 sm:p-8">
        <p className="text-body text-muted-foreground">{t("meetings.publicInviteInvalidLink")}</p>
      </div>
    );
  }
  if (state === "expired") {
    return <p className="p-8 text-muted-foreground">{t("meetings.publicInviteExpired")}</p>;
  }
  if (state === "error") {
    return <p className="p-8 text-muted-foreground">{t("common.error")}</p>;
  }

  if (authStatus === "anon") {
    return (
      <div className="mx-auto flex w-full min-w-0 max-w-md flex-col gap-4 p-4 sm:p-8">
        <h1 className="text-pretty text-title font-semibold text-foreground">{t("meetings.publicInviteTitle")}</h1>
        <p className="text-body text-foreground">{title}</p>
        <p className="text-label tabular-nums text-muted-foreground">
          {new Date(startsAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
        </p>
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
          <p className="text-pretty text-body text-foreground">{t("meetings.publicInviteLoginRequired")}</p>
          <p className="mt-1 text-caption text-muted-foreground">{t("meetings.publicInviteRedirecting")}</p>
        </div>
        <Button disabled={redirecting} onClick={() => nav.replace(loginHref)}>
          {redirecting ? (
            <>
              <Loader2 aria-hidden className="animate-spin" />
              {t("meetings.publicInviteRedirecting")}
            </>
          ) : (
            t("meetings.publicInviteLogin")
          )}
        </Button>
      </div>
    );
  }

  const wrapLobby = (node: ReactNode) =>
    meetingId ? <MeetingLobbyWSProvider meetingId={meetingId}>{node}</MeetingLobbyWSProvider> : node;

  if (lobbyDecision) {
    return wrapLobby(
      <div className="mx-auto flex min-h-[50vh] w-full min-w-0 max-w-md flex-col p-4 sm:p-8">
        <MeetingLobby
          meetingId={meetingId}
          decision={lobbyDecision}
          error={joinError}
          onLeave={() => nav.push(`${paths.meetingInvite(linkId)}?reason=left_room`)}
        />
      </div>,
    );
  }

  return wrapLobby(
    <div className="mx-auto flex w-full min-w-0 max-w-md flex-col items-center gap-4 p-4 sm:p-8">
      <h1 className="text-pretty text-title font-semibold text-foreground">{t("meetings.publicInviteTitle")}</h1>
      <p className="text-body text-foreground">{title}</p>
      <p className="flex items-center gap-2 text-body text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        {joinPending ? t("meetings.joining") : t("common.loading")}
      </p>
      <Button variant="outline" onClick={() => runJoin()} disabled={joinPending}>
        {t("meetings.publicInviteJoin")}
      </Button>
    </div>,
  );
}
