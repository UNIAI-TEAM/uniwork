"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { isJoinAdmitted, useJoinMeeting } from "@uniwork/core/meetings";
import {
  cancelJoinRequest,
  getMeeting,
  resolveInviteLink,
  type JoinMeetingBody,
} from "@uniwork/core/api/endpoints/meetings";
import { useAuthStore } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";
import { useNavigation } from "../navigation";
import { MeetingLobbyWSProvider } from "@uniwork/core/realtime";
import { MeetingLobby, lobbyMessage } from "./meeting-lobby";
import { MeetingInviteShell, MeetingInviteStateCard } from "./meeting-invite-shell";
import { MeetingInvitePageSkeleton } from "./meeting-page-skeletons";
import { MeetingPublicInviteForm } from "./meeting-public-invite-form";
import {
  clearCachedJoinDecision,
  inviteStorageKey,
  writeCachedJoinDecision,
  writeGuestSession,
  writeInviteDisplayName,
  writeInvitePreJoinChoice,
} from "./meeting-invite-session";
import type { PreJoinChoice } from "./meeting-prejoin";
import {
  inviteStateCopy,
  inviteStateFromResolve,
  resolveFailureState,
  type InviteViewState,
} from "./public-invite-state";
import { useLobbyJoinRetry } from "./use-lobby-join-retry";

function meetingInviteLoginUrl(linkId: string): string {
  return `${paths.login()}?next=${encodeURIComponent(paths.meetingInvite(linkId))}&reason=meeting_invite`;
}

function waitingTitleKey(decision: string | undefined): string | undefined {
  switch (decision) {
    case "WAITING_APPROVAL":
      return "meetings.waitingApprovalTitle";
    case "WAITING_FOR_HOST":
      return "meetings.waitingForHostTitle";
    case "WAITING_FOR_PROVIDER":
      return "meetings.waitingForProviderTitle";
    default:
      return undefined;
  }
}

/**
 * Moves focus to the new screen's heading when the page swaps one screen for
 * another (form → lobby, lobby → form), as AuthShell does, so a screen reader
 * and a keyboard user land on what changed. Not on the first paint, and not
 * out of the loading skeleton, where the form focuses its own name field.
 */
function useFocusHeadingOnViewChange(view: string) {
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    const before = previous.current;
    previous.current = view;
    if (before === undefined || before === view || before === "loading") return;
    const target = document.querySelector<HTMLElement>("main h1") ?? document.querySelector<HTMLElement>("main");
    if (!target) return;
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus();
  }, [view]);
}

