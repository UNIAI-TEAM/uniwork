"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isJoinAdmitted, useJoinMeeting } from "@uniwork/core/meetings";
import { getMeeting, resolveInviteLink, type JoinMeetingBody } from "@uniwork/core/api/endpoints/meetings";
import { useAuthStore } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";
import { useNavigation } from "../navigation";
import { MeetingLobbyWSProvider } from "@uniwork/core/realtime";
import { MeetingLobby } from "./meeting-lobby";
import { MeetingInviteShell, MeetingInviteStateCard } from "./meeting-invite-shell";
import { MeetingPublicInviteForm } from "./meeting-public-invite-form";
import {
  inviteStorageKey,
  writeCachedJoinDecision,
  writeGuestSession,
  writeInviteDisplayName,
  writeInvitePreJoinChoice,
} from "./meeting-invite-session";
import type { PreJoinChoice } from "./meeting-prejoin";
import { useLobbyJoinRetry } from "./use-lobby-join-retry";

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
  const [accessMode, setAccessMode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [lobbyDecision, setLobbyDecision] = useState<string | undefined>();

  const isGuest = authStatus === "anon";

  useEffect(() => {
    const stored = sessionStorage.getItem(inviteStorageKey(linkId, "displayName")) ?? "";
    if (stored) setDisplayName(stored);
  }, [linkId]);

  const joinBody = useMemo<JoinMeetingBody>(() => {
    const name = isGuest ? displayName.trim() : user?.display_name;
    return { invite_link_id: linkId, secret, display_name: name || undefined };
  }, [linkId, secret, displayName, isGuest, user?.display_name]);

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
      setAccessMode(res.access_mode);
      if (res.meeting_id) {
        sessionStorage.setItem(inviteStorageKey(linkId, "meetingId"), res.meeting_id);
      }
      sessionStorage.setItem(inviteStorageKey(linkId, "secret"), secret);
      sessionStorage.setItem(inviteStorageKey(linkId, "title"), res.title);
      if (res.guest_session) writeGuestSession(linkId, res.guest_session);
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
    } else if (reason === "missing_session") {
      toast.error(t("meetings.publicInviteMissingSession"));
    }
    nav.replace(paths.meetingInvite(linkId));
  }, [nav, linkId, t]);

  const enterRoom = useCallback(
    async (decision: NonNullable<typeof joinData>) => {
      writeCachedJoinDecision(linkId, decision);
      if (!isGuest && user && meetingId) {
        const meeting = await getMeeting(meetingId);
        const ws = (workspaces ?? []).find((w) => w.id === meeting?.workspace_id);
        if (ws) {
          nav.push(paths.workspace(ws.organization_slug, ws.slug).room(meetingId));
          return;
        }
      }
      nav.push(paths.meetingInviteRoom(linkId));
    },
    [isGuest, linkId, meetingId, nav, user, workspaces],
  );

  const runJoin = useCallback((choice?: PreJoinChoice) => {
    if (!meetingId || joinPending) return;
    if (isGuest && !displayName.trim()) {
      toast.error(t("meetings.publicInviteNameRequired"));
      return;
    }
    if (isGuest) {
      writeInviteDisplayName(linkId, displayName);
      if (choice) writeInvitePreJoinChoice(linkId, choice);
    }
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
  }, [displayName, enterRoom, isGuest, joinBody, joinPending, linkId, meetingId, mutateJoin, t]);

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

  const wrapLobby = (node: ReactNode) =>
    meetingId ? <MeetingLobbyWSProvider meetingId={meetingId}>{node}</MeetingLobbyWSProvider> : node;

  if (state === "loading" || authStatus === "loading") {
    return (
      <MeetingInviteShell className="items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Spinner className="size-6" />
          <p className="text-body">{t("common.loading")}</p>
        </div>
      </MeetingInviteShell>
    );
  }
  if (state === "invalid") {
    return (
      <MeetingInviteStateCard
        title={t("meetings.publicInviteInvalid")}
        description={t("meetings.publicInviteInvalidHint")}
      />
    );
  }
  if (state === "expired") {
    return (
      <MeetingInviteStateCard
        title={t("meetings.publicInviteExpired")}
        description={t("meetings.publicInviteExpiredHint")}
      />
    );
  }
  if (state === "error") {
    return (
      <MeetingInviteStateCard title={t("common.error")} description={t("meetings.publicInviteInvalidHint")} />
    );
  }

  if (lobbyDecision) {
    return wrapLobby(
      <div className="fixed inset-0 z-40 flex min-h-0 min-w-0 flex-col bg-app-shell">
        <MeetingLobby
          meetingId={meetingId}
          title={title}
          decision={lobbyDecision}
          error={joinError}
          onLeave={() => nav.push(`${paths.meetingInvite(linkId)}?reason=left_room`)}
        />
      </div>,
    );
  }

  if (isGuest) {
    return wrapLobby(
      <MeetingPublicInviteForm
        title={title}
        startsAt={startsAt}
        accessMode={accessMode}
        displayName={displayName}
        onDisplayNameChange={setDisplayName}
        joinPending={joinPending}
        onJoin={(choice) => runJoin(choice)}
        onLogin={() => nav.push(loginHref)}
      />,
    );
  }

  return wrapLobby(
    <MeetingInviteShell className="items-center justify-center">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-balance text-display-sm font-semibold tracking-tight text-foreground">
          {t("meetings.publicInviteTitle")}
        </h1>
        <p className="text-body text-foreground">{title}</p>
        <p className="flex items-center gap-2 text-body text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          {joinPending ? t("meetings.joining") : t("common.loading")}
        </p>
        <Button variant="outline" onClick={() => runJoin()} disabled={joinPending}>
          {t("meetings.publicInviteJoin")}
        </Button>
      </div>
    </MeetingInviteShell>,
  );
}
