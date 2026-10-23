"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useDataChannel, useLocalParticipant, useParticipants, useTrackToggle } from "@livekit/components-react";
import { Track, type DataPublishOptions } from "livekit-client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  decodeSignal,
  encodeSignal,
  expireReactions,
  forgetIdentity,
  initialSignalsState,
  micLockedNow,
  reduceSignal,
  REACTION_TTL_MS,
  shouldHonorMuteRequest,
  SIGNAL_TOPIC,
  type MeetingSignal,
  type SignalsState,
} from "./meeting-signals";

type SignalsApi = SignalsState & {
  localIdentity: string;
  handRaised: boolean;
  toggleHand: () => void;
  react: (value: string) => void;
  /** Host asks `identity` to mute; their client mutes itself and may unmute again. */
  requestMute: (identity: string, name: string) => void;
  /** Host asks everyone but the other hosts to mute; each may unmute again. */
  requestMuteAll: () => void;
};

/** The part of a received LiveKit data message the signals read. */
type DataMessage = { payload: Uint8Array; from?: { identity: string } };

const Ctx = createContext<SignalsApi | null>(null);
const NO_EXTRA_ROOM_EVENTS: never[] = [];

function isMuteSignal(signal: MeetingSignal): boolean {
  return signal.kind === "mute_request" || signal.kind === "mute_all";
}

/**
 * The same state behind a subscription, so a tile can read one participant's
 * hand and reaction without re-rendering on everyone else's.
 */
type SignalsStore = {
  get: () => SignalsState;
  set: (next: SignalsState) => void;
  subscribe: (listener: () => void) => () => void;
};