export function MeetingPublicInviteView({ linkId, secret }: { linkId: string; secret: string }) {
  const { t } = useTranslation();
  const nav = useNavigation();
  const authStatus = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const { data: workspaces } = useWorkspaces();
  const { mutate: mutateJoin, reset: resetJoin, isPending: joinPending } = useJoinMeeting();
  const joinOnce = useRef(false);
  const reasonHandled = useRef(false);
  // Bumped when the guest walks out of the lobby: a join answer that lands
  // afterwards belongs to a screen that is gone and must not reopen it.
  const lobbyGeneration = useRef(0);
  const [state, setState] = useState<InviteViewState>("loading");
  const [resolveAttempt, setResolveAttempt] = useState(0);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [accessMode, setAccessMode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [lobbyDecision, setLobbyDecision] = useState<string | undefined>();
  const [joinRequestId, setJoinRequestId] = useState<string | undefined>();
  // The last join failure, kept until the next answer: the mutation's own
  // error clears the moment a retry starts, which would flash the screen.
  const [joinFailure, setJoinFailure] = useState<unknown>(undefined);

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
    let live = true;
    void resolveInviteLink(linkId, secret).then((res) => {
      if (!live) return;
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
      setState(inviteStateFromResolve(res));
    }, (err: unknown) => {
      if (live) setState(resolveFailureState(err));
    });
    return () => {
      live = false;
    };
  }, [linkId, secret, resolveAttempt]);

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
    async (decision: Parameters<typeof writeCachedJoinDecision>[1]) => {
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

  const runJoin = useCallback((choice?: PreJoinChoice, requestAgain = false) => {
    if (!meetingId || joinPending) return;
    // The form refuses an empty name itself, inline; this is only a guard.
    if (isGuest && !displayName.trim()) return;
    if (isGuest) {
      writeInviteDisplayName(linkId, displayName);
      if (choice) writeInvitePreJoinChoice(linkId, choice);
    }
    const generation = lobbyGeneration.current;
    mutateJoin(
      { meetingId, ...joinBody, ...(requestAgain ? { request_again: true } : {}) },
      {
        onSuccess: (d) => {
          if (generation !== lobbyGeneration.current) return;
          if (!d) {
            setJoinFailure(new Error("join decision did not parse"));
            return;
          }
          if (isJoinAdmitted(d)) {
            void enterRoom(d);
            return;
          }
          setJoinFailure(undefined);
          setJoinRequestId(d.join_request_id);
          setLobbyDecision(d.decision);
        },
        onError: (err) => {
          if (generation !== lobbyGeneration.current) return;
          // A declined request is a lobby state with its own way back in.
          if (err instanceof ApiError && err.code === "join_request_rejected") {
            setLobbyDecision("DENY");
          }
          // Every other refusal becomes a localized screen too, never the
          // server's own (Vietnamese) sentence in a toast.
          setJoinFailure(err);
        },
      },
    );
  }, [displayName, enterRoom, isGuest, joinBody, joinPending, linkId, meetingId, mutateJoin]);

  const leaveLobby = useCallback(() => {
    if (lobbyDecision === "WAITING_APPROVAL" && joinRequestId) {
      // Best effort: the host's queue should not keep someone who left, but a
      // request that was already decided or expired is nothing to report.
      cancelJoinRequest(joinRequestId).catch(() => undefined);
    }
    lobbyGeneration.current += 1;
    clearCachedJoinDecision(linkId);
    resetJoin();
    setLobbyDecision(undefined);
    setJoinRequestId(undefined);
    setJoinFailure(undefined);
  }, [joinRequestId, linkId, lobbyDecision, resetJoin]);

  useLobbyJoinRetry({
    meetingId,
    decision: lobbyDecision,
    admitted: false,
    hasJoinError: joinFailure !== undefined,
    onRetry: runJoin,
  });

  useEffect(() => {
    if (state !== "ok" || authStatus !== "authed" || !meetingId || joinOnce.current) return;
    joinOnce.current = true;
    runJoin();
  }, [state, authStatus, meetingId, runJoin]);

  const inLobby = lobbyDecision !== undefined || joinFailure !== undefined;
  const view =
    state === "loading" || authStatus === "loading"
      ? "loading"
      : state !== "ok"
        ? state
        : inLobby
          ? `lobby:${joinFailure === undefined ? lobbyDecision : "failure"}`
          : isGuest
            ? "form"
            : "member";

  useFocusHeadingOnViewChange(view);

  const wordmark = t("auth.wordmark");
  let pageTitle: string;
  if (view === "loading") {
    pageTitle = t("meetings.publicInviteTitle");
  } else if (state !== "ok") {
    pageTitle = t(inviteStateCopy(state === "loading" ? "error" : state).title);
  } else if (inLobby) {
    const waitingKey = joinFailure === undefined ? waitingTitleKey(lobbyDecision) : undefined;
    pageTitle = waitingKey ? t(waitingKey) : lobbyMessage(t, lobbyDecision, joinFailure, true);
  } else {
    pageTitle = t("meetings.publicInviteTitle");
  }
  const meetingPart = title && state === "ok" ? ` · ${title}` : "";
  const documentTitle = `${pageTitle}${meetingPart} · ${wordmark}`;
  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  const wrapLobby = (node: ReactNode) =>
    meetingId ? <MeetingLobbyWSProvider meetingId={meetingId}>{node}</MeetingLobbyWSProvider> : node;

  if (view === "loading") {
    return <MeetingInvitePageSkeleton />;
  }
  if (state !== "ok") {
    const copy = inviteStateCopy(state === "loading" ? "error" : state);
    return (
      <MeetingInviteStateCard title={t(copy.title)} description={t(copy.hint)}>
        {state === "error" ? (
          <Button
            type="button"
            className="mt-2 self-start"
            onClick={() => {
              setState("loading");
              setResolveAttempt((n) => n + 1);
            }}
          >
            {t("common.retry")}
          </Button>
        ) : null}
      </MeetingInviteStateCard>
    );
  }

  if (inLobby) {
    return wrapLobby(
      <MeetingInviteShell>
        <MeetingLobby
          title={title}
          decision={lobbyDecision}
          error={joinFailure}
          // The invite page is guest-facing for everyone: known refusals get
          // their own sentence, anything else a generic one, never raw server text.
          guestMode
          onRequestAgain={() => runJoin(undefined, true)}
          requestingAgain={joinPending}
          onRetry={() => runJoin()}
          onLeave={leaveLobby}
        />
      </MeetingInviteShell>,
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
        {joinPending ? (
          <p role="status" className="flex items-center gap-2 text-body text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            {t("meetings.joining")}
          </p>
        ) : null}
        <Button variant="outline" onClick={() => runJoin()} disabled={joinPending}>
          {t("meetings.publicInviteJoin")}
        </Button>
      </div>
    </MeetingInviteShell>,
  );
}
