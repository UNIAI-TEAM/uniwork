"use client";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, DoorOpen, Hand, X, type LucideIcon } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { useRoomContext } from "@livekit/components-react";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { UI_EASE_OUT, UI_EASE_SETTLE } from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";
import { requestDisplayName } from "./meeting-join-request-row";
import { MeetingPersonAvatar } from "./meeting-person";
import { useRoomAvatarOf, useRoomTintOf, useUserAvatarOf } from "./meeting-room-avatars";
import { useJoinRequestActions } from "./use-join-request-actions";
import { useMeetingSignals } from "./use-meeting-signals";
import { usePendingJoinRequests } from "./use-pending-join-requests";
import { useRoomArrivals } from "./use-room-arrivals";

type NoticeKind = "join" | "leave" | "hand" | "knock";

type StageNotice = {
  id: string;
  kind: NoticeKind;
  name: string;
  avatarUrl?: string;
  tint?: Tint;
  /** When it was first seen: newest stands in front. */
  at: number;
  /** Knocks stay until someone decides them; the rest go after TTL_MS. */
  expiresAt?: number;
  requestId?: string;
  member?: boolean;
};

const TTL_MS = 5000;
const SHOWN = 3;
const GAP_PX = 8;
/** Front card, then the two behind it: smaller, higher and fainter. */
const BEHIND = [
  { y: 0, scale: 1, opacity: 1 },
  { y: -8, scale: 0.94, opacity: 0.7 },
  { y: -16, scale: 0.88, opacity: 0.4 },
] as const;

const TEXT_KEY: Record<NoticeKind, string> = {
  join: "meetings.motion.room.joined",
  leave: "meetings.motion.room.left",
  hand: "meetings.motion.room.hand",
  knock: "meetings.motion.room.knock",
};
const BADGE: Partial<Record<NoticeKind, LucideIcon>> = { join: Check, hand: Hand, knock: DoorOpen };

/** Arrivals, departures and raised hands, each a card that leaves on its own. */
function useTransientNotices() {
  const [items, setItems] = useState<StageNotice[]>([]);
  const seq = useRef(0);
  const avatarOf = useRoomAvatarOf();
  const tintOf = useRoomTintOf();
  const room = useRoomContext();
  const { hands, localIdentity } = useMeetingSignals();

  const push = (kind: NoticeKind, identity: string, name: string) => {
    const at = Date.now();
    seq.current += 1;
    const notice: StageNotice = {
      id: `${kind}:${identity}:${seq.current}`,
      kind,
      name,
      avatarUrl: avatarOf(identity),
      tint: tintOf(identity),
      at,
      expiresAt: at + TTL_MS,
    };
    // A short history is plenty: only three are ever drawn.
    setItems((prev) => [notice, ...prev].slice(0, 12));
  };
  const pushRef = useRef(push);
  useLayoutEffect(() => {
    pushRef.current = push;
  });

  useRoomArrivals((kind, p) => pushRef.current(kind, p.identity, p.name || p.identity));

  // A hand going up is news; one already up when we arrive, or our own, is not.
  const prevHands = useRef(hands);
  useEffect(() => {
    const before = new Set(prevHands.current);
    prevHands.current = hands;
    for (const identity of hands) {
      if (before.has(identity) || identity === localIdentity) continue;
      const p = room.remoteParticipants.get(identity);
      pushRef.current("hand", identity, p?.name || identity);
    }
  }, [hands, localIdentity, room]);

  return [items, setItems] as const;
}

/** Guests at the door, for whoever may let them in; each card stays until decided. */
function useKnockNotices(meetingId: string | undefined): StageNotice[] {
  const { pending } = usePendingJoinRequests(meetingId);
  const avatarOf = useUserAvatarOf();
  const [seenAt, setSeenAt] = useState<ReadonlyMap<string, number>>(() => new Map());
  useEffect(() => {
    setSeenAt((prev) => {
      const fresh = pending.filter((r) => !prev.has(r.id));
      if (fresh.length === 0) return prev;
      const next = new Map(prev);
      for (const r of fresh) next.set(r.id, Date.now());
      return next;
    });
  }, [pending]);
  return pending.map((r) => ({
    id: `knock:${r.id}`,
    kind: "knock",
    name: requestDisplayName(r),
    avatarUrl: avatarOf(r.requester_user_id),
    at: seenAt.get(r.id) ?? Number.MAX_SAFE_INTEGER,
    requestId: r.id,
    member: Boolean(r.requester_user_id),
  }));
}

/** Newest first, three at most; a knock is never pushed out by passing news. */
function pickShown(knocks: StageNotice[], transient: StageNotice[]): StageNotice[] {
  const all = [...knocks, ...transient].sort((a, b) => b.at - a.at);
  const kept = new Set(all.filter((n) => n.kind === "knock").slice(0, SHOWN).map((n) => n.id));
  let room = SHOWN - kept.size;
  return all.filter((n) => kept.has(n.id) || (n.kind !== "knock" && room-- > 0));
}

/**
 * Who came, who left, who raised a hand and who knocks, as one stack of
 * cards in the stage's bottom-left corner (UNI-2285 E): newest in front, two
 * more peeking behind, fanned out into a list on hover or focus. Passing news
 * leaves after five seconds, paused while the stack is held open; a knock
 * stays, with "Cho vào", until it is decided. The room's announcers keep
 * speaking for screen readers, so the cards add no live region of their own.
 */