function createSignalsStore(): SignalsStore {
  let state = initialSignalsState;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const StoreCtx = createContext<SignalsStore | null>(null);
const RequestMuteCtx = createContext<(identity: string, name: string) => void>(() => {});
const fallbackStore = createSignalsStore();

/** Client state for the room: lives only as long as the room is mounted. */
export function MeetingSignalsProvider({
  children,
  canHost = false,
  hostIdentities = [],
}: {
  children: ReactNode;
  canHost?: boolean;
  hostIdentities?: readonly string[];
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<SignalsState>(initialSignalsState);
  const [store] = useState(createSignalsStore);
  const { localParticipant } = useLocalParticipant();
  // Only joins and leaves matter here (a raised hand leaves with its owner):
  // the provider does not follow speaking or quality events.
  const participants = useParticipants({ updateOnlyOn: NO_EXTRA_ROOM_EVENTS });
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const localIdentity = localParticipant.identity;
  const hostIdentitiesRef = useRef(hostIdentities);
  hostIdentitiesRef.current = hostIdentities;
  const canHostRef = useRef(canHost);
  canHostRef.current = canHost;

  const onSignal = (msg: DataMessage) => {
    const signal = decodeSignal(msg.payload);
    const from = msg.from?.identity;
    if (!signal || !from) return;
    if (signal.kind === "mute_request" || signal.kind === "mute_all") {
      const forMe =
        signal.kind === "mute_request"
          ? signal.target === localIdentity
          : // A fellow host is running the meeting too; mute-all leaves them be.
            !canHostRef.current && !hostIdentitiesRef.current.includes(localIdentity);
      if (shouldHonorMuteRequest(from, hostIdentitiesRef.current) && forMe && mic.enabled) {
        void mic.toggle(false);
        // Muted by someone else: say so, or the viewer thinks the mic broke,
        // and put the way back on the notice itself. Top centre: the corner
        // toaster sat on the side panel, away from where the viewer looks.
        // The toaster's own live region reads it out, each time.
        toast.info(t("meetings.hostMutedYou"), {
          description: t("meetings.hostMutedYouHint"),
          position: "top-center",
          // A lock that lands while this notice is up refuses the mic; the
          // lock's own notice says why, so the action just stands down.
          action: {
            label: t("meetings.micOn"),
            onClick: () => {
              if (!micLockedNow(localParticipant)) void mic.toggle(true);
            },
          },
        });
      }
      return;
    }
    setState((s) => reduceSignal(s, from, signal, Date.now()));
  };
  const onSignalRef = useRef(onSignal);
  useLayoutEffect(() => {
    onSignalRef.current = onSignal;
  });
  // useDataChannel builds a new channel whenever its callback changes, and a
  // channel's send throws until the hook has subscribed to it. One stable
  // callback keeps one channel for the life of the room.
  const handleMessage = useCallback((msg: DataMessage) => onSignalRef.current(msg), []);
  const { send } = useDataChannel(SIGNAL_TOPIC, handleMessage);

  const publish = useCallback(
    (signal: MeetingSignal): Promise<void> | undefined => {
      if (isMuteSignal(signal) && !canHostRef.current) return undefined;
      const options: DataPublishOptions = { reliable: true, topic: SIGNAL_TOPIC };
      // A mute request concerns one person: the SFU delivers it to them alone
      // instead of every client in a large room decoding and dropping it.
      if (signal.kind === "mute_request") options.destinationIdentities = [signal.target];
      const sent = send(encodeSignal(signal), options);
      sent.catch(() => {
        // A lost hand or reaction costs nobody anything; a mute the host
        // believes was sent does.
        if (isMuteSignal(signal)) toast.error(t("meetings.muteRequestFailed"));
      });
      // LiveKit does not echo our own data messages: apply locally.
      if (!isMuteSignal(signal)) setState((s) => reduceSignal(s, localIdentity, signal, Date.now()));
      return sent;
    },
    [send, localIdentity, t],
  );

  // Reactions fade out on their own; run the sweep only while some exist.
  useEffect(() => {
    if (state.reactions.length === 0) return;
    const id = window.setTimeout(() => setState((s) => expireReactions(s, Date.now())), REACTION_TTL_MS);
    return () => window.clearTimeout(id);
  }, [state.reactions]);

  // A hand belongs to someone still in the room.
  useEffect(() => {
    const present = new Set(participants.map((p) => p.identity));
    setState((s) => s.hands.filter((h) => !present.has(h)).reduce(forgetIdentity, s));
  }, [participants]);

  useEffect(() => {
    store.set(state);
  }, [store, state]);

  // Only a committed publish: a render React throws away (a suspended
  // transition) holds a channel that was never subscribed.
  const publishRef = useRef(publish);
  useLayoutEffect(() => {
    publishRef.current = publish;
  });
  const requestMute = useCallback(
    (identity: string, name: string) => {
      // The host sees the mic badge flip too, but only once their client
      // hears back; the toast says the request left, by name.
      void publishRef.current({ kind: "mute_request", target: identity })?.then(
        // Top centre, as the muted person's notice: the corner toaster sat
        // on the side panel's question box.
        () => toast.success(t("meetings.mutedParticipant", { name }), { position: "top-center" }),
        () => {},
      );
    },
    [t],
  );

  const requestMuteAll = useCallback(() => {
    void publishRef.current({ kind: "mute_all" })?.then(
      () => toast.success(t("meetings.mutedEveryone"), { position: "top-center" }),
      () => {},
    );
  }, [t]);

  const handRaised = state.hands.includes(localIdentity);
  const api = useMemo<SignalsApi>(
    () => ({
      ...state,
      localIdentity,
      handRaised,
      toggleHand: () => publish({ kind: "hand", value: !handRaised }),
      react: (value) => publish({ kind: "reaction", value }),
      requestMute,
      requestMuteAll,
    }),
    [state, localIdentity, handRaised, publish, requestMute, requestMuteAll],
  );

  return (
    <StoreCtx.Provider value={store}>
      <RequestMuteCtx.Provider value={requestMute}>
        <Ctx.Provider value={api}>
          {children}
        </Ctx.Provider>
      </RequestMuteCtx.Provider>
    </StoreCtx.Provider>
  );
}

const noop: SignalsApi = {
  ...initialSignalsState,
  localIdentity: "",
  handRaised: false,
  toggleHand: () => {},
  react: () => {},
  requestMute: () => {},
  requestMuteAll: () => {},
};

/** Outside the provider (tests, previews) every signal is a no-op. */
export function useMeetingSignals(): SignalsApi {
  return useContext(Ctx) ?? noop;
}

/** One participant's hand and latest reaction; re-renders only when those change. */
export function useParticipantSignal(identity: string): {
  handRaised: boolean;
  reaction: SignalsState["reactions"][number] | undefined;
} {
  const store = useContext(StoreCtx) ?? fallbackStore;
  const handRaised = useSyncExternalStore(store.subscribe, () => store.get().hands.includes(identity));
  const reaction = useSyncExternalStore(store.subscribe, () =>
    store.get().reactions.filter((r) => r.identity === identity).at(-1),
  );
  return { handRaised, reaction };
}

/** Stable host-mute action, for components that must not re-render on every signal. */
export function useRequestMute(): (identity: string, name: string) => void {
  return useContext(RequestMuteCtx);
}