export function MeetingStageToasts({
  meetingId,
  canAdmit = false,
  className,
  style,
}: {
  meetingId?: string;
  /** The viewer may let guests in: knocks join the stack. */
  canAdmit?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion() ?? false;
  const [items, setItems] = useTransientNotices();
  const knocks = useKnockNotices(canAdmit ? meetingId : undefined);
  const { approveOne, isApproving, rejectOne, isRejecting } = useJoinRequestActions(meetingId ?? "");
  const shown = pickShown(knocks, items);

  // Hover or focus holds the stack open and stops the clock; the time held is
  // given back to every card when it lets go.
  const [open, setOpen] = useState(false);
  const heldSince = useRef(0);
  const hold = (next: boolean) => {
    if (next === open) return;
    if (next) heldSince.current = Date.now();
    else {
      const held = Date.now() - heldSince.current;
      setItems((prev) => prev.map((n) => (n.expiresAt ? { ...n, expiresAt: n.expiresAt + held } : n)));
    }
    setOpen(next);
  };

  useEffect(() => {
    if (open || items.length === 0) return;
    const next = Math.min(...items.map((n) => n.expiresAt ?? Infinity));
    const id = window.setTimeout(
      () => setItems((prev) => prev.filter((n) => (n.expiresAt ?? Infinity) > Date.now())),
      Math.max(0, next - Date.now()),
    );
    return () => window.clearTimeout(id);
  }, [items, open, setItems]);

  // Fanned out, each card sits above the ones in front of it: their heights decide where.
  const cards = useRef(new Map<string, HTMLElement>());
  const [heights, setHeights] = useState<Readonly<Record<string, number>>>({});
  // The stack's width is fixed, so a card's height changes only with the cards themselves.
  const shownKey = shown.map((n) => n.id).join(" ");
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    for (const [id, el] of cards.current) next[id] = el.offsetHeight;
    setHeights(next);
  }, [shownKey]);

  let offset = 0;
  const place = shown.map((n, i) => {
    const at = open ? { y: -offset, scale: 1, opacity: 1 } : BEHIND[i]!;
    offset += (heights[n.id] ?? 0) + GAP_PX;
    return at;
  });
  const settle = reduce
    ? { duration: 0 }
    : { default: { duration: 0.42, ease: UI_EASE_SETTLE }, opacity: { duration: 0.3, ease: UI_EASE_OUT } };

  return (
    // Always mounted, so the last card can play its exit; named only while it holds any.
    <section
      aria-label={shown.length > 0 ? t("meetings.motion.room.notices") : undefined}
      data-testid="meeting-stage-toasts"
      data-open={open ? "" : undefined}
      // 312px: a knock card holds "<name> xin vào", its × and "Cho vào" on one line.
      className={cn("absolute z-30 w-78 max-w-[calc(100%-2rem)]", className)}
      style={{ ...style, height: shown[0] ? heights[shown[0].id] : undefined }}
      onPointerEnter={() => hold(true)}
      onPointerLeave={() => hold(false)}
      onFocus={() => hold(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold(false);
      }}
    >
      <AnimatePresence>
        {shown.map((n, i) => {
          const Badge = BADGE[n.kind];
          const behind = !open && i > 0;
          return (
            <motion.div
              key={n.id}
              ref={(el: HTMLDivElement | null) => {
                if (el) cards.current.set(n.id, el);
                else cards.current.delete(n.id);
              }}
              data-stage-notice={n.kind}
              inert={behind}
              initial={reduce ? false : { y: "110%", opacity: 0 }}
              animate={place[i]}
              exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { x: "-30%", opacity: 0 }}
              transition={settle}
              style={{ zIndex: SHOWN - i, transformOrigin: "50% 100%" }}
              className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 rounded-[14px] border border-meeting-bar-border bg-meeting-bar-bg px-2.5 py-2 text-label text-meeting-bar-foreground shadow-floating backdrop-blur-md"
            >
              <span
                className={cn(
                  "contents *:transition-opacity *:duration-standard *:ease-out-quart",
                  behind && "*:opacity-0",
                )}
              >
                <span className="relative shrink-0">
                  <MeetingPersonAvatar
                    name={n.name}
                    avatarUrl={n.avatarUrl}
                    size={32}
                    tint={n.tint ?? "gray"}
                    className={cn(n.kind === "leave" && "opacity-50")}
                  />
                  {Badge ? (
                    <span
                      aria-hidden
                      className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full bg-meeting-bar-foreground text-meeting-stage"
                    >
                      <Badge className="size-3" />
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="block truncate">
                    <Trans i18nKey={TEXT_KEY[n.kind]} values={{ name: n.name }} components={{ b: <b className="font-semibold" /> }} />
                  </span>
                  {n.kind === "knock" ? (
                    <span className="block truncate text-caption text-meeting-bar-muted-foreground">
                      {t(n.member ? "meetings.joinRequesterMember" : "meetings.guest")}
                    </span>
                  ) : null}
                </span>
                {n.requestId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7.5 shrink-0 rounded-[9px] text-meeting-bar-muted-foreground hover:bg-meeting-bar-foreground/10 hover:text-meeting-bar-foreground"
                    aria-label={t("meetings.rejectName", { name: n.name })}
                    aria-disabled={isRejecting(n.requestId) || isApproving(n.requestId) || undefined}
                    onClick={() => n.requestId && rejectOne(n.requestId)}
                  >
                    <X aria-hidden />
                  </Button>
                ) : null}
                {n.requestId ? (
                  <Button
                    type="button"
                    variant="brand"
                    size="sm"
                    className="h-7.5 shrink-0 rounded-[9px] px-3 font-semibold"
                    aria-label={t("meetings.approveName", { name: n.name })}
                    aria-disabled={isApproving(n.requestId) || undefined}
                    onClick={() => n.requestId && approveOne(n.requestId)}
                  >
                    {t("meetings.panel.people.admit")}
                  </Button>
                ) : null}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </section>
  );
}
